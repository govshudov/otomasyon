"""Giriş yapıları: köprüye asılı sürgülü kapak ve ızgara.

Referans görseldeki iki beyaz panel: giriş kanalını kesen köprünün memba
yüzünde yan yana durur; kafes kuleleri köprünün üstüne taşar, kılavuz
dikmeleri suyun içinden tabana iner. Soldaki sürgülü kapak, sağdaki ızgara.
"""
from __future__ import annotations

import math

from mathutils import Vector

from prim import Builder

GAP = 0.18            # iki panel arası boşluk
RACK_W = 2.0          # ızgara panelinin genişliği
TOWER = 1.5           # kafes kulesinin köprü üstündeki yüksekliği (2,3 m fazla yüksek görünüyordu)


def _panel_y(br: dict) -> float:
    return br["y"] - br["width"] / 2.0 - 0.22


def _gate_x(gw: float) -> float:
    return -(gw / 2.0 + GAP / 2.0)


def panel_opening(gate: dict | None, rack: bool, g: dict) -> tuple[float, float, float] | None:
    """Kapak ve ızgara panellerinin durduğu açıklık: (x_sol, x_sağ, üst_kot).

    Beton perde (civil.gate_wall) burayı boş bırakır, yalnız yanları kapatır. Paneller tabandan
    döşemeye kadar durduğu için açıklık da tam yüksekliktedir (üst kot = döşeme).
    """
    xs = []
    if gate:
        gw = gate["params"]["width"]
        xs += [_gate_x(gw) - gw / 2.0, _gate_x(gw) + gw / 2.0]
    if rack:
        xs += [GAP / 2.0, GAP / 2.0 + RACK_W]
    return (min(xs), max(xs), g["channel"]["deck_el"]) if xs else None


def wall_face_y(br: dict) -> float:
    """Beton perdenin memba yüzü: panellerin (kanat kalınlığı 0,12) 1 cm arkası."""
    return _panel_y(br) + 0.07


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


def _drive(b: Builder, x: float, y: float, z: float, side: int) -> None:
    """Elektrikli kaldırma ünitesi (kulenin üstünde): taban plakası, redüktör, yatay motor
    (fan kapağı + klemens kutusu) ve elle açma için el çarkı. Motor `side` yönünde (+1 sağ, -1 sol)
    dışa bakar, el çarkı içe. Ünitenin ekseni x'te — kapağın vida mili buradan iner."""
    b.box((0.70, 0.50, 0.06), (x, y, z + 0.03))                                      # taban plakası
    zc = z + 0.06 + 0.17
    b.box((0.42, 0.40, 0.34), (x, y, zc))                                            # redüktör
    mx = x + side * (0.21 + 0.25)
    b.cylinder(0.15, 0.50, seg=16, loc=(mx, y, zc), axis='X')                        # motor
    b.cylinder(0.16, 0.10, seg=16, loc=(mx + side * 0.30, y, zc), axis='X')          # fan kapağı
    b.box((0.14, 0.12, 0.10), (mx, y, zc + 0.15 + 0.05))                             # klemens kutusu
    wx = x - side * (0.21 + 0.12)
    b.cylinder(0.04, 0.16, seg=10, loc=(x - side * (0.21 + 0.06), y, zc), axis='X')  # el çarkı mili
    b.tube(0.22, 0.18, 0.04, seg=20, loc=(wx, y, zc), axis='X')                      # el çarkı
    b.box((0.03, 0.38, 0.03), (wx, y, zc))                                           # çark kolları
    b.box((0.03, 0.03, 0.38), (wx, y, zc))


