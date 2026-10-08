/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.baja.collection.BITable;
import javax.baja.history.BBooleanTrendRecord;
import javax.baja.history.BCollectionInterval;
import javax.baja.history.BEnumTrendRecord;
import javax.baja.history.BHistoryConfig;
import javax.baja.history.BHistoryId;
import javax.baja.history.BHistoryRecord;
import javax.baja.history.BHistoryService;
import javax.baja.history.BIHistory;
import javax.baja.history.BNumericTrendRecord;
import javax.baja.history.BStringTrendRecord;
import javax.baja.history.BTrendFlags;
import javax.baja.history.BTrendRecord;
import javax.baja.history.HistorySpaceConnection;
import javax.baja.history.db.BHistoryDatabase;
import javax.baja.naming.BOrd;
import javax.baja.naming.BOrdList;
import javax.baja.nre.annotations.NiagaraAction;
import javax.baja.nre.annotations.NiagaraProperty;
import javax.baja.nre.annotations.NiagaraType;
import javax.baja.status.BStatus;
import javax.baja.sys.Action;
import javax.baja.sys.BAbsTime;
import javax.baja.sys.BComponent;
import javax.baja.sys.BDynamicEnum;
import javax.baja.sys.BObject;
import javax.baja.sys.BRelTime;
import javax.baja.sys.Clock;
import javax.baja.sys.Context;
import javax.baja.sys.Cursor;
import javax.baja.sys.Flags;
import javax.baja.sys.Property;
import javax.baja.sys.Sys;
import javax.baja.sys.Type;

import com.akyllyoy.timescale.db.TsExportState;
import com.akyllyoy.timescale.db.TsHistoryFilter;
import com.akyllyoy.timescale.db.TsPolicy;
import com.akyllyoy.timescale.db.TsPointMeta;
import com.akyllyoy.timescale.db.TsSample;
import com.akyllyoy.timescale.db.TsValueType;
import com.akyllyoy.timescale.db.TsWriteQueue;

