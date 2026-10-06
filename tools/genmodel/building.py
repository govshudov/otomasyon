"""Pompa binası ve zemin (toprak) bloğu.

Ölçüler PS-21 TX çiziminden (1-25-4-Здание насосной станции_TX.dwg):

    ±0.00 (zemin)            203,90        → deck_el
    makine dairesi tabanı    200,10        → pump_area.ground_el   (3,8 m gömülü)
    pompa kaidesi            200,70        → +0,6 m (pump_area.pad_h)
    saçak / mahya            +7,83 / +8,78 → building.eave_h / ridge_h
    aks aralığı              6,0 m         → building.bay

Bina iki kısımdır:

  * Bodrum (STATIC__BLD-BASE) — taban döşemesi + zemine kadar perde duvarlar.
    Toprağın içinde durur, hep görünür.
  * Üst yapı — dört duvar (STATIC__BLD-WALL-N/S/E/W) ve çatı (STATIC__BLD-ROOF).
    Her duvar dış normalini `face_n` extras'ında taşır; arayüz kameraya bakan
    duvarları ve çatıyı gizler (kesit görünüm), içerideki pompalar görünür kalır.
    Pencere/kapılar duvarla birlikte gizlensin diye aynı önekle adlanır
    (STATIC__BLD-WALL-S__WIN).

Toprak (STATIC__SOIL) yapıların altını ve çevresini dolduran tek blok —
kanal duvarlarının dış yüzüne ve bina bodrumuna oturur, kenarları kesit gibi
açıkta. Ek malzeme açılmaz: beton malzemesinde kalır, rengi köşe tonundan
(`bake_tint`) gelir; draw call sayısı değişmez.
"""
from __future__ import annotations

import bmesh
from mathutils import Vector

from prim import Builder

CONCRETE_BASE = (0.86, 0.87, 0.89)     # materials.PALETTE["CONCRETE"] — ton bunun çarpanı


def _tint(srgb: tuple[int, int, int]) -> list[float]:
    """İstenen yüzey rengini (sRGB 0-255) beton taban rengine göre köşe çarpanına çevirir."""
    def lin(c: float) -> float:
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return [round(min(1.0, lin(c) / b), 4) for c, b in zip(srgb, CONCRETE_BASE)]


SOIL_TOP = _tint((206, 184, 140))      # kuru, açık toprak (Ahal)
SOIL_SIDE = _tint((176, 128, 86))      # kesit yüzü — koyu kahve
FACADE = _tint((236, 226, 204))        # sıvalı cephe — kırık beyaz


def _finish(b: Builder, name: str):
    """Kapalı parçaların yüz yönlerini dışa çevirip nesneyi üretir.

    Loft sarım yönü kesit sırasına bağlı; elle tutturmak yerine bmesh'e
    hesaplatıyoruz (arazi katmanındaki ters normal hatası bir daha olmasın).
    """
    bmesh.ops.recalc_face_normals(b.bm, faces=list(b.bm.faces))
    return b.finish(name)


def plan(cfg: dict, pa: dict, deck_el: float, pads: list, header_y: float) -> dict:
    """Bina plan ve kotları. Genişlik pompa kaidelerinden, derinlik kolektörden türetilir."""
    lo = min(loc[0] - size[0] / 2.0 for size, loc in pads)
    hi = max(loc[0] + size[0] / 2.0 for size, loc in pads)
    t = cfg.get("wall_t", 0.4)
    xi = max(abs(lo), abs(hi)) + cfg.get("margin_x", 1.8)      # simetrik iç yarı genişlik
    y0 = cfg["y0"]
    yi1 = header_y + cfg.get("front_gap", 2.6)
    return {"t": t, "xi": xi, "xo": xi + t, "y0": y0, "yi0": y0 + t, "yi1": yi1, "y1": yi1 + t,
            "floor": pa["ground_el"], "slab": cfg.get("slab_t", 0.5), "ground": deck_el,
            "eave": deck_el + cfg["eave_h"], "ridge": deck_el + cfg["ridge_h"],
            "bay": cfg.get("bay", 6.0), "fm_offset": cfg.get("front_gap", 2.6) * 0.6}


