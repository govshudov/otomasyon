/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.util.ArrayList;
import java.util.List;

/**
 * TimescaleDB sikistirma ve saklama (retention) politikasi uretimi.
 * <p>
 * Hem wire-sheet blogunun kendi tablosu ({@link TsWideTable}) hem de history
 * tablolari ({@code hist_numeric} vb.) ayni mantigi kullanir; tek yerde
 * duruyor ki biri duzeltilip digeri unutulmasin.
 * <p>
 * Niagara'ya bagimli degildir; gercek PostgreSQL'e karsi test edilebilir.
 *
 * @author Akyllyoy
 */
public final class TsPolicy
{
  /** History tablolari -- {@link #buildAll} bunlara politika uygular. */
  public static final String[] HIST_TABLES = {
    "hist_numeric", "hist_boolean", "hist_enum", "hist_string"
  };

  private TsPolicy() {}

  /**
   * Bir hypertable icin politika DDL'i uretir.
   * <p>
   * Donen dizinin her elemani <b>tek bir islemde</b> calistirilmasi gereken
   * bir ifade grubudur. Gruplar birbirinden bagimsizdir: biri basarisiz
   * olursa (ornegin sunucuda timescaledb yoksa) digerleri denenmeye devam
   * edebilir ve tablo zarar gormez.
   *
   * @param schema       dogrulanmis sema adi
   * @param table        dogrulanmis tablo adi
   * @param segmentBy    sikistirmada gruplama sutunu
   *                     (genis tabloda {@code id}, history'de {@code point_id})
   * @param compressDays kac gunden eski parcalar sikistirilsin (en az 1)
   * @param keepYears    veriler kac yil saklansin (en az 1)
   */
  public static String[][] build(String schema, String table, String segmentBy,
                                 int compressDays, int keepYears)
  {
    String fq = TsSchema.validateIdentifier(schema) + '.'
              + TsSchema.validateIdentifier(table);
    String seg = TsSchema.validateIdentifier(segmentBy);

    List<String[]> groups = new ArrayList<>();

    // 1) Sikistirma ayarlari. ALTER ... SET var olan ayari gunceller.
    groups.add(new String[] {
      "ALTER TABLE " + fq + " SET ("
        + "timescaledb.compress, "
        + "timescaledb.compress_segmentby = '" + seg + "', "
        + "timescaledb.compress_orderby = 'time DESC')"
    });

    // 2) Sikistirma politikasi: ONCE KALDIR, SONRA EKLE.
    //
    //    DIKKAT: add_compression_policy(..., if_not_exists => TRUE) o tabloda
    //    zaten bir politika varsa FARKLI bir aralik verilse bile hicbir sey
    //    yapmaz -- yalnizca uyari uretir. Yani kullanici Workbench'te
    //    "1 gun"u "7 gun" yapsa degisiklik veritabanina YANSIMAZDI.
    //    Bu yuzden onceki politikayi kaldirip yenisini ekliyoruz.
    //    Ikisi ayni islemde: arada politikasiz bir an olusmasin.
    groups.add(new String[] {
      "SELECT remove_compression_policy('" + fq + "', if_exists => TRUE)",
      "SELECT add_compression_policy('" + fq + "', INTERVAL '"
        + Math.max(1, compressDays) + " days')"
    });

    // 3) Saklama politikasi: ayni gerekce, ayni yontem.
    groups.add(new String[] {
      "SELECT remove_retention_policy('" + fq + "', if_exists => TRUE)",
      "SELECT add_retention_policy('" + fq + "', INTERVAL '"
        + Math.max(1, keepYears) + " years')"
    });

    return groups.toArray(new String[0][]);
  }

  /**
   * Dort history tablosunun tamami icin politika DDL'i.
   * <p>
   * History tablolarinda gruplama sutunu {@code point_id}'dir: ayni point'in
   * kayitlari yan yana sikistirilir, bu da hem sikistirma oranini hem de
   * "tek point'i zaman araliginda oku" sorgularini iyilestirir.
   */
  public static String[][] buildAll(String schema, int compressDays, int keepYears)
  {
    List<String[]> groups = new ArrayList<>();
    for (int i = 0; i < HIST_TABLES.length; i++)
    {
      String[][] g = build(schema, HIST_TABLES[i], "point_id", compressDays, keepYears);
      for (int j = 0; j < g.length; j++) { groups.add(g[j]); }
    }
    return groups.toArray(new String[0][]);
  }
}
