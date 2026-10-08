/*
 * 1.7: history export'un satirlari ve watermark'i AYNI islemde yazmasi.
 *
 * Gercek bir PostgreSQL (timescaledb'li ya da degil) ister. Ayri bir test
 * veritabaninda calisin; tablolari kendisi olusturur, verisini siler:
 *
 *   createdb ts_test
 *   set TS_TEST_DB=ts_test   (varsayilan)   TS_TEST_USER=postgres (varsayilan)
 *   set PGPASSWORD=...       (sifre ortamdan; koda yazilmaz)
 *   java -cp build/test;build/classes;lib/postgresql-42.7.2.jar;... TsExportTxTest
 *
 * Dogrulananlar:
 *   1. parti + watermark birlikte commit edilir
 *   2. commit'ten once hata -> ikisi birden geri alinir (watermark ilerlemez)
 *   3. ayni parti tekrar yazilirsa cogalmaz (ON CONFLICT)
 *   4. watermark geri gitmez (GREATEST), commit'li eski imza da calisir
 *   5. kuyruk (TsWriteQueue) ortak yaziciyla ayni satirlari yazar
 *   6. ilk parti yazilip ikincide hata -> ilki kalici, watermark ilkinin sonunda
 */

import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;
import com.akyllyoy.timescale.db.TsExportState;
import com.akyllyoy.timescale.db.TsRowWriter;
import com.akyllyoy.timescale.db.TsSample;
import com.akyllyoy.timescale.db.TsSchema;
import com.akyllyoy.timescale.db.TsWriteQueue;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

public class TsExportTxTest
{
  static int ok, fail;

  static void check(String name, boolean cond, String detail)
  {
    if (cond) { ok++; System.out.println("  ok   " + name); }
    else { fail++; System.out.println("  FAIL " + name + " -> " + detail); }
  }

  static String env(String k, String d) { String v = System.getenv(k); return v == null || v.isEmpty() ? d : v; }

  static long count(TsConnection c, long pid) throws Exception
  {
    try (PreparedStatement ps = c.raw().prepareStatement("SELECT count(*) FROM niagara.hist_numeric WHERE point_id = ?"))
    {
      ps.setLong(1, pid);
      try (ResultSet rs = ps.executeQuery()) { rs.next(); long n = rs.getLong(1); c.commit(); return n; }
    }
  }

  static List<TsSample> samples(long pid, long t0, int n)
  {
    List<TsSample> l = new ArrayList<>();
    for (int i = 0; i < n; i++) { l.add(TsSample.numeric(pid, t0 + i * 1000L, i, 0, (short) 0, TsSample.SRC_HISTORY)); }
    return l;
  }

