/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

/**
 * History tablolarina satir yazan SQL (commit ETMEZ; islemi cagiran yonetir).
 * <p>
 * Iki yerden kullanilir: {@link TsWriteQueue}'nun yazici thread'i ve
 * 1.7'den itibaren history export'un kendisi. History export satirlari ve
 * watermark'i <b>ayni islemde</b> yazar: ya ikisi birden kalici olur ya
 * hicbiri. 1.6'ya kadar watermark satirlar kuyruga girer girmez
 * ilerletiliyordu; kuyruk tasinca ya da station kapanirken yazilamayan
 * satirlar "aktarildi" sayilip bir daha okunmuyordu.
 *
 * @author Akyllyoy
 */
public final class TsRowWriter
{
  /** UTC'de baglamak icin (setTimestamp yerel TZ'ye kaymasin) */
  private static final ThreadLocal<Calendar> UTC =
    ThreadLocal.withInitial(() -> Calendar.getInstance(TimeZone.getTimeZone("UTC")));

  private TsRowWriter() { }

  /**
   * Ornekleri tiplerine gore ilgili history tablosuna ekler
   * ({@code ON CONFLICT DO NOTHING}: ayni point + zaman ikinci kez yazilmaz).
   * {@code updateLive} ise {@code point_live}'i en yeni degerle gunceller.
   */
  public static void write(TsConnection c, String schema, List<TsSample> batch, boolean updateLive)
    throws SQLException
  {
    Map<TsValueType, List<TsSample>> byType = new HashMap<>();
    for (int i = 0; i < batch.size(); i++)
    {
      TsSample s = batch.get(i);
      List<TsSample> l = byType.get(s.valueType);
      if (l == null) { l = new ArrayList<>(); byType.put(s.valueType, l); }
      l.add(s);
    }

    for (Map.Entry<TsValueType, List<TsSample>> e : byType.entrySet())
    {
      insertRows(c, schema, e.getKey(), e.getValue());
    }

    if (updateLive)
    {
      upsertLive(c, schema, batch);
    }
  }

  static void insertRows(TsConnection c, String schema, TsValueType type, List<TsSample> rows)
    throws SQLException
  {
    String sql = "INSERT INTO " + schema + '.' + type.table
      + " (time, point_id, value, status, trend_flags, src) VALUES (?,?,?,?,?,?)"
      + " ON CONFLICT (point_id, time) DO NOTHING";

    Calendar utc = UTC.get();
    try (PreparedStatement ps = c.raw().prepareStatement(sql))
    {
      for (int i = 0; i < rows.size(); i++)
      {
        TsSample s = rows.get(i);
        ps.setTimestamp(1, new Timestamp(s.time), utc);
        ps.setLong(2, s.pointId);
        switch (type)
        {
          case NUMERIC:
            if (Double.isNaN(s.numValue) || Double.isInfinite(s.numValue))
            {
              ps.setNull(3, java.sql.Types.DOUBLE);
            }
            else
            {
              ps.setDouble(3, s.numValue);
            }
            break;
          case BOOLEAN: ps.setBoolean(3, s.boolValue); break;
          case ENUM:    ps.setInt(3, s.enumValue); break;
          default:
            if (s.strValue == null) { ps.setNull(3, java.sql.Types.VARCHAR); }
            else { ps.setString(3, s.strValue); }
        }
        ps.setInt(4, s.status);
        ps.setShort(5, s.trendFlags);
        ps.setShort(6, s.src);
        ps.addBatch();
      }
      ps.executeBatch();
    }
  }

  /**
   * point_live tablosunu partideki en yeni degerle gunceller.
   */
  static void upsertLive(TsConnection c, String schema, List<TsSample> batch)
    throws SQLException
  {
    Map<Long, TsSample> latest = new HashMap<>();
    for (int i = 0; i < batch.size(); i++)
    {
      TsSample s = batch.get(i);
      TsSample prev = latest.get(s.pointId);
      if (prev == null || s.time > prev.time) { latest.put(s.pointId, s); }
    }
    if (latest.isEmpty()) { return; }

    String sql = "INSERT INTO " + schema + ".point_live"
      + " (point_id, time, num_value, bool_value, str_value, enum_value, status, updated_at)"
      + " VALUES (?,?,?,?,?,?,?, now())"
      + " ON CONFLICT (point_id) DO UPDATE SET"
      + " time = EXCLUDED.time, num_value = EXCLUDED.num_value,"
      + " bool_value = EXCLUDED.bool_value, str_value = EXCLUDED.str_value,"
      + " enum_value = EXCLUDED.enum_value, status = EXCLUDED.status,"
      + " updated_at = now()"
      + " WHERE " + schema + ".point_live.time <= EXCLUDED.time";

    Calendar utc = UTC.get();
    try (PreparedStatement ps = c.raw().prepareStatement(sql))
    {
      for (TsSample s : latest.values())
      {
        ps.setLong(1, s.pointId);
        ps.setTimestamp(2, new Timestamp(s.time), utc);
        if (s.valueType == TsValueType.NUMERIC
            && !Double.isNaN(s.numValue) && !Double.isInfinite(s.numValue))
        {
          ps.setDouble(3, s.numValue);
        }
        else { ps.setNull(3, java.sql.Types.DOUBLE); }

        if (s.valueType == TsValueType.BOOLEAN) { ps.setBoolean(4, s.boolValue); }
        else { ps.setNull(4, java.sql.Types.BOOLEAN); }

        if (s.valueType == TsValueType.STRING && s.strValue != null) { ps.setString(5, s.strValue); }
        else { ps.setNull(5, java.sql.Types.VARCHAR); }

        if (s.valueType == TsValueType.ENUM) { ps.setInt(6, s.enumValue); }
        else { ps.setNull(6, java.sql.Types.INTEGER); }

        ps.setInt(7, s.status);
        ps.addBatch();
      }
      ps.executeBatch();
    }
  }
}
