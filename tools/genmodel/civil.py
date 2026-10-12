"""Beton yapı: giriş kanalı + ön havuz, emme hücreleri, başlık duvarı, köprü, kaideler.

Hepsi tek bir mesh'e (STATIC__CIVIL) toplanır — Pi 4'te draw call bütçesi
bunu zorunlu kılıyor. Çelik/makine elemanları ayrı malzeme olduğu için ayrı
mesh'e gider.

Plan (memba → mansap, +Y akış yönü):

    giriş kanalı ─ köprü ─ genişleme ─ ön havuz ─ hücre sırası ─ başlık duvarı │ pompalar
       (dar, şevli)                                (dikey duvarlı)       y = 0

Kanal kesiti `channel.plan` listesindeki istasyonlardan örülür: her biri
[y, taban_genişliği, üst_genişlik]. Dış duvar yüzleri DİKEY — iç yüzler şevli,
duvar dipte kalınlaşır (referans görseldeki dolu beton kesit).
"""
from __future__ import annotations

from mathutils import Vector

from prim import Builder


def _section(y: float, wb: float, wt: float, invert: float, deck: float,
             wall_t: float, base_t: float) -> list[Vector]:
    """Kanalın bir kesiti — kapalı halka: iç yüzey gidiş, dış yüzey dönüş.

    İç yüzey trapez (şevli), dış yüzey dikey. Halka sırası eski üreticiyle
    aynı tutuldu: yüz yönleri (normaller) buna bağlı.
    """
    hb, ht = wb / 2.0, wt / 2.0
    xo = ht + wall_t
    return [
        Vector((-ht, y, deck)),                 # 0  iç üst sol
        Vector((-hb, y, invert)),               # 1  iç topuk sol
        Vector((hb, y, invert)),                # 2  iç topuk sağ
        Vector((ht, y, deck)),                  # 3  iç üst sağ
        Vector((xo, y, deck)),                  # 4  dış üst sağ
        Vector((xo, y, invert - base_t)),       # 5  dış alt sağ
        Vector((-xo, y, invert - base_t)),      # 6  dış alt sol
        Vector((-xo, y, deck)),                 # 7  dış üst sol
    ]


