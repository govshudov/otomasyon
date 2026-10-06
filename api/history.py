"""Geçmiş veri: TimescaleDB'ye toplu yazma ve trend sorgusu.

Veritabanı yoksa sessizce devre dışı kalır — simülatör ve canlı görüntü
Docker olmadan da çalışsın diye.
"""
from __future__ import annotations

import asyncio
import os
import time

try:
    import asyncpg
except ImportError:                       # pragma: no cover
    asyncpg = None


FLUSH_INTERVAL_S = 2.0
MAX_QUEUE = 200_000

# Bir tag için iki kayıt arasındaki en kısa süre. Canlı akışı etkilemez —
# yalnız geçmişe yazımı seyreltir. Ölçüldü: bu sınır olmadan 789 tag ile
# günde ~60 milyon satır birikiyor ve SD kart günler içinde doluyor.
MIN_INTERVAL_S = float(os.getenv("HISTORY_MIN_INTERVAL_S", "1.0"))

# Geçmiş bu süreden eskisi silinir. 0 = sınırsız (SSD varsa).
RETENTION_DAYS = float(os.getenv("HISTORY_RETENTION_DAYS", "3"))


class History:
    def __init__(self, dsn: str | None = None):
        self.dsn = dsn or os.getenv("TIMESCALE_DSN") or ""
        self.pool: "asyncpg.Pool | None" = None
        self.queue: list[tuple[float, str, float]] = []
        # HISTORY_ENABLED=0 ile tamamen kapatılabilir. Demo kurulumlarında
        # (henüz PLC yok, sadece gösterim) SD karta sürekli yazmanın anlamı yok;
        # kart aşınır ve dolar. Kapalıyken trend ve oynatma da devre dışı kalır,
        # arayüz o düğmeleri gizler.
        want = os.getenv("HISTORY_ENABLED", "1") not in ("0", "false", "no")
        self.enabled = want and bool(self.dsn) and asyncpg is not None
        self.written = 0
        self.dropped = 0
        self._warned = False
        self.timescale = False      # migrate sırasında belirlenir
        self._last_write: dict[str, float] = {}   # tag -> son yazım zamanı

    async def connect(self) -> None:
        if not self.enabled:
            print("[api] geçmiş veri KAPALI — trend ve oynatma devre dışı", flush=True)
            return
        try:
            self.pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=4,
                                                  command_timeout=10)
            await self._migrate()
            print(f"[api] veritabanı bağlandı — "
                  f"{'TimescaleDB (hypertable)' if self.timescale else 'düz PostgreSQL'}", flush=True)
        except Exception as exc:                                  # noqa: BLE001
            print(f"[api] TimescaleDB bağlanamadı, geçmiş devre dışı: {exc}", flush=True)
            self.enabled = False

    async def _try(self, c, sql: str) -> bool:
        """İsteğe bağlı SQL — başarısız olursa devam eder."""
        try:
            await c.execute(sql)
            return True
        except Exception:                                         # noqa: BLE001
            return False

    async def _migrate(self) -> None:
        async with self.pool.acquire() as c:
            await c.execute("""
                CREATE TABLE IF NOT EXISTS samples (
                    ts    TIMESTAMPTZ      NOT NULL,
                    tag   TEXT             NOT NULL,
                    value DOUBLE PRECISION NOT NULL
                );
            """)
            # TimescaleDB varsa kullan, yoksa düz PostgreSQL ile devam et.
            #
            # Gerekçe: timescale imajı 2,27 GB. Pi'nin SD kartında yer darsa
            # postgres:16-alpine (250 MB) ile de çalışabilmeli. Hypertable ve
            # time_bucket olmadan da tüm sorgular çalışır, yalnız çok büyük
            # veri hacminde daha yavaş olur.
            self.timescale = await self._try(c, "CREATE EXTENSION IF NOT EXISTS timescaledb;")
            if self.timescale:
                self.timescale = await self._try(
                    c, "SELECT create_hypertable('samples','ts',if_not_exists=>TRUE);")
            await c.execute("CREATE INDEX IF NOT EXISTS samples_tag_ts ON samples (tag, ts DESC);")
            if not self.timescale:
                # Hypertable yoksa zaman aralığı taramaları BRIN ile hızlanır
                await self._try(c, "CREATE INDEX IF NOT EXISTS samples_ts_brin "
                                   "ON samples USING BRIN (ts);")
            await c.execute("""
                CREATE TABLE IF NOT EXISTS alarm_events (
                    ts        TIMESTAMPTZ NOT NULL,
                    alarm_id  TEXT        NOT NULL,
                    tag       TEXT        NOT NULL,
                    equipment TEXT        NOT NULL,
                    component TEXT,
                    level     TEXT        NOT NULL,
                    state     TEXT        NOT NULL,
                    msg       TEXT,
                    value     DOUBLE PRECISION
                );
            """)
            if self.timescale:
                await self._try(c, "SELECT create_hypertable('alarm_events','ts',if_not_exists=>TRUE);")
            # Durum geçişleri ayrı tabloda: oynatmada bir pompanın o an
            # ÇALIŞIYOR mu ARIZALI mı olduğunu ancak böyle bilebiliriz.
            # Analog değerlerden türetmek FAULT ile STOPPED'ı ayırt edemez.
            await c.execute("""
                CREATE TABLE IF NOT EXISTS status_events (
                    ts        TIMESTAMPTZ NOT NULL,
                    station   TEXT        NOT NULL,
                    equipment TEXT        NOT NULL,
                    state     TEXT        NOT NULL,
                    mode      TEXT
                );
            """)
            if self.timescale:
                await self._try(c, "SELECT create_hypertable('status_events','ts',if_not_exists=>TRUE);")
            await c.execute("CREATE INDEX IF NOT EXISTS status_eq_ts "
                            "ON status_events (station, equipment, ts DESC);")

    # ------------------------------------------------------------------ #

    def push(self, samples: list[tuple[str, float]], ts_ms: int) -> None:
        if not self.enabled:
            return
        if len(self.queue) >= MAX_QUEUE:
            self.dropped += len(samples)
            if not self._warned:
                print("[api] geçmiş kuyruğu doldu, örnekler düşüyor", flush=True)
                self._warned = True
            return
        t = ts_ms / 1000.0
        if MIN_INTERVAL_S > 0:
            keep = []
            for tag, val in samples:
                last = self._last_write.get(tag, 0.0)
                if t - last >= MIN_INTERVAL_S:
                    self._last_write[tag] = t
                    keep.append((t, tag, val))
            self.queue.extend(keep)
        else:
            self.queue.extend((t, tag, val) for tag, val in samples)

    async def flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            await self.flush()

    async def retention_loop(self) -> None:
        """Eski kayıtları siler. SD kart üzerinde çalışan bir kiosk için şart —
        sınırsız büyüme kartı hem doldurur hem aşındırır."""
        while True:
            await asyncio.sleep(3600)
            if not self.enabled or self.pool is None or RETENTION_DAYS <= 0:
                continue
            try:
                async with self.pool.acquire() as c:
                    for tbl in ("samples", "alarm_events", "status_events"):
                        n = await c.execute(
                            f"DELETE FROM {tbl} WHERE ts < now() - $1::interval",
                            f"{RETENTION_DAYS} days")
                        if n and n != "DELETE 0":
                            print(f"[api] saklama: {tbl} {n}", flush=True)
            except Exception as exc:                              # noqa: BLE001
                print(f"[api] saklama hatası: {exc}", flush=True)

    async def flush(self) -> None:
        if not self.enabled or not self.queue or self.pool is None:
            return
        batch, self.queue = self.queue, []
        import datetime as _dt
        rows = [(_dt.datetime.fromtimestamp(t, _dt.timezone.utc), tag, val) for t, tag, val in batch]
        try:
            async with self.pool.acquire() as c:
                await c.copy_records_to_table("samples", records=rows,
                                              columns=["ts", "tag", "value"])
            self.written += len(rows)
        except Exception as exc:                                  # noqa: BLE001
            print(f"[api] geçmiş yazma hatası: {exc}", flush=True)

    async def log_alarm(self, a: dict) -> None:
        if not self.enabled or self.pool is None:
            return
        import datetime as _dt
        try:
            async with self.pool.acquire() as c:
                await c.execute(
                    "INSERT INTO alarm_events (ts,alarm_id,tag,equipment,component,level,state,msg,value)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    _dt.datetime.now(_dt.timezone.utc), a["id"], a["tag"], a["equipment"],
                    a.get("component"), a["level"], a["state"], a["msg"],
                    float(a["value"]) if isinstance(a.get("value"), (int, float)) else None)
        except Exception as exc:                                  # noqa: BLE001
            print(f"[api] alarm kaydı hatası: {exc}", flush=True)

    # ------------------------------------------------------------------ #

    async def log_status(self, station: str, equipment: str, state: str, mode: str) -> None:
        if not self.enabled or self.pool is None:
            return
        import datetime as _dt
        try:
            async with self.pool.acquire() as c:
                await c.execute(
                    "INSERT INTO status_events (ts,station,equipment,state,mode)"
                    " VALUES ($1,$2,$3,$4,$5)",
                    _dt.datetime.now(_dt.timezone.utc), station, equipment, state, mode)
        except Exception as exc:                                  # noqa: BLE001
            print(f"[api] durum kaydı hatası: {exc}", flush=True)

    async def snapshot_at(self, ts_s: float, lookback_s: float = 900.0) -> dict:
        """Geçmişteki bir andaki tam görüntü.

        Her tag için o andan ÖNCEKİ son değer alınır (DISTINCT ON, (tag, ts DESC)
        indeksiyle ucuz). `lookback_s` sınırı olmadan sorgu tüm geçmişi tarardı.
        """
        if not self.enabled or self.pool is None:
            return {"values": {}, "status": {}}
        import datetime as _dt
        t = _dt.datetime.fromtimestamp(ts_s, _dt.timezone.utc)
        t0 = _dt.datetime.fromtimestamp(ts_s - lookback_s, _dt.timezone.utc)
        async with self.pool.acquire() as c:
            rows = await c.fetch("""
                SELECT DISTINCT ON (tag) tag, ts, value
                  FROM samples WHERE ts <= $1 AND ts > $2
                 ORDER BY tag, ts DESC
            """, t, t0)
            srows = await c.fetch("""
                SELECT DISTINCT ON (station, equipment) station, equipment, ts, state, mode
                  FROM status_events WHERE ts <= $1 AND ts > $2
                 ORDER BY station, equipment, ts DESC
            """, t, _dt.datetime.fromtimestamp(ts_s - 86400, _dt.timezone.utc))
        return {
            "values": {r["tag"]: {"v": r["value"], "ts": int(r["ts"].timestamp() * 1000)}
                       for r in rows},
            "status": {f"{r['station']}.{r['equipment']}":
                       {"state": r["state"], "mode": r["mode"] or "AUTO",
                        "ts": int(r["ts"].timestamp() * 1000)} for r in srows},
        }

    async def range(self) -> dict:
        """Kayıtlı geçmişin sınırları — zaman çubuğu bunu kullanır."""
        if not self.enabled or self.pool is None:
            return {"from": None, "to": None}
        async with self.pool.acquire() as c:
            r = await c.fetchrow("SELECT MIN(ts) lo, MAX(ts) hi FROM samples")
        return {"from": r["lo"].timestamp() if r and r["lo"] else None,
                "to": r["hi"].timestamp() if r and r["hi"] else None}

    async def query(self, tags: list[str], start_s: float, end_s: float,
                    buckets: int = 600) -> dict[str, list[list[float]]]:
        """Zaman kovalarına indirgenmiş trend. Pi'ye 100k nokta göndermemek için."""
        if not self.enabled or self.pool is None:
            return {t: [] for t in tags}
        import datetime as _dt
        span = max(end_s - start_s, 1.0)
        width = max(span / max(buckets, 1), 0.2)
        s = _dt.datetime.fromtimestamp(start_s, _dt.timezone.utc)
        e = _dt.datetime.fromtimestamp(end_s, _dt.timezone.utc)
        out: dict[str, list[list[float]]] = {}
        # time_bucket TimescaleDB'ye özel. Yoksa aynı kovalamayı düz SQL ile yap:
        # epoch'u kova genişliğine böl, tabana yuvarla, geri çarp.
        bucket = ("EXTRACT(EPOCH FROM time_bucket(make_interval(secs => $4), ts))"
                  if self.timescale else
                  "FLOOR(EXTRACT(EPOCH FROM ts) / $4) * $4")
        async with self.pool.acquire() as c:
            rows = await c.fetch(f"""
                SELECT tag, {bucket} AS b,
                       AVG(value) AS avg, MIN(value) AS mn, MAX(value) AS mx
                  FROM samples
                 WHERE tag = ANY($1::text[]) AND ts >= $2 AND ts <= $3
                 GROUP BY tag, b ORDER BY b
            """, tags, s, e, width)
        for r in rows:
            out.setdefault(r["tag"], []).append(
                [float(r["b"]), float(r["avg"]), float(r["mn"]), float(r["mx"])])
        for t in tags:
            out.setdefault(t, [])
        return out
