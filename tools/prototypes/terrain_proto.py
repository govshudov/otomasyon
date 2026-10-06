"""ARAZİ TASARIM PROTOTİPİ — üretim hattında DEĞİL.

Onay bekliyor. Kabul edilirse tools/genmodel/ altına terrain.py olarak
taşınacak ve generate.py'den çağrılacak. Şu hali yalnız varyant render'ı
üretir; .glb çıktısına arazi eklemez.

  blender --background --python tools/prototypes/terrain_proto.py -- \
          --variant C --out build/arazi-C.png

Varyantlar: A mevcut · B ufuk gradyanı · C alçak sırt (önerilen) · D belirgin tepeler
"""
from pathlib import Path

import bpy, bmesh
from mathutils import Vector

REPO = Path("/Users/govshudov/Desktop/otomasyon")
GLB = REPO / "web/public/models/ps-01.glb"

# ── Palet ────────────────────────────────────────────────────────────────
# ISA-101 kısıtı: alarm renkleriyle çakışmayacak. Kırmızı, amber, çalışma
# mavisi (0x2f6fd0) ve seçim camgöbeği YASAK. Geriye düşük doygunluklu
# yeşil-gri / kahve-gri kalıyor; tesisten koyu olmalı ki tesis öne çıksın.
BG      = (0.071, 0.082, 0.102)   # 0x12151a — mevcut arka plan, gökyüzü tepesi
HORIZON = (0.105, 0.118, 0.140)   # ufuk — bir tık açık, derinlik hissi verir

# Figür/zemin: tesis (açık gri beton/çelik) en PARLAK şey olmalı. Zemin ondan
# koyu, tepeler daha da koyu, hepsi ufuk rengine erir. Tersi olursa arazi
# tesisi ezer — ilk denemede tam bu oldu.
TERRAIN_LO = (0.078, 0.088, 0.082)  # vadi
TERRAIN_HI = (0.155, 0.170, 0.145)  # sırt üstü — soluk zeytin
APRON      = (0.082, 0.092, 0.090)  # tesis eteği; TERRAIN_LO'ya çok yakın
                                    # ki disk kenarı görünmesin


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_plant() -> tuple[Vector, Vector]:
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def excavation_rect(ground_z: float, pad: float = 1.5):
    """Zemin kotunun ALTINDA kalan geometrinin XY sınırı = kazı ağzı.

    Su alma kanalı araziye kazılmıştır; zemin onu ÇEVRELEMELİ, örtmemeli.
    İlk denemede düz disk kanalı tamamen gömdü ve yapının yarısı kayboldu.
    """
    xs, ys = [], []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name.startswith(('TERR', 'APRON')):
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            w = mw @ v.co
            if w.z < ground_z - 0.05:
                xs.append(w.x); ys.append(w.y)
    if not xs:
        return None
    return (min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)


def height(x: float, y: float) -> float:
    """Katmanlı sinüs — deterministik, rastgelelik yok (tekrar üretilebilir)."""
    return (7.4 * math.sin(x * 0.0130) * math.cos(y * 0.0106)
            + 4.1 * math.sin(x * 0.0305 + 1.7) * math.cos(y * 0.0268 + 0.4)
            + 2.6 * math.sin(x * 0.0620 + 3.1) * math.sin(y * 0.0575 + 2.2)
            + 1.1 * math.sin(x * 0.1080 + 0.9) * math.cos(y * 0.0995 + 1.6))


