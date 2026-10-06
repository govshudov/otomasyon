"""Üretilen modelin PNG önizlemesi.

Geometriyi görmeden yazmak körlüktür. Bu modül referans render'lardaki
3/4 izometrik açıyı taklit eden bir kamera kurar ve EEVEE ile hızlı bir
kontrol görüntüsü alır. Üretim çıktısı değildir, gözle doğrulama aracıdır.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector


def _scene_bounds() -> tuple[Vector, Vector]:
    """Tesisin sınır kutusu — kamera buna göre çerçevelenir."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def use_baked_materials() -> None:
    """Malzemeleri düz emisyona çevirir: taban_rengi × pişirilmiş_köşe_rengi.

    three.js'te MeshBasicMaterial({vertexColors:true, color: taban}) ile birebir
    aynı sonuç. Yani bu önizleme Pi'de görünecek şeyin ta kendisidir — EEVEE'nin
    kendi ışığı devre dışı. Pişirmenin kalitesi ancak böyle doğrulanabilir.
    """
    for m in bpy.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        base = tuple(m.diffuse_color)
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emit = nt.nodes.new("ShaderNodeEmission")
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs["Factor"].default_value = 1.0
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "AO"
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = (base[0], base[1], base[2], 1.0)
        nt.links.new(rgb.outputs[0], mix.inputs[6])
        nt.links.new(col.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], emit.inputs["Color"])
        emit.inputs["Strength"].default_value = 1.0
        nt.links.new(emit.outputs[0], out.inputs["Surface"])
        if m.name == "WATER":
            m.diffuse_color = m.diffuse_color


def render(path: str, resolution=(1600, 900), azimuth_deg: float = -37.0,
           elevation_deg: float = 36.0, zoom: float = 1.08,
           baked: bool = True) -> None:
    sc = bpy.context.scene
    lo, hi = _scene_bounds()
    center = (lo + hi) / 2.0
    radius = max((hi - lo).length / 2.0, 1.0)

    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    d = radius * 2.6 * zoom
    eye = center + Vector((math.cos(az) * math.cos(el),
                           math.sin(az) * math.cos(el),
                           math.sin(el))) * d

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 52
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = eye
    direction = (center - eye)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam

    if baked:
        use_baked_materials()

    sun_data = bpy.data.lights.new("Sun", type='SUN')
    if baked:
        sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 0.0 if baked else 3.0
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("Sun", sun_data)
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), math.radians(12), math.radians(-125))

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        # #464D57 — arayüzdeki düz arka planın doğrusal karşılığı
        bg.inputs[0].default_value = (0.0612, 0.0742, 0.0953, 1.0)
        bg.inputs[1].default_value = 1.0
    sc.world = world

    # three.js çıktısıyla aynı renk dönüşümü: düz sRGB. Blender'ın varsayılanı
    # (AgX) tonları sıkıştırır ve önizleme ekrandakinden soluk görünür.
    try:
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    except (TypeError, AttributeError):
        pass

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = resolution
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path
    if hasattr(sc, "eevee"):
        for attr, val in (("taa_render_samples", 24), ("use_gtao", True),
                          ("use_shadows", True)):
            if hasattr(sc.eevee, attr):
                setattr(sc.eevee, attr, val)
    bpy.ops.render.render(write_still=True)
