"""Boru hatları, vanalar, çekvalfler ve kolektörler.

Referans görseldeki mavi hatlar. Her boru merkez çizgiden üretilir:
köşeler `fillet_polyline` ile yuvarlatılır (gerçek dirsek yarıçapı), sonra
daire süpürülür. Keskin köşeli boru üretilmez.

Hat düzeni (her pompa için):

    hücre ─(duvar içinden)─ yükseltici ─ dirsek ─ yelpaze ─ POMPA ─ kompansatör
          ─ çekvalf ─ el çarklı vana ─ kolektör ─ ana hat (+Y)

Akış animasyonu için her branş ayrı düğümdür: pompa durunca yalnız o branşın
animasyonu durur, kolektörünki devam eder. Akış koordinatının nasıl
hesaplanacağı düğümün `flow_w` / `flow_join_x` extras'ında taşınır — frontend
borunun şeklini bilmeden akışı doğru yönde yürütür.
"""
from __future__ import annotations

import math

from mathutils import Vector

import prim
from prim import Builder

# DN → dış çap (mm). EN 10220 / ISO 4200 yaklaşık değerleri.
DN_OD = {80: 88.9, 100: 114.3, 150: 168.3, 200: 219.1, 250: 273.0,
         300: 323.9, 350: 355.6, 400: 406.4, 450: 457.0, 500: 508.0,
         600: 610.0, 700: 711.0, 800: 813.0}


def radius(dn: int) -> float:
    """DN'den dış yarıçap (m). Tabloda yoksa DN'i çap kabul et."""
    return DN_OD.get(dn, float(dn)) / 2000.0


def _axis_of(d: Vector) -> str:
    a = abs(d.x), abs(d.y), abs(d.z)
    return 'XYZ'[a.index(max(a))]


def flange_pair(b: Builder, point: Vector, axis: str, r: float, seg=14) -> None:
    """Boru üzerine flanş çifti — birleşim noktasını belli eder."""
    d = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis]
    for s in (-1, 1):
        b.tube(r * 1.45, r * 0.98, 0.04, seg=seg, loc=tuple(point + d * (s * 0.05)), axis=axis)


def _flow_extras(ob, area_r: float, w: tuple[float, float, float],
                 join_x: float | None = None) -> None:
    """Akış animasyonu için kesit alanı ve akış koordinatı ağırlıkları.

    Frontend her köşe için u = w·p (Blender koordinatı) hesaplar; bant +u
    yönünde yürür. Yükseltici + yatay hat için w = (0, 1, 1): dikey kısımda
    z, yatayda y artar — u boru boyunca kesintisiz büyür. `join_x` verilirse
    u'dan |x − join_x| düşülür: kolektörde akış iki uçtan ana hatta doğru akar.
    """
    ob["flow_area_m2"] = round(math.pi * area_r * area_r, 5)
    ob["flow_w"] = [float(v) for v in w]
    if join_x is not None:
        ob["flow_join_x"] = round(join_x, 4)


# --------------------------------------------------------------------------- #
# Emme hattı
# --------------------------------------------------------------------------- #