def build(reg, mats, p: dict) -> None:
    t, xi, xo = p["t"], p["xi"], p["xo"]
    y0, yi0, yi1, y1 = p["y0"], p["yi0"], p["yi1"], p["y1"]
    fl, gr, ev, rd = p["floor"], p["ground"], p["eave"], p["ridge"]
    zb = fl - p["slab"]
    ym = (y0 + y1) / 2.0

    # ---------------- Bodrum: döşeme + perde duvarlar ---------------- #
    b = Builder()
    b.box((2 * xo, y1 - y0, p["slab"]), (0.0, ym, zb + p["slab"] / 2.0))
    h = gr - fl
    for yc in ((y0 + yi0) / 2.0, (yi1 + y1) / 2.0):
        b.box((2 * xo, t, h), (0.0, yc, fl + h / 2.0))
    for sx in (-1, 1):
        b.box((t, yi1 - yi0, h), (sx * (xi + t / 2.0), ym, fl + h / 2.0))
    ob = _finish(b, "__bld_base")
    reg.structural(ob, "BLD-BASE")
    ob.data.materials.append(mats["CONCRETE"])

    # ---------------- Üst yapı ---------------- #
    hw = ev - gr
    n_bay = max(2, round(2 * xi / p["bay"]))
    bay = 2 * xi / n_bay
    xs_col = [-xi + i * bay for i in range(n_bay + 1)]

    def wall(part: str, normal: tuple[float, float, float], body: Builder, win: Builder | None):
        ob = _finish(body, f"__bld_{part}")
        reg.structural(ob, f"BLD-WALL-{part}")
        ob.data.materials.append(mats["CONCRETE"])
        ob["bake_tint"] = FACADE
        ob["face_n"] = list(normal)
        if win is not None:
            w = _finish(win, f"__bld_{part}_win")
            reg.structural(w, f"BLD-WALL-{part}__WIN")
            w.data.materials.append(mats["DARK"])
            w["face_n"] = list(normal)

    # Uzun duvarlar (S: havuz tarafı, N: ana hat tarafı) — iç yüzde ayaklar,
    # her aks aralığında üst bant penceresi (çizimdeki gibi yüksekte).
    win_w, win_h, sill = min(2.6, bay * 0.55), 1.5, gr + hw * 0.52
    for part, yc, sy in (("S", (y0 + yi0) / 2.0, -1), ("N", (yi1 + y1) / 2.0, 1)):
        body = Builder()
        body.box((2 * xi, t, hw), (0.0, yc, gr + hw / 2.0))
        for xc in xs_col:
            body.box((0.45, 0.35, hw), (xc, yc - sy * (t / 2.0 + 0.175), gr + hw / 2.0))
        win = Builder()
        for i in range(n_bay):
            xc = -xi + (i + 0.5) * bay
            win.box((win_w, t + 0.06, win_h), (xc, yc, sill + win_h / 2.0))
        wall(part, (0.0, float(sy), 0.0), body, win)

    # Alın duvarları (beşgen) — mahya X ekseni boyunca, uzun duvarların uçlarını kapatır.
    prof = [(y0, gr), (y1, gr), (y1, ev), (ym, rd), (y0, ev)]
    for part, sx in (("W", -1), ("E", 1)):
        xa, xb = sx * xi, sx * xo
        body = Builder()
        body.loft([[Vector((xa, yy, zz)) for yy, zz in prof],
                   [Vector((xb, yy, zz)) for yy, zz in prof]])
        win = Builder()
        xc = sx * (xi + t / 2.0)
        if sx > 0:
            # Montaj kapısı — çizimdeki "Монтажная площадка" tarafı
            win.box((t + 0.06, 4.0, 4.6), (xc, ym, gr + 2.3))
        else:
            win.box((t + 0.06, 3.0, 1.4), (xc, ym, sill + 0.7))
        wall(part, (float(sx), 0.0, 0.0), body, win)

    # Çatı: iki eğimli plak, saçak taşmalı, tek prizma
    ov, th = 0.6, 0.25
    s = (rd - ev) / (ym - y0)
    ze = ev - s * ov
    roof = [(y0 - ov, ze), (ym, rd), (y1 + ov, ze), (y1 + ov, ze + th), (ym, rd + th), (y0 - ov, ze + th)]
    b = Builder()
    b.loft([[Vector((-xo - ov, yy, zz)) for yy, zz in roof],
            [Vector((xo + ov, yy, zz)) for yy, zz in roof]])
    ob = _finish(b, "__bld_roof")
    reg.structural(ob, "BLD-ROOF")
    ob.data.materials.append(mats["STEEL"])
    ob["face_n"] = [0.0, 0.0, 1.0]


def meter_pits(reg, mats, cfg: dict, xs: list[float], cy: float, deck: float,
               z_pipe: float, r_pipe: float) -> list[dict]:
    """Ana hatlar üzerinde debimetre kuyuları — toprağa gömülü, üstü açık beton oda.

    Ana hat kuyunun memba ve mansap duvarlarından geçer; debimetre (kolektör
    düğümünün parçası) kuyunun ortasında, yukarıdan görünür. Dönen: toprakta
    bırakılacak açıklıklar (dış ölçü + kuyu tabanının alt kotu).
    """
    w, l, t = cfg.get("w", 2.4), cfg.get("l", 3.2), cfg.get("wall_t", 0.3)
    kerb = cfg.get("kerb", 0.15)                      # zemin üstüne taşan bordür
    zf = z_pipe - r_pipe - cfg.get("floor_gap", 0.6)  # kuyu tabanı (iç)
    zb = zf - t
    b = Builder()
    out = []
    for x in xs:
        ow, ol = w + 2 * t, l + 2 * t
        b.box((ow, ol, t), (x, cy, zb + t / 2.0))                          # taban
        h = deck + kerb - zf
        for sy in (-1, 1):                                                 # boru geçen duvarlar
            b.box((ow, t, h), (x, cy + sy * (l + t) / 2.0, zf + h / 2.0))
        for sx in (-1, 1):
            b.box((t, l, h), (x + sx * (w + t) / 2.0, cy, zf + h / 2.0))
        out.append({"x0": x - ow / 2.0, "x1": x + ow / 2.0,
                    "y0": cy - ol / 2.0, "y1": cy + ol / 2.0, "zb": zb})
    ob = _finish(b, "__fm_pit")
    reg.structural(ob, "FM-PIT")
    ob.data.materials.append(mats["CONCRETE"])
    return out


