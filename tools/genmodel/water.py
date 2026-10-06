"""Su yüzeyi.

Seviye animasyonu frontend'de yapılır: yüzey yukarı/aşağı taşınır ve
kanalın şevli duvarları yüzünden genişliği de seviyeye göre değişir.
Bu yüzden `twin-map.json` içine kanalın plan istasyonları da yazılır;
frontend her seviye değişiminde köşeleri doğru genişlikte yeniden kurar.
"""
from __future__ import annotations

from mathutils import Vector

import prim


def half_width(c: dict, wb: float, wt: float, level: float) -> float:
    """Bir plan istasyonunda, verilen su seviyesinde yarı genişlik."""
    depth = c["deck_el"] - c["invert_el"]
    t = max(0.0, min(1.0, (level - c["invert_el"]) / depth))
    return (wb + (wt - wb) * t) / 2.0


def surface_params(c: dict) -> dict:
    """Frontend'in su yüzeyini kendi hesaplayabilmesi için kesit tanımı."""
    return {
        "plan": [[round(y, 4), round(wb, 4), round(wt, 4)] for y, wb, wt in c["plan"]],
        "invert_el": c["invert_el"], "deck_el": c["deck_el"],
        "y_from": c["plan"][0][0], "y_to": c["plan"][-1][0],
        "note": "plan = [y, taban_genişliği, üst_genişlik]; her istasyonda "
                "yarı_genişlik = (taban + (üst-taban)*t) / 2, t = (seviye-invert)/(deck-invert); "
                "istasyonlar arası doğrusal",
    }


def build(reg, mats, eq: dict, c: dict, level: float):
    """Nominal seviyede su yüzeyi şeridi. Frontend bunu seviyeye göre günceller."""
    secs = []
    for y, wb, wt in c["plan"]:
        hw = half_width(c, wb, wt, level)
        secs.append([Vector((-hw, y, level)), Vector((hw, y, level))])
    ob = prim.loft("__water", secs, closed=False, cap=False)
    reg.equipment(ob, eq["id"])
    ob.data.materials.append(mats["WATER"])
    ob["water_surface"] = True
    ob["nominal_level"] = level
    return ob
