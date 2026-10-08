/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.baja.naming.BOrd;
import javax.baja.nre.annotations.NiagaraAction;
import javax.baja.nre.annotations.NiagaraProperty;
import javax.baja.nre.annotations.NiagaraType;
import javax.baja.status.BStatus;
import javax.baja.status.BStatusNumeric;
import javax.baja.sys.Action;
import javax.baja.sys.BAbsTime;
import javax.baja.sys.BComponent;
import javax.baja.sys.BObject;
import javax.baja.sys.BRelTime;
import javax.baja.sys.Clock;
import javax.baja.sys.Context;
import javax.baja.sys.Flags;
import javax.baja.sys.Property;
import javax.baja.sys.Sys;
import javax.baja.sys.Type;

import com.akyllyoy.timescale.db.TsSchema;
import com.akyllyoy.timescale.db.TsWideTable;

/**
 * Wire sheet blogu: bagli girisleri TimescaleDB'de KENDI tablosuna yazar.
 * <p>
 * Kullanim: bloku bir wire sheet'e birak, {@code deviceOrd} ile
 * {@link BTimescaleDevice} bilesenini goster, {@code tableName} ver,
 * istedigin point'leri {@code in1..in16} girislerine linkle, sutun adlarini
 * {@code col1..col16} ile isimlendir ve {@code Create Table} action'ini
 * calistir.
 * <p>
 * Olusan tablo:
 * <pre>
 *   time  timestamptz   (hypertable bolumleme sutunu)
 *   id    bigint        rowId
 *   name  text          rowName
 *   &lt;col1..col16&gt;      double precision  (bos birakilan ad icin "inN")
 * </pre>
 * Ayni tabloya birden fazla blok yazabilir; satirlar {@code id}/{@code name}
 * ile ayrisir.
 * <p>
 * Tablo olusturulurken hypertable yapilir, {@code compressAfterDays} gun
 * sonra sikistirma ve {@code retentionYears} yil saklama politikalari
 * eklenir.
 * <p>
 * <b>Thread notu:</b> tum JDBC isleri {@link BTimescaleDevice#postAsync}
 * uzerinden arka planda calisir; Engine thread hicbir zaman veritabaninda
 * beklemez.
 *
 * @author Akyllyoy
 */
