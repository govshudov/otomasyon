"""Bellek içi geçmiş — diske hiç yazmadan trend ve oynatma.

Neden var: demo kurulumunda (henüz PLC yok, sadece gösterim) SD karta sürekli
yazmanın anlamı yok — kart aşınır ve günlerce içinde dolar. Ama trend grafikleri
ve geçmiş oynatma gösterimin en etkileyici parçaları.

Çözüm veriyi UYDURMAK değil, saklamamak: simülatörün gerçek çıktısı halka
tamponlarda tutulur, disk hiç kullanılmaz. Gösterilen her sayı gerçekten
o anda üretilmiş değerdir.

Sınırlar (`HISTORY_WINDOW_MIN`, `HISTORY_MIN_INTERVAL_S`) belleği sabit tutar:
2 saat × 789 tag × 10 sn ≈ 11 MB.

PLC'ye geçildiğinde `HISTORY_MODE=db` ile kalıcı depolamaya dönülür; API ve
arayüz tarafında başka hiçbir şey değişmez — iki sınıf aynı arayüzü uygular.
"""
from __future__ import annotations

import os
import time
from collections import deque

WINDOW_MIN = float(os.getenv("HISTORY_WINDOW_MIN", "120"))
MIN_INTERVAL_S = float(os.getenv("HISTORY_MIN_INTERVAL_S", "10"))
MAX_TAGS = int(os.getenv("HISTORY_MAX_TAGS", "4000"))


