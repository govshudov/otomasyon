/*
 * pgjdbc LazyCleaner yamasinin testi.
 *
 * ARIZA KOSULU BIREBIR KURULUR: RuntimePermission "setContextClassLoader"
 * reddeden bir SecurityManager kurulur -- Niagara station'inda olan tam
 * olarak budur. Ozgun pgjdbc sinifi bu kosulda saniyede yuzlerce istisna
 * uretip sonsuz donguye girer; yamali surum girmemelidir.
 *
 * Kullanim:
 *   java -Djava.security.manager=allow -cp ... TsLazyCleanerTest [orijinal]
 *
 * "orijinal" argumani verilirse yalnizca olcum yapilir (yamasiz jar ile
 * calistirilip karsilastirma icin).
 */

import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;

import java.security.Permission;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

public class TsLazyCleanerTest
{
  static int passed = 0, failed = 0;

  static void check(String name, boolean ok, String detail)
  {
    if (ok) { passed++; System.out.println("  OK   " + name + (detail.isEmpty() ? "" : "  (" + detail + ')')); }
    else    { failed++; System.out.println("  FAIL " + name + "  " + detail); }
  }

  /** LazyCleaner'in urettigi WARNING kayitlarini sayar. */
  static final AtomicInteger warnings = new AtomicInteger();

  public static void main(String[] args) throws Exception
  {
    boolean measureOnly = args.length > 0 && "orijinal".equals(args[0]);

    // --- LazyCleaner log'unu yakala, konsola basma ---
    Logger lc = Logger.getLogger("org.postgresql.util.LazyCleaner");
    lc.setUseParentHandlers(false);
    lc.addHandler(new Handler()
    {
      @Override public void publish(LogRecord r)
      {
        if (r.getLevel().intValue() >= Level.WARNING.intValue()) { warnings.incrementAndGet(); }
      }
      @Override public void flush() {}
      @Override public void close() {}
    });

    // --- Niagara'nin kisitini taklit et ---
    System.setSecurityManager(new SecurityManager()
    {
      @Override public void checkPermission(Permission p)
      {
        if (p instanceof RuntimePermission
            && "setContextClassLoader".equals(p.getName()))
        {
          throw new SecurityException("access denied (\"java.lang.RuntimePermission\" "
            + "\"setContextClassLoader\")  [test tarafindan bilerek reddedildi]");
        }
        // diger her sey serbest
      }
      @Override public void checkPermission(Permission p, Object ctx) { checkPermission(p); }
    });

    System.out.println("0) Kisit gercekten aktif mi");
    boolean denied = false;
    try { Thread.currentThread().setContextClassLoader(null); }
    catch (SecurityException e) { denied = true; }
    check("setContextClassLoader reddediliyor", denied, "");

    TsConfig cfg = new TsConfig("127.0.0.1", 5432, "scada", "niagara",
      "niagara_rw", "Ts_Test_2026!", "disable", 10, 30, "TsLazyCleanerTest");

    System.out.println("1) Baglanti ac/kapa - temizlik thread'i uyanir");
    warnings.set(0);
    for (int i = 0; i < 3; i++)
    {
      TsConnection c = new TsConnection(cfg, "lc" + i);
      c.open();
      if (i == 0) { check("baglanti kuruldu", c.isOpen(), ""); }
      c.closeQuietly();
    }

    // Temizlik thread'i calisiyorsa bu sure icinde ariza patlak verirdi.
    System.out.println("2) 3 saniye bekleniyor, uyari sayiliyor...");
    Thread.sleep(3000L);
    int w = warnings.get();

    if (measureOnly)
    {
      System.out.println();
      System.out.println("OLCUM: 3 saniyede " + w + " LazyCleaner WARNING");
      return;
    }

    // Ozgun surumde bu sayi milyonlarla olculuyor. Yamali surumde SIFIR olmali.
    check("uyari firtinasi YOK", w == 0, "3 saniyede " + w + " uyari");

    System.out.println("3) Temizlik islevi korunmus mu");

    // register() + clean(): eylem TAM BIR KEZ calismali
    final AtomicInteger cleaned = new AtomicInteger();
    final AtomicInteger leakFlag = new AtomicInteger(-1);

    Object handle = new Object();
    org.postgresql.util.LazyCleaner cleaner = org.postgresql.util.LazyCleaner.getInstance();
    int before = cleaner.getWatchedCount();

    org.postgresql.util.LazyCleaner.Cleanable<RuntimeException> cl =
      cleaner.register(handle, leak -> { cleaned.incrementAndGet(); leakFlag.set(leak ? 1 : 0); });

    check("register() izleme sayisini artirdi", cleaner.getWatchedCount() == before + 1,
      "" + cleaner.getWatchedCount());
    check("temizlik thread'i calisiyor", cleaner.isThreadRunning(), "");

    cl.clean();
    check("clean() eylemi calistirdi", cleaned.get() == 1, "cagri=" + cleaned.get());
    check("clean() leak=false ile cagirdi", leakFlag.get() == 0, "leak=" + leakFlag.get());
    check("izleme sayisi geri dustu", cleaner.getWatchedCount() == before, "");

    cl.clean();
    check("ikinci clean() tekrar calistirmadi (idempotent)", cleaned.get() == 1,
      "cagri=" + cleaned.get());

    System.out.println("4) SIZINTI temizligi - thread gercekten is goruyor mu");

    final AtomicInteger leaked = new AtomicInteger();
    final AtomicInteger leakedFlag = new AtomicInteger(-1);
    Object[] box = { new Object() };
    cleaner.register(box[0], leak -> { leaked.incrementAndGet(); leakedFlag.set(leak ? 1 : 0); });

    box[0] = null;   // referansi birak

    boolean fired = false;
    for (int i = 0; i < 60 && !fired; i++)
    {
      System.gc();
      Thread.sleep(100L);
      fired = leaked.get() > 0;
    }
    check("GC sonrasi sizinti temizligi CALISTI", fired, "cagri=" + leaked.get());
    check("sizinti leak=true ile bildirildi", leakedFlag.get() == 1, "leak=" + leakedFlag.get());

    System.out.println("5) Bu sirada yeni uyari cikti mi");
    check("hala uyari yok", warnings.get() == 0, "toplam=" + warnings.get());

    System.out.println();
    System.out.println("SONUC: " + passed + " gecti, " + failed + " kaldi");
    if (failed > 0) { System.exit(1); }
  }
}
