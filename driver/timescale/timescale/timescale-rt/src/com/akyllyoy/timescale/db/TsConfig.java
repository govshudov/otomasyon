/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale.db;

/**
 * BTimescaleDevice slot'larindan alinan, degismez bag lanti yapilandirmasi.
 * Yazici thread'i station slot'larina dokunmadan calisabilsin diye
 * her yeniden baglanmada bir kopya alinir.
 *
 * @author Akyllyoy
 */
public final class TsConfig
{
  public final String host;
  public final int port;
  public final String database;
  public final String schema;
  public final String username;
  public final String password;
  /** disable | allow | prefer | require | verify-ca | verify-full */
  public final String sslMode;
  public final int connectTimeoutSec;
  public final int socketTimeoutSec;
  public final String applicationName;

  public TsConfig(String host, int port, String database, String schema,
                  String username, String password, String sslMode,
                  int connectTimeoutSec, int socketTimeoutSec, String applicationName)
  {
    this.host = host;
    this.port = port;
    this.database = database;
    this.schema = schema;
    this.username = username;
    this.password = password;
    this.sslMode = sslMode;
    this.connectTimeoutSec = connectTimeoutSec;
    this.socketTimeoutSec = socketTimeoutSec;
    this.applicationName = applicationName;
  }

  public String jdbcUrl()
  {
    return "jdbc:postgresql://" + host + ':' + port + '/' + database;
  }

  @Override
  public String toString()
  {
    return jdbcUrl() + " (schema=" + schema + ", user=" + username + ", ssl=" + sslMode + ')';
  }
}