def slide_gate(reg, mats, eq: dict, g: dict, br: dict) -> None:
    """Sürgülü kapak: kanat + kafes çerçeve + kaldırma mekanizması.

    Kanat ayrı düğümdür — pozisyon sinyali onu düşey olarak hareket ettirir.
    """
    c = g["channel"]
    p = eq["params"]
    gw, gh = p["width"], p["height"]
    x = _gate_x(gw)
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
    _drive(ho, x, y, top, side=-1)                                  # motor dışa (sola)
    ho.cylinder(0.04, top + 0.06 - (z0 + gh), seg=8,               # vida mili: kanattan redüktöre
                loc=(x, y, (top + 0.06 + z0 + gh) / 2.0))
    ob = ho.finish(f"__hoist_{eid}")
    reg.equipment(ob, eid, "GATE__HOIST")
    ob.data.materials.append(mats["MACHINE"])          # kapağın gövdesiyle tek renk (siyah değil)


def level_sensor(reg, mats, eq: dict, x: float, g: dict, cg: dict) -> None:
    """Emme hücresi seviye datçiği — TEMASSIZ (radar/ultrasonik), suya girmez.

    HAVUZ TARAFINDA, HÜCRENİN İÇİNE BAKAR: hücrenin ön kirişinin (havuz
    tarafındaki kiriş) üstünde zeminle bir yatık taban plakası; oradan
    hücrenin içine (pompa yönüne) kısa bir çıkıntı, ucunda kenarın hemen
    altında aşağı bakan radar gövdesi + horn — hücredeki suyu ölçer.
    Dikme/kol yok (vinç gibi durmasın). Hücrenin köşesinde (x çağırandan);
    emme borusu hücre ekseninde, radar ışını ona değmez.
    Tek düğüm — dokununca datçiğin kendi kartı açılır.
    """
    deck = g["channel"]["deck_el"]
    y_face = -cg["depth"]                         # ön kirişin hücreye bakan yüzü
    y_s = y_face + 0.38                           # radar ekseni: yüzden hücre içine 0,38 m
    b = Builder()
    b.box((0.26, 0.42, 0.03), (x, y_face - 0.17, deck + 0.015))                 # taban plakası (kiriş üstü)
    y_a, y_b = y_face - 0.11, y_s + 0.11                                        # çıkıntı: kiriş üstünden radarın ucuna
    b.box((0.10, y_b - y_a, 0.05), (x, (y_a + y_b) / 2.0, deck + 0.025))        # havuza çıkıntı
    b.cylinder(0.10, 0.24, seg=16, loc=(x, y_s, deck - 0.10))                   # radar gövdesi
    # Horn — aşağı açılır. Kesitler ARTAN kotla: loft kapak/yüz yönü buna bağlı
    # (ters sırada normaller içe döner, three.js yüzleri eler).
    rings = [(0.16, deck - 0.42), (0.09, deck - 0.22)]
    b.loft([[Vector((x + r * math.cos(math.tau * i / 16), y_s + r * math.sin(math.tau * i / 16), z))
             for i in range(16)] for r, z in rings])
    ob = b.finish(f"__lt_{eq['id']}")
    reg.equipment(ob, eq["id"])
    ob.data.materials.append(mats["MACHINE"])
    # Arayüzün ölçüm yazısını koyacağı nokta: radar gövdesinin hemen yanı
    # (Blender koordinatı). Frontend geometriyi bilmeden yazıyı oraya bağlar.
    ob["label_anchor"] = [round(x + 0.18, 3), round(y_s, 3), round(deck - 0.08, 3)]


def trash_rack(reg, mats, eq: dict, g: dict, br: dict, w: float = RACK_W,
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
    _drive(bars, x, y, top, side=1)                       # tarak tahrik ünitesi, motor dışa (sağa)
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
    ob.data.materials.append(mats["MACHINE"])          # ızgarayla tek renk (siyah değil)
    # Eksen ve strok modelin içine gömülüyor; frontend hangi parçanın nasıl
    # hareket ettiğini bilmiyor. Negatif strok: tarak AŞAĞI iner.
    ob["travel_axis"] = "Z"
    ob["travel_range"] = round(-(zp - z0 - 0.45), 3)
