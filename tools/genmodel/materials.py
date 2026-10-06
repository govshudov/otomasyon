"""Malzeme paleti — toplam 6 adet, sıkı bir sınır.

Pi 4'te her ek malzeme ayrı bir draw call grubu demek. Işık vertex color'a
pişirildiği için malzemeler yalnızca taban rengi taşır; PBR dokusu yok.

Renkler referans görselden ölçüldü (açık gri beton, doygun mavi boru ve
pompa gövdesi, mavimsi beyaz motor). Değerler DOĞRUSAL uzayda: pişirilmiş
köşe rengiyle çarpılıp ekrana toSRGB ile çıkıyor.
"""
from __future__ import annotations

import bpy

PALETTE: dict[str, tuple[float, float, float, float]] = {
    "CONCRETE": (0.86, 0.87, 0.89, 1.0),   # beton — açık gri
    "STEEL":    (0.42, 0.44, 0.47, 1.0),   # çelik şase
    "MACHINE":  (0.88, 0.91, 0.96, 1.0),   # motor, panel, el çarkı — mavimsi beyaz
    "PIPE":     (0.012, 0.075, 0.500, 1.0),  # boru ve pompa gövdesi — doygun mavi
    "DARK":     (0.10, 0.11, 0.13, 1.0),   # kaplin, dikmeler, mekanizma
    "WATER":    (0.36, 0.52, 0.58, 0.55),  # su yüzeyi — yarı saydam
}


def build() -> dict[str, bpy.types.Material]:
    out = {}
    for name, rgba in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = rgba
            if "Roughness" in bsdf.inputs:
                bsdf.inputs["Roughness"].default_value = 0.72
            if "Metallic" in bsdf.inputs:
                bsdf.inputs["Metallic"].default_value = 0.0
            if name == "WATER" and "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = rgba[3]
        m.diffuse_color = rgba
        if name == "WATER":
            m.blend_method = 'BLEND' if hasattr(m, "blend_method") else m.blend_method
        out[name] = m
    return out


def assign(ob: bpy.types.Object, mat: bpy.types.Material) -> None:
    ob.data.materials.clear()
    ob.data.materials.append(mat)
