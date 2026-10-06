"""Hidrolik model.

Pompa eğrileri, paralel çalışma denge noktası ve havuz seviye dinamiği.
Buradaki her fonksiyon saf (state tutmaz) ve tek başına test edilebilir.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

G = 9.81          # m/s²
RHO = 1000.0      # kg/m³ (su)


# --------------------------------------------------------------------------- #
# Pompa eğrisi
# --------------------------------------------------------------------------- #

@dataclass
class PumpCurve:
    """H = s²·H0 − k·Q²   (affinite yasaları uygulanmış)

    s   : hız oranı (n / n_nominal)
    H0  : kapalı vana (shutoff) basma yüksekliği, m
    k   : eğri katsayısı, nominal noktadan türetilir
    """
    h_shutoff: float
    k: float
    q_bep: float
    eff_bep: float

    @classmethod
    def from_ratings(cls, q_rated: float, h_rated: float, h_shutoff: float,
                     q_bep: float, eff_bep: float) -> "PumpCurve":
        if q_rated <= 0:
            raise ValueError("q_rated > 0 olmalı")
        k = (h_shutoff - h_rated) / (q_rated ** 2)
        if k <= 0:
            raise ValueError("h_shutoff, h_rated'den büyük olmalı")
        return cls(h_shutoff=h_shutoff, k=k, q_bep=q_bep, eff_bep=eff_bep)

    def head(self, q_m3h: float, s: float) -> float:
        return s * s * self.h_shutoff - self.k * q_m3h * q_m3h

    def flow_at_head(self, h: float, s: float) -> float:
        """Verilen basma yüksekliğinde pompanın vereceği debi. Veremiyorsa 0."""
        num = s * s * self.h_shutoff - h
        return math.sqrt(num / self.k) if num > 0 else 0.0

    def efficiency(self, q_m3h: float, s: float) -> float:
        """BEP etrafında parabolik verim modeli. Oran q/q_bep hıza göre ölçeklenir."""
        q_ref = self.q_bep * max(s, 1e-3)
        if q_ref <= 0:
            return 0.05
        x = q_m3h / q_ref
        eta = self.eff_bep * (2.0 * x - x * x)
        return max(0.05, min(self.eff_bep, eta))


# --------------------------------------------------------------------------- #
# Paralel çalışma çözümü
# --------------------------------------------------------------------------- #

def solve_parallel(running: list[tuple[PumpCurve, float]],
                   h_static: float, r: float,
                   iters: int = 48) -> tuple[float, list[float], float]:
    """Aynı kolektöre basan pompaların ortak denge noktasını bulur.

    running  : [(eğri, hız_oranı), ...] — yalnız DÖNEN pompalar
    h_static : statik yükseklik (m). Havuz seviyesine göre değişir.
    r        : hat sürtünme katsayısı, H_sürtünme = r·Q_toplam²

    Dönen: (ortak_basma_yüksekliği, [her_pompanın_debisi], toplam_debi)

    Yöntem: bisection. Pompa toplamı H'ye göre azalan, sistem eğrisi artan;
    fark fonksiyonu tek köklü ve monoton — bisection garantili yakınsar.
    """
    if not running:
        return h_static, [], 0.0

    h_lo = max(h_static, 0.0)
    h_hi = max((s * s * c.h_shutoff) for c, s in running)

    # Statik yükseklik shutoff'u aşıyorsa pompa su basamaz: kapalı vana çalışması.
    if h_hi <= h_lo:
        return h_lo, [0.0] * len(running), 0.0

    def q_pumps(h: float) -> float:
        return sum(c.flow_at_head(h, s) for c, s in running)

    def q_system(h: float) -> float:
        d = h - h_static
        return math.sqrt(d / r) if (d > 0 and r > 0) else 0.0

    for _ in range(iters):
        mid = 0.5 * (h_lo + h_hi)
        if q_pumps(mid) - q_system(mid) > 0:
            h_lo = mid        # pompalar fazla veriyor → basma yüksekliği artmalı
        else:
            h_hi = mid
    h = 0.5 * (h_lo + h_hi)

    flows = [c.flow_at_head(h, s) for c, s in running]
    return h, flows, sum(flows)


def friction_coefficient(h_friction_at: float, q_at: float) -> float:
    """Tasarım noktasından hat sürtünme katsayısı: H_f = r·Q²"""
    return h_friction_at / (q_at ** 2) if q_at > 0 else 0.0


def shaft_power_kw(q_m3h: float, h_m: float, eff: float) -> float:
    """Mil gücü. P = ρ·g·Q·H / η"""
    if q_m3h <= 0 or h_m <= 0:
        return 0.0
    q_m3s = q_m3h / 3600.0
    return (RHO * G * q_m3s * h_m / 1000.0) / max(eff, 0.05)


def line_current_a(p_elec_kw: float, voltage_v: float, cos_phi: float) -> float:
    denom = math.sqrt(3.0) * voltage_v * cos_phi
    return (p_elec_kw * 1000.0 / denom) if denom > 0 else 0.0


# --------------------------------------------------------------------------- #
# Emme havuzu (trapez kesit)
# --------------------------------------------------------------------------- #

class Basin:
    """Trapez kesitli emme havuzu. Genişlik seviyeye göre doğrusal değişir."""

    def __init__(self, length: float, width_bottom: float, width_top: float,
                 depth: float, level_m: float = 3.0):
        self.length = length
        self.w_b = width_bottom
        self.w_t = width_top
        self.depth = depth
        self.level = level_m

    def width_at(self, h: float) -> float:
        h = max(0.0, min(h, self.depth))
        return self.w_b + (self.w_t - self.w_b) * (h / self.depth)

    def surface_area(self, h: float | None = None) -> float:
        return self.length * self.width_at(self.level if h is None else h)

    def volume(self, h: float | None = None) -> float:
        h = self.level if h is None else h
        h = max(0.0, min(h, self.depth))
        return self.length * (self.w_b * h + (self.w_t - self.w_b) * h * h / (2.0 * self.depth))

    def step(self, dt_s: float, q_in_m3h: float, q_out_m3h: float) -> float:
        """Kütle dengesi ile seviyeyi ilerletir. Dönen: yeni seviye (m)."""
        net_m3s = (q_in_m3h - q_out_m3h) / 3600.0
        area = max(self.surface_area(), 1.0)
        self.level = max(0.0, min(self.depth, self.level + net_m3s * dt_s / area))
        return self.level

    def velocity_ms(self, q_m3h: float) -> float:
        """Kanal içi ortalama akış hızı — kesit alanı seviyeye bağlı."""
        cross = 0.5 * (self.w_b + self.width_at(self.level)) * self.level
        return (q_m3h / 3600.0) / cross if cross > 0.05 else 0.0
