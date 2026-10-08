  /*
   * TsOkuma — arayüzün geçmiş verisini TimescaleDB'den okuduğu servis (istasyon içinde).
   *
   * Arayüz istasyonun kendi sayfası olduğu için (CSP: yalnız aynı kaynak) veritabanına
   * doğrudan bağlanamaz; BajaScript ile bu programın "sorgu" eylemini çağırır.
   *   parametre: "op=hist&names=A,B&from=<ms>&to=<ms>&n=<kova>"   (ya da op=points)
   *   dönüş    : JSON metni
   * Veritabanı bağlantı bilgisi TimescaleDevice'tan (cihaz özelliği) okunur.
   * İstasyon adı: çalıştığı Niagara istasyonunun adı (sürücü de veriyi bu adla yazar).
   *
   * Çözünürlük aralığa göre seçilir: ≤ 3 gün ham veri, ≤ 120 gün saatlik özet, üstü günlük özet.
   */

  java.sql.Connection conn;
  String url = "", user = "", pass = "";
  long calls = 0;

  public void onStart() throws Throwable {
    readConfig();
    setString("durum", "hazır · " + url);
  }

  public void onStop() throws Throwable { close(); }

  public void onExecute() throws Throwable {
    readConfig();
    try { String r = query("op=points"); setString("durum", "bağlantı OK · " + r.length() + " bayt nokta listesi"); }
    catch (Throwable e) { setString("durum", "HATA: " + e); }
  }

  /** Bağlantı ayarları TimescaleDevice'ın kendi ayar kopyasından (TsConfig).
   *  Parola Program kodundan BPassword ile okunamıyor (yetki yok, boş döner); sürücü onu
   *  kendi yetkisiyle okuyup TsConfig'te tutuyor. Okuma için ayrı bağlantı açılır,
   *  sürücünün yazma bağlantısı bekletilmez. */
  void readConfig() {
    try {
      com.akyllyoy.timescale.BTimescaleDevice dev =
        (com.akyllyoy.timescale.BTimescaleDevice) BOrd.make(getString("cihaz")).get(getComponent());
      com.akyllyoy.timescale.db.TsConfig cfg = dev.withControl((c, r) -> c.config());
      url = "jdbc:postgresql://" + cfg.host + ":" + cfg.port + "/" + cfg.database + "?ApplicationName=Niagara-TsOkuma&connectTimeout=10&socketTimeout=60";
      user = cfg.username;
      pass = cfg.password == null ? "" : cfg.password;
    } catch (Throwable e) {
      setString("durum", "cihaz okunamadı: " + e);
    }
  }

  synchronized java.sql.Connection db() throws Exception {
    if (conn != null) {
      try { if (!conn.isClosed()) return conn; } catch (Exception e) { }
    }
    if (pass.isEmpty()) readConfig();                  // sürücü istasyondan sonra açıldıysa
    java.util.Properties p = new java.util.Properties();
    p.setProperty("user", user);
    p.setProperty("password", pass);
    conn = new org.postgresql.Driver().connect(url, p);
    if (conn == null) throw new Exception("bağlantı kurulamadı: " + url);
    conn.setAutoCommit(true);
    conn.setReadOnly(true);
    return conn;
  }

  synchronized void close() {
    try { if (conn != null) conn.close(); } catch (Exception e) { }
    conn = null;
  }

  /** Eylem: arayüz çağırır. Hata da JSON olarak döner ({"error": …}).
   *  Parametre String olarak gelir; dönüş BValue olmalı (BProgramAction sonucu BValue'ya çevirir). */
  public BString onSorgu(String req) {
    calls++;
    if (req == null) req = "";
    try {
      return BString.make(query(req));
    } catch (Throwable e) {
      close();
      try { return BString.make(query(req)); }          // bağlantı kopmuşsa bir kez daha
      catch (Throwable e2) { return BString.make("{\"error\":" + js(String.valueOf(e2)) + "}"); }
    }
  }

  String query(String req) throws Exception {
    java.util.HashMap<String, String> q = new java.util.HashMap<String, String>();
    for (String kv : req.split("&")) {
      int i = kv.indexOf('=');
      if (i > 0) q.put(kv.substring(0, i), java.net.URLDecoder.decode(kv.substring(i + 1), "UTF-8"));
    }
    String station = q.containsKey("station") ? q.get("station") : Sys.getStation().getStationName();
    String op = q.containsKey("op") ? q.get("op") : "";
    if (op.equals("points")) return points(station);
    if (op.equals("hist")) {
      String[] names = q.containsKey("names") ? q.get("names").split(",") : new String[0];
      long from = Long.parseLong(q.get("from")), to = Long.parseLong(q.get("to"));
      int n = q.containsKey("n") ? Integer.parseInt(q.get("n")) : 300;
      return hist(station, names, from, to, Math.max(10, Math.min(n, 2000)));
    }
    throw new Exception("bilinmeyen op: " + op);
  }

  String points(String station) throws Exception {
    java.sql.PreparedStatement ps = db().prepareStatement(
      "SELECT name, max(label), max(grp), max(unit), max(value_type) FROM niagara.v_point " +
      "WHERE station = ? AND name NOT IN ('AuditHistory', 'LogHistory') GROUP BY name ORDER BY max(grp), min(sort), name");
    try {
      ps.setString(1, station);
      java.sql.ResultSet rs = ps.executeQuery();
      StringBuilder sb = new StringBuilder("{\"station\":").append(js(station)).append(",\"points\":[");
      boolean first = true;
      while (rs.next()) {
        if (!first) sb.append(',');
        first = false;
        sb.append("[").append(js(rs.getString(1))).append(',').append(js(rs.getString(2))).append(',')
          .append(js(rs.getString(3))).append(',').append(js(rs.getString(4))).append(',').append(js(rs.getString(5))).append(']');
      }
      return sb.append("]}").toString();
    } finally { ps.close(); }
  }

  /** Her ad için [epoch_sn, ort, min, maks] kovaları. Sayısal ve açık/kapalı noktalar birlikte. */
  String hist(String station, String[] names, long fromMs, long toMs, int n) throws Exception {
    double spanS = Math.max(1, (toMs - fromMs) / 1000.0);
    String src;
    double minW;
    if (spanS <= 3 * 86400) { src = "raw"; minW = 10; }
    else if (spanS <= 120 * 86400) { src = "1h"; minW = 3600; }
    else { src = "1d"; minW = 86400; }
    double w = Math.max(minW, Math.ceil(spanS / n));
    String num, bool;
    if (src.equals("raw")) {
      num = "SELECT v.name, time_bucket(make_interval(secs => ?), h.time) b, avg(h.value) a, min(h.value) mn, max(h.value) mx " +
            "FROM niagara.hist_numeric h JOIN niagara.v_point v USING (point_id) " +
            "WHERE v.station = ? AND v.name = ANY(?) AND h.time >= ? AND h.time < ? AND h.value = h.value GROUP BY 1, 2";
      bool = "SELECT v.name, time_bucket(make_interval(secs => ?), h.time) b, avg(h.value::int) a, min(h.value::int) mn, max(h.value::int) mx " +
             "FROM niagara.hist_boolean h JOIN niagara.v_point v USING (point_id) " +
             "WHERE v.station = ? AND v.name = ANY(?) AND h.time >= ? AND h.time < ? GROUP BY 1, 2";
    } else {
      String t = src.equals("1h") ? "niagara.hist_numeric_1h" : "niagara.hist_numeric_1d";
      num = "SELECT v.name, time_bucket(make_interval(secs => ?), h.bucket) b, sum(h.s) / NULLIF(sum(h.n), 0) a, min(h.mn) mn, max(h.mx) mx " +
            "FROM " + t + " h JOIN niagara.v_point v USING (point_id) " +
            "WHERE v.station = ? AND v.name = ANY(?) AND h.bucket >= ? AND h.bucket < ? GROUP BY 1, 2";
      bool = "SELECT v.name, time_bucket(make_interval(secs => ?), h.bucket) b, avg(h.on_ratio) a, min(h.on_ratio) mn, max(h.on_ratio) mx " +
             "FROM niagara.hist_boolean_1h h JOIN niagara.v_point v USING (point_id) " +
             "WHERE v.station = ? AND v.name = ANY(?) AND h.bucket >= ? AND h.bucket < ? GROUP BY 1, 2";
    }
    // Değişince kaydedilen noktalar (açık/kapalı, Milesight): aralıktan önceki son değer de gönderilir
    // (kova ortası tam "from"a düşecek şekilde), yoksa uzun süre değişmeyen nokta ilk kayda kadar boş görünür.
    String prevNum = "SELECT v.name, ?::timestamptz - make_interval(secs => ?) b, x.value a, x.value mn, x.value mx " +
                     "FROM niagara.v_point v CROSS JOIN LATERAL (SELECT value FROM niagara.hist_numeric h " +
                     "WHERE h.point_id = v.point_id AND h.time < ? AND h.value = h.value ORDER BY h.time DESC LIMIT 1) x " +
                     "WHERE v.station = ? AND v.name = ANY(?)";
    String prevBool = "SELECT v.name, ?::timestamptz - make_interval(secs => ?) b, x.value::int a, x.value::int mn, x.value::int mx " +
                      "FROM niagara.v_point v CROSS JOIN LATERAL (SELECT value FROM niagara.hist_boolean h " +
                      "WHERE h.point_id = v.point_id AND h.time < ? ORDER BY h.time DESC LIMIT 1) x " +
                      "WHERE v.station = ? AND v.name = ANY(?)";
    String sql = "SELECT name, extract(epoch from b), a, mn, mx FROM (" + num + " UNION ALL " + bool +
                 " UNION ALL " + prevNum + " UNION ALL " + prevBool + ") x ORDER BY 1, 2";
    java.sql.Connection c = db();
    java.sql.PreparedStatement ps = c.prepareStatement(sql);
    try {
      java.sql.Array arr = c.createArrayOf("text", names);
      java.sql.Timestamp f = new java.sql.Timestamp(fromMs), tt = new java.sql.Timestamp(toMs);
      for (int k = 0; k < 2; k++) {
        int o = k * 5;
        ps.setDouble(o + 1, w); ps.setString(o + 2, station); ps.setArray(o + 3, arr);
        ps.setTimestamp(o + 4, f); ps.setTimestamp(o + 5, tt);
      }
      for (int k = 0; k < 2; k++) {
        int o = 10 + k * 5;
        ps.setTimestamp(o + 1, f); ps.setDouble(o + 2, w / 2); ps.setTimestamp(o + 3, f);
        ps.setString(o + 4, station); ps.setArray(o + 5, arr);
      }
      java.sql.ResultSet rs = ps.executeQuery();
      StringBuilder sb = new StringBuilder("{\"src\":\"").append(src).append("\",\"w\":").append((long) w).append(",\"data\":{");
      String cur = null;
      boolean firstName = true, firstRow = true;
      while (rs.next()) {
        String nm = rs.getString(1);
        if (!nm.equals(cur)) {
          if (cur != null) sb.append(']');
          if (!firstName) sb.append(',');
          firstName = false;
          sb.append(js(nm)).append(":[");
          cur = nm;
          firstRow = true;
        }
        double a = rs.getDouble(3);
        if (rs.wasNull()) continue;
        if (!firstRow) sb.append(',');
        firstRow = false;
        // kovanın ortası (arayüzün kova biçimiyle aynı), aralığın içinde kalacak şekilde
        long mid = (long) Math.max(fromMs / 1000.0, Math.min(rs.getDouble(2) + w / 2, toMs / 1000.0));
        sb.append('[').append(mid).append(',').append(num(a)).append(',')
          .append(num(rs.getDouble(4))).append(',').append(num(rs.getDouble(5))).append(']');
      }
      if (cur != null) sb.append(']');
      return sb.append("}}").toString();
    } finally { ps.close(); }
  }

  static String num(double v) {
    if (Double.isNaN(v) || Double.isInfinite(v)) return "null";
    return String.valueOf(Math.round(v * 10000.0) / 10000.0);
  }

  static String js(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (ch == '"' || ch == '\\') b.append('\\').append(ch);
      else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
      else b.append(ch);
    }
    return b.append('"').toString();
  }
