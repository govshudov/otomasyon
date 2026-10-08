/*
 * timescaledb eklentisi KURULU DEGILKEN surucu ne yapiyor?
 *
 * Beklenen: tablolar duz PostgreSQL tablosu olarak olusur, veri yazilir;
 * yalnizca hypertable / sikistirma / saklama devre disi kalir.
 *
 * Bu testin calisabilmesi icin sandbox'ta create_hypertable stub'i
 * BULUNMAMALIDIR (test bunu kendisi dogrular).
 */

import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;
import com.akyllyoy.timescale.db.TsSchema;
import com.akyllyoy.timescale.db.TsWideTable;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

public class TsNoExtensionTest
{
  static int passed = 0, failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  public static void main(String[] args) throws Exception
  {
    TsConfig cfg = new TsConfig("127.0.0.1", 5432, "scada", "nx",
      "niagara_rw", "Ts_Test_2026!", "disable", 10, 30, "TsNoExtensionTest");
    TsConnection c = new TsConnection(cfg, "test");
    c.open();

    System.out.println("0) On kosul: eklenti GERCEKTEN yok");
    check("timescaledb eklentisi yok", c.pingAndGetTimescaleVersion() == null, "");
    check("create_hypertable fonksiyonu yok",
      scalar(c, "SELECT count(*) FROM pg_proc WHERE proname='create_hypertable'") == 0, "");

    // temiz baslangic
    try (Statement st = c.raw().createStatement())
    {
      st.execute("DROP SCHEMA IF EXISTS nx CASCADE");
    }
    c.commit();

    System.out.println("1) Create Schema - eklenti yokken");
    List<String> notHyper = new ArrayList<>();
    TsSchema.ensureSchema(c, "nx", notHyper);
    check("ensureSchema ISTISNA FIRLATMADI", true, "");

    String[] missing = TsSchema.findMissingTables(c, "nx");
    check("TUM TABLOLAR OLUSTU", missing.length == 0,
      "eksik=" + java.util.Arrays.toString(missing));
    check("hypertable yapilamayanlar bildirildi", notHyper.size() == 5,
      "" + notHyper);

    System.out.println("2) Tablolara veri yazilabiliyor mu");
    long pid;
    try (PreparedStatement ps = c.raw().prepareStatement(
      "INSERT INTO nx.point (station, history_id, name, value_type) "
    + "VALUES ('BKZ','/K/T1','T1','NUMERIC') RETURNING point_id"))
    {
      try (ResultSet rs = ps.executeQuery()) { rs.next(); pid = rs.getLong(1); }
    }
    c.commit();
    check("point satiri yazildi", pid > 0, "point_id=" + pid);

    long now = System.currentTimeMillis();
    try (PreparedStatement ps = c.raw().prepareStatement(
      "INSERT INTO nx.hist_numeric (time, point_id, value, status, trend_flags, src) "
    + "VALUES (?,?,?,0,0,0)"))
    {
      for (int i = 0; i < 100; i++)
      {
        ps.setTimestamp(1, new Timestamp(now + i * 1000L),
          Calendar.getInstance(TimeZone.getTimeZone("UTC")));
        ps.setLong(2, pid);
        ps.setDouble(3, 20.0 + i);
        ps.addBatch();
      }
      ps.executeBatch();
    }
    c.commit();
    check("100 trend kaydi yazildi",
      scalar(c, "SELECT count(*) FROM nx.hist_numeric") == 100, "");

    check("ON CONFLICT hala calisiyor (unique index duz tabloda da var)",
      dupBlocked(c, pid, now), "");

    System.out.println("3) Genis tablo (TableWriter) - eklenti yokken");
    String[] cols = new String[16];
    for (int i = 0; i < 16; i++) { cols[i] = "in" + (i + 1); }

    try (Statement st = c.raw().createStatement())
    {
      for (String sql : TsWideTable.buildCoreDdl("nx", "wide", cols)) { st.execute(sql); }
    }
    c.commit();
    check("ZORUNLU DDL eklentisiz gecti", tableExists(c, "nx", "wide"), "");

    // hypertable ayri islemde: patlamali ama tabloyu OLDURMEMELI
    boolean hyperFailed = false;
    try (Statement st = c.raw().createStatement())
    {
      st.execute(TsWideTable.buildHypertableDdl("nx", "wide"));
      c.commit();
    }
    catch (SQLException e) { hyperFailed = true; c.rollbackQuietly(); }

    check("hypertable cagrisi basarisiz (beklenen)", hyperFailed, "");
    check("TABLO HALA AYAKTA", tableExists(c, "nx", "wide"), "");

    try (PreparedStatement ps = c.raw().prepareStatement(
      TsWideTable.buildInsertSql("nx", "wide", cols)))
    {
      ps.setTimestamp(1, new Timestamp(now), Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      ps.setLong(2, 1L);
      ps.setString(3, "Kazan");
      for (int i = 0; i < 16; i++) { ps.setDouble(4 + i, i); }
      check("duz tabloya satir yazildi", ps.executeUpdate() == 1, "");
    }
    c.commit();

    try (Statement st = c.raw().createStatement()) { st.execute("DROP SCHEMA IF EXISTS nx CASCADE"); }
    c.commit();
    c.close();

    System.out.println();
    System.out.println("SONUC: " + passed + " gecti, " + failed + " kaldi");
    if (failed > 0) { System.exit(1); }
  }

  static boolean dupBlocked(TsConnection c, long pid, long now) throws Exception
  {
    try (PreparedStatement ps = c.raw().prepareStatement(
      "INSERT INTO nx.hist_numeric (time, point_id, value, status, trend_flags, src) "
    + "VALUES (?,?,?,0,0,0) ON CONFLICT (point_id, time) DO NOTHING"))
    {
      ps.setTimestamp(1, new Timestamp(now), Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      ps.setLong(2, pid);
      ps.setDouble(3, 999.0);
      int n = ps.executeUpdate();
      c.commit();
      return n == 0 && scalar(c, "SELECT count(*) FROM nx.hist_numeric") == 100;
    }
  }

  static boolean tableExists(TsConnection c, String schema, String table) throws Exception
  {
    try (PreparedStatement ps = c.raw().prepareStatement(
      "SELECT 1 FROM information_schema.tables WHERE table_schema=? AND table_name=?"))
    {
      ps.setString(1, schema);
      ps.setString(2, table);
      try (ResultSet rs = ps.executeQuery()) { boolean f = rs.next(); c.commit(); return f; }
    }
  }

  static long scalar(TsConnection c, String sql) throws Exception
  {
    try (Statement st = c.raw().createStatement(); ResultSet rs = st.executeQuery(sql))
    {
      rs.next();
      long v = rs.getLong(1);
      c.commit();
      return v;
    }
  }
}
