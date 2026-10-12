// Surucunun (timescale-rt.jar) sema kodunu istasyonun DISINDA calistirir: sema, tablolar, hypertable'lar.
// kur-istasyon.ps1 4. adimda cagirir (derleme de orada, Niagara'nin kendi javac'i ile).
//
// Neden: TimescaleDevice'in createSchema eylemi tarayicidan (BajaScript) cagrilinca sifreyi okuyamaz
// ("Sifre okunamadi (SecurityException)"), tablolar olusmaz. autoCreateSchema acik degilse (kopyalanan
// istasyon) bos veritabaninda kurulum orada kaliyordu. DDL surucununkiyle AYNIDIR (TsSchema.ensureSchema).
//
//   javac -cp timescale-rt.jar -d <gecici> TsSema.java
//   java  -cp "<gecici>;timescale-rt.jar" TsSema <host> <port> <veritabani> <sema> <kullanici>
//   Sifre PGPASSWORD ortam degiskeninden okunur. (Dosya bilerek ASCII.)
import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;
import com.akyllyoy.timescale.db.TsSchema;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

public class TsSema
{
  // Surucunun "baglandi" INFO satirlari ciktiyi kirletmesin (alan: ayar toplanip silinmesin diye)
  private static final Logger DB_LOG = Logger.getLogger("timescale.db");

  public static void main(String[] a)
  {
    String pwd = System.getenv("PGPASSWORD");
    if (a.length != 5 || pwd == null || pwd.isEmpty())
    {
      System.out.println("kullanim: TsSema <host> <port> <veritabani> <sema> <kullanici>   (sifre: PGPASSWORD)");
      System.exit(2);
    }
    DB_LOG.setLevel(Level.WARNING);

    TsConfig cfg = new TsConfig(a[0], Integer.parseInt(a[1]), a[2], a[3], a[4], pwd,
      "prefer", 10, 60, "kur-istasyon");
    try (TsConnection c = new TsConnection(cfg, "kurulum"))
    {
      c.open();
      List<String> notHyper = new ArrayList<>();
      TsSchema.ensureSchema(c, cfg.schema, notHyper);

      String[] missing = TsSchema.findMissingTables(c, cfg.schema);
      if (missing.length > 0)
      {
        System.out.println("  HATA: tablolar eksik kaldi: " + Arrays.toString(missing));
        System.exit(1);
      }
      System.out.println(notHyper.isEmpty()
        ? "  sema hazir: " + cfg.schema
        : "  sema hazir: " + cfg.schema + " - DIKKAT, hypertable yapilamayan: " + notHyper
          + " (timescaledb eklentisi kurulu mu?)");
    }
    catch (Exception e)
    {
      System.out.println("  HATA: " + e.getMessage());
      System.exit(1);
    }
  }
}