def suction_line(reg, mats, pump_eq: dict, cell_x: float, wall_out_y: float,
                 riser_y: float, suction_z: float, inlet: Vector, seg: int = 14) -> None:
    """Hücreden pompanın emme flanşına.

    Başlık duvarının içinden yatay çıkar, duvar dibinde yükselir, pompa
    kotunda dirsekle döner ve 45° kırılarak pompanın eksenine kayar.
    """
    eid = pump_eq["id"]
    r = radius(pump_eq["params"]["dn_suction"])
    z = inlet.z
    dx = inlet.x - cell_x
    y_jog = riser_y + 1.0
    path = [Vector((cell_x, wall_out_y - 0.6, suction_z)),
            Vector((cell_x, riser_y, suction_z)),
            Vector((cell_x, riser_y, z)),
            Vector((cell_x, y_jog, z))]
    if abs(dx) > 0.05:
        path.append(Vector((inlet.x, y_jog + abs(dx), z)))
    path.append(inlet)
    pts = prim.fillet_polyline(path, max(r * 2.6, 0.55), arc_seg=6)

    b = Builder()
    b.sweep(pts, r, ring_seg=seg)
    flange_pair(b, Vector((cell_x, wall_out_y + 0.12, suction_z)), 'Y', r, seg)   # duvar çıkışı
    flange_pair(b, Vector((cell_x, riser_y, z - 1.2)), 'Z', r, seg)              # yükseltici
    flange_pair(b, inlet + Vector((0, -0.35, 0)), 'Y', r, seg)                   # pompa önü
    ob = b.finish(f"__su_{eid}")
    reg.equipment(ob, eid, "PIPE__SUCTION")
    ob.data.materials.append(mats["PIPE"])
    _flow_extras(ob, r, (0.0, 1.0, 1.0))


# --------------------------------------------------------------------------- #
# Basma hattı ve armatürleri
# --------------------------------------------------------------------------- #

def discharge_line(reg, mats, pump_eq: dict, outlet: Vector, y_header: float,
                   r_header: float, seg: int = 14) -> tuple[Vector, Vector, float]:
    """Pompa basma flanşından kolektöre düz hat + kompansatör.

    Dönen: (çekvalf noktası, vana noktası, boru yarıçapı).
    """
    eid = pump_eq["id"]
    r = radius(pump_eq["params"]["dn_discharge"])
    end = Vector((outlet.x, y_header - r_header * 0.6, outlet.z))

    b = Builder()
    b.sweep([outlet, end], r, ring_seg=seg)
    flange_pair(b, outlet + Vector((0, 0.12, 0)), 'Y', r, seg)
    # Kompansatör (körük) — pompa titreşimini hattan yalıtır
    for i in range(5):
        b.tube(r * 1.28, r * 1.0, 0.045, seg=seg,
               loc=(outlet.x, outlet.y + 0.42 + i * 0.075, outlet.z), axis='Y')
    flange_pair(b, outlet + Vector((0, 0.82, 0)), 'Y', r, seg)
    ob = b.finish(f"__br_{eid}")
    reg.equipment(ob, eid, "PIPE__DISCHARGE")
    ob.data.materials.append(mats["PIPE"])
    _flow_extras(ob, r, (0.0, 1.0, 0.0))

    p_nrv = outlet + Vector((0, 1.35, 0))
    p_vlv = outlet + Vector((0, 2.20, 0))
    return p_nrv, p_vlv, r


def check_valve(reg, mats, eq: dict, point: Vector, r: float, seg: int = 14) -> None:
    """Çekvalf: şişkin gövde + üstte kapak."""
    eid = eq["id"]
    b = Builder()
    b.cylinder(r * 1.30, 0.46, seg=seg, loc=tuple(point), axis='Y')
    b.box((r * 1.5, 0.30, r * 0.7), tuple(point + Vector((0, 0, r * 1.25))))
    for s in (-1, 1):
        b.tube(r * 1.52, r * 0.97, 0.05, seg=seg,
               loc=tuple(point + Vector((0, s * 0.255, 0))), axis='Y')
    ob = b.finish(f"__nrv_{eid}")
    reg.equipment(ob, eid, "NRV__BODY")
    ob.data.materials.append(mats["PIPE"])