/**
 * Niagara history (trend) kayitlarini TimescaleDB'ye aktaran motor.
 * <p>
 * <b>Nasil calisir</b>
 * <ol>
 *   <li>Station'in history veritabanindaki history'ler taranir,
 *       {@code includeFilter} / {@code excludeFilter} ile suzulur.</li>
 *   <li>Her history icin {@code <sema>.point} tablosunda bir kimlik
 *       (point_id) olusturulur/guncellenir; birim, kaynak ORD, toplama
 *       araligi gibi metadata da oraya yazilir.</li>
 *   <li>{@code <sema>.export_state} tablosundan o point'in <b>watermark</b>'i
 *       -- en son aktarilan kaydin zamani -- okunur.</li>
 *   <li>Yalnizca watermark'tan <b>sonraki</b> kayitlar
 *       {@code timeQuery} ile okunur (tum gecmis her turda taranmaz) ve
 *       yazma kuyruguna verilir. Ilk calismada watermark yoktur: tum gecmis
 *       aktarilir, istenirse {@code backfillMaxDays} ile sinirlanir.</li>
 *   <li>Kuyruk toplu (batch) yazar;
 *       {@code ON CONFLICT (point_id, time) DO NOTHING} ayni kaydin ikinci
 *       kez yazilmasini engeller.</li>
 *   <li>Tur basarili biterse watermark ilerletilir. Hata olursa watermark
 *       <b>yerinde kalir</b>; bir sonraki tur ayni noktadan devam eder.</li>
 * </ol>
 *
 * <b>Baglanti kesilirse:</b> Kuyruk kayitlari elde tutar ve ustel geri
 * cekilme ile yeniden dener. Kuyruk dolarsa okuma durur -- veri Niagara
 * history'sinde durmaya devam ettigi icin kaybolmaz; baglanti gelince
 * watermark'tan devam edilir.
 * <p>
 * <b>Station yeniden baslarsa:</b> Watermark station'da degil
 * <b>veritabaninda</b> tutuldugu icin kaldigi yerden devam eder.
 * <p>
 * <b>Thread notu:</b> Tum history okumasi ve JDBC isi arka planda calisir;
 * Engine thread hicbir zaman beklemez.
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
  name = "enabled",
  type = "boolean",
  defaultValue = "true"
)
@NiagaraProperty(
  name = "includeFilter",
  type = "String",
  defaultValue = "\"*\""
)
@NiagaraProperty(
  name = "excludeFilter",
  type = "String",
  defaultValue = "\"\""
)
@NiagaraProperty(
  name = "pollInterval",
  type = "BRelTime",
  defaultValue = "BRelTime.makeMinutes(5)"
)
@NiagaraProperty(
  name = "backfillMaxDays",
  type = "int",
  defaultValue = "0"
)
@NiagaraProperty(
  name = "maxRecordsPerHistory",
  type = "int",
  defaultValue = "50000"
)
@NiagaraProperty(
  name = "maxRecordsPerCycle",
  type = "int",
  defaultValue = "500000"
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
  name = "status",
  type = "BStatus",
  defaultValue = "BStatus.ok",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "lastRun",
  type = "BAbsTime",
  defaultValue = "BAbsTime.NULL",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraProperty(
  name = "lastRunDuration",
  type = "BRelTime",
  defaultValue = "BRelTime.DEFAULT",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraProperty(
  name = "historiesMatched",
  type = "int",
  defaultValue = "0",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "rowsExported",
  type = "long",
  defaultValue = "0L",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "queueDepth",
  type = "int",
  defaultValue = "0",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraProperty(
  name = "caughtUp",
  type = "boolean",
  defaultValue = "false",
  flags = Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY
)
@NiagaraProperty(
  name = "lastError",
  type = "String",
  defaultValue = "\"\"",
  flags = Flags.READONLY | Flags.TRANSIENT
)
@NiagaraAction(name = "exportNow")
@NiagaraAction(name = "resetWatermarks", flags = Flags.CONFIRM_REQUIRED)
@NiagaraAction(name = "applyPolicies")
public class BTimescaleHistoryExport
  extends BComponent
{
//region /*+ ------------ BEGIN BAJA AUTO GENERATED CODE ------------ +*/
//@formatter:off
/*@ $com.akyllyoy.timescale.BTimescaleHistoryExport(2979906276)1.0$ @*/
/* Generated by slotgen.py - Slot-o-Matic yerine */

  //region Property "deviceOrd"

  public static final Property deviceOrd = newProperty(0, BOrd.make("station:|slot:/Drivers/TimescaleNetwork/TimescaleDatabase"), null);
  public BOrd getDeviceOrd() { return (BOrd)get(deviceOrd); }
  public void setDeviceOrd(BOrd v) { set(deviceOrd, v, null); }
  //endregion Property "deviceOrd"

  //region Property "enabled"

  public static final Property enabled = newProperty(0, true, null);
  public boolean getEnabled() { return getBoolean(enabled); }
  public void setEnabled(boolean v) { setBoolean(enabled, v, null); }
  //endregion Property "enabled"

  //region Property "includeFilter"

  public static final Property includeFilter = newProperty(0, "*", null);
  public String getIncludeFilter() { return getString(includeFilter); }
  public void setIncludeFilter(String v) { setString(includeFilter, v, null); }
  //endregion Property "includeFilter"

  //region Property "excludeFilter"

  public static final Property excludeFilter = newProperty(0, "", null);
  public String getExcludeFilter() { return getString(excludeFilter); }
  public void setExcludeFilter(String v) { setString(excludeFilter, v, null); }
  //endregion Property "excludeFilter"

  //region Property "pollInterval"

  public static final Property pollInterval = newProperty(0, BRelTime.makeMinutes(5), null);
  public BRelTime getPollInterval() { return (BRelTime)get(pollInterval); }
  public void setPollInterval(BRelTime v) { set(pollInterval, v, null); }
  //endregion Property "pollInterval"

  //region Property "backfillMaxDays"

  public static final Property backfillMaxDays = newProperty(0, 0, null);
  public int getBackfillMaxDays() { return getInt(backfillMaxDays); }
  public void setBackfillMaxDays(int v) { setInt(backfillMaxDays, v, null); }
  //endregion Property "backfillMaxDays"

  //region Property "maxRecordsPerHistory"

  public static final Property maxRecordsPerHistory = newProperty(0, 50000, null);
  public int getMaxRecordsPerHistory() { return getInt(maxRecordsPerHistory); }
  public void setMaxRecordsPerHistory(int v) { setInt(maxRecordsPerHistory, v, null); }
  //endregion Property "maxRecordsPerHistory"

  //region Property "maxRecordsPerCycle"

  public static final Property maxRecordsPerCycle = newProperty(0, 500000, null);
  public int getMaxRecordsPerCycle() { return getInt(maxRecordsPerCycle); }
  public void setMaxRecordsPerCycle(int v) { setInt(maxRecordsPerCycle, v, null); }
  //endregion Property "maxRecordsPerCycle"

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

  //region Property "status"

  public static final Property status = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, BStatus.ok, null);
  public BStatus getStatus() { return (BStatus)get(status); }
  public void setStatus(BStatus v) { set(status, v, null); }
  //endregion Property "status"

  //region Property "lastRun"

  public static final Property lastRun = newProperty(Flags.READONLY | Flags.TRANSIENT, BAbsTime.NULL, null);
  public BAbsTime getLastRun() { return (BAbsTime)get(lastRun); }
  public void setLastRun(BAbsTime v) { set(lastRun, v, null); }
  //endregion Property "lastRun"

  //region Property "lastRunDuration"

  public static final Property lastRunDuration = newProperty(Flags.READONLY | Flags.TRANSIENT, BRelTime.DEFAULT, null);
  public BRelTime getLastRunDuration() { return (BRelTime)get(lastRunDuration); }
  public void setLastRunDuration(BRelTime v) { set(lastRunDuration, v, null); }
  //endregion Property "lastRunDuration"

  //region Property "historiesMatched"

  public static final Property historiesMatched = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, 0, null);
  public int getHistoriesMatched() { return getInt(historiesMatched); }
  public void setHistoriesMatched(int v) { setInt(historiesMatched, v, null); }
  //endregion Property "historiesMatched"

  //region Property "rowsExported"

  public static final Property rowsExported = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, 0L, null);
  public long getRowsExported() { return getLong(rowsExported); }
  public void setRowsExported(long v) { setLong(rowsExported, v, null); }
  //endregion Property "rowsExported"

  //region Property "queueDepth"

  public static final Property queueDepth = newProperty(Flags.READONLY | Flags.TRANSIENT, 0, null);
  public int getQueueDepth() { return getInt(queueDepth); }
  public void setQueueDepth(int v) { setInt(queueDepth, v, null); }
  //endregion Property "queueDepth"

  //region Property "caughtUp"

  public static final Property caughtUp = newProperty(Flags.READONLY | Flags.TRANSIENT | Flags.SUMMARY, false, null);
  public boolean getCaughtUp() { return getBoolean(caughtUp); }
  public void setCaughtUp(boolean v) { setBoolean(caughtUp, v, null); }
  //endregion Property "caughtUp"

  //region Property "lastError"

  public static final Property lastError = newProperty(Flags.READONLY | Flags.TRANSIENT, "", null);
  public String getLastError() { return getString(lastError); }
  public void setLastError(String v) { setString(lastError, v, null); }
  //endregion Property "lastError"

  //region Action "exportNow"

  public static final Action exportNow = newAction(0, null);
  public void exportNow() { invoke(exportNow, null, null); }

  //endregion Action "exportNow"

  //region Action "resetWatermarks"

  public static final Action resetWatermarks = newAction(Flags.CONFIRM_REQUIRED, null);
  public void resetWatermarks() { invoke(resetWatermarks, null, null); }

  //endregion Action "resetWatermarks"

  //region Action "applyPolicies"

  public static final Action applyPolicies = newAction(0, null);
  public void applyPolicies() { invoke(applyPolicies, null, null); }

  //endregion Action "applyPolicies"

  //region Type

  @Override
  public Type getType() { return TYPE; }
  public static final Type TYPE = Sys.loadType(BTimescaleHistoryExport.class);

  //endregion Type
