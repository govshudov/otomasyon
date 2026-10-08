/*
 * Copyright (c) 2024, PostgreSQL Global Development Group
 * See the LICENSE file in the project root for more information.
 *
 * ---------------------------------------------------------------------
 *  AKYLLYOY YAMASI - pgjdbc 42.7.2'nin ayni adli sinifinin yerine gecer
 * ---------------------------------------------------------------------
 *
 *  NEDEN VAR
 *  ---------
 *  pgjdbc'nin ozgun LazyCleaner temizlik thread'i, calismaya
 *  baslar baslamaz sunu yapar:
 *
 *      Thread.currentThread().setContextClassLoader(null);
 *      Thread.currentThread().setUncaughtExceptionHandler(null);
 *
 *  Niagara station'i bir SecurityManager altinda calisir ve modul
 *  jar'ina RuntimePermission "setContextClassLoader" verilmez. Bu cagri
 *  AccessControlException firlatir. Sikinti sudur ki ozgun kodda bu iki
 *  satir, dongunun KENDI catch(Throwable) blogunun kapsamindadir ve
 *  catch blogu sonunda basa doner:
 *
 *      catch (Throwable e) {
 *        LOGGER.log(WARNING, "Unexpected exception in cleaner thread main loop", e);
 *        continue;          // <-- basa don, yine setContextClassLoader, yine patla
 *      }
 *
 *  Sonuc: hicbir bloklama icermeyen sonsuz bir mesgul dongu. Olcum:
 *  saniyede ~330 istisna + tam stack trace log'u, yaklasik 130 KB/sn
 *  cikti. Bir CPU cekirdegi dolar, station'in ciktisi bogulur ve
 *  Workbench agirlasir.
 *
 *  YAMANIN YAPTIGI
 *  ---------------
 *  Sinif islevsel olarak ayni; YALNIZCA yukaridaki iki cagri
 *  kaldirilmistir. Baglanti sizintisi temizligi, ReferenceQueue
 *  izleme, thread TTL'i, kayit/silme semantigi aynen korunur --
 *  {@code Cleanable}, {@code CleaningAction}, {@code getInstance()},
 *  {@code register()} ve zamanlama davranisi birebir.
 *
 *  Iki cagrinin kaybi zararsizdir:
 *    - setContextClassLoader(null): thread'i olusturan siniftan
 *      classloader sizmasini onlemek icin konmus bir tedbirdir.
 *      Niagara zaten her modulu kendi classloader'inda calistirir.
 *    - setUncaughtExceptionHandler(null): dongu zaten tum Throwable'lari
 *      kendisi yakalar; handler'a hicbir zaman ulasilmaz.
 *
 *  BAKIM NOTU
 *  ----------
 *  pgjdbc yukseltilirse bu dosyayi yeni surumun LazyCleaner'i ile
 *  karsilastirin. build.sh, gomulu pgjdbc acildiktan SONRA bizim
 *  siniflarimizi kopyalar; boylece bu dosya ozgun olani ezer.
 */

package org.postgresql.util;

import java.lang.ref.PhantomReference;
import java.lang.ref.ReferenceQueue;
import java.time.Duration;
import java.util.concurrent.ThreadFactory;
import java.util.logging.Level;
import java.util.logging.Logger;

public class LazyCleaner
{
  private static final Logger LOGGER = Logger.getLogger(LazyCleaner.class.getName());

  private static final LazyCleaner instance = new LazyCleaner(
      Duration.ofMillis(Long.getLong("pgjdbc.config.cleanup.thread.ttl", 30000L)),
      "PostgreSQL-JDBC-Cleaner");

  private final ReferenceQueue<Object> queue = new ReferenceQueue<>();
  private final long threadTtl;
  private final ThreadFactory threadFactory;
  private boolean threadRunning;
  private int watchedCount;
  private Node<?> first;

  public static LazyCleaner getInstance()
  {
    return instance;
  }

  public LazyCleaner(Duration threadTtl, String threadName)
  {
    this(threadTtl, runnable -> {
      Thread thread = new Thread(runnable, threadName);
      thread.setDaemon(true);
      return thread;
    });
  }

