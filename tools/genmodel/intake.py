"""Giriş yapıları: köprüye asılı sürgülü kapak ve ızgara.

Referans görseldeki iki beyaz panel: giriş kanalını kesen köprünün memba
yüzünde yan yana durur; kafes kuleleri köprünün üstüne taşar, kılavuz
dikmeleri suyun içinden tabana iner. Soldaki sürgülü kapak, sağdaki ızgara.
"""
from __future__ import annotations

from prim import Builder

GAP = 0.18            # iki panel arası boşluk
TOWER = 2.3           # kafes kulesinin döşeme üstündeki yüksekliği


def _panel_y(br: dict) -> float:
    return br["y"] - br["width"] / 2.0 - 0.22


def _tower(b: Builder, x: float, y: float, w: float, z0: float, z1: float,
           post: float = 0.12) -> None:
    """Kılavuz dikmeleri + kafes kulesi (yatay kuşaklar ve ara dikmeler)."""
    h = z1 - z0
    for sx in (-1, 1):
        b.box((post, post * 1.6, h), (x + sx * (w / 2.0 + post / 2.0), y, z0 + h / 2.0))
    for zz in (z1 - 0.05, z1 - TOWER * 0.5, z1 - TOWER):
        b.box((w + 2 * post, post, 0.08), (x, y, zz))
    for fx in (-0.25, 0.25):
        b.box((0.05, 0.05, TOWER), (x + fx * w, y, z1 - TOWER / 2.0))


def slide_gate(reg, mats, eq: dict, g: dict, br: dict) -> None:
    """Sürgülü kapak: kanat + kafes çerçeve + kaldırma mekanizması.

    Kanat ayrı düğümdür — pozisyon sinyali onu düşey olarak hareket ettirir.
    """
    c = g["channel"]
    p = eq["params"]
    gw, gh = p["width"], p["height"]
    x = -(gw / 2.0 + GAP / 2.0)
    y = _panel_y(br)
    z0, top = c["invert_el"], br["top"] + TOWER
    eid = eq["id"]

    leaf = Builder()
    leaf.box((gw, 0.12, gh), (x, y, z0 + gh / 2.0))
    for j in range(6):                                    # yatay nervürler
        leaf.box((gw, 0.16, 0.06), (x, y - 0.03, z0 + gh * (0.08 + 0.17 * j)))
    ob = leaf.finish(f"__leaf_{eid}")
    reg.equipment(ob, eid, "GATE__LEAF")
    ob.data.materials.append(mats["MACHINE"])
    ob["travel_axis"] = "Z"
    ob["travel_range"] = gh                # %100 açık = kanat gh kadar yukarı

    fr = Builder()
    _tower(fr, x, y, gw, z0, top)
    ob = fr.finish(f"__frame_{eid}")
    reg.equipment(ob, eid, "GATE__FRAME")
    ob.data.materials.append(mats["MACHINE"])

    ho = Builder()
    ho.box((0.55, 0.42, 0.30), (x, y, top + 0.15))                  # redüktör
    ho.cylinder(0.10, 0.45, seg=10, loc=(x + 0.45, y, top + 0.15), axis='X')   # motor
    ho.cylinder(0.04, top - (z0 + gh), seg=8,                       # vida mili
                loc=(x, y, (top + z0 + gh) / 2.0))
    ob = ho.finish(f"__hoist_{eid}")
    reg.equipment(ob, eid, "GATE__HOIST")
    ob.data.materials.append(mats["DARK"])


def trash_rack(reg, mats, eq: dict, g: dict, br: dict, w: float = 2.0,
               bar_pitch: float = 0.11) -> None:
    """Izgara: düşey çubuklar + kafes çerçeve + düşey hareket eden tarak."""
    c = g["channel"]
    x = w / 2.0 + GAP / 2.0
    y = _panel_y(br)
    z0, deck, top = c["invert_el"], c["deck_el"], br["top"] + TOWER
    h = deck + 0.4 - z0
    eid = eq["id"]

    bars = Builder()
    n = max(4, int(w / bar_pitch))
    for i in range(n):
        bx = x - w / 2.0 + w * (i + 0.5) / n
        bars.box((0.03, 0.10, h), (bx, y, z0 + h / 2.0))
    for j in range(4):                                    # yatay bağlantı lamaları
        bars.box((w, 0.08, 0.06), (x, y, z0 + h * (0.06 + 0.3 * j)))
    _tower(bars, x, y, w, z0, top)
    bars.box((0.6, 0.45, 0.35), (x, y, top + 0.17))       # tarak tahrik ünitesi
    ob = bars.finish(f"__rack_{eid}")
    reg.equipment(ob, eid, "RACK__BARS")
    ob.data.materials.append(mats["MACHINE"])

    # Tarak üstte park eder (%0) ve temizlikte tabana iner (%100).
    cl = Builder()
    zp = deck + 0.25
    cl.box((w + 0.10, 0.22, 0.20), (x, y - 0.18, zp))
    for i in range(0, n, 2):                              # tarak dişleri
        cl.box((0.03, 0.14, 0.24), (x - w / 2.0 + w * (i + 0.5) / n, y - 0.08, zp - 0.18))
    ob = cl.finish(f"__cleaner_{eid}")
    reg.equipment(ob, eid, "RACK__CLEANER")
    ob.data.materials.append(mats["DARK"])
    # Eksen ve strok modelin içine gömülüyor; frontend hangi parçanın nasıl
    # hareket ettiğini bilmiyor. Negatif strok: tarak AŞAĞI iner.
    ob["travel_axis"] = "Z"
    ob["travel_range"] = round(-(zp - z0 - 0.45), 3)
