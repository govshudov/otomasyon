"""Tesis orkestrasyonu: giriş debisi modeli, PLC kademe mantığı, adım döngüsü.

Buradaki `Plant` sınıfı MQTT'den habersizdir — saf simülasyon. Yayınlama
`publisher.py`'nin işi. Böylece simülatör test edilebilir kalır.
"""
from __future__ import annotations

import math
import random

from hydraulics import Basin, friction_coefficient, solve_parallel
from machines import ButterflyValve, CheckValve, PumpUnit, SlideGate, TrashRack


def equivalent_basin(plan: list[list[float]]) -> tuple[float, float, float]:
    """Plan istasyonlarından eşdeğer trapez havuz: (boy, ort. taban, ort. üst genişlik).

    Kanal boyunca genişlik değişiyor (dar giriş, geniş ön havuz). Hacim ve
    yüzey alanı genişliğin boy boyunca ortalamasıyla aynı kalır; seviye
    dinamiği için bu yeterli.
    """
    length = plan[-1][0] - plan[0][0]
    if length <= 0:
        raise ValueError("channel.plan y'ye göre artan sırada olmalı")
    wb = wt = 0.0
    for (y0, b0, t0), (y1, b1, t1) in zip(plan, plan[1:]):
        wb += (b0 + b1) / 2.0 * (y1 - y0)
        wt += (t0 + t1) / 2.0 * (y1 - y0)
    return length, wb / length, wt / length


class InflowModel:
    """Günlük desen + gürültü + rastgele yağış olayı.

    Su tüketimi/geliri gerçek hayatta çift tepelidir (sabah ve akşam).
    """

    def __init__(self, cfg: dict, rng: random.Random):
        self.base = cfg["base_m3h"]
        self.amp = cfg["diurnal_amp_m3h"]
        self.peak = cfg["diurnal_peak_hour"]
        self.noise = cfg["noise_m3h"]
        self.storm_p = cfg["storm_probability_per_hour"]
        self.rng = rng
        self.storm_t = 0.0
        self.storm_peak = 0.0
        self._drift = 0.0

    def value(self, sim_time_s: float, dt: float) -> float:
        h = (sim_time_s / 3600.0) % 24.0
        phase = 2.0 * math.pi * (h - self.peak) / 24.0
        diurnal = 0.6 * math.sin(phase) + 0.4 * math.sin(2.0 * phase)

        # Yağış olayı: 10 dk yükseliş, 40 dk sönüm
        if self.storm_t <= 0 and self.rng.random() < self.storm_p * dt / 3600.0:
            self.storm_t = 3000.0
            self.storm_peak = self.base * self.rng.uniform(0.5, 1.4)
        storm = 0.0
        if self.storm_t > 0:
            self.storm_t -= dt
            age = 3000.0 - self.storm_t
            storm = self.storm_peak * (min(age / 600.0, 1.0) * math.exp(-max(0.0, age - 600.0) / 2400.0))

        # Ölçüm gürültüsü ani sıçramasın diye yumuşatılmış rastgele yürüyüş
        self._drift += (self.rng.gauss(0, 1) - self._drift * 0.1) * min(dt / 10.0, 1.0)
        return max(0.0, self.base + self.amp * diurnal + storm + self.noise * self._drift * 0.3)