def butterfly_valve(reg, mats, eq: dict, point: Vector, r: float, seg: int = 14) -> None:
    """Vana: boru üzerinde gövde + üstte dişli kutusu ve beyaz el çarkı."""
    eid = eq["id"]
    body = Builder()
    body.tube(r * 1.25, r * 0.97, 0.30, seg=seg, loc=tuple(point), axis='Y')
    for s in (-1, 1):
        body.tube(r * 1.55, r * 0.97, 0.05, seg=seg,
                  loc=tuple(point + Vector((0, s * 0.175, 0))), axis='Y')
    body.cylinder(r * 0.45, r * 0.55, seg=10, loc=tuple(point + Vector((0, 0, r * 1.45))))
    ob = body.finish(f"__vb_{eid}")
    reg.equipment(ob, eid, "VLV__BODY")
    ob.data.materials.append(mats["PIPE"])

    zt = r * 1.75
    act = Builder()
    act.box((0.24, 0.20, 0.16), tuple(point + Vector((0, 0, zt + 0.08))))         # dişli kutusu
    act.cylinder(0.025, 0.22, seg=6, loc=tuple(point + Vector((0, 0, zt + 0.27))))  # mil
    act.tube(0.24, 0.20, 0.035, seg=18, loc=tuple(point + Vector((0, 0, zt + 0.38))))  # el çarkı
    for rz in (0.0, math.pi / 2):
        act.box((0.42, 0.025, 0.025), tuple(point + Vector((0, 0, zt + 0.38))), rot_z=rz)
    ob = act.finish(f"__va_{eid}")
    reg.equipment(ob, eid, "VLV__ACTUATOR")
    ob.data.materials.append(mats["MACHINE"])


# --------------------------------------------------------------------------- #
# Kolektör + ana hat
# --------------------------------------------------------------------------- #

def header(reg, mats, eq: dict, xs: list[float], y: float, z: float,
           run_length: float, seg: int = 16) -> float:
    """Kolektör: pompaları toplayan enine hat + ortasından uzağa giden ana hat.

    Dönen: ana hattın x konumu.
    """
    eid = eq["id"]
    r = radius(eq["params"]["dn"])
    x0, x1 = min(xs) - 0.45, max(xs) + 0.45
    if x1 - x0 < 2.0:                                   # tek pompalı kolektör
        x0, x1 = (x0 + x1) / 2.0 - 1.0, (x0 + x1) / 2.0 + 1.0
    xm = sum(xs) / len(xs)

    b = Builder()
    b.cylinder(r, x1 - x0, seg=seg, loc=((x0 + x1) / 2.0, y, z), axis='X')
    for xe in (x0, x1):                                 # kör flanşlı uçlar
        b.cylinder(r * 1.12, 0.10, seg=seg, loc=(xe, y, z), axis='X')
    for x in xs:                                        # branş bağlantı yakaları
        b.tube(r * 0.85, r * 0.5, r * 1.6, seg=seg, loc=(x, y - r * 0.55, z), axis='Y')
    # Ana hat: kolektörün ortasından +Y yönünde
    y_end = y + run_length
    b.cylinder(r, run_length, seg=seg, loc=(xm, y + run_length / 2.0, z), axis='Y')
    b.tube(r * 1.2, r * 0.98, r * 1.4, seg=seg, loc=(xm, y + r * 0.9, z), axis='Y')  # T yakası
    b.cylinder(r * 1.15, 0.10, seg=seg, loc=(xm, y_end, z), axis='Y')               # kör flanş
    # Debimetre: iki flanş arasında gövde + üstte transmitter
    y_fm = y + run_length * 0.72
    flange_pair(b, Vector((xm, y_fm - 0.45, z)), 'Y', r, seg)
    flange_pair(b, Vector((xm, y_fm + 0.45, z)), 'Y', r, seg)
    b.cylinder(r * 1.08, 0.80, seg=seg, loc=(xm, y_fm, z), axis='Y')
    b.cylinder(0.05, r * 0.7, seg=8, loc=(xm, y_fm, z + r + r * 0.35))
    b.box((0.26, 0.20, 0.22), (xm, y_fm, z + r * 1.7 + 0.11))
    ob = b.finish(f"__hdr_{eid}")
    reg.equipment(ob, eid, "HDR__PIPE")
    ob.data.materials.append(mats["PIPE"])
    _flow_extras(ob, r, (0.0, 1.0, 0.0), join_x=xm)
    return xm
