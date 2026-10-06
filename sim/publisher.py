"""MQTT yayıncısı: ölü bant + heartbeat + sensör gürültü katmanı.

Fizik modeli temiz değerler üretir; gerçek sahada sensörler gürültülü, kuantalı
ve zaman zaman sessizdir. O katman burada eklenir — böylece frontend baştan
gerçek saha verisiyle karşılaşır.
"""
from __future__ import annotations

import json
import random
import time


class DeadbandPublisher:
    """Sinyal başına son yayınlanan değeri tutar, sadece anlamlı değişimi yayınlar."""

    HEARTBEAT_S = 5.0

    def __init__(self, client, station_id: str, types: dict, eq_types: dict[str, str],
                 rng: random.Random, noise: bool = True):
        self.c = client
        self.station = station_id
        self.types = types
        self.eq_types = eq_types          # ekipman id -> tip adı
        self.rng = rng
        self.noise = noise
        self.last_val: dict[str, dict] = {}
        self.last_full: dict[str, float] = {}   # SON TAM yayın — normal yayınla sıfırlanmaz
        self._phase = 0
        self.last_status: dict[str, dict] = {}
        self.tx_count = 0
        self.suppressed = 0

    # ------------------------------------------------------------------ #

    def _sigdef(self, eq_id: str, key: str) -> dict | None:
        t = self.types.get(self.eq_types.get(eq_id, ""), {})
        return t.get("signals", {}).get(key)

    def _deadband(self, sd: dict | None) -> float:
        if not sd:
            return 0.0
        if "deadband" in sd:
            return float(sd["deadband"])
        rng = sd.get("range")
        return abs(rng[1] - rng[0]) * 0.005 if rng else 0.0

    def _apply_sensor(self, sd: dict | None, value):
        """Analog sinyale ölçüm gürültüsü ekler. Dijital ve sayaçlar dokunulmaz."""
        if not self.noise or not sd or sd.get("type") != "float" or not isinstance(value, (int, float)):
            return value
        # Tam sıfır = enerjisiz ölçüm (duran pompanın akımı, gücü, frekansı).
        # Gürültü eklenirse duran pompa "0.3 kW çekiyor" gibi görünüyordu.
        if value == 0:
            return value
        rng = sd.get("range")
        if not rng:
            return value
        sigma = abs(rng[1] - rng[0]) * 0.0015
        noisy = value + self.rng.gauss(0.0, sigma) if sigma else value
        # Gerçek bir sensör ölçüm aralığının dışını raporlayamaz. Kırpma olmadan
        # duran pompada negatif debi/verim görünür.
        return max(rng[0], min(rng[1], noisy))

    # ------------------------------------------------------------------ #

    def publish_snapshot(self, snap: dict[str, dict], dropouts: dict[str, set[str]] | None = None) -> None:
        now = time.time()
        dropouts = dropouts or {}

        for eq_id, data in snap.items():
            drops = dropouts.get(eq_id, set())
            changed: dict = {}
            prev = self.last_val.setdefault(eq_id, {})
            # Heartbeat SON TAM yayına bakar. Normal (kısmi) yayın bunu sıfırlamaz —
            # aksi halde sürekli veri basan ekipmanda tam yayın hiç tetiklenmez ve
            # ölü bandı aşmayan sinyal bir kez bile gönderilmez.
            if eq_id not in self.last_full:
                # İlk görüşte faz kaydır: 23 ekipman aynı anda tam yayın yapmasın
                self._phase += 1
                self.last_full[eq_id] = now - self.HEARTBEAT_S * (self._phase % 10) / 10.0
            force = (now - self.last_full[eq_id]) >= self.HEARTBEAT_S

            for key, raw in data["v"].items():
                if key in drops:                     # sensör kaybı — hiç yayınlama
                    self.suppressed += 1
                    continue
                sd = self._sigdef(eq_id, key)
                val = self._apply_sensor(sd, raw)
                old = prev.get(key)

                if isinstance(val, bool) or isinstance(val, str):
                    send = (old != val)
                elif old is None:
                    send = True
                else:
                    send = abs(val - old) >= self._deadband(sd)

                if send or force:
                    changed[key] = round(val, 4) if isinstance(val, float) else val
                    prev[key] = val

            if force:
                self.last_full[eq_id] = now
            if changed:
                self.c.publish(f"twin/{self.station}/{eq_id}/t",
                               json.dumps({"ts": int(now * 1000), "v": changed},
                                          separators=(",", ":")), qos=0)
                self.tx_count += 1

            st = data["s"]
            if self.last_status.get(eq_id) != st:
                self.last_status[eq_id] = dict(st)
                self.c.publish(f"twin/{self.station}/{eq_id}/s",
                               json.dumps({"ts": int(now * 1000), **st}, separators=(",", ":")),
                               qos=1, retain=True)

    def publish_birth(self, equipment: list[str], version: str, source: str = "sim") -> None:
        self.c.publish(f"twin/{self.station}/birth",
                       json.dumps({"ts": int(time.time() * 1000), "source": source,
                                   "version": version, "station": self.station,
                                   "equipment": equipment}),
                       qos=1, retain=True)
