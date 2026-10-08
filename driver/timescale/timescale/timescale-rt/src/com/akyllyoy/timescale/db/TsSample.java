/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

/**
 * TimescaleDB'ye yazilacak tek bir olcum satiri.
 * <p>
 * Deger tipine gore hangi alanin dolu oldugu {@link #valueType} ile belirlenir.
 * Bilerek "mutable POJO" olarak tutuldu: saniyede on binlerce nesne uretilebilir,
 * getter/setter maliyetinden kacinilmistir.
 *
 * @author Akyllyoy
 */
public final class TsSample
{
  /** Kayit kaynagi: history export */
  public static final short SRC_HISTORY = 0;
  /** Kayit kaynagi: canli COV */
  public static final short SRC_COV = 1;
  /** Kayit kaynagi: manuel / backfill */
  public static final short SRC_MANUAL = 2;

  public TsValueType valueType;

  /** Epoch millis (UTC) */
  public long time;

  /** niagara.point tablosundaki kimlik */
  public long pointId;

  public double numValue;
  public boolean boolValue;
  public int enumValue;
  public String strValue;

  /** BStatus bit maskesi */
  public int status;

  /** BTrendFlags bit maskesi */
  public short trendFlags;

  /** SRC_* sabitlerinden biri */
  public short src;

  public TsSample() {}

  public static TsSample numeric(long pointId, long time, double v, int status,
                                 short trendFlags, short src)
  {
    TsSample s = new TsSample();
    s.valueType = TsValueType.NUMERIC;
    s.pointId = pointId;
    s.time = time;
    s.numValue = v;
    s.status = status;
    s.trendFlags = trendFlags;
    s.src = src;
    return s;
  }

  public static TsSample bool(long pointId, long time, boolean v, int status,
                              short trendFlags, short src)
  {
    TsSample s = new TsSample();
    s.valueType = TsValueType.BOOLEAN;
    s.pointId = pointId;
    s.time = time;
    s.boolValue = v;
    s.status = status;
    s.trendFlags = trendFlags;
    s.src = src;
    return s;
  }

  public static TsSample enumeration(long pointId, long time, int ordinal, int status,
                                     short trendFlags, short src)
  {
    TsSample s = new TsSample();
    s.valueType = TsValueType.ENUM;
    s.pointId = pointId;
    s.time = time;
    s.enumValue = ordinal;
    s.status = status;
    s.trendFlags = trendFlags;
    s.src = src;
    return s;
  }

  public static TsSample string(long pointId, long time, String v, int status,
                                short trendFlags, short src)
  {
    TsSample s = new TsSample();
    s.valueType = TsValueType.STRING;
    s.pointId = pointId;
    s.time = time;
    s.strValue = v;
    s.status = status;
    s.trendFlags = trendFlags;
    s.src = src;
    return s;
  }

  @Override
  public String toString()
  {
    return "TsSample{" + valueType + " point=" + pointId + " t=" + time + '}';
  }
}