  public static void main(String[] args) throws Exception
  {
    TsConfig cfg = new TsConfig("127.0.0.1", 5432, env("TS_TEST_DB", "ts_test"), "niagara",
      env("TS_TEST_USER", "postgres"), env("PGPASSWORD", ""), "disable", 10, 30, "TsExportTxTest");
    TsExportState state = new TsExportState("niagara");

    try (TsConnection c = new TsConnection(cfg, "tx"))
    {
      c.open();
      TsSchema.ensureSchema(c, "niagara", new ArrayList<>());
      try (Statement st = c.raw().createStatement())
      {
        st.execute("TRUNCATE niagara.export_state, niagara.hist_numeric, niagara.point_live CASCADE");
        st.execute("DELETE FROM niagara.point WHERE station = 'TX_TEST'");
      }
      c.commit();

      long pid;
      try (PreparedStatement ps = c.raw().prepareStatement(
        "INSERT INTO niagara.point (station, history_id, name, value_type) VALUES ('TX_TEST', '/TX/p1', 'p1', 'numeric') RETURNING point_id");
           ResultSet rs = ps.executeQuery())
      {
        rs.next(); pid = rs.getLong(1);
      }
      c.commit();

      long t0 = 1_700_000_000_000L;

      // 1) parti + watermark birlikte
      List<TsSample> a = samples(pid, t0, 5);
      TsRowWriter.write(c, "niagara", a, true);
      state.markSuccess(c, pid, t0 + 4000L, a.size(), false);
      c.commit();
      check("1 parti yazildi", count(c, pid) == 5, "satir " + count(c, pid));
      check("1 watermark ilerledi", Long.valueOf(t0 + 4000L).equals(state.load(c, pid)), "wm " + state.load(c, pid));

      // 2) commit'ten once hata -> hicbiri kalici degil
      List<TsSample> b = samples(pid, t0 + 5000L, 5);
      try
      {
        TsRowWriter.write(c, "niagara", b, true);
        state.markSuccess(c, pid, t0 + 9000L, b.size(), false);
        try (Statement st = c.raw().createStatement()) { st.execute("SELECT 1/0"); }
        c.commit();
        check("2 hata firlatilmali", false, "hata yok");
      }
      catch (java.sql.SQLException e)
      {
        c.rollbackQuietly();
      }
      check("2 satirlar geri alindi", count(c, pid) == 5, "satir " + count(c, pid));
      check("2 watermark yerinde", Long.valueOf(t0 + 4000L).equals(state.load(c, pid)), "wm " + state.load(c, pid));

      // 3) ayni parti tekrar -> cogalmaz
      TsRowWriter.write(c, "niagara", a, false);
      state.markSuccess(c, pid, t0 + 4000L, 0, false);
      c.commit();
      check("3 cogalma yok", count(c, pid) == 5, "satir " + count(c, pid));

      // 4) watermark geri gitmez; eski (commit'li) imza
      state.markSuccess(c, pid, t0, 0);
      check("4 watermark geri gitmedi", Long.valueOf(t0 + 4000L).equals(state.load(c, pid)), "wm " + state.load(c, pid));

      // 6) iki parti: ilki yazilir, ikincide hata
      List<TsSample> p1 = samples(pid, t0 + 10_000L, 3), p2 = samples(pid, t0 + 13_000L, 3);
      TsRowWriter.write(c, "niagara", p1, true);
      state.markSuccess(c, pid, t0 + 12_000L, p1.size(), false);
      c.commit();
      try
      {
        TsRowWriter.write(c, "niagara", p2, true);
        state.markSuccess(c, pid, t0 + 15_000L, p2.size(), false);
        try (Statement st = c.raw().createStatement()) { st.execute("SELECT 1/0"); }
        c.commit();
      }
      catch (java.sql.SQLException e) { c.rollbackQuietly(); }
      check("6 ilk parti kalici", count(c, pid) == 8, "satir " + count(c, pid));
      check("6 watermark ilk partinin sonunda", Long.valueOf(t0 + 12_000L).equals(state.load(c, pid)), "wm " + state.load(c, pid));

      // 5) kuyruk ortak yaziciyla yazar
      TsWriteQueue q = new TsWriteQueue(cfg, "niagara", 1000, 100, 200, TsWriteQueue.OverflowPolicy.DROP_OLDEST, true, "txq");
      q.start();
      for (TsSample s : samples(pid, t0 + 100_000L, 4)) { q.offer(s); }
      for (int i = 0; i < 50 && q.rowsWritten() < 4; i++) { Thread.sleep(100); }
      q.stop();
      check("5 kuyruk yazdi", count(c, pid) == 12, "satir " + count(c, pid) + ", kuyruk hata: " + q.lastError());

      // 7) var olan point'e sonradan gelen birim yazilir (1.7.1), bos alan eskisini ezmez
      com.akyllyoy.timescale.db.TsPointMeta m = new com.akyllyoy.timescale.db.TsPointMeta();
      m.station = "TX_TEST"; m.historyId = "/TX/p1"; m.name = "p1"; m.displayName = "p1"; m.unit = "m³/h";
      long rid = new com.akyllyoy.timescale.db.TsPointRegistry("niagara").resolve(c, m);
      String unit;
      try (PreparedStatement ps = c.raw().prepareStatement("SELECT unit FROM niagara.point WHERE point_id = ?"))
      {
        ps.setLong(1, pid);
        try (ResultSet rs = ps.executeQuery()) { rs.next(); unit = rs.getString(1); }
      }
      c.commit();
      check("7 ayni point_id", rid == pid, rid + " != " + pid);
      check("7 birim guncellendi", "m³/h".equals(unit), "unit " + unit);
      m.unit = null;
      new com.akyllyoy.timescale.db.TsPointRegistry("niagara").resolve(c, m);
      try (PreparedStatement ps = c.raw().prepareStatement("SELECT unit FROM niagara.point WHERE point_id = ?"))
      {
        ps.setLong(1, pid);
        try (ResultSet rs = ps.executeQuery()) { rs.next(); unit = rs.getString(1); }
      }
      c.commit();
      check("7 bos birim eskisini korur", "m³/h".equals(unit), "unit " + unit);

      try (Statement st = c.raw().createStatement())
      {
        st.execute("DELETE FROM niagara.point WHERE station = 'TX_TEST'");
      }
      c.commit();
    }

    System.out.println("SONUC: " + ok + "/" + (ok + fail) + (fail == 0 ? " gecti" : " — " + fail + " FAIL"));
    System.exit(fail == 0 ? 0 : 1);
  }
}
