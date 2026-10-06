"""Alarm motoru — ISA 18.2 durum modeli.

    NORM ──kondisyon──▶ UNACK_ALM ──onay──▶ ACKED_ALM
                            │                    │
                       normale dön          normale dön
                            ▼                    ▼
                       RTN_UNACK ──onay──▶    NORM

Kurallar `common/equipment_types.json` içindeki sinyal tanımlarından okunur;
istasyon konfigürasyonundaki `alarm_overrides` ile ekipman bazında ezilebilir.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict

NORM, UNACK_ALM, ACKED_ALM, RTN_UNACK = "NORM", "UNACK_ALM", "ACKED_ALM", "RTN_UNACK"

# Alarmın kalkması için eşiği ne kadar geçmesi gerektiği (chattering önleme)
HYSTERESIS_FRAC = 0.02
ON_DELAY_S = 3.0


@dataclass
class Rule:
    tag: str
    station: str
    equipment: str
    component: str | None
    measurement: str
    level: str                # WARN | ALARM
    op: str                   # > < >= <= == !=
    value: float | bool
    msg: str
    hyst: float = 0.0

    def evaluate(self, v, active: bool) -> bool:
        """Aktifken histerezisli eşik uygulanır — sınırda titremeyi önler."""
        if isinstance(self.value, bool) or self.op in ("==", "!="):
            return (v == self.value) if self.op == "==" else (v != self.value)
        try:
            v = float(v)
        except (TypeError, ValueError):
            return False
        thr = float(self.value)
        if active:
            thr = thr - self.hyst if self.op in (">", ">=") else thr + self.hyst
        return {">": v > thr, ">=": v >= thr, "<": v < thr, "<=": v <= thr}.get(self.op, False)


@dataclass
class Alarm:
    id: str
    tag: str
    station: str
    equipment: str
    component: str | None
    level: str
    msg: str
    state: str = NORM
    value: float | bool | None = None
    ts_raised: int = 0
    ts_acked: int = 0
    ts_cleared: int = 0
    ack_by: str | None = None

    @property
    def is_active(self) -> bool:
        return self.state in (UNACK_ALM, ACKED_ALM)

    @property
    def needs_attention(self) -> bool:
        return self.state in (UNACK_ALM, RTN_UNACK)


class AlarmEngine:
    def __init__(self) -> None:
        self.rules: list[Rule] = []
        self.by_key: dict[str, Alarm] = {}       # "tag|level" -> Alarm
        self._pending: dict[str, float] = {}     # on-delay sayaçları
        self.history: list[dict] = []            # son olaylar (bellek içi halka)

    # ------------------------------------------------------------------ #

    def load(self, stations: list[dict], types: dict) -> int:
        """Tüm istasyonların kurallarını derler.

        Ekipman kimlikleri istasyonlar arasında TEKRARLANIR (her tesiste PMP-01
        vardır). Bu yüzden kural ve sağlık anahtarları istasyonla nitelenir;
        aksi halde PS-02'nin arızası PS-01'in pompasını kırmızıya boyar.
        """
        self.rules.clear()
        for station in stations:
            self._load_one(station, types)
        return len(self.rules)

    def _load_one(self, station: dict, types: dict) -> None:
        sid = station["station_id"]
        for eq in station["equipment"]:
            tdef = types.get(eq["type"])
            if not tdef:
                continue
            overrides = eq.get("alarm_overrides", {})
            for key, sd in tdef.get("signals", {}).items():
                specs = overrides.get(key, sd.get("alarms", []))
                if not specs:
                    continue
                rng = sd.get("range")
                hyst = abs(rng[1] - rng[0]) * HYSTERESIS_FRAC if rng else 0.0
                comp, meas = (key.split(".", 1) if "." in key else (None, key))
                for spec in specs:
                    self.rules.append(Rule(
                        tag=f"{sid}.{eq['id']}.{key}", station=sid, equipment=eq["id"],
                        component=comp, measurement=meas, level=spec["level"],
                        op=spec["op"], value=spec["value"],
                        msg=f"{eq.get('label', eq['id'])} — {spec['msg']}",
                        hyst=hyst if not isinstance(spec["value"], bool) else 0.0))

    # ------------------------------------------------------------------ #

    def evaluate(self, store, dt: float) -> list[Alarm]:
        """Tüm kuralları değerlendirir. Dönen: durumu değişen alarmlar."""
        now = int(time.time() * 1000)
        changed: list[Alarm] = []

        for rule in self.rules:
            key = f"{rule.tag}|{rule.level}"
            alarm = self.by_key.get(key)
            active = bool(alarm and alarm.is_active)

            sample = store.values.get(rule.tag)
            if sample is None or store.is_stale(rule.tag, now):
                # Veri yoksa alarm tazelenmez ama düşürülmez de — bilinmiyor demektir
                continue

            cond = rule.evaluate(sample.v, active)

            # Kalkış gecikmesi: anlık sivri uçlar alarm üretmesin
            if cond and not active:
                self._pending[key] = self._pending.get(key, 0.0) + dt
                if self._pending[key] < ON_DELAY_S:
                    continue
            else:
                self._pending.pop(key, None)

            if alarm is None:
                if not cond:
                    continue
                alarm = Alarm(id=uuid.uuid4().hex[:12], tag=rule.tag, station=rule.station,
                              equipment=rule.equipment, component=rule.component,
                              level=rule.level, msg=rule.msg)
                self.by_key[key] = alarm

            prev = alarm.state
            alarm.value = sample.v

            if cond and alarm.state in (NORM, RTN_UNACK):
                alarm.state = UNACK_ALM
                alarm.ts_raised = now
                alarm.ts_cleared = 0
            elif not cond and alarm.state == UNACK_ALM:
                alarm.state = RTN_UNACK
                alarm.ts_cleared = now
            elif not cond and alarm.state == ACKED_ALM:
                alarm.state = NORM
                alarm.ts_cleared = now

            if alarm.state != prev:
                changed.append(alarm)
                self.history.append({**asdict(alarm), "event_ts": now, "from": prev})
                del self.history[:-2000]
        return changed

    # ------------------------------------------------------------------ #

    def ack(self, alarm_id: str, by: str = "operator") -> Alarm | None:
        now = int(time.time() * 1000)
        for alarm in self.by_key.values():
            if alarm.id != alarm_id:
                continue
            if alarm.state == UNACK_ALM:
                alarm.state = ACKED_ALM
            elif alarm.state == RTN_UNACK:
                alarm.state = NORM
            else:
                return alarm
            alarm.ts_acked = now
            alarm.ack_by = by
            self.history.append({**asdict(alarm), "event_ts": now, "from": "ACK"})
            return alarm
        return None

    def ack_all(self, by: str = "operator") -> list[Alarm]:
        return [a for a in (self.ack(x.id, by) for x in list(self.by_key.values())
                            if x.needs_attention) if a]

    def health_by_equipment(self, station: str | None = None) -> dict[str, str]:
        """`PS-01.PMP-01` -> WARN|ALARM. 3D'de ekipman rengini bu belirler."""
        out: dict[str, str] = {}
        for a in self.by_key.values():
            if not a.is_active or (station and a.station != station):
                continue
            k = f"{a.station}.{a.equipment}"
            if a.level == "ALARM" or k not in out:
                out[k] = a.level if a.level == "ALARM" else out.get(k, a.level)
        return out

    def health_by_component(self, station: str | None = None) -> dict[str, str]:
        """`PS-01.PMP-01/MOTOR__BEARING-DE` -> WARN|ALARM. Parça boyamak için."""
        out: dict[str, str] = {}
        for a in self.by_key.values():
            if not a.is_active or not a.component or (station and a.station != station):
                continue
            k = f"{a.station}.{a.equipment}/{a.component}"
            if a.level == "ALARM" or k not in out:
                out[k] = a.level if a.level == "ALARM" else out.get(k, a.level)
        return out

    def active(self, station: str | None = None) -> list[dict]:      # type: ignore[override]
        order = {UNACK_ALM: 0, ACKED_ALM: 1, RTN_UNACK: 2}
        sev = {"ALARM": 0, "WARN": 1}
        items = [a for a in self.by_key.values()
                 if a.state != NORM and (not station or a.station == station)]
        items.sort(key=lambda a: (sev.get(a.level, 9), order.get(a.state, 9), -a.ts_raised))
        return [asdict(a) for a in items]