@NiagaraType
@NiagaraProperty(
  name = "deviceOrd",
  type = "BOrd",
  defaultValue = "BOrd.make(\"station:|slot:/Drivers/TimescaleNetwork/TimescaleDatabase\")"
)
@NiagaraProperty(
  name = "tableName",
  type = "String",
  defaultValue = "\"ts_data\""
)
@NiagaraProperty(
  name = "rowId",
  type = "int",
  defaultValue = "1"
)
@NiagaraProperty(
  name = "rowName",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "autoCreateTable",
  type = "boolean",
  defaultValue = "true"
)
@NiagaraProperty(
  name = "retentionYears",
  type = "int",
  defaultValue = "10"
)
@NiagaraProperty(
  name = "compressAfterDays",
  type = "int",
  defaultValue = "1"
)
@NiagaraProperty(
  name = "writeInterval",
  type = "BRelTime",
  defaultValue = "BRelTime.makeSeconds(60)"
)
@NiagaraProperty(
  name = "writeOnChange",
  type = "boolean",
  defaultValue = "true"
)
@NiagaraProperty(
  name = "covMinInterval",
  type = "BRelTime",
  defaultValue = "BRelTime.makeSeconds(10)"
)
@NiagaraProperty(
  name = "status",
  type = "BStatus",
  defaultValue = "BStatus.ok",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "lastWriteTime",
  type = "BAbsTime",
  defaultValue = "BAbsTime.NULL",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraProperty(
  name = "rowsWritten",
  type = "long",
  defaultValue = "0L",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "lastError",
  type = "String",
  defaultValue = "\"\"",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraProperty(
  name = "in1",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col1",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in2",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col2",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in3",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col3",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in4",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col4",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in5",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col5",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in6",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col6",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in7",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col7",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in8",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col8",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in9",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col9",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in10",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col10",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in11",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col11",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in12",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col12",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in13",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col13",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in14",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col14",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in15",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col15",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "in16",
  type = "BStatusNumeric",
  defaultValue = "new BStatusNumeric()",
  flags = Flags.SUMMARY
)
@NiagaraProperty(
  name = "col16",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraAction(name = "writeData")
@NiagaraAction(name = "createTable", flags = Flags.CONFIRM_REQUIRED)public class BTimescaleTableWriter
  extends BComponent
{
//region /*+ ------------ BEGIN BAJA AUTO GENERATED CODE ------------ +*/
//@formatter:off
/*@ $com.akyllyoy.timescale.BTimescaleTableWriter(2979906276)1.0$ @*/
/* Generated by slotgen.py - Slot-o-Matic yerine */

  //region Property "deviceOrd"

  public static final Property deviceOrd = newProperty(0, BOrd.make("station:|slot:/Drivers/TimescaleNetwork/TimescaleDatabase"), null);
  public BOrd getDeviceOrd() { return (BOrd)get(deviceOrd); }
  public void setDeviceOrd(BOrd v) { set(deviceOrd, v, null); }
  //endregion Property "deviceOrd"

  //region Property "tableName"

  public static final Property tableName = newProperty(0, "ts_data", null);
  public String getTableName() { return getString(tableName); }
  public void setTableName(String v) { setString(tableName, v, null); }
  //endregion Property "tableName"

  //region Property "rowId"

  public static final Property rowId = newProperty(0, 1, null);
  public int getRowId() { return getInt(rowId); }
  public void setRowId(int v) { setInt(rowId, v, null); }
  //endregion Property "rowId"

  //region Property "rowName"

  public static final Property rowName = newProperty(0, "", null);
  public String getRowName() { return getString(rowName); }
  public void setRowName(String v) { setString(rowName, v, null); }
  //endregion Property "rowName"

  //region Property "autoCreateTable"

  public static final Property autoCreateTable = newProperty(0, true, null);
  public boolean getAutoCreateTable() { return getBoolean(autoCreateTable); }
  public void setAutoCreateTable(boolean v) { setBoolean(autoCreateTable, v, null); }
  //endregion Property "autoCreateTable"

  //region Property "retentionYears"

  public static final Property retentionYears = newProperty(0, 10, null);
  public int getRetentionYears() { return getInt(retentionYears); }
  public void setRetentionYears(int v) { setInt(retentionYears, v, null); }
  //endregion Property "retentionYears"

  //region Property "compressAfterDays"

  public static final Property compressAfterDays = newProperty(0, 1, null);
  public int getCompressAfterDays() { return getInt(compressAfterDays); }
  public void setCompressAfterDays(int v) { setInt(compressAfterDays, v, null); }
  //endregion Property "compressAfterDays"

  //region Property "writeInterval"

  public static final Property writeInterval = newProperty(0, BRelTime.makeSeconds(60), null);
  public BRelTime getWriteInterval() { return (BRelTime)get(writeInterval); }
  public void setWriteInterval(BRelTime v) { set(writeInterval, v, null); }
  //endregion Property "writeInterval"

  //region Property "writeOnChange"

  public static final Property writeOnChange = newProperty(0, true, null);
  public boolean getWriteOnChange() { return getBoolean(writeOnChange); }
  public void setWriteOnChange(boolean v) { setBoolean(writeOnChange, v, null); }
  //endregion Property "writeOnChange"

  //region Property "covMinInterval"

  public static final Property covMinInterval = newProperty(0, BRelTime.makeSeconds(10), null);
  public BRelTime getCovMinInterval() { return (BRelTime)get(covMinInterval); }
  public void setCovMinInterval(BRelTime v) { set(covMinInterval, v, null); }
  //endregion Property "covMinInterval"

  //region Property "status"

  public static final Property status = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, BStatus.ok, null);
  public BStatus getStatus() { return (BStatus)get(status); }
  public void setStatus(BStatus v) { set(status, v, null); }
  //endregion Property "status"

  //region Property "lastWriteTime"

  public static final Property lastWriteTime = newProperty(Flags.READONLY | Flags.TRANSIENT, BAbsTime.NULL, null);
  public BAbsTime getLastWriteTime() { return (BAbsTime)get(lastWriteTime); }
  public void setLastWriteTime(BAbsTime v) { set(lastWriteTime, v, null); }
  //endregion Property "lastWriteTime"

  //region Property "rowsWritten"

  public static final Property rowsWritten = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, 0L, null);
  public long getRowsWritten() { return getLong(rowsWritten); }
  public void setRowsWritten(long v) { setLong(rowsWritten, v, null); }
  //endregion Property "rowsWritten"

  //region Property "lastError"

  public static final Property lastError = newProperty(Flags.READONLY | Flags.TRANSIENT, "", null);
  public String getLastError() { return getString(lastError); }
  public void setLastError(String v) { setString(lastError, v, null); }
  //endregion Property "lastError"

  //region Property "in1"

  public static final Property in1 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn1() { return (BStatusNumeric)get(in1); }
  public void setIn1(BStatusNumeric v) { set(in1, v, null); }
  //endregion Property "in1"

  //region Property "col1"

  public static final Property col1 = newProperty(0, "", null);
  public String getCol1() { return getString(col1); }
  public void setCol1(String v) { setString(col1, v, null); }
  //endregion Property "col1"

  //region Property "in2"

  public static final Property in2 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn2() { return (BStatusNumeric)get(in2); }
  public void setIn2(BStatusNumeric v) { set(in2, v, null); }
  //endregion Property "in2"

  //region Property "col2"

  public static final Property col2 = newProperty(0, "", null);
  public String getCol2() { return getString(col2); }
  public void setCol2(String v) { setString(col2, v, null); }
  //endregion Property "col2"

  //region Property "in3"

  public static final Property in3 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn3() { return (BStatusNumeric)get(in3); }
  public void setIn3(BStatusNumeric v) { set(in3, v, null); }
  //endregion Property "in3"

  //region Property "col3"

  public static final Property col3 = newProperty(0, "", null);
  public String getCol3() { return getString(col3); }
  public void setCol3(String v) { setString(col3, v, null); }
  //endregion Property "col3"

  //region Property "in4"

  public static final Property in4 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn4() { return (BStatusNumeric)get(in4); }
  public void setIn4(BStatusNumeric v) { set(in4, v, null); }
  //endregion Property "in4"

  //region Property "col4"

  public static final Property col4 = newProperty(0, "", null);
  public String getCol4() { return getString(col4); }
  public void setCol4(String v) { setString(col4, v, null); }
  //endregion Property "col4"

  //region Property "in5"

  public static final Property in5 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn5() { return (BStatusNumeric)get(in5); }
  public void setIn5(BStatusNumeric v) { set(in5, v, null); }
  //endregion Property "in5"

  //region Property "col5"

  public static final Property col5 = newProperty(0, "", null);
  public String getCol5() { return getString(col5); }
  public void setCol5(String v) { setString(col5, v, null); }
  //endregion Property "col5"

  //region Property "in6"

  public static final Property in6 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn6() { return (BStatusNumeric)get(in6); }
  public void setIn6(BStatusNumeric v) { set(in6, v, null); }
  //endregion Property "in6"

  //region Property "col6"

  public static final Property col6 = newProperty(0, "", null);
  public String getCol6() { return getString(col6); }
  public void setCol6(String v) { setString(col6, v, null); }
  //endregion Property "col6"

  //region Property "in7"

  public static final Property in7 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn7() { return (BStatusNumeric)get(in7); }
  public void setIn7(BStatusNumeric v) { set(in7, v, null); }
  //endregion Property "in7"

  //region Property "col7"

  public static final Property col7 = newProperty(0, "", null);
  public String getCol7() { return getString(col7); }
  public void setCol7(String v) { setString(col7, v, null); }
  //endregion Property "col7"

  //region Property "in8"

  public static final Property in8 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn8() { return (BStatusNumeric)get(in8); }
  public void setIn8(BStatusNumeric v) { set(in8, v, null); }
  //endregion Property "in8"

  //region Property "col8"

  public static final Property col8 = newProperty(0, "", null);
  public String getCol8() { return getString(col8); }
  public void setCol8(String v) { setString(col8, v, null); }
  //endregion Property "col8"

  //region Property "in9"

  public static final Property in9 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn9() { return (BStatusNumeric)get(in9); }
  public void setIn9(BStatusNumeric v) { set(in9, v, null); }
  //endregion Property "in9"

  //region Property "col9"

  public static final Property col9 = newProperty(0, "", null);
  public String getCol9() { return getString(col9); }
  public void setCol9(String v) { setString(col9, v, null); }
  //endregion Property "col9"

  //region Property "in10"

  public static final Property in10 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn10() { return (BStatusNumeric)get(in10); }
  public void setIn10(BStatusNumeric v) { set(in10, v, null); }
  //endregion Property "in10"

  //region Property "col10"

  public static final Property col10 = newProperty(0, "", null);
  public String getCol10() { return getString(col10); }
  public void setCol10(String v) { setString(col10, v, null); }
  //endregion Property "col10"

  //region Property "in11"

  public static final Property in11 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn11() { return (BStatusNumeric)get(in11); }
  public void setIn11(BStatusNumeric v) { set(in11, v, null); }
  //endregion Property "in11"

  //region Property "col11"

  public static final Property col11 = newProperty(0, "", null);
  public String getCol11() { return getString(col11); }
  public void setCol11(String v) { setString(col11, v, null); }
  //endregion Property "col11"

  //region Property "in12"

  public static final Property in12 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn12() { return (BStatusNumeric)get(in12); }
  public void setIn12(BStatusNumeric v) { set(in12, v, null); }
  //endregion Property "in12"

  //region Property "col12"

  public static final Property col12 = newProperty(0, "", null);
  public String getCol12() { return getString(col12); }
  public void setCol12(String v) { setString(col12, v, null); }
  //endregion Property "col12"

  //region Property "in13"

  public static final Property in13 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn13() { return (BStatusNumeric)get(in13); }
  public void setIn13(BStatusNumeric v) { set(in13, v, null); }
  //endregion Property "in13"

  //region Property "col13"

  public static final Property col13 = newProperty(0, "", null);
  public String getCol13() { return getString(col13); }
  public void setCol13(String v) { setString(col13, v, null); }
  //endregion Property "col13"

  //region Property "in14"

  public static final Property in14 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn14() { return (BStatusNumeric)get(in14); }
  public void setIn14(BStatusNumeric v) { set(in14, v, null); }
  //endregion Property "in14"

  //region Property "col14"

  public static final Property col14 = newProperty(0, "", null);
  public String getCol14() { return getString(col14); }
  public void setCol14(String v) { setString(col14, v, null); }
  //endregion Property "col14"

  //region Property "in15"

  public static final Property in15 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn15() { return (BStatusNumeric)get(in15); }
  public void setIn15(BStatusNumeric v) { set(in15, v, null); }
  //endregion Property "in15"

  //region Property "col15"

  public static final Property col15 = newProperty(0, "", null);
  public String getCol15() { return getString(col15); }
  public void setCol15(String v) { setString(col15, v, null); }
  //endregion Property "col15"

  //region Property "in16"

  public static final Property in16 = newProperty(Flags.SUMMARY, new BStatusNumeric(), null);
  public BStatusNumeric getIn16() { return (BStatusNumeric)get(in16); }
  public void setIn16(BStatusNumeric v) { set(in16, v, null); }
  //endregion Property "in16"

  //region Property "col16"

  public static final Property col16 = newProperty(0, "", null);
  public String getCol16() { return getString(col16); }
  public void setCol16(String v) { setString(col16, v, null); }
  //endregion Property "col16"

  //region Action "writeData"

  public static final Action writeData = newAction(0, null);
  public void writeData() { invoke(writeData, null, null); }

  //endregion Action "writeData"

  //region Action "createTable"

  public static final Action createTable = newAction(Flags.CONFIRM_REQUIRED, null);
  public void createTable() { invoke(createTable, null, null); }

  //endregion Action "createTable"

  //region Type

  @Override
  public Type getType() { return TYPE; }
  public static final Type TYPE = Sys.loadType(BTimescaleTableWriter.class);

  //endregion Type
//@formatter:on
//endregion /*+ ------------ END BAJA AUTO GENERATED CODE -------------- +*/

  private static final Logger LOG = Logger.getLogger("timescale.writer");

  private static final int N = 16;

  private Clock.Ticket ticket;
  private volatile long lastCovWriteMs;

  ////////////////////////////////////////////////////////////////
  // Yasam dongusu
  ////////////////////////////////////////////////////////////////

  @Override
  public void started()
    throws Exception
  {
    super.started();
    reschedule();
  }

  @Override
  public void stopped()
    throws Exception
  {
    cancelTicket();
    super.stopped();
  }

  @Override
  public void changed(Property p, Context cx)
  {
    super.changed(p, cx);
    if (!isRunning()) { return; }

    if (p == writeInterval)
    {
      reschedule();
      return;
    }

    // Saklama / sikistirma suresi degistiginde veritabanindaki politikayi da
    // guncelle. Aksi halde kullanici sayiyi degistirir, Workbench'te yeni
    // degeri gorur ama veritabaninda eski politika yururlukte kalirdi.
    if (p == retentionYears || p == compressAfterDays)
    {
      reapplyPolicies();
      return;
    }

    if (getWriteOnChange() && isInput(p))
    {
      long now = Clock.millis();
      long min = getCovMinInterval().getMillis();
      if (now - lastCovWriteMs >= min)
      {
        lastCovWriteMs = now;
        doWriteData();
      }
    }
  }

  private static boolean isInput(Property p)
  {
    String n = p.getName();
    if (n.length() < 3 || !n.startsWith("in")) { return false; }
    for (int i = 2; i < n.length(); i++)
    {
      if (!Character.isDigit(n.charAt(i))) { return false; }
    }
    return true;
  }

  private void reschedule()
  {
    cancelTicket();
    long ms = getWriteInterval().getMillis();
    if (ms > 0)
    {
      ticket = Clock.schedulePeriodically(this, BRelTime.make(ms), writeData, null);
    }
  }

  private void cancelTicket()
  {
    Clock.Ticket t = ticket;
    ticket = null;
    if (t != null) { t.cancel(); }
  }

  ////////////////////////////////////////////////////////////////
  // Aksiyonlar
  ////////////////////////////////////////////////////////////////

  /**
   * Girislerin anlik degerlerini tabloya tek satir olarak yazar.
   * Degerler BURADA (Engine thread) okunur, yazma arka planda yapilir.
   */
  public void doWriteData()
  {
    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    final String schema;
    final String table;
    final String[] cols = new String[N];
    final Double[] vals = new Double[N];
    final int id = getRowId();
    final String nm = getRowName();

    try
    {
      schema = TsSchema.validateIdentifier(dev.getSchemaName());
      table = TsSchema.normalizeIdentifier(getTableName());
      for (int i = 0; i < N; i++)
      {
        cols[i] = TsSchema.normalizeIdentifier(columnName(i + 1));
        BStatusNumeric sn = input(i + 1);
        BStatus st = sn.getStatus();
        double v = sn.getValue();
        boolean bad = st.isNull() || st.isFault() || st.isDown()
          || Double.isNaN(v) || Double.isInfinite(v);
        vals[i] = bad ? null : Double.valueOf(v);
      }
    }
    catch (Exception e)
    {
      fail(e);
      return;
    }

    final long ts = Clock.millis();

    dev.postAsync(() -> {
      try
      {
        dev.withControl((conn, reg) -> {
          try (java.sql.PreparedStatement ps =
                 conn.raw().prepareStatement(TsWideTable.buildInsertSql(schema, table, cols)))
          {
            ps.setTimestamp(1, new java.sql.Timestamp(ts),
              java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")));
            ps.setLong(2, id);
            if (nm == null || nm.isEmpty()) { ps.setNull(3, java.sql.Types.VARCHAR); }
            else { ps.setString(3, nm); }
            for (int i = 0; i < N; i++)
            {
              if (vals[i] == null) { ps.setNull(4 + i, java.sql.Types.DOUBLE); }
              else { ps.setDouble(4 + i, vals[i].doubleValue()); }
            }
            ps.executeUpdate();
          }
          conn.commit();
          return null;
        });

        setRowsWritten(getRowsWritten() + 1);
        setLastWriteTime(BAbsTime.make(ts));
        setLastError("");
        setStatus(BStatus.ok);
      }
      catch (Exception e)
      {
        fail(e);
      }
    });
  }

  /**
   * Tabloyu olusturur (varsa dokunmaz), hypertable yapar, sikistirma ve
   * saklama politikalarini uygular, eksik sutunlari ekler.
   */
  public void doCreateTable()
  {
    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    final String schema;
    final String table;
    final String[] cols = new String[N];
    try
    {
      schema = TsSchema.validateIdentifier(dev.getSchemaName());
      table = TsSchema.normalizeIdentifier(getTableName());
      for (int i = 0; i < N; i++) { cols[i] = TsSchema.normalizeIdentifier(columnName(i + 1)); }
    }
    catch (Exception e)
    {
      fail(e);
      return;
    }

    final int compressDays = Math.max(1, getCompressAfterDays());
    final int keepYears = Math.max(1, getRetentionYears());

    dev.postAsync(() -> {
      try
      {
        String warn = dev.withControl((conn, reg) -> {
          // 1) Zorunlu kisim: tablo + sutunlar + indeks.
          //    Duz PostgreSQL ile calisir; tek islem.
          try (java.sql.Statement st = conn.raw().createStatement())
          {
            for (String sql : TsWideTable.buildCoreDdl(schema, table, cols)) { st.execute(sql); }
          }
          conn.commit();

          // 2) Hypertable -- AYRI islem.
          //    timescaledb eklentisi yoksa burasi patlar; tablo yine de
          //    ayakta kalir ve veri yazilmaya devam eder.
          boolean hyper;
          try (java.sql.Statement st = conn.raw().createStatement())
          {
            st.execute(TsWideTable.buildHypertableDdl(schema, table));
            conn.commit();
            hyper = true;
          }
          catch (java.sql.SQLException e)
          {
            conn.rollbackQuietly();
            hyper = false;
            LOG.log(Level.WARNING, "Hypertable yapilamadi: " + schema + '.' + table, e);
          }

          if (!hyper)
          {
            // Sikistirma ve saklama yalnizca hypertable'da calisir;
            // denemek anlamsiz, uyariyi cogaltmaktan baska ise yaramaz.
            return "timescaledb eklentisi bulunamadi. Tablo DUZ PostgreSQL "
              + "tablosu olarak olusturuldu ve veri yaziliyor; hypertable, "
              + "sikistirma ve saklama politikasi YOK. Eklentiyi kurup "
              + "Create Table'i tekrar calistirin.";
          }

          // 3) Istege bagli kisim: sikistirma ve saklama politikalari.
          return applyPolicies(conn, schema, table, compressDays, keepYears);
        });

        setLastWriteTime(BAbsTime.make(Clock.millis()));
        if (warn == null || warn.isEmpty())
        {
          setLastError("");
          setStatus(BStatus.ok);
          LOG.info("Tablo hazir: " + schema + '.' + table
            + "  (sikistirma " + compressDays + " gun, saklama " + keepYears + " yil)");
        }
        else
        {
          // Tablo var ve yazilabilir; sadece politikalar eksik.
          setLastError("Tablo olusturuldu, politikalar uygulanamadi: " + warn);
          setStatus(BStatus.ok);
          LOG.warning("Tablo olustu ama politikalar eksik: " + schema + '.' + table
            + "  -> " + warn);
        }
      }
      catch (Exception e)
      {
        fail(e);
      }
    });
  }

  /**
   * Sikistirma ve saklama politikalarini uygular (tablonun var oldugu varsayilir).
   * <p>
   * Her grup <b>ayri islemde</b> calisir: sunucuda timescaledb yoksa ya da
   * bir politika reddedilirse tablo ve icindeki veri etkilenmez; yalnizca
   * uyari metni doner.
   *
   * @return bos dize = her sey tamam; aksi halde sorunlarin ozeti
   */
  private static String applyPolicies(com.akyllyoy.timescale.db.TsConnection conn,
                                      String schema, String table,
                                      int compressDays, int keepYears)
  {
    StringBuilder problems = new StringBuilder();

    for (String[] group : TsWideTable.buildPolicyDdl(schema, table, compressDays, keepYears))
    {
      try (java.sql.Statement st = conn.raw().createStatement())
      {
        // Grup icindeki ifadeler birlikte commit edilir: "kaldir + ekle"
        // arasinda politikasiz bir an olusmasin.
        for (String sql : group) { st.execute(sql); }
        conn.commit();
      }
      catch (java.sql.SQLException e)
      {
        conn.rollbackQuietly();
        if (problems.length() > 0) { problems.append(" | "); }
        problems.append(shortMessage(e));
        LOG.log(Level.WARNING, "Politika uygulanamadi: " + group[group.length - 1], e);
      }
    }
    return problems.toString();
  }

  /**
   * {@code retentionYears} / {@code compressAfterDays} degistiginde
   * politikalari veritabaninda gunceller.
   * <p>
   * Kullanici Workbench'te sayiyi degistirip Save'e bastiginda degisikligin
   * gercekten uygulanmasi icin. Tablo henuz yoksa sessizce vazgecilir --
   * Create Table zaten politikalari da uygulayacaktir.
   */
  private void reapplyPolicies()
  {
    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    final String schema;
    final String table;
    try
    {
      schema = TsSchema.validateIdentifier(dev.getSchemaName());
      table = TsSchema.normalizeIdentifier(getTableName());
    }
    catch (Exception e)
    {
      return;   // ad gecersiz; Create Table zaten anlamli hata verecek
    }

    final int compressDays = Math.max(1, getCompressAfterDays());
    final int keepYears = Math.max(1, getRetentionYears());

    dev.postAsync(() -> {
      try
      {
        String warn = dev.withControl((conn, reg) -> {
          if (!tableExists(conn, schema, table)) { return null; }
          return applyPolicies(conn, schema, table, compressDays, keepYears);
        });

        if (warn == null)
        {
          LOG.fine("Tablo henuz yok; politika guncellemesi atlandi: "
            + schema + '.' + table);
        }
        else if (warn.isEmpty())
        {
          setLastError("");
          LOG.info("Politikalar guncellendi: " + schema + '.' + table
            + "  (sikistirma " + compressDays + " gun, saklama " + keepYears + " yil)");
        }
        else
        {
          setLastError("Politikalar guncellenemedi: " + warn);
        }
      }
      catch (Exception e)
      {
        // Politika guncellemesi veri yazmayi durdurmaz; yalnizca bildirilir.
        setLastError("Politikalar guncellenemedi: " + shortMessage(e));
      }
    });
  }

  private static boolean tableExists(com.akyllyoy.timescale.db.TsConnection conn,
                                     String schema, String table)
    throws java.sql.SQLException
  {
    try (java.sql.PreparedStatement ps = conn.raw().prepareStatement(
      "SELECT 1 FROM information_schema.tables "
    + "WHERE table_schema = ? AND table_name = ?"))
    {
      ps.setString(1, schema);
      ps.setString(2, table);
      try (java.sql.ResultSet rs = ps.executeQuery())
      {
        boolean found = rs.next();
        conn.commit();
        return found;
      }
    }
  }


  ////////////////////////////////////////////////////////////////
  // Yardimcilar

  ////////////////////////////////////////////////////////////////

  /** i. girisin sutun adi: colN doluysa o, degilse "inN". */
  private String columnName(int i)
  {
    String c = getString(getProperty("col" + i));
    if (c == null || c.trim().isEmpty()) { return "in" + i; }
    return c.trim();
  }

  private BStatusNumeric input(int i)
  {
    return (BStatusNumeric) get(getProperty("in" + i));
  }

  /** deviceOrd'un gosterdigi TimescaleDevice; bulunamazsa null (hata yazilir). */
  /**
   * Yapilandirilan cihazi bulur.
   * <p>
   * ORD tutmazsa istasyonda TimescaleDevice aranir; <b>tek bir tane</b>
   * varsa o kullanilir ve {@code deviceOrd} ozelligi ona gore duzeltilir --
   * boylece kullanici property sheet'te ne oldugunu gorur. Birden fazla
   * varsa secim yapilmaz; hata metni adaylari listeler.
   * <p>
   * Bu metot yalnizca Engine thread'inden cagrilir, dolayisiyla ozellik
   * yazmak guvenlidir.
   */
  private BTimescaleDevice findDevice()
  {
    TsDeviceLookup.Result r = TsDeviceLookup.find(this, getDeviceOrd());

    if (r.device != null)
    {
      if (r.foundByScan)
      {
        // ORD yanlisti ama cihaz belliydi: ORD'u duzelt ve haber ver.
        String fixed = TsDeviceLookup.slotPath(r.device);
        LOG.info("[" + getName() + "] deviceOrd cozulemedi; istasyondaki tek "
          + "TimescaleDevice kullaniliyor: " + fixed);
        try { setDeviceOrd(BOrd.make(fixed)); }
        catch (Exception ignore) { /* duzeltemedik; yine de cihazi kullaniyoruz */ }
      }
      return r.device;
    }

    setLastError(r.error);
    setStatus(BStatus.fault);
    return null;
  }

  private void fail(Throwable t)
  {
    String m = shortMessage(t);
    setLastError(m);
    setStatus(BStatus.fault);
    LOG.log(Level.WARNING, "[" + getName() + "] " + m, t);
  }

  private static String shortMessage(Throwable t)
  {
    String m = t.getMessage();
    if (m == null || m.isEmpty()) { m = t.toString(); }
    return m.length() > 250 ? m.substring(0, 250) + "..." : m;
  }

  @Override
  public boolean isParentLegal(BComponent parent)
  {
    return true;
  }
}
