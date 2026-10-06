"""Dışa aktarım: statik birleştirme, kamera çerçeveleri, glTF ve twin-map.

Kamera çerçeveleri burada hesaplanır. "Arızalı parçaya dokun → yakınlaş" özelliği
her düğümün sınır kutusundan önceden türetilir; frontend çalışma zamanında
geometri taramak zorunda kalmaz.
"""
from __future__ import annotations

import json
from pathlib import Path

import bpy
from mathutils import Vector


def _blender_to_gltf(v: Vector) -> list[float]:
    """Blender Z-up → glTF Y-up. Dışa aktarım `export_yup=True` ile aynı dönüşüm."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def _corners(ob) -> list[Vector]:
    """Nesnenin ve tüm alt ağacının dünya köşe noktaları.

    Ekipman kökleri boş nesnedir (kendi hacmi yok); çerçevesi çocuklarının
    birleşiminden hesaplanır — "tüm pompayı çerçevele" böyle çalışır.
    """
    pts = []
    if ob.type == 'MESH':
        pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    for ch in ob.children:
        pts += _corners(ch)
    return pts


def camera_frames() -> dict:
    """Her düğüm için {target, radius} — glTF koordinatlarında."""
    out = {}
    for ob in bpy.context.scene.objects:
        pts = _corners(ob)
        if not pts:
            continue
        lo = Vector((min(p[i] for p in pts) for i in range(3)))
        hi = Vector((max(p[i] for p in pts) for i in range(3)))
        center = (lo + hi) / 2.0
        out[ob.name] = {"target": _blender_to_gltf(center),
                        "radius": round(max((hi - lo).length / 2.0, 0.25), 3)}
    return out


def stats_by_material() -> dict:
    """Malzeme başına üçgen ve nesne sayısı — draw call tahmini için."""
    agg: dict[str, dict] = {}
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        mat = ob.data.materials[0].name if ob.data.materials else "(yok)"
        a = agg.setdefault(mat, {"objects": 0, "tris": 0})
        a["objects"] += 1
        a["tris"] += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return agg


def write_glb(path: str, draco_level: int = 6, draco: bool = True) -> int:
    """GLB yazar.

    `draco=False`: sıkıştırmasız. JACE'in web sunucusu CSP ile blob: adresinden
    Web Worker oluşturmayı yasaklıyor; three.js'in Draco çözücüsü tam olarak
    bunu yapıyor ve model hiç yüklenmiyor. JACE paketi bu yüzden Draco'suz.
    """
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False,
        export_apply=True, export_yup=True, export_extras=True,
        # 'MATERIAL' (varsayılan) tek renk özniteliğinden İKİ set üretiyor:
        # COLOR_0 boş, COLOR_1 gerçek AO. three.js COLOR_0'ı okuduğu için
        # aydınlatma kayboluyordu. 'ACTIVE' yalnız aktif katmanı yazar.
        export_vertex_color='ACTIVE',
        export_draco_mesh_compression_enable=draco,
        export_draco_mesh_compression_level=draco_level)
    return Path(path).stat().st_size


def write_twin_map(path: str, data: dict) -> int:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, indent=2)
    Path(path).write_text(txt + "\n", encoding="utf-8")
    return len(txt)
