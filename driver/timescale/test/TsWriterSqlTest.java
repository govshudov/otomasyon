/*
 * BTimescaleTableWriter'in urettigi SQL'i GERCEK bir PostgreSQL'e karsi
 * dogrular. Niagara siniflarina dokunmadan, yalnizca static SQL
 * ureticilerini cagirir (buildCoreDdl / buildPolicyDdl / buildInsertSql).
 *
 * Sandbox'ta timescaledb eklentisi YOK; create_hypertable,
 * add_compression_policy ve add_retention_policy stub fonksiyon olarak
 * tanimli. "ALTER TABLE ... SET (timescaledb.compress ...)" ise duz
 * PostgreSQL'de calismaz -- testin amaci zaten bunun tabloyu
 * OLDURMEDIGINI dogrulamak.
 */

import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

public class TsWriterSqlTest
{
  static int passed = 0;
  static int failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  // ---- static ureticilere yansima ile eris (metotlar package-private) ----
  static Class<?> W;
  static Method mCore, mPolicy, mInsert;

  static String[] core(String s, String t, String[] c) throws Exception
  { return (String[]) mCore.invoke(null, s, t, c); }

  static String[][] policy(String s, String t, int d, int y) throws Exception
  { return (String[][]) mPolicy.invoke(null, s, t, d, y); }

  static String insert(String s, String t, String[] c) throws Exception
  { return (String) mInsert.invoke(null, s, t, c); }

