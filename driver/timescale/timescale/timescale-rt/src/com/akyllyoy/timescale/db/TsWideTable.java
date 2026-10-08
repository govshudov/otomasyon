/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.util.ArrayList;
import java.util.List;

/**
 * "Genis tablo" (wire-sheet blogu) icin SQL uretimi.
 * <p>
 * Bu sinif Niagara'ya <b>bagimli degildir</b> -- bilerek. Boylece uretilen
 * SQL bir station'a kurmadan, gercek bir PostgreSQL'e karsi test edilebilir.
 * {@code BTimescaleTableWriter} yalnizca buraya devreder.
 * <p>
 * Tablo duzeni:
 * <pre>
 *   time   TIMESTAMPTZ NOT NULL   -- hypertable zaman boyutu
 *   id     BIGINT                 -- satir kimligi (blok ozelligi)
 *   name   TEXT                   -- satir adi   (blok ozelligi)
 *   &lt;col1..colN&gt; DOUBLE PRECISION -- girisler
 * </pre>
 *
 * @author Akyllyoy
 */
public final class TsWideTable
{
  private TsWideTable() {}

  /** Hypertable parca araligi. */
  private static final String CHUNK_INTERVAL = "7 days";

  /**
   * <b>Zorunlu</b> DDL: tablo, eksik sutunlar, indeks.
   * <p>
   * Tamami <b>duz PostgreSQL</b> ile calisir; timescaledb eklentisi
   * gerektirmez. Hepsi idempotent ve tek bir islemde calistirilip commit
   * edilmelidir.
   * <p>
   * <b>Hypertable BURADA DEGIL</b> -- bilerek. Daha once
   * {@code create_hypertable} bu grubun icindeydi ve eklenti kurulu
   * olmayan bir sunucuda tum islem geri aliniyordu: kullanici
   * "Create Table" diyor, hicbir tablo olusmuyordu. Oysa duz bir
   * PostgreSQL tablosu veriyi gayet iyi saklar; eksik kalan yalnizca
   * parcalama, sikistirma ve saklama politikasidir. Hypertable artik
   * {@link #buildHypertableDdl} ile AYRI bir islemde denenir ve
   * basarisiz olursa yalnizca uyari uretilir.
   *
   * @param schema dogrulanmis sema adi
   * @param table  dogrulanmis tablo adi
   * @param cols   dogrulanmis sutun adlari (giris basina bir tane)
   */
  public static String[] buildCoreDdl(String schema, String table, String[] cols)
  {
    String fq = schema + '.' + table;
    List<String> ddl = new ArrayList<>();

    StringBuilder create = new StringBuilder();
    create.append("CREATE TABLE IF NOT EXISTS ").append(fq)
          .append(" (time TIMESTAMPTZ NOT NULL, id BIGINT, name TEXT");
    for (int i = 0; i < cols.length; i++)
    {
      create.append(", ").append(cols[i]).append(" DOUBLE PRECISION");
    }
    create.append(')');
    ddl.add(create.toString());

    // Kullanici sonradan sutun adi degistirirse eksikleri tamamla.
    // Eski sutunlar KALIR -- icindeki veri kaybolmasin.
    for (int i = 0; i < cols.length; i++)
    {
      ddl.add("ALTER TABLE " + fq + " ADD COLUMN IF NOT EXISTS "
        + cols[i] + " DOUBLE PRECISION");
    }

    ddl.add("CREATE INDEX IF NOT EXISTS " + table + "_id_time_ix ON "
      + fq + " (id, time DESC)");

    return ddl.toArray(new String[0]);
  }

  /**
   * Tabloyu hypertable'a cevirir.
   * <p>
   * <b>Kendi islemininde</b> calistirilmalidir: timescaledb eklentisi
   * kurulu degilse bu ifade hata verir ve ayni islemdeki her seyi geri
   * alir. Ayri calistirildiginda tablo saglam kalir, sadece hypertable
   * ozelligi (parcalama, sikistirma, saklama) devre disi kalir.
   */
  public static String buildHypertableDdl(String schema, String table)
  {
    return "SELECT create_hypertable('"
      + TsSchema.validateIdentifier(schema) + '.'
      + TsSchema.validateIdentifier(table) + "', 'time', "
      + "chunk_time_interval => INTERVAL '" + CHUNK_INTERVAL + "', if_not_exists => TRUE)";
  }

  /**
   * <b>Istege bagli</b> DDL: sikistirma ayarlari, sikistirma ve saklama
   * politikalari.
   * <p>
   * Yalnizca timescaledb eklentisi kuruluyken calisir. Cagiran taraf her
   * ifadeyi <b>ayri</b> bir islemde calistirmalidir: biri basarisiz olsa
   * bile tablo kullanilabilir kalmali, yalnizca uyari uretilmelidir.
   *
   * @param compressDays kac gunden eski parcalar sikistirilsin (>=1)
   * @param keepYears    veriler kac yil saklansin (>=1)
   */
  public static String[][] buildPolicyDdl(String schema, String table,
                                          int compressDays, int keepYears)
  {
    return TsPolicy.build(schema, table, "id", compressDays, keepYears);
  }

  /**
   * Tek satirlik INSERT.
   * Parametre sirasi: 1=time, 2=id, 3=name, 4..=cols[0..N-1].
   */
  public static String buildInsertSql(String schema, String table, String[] cols)
  {
    StringBuilder sb = new StringBuilder();
    sb.append("INSERT INTO ").append(schema).append('.').append(table)
      .append(" (time, id, name");
    for (int i = 0; i < cols.length; i++) { sb.append(", ").append(cols[i]); }
    sb.append(") VALUES (?,?,?");
    for (int i = 0; i < cols.length; i++) { sb.append(",?"); }
    sb.append(')');
    return sb.toString();
  }
}
