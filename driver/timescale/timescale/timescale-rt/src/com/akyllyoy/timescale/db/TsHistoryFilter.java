/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Hangi history'lerin aktarilacagini secen basit desen eslestirici.
 * <p>
 * Kullanici Workbench'te iki metin alani doldurur:
 * <ul>
 *   <li><b>include</b> -- virgulle ayrilmis desenler; bos veya {@code *}
 *       ise hepsi secilir</li>
 *   <li><b>exclude</b> -- ayni bicimde; eslesen history'ler <b>disarida</b>
 *       birakilir (exclude her zaman include'a baskindir)</li>
 * </ul>
 * Desende {@code *} herhangi bir karakter dizisi anlamina gelir. Eslestirme
 * buyuk/kucuk harf duyarsizdir ve history kimliginin tamamina uygulanir
 * (ornek: {@code /Kazan/FM_012_Flow}).
 * <p>
 * Ornekler:
 * <pre>
 *   include = "*"                  -> hepsi
 *   include = "/Kazan/*"           -> yalnizca Kazan cihazinin history'leri
 *   include = "*Flow*,*Temp*"      -> adinda Flow veya Temp gecenler
 *   exclude = "*Test*,*Deneme*"    -> test history'lerini disla
 * </pre>
 * Duzenli ifade <b>kullanilmaz</b>: kullanicinin yazdigi metin regex olarak
 * yorumlansaydi {@code (} gibi bir karakter PatternSyntaxException firlatir
 * ve aktarim komple dururdu.
 * <p>
 * Niagara'ya bagimli degildir; birim testi yazilabilir.
 *
 * @author Akyllyoy
 */
public final class TsHistoryFilter
{
  private final List<String> include;
  private final List<String> exclude;

  public TsHistoryFilter(String includeCsv, String excludeCsv)
  {
    this.include = split(includeCsv);
    this.exclude = split(excludeCsv);
  }

  /** Bu history kimligi aktarilmali mi? */
  public boolean accept(String historyId)
  {
    if (historyId == null) { return false; }
    String id = historyId.toLowerCase(Locale.ROOT);

    for (int i = 0; i < exclude.size(); i++)
    {
      if (matches(id, exclude.get(i))) { return false; }
    }

    // include bos ise "hepsi" demektir
    if (include.isEmpty()) { return true; }

    for (int i = 0; i < include.size(); i++)
    {
      if (matches(id, include.get(i))) { return true; }
    }
    return false;
  }

  private static List<String> split(String csv)
  {
    List<String> out = new ArrayList<>();
    if (csv == null) { return out; }
    String[] parts = csv.split(",");
    for (int i = 0; i < parts.length; i++)
    {
      String p = parts[i].trim().toLowerCase(Locale.ROOT);
      if (p.isEmpty()) { continue; }
      if ("*".equals(p)) { return new ArrayList<>(); } // "hepsi" -> desen listesi bos
      out.add(p);
    }
    return out;
  }

  /**
   * {@code *} joker karakterli eslestirme. Ozyineleme yok; girdinin
   * uzunlugundan bagimsiz olarak sabit bellekte calisir.
   */
  static boolean matches(String text, String pattern)
  {
    int t = 0, p = 0;
    int starP = -1, starT = 0;

    while (t < text.length())
    {
      if (p < pattern.length() && pattern.charAt(p) == '*')
      {
        starP = p++;
        starT = t;
      }
      else if (p < pattern.length() && pattern.charAt(p) == text.charAt(t))
      {
        p++;
        t++;
      }
      else if (starP >= 0)
      {
        // son yildizin yuttugu karakter sayisini bir artir
        p = starP + 1;
        t = ++starT;
      }
      else
      {
        return false;
      }
    }
    while (p < pattern.length() && pattern.charAt(p) == '*') { p++; }
    return p == pattern.length();
  }
}