class MemoryHistory:
    """History ile aynı arayüz; kalıcılık yok."""

    def __init__(self, _dsn: str | None = None):
        self.enabled = True
        self.persistent = False
        self.timescale = False
        self.written = 0
        self.dropped = 0
        self._series: dict[str, deque[tuple[float, float]]] = {}
        self._last: dict[str, float] = {}
        self._status: dict[str, deque[tuple[float, str, str]]] = {}
        self._alarms: deque[dict] = deque(maxlen=2000)
        self._maxlen = max(16, int((WINDOW_MIN * 60) / max(MIN_INTERVAL_S, 0.5)) + 8)

    # ------------------------------------------------------------------ #

    async def connect(self) -> None:
        print(f"[api] geçmiş: BELLEKTE ({WINDOW_MIN:.0f} dk pencere, "
              f"{MIN_INTERVAL_S:.0f} sn çözünürlük) — diske yazılmıyor", flush=True)

    def push(self, samples: list[tuple[str, float]], ts_ms: int) -> None:
        t = ts_ms / 1000.0
        cutoff = t - WINDOW_MIN * 60
        for tag, val in samples:
            if t - self._last.get(tag, 0.0) < MIN_INTERVAL_S:
                continue
            d = self._series.get(tag)
            if d is None:
                if len(self._series) >= MAX_TAGS:
                    continue
                d = self._series[tag] = deque(maxlen=self._maxlen)
            self._last[tag] = t
            d.append((t, float(val)))
            while d and d[0][0] < cutoff:
                d.popleft()
            self.written += 1

    async def flush(self) -> None:
        return

    async def flush_loop(self) -> None:
        import asyncio
        while True:
            await asyncio.sleep(600)

    async def retention_loop(self) -> None:
        import asyncio
        while True:
            await asyncio.sleep(300)
            cutoff = time.time() - WINDOW_MIN * 60
            for d in self._series.values():
                while d and d[0][0] < cutoff:
                    d.popleft()
            for d in self._status.values():
                while len(d) > 1 and d[1][0] < cutoff:
                    d.popleft()

    # ------------------------------------------------------------------ #

    async def log_status(self, station: str, equipment: str, state: str, mode: str) -> None:
        key = f"{station}.{equipment}"
        d = self._status.get(key)
        if d is None:
            d = self._status[key] = deque(maxlen=400)
        d.append((time.time(), state, mode or "AUTO"))

    async def log_alarm(self, a: dict) -> None:
        self._alarms.append({**a, "ts": time.time()})

    # ------------------------------------------------------------------ #

    async def range(self) -> dict:
        lo = min((d[0][0] for d in self._series.values() if d), default=None)
        hi = max((d[-1][0] for d in self._series.values() if d), default=None)
        return {"from": lo, "to": hi}

    async def snapshot_at(self, ts_s: float, lookback_s: float = 900.0) -> dict:
        """O andan önceki son değer — ikili arama, tampon zaten sıralı."""
        import bisect
        values = {}
        for tag, d in self._series.items():
            if not d:
                continue
            arr = list(d)
            i = bisect.bisect_right([p[0] for p in arr], ts_s) - 1
            if i >= 0 and ts_s - arr[i][0] <= lookback_s:
                values[tag] = {"v": arr[i][1], "ts": int(arr[i][0] * 1000)}
        status = {}
        for key, d in self._status.items():
            last = None
            for t, st, md in d:
                if t <= ts_s:
                    last = (t, st, md)
                else:
                    break
            if last:
                status[key] = {"state": last[1], "mode": last[2], "ts": int(last[0] * 1000)}
        return {"values": values, "status": status}

    async def query(self, tags: list[str], start_s: float, end_s: float,
                    buckets: int = 600) -> dict[str, list[list[float]]]:
        width = max((end_s - start_s) / max(buckets, 1), MIN_INTERVAL_S / 2)
        out: dict[str, list[list[float]]] = {}
        for tag in tags:
            d = self._series.get(tag)
            if not d:
                out[tag] = []
                continue
            agg: dict[int, list[float]] = {}
            for t, v in d:
                if t < start_s or t > end_s:
                    continue
                b = int(t // width)
                a = agg.get(b)
                if a is None:
                    agg[b] = [v, v, v, 1.0]
                else:
                    a[0] += v
                    a[1] = min(a[1], v)
                    a[2] = max(a[2], v)
                    a[3] += 1
            out[tag] = [[b * width, a[0] / a[3], a[1], a[2]] for b, a in sorted(agg.items())]
        return out


# --------------------------------------------------------------------------- #
# Demo tohumlama
# --------------------------------------------------------------------------- #

def seed_demo(mem: "MemoryHistory", stations: dict, types: dict,
              window_min: float | None = None) -> int:
    """Açılışta geçmişi makul bir eğriyle doldurur — YALNIZ DEMO İÇİN.

    Neden: bellek içi geçmiş Pi açıldığı an boştur. Müşteriye boş bir trend
    grafiği göstermek olmaz. Bu fonksiyon her sayısal sinyal için sinyalin
    kendi ölçüm aralığında, yavaş salınan makul bir seri üretir; grafik dolu
    açılır, üzerine simülatörün gerçek verisi birikir.

    ÖNEMLİ: bu üretilmiş veridir, ölçüm değildir. Gerçek PLC'ye geçildiğinde
    `HISTORY_SEED_DEMO=0` ile kapatılır ve geçmiş yalnız gerçek ölçümlerden
    oluşur. Kapatmayı unutmamak için API açılışta bunu büyük harflerle loglar.
    """
    import math
    import random

    win = (window_min if window_min is not None else WINDOW_MIN) * 60
    now = time.time()
    step = max(MIN_INTERVAL_S, 5.0)
    n_points = int(win / step)
    rng = random.Random(20260831)
    total = 0

    for sid, cfg in stations.items():
        for eq in cfg["equipment"]:
            tdef = types.get(eq["type"], {})
            for key, sd in tdef.get("signals", {}).items():
                if sd.get("type") not in ("float", "int"):
                    continue
                rmin, rmax = (sd.get("range") or [0.0, 100.0])[:2]
                span = float(rmax) - float(rmin)
                if span <= 0:
                    continue
                # Ölçüm aralığının orta bandında dolaş; uçlara gitme ki
                # sahte alarmlar üretmesin
                base = float(rmin) + span * rng.uniform(0.32, 0.55)
                amp = span * rng.uniform(0.03, 0.10)
                period = rng.uniform(900, 5400)          # 15 dk – 1,5 sa
                phase = rng.uniform(0, math.tau)
                drift = rng.uniform(-0.5, 0.5) * amp
                noise = span * 0.004
                tag = f"{sid}.{eq['id']}.{key}"

                d = mem._series.get(tag)
                if d is None:
                    d = mem._series[tag] = deque(maxlen=mem._maxlen)
                for i in range(n_points):
                    t = now - win + i * step
                    f = i / max(n_points - 1, 1)
                    v = (base + drift * f
                         + amp * math.sin(math.tau * (t / period) + phase)
                         + rng.gauss(0, noise))
                    d.append((t, max(float(rmin), min(float(rmax), v))))
                mem._last[tag] = now - step
                total += n_points

            # Ekipman durumu: geçmişte de ÇALIŞIYOR görünsün ki oynatmada
            # rozet "UNKNOWN" demesin
            key = f"{sid}.{eq['id']}"
            dq = mem._status.get(key)
            if dq is None:
                dq = mem._status[key] = deque(maxlen=400)
            dq.appendleft((now - win, "RUNNING", "AUTO"))
    return total
