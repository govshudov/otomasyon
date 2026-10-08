/*
 * Copyright 2026 Akyllyoy. All Rights Reserved.
 */

package com.akyllyoy.timescale;

import java.util.ArrayList;
import java.util.List;

import javax.baja.naming.BOrd;
import javax.baja.sys.BComponent;
import javax.baja.sys.BObject;
import javax.baja.sys.Sys;

/**
 * {@link BTimescaleDevice} bulma yardimcisi.
 * <p>
 * <b>Neden var:</b> Bloklarin {@code deviceOrd} varsayilani sabit bir
 * tahmindir:
 * {@code station:|slot:/Drivers/TimescaleNetwork/TimescaleDatabase}.
 * Baska bir istasyonda cihazin adi farkli olur (palette'ten surukleyince
 * varsayilan ad {@code TimescaleDevice}'tir, {@code TimescaleDatabase}
 * degil) ya da cihaz bir klasorun icindedir. O zaman ORD cozulemez ve blok
 * "deviceOrd cozulemedi" diye durur -- oysa istasyonda cihaz apacik
 * ortadadir.
 * <p>
 * Bu sinif once ORD'u dener; tutmazsa istasyonu tarayip
 * {@link BTimescaleDevice} arar. <b>Tek bir tane</b> bulursa onu kullanir.
 * Birden fazla varsa secim yapmaz -- hangisinin dogru oldugunu bilemez --
 * ama hata metninde adaylari <b>listeler</b>, boylece kullanici dogru ORD'u
 * kopyalayabilir.
 *
 * @author Akyllyoy
 */
public final class TsDeviceLookup
{
  /** Tarama derinlik siniri; istasyon agaci beklenmedik bicimde derinse takilmayalim. */
  private static final int MAX_DEPTH = 12;

  /** Hata metninde en fazla kac aday gosterilecek. */
  private static final int MAX_LISTED = 8;

  private TsDeviceLookup() {}

  /** {@link #find} sonucu: cihaz ya da aciklayici hata. */
  public static final class Result
  {
    /** Bulunan cihaz; bulunamadiysa {@code null}. */
    public final BTimescaleDevice device;

    /** ORD tutmadigi icin tarama sonucu bulunduysa {@code true}. */
    public final boolean foundByScan;

    /** Cihaz bulunamadiysa kullaniciya gosterilecek metin; aksi halde {@code null}. */
    public final String error;

    private Result(BTimescaleDevice d, boolean scan, String err)
    {
      this.device = d; this.foundByScan = scan; this.error = err;
    }
  }

  /**
   * Once {@code ord}'u cozer; olmazsa istasyonu tarar.
   *
   * @param from ORD'un goreli cozulecegi bilesen (blogun kendisi)
   * @param ord  kullanicinin verdigi ORD ({@code null} olabilir)
   */
  public static Result find(BComponent from, BOrd ord)
  {
    String ordProblem = null;

    // 1) Once kullanicinin verdigi ORD
    if (ord != null && !ord.isNull())
    {
      try
      {
        BObject o = ord.resolve(from, null).get();
        if (o instanceof BTimescaleDevice)
        {
          return new Result((BTimescaleDevice) o, false, null);
        }
        ordProblem = "ORD bir TimescaleDevice gostermiyor (" + typeName(o) + "): " + ord;
      }
      catch (Exception e)
      {
        ordProblem = "ORD cozulemedi: " + ord;
      }
    }
    else
    {
      ordProblem = "deviceOrd bos";
    }

    // 2) Istasyonu tara
    List<BTimescaleDevice> found = new ArrayList<>();
    try
    {
      collect(Sys.getStation(), found, 0);
    }
    catch (Exception e)
    {
      // tarama basarisiz -- yalnizca ORD hatasini bildir
      return new Result(null, false, ordProblem);
    }

    if (found.size() == 1)
    {
      return new Result(found.get(0), true, null);
    }

    StringBuilder sb = new StringBuilder(ordProblem);
    if (found.isEmpty())
    {
      sb.append(". Istasyonda hic TimescaleDevice yok -- once palette'ten "
        + "TimescaleNetwork ve icine TimescaleDevice ekleyin.");
    }
    else
    {
      sb.append(". Istasyonda ").append(found.size())
        .append(" adet TimescaleDevice var; hangisi oldugunu ORD ile belirtin: ");
      int n = Math.min(found.size(), MAX_LISTED);
      for (int i = 0; i < n; i++)
      {
        if (i > 0) { sb.append(", "); }
        sb.append(slotPath(found.get(i)));
      }
      if (found.size() > n) { sb.append(", ..."); }
    }
    return new Result(null, false, sb.toString());
  }

  /** Bilesen agacini gezip TimescaleDevice ornekleri toplar. */
  private static void collect(BComponent c, List<BTimescaleDevice> out, int depth)
  {
    if (c == null || depth > MAX_DEPTH) { return; }

    BComponent[] kids;
    try { kids = c.getChildComponents(); }
    catch (Exception e) { return; }
    if (kids == null) { return; }

    for (int i = 0; i < kids.length; i++)
    {
      BComponent k = kids[i];
      if (k == null) { continue; }
      if (k instanceof BTimescaleDevice)
      {
        out.add((BTimescaleDevice) k);
        continue;   // cihazin altinda baska cihaz aramaya gerek yok
      }
      collect(k, out, depth + 1);
    }
  }

  /**
   * Kullanicinin property sheet'e kopyalayip yapistirabilecegi tam ORD metni.
   * <p>
   * {@code getSlotPath().getBody()} yalnizca yolu verir
   * ({@code /Drivers/TimescaleNetwork/TimescaleDevice}); basina
   * {@code station:|slot:} ekliyoruz ki dogrudan kullanilabilir olsun.
   */
  public static String slotPath(BComponent c)
  {
    try
    {
      return "station:|slot:" + c.getSlotPath().getBody();
    }
    catch (Exception e)
    {
      return c.getName();
    }
  }

  private static String typeName(BObject o)
  {
    try { return o == null ? "null" : o.getType().toString(); }
    catch (Exception e) { return "?"; }
  }
}
