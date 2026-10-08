/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;

/**
 * History export ilerlemesi ("watermark") icin veri erisim katmani.
 * <p>
 * <b>Neden veritabaninda:</b> Ilerleme station'in bellegi ya da config.bog
 * icinde degil, {@code <sema>.export_state} tablosunda tutulur. Boylece
 * station yeniden baslatildiginda -- hatta baska bir makineye tasindiginda
 * bile -- kaldigi yerden devam eder. Hedef veritabani ile ilerleme kaydi
 * ayni islemde yasadigi icin "yazildi ama isaretlenemedi" durumu
 * kalicilasmaz: en kotu ihtimalle ayni kayitlar bir kez daha gonderilir ve
 * {@code ON CONFLICT DO NOTHING} onlari sessizce eler.
 * <p>
 * Bu sinif Niagara'ya bagimli degildir; gercek PostgreSQL'e karsi test
 * edilebilir.
 *
 * @author Akyllyoy
 */
public final class TsExportState
{
  /** UTC baglamak icin (setTimestamp yerel saat dilimine kaymasin) */
  private static final Calendar UTC = Calendar.getInstance(TimeZone.getTimeZone("UTC"));

  private final String schema;

  public TsExportState(String schema)
  {
    this.schema = TsSchema.validateIdentifier(schema);
  }

  /**
   * Tum watermark'lari tek sorguda okur.
   *
   * @return point_id -> en son aktarilan kaydin zamani (epoch millis).
   *         Hic aktarilmamis point'ler haritada bulunmaz.
   */
  public Map<Long, Long> loadAll(TsConnection c)
    throws SQLException
  {
    Map<Long, Long> out = new HashMap<>();
    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(
           "SELECT point_id, last_time FROM " + schema + ".export_state "
         + "WHERE last_time IS NOT NULL");
         ResultSet rs = ps.executeQuery())
    {
      while (rs.next())
      {
        Timestamp t = rs.getTimestamp(2, UTC);
        if (t != null) { out.put(rs.getLong(1), t.getTime()); }
      }
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
    return out;
  }

  /**
   * Tek bir point'in watermark'ini okur.
   *
   * @return epoch millis, hic aktarim yapilmadiysa {@code null}
   */
  public Long load(TsConnection c, long pointId)
    throws SQLException
  {
    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(
      "SELECT last_time FROM " + schema + ".export_state WHERE point_id = ?"))
    {
      ps.setLong(1, pointId);
      try (ResultSet rs = ps.executeQuery())
      {
        Long v = null;
        if (rs.next())
        {
          Timestamp t = rs.getTimestamp(1, UTC);
          if (t != null) { v = t.getTime(); }
        }
        c.commit();
        return v;
      }
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
  }

  /**
   * Basarili bir aktarim turunu isaretler.
   * <p>
   * {@code last_time} yalnizca <b>ileri</b> gider: eszamanli baska bir
   * yazici daha yeni bir zaman isaretlediyse geri alinmaz
   * ({@code GREATEST}). Bu, ayni point'e iki kaynaktan yazildiginda
   * kayit atlanmasini onler.
   *
   * @param lastTime  bu turda aktarilan en son kaydin zamani (epoch millis)
   * @param rowsAdded bu turda kuyruga verilen kayit sayisi
   */
  public void markSuccess(TsConnection c, long pointId, long lastTime, long rowsAdded)
    throws SQLException
  {
    markSuccess(c, pointId, lastTime, rowsAdded, true);
  }

  /**
   * {@link #markSuccess(TsConnection, long, long, long)} ile ayni;
   * {@code commit=false} ise islemi cagiran kapatir. History export satirlari
   * ve watermark'i boyle tek islemde yazar (biri olmadan digeri kalici olmaz).
   * Hata durumunda geri alma da cagirana aittir.
   */
  public void markSuccess(TsConnection c, long pointId, long lastTime, long rowsAdded,
                          boolean commit)
    throws SQLException
  {
    if (!commit)
    {
      try (PreparedStatement ps = c.raw().prepareStatement(successSql()))
      {
        ps.setLong(1, pointId);
        ps.setTimestamp(2, new Timestamp(lastTime), UTC);
        ps.setLong(3, rowsAdded);
        ps.executeUpdate();
      }
      return;
    }
    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(successSql()))
    {
      ps.setLong(1, pointId);
      ps.setTimestamp(2, new Timestamp(lastTime), UTC);
      ps.setLong(3, rowsAdded);
      ps.executeUpdate();
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
  }

  private String successSql()
  {
    return "INSERT INTO " + schema + ".export_state "
         + "(point_id, last_time, last_run, last_status, last_fault, rows_total, updated_at) "
         + "VALUES (?, ?, now(), 'ok', NULL, ?, now()) "
         + "ON CONFLICT (point_id) DO UPDATE SET "
         + "last_time = GREATEST(" + schema + ".export_state.last_time, EXCLUDED.last_time), "
         + "last_run = now(), last_status = 'ok', last_fault = NULL, "
         + "rows_total = " + schema + ".export_state.rows_total + EXCLUDED.rows_total, "
         + "updated_at = now()";
  }

  /**
   * Basarisiz bir turu isaretler. <b>{@code last_time}'a dokunmaz</b> --
   * bir sonraki tur ayni yerden devam etsin diye.
   */
  public void markFailure(TsConnection c, long pointId, String fault)
    throws SQLException
  {
    String f = fault == null ? "bilinmeyen hata" : fault;
    if (f.length() > 500) { f = f.substring(0, 500); }

    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(
           "INSERT INTO " + schema + ".export_state "
         + "(point_id, last_run, last_status, last_fault, updated_at) "
         + "VALUES (?, now(), 'fault', ?, now()) "
         + "ON CONFLICT (point_id) DO UPDATE SET "
         + "last_run = now(), last_status = 'fault', last_fault = EXCLUDED.last_fault, "
         + "updated_at = now()"))
    {
      ps.setLong(1, pointId);
      ps.setString(2, f);
      ps.executeUpdate();
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
  }

  /**
   * Tum watermark'lari siler; bir sonraki turda her sey bastan aktarilir.
   * Kayitlar {@code ON CONFLICT} sayesinde cogalmaz, sadece yeniden okunur.
   *
   * @return sifirlanan satir sayisi
   */
  public int resetAll(TsConnection c)
    throws SQLException
  {
    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(
      "UPDATE " + schema + ".export_state SET last_time = NULL, updated_at = now()"))
    {
      int n = ps.executeUpdate();
      c.commit();
      return n;
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
  }

  /** Tek bir point'in watermark'ini sifirlar. */
  public void reset(TsConnection c, long pointId)
    throws SQLException
  {
    c.ensureOpen();
    try (PreparedStatement ps = c.raw().prepareStatement(
      "UPDATE " + schema + ".export_state SET last_time = NULL, updated_at = now() "
    + "WHERE point_id = ?"))
    {
      ps.setLong(1, pointId);
      ps.executeUpdate();
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
  }
}
