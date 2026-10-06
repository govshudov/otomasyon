"""Pompa ünitesi: yatay bölünmüş gövdeli (split-case) pompa + kaplin + motor + şase.

Referans görseldeki düzen: boru hattı pompanın İÇİNDEN geçer (emme −Y'den
girer, basma +Y'ye çıkar), mil boru hattına dik (X ekseni), motor pompanın
yanında durur. Pompa gövdesi boru mavisi, motor beyaz, şase çelik.

Katalog sade: sinyali olan iki bileşen var — MOTOR (sıcaklık) ve PUMP
(titreşim). Bunlar AYRI nesne olmak zorunda; yoksa arızalı parçayı ayrı
boyayamayız. Kalan parçalar (kaplin, şase) görsel bağlam için ayrı düğüm.
"""
from __future__ import annotations

import math

from mathutils import Vector

from prim import Builder

PAD_H = 0.25          # beton kaide kalınlığı
FRAME_H = 0.18        # çelik şase yüksekliği


def _scale(params: dict) -> float:
    """Motor gücüne göre kaba ölçek — 160 kW referans."""
    return (params.get("motor_kw", 160.0) / 160.0) ** (1.0 / 3.0)


def axis_height(params: dict) -> float:
    """Mil ekseninin zemin üstündeki yüksekliği. Boru hatları bu kotta yürür."""
    k = _scale(params)
    return PAD_H + FRAME_H + 0.58 * k


def layout(station: dict, g: dict, cell_xs: list[float]) -> tuple[list[dict], float]:
    """Her pompa için yerleşim: gövde merkezi (x, y), motor yönü, beslendiği hücre.

    Pompalar hücrelerden daha geniş aralıkla dizilir (motor yanda durduğu
    için); emme hatları hücrelerden yelpaze gibi açılır. Kolektör grupları
    arasında ek boşluk bırakılır. Sıralar zikzak: yakın / uzak.

    Dönen: (yerleşim, y kayması). Yelpaze 45° kırılır; en dıştaki pompa
    hücresinden çok uzaktaysa kırılma yakın sıraya yetişmez. O zaman bütün
    sıralar (ve kolektör) gereken kadar geri çekilir — kayma bu değerdir.
    """
    pa = g["pump_area"]
    pumps = [e for e in station["equipment"] if e["type"] == "pump_hsc"]
    pumps.sort(key=lambda e: e.get("layout", {}).get("cell", 0))
    xs, x, prev = [], 0.0, None
    for i, e in enumerate(pumps):
        if i:
            x += pa["pitch"] + (pa["group_gap"] if e["header"] != prev else 0.0)
        xs.append(x)
        prev = e["header"]
    mid = (xs[0] + xs[-1]) / 2.0
    out = []
    for i, (e, px) in enumerate(zip(pumps, xs)):
        lay = e.get("layout", {})
        row = lay.get("row", i % 2)
        cell = lay.get("cell", i)
        out.append({"eq": e, "x": px - mid, "y": pa["rows"][row], "row": row,
                    "side": lay.get("motor", 1 if row == 0 else -1),
                    "cell_x": cell_xs[cell]})

    # Yelpaze: kırılma riser_y + 1 m'de başlar, |dx| kadar ilerler; ardından
    # flanş (0,35 m), pompa ağzı (0,83 m) ve 0,4 m pay gelir.
    k = max(_scale(u["eq"]["params"]) for u in out)
    need = max(pa["riser_y"] + 1.0 + abs(u["x"] - u["cell_x"]) + 0.35 + 0.83 * k + 0.4
               - (u["y"] - pa["rows"][0]) for u in out)
    shift = max(0.0, need - pa["rows"][0])
    for u in out:
        u["y"] += shift
    return out, shift


def footprint(params: dict, x: float, y: float, side: int, ground: float):
    """Beton kaidenin (boyut, merkez) tanımı — beton mesh'ine eklenir."""
    k = _scale(params)
    x0 = x - side * 0.65 * k                        # pompa tarafı ucu
    x1 = x + side * (0.86 + 1.30 + 0.45) * k        # fan kapağının ötesi
    lo, hi = min(x0, x1), max(x0, x1)
    return ((hi - lo + 0.4, 1.45 * k, PAD_H), ((lo + hi) / 2.0, y, ground + PAD_H / 2.0))


