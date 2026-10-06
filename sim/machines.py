"""Ekipman modelleri: durum makineleri, termal davranış, titreşim, kavitasyon.

Her sınıf `signals()` ile MQTT sözleşmesindeki düz sinyal sözlüğünü üretir.
Anahtar formatı: ekipman seviyesi `flow_m3h`, bileşen seviyesi `MOTOR.temp`.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from hydraulics import PumpCurve, shaft_power_kw, line_current_a

T_AMB = 25.0          # ortam sıcaklığı, °C
BAR_PER_M = 0.0981    # 1 mSS = 0.0981 bar
MOTOR_TRIP_C = 180.0  # motor koruması bu sıcaklıkta atar (H sınıfı izolasyon sınırı)


class Lag:
    """Birinci mertebe gecikme — termal kütle modeli.

    Üstel form kullanılır; büyük dt'de bile kararlıdır (Euler gibi patlamaz).
    """

    def __init__(self, value: float, tau_s: float):
        self.v = value
        self.tau = max(tau_s, 1e-3)

    def step(self, dt: float, target: float) -> float:
        self.v += (target - self.v) * (1.0 - math.exp(-dt / self.tau))
        return self.v


# --------------------------------------------------------------------------- #

@dataclass
class FaultState:
    """Enjekte edilmiş arızaların bileşen bazlı etkileri."""
    temp_offset: dict[str, float] = field(default_factory=dict)   # bileşen -> °C
    vib_offset: dict[str, float] = field(default_factory=dict)    # bileşen -> mm/s
    vfd_fault_code: int = 0
    dropouts: set[str] = field(default_factory=set)               # yayınlanmayacak sinyaller
    expiry: dict[str, float] = field(default_factory=dict)        # anahtar -> bitiş zamanı (sim sn)

    def clear(self) -> None:
        self.temp_offset.clear()
        self.vib_offset.clear()
        self.vfd_fault_code = 0
        self.dropouts.clear()
        self.expiry.clear()


# --------------------------------------------------------------------------- #
# Pompa ünitesi
# --------------------------------------------------------------------------- #

class PumpUnit:
    STOPPED, STARTING, RUNNING, STOPPING, FAULT, MAINT = (
        "STOPPED", "STARTING", "RUNNING", "STOPPING", "FAULT", "MAINT")

    def __init__(self, eq: dict, rng: random.Random):
        p = eq["params"]
        self.id = eq["id"]
        self.label = eq.get("label", eq["id"])
        self.header = eq["header"]
        self.ctl = eq["control"]
        self.rng = rng
        self.p = p

        self.curve = PumpCurve.from_ratings(
            q_rated=p["rated_flow_m3h"], h_rated=p["rated_head_m"],
            h_shutoff=p["shutoff_head_m"], q_bep=p["bep_flow_m3h"],
            eff_bep=p["bep_efficiency_pct"] / 100.0)

        self.state = self.STOPPED
        self.mode = "AUTO"
        self.speed_pct = 0.0
        self.speed_target = 0.0
        self.t_in_state = 0.0
        self.run_hours = rng.uniform(1200, 9000)     # sahadan gelmiş gibi başlangıç

        # anlık hidrolik (plant tarafından her adımda yazılır)
        self.q = 0.0
        self.h = 0.0
        self.eff = 0.0
        self.p_shaft = 0.0
        self.p_elec = 0.0
        self.current = 0.0
        self.suction_bar = 0.0
        self.discharge_bar = 0.0
        self.cav = 0.0

        # Tek termal düğüm: motor sargısı. Isınma akımın karesiyle orantılı.
        self.t_motor = Lag(T_AMB, 300)
        # her makinenin kendi titreşim imzası — gerçek pompalar birbirinin aynısı değildir
        self.vib_bias = rng.uniform(-0.15, 0.25)

        self.faults = FaultState()
        self.valve_open_pct = 0.0     # basma vanası (interlock)

    # -- durum makinesi ----------------------------------------------------- #

    @property
    def is_running(self) -> bool:
        return self.state in (self.RUNNING, self.STARTING, self.STOPPING) and self.speed_pct > 1.0

    @property
    def available(self) -> bool:
        return self.state not in (self.FAULT, self.MAINT)

    def request(self, want_run: bool, speed_cmd_pct: float, dt: float) -> None:
        p = self.p
        self.t_in_state += dt

        if self.state == self.FAULT:
            self.speed_target = 0.0
        elif self.state == self.STOPPED:
            if want_run and self.t_in_state >= p["min_stop_s"]:
                self._goto(self.STARTING)
        elif self.state == self.STARTING:
            # Basma vanası %80 açılmadan tam hıza çıkma — su darbesi önlemi
            cap = 100.0 if self.valve_open_pct > 80 else p["min_speed_pct"]
            self.speed_target = min(speed_cmd_pct, cap)
            if self.speed_pct >= self.speed_target - 0.5 and self.valve_open_pct > 80:
                self._goto(self.RUNNING)
            if not want_run:
                self._goto(self.STOPPING)
        elif self.state == self.RUNNING:
            self.speed_target = speed_cmd_pct
            self.run_hours += dt / 3600.0
            if not want_run and self.t_in_state >= p["min_run_s"]:
                self._goto(self.STOPPING)
        elif self.state == self.STOPPING:
            self.speed_target = 0.0
            if self.speed_pct <= 0.5:
                self._goto(self.STOPPED)
            if want_run:
                self._goto(self.STARTING)

        # hız rampası
        ramp = 100.0 / (p["start_ramp_s"] if self.speed_target > self.speed_pct else p["stop_ramp_s"])
        delta = self.speed_target - self.speed_pct
        self.speed_pct += max(-ramp * dt, min(ramp * dt, delta))
        self.speed_pct = max(0.0, min(100.0, self.speed_pct))

    def _goto(self, state: str) -> None:
        if state != self.state:
            self.state = state
            self.t_in_state = 0.0

    def trip(self, code: int) -> None:
        self.faults.vfd_fault_code = code
        self._goto(self.FAULT)
        self.speed_pct = 0.0
        self.speed_target = 0.0

    def reset(self) -> None:
        if self.state == self.FAULT:
            self.faults.vfd_fault_code = 0
            self._goto(self.STOPPED)

    # -- hidrolik sonrası güncelleme ---------------------------------------- #

    def apply_hydraulics(self, dt: float, q_m3h: float, head_m: float, basin_level: float) -> None:
        p = self.p
        s = self.speed_pct / 100.0

        # Emme basıncı: statik yük − emme hattı kaybı
        p_static = (basin_level - p["centerline_el_m"]) * BAR_PER_M
        loss = 0.09 * (q_m3h / p["rated_flow_m3h"]) ** 2
        self.suction_bar = p_static - loss

        # Kavitasyon: emme basıncı −0.30 bar altına inince başlar, −0.45'te tam
        self.cav = max(0.0, min(1.0, (-0.30 - self.suction_bar) / 0.15))

        # Kavitasyon debiyi ve verimi düşürür
        self.q = q_m3h * (1.0 - 0.15 * self.cav)
        self.h = head_m
        self.eff = self.curve.efficiency(self.q, max(s, 1e-3)) * (1.0 - 0.25 * self.cav) if s > 0.05 else 0.0

        self.p_shaft = shaft_power_kw(self.q, self.h, self.eff) if s > 0.05 else 0.0
        self.p_elec = self.p_shaft / 0.95 if self.p_shaft > 0 else 0.0
        self.current = line_current_a(self.p_elec, p["voltage_v"], p["cos_phi"])
        self.discharge_bar = max(0.0, self.suction_bar + self.h * BAR_PER_M)

        i_ratio = self.current / p["rated_current_a"] if p["rated_current_a"] > 0 else 0.0
        self.t_motor.step(dt, T_AMB + 85 * i_ratio ** 2 + self.faults.temp_offset.get("MOTOR", 0.0))

        # Koruma: sargı sınırı aşılırsa motor koruması atar
        if self.t_motor.v > MOTOR_TRIP_C and self.state != self.FAULT:
            self.trip(12)   # 12 = motor aşırı sıcaklık

    def _vib(self, comp: str, base: float) -> float:
        s = self.speed_pct / 100.0
        if s < 0.05:
            return 0.0
        q_ref = self.p["bep_flow_m3h"] * max(s, 1e-3)
        off_bep = abs(self.q / q_ref - 1.0) if q_ref > 0 else 0.0
        v = (base + self.vib_bias
             + 0.8 * s * s
             + 2.8 * min(off_bep, 1.5)
             + 3.5 * self.cav
             + self.rng.gauss(0, 0.12)
             + self.faults.vib_offset.get(comp, 0.0))
        return max(0.0, v)

    # -- sinyaller ---------------------------------------------------------- #

    def signals(self) -> dict:
        return {
            "flow_m3h": self.q,
            "discharge_press_bar": self.discharge_bar,
            "vfd_freq_hz": self.speed_pct / 100.0 * 50.0,
            "current_a": self.current,
            "power_kw": self.p_elec,
            "run_hours": self.run_hours,
            "MOTOR.temp": self.t_motor.v,
            "PUMP.vib": self._vib("PUMP", 1.2),
        }

    def status(self) -> dict:
        return {"state": self.state, "mode": self.mode}


# --------------------------------------------------------------------------- #
# Kelebek vana (pompa ile kilitli)
# --------------------------------------------------------------------------- #

class ButterflyValve:
    def __init__(self, eq: dict, rng: random.Random):
        self.id = eq["id"]
        self.label = eq.get("label", eq["id"])
        self.pump_id = eq["interlock_pump"]
        self.travel_s = eq["params"]["travel_s"]
        self.pos = 0.0
        self.setpoint = 0.0
        self.fault = False
        self.rng = rng

    def step(self, dt: float, want_open: bool) -> None:
        self.setpoint = 100.0 if want_open else 0.0
        if self.fault:
            return
        rate = 100.0 / self.travel_s
        d = self.setpoint - self.pos
        self.pos += max(-rate * dt, min(rate * dt, d))
        self.pos = max(0.0, min(100.0, self.pos))

    def signals(self) -> dict:
        return {
            "position_pct": self.pos,
            "limit_open": self.pos > 99.0,
            "limit_closed": self.pos < 1.0,
            "VLV__ACTUATOR.fault": self.fault,
        }

    def status(self) -> dict:
        if self.fault:
            return {"state": "FAULT", "mode": "AUTO"}
        if 1.0 <= self.pos <= 99.0:
            return {"state": "STARTING" if self.setpoint > self.pos else "STOPPING", "mode": "AUTO"}
        return {"state": "RUNNING" if self.pos > 99.0 else "STOPPED", "mode": "AUTO"}


class CheckValve:
    """Çekvalf — durumu pompa debisinden türetilir."""

    def __init__(self, eq: dict, rng: random.Random):
        self.id = eq["id"]
        self.label = eq.get("label", eq["id"])
        self.pump_id = eq["source_pump"]
        self.open = False
        self.slam_events = 0

    def step(self, dt: float, flow_m3h: float) -> None:
        now_open = flow_m3h > 5.0
        if self.open and not now_open:
            self.slam_events += 1        # kapanış = su darbesi olayı
        self.open = now_open

    def signals(self) -> dict:
        return {"open": self.open, "slam_events": self.slam_events}

    def status(self) -> dict:
        return {"state": "RUNNING" if self.open else "STOPPED", "mode": "AUTO"}


# --------------------------------------------------------------------------- #
# Sürgülü kapak
# --------------------------------------------------------------------------- #

class SlideGate:
    def __init__(self, eq: dict, rng: random.Random):
        p = eq["params"]
        self.id = eq["id"]
        self.label = eq.get("label", eq["id"])
        self.travel_s = p["travel_s"]
        self.pos = 100.0
        self.setpoint = 100.0
        self.jammed = False
        self.thermal_trip = False
        self.t_hoist = Lag(T_AMB, 240)
        self.rng = rng

    def step(self, dt: float) -> None:
        moving = abs(self.setpoint - self.pos) > 0.2 and not self.thermal_trip
        if moving and not self.jammed:
            rate = 100.0 / self.travel_s
            d = self.setpoint - self.pos
            self.pos += max(-rate * dt, min(rate * dt, d))
            self.pos = max(0.0, min(100.0, self.pos))

        self.current = 0.0
        if moving:
            self.current = 34.0 + self.rng.gauss(0, 1.0) if self.jammed else 16.0 + self.rng.gauss(0, 0.6)
        if self.jammed and self.current > 32.0:
            self.t_hoist.step(dt, 150.0)
            if self.t_hoist.v > 110.0:
                self.thermal_trip = True
        else:
            self.t_hoist.step(dt, T_AMB + (30.0 if moving else 0.0))

    def signals(self) -> dict:
        return {
            "position_pct": self.pos,
            "setpoint_pct": self.setpoint,
            "limit_open": self.pos > 99.5,
            "limit_closed": self.pos < 0.5,
            "GATE__HOIST.motor_current_a": getattr(self, "current", 0.0),
            "GATE__HOIST.thermal_trip": self.thermal_trip,
            "GATE__HOIST.temp": self.t_hoist.v,
        }

    def status(self) -> dict:
        if self.thermal_trip or self.jammed:
            return {"state": "FAULT", "mode": "AUTO"}
        if abs(self.setpoint - self.pos) > 0.2:
            return {"state": "STARTING" if self.setpoint > self.pos else "STOPPING", "mode": "AUTO"}
        return {"state": "RUNNING" if self.pos > 99.5 else "STOPPED", "mode": "AUTO"}


# --------------------------------------------------------------------------- #
# Izgara
# --------------------------------------------------------------------------- #

class TrashRack:
    def __init__(self, eq: dict, rng: random.Random):
        p = eq.get("params", {})
        self.id = eq["id"]
        self.label = eq.get("label", eq["id"])
        self.trigger = p.get("clean_trigger_dp_m", 0.25)
        self.clean_duration = p.get("clean_duration_s", 240)
        self.debris = 0.05
        self.cleaning_t = 0.0
        self.cleaner_pos = 0.0        # % — tarak konumu
        self.rng = rng

    def step(self, dt: float, q_in_m3h: float) -> None:
        if self.cleaning_t > 0:
            self.cleaning_t -= dt
            self.debris = max(0.02, self.debris - dt * (self.debris / 60.0))
            # Tarak çevrim boyunca inip çıkar — gerçek bir ızgara temizleyicisi
            # tek geçişte değil, birkaç turda temizler.
            phase = (self.clean_duration - self.cleaning_t) / max(self.clean_duration, 1e-6)
            turns = 3.0
            tri = abs(((phase * turns) % 1.0) * 2.0 - 1.0)      # 0..1..0 üçgen dalga
            self.cleaner_pos = 100.0 * (1.0 - tri)
        else:
            # Debi arttıkça daha çok çöp taşınır
            self.debris += dt * 2.2e-6 * (q_in_m3h / 1000.0) * self.rng.uniform(0.6, 1.5)
            self.cleaner_pos = max(0.0, self.cleaner_pos - dt * 12.0)   # park konumuna dön
            if self.dp > self.trigger:
                self.cleaning_t = self.clean_duration

    @property
    def dp(self) -> float:
        return min(1.5, self.debris)

    def signals(self) -> dict:
        return {
            "dp_m": self.dp,
            "cleaning_active": self.cleaning_t > 0,
            "RACK__CLEANER.motor_current_a": (11.0 + self.rng.gauss(0, 0.5)) if self.cleaning_t > 0 else 0.0,
            "RACK__CLEANER.position_pct": self.cleaner_pos,
        }

    def status(self) -> dict:
        return {"state": "RUNNING" if self.cleaning_t > 0 else "STOPPED", "mode": "AUTO"}
