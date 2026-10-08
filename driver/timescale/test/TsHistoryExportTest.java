/*
 * History export motorunun Niagara'dan bagimsiz parcalarini dogrular:
 *   - TsExportState  (watermark: oku / ilerlet / hata / sifirla)
 *   - TsHistoryFilter (include/exclude desen eslestirme)
 *
 * TsExportState testleri GERCEK PostgreSQL'e karsi calisir.
 */

import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;
import com.akyllyoy.timescale.db.TsExportState;
import com.akyllyoy.timescale.db.TsHistoryFilter;
import com.akyllyoy.timescale.db.TsPointMeta;
import com.akyllyoy.timescale.db.TsPointRegistry;
import com.akyllyoy.timescale.db.TsSchema;
import com.akyllyoy.timescale.db.TsValueType;

import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;

public class TsHistoryExportTest
{
  static int passed = 0;
  static int failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  static String str(TsConnection c, String sql) throws Exception
  {
    try (Statement st = c.raw().createStatement(); ResultSet rs = st.executeQuery(sql))
    {
      String v = rs.next() ? rs.getString(1) : null;
      c.commit();
      return v;
    }
  }

  static long num(TsConnection c, String sql) throws Exception
  {
    try (Statement st = c.raw().createStatement(); ResultSet rs = st.executeQuery(sql))
    {
      long v = rs.next() ? rs.getLong(1) : -1L;
      c.commit();
      return v;
    }
  }