  public static void main(String[] args) throws Exception
  {
    W = Class.forName("com.akyllyoy.timescale.db.TsWideTable");
    mCore = W.getDeclaredMethod("buildCoreDdl", String.class, String.class, String[].class);
    mPolicy = W.getDeclaredMethod("buildPolicyDdl", String.class, String.class, int.class, int.class);
    mInsert = W.getDeclaredMethod("buildInsertSql", String.class, String.class, String[].class);
    mCore.setAccessible(true); mPolicy.setAccessible(true); mInsert.setAccessible(true);

    String url = "jdbc:postgresql://127.0.0.1:5432/scada";
    Connection c = DriverManager.getConnection(url, "niagara_rw", "Ts_Test_2026!");
    c.setAutoCommit(false);

    final String schema = "niagara";
    final String table = "wr_test";
    final int N = 16;

    // Varsayilan sutun adlari: in1..in16 (kullanici col alanlarini bos birakinca)
    String[] cols = new String[N];
    for (int i = 0; i < N; i++) { cols[i] = "in" + (i + 1); }

    exec(c, "DROP TABLE IF EXISTS " + schema + '.' + table);
    c.commit();

    System.out.println("1) Zorunlu DDL (buildCoreDdl)");
    String[] ddl = core(schema, table, cols);
    check("DDL adim sayisi = 1 create + 16 alter + 1 index",
      ddl.length == 1 + N + 1, "len=" + ddl.length);

    // Hypertable ZORUNLU kisimda OLMAMALI. Eskiden buradaydi ve timescaledb
    // eklentisi kurulu olmayan sunucuda tum islemi geri aliyordu: kullanici
    // Create Table diyor, hicbir tablo olusmuyordu.
    String joined = String.join("\n", ddl);
    check("create_hypertable ZORUNLU kisimda DEGIL",
      !joined.contains("create_hypertable"), "");
    check("zorunlu DDL duz PostgreSQL ifadelerinden olusuyor",
      !joined.contains("timescaledb"), "");

    for (String sql : ddl) { exec(c, sql); }
    c.commit();
    check("zorunlu DDL calisti", true, "");

    // Hypertable ayri adim
    Method mHyper = W.getDeclaredMethod("buildHypertableDdl", String.class, String.class);
    mHyper.setAccessible(true);
    String hyperSql = (String) mHyper.invoke(null, schema, table);
    check("hypertable ifadesi ayri uretiliyor", hyperSql.contains("create_hypertable"), hyperSql);
    exec(c, hyperSql);
    c.commit();
    check("hypertable ayri islemde calisti", true, "");

    // Sutunlar dogru mu?
    List<String> got = columnsOf(c, schema, table);
    List<String> want = new ArrayList<>(Arrays.asList("time", "id", "name"));
    want.addAll(Arrays.asList(cols));
    check("sutunlar ve siralari dogru", got.equals(want), "got=" + got);
    check("time TIMESTAMPTZ", "timestamptz".equals(typeOf(c, schema, table, "time")), "");
    check("id BIGINT", "int8".equals(typeOf(c, schema, table, "id")), "");
    check("name TEXT", "text".equals(typeOf(c, schema, table, "name")), "");
    check("in1 DOUBLE PRECISION", "float8".equals(typeOf(c, schema, table, "in1")), "");

    System.out.println("2) Idempotanlik");
    for (String sql : core(schema, table, cols)) { exec(c, sql); }
    exec(c, hyperSql);
    c.commit();
    check("ayni DDL ikinci kez sorunsuz", true, "");
    check("sutun sayisi degismedi", columnsOf(c, schema, table).size() == 3 + N, "");

    System.out.println("3) Sutun adi degistirilince eksik sutun eklenir");
    String[] renamed = cols.clone();
    renamed[0] = "besleme_debi";
    renamed[3] = "dis_sicaklik";
    for (String sql : core(schema, table, renamed)) { exec(c, sql); }
    c.commit();
    List<String> after = columnsOf(c, schema, table);
    check("yeni sutunlar eklendi", after.contains("besleme_debi") && after.contains("dis_sicaklik"),
      "" + after);
    check("eski sutunlar korundu (veri kaybi yok)", after.contains("in1") && after.contains("in4"), "");

    System.out.println("4) Istege bagli DDL (buildPolicyDdl)");
    String[][] pol = policy(schema, table, 1, 10);
    check("politika grup sayisi = 3", pol.length == 3, "len=" + pol.length);
    check("grup1: compress ayarlari", pol[0][0].contains("compress_segmentby = 'id'"), pol[0][0]);

    // ASIL MESELE: politika GUNCELLENEBILMELI.
    // add_*_policy(..., if_not_exists => TRUE) zaten politika varsa
    // FARKLI aralik verilse bile hicbir sey yapmaz. Bu yuzden once
    // remove_*_policy cagrilmali.
    check("grup2 ONCE kaldirir", pol[1][0].contains("remove_compression_policy"), pol[1][0]);
    check("grup2 SONRA ekler", pol[1][1].contains("add_compression_policy"), pol[1][1]);
    check("grup2 if_not_exists KULLANMAZ", !pol[1][1].contains("if_not_exists"), pol[1][1]);
    check("sikistirma araligi gun", pol[1][1].contains("INTERVAL '1 days'"), pol[1][1]);

    check("grup3 ONCE kaldirir", pol[2][0].contains("remove_retention_policy"), pol[2][0]);
    check("grup3 SONRA ekler", pol[2][1].contains("add_retention_policy"), pol[2][1]);
    check("saklama araligi yil", pol[2][1].contains("INTERVAL '10 years'"), pol[2][1]);

    // kaldir+ekle AYNI grupta olmali (arada politikasiz an kalmasin)
    check("kaldir ve ekle ayni islemde", pol[1].length == 2 && pol[2].length == 2, "");

    int polFail = 0;
    for (String[] group : pol)
    {
      try { for (String sql : group) { exec(c, sql); } c.commit(); }
      catch (SQLException e) { polFail++; c.rollback(); }
    }
    // grup1 (timescaledb.compress reloption) duz PG'de calismaz; 2 ve 3 stub'larla calisir
    check("eklentisiz PG'de compress ayari reddedilir (beklenen)", polFail == 1,
      "basarisiz=" + polFail + "/3");

    // --- DEGERI DEGISTIRINCE URETILEN SQL DE DEGISMELI ---
    String[][] pol5 = policy(schema, table, 7, 5);
    check("saklama 10 -> 5 yil yansidi", pol5[2][1].contains("INTERVAL '5 years'"), pol5[2][1]);
    check("sikistirma 1 -> 7 gun yansidi", pol5[1][1].contains("INTERVAL '7 days'"), pol5[1][1]);

    // gercekten ikinci kez uygulanabiliyor mu (idempotan + guncelleyici)
    int reFail = 0;
    for (String[] group : pol5)
    {
      try { for (String sql : group) { exec(c, sql); } c.commit(); }
      catch (SQLException e) { reFail++; c.rollback(); }
    }
    check("politikalar yeniden uygulanabildi", reFail == 1, "basarisiz=" + reFail + "/3");

    // sinir degerler
    String[][] polZero = policy(schema, table, 0, 0);
    check("0 gun -> en az 1 gun", polZero[1][1].contains("INTERVAL '1 days'"), polZero[1][1]);
    check("0 yil -> en az 1 yil", polZero[2][1].contains("INTERVAL '1 years'"), polZero[2][1]);

    // ASIL SINAV: politika patladiktan sonra tablo hala yasiyor mu?
    check("TABLO politika hatasindan SAG CIKTI", columnsOf(c, schema, table).size() >= 3 + N,
      "sutun=" + columnsOf(c, schema, table).size());

    System.out.println("5) INSERT (buildInsertSql)");
    String ins = insert(schema, table, cols);
    check("yer tutucu sayisi = 3 + 16", countChar(ins, '?') == 3 + N, ins);

    long now = System.currentTimeMillis();
    try (PreparedStatement ps = c.prepareStatement(ins))
    {
      ps.setTimestamp(1, new Timestamp(now), Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      ps.setLong(2, 42L);
      ps.setString(3, "Kazan Dairesi");
      for (int i = 0; i < N; i++)
      {
        // 3. ve 7. girisleri "kotu deger" say -> NULL
        if (i == 2 || i == 6) { ps.setNull(4 + i, Types.DOUBLE); }
        else { ps.setDouble(4 + i, 100.0 + i); }
      }
      check("etkilenen satir = 1", ps.executeUpdate() == 1, "");
    }
    c.commit();

    try (Statement st = c.createStatement();
         ResultSet rs = st.executeQuery(
           "SELECT id, name, in1, in2, in3, in7, in16, "
         + "EXTRACT(EPOCH FROM time)*1000 AS ms FROM " + schema + '.' + table))
    {
      check("satir okundu", rs.next(), "");
      check("id = 42", rs.getLong("id") == 42L, "" + rs.getLong("id"));
      check("name = Kazan Dairesi", "Kazan Dairesi".equals(rs.getString("name")), rs.getString("name"));
      check("in1 = 100.0", rs.getDouble("in1") == 100.0, "" + rs.getDouble("in1"));
      check("in2 = 101.0", rs.getDouble("in2") == 101.0, "" + rs.getDouble("in2"));
      rs.getDouble("in3");
      check("in3 NULL (kotu durum)", rs.wasNull(), "");
      rs.getDouble("in7");
      check("in7 NULL (kotu durum)", rs.wasNull(), "");
      check("in16 = 115.0", rs.getDouble("in16") == 115.0, "" + rs.getDouble("in16"));
      long ms = (long) rs.getDouble("ms");
      check("zaman damgasi UTC olarak dogru", Math.abs(ms - now) < 1000, "fark=" + (ms - now) + "ms");
      check("tek satir", !rs.next(), "");
      c.commit();
    }

    System.out.println("6) Bos ad -> NULL, negatif/buyuk deger");
    try (PreparedStatement ps = c.prepareStatement(ins))
    {
      ps.setTimestamp(1, new Timestamp(now + 1000), Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      ps.setLong(2, 43L);
      ps.setNull(3, Types.VARCHAR);
      for (int i = 0; i < N; i++) { ps.setDouble(4 + i, -1.0e12 + i); }
      ps.executeUpdate();
    }
    c.commit();
    check("adsiz satir yazildi", scalar(c, "SELECT count(*) FROM " + schema + '.' + table) == 2, "");
    check("name NULL kaydedildi",
      scalar(c, "SELECT count(*) FROM " + schema + '.' + table + " WHERE name IS NULL") == 1, "");

    System.out.println("7) Farkli tablo adi = farkli tablo (tableName ozelligi)");
    exec(c, "DROP TABLE IF EXISTS " + schema + ".wr_test2");
    c.commit();
    for (String sql : core(schema, "wr_test2", cols)) { exec(c, sql); }
    c.commit();
    check("ikinci tablo bagimsiz olustu", columnsOf(c, schema, "wr_test2").size() == 3 + N, "");
    // indeks ifadesi son siradadir (hypertable artik core'da degil)
    String[] c2 = core(schema, "wr_test2", cols);
    check("indeks adi tabloya ozel",
      c2[c2.length - 1].contains("wr_test2_id_time_ix"), c2[c2.length - 1]);

    System.out.println("8) Kimlik dogrulama (SQL enjeksiyonu)");
    String[] bad = { "ts; DROP TABLE x", "TS_DATA", "1abc", "a-b", "" };
    for (String b : bad)
    {
      boolean rejected;
      try { com.akyllyoy.timescale.db.TsSchema.validateIdentifier(b); rejected = false; }
      catch (Exception e) { rejected = true; }
      check("reddedildi: '" + b + '\'', rejected, "");
    }
    check("kabul: ts_data", "ts_data".equals(com.akyllyoy.timescale.db.TsSchema.validateIdentifier("ts_data")), "");
    check("kabul: besleme_debi_2",
      "besleme_debi_2".equals(com.akyllyoy.timescale.db.TsSchema.validateIdentifier("besleme_debi_2")), "");

    System.out.println("9) Ad normallestirme (kullanici ne yazarsa yazsin)");
    String[][] norm = {
      { "TS_DATA",              "ts_data" },
      { "  Kazan Verileri  ",   "kazan_verileri" },
      { "Besleme Sicakligi",    "besleme_sicakligi" },   // Turkce harfler
      { "Dis-Sicaklik",         "dis_sicaklik" },
      { "AHU.01",               "ahu_01" },
      { "2024_veri",            "_2024_veri" },
      { "Isitma",               "isitma" },              // bas harf I
      { "GUNCEL",               "guncel" },
    };
    for (String[] pair : norm)
    {
      String out;
      try { out = com.akyllyoy.timescale.db.TsSchema.normalizeIdentifier(pair[0]); }
      catch (Exception e) { out = "HATA: " + e.getMessage(); }
      check("'" + pair[0] + "' -> '" + pair[1] + '\'', pair[1].equals(out), "gelen='" + out + '\'');
    }

    // Turkce yerel ayar tuzagi: 'I'.toLowerCase(tr) noktasiz 'i' verir.
    java.util.Locale saved = java.util.Locale.getDefault();
    try
    {
      java.util.Locale.setDefault(new java.util.Locale("tr", "TR"));
      String tr = com.akyllyoy.timescale.db.TsSchema.normalizeIdentifier("TS_DATA_IN1");
      check("Turkce yerel ayarda da ASCII kalir", "ts_data_in1".equals(tr), "gelen='" + tr + '\'');
    }
    finally { java.util.Locale.setDefault(saved); }

    // Normallestirilmis ad gercekten tablo olusturabiliyor mu?
    String nt = com.akyllyoy.timescale.db.TsSchema.normalizeIdentifier("Kazan Dairesi Verileri");
    exec(c, "DROP TABLE IF EXISTS " + schema + '.' + nt);
    c.commit();
    for (String sql : core(schema, nt, cols)) { exec(c, sql); }
    c.commit();
    check("normallestirilmis adla tablo olustu (" + nt + ')',
      columnsOf(c, schema, nt).size() == 3 + N, "");
    exec(c, "DROP TABLE IF EXISTS " + schema + '.' + nt);
    c.commit();

    check("normallestirme enjeksiyonu yine reddeder", reject("ts; DROP TABLE x"), "");
    check("bos ad reddedilir", reject("   "), "");

    exec(c, "DROP TABLE IF EXISTS " + schema + '.' + table);
    exec(c, "DROP TABLE IF EXISTS " + schema + ".wr_test2");
    c.commit();
    c.close();

    System.out.println();
    System.out.println("SONUC: " + passed + " gecti, " + failed + " kaldi");
    if (failed > 0) { System.exit(1); }
  }

  static boolean reject(String s)
  {
    try { com.akyllyoy.timescale.db.TsSchema.normalizeIdentifier(s); return false; }
    catch (Exception e) { return true; }
  }

  static void exec(Connection c, String sql) throws SQLException
  {
    try (Statement st = c.createStatement()) { st.execute(sql); }
  }

  static long scalar(Connection c, String sql) throws SQLException
  {
    try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql))
    {
      rs.next();
      long v = rs.getLong(1);
      c.commit();
      return v;
    }
  }

