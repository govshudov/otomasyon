/*
 * Niagara'dan bagimsiz entegrasyon testi.
 * db paketini gercek bir PostgreSQL'e karsi calistirir.
 */

import com.akyllyoy.timescale.db.*;

import java.sql.ResultSet;
import java.sql.Statement;

public class TsIntegrationTest
{
  static int passed = 0;
  static int failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  static long count(TsConnection c, String sql) throws Exception
  {
    try (Statement st = c.raw().createStatement(); ResultSet rs = st.executeQuery(sql))
    {
      rs.next();
      long n = rs.getLong(1);
      c.commit();
      return n;
    }
  }

  public static void main(String[] args) throws Exception
  {
    TsConfig cfg = new TsConfig("127.0.0.1", 5432, "scada", "niagara",
      "niagara_rw", "Ts_Test_2026!", "disable", 10, 30, "TsIntegrationTest");

    System.out.println("1) Baglanti ve ping");
    TsConnection c = new TsConnection(cfg, "test");
    c.open();
    check("open()", c.isOpen(), cfg.jdbcUrl());
    String ver = c.pingAndGetTimescaleVersion();
    check("ping calisti (timescaledb yok -> null bekleniyor)", ver == null, "ver=" + ver);

    System.out.println("2) Sema");
    TsSchema.ensureSchema(c, "niagara");
    String[] missing = TsSchema.findMissingTables(c, "niagara");
    check("ensureSchema + tum tablolar var", missing.length == 0,
      "eksik=" + java.util.Arrays.toString(missing));
    TsSchema.ensureSchema(c, "niagara");
    check("ensureSchema idempotent (ikinci kez)", true, "");

    try { TsSchema.validateIdentifier("niagara; DROP TABLE x"); check("SQL injection engellendi", false, "gecti!"); }
    catch (IllegalArgumentException e) { check("SQL injection engellendi", true, ""); }

    System.out.println("3) Point kayit defteri");
    TsPointRegistry reg = new TsPointRegistry("niagara");
    TsPointMeta m = new TsPointMeta();
    m.station = "Supervisor";
    m.historyId = "/Supervisor/FM_012_Flow";
    m.name = "FM_012_Flow";
    m.displayName = "Debimetre 12 Debi";
    m.valueType = TsValueType.NUMERIC;
    m.unit = "m3/h";
    m.device = "FM_012";
    m.site = "Bolge_A";
    m.intervalMs = 900000;
    m.tagsJson = "{\"flow\":true,\"sensor\":true}";
    m.facetsJson = "{\"units\":\"m3/h\",\"precision\":2}";
    long id1 = reg.resolve(c, m);
    long id2 = reg.resolve(c, m);
    check("resolve() kimlik uretti", id1 > 0, "point_id=" + id1);
    check("onbellekten ayni kimlik", id1 == id2, "");
    reg.invalidate();
    long id3 = reg.resolve(c, m);
    check("onbellek temizlense de ayni kimlik (upsert idempotent)", id1 == id3, "");

    TsPointMeta m2 = new TsPointMeta();
    m2.station = "Supervisor";
    m2.historyId = "/Supervisor/FM_012_Status";
    m2.name = "FM_012_Status";
    m2.valueType = TsValueType.BOOLEAN;
    long idB = reg.resolve(c, m2);
    check("ikinci point farkli kimlik", idB != id1, "point_id=" + idB);

    System.out.println("4) Toplu yazma");
    int n = 50000;
    long t0 = System.currentTimeMillis();
    TsWriteQueue q = new TsWriteQueue(cfg, "niagara", 200000, 5000, 1000,
      TsWriteQueue.OverflowPolicy.DROP_OLDEST, true, "test");
    q.start();
    long base = 1_700_000_000_000L;
    for (int i = 0; i < n; i++)
    {
      q.offer(TsSample.numeric(id1, base + i * 1000L, Math.sin(i / 100.0) * 42.0,
        0, (short)0, TsSample.SRC_HISTORY));
    }
    for (int i = 0; i < 1000; i++)
    {
      q.offer(TsSample.bool(idB, base + i * 1000L, i % 2 == 0, 0, (short)0, TsSample.SRC_COV));
    }
    // bosalmasini bekle
    for (int i = 0; i < 120 && q.queueDepth() > 0; i++) { Thread.sleep(500); }
    Thread.sleep(2000);
    long ms = System.currentTimeMillis() - t0;

    long numRows = count(c, "SELECT count(*) FROM niagara.hist_numeric");
    long boolRows = count(c, "SELECT count(*) FROM niagara.hist_boolean");
    check("numeric satirlari yazildi", numRows == n, numRows + "/" + n
      + "  " + ms + " ms  ~" + (n * 1000L / Math.max(1, ms)) + " satir/sn");
    check("boolean satirlari yazildi", boolRows == 1000, boolRows + "/1000");
    check("dusen satir yok", q.rowsDropped() == 0, "dropped=" + q.rowsDropped());
    check("yazici hatasiz", q.lastError() == null, String.valueOf(q.lastError()));

    long live = count(c, "SELECT count(*) FROM niagara.point_live");
    check("point_live guncellendi", live == 2, "satir=" + live);

    System.out.println("5) Idempotentlik (ayni veriyi tekrar yaz)");
    for (int i = 0; i < n; i++)
    {
      q.offer(TsSample.numeric(id1, base + i * 1000L, 999.0, 0, (short)0, TsSample.SRC_HISTORY));
    }
    for (int i = 0; i < 120 && q.queueDepth() > 0; i++) { Thread.sleep(500); }
    Thread.sleep(2000);
    long numRows2 = count(c, "SELECT count(*) FROM niagara.hist_numeric");
    check("ON CONFLICT DO NOTHING - satir cogalmadi", numRows2 == n, numRows2 + "/" + n);

    try (Statement st = c.raw().createStatement();
         ResultSet rs = st.executeQuery(
           "SELECT value FROM niagara.hist_numeric WHERE point_id=" + id1
             + " ORDER BY time LIMIT 1"))
    {
      rs.next();
      double v = rs.getDouble(1);
      c.commit();
      check("ilk deger korundu (999 ile ezilmedi)", Math.abs(v - 0.0) < 1e-9, "value=" + v);
    }

    System.out.println("6) NaN / null degerler");
    q.offer(TsSample.numeric(id1, base - 5000L, Double.NaN, 1, (short)0, TsSample.SRC_MANUAL));
    q.offer(TsSample.numeric(id1, base - 4000L, Double.POSITIVE_INFINITY, 1, (short)0, TsSample.SRC_MANUAL));
    Thread.sleep(3000);
    long nulls = count(c, "SELECT count(*) FROM niagara.hist_numeric WHERE value IS NULL");
    check("NaN/Infinity -> NULL olarak yazildi", nulls == 2, "null satir=" + nulls);

    System.out.println("7) Kuyruk tasmasi (kucuk kapasite)");
    TsWriteQueue small = new TsWriteQueue(cfg, "niagara", 1000, 500, 60000,
      TsWriteQueue.OverflowPolicy.DROP_OLDEST, false, "small");
    // start() cagrilmadan offer -> hepsi dusmeli
    int accepted = 0;
    for (int i = 0; i < 100; i++) { if (small.offer(TsSample.numeric(id1, i, 1.0, 0, (short)0, (short)0))) accepted++; }
    check("durdurulmus kuyruk kabul etmiyor", accepted == 0, "kabul=" + accepted);

    System.out.println("8) View'ler");
    try (Statement st = c.raw().createStatement())
    {
      st.execute("CREATE OR REPLACE VIEW niagara.v_numeric AS "
        + "SELECT h.time, h.value, h.status, p.point_id, p.station, p.name, "
        + "p.display_name, p.path, p.unit, p.device, p.site, p.tags "
        + "FROM niagara.hist_numeric h JOIN niagara.point p USING (point_id)");
      st.execute("CREATE OR REPLACE VIEW niagara.v_export_health AS "
        + "SELECT p.point_id, p.station, p.name, p.path, p.interval_ms, "
        + "e.last_time, e.last_run, e.last_status, e.rows_total, "
        + "now() - e.last_time AS lag, "
        + "CASE WHEN e.last_time IS NULL THEN 'never' "
        + "WHEN p.interval_ms IS NULL THEN 'unknown' "
        + "WHEN now() - e.last_time > make_interval(secs => (p.interval_ms / 1000.0) * 3) "
        + "THEN 'stale' ELSE 'ok' END AS health "
        + "FROM niagara.point p LEFT JOIN niagara.export_state e USING (point_id) "
        + "WHERE p.enabled");
      c.commit();
    }
    long health = count(c, "SELECT count(*) FROM niagara.v_export_health");
    check("v_export_health view'i calisiyor", health == 2, "satir=" + health);
    long vNum = count(c, "SELECT count(*) FROM niagara.v_numeric");
    check("v_numeric view'i calisiyor", vNum > 0, "satir=" + vNum);
    try (Statement st = c.raw().createStatement();
         ResultSet rs = st.executeQuery(
           "SELECT name, unit, device, site, tags->>'flow' FROM niagara.v_numeric LIMIT 1"))
    {
      rs.next();
      check("metadata join dogru", "FM_012".equals(rs.getString(3))
        && "m3/h".equals(rs.getString(2)) && "true".equals(rs.getString(5)),
        rs.getString(1) + " / " + rs.getString(2) + " / " + rs.getString(3)
          + " / " + rs.getString(4));
      c.commit();
    }

    System.out.println("9) Yeniden baglanma");
    c.raw().close();
    check("kapali baglanti algilandi", !c.isOpen(), "");
    c.ensureOpen();
    check("ensureOpen() yeniden bagladi", c.isOpen(), "");

    q.stop();
    small.stop();
    c.close();

    System.out.println();
    System.out.println("=== SONUC: " + passed + " gecti, " + failed + " kaldi ===");
    if (failed > 0) { System.exit(1); }
  }
}