  public static void main(String[] args) throws Exception
  {
    ///////////////////////////////////////////////////////////
    System.out.println("1) TsHistoryFilter - joker eslestirme");
    ///////////////////////////////////////////////////////////

    TsHistoryFilter all = new TsHistoryFilter("*", "");
    check("'*' hepsini alir", all.accept("/Kazan/FM_012_Flow"), "");
    check("'*' bos ada bile ok", all.accept("/x/y"), "");

    TsHistoryFilter empty = new TsHistoryFilter("", "");
    check("bos include = hepsi", empty.accept("/Kazan/FM_012"), "");

    TsHistoryFilter dev = new TsHistoryFilter("/kazan/*", "");
    check("cihaz oneki eslesir", dev.accept("/Kazan/FM_012_Flow"), "");
    check("baska cihaz elenir", !dev.accept("/Chiller/T1"), "");

    TsHistoryFilter multi = new TsHistoryFilter("*flow*,*temp*", "");
    check("coklu desen: flow", multi.accept("/Kazan/FM_012_Flow"), "");
    check("coklu desen: temp", multi.accept("/Kazan/Outside_Temp"), "");
    check("eslesmeyen elenir", !multi.accept("/Kazan/Pressure"), "");

    TsHistoryFilter ex = new TsHistoryFilter("*", "*test*,*deneme*");
    check("exclude uygulanir", !ex.accept("/Kazan/Test_Point"), "");
    check("exclude disi gecer", ex.accept("/Kazan/FM_012"), "");

    TsHistoryFilter both = new TsHistoryFilter("/kazan/*", "*test*");
    check("exclude include'a baskin", !both.accept("/Kazan/Test_1"), "");
    check("include+exclude birlikte", both.accept("/Kazan/Real_1"), "");

    check("buyuk/kucuk harf duyarsiz",
      new TsHistoryFilter("*FLOW*", "").accept("/kazan/fm_flow"), "");
    check("null guvenli", !all.accept(null), "");

    // Regex ozel karakterleri patlatmamali
    TsHistoryFilter paren = new TsHistoryFilter("*(1)*", "");
    check("parantez regex olarak yorumlanmaz", paren.accept("/Kazan/Pump(1)"), "");
    check("parantez eslesmeyeni eler", !paren.accept("/Kazan/Pump2"), "");

    // Yildiz geri izleme (backtracking) dogru mu?
    check("cok yildiz: a*b*c", new TsHistoryFilter("a*b*c", "").accept("axxbyyc"), "");
    check("cok yildiz eslesmeyen", !new TsHistoryFilter("a*b*c", "").accept("axxbyy"), "");
    check("sondaki yildiz", new TsHistoryFilter("/a/*", "").accept("/a/"), "");

    ///////////////////////////////////////////////////////////
    System.out.println("2) TsExportState - watermark (gercek PostgreSQL)");
    ///////////////////////////////////////////////////////////

    TsConfig cfg = new TsConfig("127.0.0.1", 5432, "scada", "niagara",
      "niagara_rw", "Ts_Test_2026!", "disable", 10, 30, "TsHistoryExportTest");
    TsConnection c = new TsConnection(cfg, "test");
    c.open();
    TsSchema.ensureSchema(c, "niagara");

    // temiz baslangic
    try (Statement st = c.raw().createStatement())
    {
      st.execute("TRUNCATE niagara.export_state, niagara.hist_numeric, "
        + "niagara.point_live CASCADE");
      st.execute("TRUNCATE niagara.point CASCADE");
    }
    c.commit();

    TsPointRegistry reg = new TsPointRegistry("niagara");
    TsPointMeta m = new TsPointMeta();
    m.station = "BKZ";
    m.historyId = "/Kazan/FM_012_Flow";
    m.name = "FM_012_Flow";
    m.valueType = TsValueType.NUMERIC;
    long pid = reg.resolve(c, m);

    TsPointMeta m2 = new TsPointMeta();
    m2.station = "BKZ";
    m2.historyId = "/Kazan/T_Out";
    m2.name = "T_Out";
    m2.valueType = TsValueType.NUMERIC;
    long pid2 = reg.resolve(c, m2);

    TsExportState state = new TsExportState("niagara");

    // --- ilk calisma: watermark yok ---
    check("ilk calismada watermark yok", state.load(c, pid) == null, "");
    check("loadAll bos", state.loadAll(c).isEmpty(), "");

    // --- ilk tur ---
    long t1 = 1_700_000_000_000L;
    state.markSuccess(c, pid, t1, 1000);
    Long wm = state.load(c, pid);
    check("watermark yazildi", wm != null && wm.longValue() == t1, "wm=" + wm);
    check("rows_total = 1000",
      num(c, "SELECT rows_total FROM niagara.export_state WHERE point_id=" + pid) == 1000, "");
    check("last_status = ok",
      "ok".equals(str(c, "SELECT last_status FROM niagara.export_state WHERE point_id=" + pid)), "");

    // --- ikinci tur: ilerlet ---
    long t2 = t1 + 3_600_000L;
    state.markSuccess(c, pid, t2, 500);
    check("watermark ilerledi", state.load(c, pid).longValue() == t2, "");
    check("rows_total birikti (1500)",
      num(c, "SELECT rows_total FROM niagara.export_state WHERE point_id=" + pid) == 1500, "");

    // --- GERI GITMEMELI ---
    state.markSuccess(c, pid, t1, 10);
    check("watermark GERI GITMEZ (GREATEST)", state.load(c, pid).longValue() == t2,
      "wm=" + state.load(c, pid));

    // --- hata: watermark korunmali ---
    state.markFailure(c, pid, "baglanti koptu");
    check("hata sonrasi watermark KORUNDU", state.load(c, pid).longValue() == t2, "");
    check("last_status = fault",
      "fault".equals(str(c, "SELECT last_status FROM niagara.export_state WHERE point_id=" + pid)), "");
    check("last_fault yazildi",
      "baglanti koptu".equals(str(c,
        "SELECT last_fault FROM niagara.export_state WHERE point_id=" + pid)), "");

    // --- hata sonrasi basari: fault temizlenmeli ---
    state.markSuccess(c, pid, t2 + 1000L, 5);
    check("basari fault'u temizler",
      str(c, "SELECT last_fault FROM niagara.export_state WHERE point_id=" + pid) == null, "");

    // --- cok uzun hata metni kirpilmali ---
    StringBuilder big = new StringBuilder();
    for (int i = 0; i < 100; i++) { big.append("uzun hata metni "); }
    state.markFailure(c, pid2, big.toString());
    String stored = str(c, "SELECT last_fault FROM niagara.export_state WHERE point_id=" + pid2);
    check("uzun hata kirpildi", stored != null && stored.length() <= 500, "len=" +
      (stored == null ? -1 : stored.length()));

    // --- hicbir aktarim yapmamis point loadAll'da cikmamali ---
    Map<Long, Long> allWm = state.loadAll(c);
    check("loadAll yalnizca aktarilmis point'leri verir",
      allWm.containsKey(Long.valueOf(pid)) && !allWm.containsKey(Long.valueOf(pid2)),
      "boyut=" + allWm.size());
    check("loadAll degeri dogru", allWm.get(Long.valueOf(pid)).longValue() == t2 + 1000L, "");

    // --- station yeniden basladi: yeni nesne ayni watermark'i gormeli ---
    TsExportState fresh = new TsExportState("niagara");
    check("YENIDEN BASLATMA: watermark kalici",
      fresh.load(c, pid).longValue() == t2 + 1000L, "");

    // --- sifirlama ---
    int n = state.resetAll(c);
    check("resetAll satir sayisi", n >= 1, "n=" + n);
    check("sifirlama sonrasi watermark yok", state.load(c, pid) == null, "");
    check("sifirlama sonrasi loadAll bos", state.loadAll(c).isEmpty(), "");
    // 1000 + 500 + 10 (geri giden tur; kayitlar yine yazildi) + 5 = 1515
    check("rows_total korundu (gecmis kayit)",
      num(c, "SELECT rows_total FROM niagara.export_state WHERE point_id=" + pid) == 1515,
      "gelen=" + num(c, "SELECT rows_total FROM niagara.export_state WHERE point_id=" + pid));

    // --- tekil sifirlama ---
    state.markSuccess(c, pid, t2, 1);
    state.markSuccess(c, pid2, t2, 1);
    state.reset(c, pid);
    check("tekil reset yalnizca hedefi sifirlar",
      state.load(c, pid) == null && state.load(c, pid2) != null, "");

    ///////////////////////////////////////////////////////////
    System.out.println("3) Zaman damgasi UTC dayanikliligi");
    ///////////////////////////////////////////////////////////

    java.util.TimeZone savedTz = java.util.TimeZone.getDefault();
    try
    {
      java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Asia/Ashgabat")); // UTC+5
      TsExportState tz = new TsExportState("niagara");
      long tt = 1_750_000_000_000L;
      tz.markSuccess(c, pid, tt, 1);
      check("UTC+5'te yazilan watermark ayni millis olarak okunur",
        tz.load(c, pid).longValue() == tt, "gelen=" + tz.load(c, pid));

      java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
      TsExportState tz2 = new TsExportState("niagara");
      check("UTC'de okundugunda da ayni", tz2.load(c, pid).longValue() == tt,
        "gelen=" + tz2.load(c, pid));
    }
    finally { java.util.TimeZone.setDefault(savedTz); }

    c.close();

    System.out.println();
    System.out.println("SONUC: " + passed + " gecti, " + failed + " kaldi");
    if (failed > 0) { System.exit(1); }
  }
}