def build(reg, mats, eq: dict, x: float, y: float, side: int, ground: float,
          r_suction: float, r_discharge: float, seg: int = 16) -> dict:
    """Tek bir pompa ünitesi üretir. Dönen: {bileşen_adı: nesne, _bağlantı_noktaları}."""
    p = eq["params"]
    eid = eq["id"]
    k = _scale(p)
    s = side
    pad_top = ground + PAD_H
    frame_top = pad_top + FRAME_H
    za = ground + axis_height(p)                    # mil ekseni kotu
    out: dict = {}

    # ---------- Pompa gövdesi: salyangoz + ağızlar + yataklar (tek nesne) ---------- #
    cr = 0.48 * k
    pb = Builder()
    pb.cylinder(cr, 0.50 * k, seg=seg + 4, loc=(x, y, za), axis='X')               # salyangoz
    pb.cylinder(0.36 * k, 0.46 * k, seg=seg, loc=(x, y + 0.16 * k, za + 0.17 * k), axis='X')
    pb.box((0.58 * k, 1.04 * k, 0.06 * k), (x, y, za))                             # bölünme flanşı
    rs, rd = r_suction * 1.06, r_discharge * 1.06
    pb.cylinder(rs, 0.50 * k, seg=seg, loc=(x, y - 0.55 * k, za), axis='Y')        # emme ağzı
    pb.tube(r_suction * 1.5, r_suction * 0.98, 0.06, seg=seg,
            loc=(x, y - 0.80 * k, za), axis='Y')
    pb.cylinder(rd, 0.50 * k, seg=seg, loc=(x, y + 0.55 * k, za), axis='Y')        # basma ağzı
    pb.tube(r_discharge * 1.5, r_discharge * 0.98, 0.06, seg=seg,
            loc=(x, y + 0.80 * k, za), axis='Y')
    for sx in (-1, 1):                                                             # yatak gövdeleri
        pb.cylinder(0.15 * k, 0.24 * k, seg=12, loc=(x + sx * 0.40 * k, y, za), axis='X')
    pb.cylinder(0.05 * k, 1.30 * k, seg=8, loc=(x + s * 0.10 * k, y, za), axis='X')  # mil
    ped_h = (za - cr + 0.06 * k) - frame_top
    pb.box((0.62 * k, 0.70 * k, ped_h), (x, y, frame_top + ped_h / 2.0))           # ayak
    ob = pb.finish(f"__pmp_{eid}")
    out["PUMP"] = reg.equipment(ob, eid, "PUMP")

    # ---------- Kaplin ---------- #
    cb = Builder()
    cb.cylinder(0.17 * k, 0.22 * k, seg=seg, loc=(x + s * 0.72 * k, y, za), axis='X')
    out["COUPLING"] = reg.equipment(cb.finish(f"__cp_{eid}"), eid, "COUPLING")

    # ---------- Motor: gövde + kanatçık + kapaklar + fan + klemens (tek nesne) ---------- #
    mr, ml = 0.40 * k, 1.30 * k
    xm = x + s * (0.86 * k + ml / 2.0)
    mb = Builder()
    mb.cylinder(mr, ml, seg=seg + 4, loc=(xm, y, za), axis='X')
    for sx in (-1, 1):                                                             # yatak kapakları
        mb.cylinder(mr * 1.05, 0.10 * k, seg=seg + 4,
                    loc=(xm + sx * (ml / 2.0 - 0.05 * k), y, za), axis='X')
    for i in range(16):                                                            # soğutma kanatçıkları
        a = math.tau * i / 16
        if math.sin(a) < -0.55:
            continue                                                               # alt taraf: ayaklar
        # Kare kesitli çubuk: X ekseni etrafında döndürmeye gerek kalmasın
        cy, cz = math.cos(a) * (mr + 0.02 * k), math.sin(a) * (mr + 0.02 * k)
        mb.box((ml * 0.82, 0.05 * k, 0.05 * k), (xm, y + cy, za + cz))
    xf = xm + s * (ml / 2.0 + 0.16 * k)
    mb.cylinder(mr * 0.92, 0.32 * k, seg=seg + 4, loc=(xf, y, za), axis='X')       # fan kapağı
    mb.cylinder(mr * 0.70, 0.03 * k, seg=seg, loc=(xf + s * 0.17 * k, y, za), axis='X')
    mb.box((0.34 * k, 0.36 * k, 0.24 * k), (xm - s * 0.15 * k, y, za + mr + 0.10 * k))  # klemens kutusu
    foot_h = (za - mr + 0.04 * k) - frame_top
    for sx in (-1, 1):                                                             # motor ayakları
        mb.box((0.20 * k, 0.72 * k, foot_h), (xm + sx * 0.42 * k, y, frame_top + foot_h / 2.0))
    mb.cylinder(0.05 * k, 0.30 * k, seg=8, loc=(x + s * 0.88 * k, y, za), axis='X')  # mil ucu
    out["MOTOR"] = reg.equipment(mb.finish(f"__mot_{eid}"), eid, "MOTOR")

    # ---------- Şase: iki boyuna profil + travers ---------- #
    x0, x1 = x - s * 0.65 * k, xf + s * 0.30 * k
    lo, hi = min(x0, x1), max(x0, x1)
    fb = Builder()
    for sy in (-1, 1):
        fb.box((hi - lo, 0.12 * k, FRAME_H), ((lo + hi) / 2.0, y + sy * 0.42 * k, pad_top + FRAME_H / 2.0))
    for xx in (lo + 0.05, (lo + hi) / 2.0, hi - 0.05):
        fb.box((0.10, 0.96 * k, FRAME_H * 0.7), (xx, y, pad_top + FRAME_H * 0.35))
    out["BASE"] = reg.equipment(fb.finish(f"__base_{eid}"), eid, "BASE")

    # ---------- Malzemeler ---------- #
    for comp, o, m in (("PUMP", out["PUMP"], "PIPE"), ("COUPLING", out["COUPLING"], "DARK"),
                       ("MOTOR", out["MOTOR"], "MACHINE"), ("BASE", out["BASE"], "STEEL")):
        o.data.materials.clear()
        o.data.materials.append(mats[m])

    # Boru hatlarının bağlandığı flanş yüzleri
    out["_suction_point"] = Vector((x, y - 0.83 * k, za))
    out["_discharge_point"] = Vector((x, y + 0.83 * k, za))
    out["_axis_z"] = za
    return out
