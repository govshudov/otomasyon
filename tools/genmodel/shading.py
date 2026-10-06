"""Işığı vertex color'a pişirme.

Raspberry Pi 4'te gerçek zamanlı ışık/gölge yok, doku da yok. Aydınlatmanın
tamamı burada köşe renklerine yazılır; three.js tarafında MeshBasicMaterial
`vertexColors` ile çarpar. Sonuç: sıfır doku belleği, sıfır ışık hesabı,
render kalitesinde bir görüntü.

Cycles yerine kendi BVH ışın izleyicimiz kullanılıyor. Gerekçe: sonuç
deterministik (aynı girdi → aynı çıktı, üretim hattı için şart), render
motoruna bağımlılık yok, ve saniyede ~2,7 milyon ışın zaten fazlasıyla hızlı.
"""
from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# Ana ışık yönü — referans görseldeki gibi yükseğe yakın, hafif memba-sağdan.
# Üst yüzler parlak (~RGB 195), dikey yüzler belirgin koyu (~RGB 120-140).
KEY_DIR = Vector((0.30, -0.45, 0.84)).normalized()

AO_FLOOR = 0.30       # hiçbir yüzey bundan koyu olmasın; HMI'da okunabilirlik şart
AO_DISTANCE = 5.0     # bu mesafenin ötesindeki geometri kapatmaz (yerel AO)


def _hemisphere(k: int, seed: int = 4) -> list[Vector]:
    """Kosinüs ağırlıklı yarıküre örnekleri (teğet uzayda, +Z normal)."""
    rng = random.Random(seed)
    out = []
    for i in range(k):
        u = (i + rng.random()) / k                 # tabakalı örnekleme
        v = rng.random()
        r, th = math.sqrt(u), math.tau * v
        out.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u)))))
    return out


def _scene_bvh(objs) -> BVHTree:
    dg = bpy.context.evaluated_depsgraph_get()
    verts, tris, off = [], [], 0
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        verts.extend(mw @ v.co for v in me.vertices)
        me.calc_loop_triangles()
        tris.extend(tuple(i + off for i in lt.vertices) for lt in me.loop_triangles)
        off = len(verts)
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris)


def split_sharp(objs, angle_deg: float = 35.0) -> int:
    """Keskin kenarlarda köşeleri ayırır; döndürür: ayrılan kenar sayısı.

    Işık KÖŞE başına pişiriliyor. Bir kutunun köşesi üç yüz tarafından
    paylaşılırsa normali üçünün ortalaması olur ve renk yüzler arasında
    kayar — beton duvarlar yuvarlak, lekeli görünür. 35°'den keskin
    kenarlarda köşeleri ayırınca her düz yüz kendi rengini alır; boru gibi
    yuvarlak yüzeyler (halka adımı ~26°) yumuşak kalır.
    """
    thr = math.radians(angle_deg)
    total = 0
    for ob in objs:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        sharp = [e for e in bm.edges
                 if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr]
        if sharp:
            bmesh.ops.split_edges(bm, edges=sharp)
            bm.to_mesh(ob.data)
            ob.data.update()
            total += len(sharp)
        bm.free()
    return total


def bake(rays: int = 40, strength: float = 0.85, seed: int = 4) -> dict:
    """Tüm mesh nesnelerine `AO` köşe rengi katmanı yazar."""
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not objs:
        return {"objects": 0, "vertices": 0, "rays": 0}
    split_sharp(objs)

    bvh = _scene_bvh(objs)
    dirs = _hemisphere(rays, seed)
    total_v = 0

    for ob in objs:
        me = ob.data
        for ca in list(me.color_attributes):
            me.color_attributes.remove(ca)
        col = me.color_attributes.new(name="AO", type='BYTE_COLOR', domain='POINT')
        # Aktif VE render katmanı olarak işaretle. Aksi halde dışa aktarıcı
        # ikinci bir varsayılan katman da yazar (COLOR_0 beyaz, COLOR_1 gerçek AO)
        # ve three.js yanlış olanı okur.
        idx = list(me.color_attributes).index(col)
        me.color_attributes.active_color_index = idx
        me.color_attributes.render_color_index = idx

        mw = ob.matrix_world
        nm = mw.to_3x3().inverted_safe().transposed()
        transparent = any(m and m.name == "WATER" for m in me.materials)
        # Ton: ayrı malzeme (= ayrı draw call) açmadan renk vermek için köşe
        # rengi taban rengiyle birlikte bir çarpan da taşır. Toprak ve cephe
        # CONCRETE malzemesinde kalır, rengi buradan gelir. Üst yüzler
        # (n.z > 0.5) ayrı tonlanabilir — toprağın üstü açık, kesiti koyu.
        tint = [float(c) for c in ob["bake_tint"]] if "bake_tint" in ob else None
        tint_top = [float(c) for c in ob["bake_tint_top"]] if "bake_tint_top" in ob else tint
        # Büyük düz yüzlerde (toprak bloğu) köşe başına AO metrelerce süren
        # lekeli geçiş üretir; orada yalnız yönlü ışık kullanılır.
        no_ao = bool(ob.get("bake_no_ao", False))

        for i, v in enumerate(me.vertices):
            p = mw @ v.co
            n = (nm @ v.normal)
            n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))

            # Teğet uzay
            a = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
            t1 = n.cross(a).normalized()
            t2 = n.cross(t1)

            hits = 0
            origin = p + n * 2e-3
            for d in ([] if no_ao else dirs):
                w = t1 * d.x + t2 * d.y + n * d.z
                if bvh.ray_cast(origin, w, AO_DISTANCE)[0] is not None:
                    hits += 1
            ao = 1.0 - strength * (hits / len(dirs))
            ao = AO_FLOOR + (1.0 - AO_FLOOR) * max(0.0, ao)

            # Pişirilmiş yönlü ışık: gökyüzü katkısı + ana ışık. Gökyüzü terimi
            # karesiyle: dikey yüzler ondan az pay alsın, üst/yan kontrastı
            # referanstaki kadar güçlü olsun.
            sky = (0.5 + 0.5 * n.z) ** 2               # [0, 1]
            lambert = max(0.0, n.dot(KEY_DIR))         # [0, 1]
            shade = 0.06 + 0.30 * sky + 0.64 * lambert # [0.06, 1.0]

            # COLOR_0 doğrusal uzayda saklanır ve malzemenin taban rengiyle
            # ÇARPILIR. Aydınlık üst yüz ~0.64, dikey yüz ~0.25-0.32, kapanmış
            # yüz ~0.07. Beton (0.86) için ekranda ~196 / 128-143 / 60.
            val = 0.03 + 0.68 * (ao * shade)
            if transparent:
                val = max(val, 0.42)                   # su yüzeyi kararmasın
            val = max(0.05, min(0.95, val))

            t = tint_top if (tint and n.z > 0.5) else tint
            if t:
                col.data[i].color = (min(1.0, val * t[0]), min(1.0, val * t[1]),
                                     min(1.0, val * t[2]), 1.0)
            else:
                col.data[i].color = (val, val, val, 1.0)
            total_v += 1

    return {"objects": len(objs), "vertices": total_v, "rays": total_v * len(dirs)}