def lerp3(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def build_terrain(name, cx, cy, ground_z, inner_r, outer_r,
                  amp, radial=72, rings=14, fog_start=0.45):
    """Halka arazi. İç kenar düz (tesis eteği), dışa doğru yükselir."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = []
    for j in range(rings + 1):
        t = j / rings
        r = inner_r + (outer_r - inner_r) * (t ** 1.45)
        row = []
        for i in range(radial):
            a = 2.0 * math.pi * i / radial
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            ramp = 0.0 if t <= 0.0 else min(1.0, (t / 0.55) ** 1.6)
            z = ground_z + height(x, y) * amp * ramp
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for j in range(rings):
        for i in range(radial):
            k = (i + 1) % radial
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))
    bm.to_mesh(me); bm.free()

    # Köşe rengi: yüksekliğe göre ton + mesafeye göre sise karışım.
    # three.js'te sis THREE.Fog ile tek satır; burada gözle aynı sonucu
    # almak için köşeye pişiriyoruz.
    col = me.color_attributes.new(name="Color", type='FLOAT_COLOR', domain='POINT')
    # Renk ZEMİN KOTUNA göre ölçeklenir, arazinin en dip noktasına göre değil.
    # Aksi halde düz iç halka orta tona düşüyor ve etek ile arazi arasında
    # gözle görülür bir disk kenarı oluşuyor — ilk denemede tam bu oldu.
    zmax = max(v.co.z for v in me.vertices)
    span = max(zmax - ground_z, 1e-6)
    for i, v in enumerate(me.vertices):
        hgt = max(0.0, v.co.z - ground_z) / span
        base = lerp3(TERRAIN_LO, TERRAIN_HI, hgt ** 0.85)
        d = math.hypot(v.co.x - cx, v.co.y - cy)
        f = (d - inner_r) / max(outer_r - inner_r, 1e-6)
        fog = max(0.0, (f - fog_start) / (1.0 - fog_start)) ** 1.25
        col.data[i].color = (*lerp3(base, HORIZON, fog), 1.0)

    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_apron(name, cx, cy, z, radius, rect):
    """Kazı ağzından arazi halkasına kadar uzanan düzlük.

    İç sınır DAİRE DEĞİL dikdörtgendir: her açı için merkezden dikdörtgen
    kenarına olan mesafe alınır. Böylece kanal ağzı açık kalır ve etek ile
    arazi arasında dikişsiz geçiş olur.
    """
    x0, x1, y0, y1 = rect
    rcx, rcy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2

    def inner_r(a):
        ca, sa = math.cos(a), math.sin(a)
        cands = []
        if abs(ca) > 1e-9: cands.append(hx / abs(ca))
        if abs(sa) > 1e-9: cands.append(hy / abs(sa))
        return min(cands) if cands else hx

    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    seg, rings = 128, 6
    grid = []
    for j in range(rings + 1):
        t = j / rings
        row = []
        for i in range(seg):
            a = 2.0 * math.pi * i / seg
            ri = inner_r(a)
            # iç kenar dikdörtgen merkezinden, dış kenar sahne merkezinden
            ix, iy = rcx + ri * math.cos(a), rcy + ri * math.sin(a)
            ox, oy = cx + radius * math.cos(a), cy + radius * math.sin(a)
            row.append(bm.verts.new((ix + (ox - ix) * t, iy + (oy - iy) * t, z)))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for j in range(rings):
        for i in range(seg):
            k = (i + 1) % seg
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))
    bm.to_mesh(me); bm.free()
    col = me.color_attributes.new(name="Color", type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(me.vertices):
        d = math.hypot(v.co.x - cx, v.co.y - cy)
        f = max(0.0, (d - radius * 0.6) / (radius * 0.4))
        col.data[i].color = (*lerp3(APRON, TERRAIN_LO, f ** 1.2), 1.0)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def flat_material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Color"
    nt.links.new(vc.outputs["Color"], emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 1.0
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    m.diffuse_color = (*rgb, 1.0)
    return m


def bake_plant_materials():
    """İçe aktarılan tesisin malzemelerini üretimdeki düz emisyona çevirir."""
    for m in bpy.data.materials:
        if m.name.startswith("TERR") or m.name.startswith("APRON"):
            continue
        base = tuple(m.diffuse_color)[:3]
        try:
            bc = m.node_tree.nodes.get("Principled BSDF")
            if bc:
                base = tuple(bc.inputs["Base Color"].default_value)[:3]
        except Exception:
            pass
        m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emit = nt.nodes.new("ShaderNodeEmission")
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs["Factor"].default_value = 1.0
        vc = nt.nodes.new("ShaderNodeVertexColor")
        # glTF içe aktarımı renk katmanını Col / COLOR_0 adıyla getirebilir
        vc.layer_name = "Color"
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = (*base, 1.0)
        nt.links.new(rgb.outputs[0], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], emit.inputs["Color"])
        emit.inputs["Strength"].default_value = 1.0
        nt.links.new(emit.outputs[0], out.inputs["Surface"])


def set_world(gradient: bool):
    w = bpy.data.worlds.new("W"); w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    if gradient:
        # Dikey gradyan: üstte koyu, ufukta bir tık açık. Derinlik hissi verir,
        # sıfır geometri maliyeti (three.js'te ekran uzayında shader).
        tex = nt.nodes.new("ShaderNodeTexGradient"); tex.gradient_type = 'LINEAR'
        mapn = nt.nodes.new("ShaderNodeMapping")
        mapn.inputs["Rotation"].default_value = (0.0, math.radians(-90), 0.0)
        geo = nt.nodes.new("ShaderNodeTexCoord")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = (0.055, 0.064, 0.080, 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*HORIZON, 1)
        nt.links.new(geo.outputs["Generated"], mapn.inputs["Vector"])
        nt.links.new(mapn.outputs["Vector"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bg.inputs[0])
    else:
        bg.inputs[0].default_value = (*BG, 1.0)
    bg.inputs[1].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    bpy.context.scene.world = w


def render(path, lo, hi, az=-55.0, el=14.0, zoom=1.0):
    sc = bpy.context.scene
    center = (lo + hi) / 2.0
    radius = max((hi - lo).length / 2.0, 1.0)
    a, e = math.radians(az), math.radians(el)
    eye = center + Vector((math.cos(a) * math.cos(e),
                           math.sin(a) * math.cos(e),
                           math.sin(e))) * radius * 2.6 * zoom
    cd = bpy.data.cameras.new("C"); cd.lens = 52
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    cam.location = eye
    cam.rotation_euler = (center - eye).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path
    if hasattr(sc, "eevee"):
        for k, v in (("taa_render_samples", 32), ("use_gtao", False),
                     ("use_shadows", False)):
            if hasattr(sc.eevee, k):
                setattr(sc.eevee, k, v)
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True, choices=list("ABCD"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    clear()
    lo, hi = load_plant()
    bake_plant_materials()
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    footprint = max(hi.x - lo.x, hi.y - lo.y) / 2   # ~57 m (uzun kenarın yarısı)
    ground_z = 6.3
    rect = excavation_rect(ground_z)
    print(f"  kazı ağzı: x {rect[0]:.1f}..{rect[1]:.1f}  y {rect[2]:.1f}..{rect[3]:.1f}")
    tris = 0

    if a.variant == "A":                     # mevcut — referans
        set_world(gradient=False)

    elif a.variant == "B":                   # yalnız ufuk gradyanı, geometri yok
        set_world(gradient=True)

    elif a.variant == "C":                   # alçak sırt — önerilen
        set_world(gradient=True)
        ap_r = footprint * 1.20
        apron = build_apron("APRON", cx, cy, ground_z, ap_r, rect)
        apron.data.materials.append(flat_material("APRON", APRON))
        t = build_terrain("TERR", cx, cy, ground_z, ap_r, footprint * 4.2,
                          amp=2.2, radial=72, rings=14)
        t.data.materials.append(flat_material("TERR", TERRAIN_LO))
        tris = 72 * 14 * 2 + 72 * 5 * 2

    elif a.variant == "D":                   # belirgin tepeler
        set_world(gradient=True)
        ap_r = footprint * 1.10
        apron = build_apron("APRON", cx, cy, ground_z, ap_r, rect)
        apron.data.materials.append(flat_material("APRON", APRON))
        t = build_terrain("TERR", cx, cy, ground_z, ap_r, footprint * 4.8,
                          amp=3.4, radial=88, rings=18, fog_start=0.55)
        t.data.materials.append(flat_material("TERR", TERRAIN_LO))
        tris = 88 * 18 * 2 + 72 * 5 * 2

    # Kamera tesisi çerçeveler; arazi arkada kalsın diye sınır tesisten alınır
    render(a.out, lo, hi, zoom=1.05)
    print(f"\n  varyant {a.variant}: {a.out}  (arazi ~{tris} üçgen)")


main()