  private LazyCleaner(Duration threadTtl, ThreadFactory threadFactory)
  {
    long ttl = threadTtl.toMillis();
    this.threadTtl = ttl <= 0L ? 0L : ttl;
    this.threadFactory = threadFactory;
  }

  public <T extends Throwable> Cleanable<T> register(Object obj, CleaningAction<T> action)
  {
    return add(new Node<T>(obj, action));
  }

  public synchronized int getWatchedCount()
  {
    return watchedCount;
  }

  public synchronized boolean isThreadRunning()
  {
    return threadRunning;
  }

  private synchronized boolean checkEmpty()
  {
    if (watchedCount == 0)
    {
      threadRunning = false;
      return true;
    }
    return false;
  }

  private synchronized <T extends Throwable> Node<T> add(Node<T> node)
  {
    if (first != null)
    {
      node.next = first;
      first.prev = node;
    }
    first = node;
    watchedCount++;

    if (!threadRunning)
    {
      threadRunning = startThread();
    }
    return node;
  }

  private boolean startThread()
  {
    Thread thread = threadFactory.newThread(new Runnable()
    {
      @Override
      public void run()
      {
        // AKYLLYOY YAMASI: ozgun kodda burada
        //   Thread.currentThread().setContextClassLoader(null);
        //   Thread.currentThread().setUncaughtExceptionHandler(null);
        // cagrilari vardi. Niagara'nin SecurityManager'i bunlari
        // reddediyor, firlayan istisna asagidaki catch(Throwable) ile
        // yakalanip dongunun basina donuluyor ve sonsuz mesgul dongu
        // olusuyordu. Dosya basindaki aciklamaya bakin.
        while (true)
        {
          try
          {
            Node<?> node = (Node<?>) queue.remove(threadTtl);
            if (node == null)
            {
              if (checkEmpty()) { return; }
              continue;
            }
            try
            {
              node.onClean(true);
            }
            catch (Throwable e)
            {
              if (e instanceof InterruptedException)
              {
                LOGGER.log(Level.WARNING, "Unexpected interrupt while executing onClean", e);
                throw (InterruptedException) e;
              }
              LOGGER.log(Level.WARNING, "Unexpected exception while executing onClean", e);
            }
          }
          catch (InterruptedException e)
          {
            if (checkEmpty())
            {
              LOGGER.log(Level.FINE,
                "Cleanup queue is empty, and got interrupt, will terminate the cleanup thread");
              return;
            }
            LOGGER.log(Level.FINE, "Ignoring interrupt since the cleanup queue is non-empty");
          }
          catch (Throwable e)
          {
            LOGGER.log(Level.WARNING, "Unexpected exception in cleaner thread main loop", e);
          }
        }
      }
    });
    thread.start();
    return true;
  }

  private synchronized boolean remove(Node<?> node)
  {
    // zaten cikarilmissa (ya da hic eklenmemisse) ikinci kez calistirma
    if (node.next == node) { return false; }

    if (first == node) { first = node.next; }
    if (node.next != null) { node.next.prev = node.prev; }
    if (node.prev != null) { node.prev.next = node.next; }

    node.next = node;   // "cikarildi" isareti
    node.prev = node;

    watchedCount--;
    return true;
  }

  public interface Cleanable<T extends Throwable>
  {
    void clean() throws T;
  }

  public interface CleaningAction<T extends Throwable>
  {
    void onClean(boolean leak) throws T;
  }

  class Node<T extends Throwable>
    extends PhantomReference<Object>
    implements Cleanable<T>, CleaningAction<T>
  {
    private final CleaningAction<T> action;
    private Node<?> prev;
    private Node<?> next;

    Node(Object referent, CleaningAction<T> action)
    {
      super(referent, queue);
      this.action = action;
    }

    @Override
    public void clean() throws T
    {
      onClean(false);
    }

    @Override
    public void onClean(boolean leak) throws T
    {
      if (!remove(this)) { return; }
      if (action != null) { action.onClean(leak); }
    }
  }
}
