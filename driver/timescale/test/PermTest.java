/*
 * module.xml icindeki <permissions> blogunu Niagara'nin KENDI ayristiricisiyla
 * dogrular. Boylece izin bloguna dokunmadan once, station'a kurmadan,
 * ParsingException firlatip firlatmadigini burada goruruz.
 *
 * Kullanim:  java PermTest <module.xml yolu>
 */

import com.tridium.nre.security.policy.ICodeSourceInfo;
import com.tridium.nre.security.policy.JavaPermissionsFactory;
import javax.baja.xml.XElem;
import javax.baja.xml.XParser;

import java.io.File;
import java.security.Permission;
import java.util.Map;
import java.util.Set;

public class PermTest
{
  static class Cs implements ICodeSourceInfo
  {
    public String getUrl()   { return "file:/D:/Niagara/modules/timescale-rt.jar"; }
    public String getName()  { return "timescale-rt"; }
    public boolean isSigned(){ return true; }
  }

  public static void main(String[] args) throws Exception
  {
    XElem module = XParser.make(new File(args[0])).parse();
    XElem perms = module.elem("permissions");
    if (perms == null)
    {
      System.out.println("HATA: <permissions> elemani yok");
      System.exit(1);
    }

    int jp = perms.elems("java-permissions").length;
    System.out.println("java-permissions blok sayisi: " + jp);

    try
    {
      Map<?, Set<Permission>> result = JavaPermissionsFactory.parseAll(new Cs(), perms);
      System.out.println("AYRISTIRMA BASARILI");
      for (Map.Entry<?, Set<Permission>> e : result.entrySet())
      {
        System.out.println("  [" + e.getKey() + "]  " + e.getValue().size() + " izin");
        for (Permission p : e.getValue())
        {
          System.out.println("      " + p.getClass().getName()
            + "  name=" + p.getName()
            + (p.getActions() == null || p.getActions().isEmpty()
               ? "" : "  actions=" + p.getActions()));
        }
      }
    }
    catch (Throwable t)
    {
      System.out.println("AYRISTIRMA BASARISIZ: " + t);
      Throwable c = t.getCause();
      while (c != null) { System.out.println("   sebep: " + c); c = c.getCause(); }
      System.exit(1);
    }
  }
}