class Plant:
    def __init__(self, station: dict, seed: int = 7):
        self.rng = random.Random(seed)
        self.cfg = station
        self.station_id = station["station_id"]
        self.sim_time = 0.0

        by_type: dict[str, list[dict]] = {}
        for e in station["equipment"]:
            by_type.setdefault(e["type"], []).append(e)
        self.eq_cfg = {e["id"]: e for e in station["equipment"]}

        g = station["geometry"]["channel"]
        hy = station["hydraulics"]
        self.basin_cfg = hy["basin"]
        length, wb, wt = equivalent_basin(g["plan"])
        self.basin = Basin(length=length, width_bottom=wb, width_top=wt,
                           depth=g["deck_el"] - g["invert_el"], level_m=2.8)
        self.inflow = InflowModel(hy["inflow"], self.rng)

        self.pumps: dict[str, PumpUnit] = {e["id"]: PumpUnit(e, self.rng) for e in by_type.get("pump_hsc", [])}
        self.valves: dict[str, ButterflyValve] = {e["id"]: ButterflyValve(e, self.rng) for e in by_type.get("butterfly_valve", [])}
        self.nrvs: dict[str, CheckValve] = {e["id"]: CheckValve(e, self.rng) for e in by_type.get("check_valve", [])}
        self.gates: dict[str, SlideGate] = {e["id"]: SlideGate(e, self.rng) for e in by_type.get("slide_gate", [])}
        self.racks: dict[str, TrashRack] = {e["id"]: TrashRack(e, self.rng) for e in by_type.get("trash_rack", [])}
        self.basin_id = by_type["basin"][0]["id"]
        # Emme hücresi seviye datçikleri: datçik → beslediği pompa
        self.level_sensors: dict[str, str] = {e["id"]: e["source_pump"] for e in by_type.get("level_sensor", [])}
        self._lt_noise: dict[str, float] = {k: 0.0 for k in self.level_sensors}

        # Kolektörler: sürtünme katsayısı tasarım noktasından türetilir
        self.headers: dict[str, dict] = {}
        for e in by_type.get("header", []):
            p = e["params"]
            n = len(p["pumps"])
            q_design = n * self.pumps[p["pumps"][0]].p["rated_flow_m3h"]
            h_design = self.pumps[p["pumps"][0]].p["rated_head_m"]
            h_friction = h_design - p["static_head_m"]
            self.headers[e["id"]] = {
                "cfg": e, "pumps": p["pumps"],
                "r": friction_coefficient(h_friction, q_design),
                "flow": 0.0, "press": 0.0, "vel": 0.0,
                # Debimetrenin sayacı (m³) — sahadan gelmiş gibi büyük bir başlangıç
                "total": self.rng.uniform(1.5e6, 4.5e6),
                "area": math.pi * (p["dn"] / 2000.0) ** 2,
            }

        # PLC kademe mandalı — pompa kimliğine değil, görev sırasına bağlıdır
        self.start_levels = sorted(e["control"]["start_level_m"] for e in station["equipment"] if e["type"] == "pump_hsc")
        self.stop_levels = sorted(e["control"]["stop_level_m"] for e in station["equipment"] if e["type"] == "pump_hsc")
        self.duty_latch = [False] * len(self.pumps)
        self.speed_cmd = 92.0
        self._pi_i = 0.0
        self.level_setpoint = 2.5

    # ------------------------------------------------------------------ #
    # PLC mantığı
    # ------------------------------------------------------------------ #

    def _duty_order(self) -> list[PumpUnit]:
        """Görev rotasyonu: en az çalışmış pompa ilk kalkar. Saatler eşitlenir."""
        avail = [p for p in self.pumps.values() if p.available]
        avail.sort(key=lambda p: (p.run_hours, p.id))
        faulted = [p for p in self.pumps.values() if not p.available]
        return avail + faulted

    def _plc(self, dt: float) -> dict[str, bool]:
        lvl = self.basin.level
        b = self.basin_cfg
        order = self._duty_order()
        want: dict[str, bool] = {p.id: False for p in self.pumps.values()}

        # Eşikler görev SIRASINA bağlıdır, pompa kimliğine değil. Rotasyonla hangi
        # pompanın 1. kademe olduğu değişir ama kademe seviyeleri sabit kalır.
        for i, pump in enumerate(order):
            start_l = self.start_levels[i]
            stop_l = self.stop_levels[i]
            if lvl >= start_l:
                self.duty_latch[i] = True
            elif lvl <= stop_l:
                self.duty_latch[i] = False
            want[pump.id] = self.duty_latch[i] and pump.available

        # Kuru çalışma koruması — her şeyin üstünde
        if lvl <= b["llwl"]:
            want = {k: False for k in want}
            self.duty_latch = [False] * len(self.duty_latch)
        # Taşma riski — tüm sağlam pompalar devreye
        elif lvl >= b["hhwl"]:
            for p in self.pumps.values():
                if p.available:
                    want[p.id] = True
            self.duty_latch = [True] * len(self.duty_latch)

        # Ortak hız: seviyeyi hedefte tutan PI
        err = lvl - self.level_setpoint
        self._pi_i = max(-25.0, min(25.0, self._pi_i + err * dt * 0.08))
        raw = 94.0 + 3.5 * err + self._pi_i
        min_speed = min(p.p["min_speed_pct"] for p in self.pumps.values())
        self.speed_cmd = max(min_speed, min(100.0, raw))
        return want

    # ------------------------------------------------------------------ #
    # Adım
    # ------------------------------------------------------------------ #

    def step(self, dt: float) -> None:
        self.sim_time += dt
        q_in = self.inflow.value(self.sim_time, dt)

        want = self._plc(dt)

        # 1) Vanalar (pompa kalkışından önce açılmalı)
        for v in self.valves.values():
            v.step(dt, want.get(v.pump_id, False))
            self.pumps[v.pump_id].valve_open_pct = v.pos

        # 2) Pompa durum makineleri
        for p in self.pumps.values():
            p.request(want[p.id], self.speed_cmd, dt)

        # 3) Kolektör başına paralel çalışma çözümü
        q_out_total = 0.0
        for hid, h in self.headers.items():
            static = self.pumps[h["pumps"][0]].p["discharge_el_m"] - self.basin.level
            running = [(self.pumps[pid].curve, self.pumps[pid].speed_pct / 100.0)
                       for pid in h["pumps"] if self.pumps[pid].is_running]
            ids = [pid for pid in h["pumps"] if self.pumps[pid].is_running]
            head, flows, q_tot = solve_parallel(running, static, h["r"])

            flow_by_id = dict(zip(ids, flows))
            for pid in h["pumps"]:
                self.pumps[pid].apply_hydraulics(dt, flow_by_id.get(pid, 0.0),
                                                 head if pid in flow_by_id else 0.0,
                                                 self.basin.level)
            h["flow"] = sum(self.pumps[pid].q for pid in h["pumps"])
            h["press"] = head * 0.0981 if q_tot > 0 else static * 0.0981
            h["vel"] = (h["flow"] / 3600.0) / h["area"] if h["area"] > 0 else 0.0
            h["total"] += h["flow"] * dt / 3600.0
            q_out_total += h["flow"]

        # 4) Çekvalfler, ızgara, kapaklar
        for nrv in self.nrvs.values():
            nrv.step(dt, self.pumps[nrv.pump_id].q)
        for r in self.racks.values():
            r.step(dt, q_in)
        for gt in self.gates.values():
            gt.step(dt)

        # 5) Havuz kütle dengesi
        self.basin.step(dt, q_in, q_out_total)
        self.q_in = q_in
        self.q_out = q_out_total

    # ------------------------------------------------------------------ #

    def snapshot(self) -> dict[str, dict]:
        """Tüm ekipmanın {id: {"v": sinyaller, "s": durum}} görüntüsü."""
        out: dict[str, dict] = {}

        lvl = self.basin.level
        out[self.basin_id] = {
            "v": {
                "level_m": lvl,
                "volume_m3": self.basin.volume(),
                "inflow_m3h": getattr(self, "q_in", 0.0),
                "outflow_m3h": getattr(self, "q_out", 0.0),
                "velocity_ms": self.basin.velocity_ms(getattr(self, "q_in", 0.0)),
                "temp_c": 14.0 + 3.0 * math.sin(2 * math.pi * (self.sim_time / 86400.0)),
            },
            "s": {"state": "RUNNING", "mode": "AUTO"},
        }
        for hid, h in self.headers.items():
            out[hid] = {"v": {"flow_m3h": h["flow"], "total_m3": h["total"],
                              "press_bar": h["press"], "velocity_ms": h["vel"]},
                        "s": {"state": "RUNNING" if h["flow"] > 5 else "STOPPED", "mode": "AUTO"}}
        for lid, pid in self.level_sensors.items():
            # Datçik hücre girişinde (havuz tarafı): seviye havuzdan biraz düşük,
            # hücreye akış hızlandıkça debinin karesiyle (anma debisinde ~0,06 m).
            # Gürültü yumuşatılmış — dalgalanma gibi.
            pump = self.pumps[pid]
            q = pump.q / max(pump.p["rated_flow_m3h"], 1.0)
            n = self._lt_noise[lid] = self._lt_noise[lid] * 0.85 + self.rng.gauss(0.0, 0.006)
            out[lid] = {"v": {"level_m": max(0.0, lvl - 0.06 * q * q + n)},
                        "s": {"state": "RUNNING", "mode": "AUTO"}}
        for group in (self.pumps, self.valves, self.nrvs, self.gates, self.racks):
            for eq in group.values():
                out[eq.id] = {"v": eq.signals(), "s": eq.status()}
        return out

    # ------------------------------------------------------------------ #
    # Arıza enjeksiyonu
    # ------------------------------------------------------------------ #

    def inject(self, target: str, component: str | None, kind: str,
               severity: float = 1.0, duration_s: float | None = None) -> str:
        pump = self.pumps.get(target)
        gate = self.gates.get(target)
        valve = self.valves.get(target)

        if kind == "clear":
            if pump:
                pump.faults.clear()
                pump.reset()
            if gate:
                gate.jammed = False
                gate.thermal_trip = False
            if valve:
                valve.fault = False
            return f"{target}: tüm arızalar temizlendi"

        if pump:
            f = pump.faults
            # Duran pompada termal arıza görünmez (motor ısınmaz) — kullanıcıyı uyar
            note = "" if pump.is_running else "  [UYARI: pompa duruyor, etki kalkınca görünür]"
            # Sargı sıcaklıkları motorda, podşipnikler pompa gövdesinde ölçülüyor;
            # arıza hangi parça seçilmiş olursa olsun ölçüldüğü yere uygulanır.
            if kind == "overheat":
                f.temp_offset["MOTOR"] = 85.0 * severity
                return f"{target}/MOTOR: sargı aşırı ısınması (+{85*severity:.0f} °C hedef){note}"
            if kind == "bearing":
                f.temp_offset["PUMP"] = 60.0 * severity
                return f"{target}/PUMP: podşipnik ısınması (+{60*severity:.0f} °C hedef){note}"
            if kind == "overcurrent":
                f.current_boost = 0.18 * severity
                return f"{target}: aşırı tok (+%{18*severity:.0f}){note}"
            if kind == "vfd_trip":
                pump.trip(int(7 * severity) or 7)
                return f"{target}: sürücü arızası — pompa tripledi"
            if kind == "sensor_dropout":
                sig = component if component and "." in component else "MOTOR.t1"
                f.dropouts.add(sig)
                return f"{target}: {sig} sensör kaybı"
        if gate and kind == "gate":
            # Kapak konum komutu. Gerçek tesiste operatör ya da PLC verir;
            # burada hem manuel işletmeyi hem 3D hareket bağlantısını test eder.
            gate.setpoint = max(0.0, min(100.0, float(severity) * 100.0))
            return f"{target}: kapak hedefi %{gate.setpoint:.0f}"
        if gate and kind == "jam":
            gate.jammed = True
            return f"{target}: kapak mekanik sıkışma"
        if valve and kind == "actuator_fault":
            valve.fault = True
            return f"{target}: vana aktüatör arızası"
        return f"bilinmeyen arıza: {target}/{kind}"

    def dropouts(self) -> dict[str, set[str]]:
        """Sensör kaybı yaşayan sinyaller — yayıncı bunları hiç göndermez."""
        return {p.id: p.faults.dropouts for p in self.pumps.values() if p.faults.dropouts}

    def maybe_degrade(self, dt: float, prob_per_hour: float) -> str | None:
        """Kendiliğinden yavaş bozulma. Demo için: bir motor sargısı ya da bir podşipnik ısınır."""
        if prob_per_hour <= 0 or self.rng.random() >= prob_per_hour * dt / 3600.0:
            return None
        candidates = [p for p in self.pumps.values() if p.available and not p.faults.temp_offset]
        if not candidates:
            return None
        pump = self.rng.choice(candidates)
        if self.rng.random() < 0.5:
            pump.faults.temp_offset["MOTOR"] = self.rng.uniform(35.0, 70.0)
            return f"{pump.id}/MOTOR: kendiliğinden ısınma başladı"
        pump.faults.temp_offset["PUMP"] = self.rng.uniform(30.0, 55.0)
        return f"{pump.id}/PUMP: kendiliğinden podşipnik ısınması başladı"