def plan_at(c: dict, y: float) -> tuple[float, float]:
    """Verilen y'de (taban, üst) iç genişlik — plan istasyonları arasında doğrusal."""
    pts = c["plan"]
    if y <= pts[0][0]:
        return pts[0][1], pts[0][2]
    for (y0, b0, t0), (y1, b1, t1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            f = (y - y0) / (y1 - y0) if y1 > y0 else 0.0
            return b0 + (b1 - b0) * f, t0 + (t1 - t0) * f
    return pts[-1][1], pts[-1][2]


def channel(g: dict, b: Builder) -> None:
    c = g["channel"]
    secs = [_section(y, wb, wt, c["invert_el"], c["deck_el"], c["wall_t"], c["base_t"])
            for y, wb, wt in c["plan"]]
    b.loft(secs, closed=True, cap=True)


# --------------------------------------------------------------------------- #
# Emme hücreleri
# --------------------------------------------------------------------------- #

def cell_grid(g: dict) -> dict:
    """Hücre sırasının plan geometrisi. Tek kaynak — beton, borular ve su bunu kullanır."""
    cl = g["cells"]
    n, w, pier = cl["count"], cl["width"], cl["pier"]
    total_w = n * w + (n - 1) * pier
    centers = [-total_w / 2.0 + w / 2.0 + i * (w + pier) for i in range(n)]
    piers = [-total_w / 2.0 + (i + 1) * w + i * pier + pier / 2.0 for i in range(n - 1)]
    return {"n": n, "w": w, "pier": pier, "total_w": total_w, "depth": cl["depth"],
            "front": cl["front_beam"], "slab_t": cl["slab_t"], "end_wall": cl["end_wall"],
            "centers": centers, "piers": piers}


def check_plan(g: dict, cg: dict) -> None:
    """Kanal planının son istasyonu hücre sırasıyla aynı genişlikte ve dikey olmalı."""
    y, wb, wt = g["channel"]["plan"][-1]
    if abs(y) > 1e-6 or abs(wb - cg["total_w"]) > 0.01 or abs(wt - cg["total_w"]) > 0.01:
        raise ValueError(
            f"channel.plan son istasyonu [0, {cg['total_w']:.2f}, {cg['total_w']:.2f}] olmalı "
            f"(hücre sırası genişliği), bulunan [{y}, {wb}, {wt}]")
    zone = cg["depth"] + cg["front"] + cg["pier"]
    y_prev, wb_prev, wt_prev = g["channel"]["plan"][-2]
    if y_prev > -zone or abs(wb_prev - wt_prev) > 0.01:
        raise ValueError(f"hücre bölgesi (y > {-zone:.2f}) dikey duvarlı olmalı: "
                         f"channel.plan sondan ikinci istasyonu y ≤ {-zone:.2f} ve taban = üst")


def cells(g: dict, b: Builder, cg: dict, seg: int = 12) -> None:
    """Hücre sırası: üstte açıklıklı döşeme, aralarda yuvarlak burunlu perdeler.

    Hücreler ön havuza döşemenin ALTINDAN açılır; su perde burunlarının
    arasından hücreye girer. Referans görseldeki kare açıklıklar ve suya inen
    yarım silindir burunlar budur.
    """
    c = g["channel"]
    inv, deck = c["invert_el"], c["deck_el"]
    h = deck - inv
    span = cg["depth"] + cg["front"]

    # Ön kiriş — açıklıkların memba kenarı
    b.box((cg["total_w"], cg["front"], cg["slab_t"]),
          (0.0, -span + cg["front"] / 2.0, deck - cg["slab_t"] / 2.0))
    # Perdeler: döşemenin altından tabana kadar, ucunda yarım silindir burun
    for x in cg["piers"]:
        b.box((cg["pier"], span, h), (x, -span / 2.0, inv + h / 2.0))
        b.cylinder(cg["pier"] / 2.0, h, seg=seg, loc=(x, -span, inv + h / 2.0))
    # Başlık duvarı — hücrelerin mansap duvarı, pompa tarafı. 2 mm memba
    # tarafına taşar: kanalın y = 0'daki uç kapağıyla aynı düzlemde kalmasın.
    t = cg["end_wall"]
    wall_t, base_t = c["wall_t"], c["base_t"]
    b.box((cg["total_w"] + 2 * wall_t, t + 0.004, h + base_t),
          (0.0, t / 2.0, inv - base_t + (h + base_t) / 2.0))


def bridge(g: dict, b: Builder) -> dict:
    """Giriş kanalını kesen köprü — kapak ve ızgara panelleri bunun memba yüzüne asılı."""
    c, br = g["channel"], g["bridge"]
    _, wt = plan_at(c, br["y"])
    span = wt + 2 * c["wall_t"] + 2 * br.get("overhang", 0.3)
    z = c["deck_el"] + br["thickness"] / 2.0
    b.box((span, br["width"], br["thickness"]), (0.0, br["y"], z))
    return {"y": br["y"], "width": br["width"], "top": c["deck_el"] + br["thickness"],
            "inner_w": wt}


def gate_wall(g: dict, b: Builder, y_face: float,
              opening: tuple[float, float, float] | None) -> None:
    """Köprünün altında kanalı kapatan beton perde (`bridge.gate_wall_t` kalınlığında).

    Su yalnız `opening` = (x_sol, x_sağ, üst_kot) açıklığından geçer; açıklık tabandan başlar
    (None: dolu perde). Kapak ve ızgara panelleri için açıklık döşemeye kadardır: perde yalnız
    panellerin iki yanını, şevli duvara kadar kapatır. Memba yüzü `y_face`, panellerin hemen arkası.

    Kesit açıklığın kenarlarından ızgaraya bölünür (altta iki yan parça; açıklık döşemeden
    alçaksa üstte üç parça): ışık köşe başına pişirildiği için komşu parçaların ortak kenarında
    köşeler çakışmalı, yoksa düz yüzde renk dikişi çıkar.
    """
    c = g["channel"]
    t = g["bridge"]["gate_wall_t"]
    inv, deck = c["invert_el"], c["deck_el"]
    wb, wt = plan_at(c, y_face + t / 2.0)
    hb, ht = wb / 2.0, wt / 2.0

    def half(z: float) -> float:
        """O kotta kanalın iç yarı genişliği (şevli duvar)."""
        return hb + (ht - hb) * (z - inv) / (deck - inv)

    def solid(profile: list[tuple[float, float]]) -> None:
        """(x, z) profilini perde kalınlığınca uzatır. Profil saat yönünde (x sağa, z yukarı):
        loft'un yüz yönleri buna bağlı. Çakışan ardışık köşeler atılır (üçgene inen parça)."""
        pts = [p for i, p in enumerate(profile) if p != profile[i - 1]]
        if len(pts) >= 3:
            b.loft([[Vector((x, y, z)) for x, z in pts] for y in (y_face, y_face + t)])

    if opening is None:
        solid([(-hb, inv), (-ht, deck), (ht, deck), (hb, inv)])
        return
    x0, x1, top = opening
    if not (-half(top) < x0 < x1 < half(top) and inv < top <= deck):
        raise ValueError(f"açıklık x {x0:.2f}…{x1:.2f}, üst kot {top:.2f} kanal kesitine sığmıyor "
                         f"(o kotta iç genişlik ±{half(top):.2f}, üst kot {deck:.2f})")

    if top < deck:
        # Açıklığın üstü: şevden şeve tam kuşak
        solid([(-half(top), top), (-ht, deck), (x0, deck), (x0, top)])
        solid([(x0, top), (x0, deck), (x1, deck), (x1, top)])
        solid([(x1, top), (x1, deck), (ht, deck), (half(top), top)])
    # Açıklığın yanları: şev ile açıklık kenarı arası. Paneller tabanda kanaldan genişse (kenar
    # şevin içinde kalır) parça, şevin o kenarı kestiği kottan başlar.
    for side, xv in ((-1, x0), (1, x1)):
        inside = side * xv <= hb                         # kenar tabanda kanalın içinde mi
        z0 = inv if inside else inv + (side * xv - hb) * (deck - inv) / (ht - hb)
        prof = [(side * hb if inside else xv, z0), (side * half(top), top), (xv, top), (xv, z0)]
        solid(prof if side < 0 else prof[::-1])


def pump_pads(b: Builder, pads: list[tuple[tuple[float, float, float], tuple[float, float, float]]]) -> None:
    """Pompa kaideleri — (boyut, merkez) listesi pompa üreticisinden gelir."""
    for size, loc in pads:
        b.box(size, loc)
