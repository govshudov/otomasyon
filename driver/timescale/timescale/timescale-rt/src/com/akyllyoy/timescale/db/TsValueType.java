/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

/**
 * Niagara deger tipi ile TimescaleDB hedef tablosu arasindaki eslesme.
 *
 * @author Akyllyoy
 */
public enum TsValueType
{
  NUMERIC("numeric", "hist_numeric", "num_value"),
  BOOLEAN("boolean", "hist_boolean", "bool_value"),
  ENUM("enum", "hist_enum", "enum_value"),
  STRING("string", "hist_string", "str_value");

  /** niagara.point.value_type sutunundaki deger */
  public final String dbName;

  /** hedef hypertable adi (sema haric) */
  public final String table;

  /** niagara.point_live tablosundaki sutun adi */
  public final String liveColumn;

  TsValueType(String dbName, String table, String liveColumn)
  {
    this.dbName = dbName;
    this.table = table;
    this.liveColumn = liveColumn;
  }

  public static TsValueType fromDbName(String s)
  {
    for (TsValueType t : values())
    {
      if (t.dbName.equals(s)) { return t; }
    }
    return null;
  }
}
