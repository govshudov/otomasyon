  /*
   * TwinSim — /Twin/PS-01 noktaları için GERÇEK ZAMANLI simülasyon (istasyon içinde).
   *
   * Her saniye (Clock) bir adım: günün saatine göre giriş debisi, howuz seviyesi,
   * seviyeye göre PLC kademesi (rotasyonlu), ortak hız PI, pompa hidroliği,
   * tok/kuwwat, sargı (T1–T6) ve podşipnik sıcaklıkları, inverter/pano saatleri,
   * esasy turba akymy/basyşy/sayacı, hücre seviyeleri (LT) ve heartbeat.
   *
   * Değerler noktaların in16 girişine yazılır: gerçek bir link (in1..in15) gelince
   * o kazanır; etkin=false ya da program silinince in16 boşaltılır, nokta kendi
   * fallback değerine döner. Yalnız var olan Writable noktalara yazılır.
   *
   * Özellikler:  etkin (aç/kapa) · hizCarpani (1 = gerçek zaman) ·
   *   arizaNasos (1..6, 0 = arıza yok) · arizaTuru (sargy | podsipnik | tok | trip) · durum
   */

  static final String ROOT = "station:|slot:/Twin/PS$2d01/";
  static final int N = 6;
  static final boolean[] PANO = { false, false, true, false, false, true };   // N-3, N-6 panodan
  static final int[] HDR = { 0, 0, 0, 1, 1, 1 };
  static final double[] START = { 2.0, 2.6, 3.2, 3.8, 4.4, 5.0 };
  static final double[] STOP = { 1.4, 1.6, 1.8, 2.0, 2.2, 2.4 };
  static final double AREA = 420.0;          // howuzyň eşdeğer yüzeyi, m²
  static final double RATED_A = 280.0;

  Clock.Ticket ticket;
  java.util.HashMap<String, BComponent> pts = new java.util.HashMap<String, BComponent>();
  java.util.HashSet<String> missing = new java.util.HashSet<String>();
  java.util.HashMap<String, Double> lastN = new java.util.HashMap<String, Double>();
  java.util.HashMap<String, String> lastS = new java.util.HashMap<String, String>();
  java.util.HashMap<String, Long> lastAt = new java.util.HashMap<String, Long>();
  java.util.Random rnd = new java.util.Random();
  boolean ready = false, active = false;
  long lastMs = 0;

  boolean[] run = new boolean[N], latch = new boolean[N], trip = new boolean[N], hot = new boolean[N];
  double[] spd = new double[N], age = new double[N], q = new double[N];
  double[] tMot = new double[N], tB1 = new double[N], tB2 = new double[N];
  double[] hInv = new double[N], hPano = new double[N], ltNoise = new double[N];
  double[][] bias = new double[N][6];
  double[] total = new double[2], flow = new double[2], press = new double[2];
  double level = 2.6, integ = 0, drift = 0, qIn = 0;

  public void onStart() throws Throwable {
    ticket = Clock.schedulePeriodically(getComponent(), BRelTime.make(1000L), com.tridium.program.BProgram.execute, null);
    setString("durum", "başladı");
  }

  public void onStop() throws Throwable {
    if (ticket != null) ticket.cancel();
    ticket = null;
    release();
  }

  public void onExecute() throws Throwable {
    long now = System.currentTimeMillis();
    double dt = lastMs == 0 ? 1.0 : Math.min(10.0, (now - lastMs) / 1000.0);
    lastMs = now;
    if (!getBoolean("etkin")) {
      if (active) release();
      setString("durum", "durduruldy — noktalar öz bahalaryna gaýtdy");
      return;
    }
    if (!ready) init();
    double k = getDouble("hizCarpani");
    if (!(k > 0)) k = 1.0;
    step(dt * Math.min(100.0, k), now);
    active = true;
  }

  // ---------------------------------------------------------------- noktalar

  BComponent pt(String p) {
    if (pts.containsKey(p)) return pts.get(p);
    BComponent c = null;
    try {
      BObject o = BOrd.make(ROOT + p).get(getComponent());
      if (o instanceof BComponent) c = (BComponent) o;
    } catch (Exception e) { missing.add(p); }
    pts.put(p, c);
    return c;
  }

  double readNum(String p, double def) {
    BComponent c = pt(p);
    if (c == null) return def;
    try {
      BValue o = c.get("out");
      if (o instanceof BStatusNumeric) {
        BStatusNumeric s = (BStatusNumeric) o;
        if (s.getStatus().isValid() && !Double.isNaN(s.getValue())) return s.getValue();
      }
    } catch (Exception e) { }
    return def;
  }

  boolean due(String p, long now) {
    Long t = lastAt.get(p);
    return t == null || now - t > 30000L;           // değişmese de 30 sn'de bir tazele
  }

  void wNum(String p, double v, double db, long now) {
    BComponent c = pt(p);
    if (c == null) return;
    Double l = lastN.get(p);
    if (l != null && Math.abs(l - v) < db && !due(p, now)) return;
    try {
      if (!(c.get("in16") instanceof BStatusNumeric)) return;
      c.set("in16", new BStatusNumeric(v));
    } catch (Exception e) { return; }
    lastN.put(p, v); lastAt.put(p, now);
  }

  void wBool(String p, boolean v, long now) {
    BComponent c = pt(p);
    if (c == null) return;
    Double l = lastN.get(p);
    double x = v ? 1 : 0;
    if (l != null && l == x && !due(p, now)) return;
    try {
      if (!(c.get("in16") instanceof BStatusBoolean)) return;
      c.set("in16", new BStatusBoolean(v));
    } catch (Exception e) { return; }
    lastN.put(p, x); lastAt.put(p, now);
  }

  void wStr(String p, String v, long now) {
    BComponent c = pt(p);
    if (c == null) return;
    if (v.equals(lastS.get(p)) && !due(p, now)) return;
    try {
      if (!(c.get("in16") instanceof BStatusString)) return;
      c.set("in16", new BStatusString(v));
    } catch (Exception e) { return; }
    lastS.put(p, v); lastAt.put(p, now);
  }

  /** in16'yı boşalt: noktalar kendi fallback değerine döner. */
  void release() {
    for (BComponent c : pts.values()) {
      if (c == null) continue;
      try {
        BValue v = c.get("in16");
        if (v instanceof BStatusNumeric) c.set("in16", new BStatusNumeric(0, BStatus.nullStatus));
        else if (v instanceof BStatusBoolean) c.set("in16", new BStatusBoolean(false, BStatus.nullStatus));
        else if (v instanceof BStatusString) c.set("in16", new BStatusString("", BStatus.nullStatus));
      } catch (Exception e) { }
    }
    lastN.clear(); lastS.clear(); lastAt.clear();
    active = false;
  }

  static String P(int i) { return "PMP$2d0" + (i + 1) + "/"; }
  static double clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------------------------------------------------------------- model

  double inflowNow(double dt) {
    java.util.Calendar cal = java.util.Calendar.getInstance();
    double h = cal.get(java.util.Calendar.HOUR_OF_DAY) + cal.get(java.util.Calendar.MINUTE) / 60.0
             + cal.get(java.util.Calendar.SECOND) / 3600.0;
    double ph = 2 * Math.PI * (h - 9.0) / 24.0;                 // sabah ve akşam tepeli
    double diurnal = 0.6 * Math.sin(ph) + 0.4 * Math.sin(2 * ph);
    drift += (rnd.nextGaussian() - drift * 0.1) * Math.min(dt / 10.0, 1.0);
    return Math.max(0, 3200 + 1400 * diurnal + 36 * drift);
  }

  void init() {
    for (int i = 0; i < N; i++) {
      String p = P(i);
      hInv[i] = readNum(p + "hours_inv", PANO[i] ? 50 + rnd.nextDouble() * 550 : 1200 + rnd.nextDouble() * 4800);
      hPano[i] = readNum(p + "hours_pano", PANO[i] ? 300 + rnd.nextDouble() * 1200 : 80 + rnd.nextDouble() * 1700);
      for (int k = 0; k < 6; k++) bias[i][k] = -3 + rnd.nextDouble() * 7;
      age[i] = 1e6;                                             // açılışta hemen kalkabilsin
      tMot[i] = tB1[i] = tB2[i] = 25;
    }
    total[0] = readNum("HDR$2d01/total_m3", 1.5e6 + rnd.nextDouble() * 3e6);
    total[1] = readNum("HDR$2d02/total_m3", 1.5e6 + rnd.nextDouble() * 3e6);
    level = readNum("BASIN$2d01/level_m", 2.6);
    if (level < 0.9 || level > 5.8) level = 2.6;
    // Açılışta talebe göre kademe dolu ve çalışan motorlar ısınmış başlasın
    qIn = inflowNow(1);
    int n0 = (int) Math.max(1, Math.min(N, Math.round(qIn / 850.0)));
    for (int k = 0; k < n0; k++) latch[k] = true;
    int[] order = dutyOrder();
    for (int k = 0; k < n0; k++) {
      int i = order[k];
      run[i] = true; spd[i] = PANO[i] ? 1.0 : 0.93; age[i] = 0;
      tMot[i] = 25 + 85 * 0.7; tB1[i] = 25 + 28 * 0.86; tB2[i] = 25 + 32 * 0.86;
    }
    ready = true;
  }

  /** Görev rotasyonu: en az çalışmış sağlam pompa ilk sırada; tripli olanlar sonda. */
  int[] dutyOrder() {
    int[] o = new int[N];
    for (int i = 0; i < N; i++) o[i] = i;
    for (int a = 0; a < N; a++)
      for (int b = a + 1; b < N; b++) {
        double ka = (trip[o[a]] ? 1e9 : 0) + hInv[o[a]] + hPano[o[a]];
        double kb = (trip[o[b]] ? 1e9 : 0) + hInv[o[b]] + hPano[o[b]];
        if (kb < ka) { int t = o[a]; o[a] = o[b]; o[b] = t; }
      }
    return o;
  }

  void step(double dt, long now) {
    // arıza (Workbench'ten): arizaNasos 1..6 + arizaTuru; 0 = temiz
    int fp = getInt("arizaNasos") - 1;
    String fk = getString("arizaTuru");
    if (fk == null) fk = "";
    fk = fk.trim().toLowerCase();
    // Trip: elle verilen (arizaTuru=trip) ya da motor koruması (sargı > 180 °C; 90 °C'de kendiliğinden sıfırlanır)
    for (int i = 0; i < N; i++) {
      if (tMot[i] > 180) hot[i] = true;
      else if (tMot[i] < 90) hot[i] = false;
      boolean t = hot[i] || (i == fp && fk.equals("trip"));
      if (t && !trip[i]) { run[i] = false; age[i] = 0; }
      trip[i] = t;
    }

    // 1) giriş debisi ve PLC kademesi
    qIn = inflowNow(dt);
    int[] order = dutyOrder();
    boolean[] want = new boolean[N];
    for (int k = 0; k < N; k++) {
      int i = order[k];
      if (level >= START[k]) latch[k] = true;
      else if (level <= STOP[k]) latch[k] = false;
      want[i] = latch[k] && !trip[i];
    }
    if (level <= 0.8) for (int i = 0; i < N; i++) want[i] = false;          // kuru çalışma koruması
    else if (level >= 5.9) for (int i = 0; i < N; i++) want[i] = !trip[i];  // taşma riski
    double err = level - 2.5;
    integ = clamp(integ + err * dt * 0.08, -25, 25);
    double cmd = clamp(94 + 3.5 * err + integ, 85, 100) / 100.0;

    // 2) pompa durum makinesi (min. duruş 120 s, min. çalışma 180 s) ve hız rampası
    for (int i = 0; i < N; i++) {
      age[i] += dt;
      if (trip[i]) run[i] = false;
      else if (want[i] && !run[i] && age[i] >= 120) { run[i] = true; age[i] = 0; }
      else if (!want[i] && run[i] && age[i] >= 180) { run[i] = false; age[i] = 0; }
      double target = run[i] ? (PANO[i] ? 1.0 : cmd) : 0.0;
      double ramp = (target > spd[i] ? (PANO[i] ? 1.0 / 3 : 1.0 / 12) : 1.0 / 10) * dt;
      spd[i] += clamp(target - spd[i], -ramp, ramp);
      if (spd[i] < 0.001) spd[i] = 0;
    }

    // 3) hidrolik: esasy turba başına
    double qOut = 0;
    for (int g = 0; g < 2; g++) {
      int n = 0;
      for (int i = 0; i < N; i++) if (HDR[i] == g && spd[i] > 0.05) n++;
      double sum = 0;
      for (int i = 0; i < N; i++) {
        q[i] = (HDR[i] == g && spd[i] > 0.05) ? Math.max(0, 940 * spd[i] - 55 * (n - 1)) : (HDR[i] == g ? 0 : q[i]);
        if (HDR[i] == g) sum += q[i];
      }
      flow[g] = sum;
      double head = (41.0 - level) + 7.0 * Math.pow(sum / 2700.0, 2);
      press[g] = head * 0.0981;
      total[g] += sum * dt / 3600.0;
      qOut += sum;
    }

    // 4) howuz kütle dengesi
    level = clamp(level + (qIn - qOut) * dt / 3600.0 / AREA, 0, 6.4);

    // 5) elektrik, sıcaklık, saat sayaçları
    double[] amp = new double[N], kw = new double[N];
    for (int i = 0; i < N; i++) {
      boolean on = spd[i] > 0.05;
      double head = (41.0 - level) + 7.0 * Math.pow(flow[HDR[i]] / 2700.0, 2);
      double shaft = on ? (q[i] / 3600.0) * head * 9.81 / 0.84 : 0;
      kw[i] = shaft / 0.95;
      double boost = (i == fp && fk.equals("tok")) ? 0.36 : 0;
      amp[i] = kw[i] * 1000.0 / (1.732 * 400 * 0.87) * (1 + boost);
      double ir = amp[i] / RATED_A;
      double tT = 25 + 85 * ir * ir + ((i == fp && fk.equals("sargy")) ? 60 : 0);
      tMot[i] += (tT - tMot[i]) * (1 - Math.exp(-dt / 300.0));
      double s2 = spd[i] * spd[i], bf = (i == fp && fk.equals("podsipnik")) ? 45 : 0;
      tB1[i] += (25 + 28 * s2 + bf - tB1[i]) * (1 - Math.exp(-dt / 600.0));
      tB2[i] += (25 + 32 * s2 + bf - tB2[i]) * (1 - Math.exp(-dt / 600.0));
      if (run[i] && spd[i] > 0.5) { if (PANO[i]) hPano[i] += dt / 3600.0; else hInv[i] += dt / 3600.0; }
      ltNoise[i] = ltNoise[i] * 0.85 + rnd.nextGaussian() * 0.006;
    }

    // 6) noktalara yaz
    for (int i = 0; i < N; i++) {
      String p = P(i);
      boolean on = spd[i] > 0.05;
      wBool(p + "run_inv", on && !PANO[i], now);
      wBool(p + "run_pano", on && PANO[i], now);
      wNum(p + "vfd_freq_hz", PANO[i] ? 0 : spd[i] * 50.0, 0.1, now);   // bypass'ta inverter 0 Hz okur
      wNum(p + "current_a", amp[i], 0.5, now);
      wNum(p + "power_kw", kw[i], 0.3, now);
      wNum(p + "discharge_press_bar", on ? press[HDR[i]] + 0.03 : 0, 0.01, now);
      wNum(p + "flow_m3h", q[i], 1, now);
      wNum(p + "hours_inv", hInv[i], 0.01, now);
      wNum(p + "hours_pano", hPano[i], 0.01, now);
      double rise = Math.max(0, tMot[i] - 25) / 60.0;
      for (int k = 0; k < 6; k++) wNum(p + "MOTOR/t" + (k + 1), tMot[i] + bias[i][k] * Math.min(rise, 1.5), 0.1, now);
      wNum(p + "PUMP/bearing1", tB1[i], 0.1, now);
      wNum(p + "PUMP/bearing2", tB2[i], 0.1, now);
      wStr(p + "state", trip[i] ? "FAULT" : on ? "RUNNING" : "STOPPED", now);
      wStr(p + "mode", "AUTO", now);
      String v = "VLV$2d0" + (i + 1) + "/";
      wNum(v + "position_pct", run[i] ? 100 : 0, 0.5, now);
      wStr(v + "state", run[i] ? "RUNNING" : "STOPPED", now);
      double qr = q[i] / 900.0;
      wNum("LT$2d0" + (i + 1) + "/level_m", Math.max(0, level - 0.06 * qr * qr + ltNoise[i]), 0.005, now);
    }
    for (int g = 0; g < 2; g++) {
      String h = "HDR$2d0" + (g + 1) + "/";
      wNum(h + "flow_m3h", flow[g], 1, now);
      wNum(h + "total_m3", total[g], 0.5, now);
      wNum(h + "press_bar", press[g], 0.01, now);
      wStr(h + "state", flow[g] > 5 ? "RUNNING" : "STOPPED", now);
    }
    wNum("BASIN$2d01/level_m", level, 0.005, now);
    wNum("BASIN$2d01/inflow_m3h", qIn, 5, now);
    wNum("BASIN$2d01/outflow_m3h", qOut, 5, now);
    wNum("BASIN$2d01/volume_m3", level * AREA, 1, now);
    wNum("heartbeat", now / 1000.0, 0.5, now);                  // epoch sn: arayüz "janly" görür

    int nRun = 0;
    for (int i = 0; i < N; i++) if (spd[i] > 0.05) nRun++;
    setString("durum", String.format("işleýär · %d nasos · %.0f m³/sag · derejesi %.2f m · %tT%s",
        nRun, qOut, level, new java.util.Date(now), missing.isEmpty() ? "" : " · tapylmadyk nokat: " + missing.size()));
  }
