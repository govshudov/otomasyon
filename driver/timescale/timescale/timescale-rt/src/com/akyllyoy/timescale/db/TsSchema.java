/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.sql.SQLException;
import java.sql.Statement;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Sema olusturma ve dogrulama.
 * <p>
 * Buradaki DDL yalnizca <b>tablolar, hypertable'lar ve indeksler</b> ile
 * sinirlidir. Sikistirma / saklama / surekli toplulastirma politikalari
 * bilerek disarida birakildi: bunlar isletme kararidir ve
 * {@code sql/02_policies.sql} ile bir kez elle uygulanir.
 * <p>
 * Sema adi kullanicidan geldigi icin SQL'e gomulmeden once
 * {@link #validateIdentifier(String)} ile beyaz liste kontrolunden gecer.
 *
 * @author Akyllyoy
 */
public final class TsSchema
{
  /** Sema surumu; degistiginde migration gerekir. */
  public static final int SCHEMA_VERSION = 1;

  private static final Pattern IDENT = Pattern.compile("[a-z_][a-z0-9_]{0,62}");

  private TsSchema() {}

  /**
   * PostgreSQL tanimlayici adini dogrular (kucuk harf, rakam, alt cizgi).
   *
   * @throws IllegalArgumentException gecersizse
   */
  public static String validateIdentifier(String s)
  {
    if (s == null || !IDENT.matcher(s).matches())
    {
      throw new IllegalArgumentException(
        "Gecersiz PostgreSQL tanimlayicisi: '" + s + "' (beklenen: [a-z_][a-z0-9_]*)");
    }
    return s;
  }

  /**
   * Kullanicinin yazdigi adi gecerli bir PostgreSQL tanimlayicisina cevirir,
   * sonra {@link #validateIdentifier(String)} ile dogrular.
   * <p>
   * Yapilanlar:
   * <ul>
   *   <li>bastaki/sondaki bosluklar atilir</li>
   *   <li>Turkce harfler ASCII karsiligina cevrilir
   *       (&#231;&#287;&#305;&#246;&#351;&#252; &rarr; cgiosu)</li>
   *   <li>kucuk harfe cevrilir -- <b>{@link Locale#ROOT} ile</b>. Turkce
   *       yerel ayarda {@code "TS_DATA".toLowerCase()} sonucu
   *       {@code "ts_data"} degil {@code "ts_data"} olur ama {@code I}
   *       harfi noktasiz {@code &#305;}'ye doner ve tanimlayici bozulur.</li>
   *   <li>bosluk, tire ve nokta alt cizgiye cevrilir</li>
   *   <li>rakamla basliyorsa basina {@code _} eklenir</li>
   *   <li>63 karaktere kirpilir (PostgreSQL siniri)</li>
   * </ul>
   *
   * @throws IllegalArgumentException cevrildikten sonra bile gecersizse
   */
  public static String normalizeIdentifier(String s)
  {
    if (s == null) { throw new IllegalArgumentException("Ad bos olamaz"); }

    String t = s.trim();
    StringBuilder sb = new StringBuilder(t.length());
    for (int i = 0; i < t.length(); i++)
    {
      char c = t.charAt(i);
      switch (c)
      {
        case 'ç': case 'Ç': sb.append('c'); break; // c cedilla
        case 'ğ': case 'Ğ': sb.append('g'); break; // g breve
        case 'ı':                sb.append('i'); break; // dotless i
        case 'İ':                sb.append('i'); break; // dotted I
        case 'ö': case 'Ö': sb.append('o'); break; // o umlaut
        case 'ş': case 'Ş': sb.append('s'); break; // s cedilla
        case 'ü': case 'Ü': sb.append('u'); break; // u umlaut
        case ' ': case '-': case '.': case '/': sb.append('_'); break;
        default: sb.append(c);
      }
    }

    // Locale.ROOT sart: Turkce yerel ayarda 'I' -> 'i' degil noktasiz 'i' olur.
    String out = sb.toString().toLowerCase(Locale.ROOT);

    if (!out.isEmpty() && out.charAt(0) >= '0' && out.charAt(0) <= '9')
    {
      out = '_' + out;
    }
    if (out.length() > 63) { out = out.substring(0, 63); }

    return validateIdentifier(out);
  }

  /**
   * Semanin ve tablolarin var oldugundan emin olur. Var olanlara dokunmaz
   * ({@code IF NOT EXISTS}). Bu islem DDL yetkisi gerektirir; gunluk yazma
   * rolunde calistirilmamalidir.
   */
  public static void ensureSchema(TsConnection c, String schema)
    throws SQLException
  {
    ensureSchema(c, schema, null);
  }

  /**
   * {@link #ensureSchema(TsConnection, String)} ile ayni; ek olarak
   * hypertable'a cevrilemeyen tablolari bildirir.
   * <p>
   * <b>Neden iki asamali:</b> {@code create_hypertable} yalnizca
   * timescaledb eklentisi kuruluyken vardir. Eskiden tum DDL tek islemdeydi
   * ve eklenti yoksa <b>hicbir tablo olusmuyordu</b> -- kullanici
   * "Create Schema" diyor, sema bos kaliyordu. Oysa duz PostgreSQL
   * tablolari veriyi gayet iyi saklar; eksik kalan yalnizca parcalama ve
   * politikalardir. Bu yuzden once tablolar (zorunlu, tek islem), sonra
   * hypertable cagrilari (her biri kendi isleminde, istege bagli).
   *
   * @param notHypertables doldurulacak liste: hypertable yapilamayan tablo
   *                       adlari. {@code null} verilebilir.
   */
  public static void ensureSchema(TsConnection c, String schema,
                                  java.util.List<String> notHypertables)
    throws SQLException
  {
    validateIdentifier(schema);
    c.ensureOpen();

    // 1) Zorunlu: tablolar ve indeksler. Duz PostgreSQL yeter.
    try (Statement st = c.raw().createStatement())
    {
      for (String sql : ddl(schema))
      {
        st.execute(sql);
      }
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }

    // 2) Istege bagli: hypertable'a cevir. Her biri AYRI islemde.
    for (int i = 0; i < HYPERTABLES.length; i++)
    {
      String name = HYPERTABLES[i][0];
      String chunk = HYPERTABLES[i][1];
      try (Statement st = c.raw().createStatement())
      {
        st.execute(hypertable(schema, name, chunk));
        c.commit();
      }
      catch (SQLException e)
      {
        c.rollbackQuietly();
        if (notHypertables != null) { notHypertables.add(name); }
      }
    }
  }

  /** Hypertable'a cevrilecek tablolar ve parca araliklari. */
  private static final String[][] HYPERTABLES = {
    { "hist_numeric", "7 days" },
    { "hist_boolean", "30 days" },
    { "hist_enum",    "30 days" },
    { "hist_string",  "30 days" },
    { "alarm",        "90 days" }
  };

  /**
   * Semanin beklenen tablolari icerdigini dogrular (DDL yetkisi gerektirmez).
   *
   * @return eksik olan tablo adlari; hepsi varsa bos dizi
   */
  public static String[] findMissingTables(TsConnection c, String schema)
    throws SQLException
  {
    validateIdentifier(schema);
    String[] required = {
      "point", "hist_numeric", "hist_boolean", "hist_enum", "hist_string",
      "point_live", "alarm", "export_state", "driver_status"
    };
    java.util.List<String> missing = new java.util.ArrayList<>();
    c.ensureOpen();
    try (java.sql.PreparedStatement ps = c.raw().prepareStatement(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?"))
    {
      for (String t : required)
      {
        ps.setString(1, schema);
        ps.setString(2, t);
        try (java.sql.ResultSet rs = ps.executeQuery())
        {
          if (!rs.next()) { missing.add(t); }
        }
      }
      c.commit();
    }
    catch (SQLException e)
    {
      c.rollbackQuietly();
      throw e;
    }
    return missing.toArray(new String[0]);
  }

  private static String[] ddl(String s)
  {
    return new String[] {
      "CREATE SCHEMA IF NOT EXISTS " + s,

      "CREATE TABLE IF NOT EXISTS " + s + ".point ("
        + "point_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,"
        + "station TEXT NOT NULL,"
        + "history_id TEXT NOT NULL,"
        + "source_ord TEXT,"
        + "name TEXT NOT NULL,"
        + "display_name TEXT,"
        + "path TEXT,"
        + "value_type TEXT NOT NULL,"
        + "unit TEXT,"
        + "precision SMALLINT,"
        + "facets JSONB,"
        + "tags JSONB,"
        + "enum_range JSONB,"
        + "interval_ms INTEGER,"
        + "device TEXT,"
        + "site TEXT,"
        + "enabled BOOLEAN NOT NULL DEFAULT TRUE,"
        + "created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        + "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        + "CONSTRAINT point_uq UNIQUE (station, history_id))",

      "CREATE INDEX IF NOT EXISTS point_tags_gin ON " + s + ".point USING GIN (tags)",
      "CREATE INDEX IF NOT EXISTS point_device_ix ON " + s + ".point (device)",
      "CREATE INDEX IF NOT EXISTS point_site_ix ON " + s + ".point (site)",

      histTable(s, "hist_numeric", "DOUBLE PRECISION"),
      histTable(s, "hist_boolean", "BOOLEAN"),
      histTable(s, "hist_enum", "INTEGER"),
      histTable(s, "hist_string", "TEXT"),


      uniqueIdx(s, "hist_numeric"),
      uniqueIdx(s, "hist_boolean"),
      uniqueIdx(s, "hist_enum"),
      uniqueIdx(s, "hist_string"),

      "CREATE TABLE IF NOT EXISTS " + s + ".point_live ("
        + "point_id BIGINT PRIMARY KEY REFERENCES " + s + ".point(point_id) ON DELETE CASCADE,"
        + "time TIMESTAMPTZ NOT NULL,"
        + "num_value DOUBLE PRECISION,"
        + "bool_value BOOLEAN,"
        + "str_value TEXT,"
        + "enum_value INTEGER,"
        + "status INTEGER NOT NULL DEFAULT 0,"
        + "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",

      "CREATE TABLE IF NOT EXISTS " + s + ".alarm ("
        + "time TIMESTAMPTZ NOT NULL,"
        + "uuid UUID NOT NULL,"
        + "station TEXT,"
        + "source_ord TEXT,"
        + "source_name TEXT,"
        + "point_id BIGINT REFERENCES " + s + ".point(point_id) ON DELETE SET NULL,"
        + "alarm_class TEXT,"
        + "priority SMALLINT,"
        + "source_state TEXT,"
        + "alarm_transition TEXT,"
        + "ack_state TEXT,"
        + "ack_required BOOLEAN,"
        + "normal_time TIMESTAMPTZ,"
        + "ack_time TIMESTAMPTZ,"
        + "ack_user TEXT,"
        + "msg_text TEXT,"
        + "alarm_data JSONB)",

      "CREATE UNIQUE INDEX IF NOT EXISTS alarm_pk ON " + s + ".alarm (uuid, time)",
      "CREATE INDEX IF NOT EXISTS alarm_point_ix ON " + s + ".alarm (point_id, time DESC)",
      "CREATE INDEX IF NOT EXISTS alarm_class_ix ON " + s + ".alarm (alarm_class, time DESC)",

      "CREATE TABLE IF NOT EXISTS " + s + ".export_state ("
        + "point_id BIGINT PRIMARY KEY REFERENCES " + s + ".point(point_id) ON DELETE CASCADE,"
        + "last_time TIMESTAMPTZ,"
        + "last_run TIMESTAMPTZ,"
        + "last_status TEXT,"
        + "last_fault TEXT,"
        + "rows_total BIGINT NOT NULL DEFAULT 0,"
        + "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",

      "CREATE TABLE IF NOT EXISTS " + s + ".driver_status ("
        + "station TEXT PRIMARY KEY,"
        + "driver_version TEXT,"
        + "last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),"
        + "points_total INTEGER,"
        + "exports_total INTEGER,"
        + "queue_depth INTEGER,"
        + "last_error TEXT)",

      "CREATE TABLE IF NOT EXISTS " + s + ".schema_version ("
        + "version INTEGER PRIMARY KEY,"
        + "applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        + "note TEXT)",

      "INSERT INTO " + s + ".schema_version (version, note) VALUES ("
        + SCHEMA_VERSION + ", 'created by Niagara timescale driver') ON CONFLICT DO NOTHING"
    };
  }

  private static String histTable(String s, String name, String valueSqlType)
  {
    return "CREATE TABLE IF NOT EXISTS " + s + '.' + name + " ("
      + "time TIMESTAMPTZ NOT NULL,"
      + "point_id BIGINT NOT NULL REFERENCES " + s + ".point(point_id) ON DELETE CASCADE,"
      + "value " + valueSqlType + ','
      + "status INTEGER NOT NULL DEFAULT 0,"
      + "trend_flags SMALLINT NOT NULL DEFAULT 0,"
      + "src SMALLINT NOT NULL DEFAULT 0)";
  }

  private static String hypertable(String s, String name, String chunkInterval)
  {
    return "SELECT create_hypertable('" + s + '.' + name + "', 'time', "
      + "chunk_time_interval => INTERVAL '" + chunkInterval + "', if_not_exists => TRUE)";
  }

  private static String uniqueIdx(String s, String name)
  {
    return "CREATE UNIQUE INDEX IF NOT EXISTS " + name + "_pk ON "
      + s + '.' + name + " (point_id, time)";
  }
}
