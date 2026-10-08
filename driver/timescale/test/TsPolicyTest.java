/*
 * TsPolicy: sikistirma + saklama politikasi uretimi.
 *
 * Asil sinav: politika ZATEN VARKEN sure degistirilebiliyor mu?
 * TimescaleDB'nin add_*_policy(..., if_not_exists => TRUE) cagrisi bu
 * durumda hicbir sey yapmaz; bu yuzden once remove_*_policy cagrilmali.
 */

import com.akyllyoy.timescale.db.TsPolicy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

public class TsPolicyTest
{
  static int passed = 0, failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  public static void main(String[] args) throws Exception
  {
    System.out.println("1) Genis tablo politikasi (segmentby = id)");
    String[][] w = TsPolicy.build("niagara", "ts_data", "id", 1, 10);
    check("3 grup", w.length == 3, "len=" + w.length);
    check("segmentby id", w[0][0].contains("compress_segmentby = 'id'"), w[0][0]);
    check("once kaldirir", w[1][0].contains("remove_compression_policy"), w[1][0]);
    check("if_not_exists yok", !w[1][1].contains("if_not_exists"), w[1][1]);

    System.out.println("2) History tablolari (segmentby = point_id)");
    String[][] h = TsPolicy.buildAll("niagara", 1, 5);
    check("4 tablo x 3 grup = 12", h.length == 12, "len=" + h.length);

    String all = String.join("\n", flatten(h));
    for (String t : TsPolicy.HIST_TABLES)
    {
      check("kapsiyor: " + t, all.contains("niagara." + t), "");
    }
    check("history'de segmentby point_id", h[0][0].contains("compress_segmentby = 'point_id'"),
      h[0][0]);
    check("saklama 5 yil", all.contains("INTERVAL '5 years'"), "");
    check("sikistirma 1 gun", all.contains("INTERVAL '1 days'"), "");
    check("her tablo icin remove+add",
      count(all, "remove_retention_policy") == 4 && count(all, "add_retention_policy") == 4,
      "remove=" + count(all, "remove_retention_policy"));

    System.out.println("3) Kimlik dogrulama");
    check("kotu sema reddedilir", rejects("nia; DROP TABLE x", "t", "id"), "");
    check("kotu tablo reddedilir", rejects("niagara", "t; DROP TABLE x", "id"), "");
    check("kotu segmentby reddedilir", rejects("niagara", "t", "id; DROP TABLE x"), "");

    System.out.println("4) GERCEK PostgreSQL: politika GUNCELLENEBILIYOR mu");
    Connection c = DriverManager.getConnection(
      "jdbc:postgresql://127.0.0.1:5432/scada", "niagara_rw", "Ts_Test_2026!");
    c.setAutoCommit(false);

    exec(c, "DROP TABLE IF EXISTS niagara.polt");
    exec(c, "CREATE TABLE niagara.polt (time TIMESTAMPTZ NOT NULL, point_id BIGINT, value DOUBLE PRECISION)");
    c.commit();

    // ilk uygulama (10 yil)
    int fail1 = apply(c, TsPolicy.build("niagara", "polt", "point_id", 1, 10));
    // ikinci uygulama, FARKLI sure (5 yil) -- eskisi kaldirildigi icin gecmeli
    int fail2 = apply(c, TsPolicy.build("niagara", "polt", "point_id", 7, 5));

    // Sandbox'ta timescaledb yok: yalnizca grup 1 (compress reloption) basarisiz olmali.
    check("ilk uygulama: sadece compress ayari reddedildi", fail1 == 1, "hata=" + fail1 + "/3");
    check("SURE DEGISTIRILEBILDI (remove+add calisti)", fail2 == 1, "hata=" + fail2 + "/3");

    // 12 grubun tamami hist_* tablolarina uygulanabiliyor mu
    int failAll = apply(c, TsPolicy.buildAll("niagara", 1, 5));
    check("history tablolarina uygulandi (4 compress ayari haric)", failAll == 4,
      "hata=" + failAll + "/12");

    exec(c, "DROP TABLE IF EXISTS niagara.polt");
    c.commit();
    c.close();

    System.out.println();
    System.out.println("SONUC: " + passed + " gecti, " + failed + " kaldi");
    if (failed > 0) { System.exit(1); }
  }

  static int apply(Connection c, String[][] groups) throws SQLException
  {
    int fails = 0;
    for (String[] g : groups)
    {
      try { for (String sql : g) { exec(c, sql); } c.commit(); }
      catch (SQLException e) { fails++; c.rollback(); }
    }
    return fails;
  }

  static void exec(Connection c, String sql) throws SQLException
  {
    try (Statement st = c.createStatement()) { st.execute(sql); }
  }

  static boolean rejects(String s, String t, String seg)
  {
    try { TsPolicy.build(s, t, seg, 1, 1); return false; }
    catch (Exception e) { return true; }
  }

  static java.util.List<String> flatten(String[][] g)
  {
    java.util.List<String> out = new java.util.ArrayList<>();
    for (String[] a : g) { for (String s : a) { out.add(s); } }
    return out;
  }

  static int count(String hay, String needle)
  {
    int n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length(); }
    return n;
  }
}