  static List<String> columnsOf(Connection c, String schema, String table) throws SQLException
  {
    List<String> out = new ArrayList<>();
    try (PreparedStatement ps = c.prepareStatement(
      "SELECT column_name FROM information_schema.columns "
    + "WHERE table_schema=? AND table_name=? ORDER BY ordinal_position"))
    {
      ps.setString(1, schema);
      ps.setString(2, table);
      try (ResultSet rs = ps.executeQuery()) { while (rs.next()) { out.add(rs.getString(1)); } }
    }
    c.commit();
    return out;
  }

  static String typeOf(Connection c, String schema, String table, String col) throws SQLException
  {
    try (PreparedStatement ps = c.prepareStatement(
      "SELECT format_type(a.atttypid, NULL) FROM pg_attribute a "
    + "JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace "
    + "WHERE n.nspname=? AND t.relname=? AND a.attname=?"))
    {
      ps.setString(1, schema); ps.setString(2, table); ps.setString(3, col);
      try (ResultSet rs = ps.executeQuery())
      {
        String v = rs.next() ? rs.getString(1) : null;
        c.commit();
        // format_type 'timestamp with time zone' verir -> kisalt
        if (v == null) { return null; }
        if (v.startsWith("timestamp with")) { return "timestamptz"; }
        if (v.equals("bigint")) { return "int8"; }
        if (v.equals("double precision")) { return "float8"; }
        return v;
      }
    }
  }

  static int countChar(String s, char ch)
  {
    int n = 0;
    for (int i = 0; i < s.length(); i++) { if (s.charAt(i) == ch) { n++; } }
    return n;
  }
}
