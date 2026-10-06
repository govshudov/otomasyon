"""Anlık değer deposu (last-value cache) + bayatlama takibi.

Tag kimliği:  PS-01.PMP-01.MOTOR__BEARING-DE.temp
              PS-01.PMP-01.flow_m3h
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field


STALE_AFTER_S = 15.0     # bu süre boyunca güncellenmeyen sinyal "VERİ YOK" sayılır


@dataclass
class Sample:
    v: float | bool | int | str
    ts: int                     # epoch ms


class TagStore:
    def __init__(self) -> None:
        self.values: dict[str, Sample] = {}
        self.status: dict[str, dict] = {}          # ekipman id -> {state, mode, ts}
        self.sources: dict[str, dict] = {}         # istasyon id -> birth bilgisi
        self.dirty: set[str] = set()               # son dağıtımdan beri değişen taglar
        self.dirty_status: set[str] = set()

    # ------------------------------------------------------------------ #

    def ingest_telemetry(self, station: str, equipment: str, ts: int, values: dict) -> list[tuple[str, float]]:
        """Telemetriyi yazar. Dönen: geçmişe yazılacak (tag, sayısal_değer) listesi."""
        numeric: list[tuple[str, float]] = []
        for key, val in values.items():
            tag = f"{station}.{equipment}.{key}"
            self.values[tag] = Sample(val, ts)
            self.dirty.add(tag)
            if isinstance(val, bool):
                numeric.append((tag, 1.0 if val else 0.0))
            elif isinstance(val, (int, float)):
                numeric.append((tag, float(val)))
        return numeric

    def ingest_status(self, station: str, equipment: str, payload: dict) -> None:
        key = f"{station}.{equipment}"
        self.status[key] = {"state": payload.get("state", "UNKNOWN"),
                            "mode": payload.get("mode", "AUTO"),
                            "ts": payload.get("ts", int(time.time() * 1000))}
        self.dirty_status.add(key)

    # ------------------------------------------------------------------ #

    def is_stale(self, tag: str, now_ms: int | None = None) -> bool:
        s = self.values.get(tag)
        if s is None:
            return True
        now_ms = now_ms or int(time.time() * 1000)
        return (now_ms - s.ts) > STALE_AFTER_S * 1000

    def snapshot(self, station: str | None = None) -> dict:
        """station verilirse yalnız o istasyonun tagları döner."""
        now = int(time.time() * 1000)
        pre = station + "." if station else None
        return {
            "values": {t: {"v": s.v, "ts": s.ts, "stale": (now - s.ts) > STALE_AFTER_S * 1000}
                       for t, s in self.values.items() if not pre or t.startswith(pre)},
            "status": {k: v for k, v in self.status.items() if not pre or k.startswith(pre)},
            "sources": self.sources,
        }

    def take_delta(self) -> dict:
        """Son çağrıdan beri değişenleri döndürür ve kirli işaretleri temizler."""
        if not self.dirty and not self.dirty_status:
            return {}
        now = int(time.time() * 1000)
        out: dict = {}
        if self.dirty:
            out["values"] = {t: {"v": self.values[t].v, "ts": self.values[t].ts}
                             for t in self.dirty if t in self.values}
            self.dirty = set()
        if self.dirty_status:
            out["status"] = {k: self.status[k] for k in self.dirty_status if k in self.status}
            self.dirty_status = set()
        # Bayatlayan taglar da bir değişimdir — frontend "VERİ YOK" göstersin
        stale = [t for t, s in self.values.items() if (now - s.ts) > STALE_AFTER_S * 1000]
        if stale:
            out["stale"] = stale
        return out
