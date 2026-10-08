/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Tek bir TimescaleDB (PostgreSQL) JDBC baglantisinin sarmalayicisi.
 * <p>
 * <b>Thread guvenligi:</b> Bu sinif thread-safe DEGILDIR. Her ornegi tek bir
 * thread tarafindan kullanilir: biri yazici thread'inde (toplu insert),
 * digeri okuma islerinde (watermark, metadata).
 * <p>
 * <b>Neden DriverManager degil:</b> Niagara her modulu kendi classloader'inda
 * yukler; {@code DriverManager} cagiran sinifin classloader'ina bakar ve
 * modul jar'ina gomulu pgjdbc'yi bulamayabilir. Bu yuzden Driver dogrudan
 * ornekleniyor.
 *
 * @author Akyllyoy
 */
public final class TsConnection
  implements AutoCloseable
{
  private static final Logger LOG = Logger.getLogger("timescale.db");

  /** Modul jar'ina gomulu pgjdbc surucusu */
  private static final String DRIVER_CLASS = "org.postgresql.Driver";

  private final TsConfig cfg;
  private final String label;
  private Connection conn;
  private volatile String lastError;

  public TsConnection(TsConfig cfg, String label)
  {
    this.cfg = cfg;
    this.label = label;
  }

  public TsConfig config() { return cfg; }

  public String getLastError() { return lastError; }

  public boolean isOpen()
  {
    try
    {
      return conn != null && !conn.isClosed();
    }
    catch (SQLException e)
    {
      return false;
    }
  }

  /**
   * Baglantiyi acar. Zaten aciksa hicbir sey yapmaz.
   *
   * @throws SQLException baglanti kurulamazsa
   */
  public void open()
    throws SQLException
  {
    if (isOpen()) { return; }

    Properties props = new Properties();
    props.setProperty("user", cfg.username);
    if (cfg.password != null) { props.setProperty("password", cfg.password); }
    if (cfg.password == null || cfg.password.isEmpty())
    {
      LOG.warning("[" + label + "] sifre BOS geldi. Sunucu SCRAM/md5 kimlik "
        + "dogrulamasi isterse baglanti reddedilir ('The server requested "
        + "SCRAM-based authentication...'). Password slot'unu kontrol edin.");
    }
    props.setProperty("ApplicationName", cfg.applicationName);
    props.setProperty("connectTimeout", Integer.toString(cfg.connectTimeoutSec));
    props.setProperty("socketTimeout", Integer.toString(cfg.socketTimeoutSec));
    props.setProperty("loginTimeout", Integer.toString(cfg.connectTimeoutSec));
    props.setProperty("tcpKeepAlive", "true");
    props.setProperty("reWriteBatchedInserts", "true");
    props.setProperty("assumeMinServerVersion", "12.0");
    if (cfg.sslMode != null && !cfg.sslMode.isEmpty())
    {
      props.setProperty("sslmode", cfg.sslMode);
    }
    // Sema arama yolu.
    //
    // DIKKAT: burada "public" MUTLAKA bulunmali. TimescaleDB eklentisi
    // varsayilan olarak public semasina kurulur; search_path'ten public'i
    // cikarirsak create_hypertable(), time_bucket() gibi eklenti
    // fonksiyonlari "does not exist" hatasi verir.
    // Surucunun tum SQL'i zaten sema-nitelikli oldugu icin ilk sirada
    // kendi semamizin olmasi yeterli.
    props.setProperty("currentSchema", cfg.schema + ",public");

    try
    {
      java.sql.Driver drv = (java.sql.Driver)
        Class.forName(DRIVER_CLASS, true, TsConnection.class.getClassLoader())
             .getDeclaredConstructor()
             .newInstance();

      Connection c = drv.connect(cfg.jdbcUrl(), props);
      if (c == null)
      {
        throw new SQLException("pgjdbc surucusu URL'i kabul etmedi: " + cfg.jdbcUrl());
      }
      c.setAutoCommit(false);
      this.conn = c;
      this.lastError = null;
      LOG.info("[" + label + "] baglandi: " + cfg);
    }
    catch (SQLException e)
    {
      this.lastError = e.getMessage();
      throw e;
    }
    catch (Exception e)
    {
      this.lastError = e.toString();
      throw new SQLException("pgjdbc surucusu yuklenemedi (" + DRIVER_CLASS + ')', e);
    }
  }

  /**
   * Baglantinin canli oldugunu dogrular; degilse yeniden acar.
   *
   * @throws SQLException dogrulama ve yeniden acma basarisiz olursa
   */
  public void ensureOpen()
    throws SQLException
  {
    if (isOpen())
    {
      try
      {
        // DIKKAT: Connection.isValid(int) KULLANMIYORUZ.
        // pgjdbc onu Connection.setNetworkTimeout() uzerinden gerceklestirir ve
        // bu, Niagara station'inin SecurityManager'i altinda
        //   AccessControlException: java.sql.SQLPermission "setNetworkTimeout"
        // ile reddedilir. Basit bir sorgu ayni isi izin gerektirmeden yapar.
        try (Statement st = conn.createStatement())
        {
          st.executeQuery("SELECT 1").close();
        }
        conn.commit();
        return;
      }
      catch (SQLException ignore)
      {
        // baglanti olmus; asagida yeniden acilacak
        rollbackQuietly();
      }
      closeQuietly();
    }
    open();
  }

  /**
   * Sunucunun ayakta ve timescaledb eklentisinin kurulu oldugunu dogrular.
   *
   * @return timescaledb eklenti surumu, eklenti yoksa {@code null}
   */
  public String pingAndGetTimescaleVersion()
    throws SQLException
  {
    ensureOpen();
    try (Statement st = conn.createStatement();
         ResultSet rs = st.executeQuery(
           "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"))
    {
      String v = rs.next() ? rs.getString(1) : null;
      conn.commit();
      return v;
    }
    catch (SQLException e)
    {
      rollbackQuietly();
      throw e;
    }
  }

  public Connection raw()
  {
    return conn;
  }

  public PreparedStatement prepare(String sql)
    throws SQLException
  {
    ensureOpen();
    return conn.prepareStatement(sql);
  }

  public void commit()
    throws SQLException
  {
    if (isOpen()) { conn.commit(); }
  }

  public void rollbackQuietly()
  {
    try
    {
      if (isOpen()) { conn.rollback(); }
    }
    catch (SQLException e)
    {
      LOG.log(Level.FINE, "[" + label + "] rollback basarisiz", e);
    }
  }

  public void closeQuietly()
  {
    try
    {
      if (conn != null) { conn.close(); }
    }
    catch (SQLException e)
    {
      LOG.log(Level.FINE, "[" + label + "] close basarisiz", e);
    }
    finally
    {
      conn = null;
    }
  }

  @Override
  public void close()
  {
    closeQuietly();
  }
}