def soil(reg, mats, g: dict, cg: dict, bp: dict | None, cfg: dict,
         pits: list[dict] | None = None) -> dict:
    """Yapıların altını ve çevresini dolduran toprak bloğu. Dönen: blok sınırları.

    `pits`: bina arkasındaki debimetre kuyuları — toprakta üstten açıklık
    bırakılır, kuyunun altı doludur.
    """
    c = g["channel"]
    inv, deck = c["invert_el"], c["deck_el"]
    zu = inv - c["base_t"]                       # yapıların alt yüzü
    zb = zu - cfg.get("depth", 2.5)              # bloğun tabanı
    plan = c["plan"]
    y_a = plan[0][0]
    xo_head = cg["total_w"] / 2.0 + c["wall_t"]  # başlık duvarı dış yarı genişliği
    y_head = cg["end_wall"]
    xo_bld = bp["xo"] if bp else 0.0
    xo_ch = max(wt / 2.0 + c["wall_t"] for _, _, wt in plan)
    X = max(xo_bld, xo_ch) + cfg.get("margin", 5.0)
    y_b = (bp["y1"] if bp else y_head) + cfg.get("margin_end", 3.0)

    b = Builder()
    # Tüm yapıların altı
    b.box((2 * X, y_b - y_a, zu - zb), (0.0, (y_a + y_b) / 2.0, (zb + zu) / 2.0))
    # Kanal ve hücre bölgesinin iki yanı: dış duvar yüzünü izleyen loft
    stations = [(y, wt / 2.0 + c["wall_t"]) for y, _, wt in plan] + [(y_head, xo_head)]
    for sx in (-1, 1):
        secs = [[Vector((sx * xo, y, zu)), Vector((sx * X, y, zu)),
                 Vector((sx * X, y, deck)), Vector((sx * xo, y, deck))] for y, xo in stations]
        b.loft(secs)
    if bp:
        # Bina bölgesi: döşeme altı, başlık duvarı ile bina arası, yanlar, ön
        zf = bp["floor"] - bp["slab"]
        b.box((2 * X, y_b - y_head, zf - zu), (0.0, (y_head + y_b) / 2.0, (zu + zf) / 2.0))
        h = deck - zf
        if bp["y0"] - y_head > 1e-3:
            b.box((2 * X, bp["y0"] - y_head, h), (0.0, (y_head + bp["y0"]) / 2.0, zf + h / 2.0))
        for sx in (-1, 1):
            w = X - bp["xo"]
            b.box((w, bp["y1"] - bp["y0"], h), (sx * (bp["xo"] + w / 2.0), (bp["y0"] + bp["y1"]) / 2.0, zf + h / 2.0))
        if pits:
            # Kuyu bandı (aynı y aralığında) önce/sonra tam genişlik; bandın
            # içinde kuyular arası dolu, kuyuların altı tabanlarına kadar dolu.
            py0, py1 = min(p["y0"] for p in pits), max(p["y1"] for p in pits)
            b.box((2 * X, py0 - bp["y1"], h), (0.0, (bp["y1"] + py0) / 2.0, zf + h / 2.0))
            b.box((2 * X, y_b - py1, h), (0.0, (py1 + y_b) / 2.0, zf + h / 2.0))
            xa = -X
            for p in sorted(pits, key=lambda p: p["x0"]):
                if p["x0"] - xa > 1e-3:
                    b.box((p["x0"] - xa, py1 - py0, h), ((xa + p["x0"]) / 2.0, (py0 + py1) / 2.0, zf + h / 2.0))
                hp = p["zb"] - zf
                if hp > 1e-3:
                    b.box((p["x1"] - p["x0"], py1 - py0, hp),
                          ((p["x0"] + p["x1"]) / 2.0, (py0 + py1) / 2.0, zf + hp / 2.0))
                xa = p["x1"]
            b.box((X - xa, py1 - py0, h), ((xa + X) / 2.0, (py0 + py1) / 2.0, zf + h / 2.0))
        else:
            b.box((2 * X, y_b - bp["y1"], h), (0.0, (bp["y1"] + y_b) / 2.0, zf + h / 2.0))
    else:
        b.box((2 * X, y_b - y_head, deck - zu), (0.0, (y_head + y_b) / 2.0, (zu + deck) / 2.0))

    ob = _finish(b, "__soil")
    reg.structural(ob, "SOIL")
    ob.data.materials.append(mats["CONCRETE"])
    ob["bake_tint"] = SOIL_SIDE
    ob["bake_tint_top"] = SOIL_TOP
    ob["bake_no_ao"] = True
    return {"X": X, "y_a": y_a, "y_b": y_b, "z_bottom": zb}
