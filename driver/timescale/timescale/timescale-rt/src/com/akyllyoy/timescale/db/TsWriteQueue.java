/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Sinirli kapasiteli kuyruk + tek yazici thread.
 * <p>
 * Station'in Engine thread'i asla JDBC uzerinde bloke olmaz: uretici taraf
 * yalnizca {@link #offer(TsSample)} cagirir, gercek yazma bu sinifin kendi
 * thread'inde toplu (batch) olarak yapilir.
 * <p>
 * <b>Geri basinc:</b> Kuyruk dolarsa {@link OverflowPolicy} devreye girer.
 * History export icin veri kaybi olmaz (kaynak Niagara history'sinde durur,
 * bir sonraki turda watermark'tan devam edilir); canli COV icin ise
 * en eski ornekler dusurulur.
 * <p>
 * <b>Dayaniklilik:</b> Yazma hatasinda parti elde tutulur ve ustel geri
 * cekilme ile yeniden denenir; bu sirada kuyruk dolarsa yeni ornekler
 * politikaya gore dusurulur. Boylece DB kisa sureli gittiginde veri kaybi
 * olmaz, uzun sureli gittiginde ise bellek patlamaz.
 *
 * @author Akyllyoy
 */
public final class TsWriteQueue
{
  private static final Logger LOG = Logger.getLogger("timescale.write");

  /** UTC'de baglamak icin paylasilan takvim (setTimestamp yerel TZ'ye kaymasin) */
  private static final Calendar UTC = Calendar.getInstance(TimeZone.getTimeZone("UTC"));

  public enum OverflowPolicy
  {
    /** En eskiyi at, yeniyi al (canli izleme icin dogru secim) */
    DROP_OLDEST,
    /** Yeni geleni at (gecmisi koru) */
    DROP_NEWEST
  }

  private final String schema;
  private final String label;
  private final int batchSize;
  private final long flushIntervalMs;
  private final OverflowPolicy overflow;
  private final boolean updateLive;

  private final ArrayBlockingQueue<TsSample> queue;
  private final TsConnection conn;

  private final AtomicLong rowsWritten = new AtomicLong();
  private final AtomicLong rowsDropped = new AtomicLong();
  private final AtomicLong batchesFailed = new AtomicLong();
  private volatile String lastError;
  private volatile boolean connected;

  private volatile Thread writer;
  private volatile boolean running;

  public TsWriteQueue(TsConfig cfg, String schema, int capacity, int batchSize,
                      long flushIntervalMs, OverflowPolicy overflow,
                      boolean updateLive, String label)
  {
    this.schema = TsSchema.validateIdentifier(schema);
    this.label = label;
    this.batchSize = Math.max(1, batchSize);
    this.flushIntervalMs = Math.max(100L, flushIntervalMs);
    this.overflow = overflow;
    this.updateLive = updateLive;
    this.queue = new ArrayBlockingQueue<>(Math.max(1000, capacity));
    this.conn = new TsConnection(cfg, label + "-writer");
  }

  ////////////////////////////////////////////////////////////////
  // Yasam dongusu
  ////////////////////////////////////////////////////////////////

  public synchronized void start()
  {
    if (running) { return; }
    running = true;
    Thread t = new Thread(this::runLoop, "timescale-writer-" + label);
    t.setDaemon(true);
    t.setPriority(Thread.NORM_PRIORITY - 1);
    writer = t;
    t.start();
  }

  public synchronized void stop()
  {
    running = false;
    Thread t = writer;
    if (t != null)
    {
      t.interrupt();
      try { t.join(5000L); }
      catch (InterruptedException e) { Thread.currentThread().interrupt(); }
      writer = null;
    }
    conn.closeQuietly();
    connected = false;
  }

  ////////////////////////////////////////////////////////////////
  // Uretici taraf
  ////////////////////////////////////////////////////////////////

  /**
   * Bir olcumu kuyruga koyar. Bloke etmez.
   *
   * @return kuyruga alindiysa {@code true}; dusuruldyse {@code false}
   */
  public boolean offer(TsSample s)
  {
    if (!running)
    {
      rowsDropped.incrementAndGet();
      return false;
    }
    if (queue.offer(s)) { return true; }

    if (overflow == OverflowPolicy.DROP_OLDEST)
    {
      // Bir tane yer ac; yaris durumunda tekrar denemeye gerek yok.
      if (queue.poll() != null) { rowsDropped.incrementAndGet(); }
      if (queue.offer(s)) { return true; }
    }
    rowsDropped.incrementAndGet();
    return false;
  }

  /**
   * Bir listeyi kuyruga koyar.
   *
   * @return kuyruga alinan satir sayisi
   */
  public int offerAll(List<TsSample> samples)
  {
    int n = 0;
    for (int i = 0; i < samples.size(); i++)
    {
      if (offer(samples.get(i))) { n++; }
    }
    return n;
  }

  ////////////////////////////////////////////////////////////////
  // Istatistik
  ////////////////////////////////////////////////////////////////

  public int queueDepth()      { return queue.size(); }
  public int queueCapacity()   { return queue.size() + queue.remainingCapacity(); }
  public long rowsWritten()    { return rowsWritten.get(); }
  public long rowsDropped()    { return rowsDropped.get(); }
  public long batchesFailed()  { return batchesFailed.get(); }
  public String lastError()    { return lastError; }
  public boolean isConnected() { return connected; }
  public boolean isRunning()   { return running; }

  ////////////////////////////////////////////////////////////////
  // Yazici dongusu
  ////////////////////////////////////////////////////////////////

  private void runLoop()
  {
    List<TsSample> batch = new ArrayList<>(batchSize);
    long backoffMs = 1000L;
    long lastFlush = System.currentTimeMillis();

    while (running)
    {
      try
      {
        long waitMs = flushIntervalMs - (System.currentTimeMillis() - lastFlush);
        TsSample s = queue.poll(Math.max(1L, waitMs), TimeUnit.MILLISECONDS);
        if (s != null)
        {
          batch.add(s);
          queue.drainTo(batch, batchSize - batch.size());
        }

        boolean due = batch.size() >= batchSize
          || (System.currentTimeMillis() - lastFlush) >= flushIntervalMs;

        if (batch.isEmpty())
        {
          lastFlush = System.currentTimeMillis();
          continue;
        }
        if (!due) { continue; }

        writeBatch(batch);
        rowsWritten.addAndGet(batch.size());
        batch.clear();
        lastFlush = System.currentTimeMillis();
        backoffMs = 1000L;
        connected = true;
        lastError = null;
      }
      catch (InterruptedException e)
      {
        Thread.currentThread().interrupt();
        break;
      }
      catch (Exception e)
      {
        // Parti elde kalir; geri cekilerek yeniden denenecek.
        connected = false;
        lastError = e.getMessage() != null ? e.getMessage() : e.toString();
        batchesFailed.incrementAndGet();
        LOG.log(Level.WARNING,
          "[" + label + "] parti yazilamadi (" + batch.size() + " satir), "
            + backoffMs + " ms sonra yeniden denenecek", e);
        conn.rollbackQuietly();
        conn.closeQuietly();
        try { Thread.sleep(backoffMs); }
        catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
        backoffMs = Math.min(backoffMs * 2, 60_000L);
        lastFlush = System.currentTimeMillis();
      }
    }

    // Kapanirken elde kalani son bir kez yazmayi dene.
    if (!batch.isEmpty())
    {
      try
      {
        writeBatch(batch);
        rowsWritten.addAndGet(batch.size());
      }
      catch (Exception e)
      {
        rowsDropped.addAndGet(batch.size());
        LOG.log(Level.WARNING, "[" + label + "] kapanista " + batch.size()
          + " satir yazilamadi", e);
      }
    }
    conn.closeQuietly();
    connected = false;
  }

  private void writeBatch(List<TsSample> batch)
    throws SQLException
  {
    conn.ensureOpen();

    Map<TsValueType, List<TsSample>> byType = new HashMap<>();
    for (int i = 0; i < batch.size(); i++)
    {
      TsSample s = batch.get(i);
      List<TsSample> l = byType.get(s.valueType);
      if (l == null) { l = new ArrayList<>(); byType.put(s.valueType, l); }
      l.add(s);
    }

    for (Map.Entry<TsValueType, List<TsSample>> e : byType.entrySet())
    {
      insertRows(e.getKey(), e.getValue());
    }

    if (updateLive)
    {
      upsertLive(batch);
    }

    conn.commit();
  }

  private void insertRows(TsValueType type, List<TsSample> rows)
    throws SQLException
  {
    String sql = "INSERT INTO " + schema + '.' + type.table
      + " (time, point_id, value, status, trend_flags, src) VALUES (?,?,?,?,?,?)"
      + " ON CONFLICT (point_id, time) DO NOTHING";

    try (PreparedStatement ps = conn.raw().prepareStatement(sql))
    {
      for (int i = 0; i < rows.size(); i++)
      {
        TsSample s = rows.get(i);
        ps.setTimestamp(1, new Timestamp(s.time), UTC);
        ps.setLong(2, s.pointId);
        switch (type)
        {
          case NUMERIC:
            if (Double.isNaN(s.numValue) || Double.isInfinite(s.numValue))
            {
              ps.setNull(3, java.sql.Types.DOUBLE);
            }
            else
            {
              ps.setDouble(3, s.numValue);
            }
            break;
          case BOOLEAN: ps.setBoolean(3, s.boolValue); break;
          case ENUM:    ps.setInt(3, s.enumValue); break;
          default:
            if (s.strValue == null) { ps.setNull(3, java.sql.Types.VARCHAR); }
            else { ps.setString(3, s.strValue); }
        }
        ps.setInt(4, s.status);
        ps.setShort(5, s.trendFlags);
        ps.setShort(6, s.src);
        ps.addBatch();
      }
      ps.executeBatch();
    }
  }

  /**
   * point_live tablosunu partideki en yeni degerle gunceller.
   */
  private void upsertLive(List<TsSample> batch)
    throws SQLException
  {
    Map<Long, TsSample> latest = new HashMap<>();
    for (int i = 0; i < batch.size(); i++)
    {
      TsSample s = batch.get(i);
      TsSample prev = latest.get(s.pointId);
      if (prev == null || s.time > prev.time) { latest.put(s.pointId, s); }
    }
    if (latest.isEmpty()) { return; }

    String sql = "INSERT INTO " + schema + ".point_live"
      + " (point_id, time, num_value, bool_value, str_value, enum_value, status, updated_at)"
      + " VALUES (?,?,?,?,?,?,?, now())"
      + " ON CONFLICT (point_id) DO UPDATE SET"
      + " time = EXCLUDED.time, num_value = EXCLUDED.num_value,"
      + " bool_value = EXCLUDED.bool_value, str_value = EXCLUDED.str_value,"
      + " enum_value = EXCLUDED.enum_value, status = EXCLUDED.status,"
      + " updated_at = now()"
      + " WHERE " + schema + ".point_live.time <= EXCLUDED.time";

    try (PreparedStatement ps = conn.raw().prepareStatement(sql))
    {
      for (TsSample s : latest.values())
      {
        ps.setLong(1, s.pointId);
        ps.setTimestamp(2, new Timestamp(s.time), UTC);
        if (s.valueType == TsValueType.NUMERIC
            && !Double.isNaN(s.numValue) && !Double.isInfinite(s.numValue))
        {
          ps.setDouble(3, s.numValue);
        }
        else { ps.setNull(3, java.sql.Types.DOUBLE); }

        if (s.valueType == TsValueType.BOOLEAN) { ps.setBoolean(4, s.boolValue); }
        else { ps.setNull(4, java.sql.Types.BOOLEAN); }

        if (s.valueType == TsValueType.STRING && s.strValue != null) { ps.setString(5, s.strValue); }
        else { ps.setNull(5, java.sql.Types.VARCHAR); }

        if (s.valueType == TsValueType.ENUM) { ps.setInt(6, s.enumValue); }
        else { ps.setNull(6, java.sql.Types.INTEGER); }

        ps.setInt(7, s.status);
        ps.addBatch();
      }
      ps.executeBatch();
    }
  }
}