//@formatter:on
//endregion /*+ ------------ END BAJA AUTO GENERATED CODE -------------- +*/

  private static final Logger LOG = Logger.getLogger("timescale.history");

  /** Kayitlar gelecege dusmez; yine de saat kaymasina paylik birakiyoruz. */
  private static final long FUTURE_MARGIN_MS = 3600000L;

  private Clock.Ticket ticket;

  /** Ayni anda iki tur calismasin (uzun backfill sirasinda tetiklenmeye karsi). */
  private volatile boolean busy;

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
    if (!isRunning()) { return; }
    if (p == pollInterval || p == enabled) { reschedule(); return; }

    // Saklama / sikistirma suresi degistiginde veritabanindaki politikayi da
    // gunceller. Aksi halde kullanici sayiyi degistirir, Workbench'te yeni
    // degeri gorur, ama veritabaninda eski politika yururlukte kalirdi.
    if (p == retentionYears || p == compressAfterDays) { doApplyPolicies(); }
  }

  private void reschedule()
  {
    cancelTicket();
    if (!getEnabled()) { return; }
    long ms = getPollInterval().getMillis();
    if (ms < 10000L) { ms = 10000L; }  // 10 sn'den sik calistirma
    ticket = Clock.schedulePeriodically(this, BRelTime.make(ms), exportNow, null);
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
   * Bir aktarim turu calistirir.
   * <p>
   * Bu metot Engine thread'inde cagrilir ve <b>bloke etmez</b>: burada
   * yalnizca yapilandirma okunur, gerisi cihazin arka plan thread'inde yapilir.
   */
  public void doExportNow()
  {
    if (!getEnabled()) { return; }

    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    if (busy)
    {
      LOG.fine("Onceki aktarim turu suruyor; bu tur atlandi");
      return;
    }

    // --- Engine thread'de okunmasi gerekenler ---
    final String station = dev.getStationName();
    final String schema = dev.getSchemaName();
    final TsHistoryFilter filter =
      new TsHistoryFilter(getIncludeFilter(), getExcludeFilter());
    final int maxPerHistory = Math.max(1, getMaxRecordsPerHistory());
    final int maxPerCycle = Math.max(1, getMaxRecordsPerCycle());
    final int backfillDays = Math.max(0, getBackfillMaxDays());

    final BHistoryDatabase db;
    try
    {
      BHistoryService svc = (BHistoryService) Sys.getService(BHistoryService.TYPE);
      db = svc.getDatabase();
      if (db == null) { throw new IllegalStateException("History veritabani yok"); }
    }
    catch (Exception e)
    {
      fail("History servisi bulunamadi: " + shortMessage(e));
      return;
    }

    busy = true;
    final long t0 = Clock.millis();

    dev.postAsync(() -> {
      try
      {
        Result r = runCycle(dev, db, schema, station, filter,
                            maxPerHistory, maxPerCycle, backfillDays);

        TsWriteQueue q = dev.getWriteQueue();

        setHistoriesMatched(r.matched);
        setRowsExported(getRowsExported() + r.rows);
        setQueueDepth(q == null ? 0 : q.queueDepth());
        setCaughtUp(r.caughtUp);
        setLastRun(BAbsTime.make(Clock.millis()));
        setLastRunDuration(BRelTime.make(Clock.millis() - t0));

        if (r.errors.isEmpty())
        {
          setLastError("");
          setStatus(BStatus.ok);
        }
        else
        {
          setLastError(r.errors.size() + " history hatali. Ilki -> " + r.errors.get(0));
          setStatus(BStatus.fault);
        }

        LOG.info("History aktarimi: " + r.matched + " history, " + r.rows
          + " kayit, " + (Clock.millis() - t0) + " ms"
          + (r.caughtUp ? ", guncel" : ", devam edecek")
          + (r.errors.isEmpty() ? "" : ", " + r.errors.size() + " hata"));
      }
      catch (Exception e)
      {
        fail(e);
      }
      finally
      {
        busy = false;
      }
    });
  }

  /**
   * Tum watermark'lari sifirlar; bir sonraki tur her seyi bastan okur.
   * Kayitlar {@code ON CONFLICT} sayesinde cogalmaz, yalnizca yeniden gonderilir.
   */
  public void doResetWatermarks()
  {
    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    final String schema = dev.getSchemaName();

    dev.postAsync(() -> {
      try
      {
        final TsExportState state = new TsExportState(schema);
        Integer n = dev.withControl((conn, reg) ->
          Integer.valueOf(state.resetAll(conn)));

        setCaughtUp(false);
        setLastError("");
        setStatus(BStatus.ok);
        LOG.info("Watermark sifirlandi: " + n + " point");
      }
      catch (Exception e)
      {
        fail(e);
      }
    });
  }

  /**
   * Dort history tablosuna ({@code hist_numeric}, {@code hist_boolean},
   * {@code hist_enum}, {@code hist_string}) sikistirma ve saklama
   * politikalarini uygular.
   * <p>
   * {@code retentionYears} ya da {@code compressAfterDays} degistiginde
   * kendiliginden calisir; elle de tetiklenebilir.
   * <p>
   * Her grup <b>ayri islemde</b> calisir: sunucuda timescaledb yoksa ya da
   * bir politika reddedilirse tablolar ve icindeki veri etkilenmez, yalnizca
   * {@code lastError}'a uyari yazilir. Aktarim calismaya devam eder.
   */
  public void doApplyPolicies()
  {
    final BTimescaleDevice dev = findDevice();
    if (dev == null) { return; }

    final String schema = dev.getSchemaName();
    final int compressDays = Math.max(1, getCompressAfterDays());
    final int keepYears = Math.max(1, getRetentionYears());

    dev.postAsync(() -> {
      try
      {
        String warn = dev.withControl((conn, reg) -> {
          StringBuilder problems = new StringBuilder();
          for (String[] group : TsPolicy.buildAll(schema, compressDays, keepYears))
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
              LOG.log(Level.WARNING, "Politika uygulanamadi: "
                + group[group.length - 1], e);
            }
          }
          return problems.toString();
        });

        if (warn == null || warn.isEmpty())
        {
          setLastError("");
          LOG.info("History tablolarina politika uygulandi: sikistirma "
            + compressDays + " gun, saklama " + keepYears + " yil");
        }
        else
        {
          setLastError("Politikalar uygulanamadi: " + warn);
        }
      }
      catch (Exception e)
      {
        // Politika uygulamasi aktarimi durdurmaz; yalnizca bildirilir.
        setLastError("Politikalar uygulanamadi: " + shortMessage(e));
      }
    });
  }

  ////////////////////////////////////////////////////////////////
  // Aktarim turu (arka plan thread'i)
  ////////////////////////////////////////////////////////////////

  private static final class Result
  {
    int matched;
    long rows;
    boolean caughtUp = true;
    final List<String> errors = new ArrayList<>();
  }

  private Result runCycle(BTimescaleDevice dev, BHistoryDatabase db, String schema,
                          String station, TsHistoryFilter filter,
                          int maxPerHistory, int maxPerCycle, int backfillDays)
    throws Exception
  {
    Result res = new Result();

    TsWriteQueue q = dev.getWriteQueue();
    if (q == null || !q.isRunning())
    {
      throw new IllegalStateException(
        "Yazma kuyrugu calismiyor. TimescaleDevice enabled ve baglanti kurulu mu?");
    }

    final TsExportState state = new TsExportState(schema);

    // 1) Tum watermark'lar tek sorguda
    final Map<Long, Long> watermarks = dev.withControl((conn, reg) -> state.loadAll(conn));

    // 2) History'leri suz
    BIHistory[] all = db.getHistories();
    List<BIHistory> selected = new ArrayList<>();
    for (int i = 0; i < all.length; i++)
    {
      BIHistory h = all[i];
      if (h == null) { continue; }
      String id = idOf(h);
      if (id != null && filter.accept(id)) { selected.add(h); }
    }
    res.matched = selected.size();

    long budget = maxPerCycle;
    final long now = Clock.millis();
    final long backfillFrom = backfillDays <= 0 ? 0L : now - (long) backfillDays * 86400000L;

    // 3) History'leri sirayla isle
    for (int i = 0; i < selected.size(); i++)
    {
      if (budget <= 0)
      {
        res.caughtUp = false;
        LOG.info("Tur butcesi doldu (" + maxPerCycle
          + " kayit); kalan history'ler bir sonraki turda");
        break;
      }

      BIHistory h = selected.get(i);
      long pointId = -1L;

      try
      {
        // 3a) point kimligi + metadata (upsert)
        final TsPointMeta meta = metaOf(h, station);
        pointId = dev.withControl((conn, reg) -> Long.valueOf(reg.resolve(conn, meta)))
                     .longValue();

        // 3b) nereden devam edilecek
        Long wm = watermarks.get(Long.valueOf(pointId));
        // watermark varsa ondan SONRASI; yoksa backfill baslangici
        long fromMs = wm == null ? backfillFrom : wm.longValue() + 1L;

        // 3c) oku + kuyruga ver
        int limit = (int) Math.min(maxPerHistory, budget);
        Progress p = pump(db, q, h, pointId, fromMs, now + FUTURE_MARGIN_MS,
                          limit, meta.valueType);

        budget -= p.count;
        res.rows += p.count;
        if (p.more) { res.caughtUp = false; }

        // 3d) yalnizca gercekten yazilmis kayit varsa watermark ilerlet
        if (p.count > 0)
        {
          final long fpid = pointId;
          final long flast = p.lastTime;
          final long fcount = p.count;
          dev.withControl((conn, reg) -> {
            state.markSuccess(conn, fpid, flast, fcount);
            return null;
          });
        }
      }
      catch (Exception e)
      {
        String msg = idOf(h) + ": " + shortMessage(e);
        res.errors.add(msg);
        res.caughtUp = false;
        LOG.log(Level.WARNING, "History aktarilamadi -> " + msg, e);

        if (pointId > 0)
        {
          final long fpid = pointId;
          final String fault = shortMessage(e);
          try
          {
            dev.withControl((conn, reg) -> {
              state.markFailure(conn, fpid, fault);
              return null;
            });
          }
          catch (Exception ignore)
          {
            // hatayi kaydedemedik; asil hata zaten res.errors icinde
          }
        }
      }
    }

    return res;
  }

  private static final class Progress
  {
    long count;
    long lastTime;
    /** Daha okunacak kayit kaldi mi (limit doldu ya da kuyruk doldu) */
    boolean more;
  }

  /**
   * Tek bir history'nin {@code [fromMs, toMs)} araligindaki kayitlarini
   * kuyruga verir.
   * <p>
   * Tum gecmis her turda taranmaz: {@code timeQuery} ile yalnizca gereken
   * aralik okunur.
   * <p>
   * Kuyruk dolarsa <b>durulur</b> ve {@code more=true} donulur. Okunmayan
   * kayitlar Niagara history'sinde durmaya devam eder; bir sonraki turda
   * watermark'tan alinirlar. Bu yuzden kuyruk tasmasi veri kaybi degildir.
   */
  private Progress pump(BHistoryDatabase db, TsWriteQueue q, BIHistory h,
                        long pointId, long fromMs, long toMs,
                        int limit, TsValueType vt)
    throws Exception
  {
    Progress p = new Progress();

    BAbsTime from = BAbsTime.make(fromMs);
    BAbsTime to = BAbsTime.make(toMs);

    HistorySpaceConnection hc = db.getConnection(null);
    try
    {
      BITable<BHistoryRecord> table = hc.timeQuery(h, from, to);
      Cursor<BHistoryRecord> cur = table.cursor();
      try
      {
        while (cur.next())
        {
          BHistoryRecord rec = cur.get();
          if (rec == null) { continue; }

          BAbsTime ts = rec.getTimestamp();
          if (ts == null || ts.isNull()) { continue; }
          long t = ts.getMillis();

          // timeQuery sinirlari surumler arasi kapali/acik degisebiliyor;
          // araligi burada da kendimiz dogruluyoruz.
          if (t < fromMs || t >= toMs) { continue; }

          TsSample s = toSample(rec, pointId, t, vt);
          if (s == null) { continue; }

          if (!q.offer(s))
          {
            p.more = true;   // kuyruk dolu: burada duruyoruz, veri kaybolmuyor
            break;
          }

          p.count++;
          if (t > p.lastTime) { p.lastTime = t; }

          if (p.count >= limit) { p.more = true; break; }
        }
      }
      finally
      {
        try { cur.close(); } catch (Exception ignore) { }
      }
    }
    finally
    {
      try { hc.close(); } catch (Exception ignore) { }
    }

    return p;
  }

  /** Niagara trend kaydini {@link TsSample}'a cevirir; taninmayan tipte null. */
  private static TsSample toSample(BHistoryRecord rec, long pointId, long t, TsValueType vt)
  {
    int status = 0;
    short flags = 0;
    if (rec instanceof BTrendRecord)
    {
      BTrendRecord tr = (BTrendRecord) rec;
      BStatus st = tr.getStatus();
      if (st != null) { status = st.getBits(); }
      flags = bitsOf(tr.getTrendFlags());
    }

    if (rec instanceof BNumericTrendRecord)
    {
      double v = ((BNumericTrendRecord) rec).getValue();
      // NaN/sonsuz PostgreSQL'de anlamsiz; kaydi atliyoruz
      if (Double.isNaN(v) || Double.isInfinite(v)) { return null; }
      return TsSample.numeric(pointId, t, v, status, flags, TsSample.SRC_HISTORY);
    }
    if (rec instanceof BBooleanTrendRecord)
    {
      return TsSample.bool(pointId, t, ((BBooleanTrendRecord) rec).getValue(),
        status, flags, TsSample.SRC_HISTORY);
    }
    if (rec instanceof BEnumTrendRecord)
    {
      BDynamicEnum de = ((BEnumTrendRecord) rec).getValue();
      int ord = de == null ? 0 : de.getOrdinal();
      return TsSample.enumeration(pointId, t, ord, status, flags, TsSample.SRC_HISTORY);
    }
    if (rec instanceof BStringTrendRecord)
    {
      return TsSample.string(pointId, t, ((BStringTrendRecord) rec).getValue(),
        status, flags, TsSample.SRC_HISTORY);
    }
    return null;
  }

  /**
   * {@link BTrendFlags} bit maskesi.
   * <p>
   * BTrendFlags bir {@code BBitString}'tir ve {@code getBits()} sunmaz;
   * maskeyi set edilmis ordinal'lerden kuruyoruz.
   */
  private static short bitsOf(BTrendFlags f)
  {
    if (f == null) { return 0; }
    int bits = 0;
    int[] ords = f.getOrdinals();
    if (ords != null)
    {
      for (int i = 0; i < ords.length; i++)
      {
        int o = ords[i];
        if (o >= 0 && o < 16 && f.getBit(o)) { bits |= (1 << o); }
      }
    }
    return (short) bits;
  }

  ////////////////////////////////////////////////////////////////
  // Metadata
  ////////////////////////////////////////////////////////////////

  /** History kimligi: {@code /CihazAdi/HistoryAdi} */
  private static String idOf(BIHistory h)
  {
    try
    {
      BHistoryId hid = h.getId();
      return hid == null ? null : '/' + hid.getDeviceName() + '/' + hid.getHistoryName();
    }
    catch (Exception e)
    {
      return null;
    }
  }

  private static TsPointMeta metaOf(BIHistory h, String station)
  {
    TsPointMeta m = new TsPointMeta();
    m.station = station;
    m.historyId = idOf(h);

    BHistoryId hid = h.getId();
    m.name = hid == null ? "?" : hid.getHistoryName();
    m.device = hid == null ? null : hid.getDeviceName();
    m.displayName = hid == null ? m.name : hid.getHistoryDisplayName();
    m.path = m.historyId;

    try
    {
      BHistoryConfig cfg = h.getConfig();
      if (cfg != null)
      {
        BOrdList src = cfg.getSource();
        if (src != null) { m.sourceOrd = src.encodeToString(); }

        BCollectionInterval ci = cfg.getInterval();
        if (ci != null && !ci.isIrregular() && ci.getInterval() != null)
        {
          long iv = ci.getInterval().getMillis();
          if (iv > 0L && iv < Integer.MAX_VALUE) { m.intervalMs = Integer.valueOf((int) iv); }
        }
      }
    }
    catch (Exception ignore)
    {
      // metadata eksik kalabilir; aktarimi durdurmaya degmez
    }

    m.valueType = typeOf(h);
    return m;
  }

  /** History'nin kayit tipinden deger tipini cikarir. */
  private static TsValueType typeOf(BIHistory h)
  {
    try
    {
      String rt = String.valueOf(h.getRecordType());
      if (rt.contains("Boolean")) { return TsValueType.BOOLEAN; }
      if (rt.contains("Enum"))    { return TsValueType.ENUM; }
      if (rt.contains("String"))  { return TsValueType.STRING; }
    }
    catch (Exception ignore) { }
    return TsValueType.NUMERIC;
  }

  ////////////////////////////////////////////////////////////////
  // Yardimcilar
  ////////////////////////////////////////////////////////////////

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
    fail(shortMessage(t));
    LOG.log(Level.WARNING, "[" + getName() + ']', t);
  }

  private void fail(String msg)
  {
    setLastError(msg);
    setStatus(BStatus.fault);
  }

  private static String shortMessage(Throwable t)
  {
    Throwable r = t;
    while (r.getCause() != null && r.getCause() != r) { r = r.getCause(); }
    String m = r.getMessage();
    if (m == null || m.isEmpty()) { m = r.toString(); }
    return m.length() > 300 ? m.substring(0, 300) + "..." : m;
  }
}
