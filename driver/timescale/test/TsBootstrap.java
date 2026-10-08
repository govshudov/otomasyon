/*
 * Test ortamini hazirlar: sema ve tablolar yoksa olusturur.
 *
 * NEDEN VAR: TsWriterSqlTest ve TsPolicyTest, "niagara" semasinin ve
 * history tablolarinin zaten var oldugunu varsayar. Eski calisma
 * ortaminda bu dogruydu (onceki kosular birakmisti), ama SIFIRDAN bir
 * veritabaninda takim "schema \"niagara\" does not exist" ile cokuyordu.
 * run-tests.sh bunu en basta calistirir.
 */

import com.akyllyoy.timescale.db.TsConfig;
import com.akyllyoy.timescale.db.TsConnection;
import com.akyllyoy.timescale.db.TsSchema;

import java.util.ArrayList;
import java.util.List;

public class TsBootstrap
{
  public static void main(String[] args) throws Exception
  {
    TsConfig cfg = new TsConfig("127.0.0.1", 5432, "scada", "niagara",
      "niagara_rw", "Ts_Test_2026!", "disable", 10, 30, "TsBootstrap");

    try (TsConnection c = new TsConnection(cfg, "bootstrap"))
    {
      c.open();
      List<String> notHyper = new ArrayList<>();
      TsSchema.ensureSchema(c, "niagara", notHyper);

      String[] missing = TsSchema.findMissingTables(c, "niagara");
      if (missing.length > 0)
      {
        System.out.println("HAZIRLIK BASARISIZ, eksik tablolar: "
          + java.util.Arrays.toString(missing));
        System.exit(1);
      }
      System.out.println("hazir (hypertable olmayan: " + notHyper.size() + ')');
    }
  }
}
