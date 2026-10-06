"""Arazi katmanı — tesis eteği + çevre tepeleri (tasarım varyantı C).

Neden var: sahne düz tek renk arka planda duruyordu; ne ölçek hissi vardı ne de
su alma yapısının araziye KAZILMIŞ olduğu okunuyordu. İkisi de operatörün sahayı
tanıması için gerçek bilgi, süs değil.

Üç kural bu modülün her satırını belirledi:

1. ISA-101 renk disiplini. Renk yalnız durum ve alarm için ayrılmış. Arazi
   alarm kırmızısından, uyarı amberinden, çalışma mavisinden ve seçim
   camgöbeğinden UZAK durmak zorunda. Geriye düşük doygunluklu yeşil-gri
   kalıyor ve tesisten koyu olmalı — aksi halde arazi tesisi ezer.

2. Tek malzeme. Draw call bütçesi 8; tesis 7 kullanıyor. Etek ve tepeler tek
   mesh, tek malzemede birleşiyor ki bütçe aşılmasın. Renk farkını malzeme
   değil KÖŞE RENGİ taşıyor.

3. Kazı ağzı açık kalmalı. İlk denemede zemini dairesel düz disk yaptım ve
   disk kanalı tamamen gömdü: kapak, kanal duvarları, su yüzeyi kayboldu.
   Etek iç sınırı bu yüzden daire değil DİKDÖRTGEN — kotun altında kalan
   geometrinin XY sınırı ölçülüp o kadar ağız bırakılıyor.

Sis three.js'te THREE.Fog ile değil, köşe rengine PİŞİRİLEREK uygulanıyor.
Sebep: sahne sisi tesise de vurur ve pompalar puslanır; arazi uzakta erirken
tesisin net kalması gerekiyor.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector

# Zemin, güverte üstünden bu kadar aşağıda. Güverte zemine oturuyor görünsün.
GROUND_DROP = 0.2

# Figür/zemin: tesis (açık gri beton/çelik) sahnenin en PARLAK elemanı kalmalı.
# Bu değerler istenen EKRAN TONU (0..1 sRGB), ham köşe rengi değil.
#
# Kalibrasyon Pi ekranından piksel örnekleyerek yapıldı: köşe rengine yazılan
# değer DOĞRUSAL uzayda birebir geçiyor, ekrana toSRGB ile çıkıyor.
# Ölçüm: 0,500 yazıldı -> ekranda 0,749 (= toSRGB(0,5) ✓).
# Bu yüzden yazmadan önce toLinear uygulanıyor (_lin).
#
# UYARI — iki tur bu renkleri kovalayarak kaybedildi. Gerçek sebep renk değil,
# TERS YÜZ NORMALLERİ idi: arazi hiç çizilmiyordu, ben de gökyüzü piksellerini
# arazi sanıp ölçüyordum. Renk şüphesi varsa ÖNCE yüzeyin gerçekten çizilip
# çizilmediğini doğrula (üçgen sayısı ve ekran görüntüsü).
#
# Figür/zemin: tesis betonu ekranda ~RGB 150. Arazi ondan belirgin koyu olmalı.
HORIZON    = (0.150, 0.165, 0.200)   # ufuk — gökyüzü gradyanının alt ucuyla eşleşir
TERRAIN_LO = (0.270, 0.290, 0.275)   # vadi        -> ekranda ~RGB 70
TERRAIN_HI = (0.450, 0.475, 0.415)   # sırt üstü   -> ekranda ~RGB 115
APRON      = (0.290, 0.305, 0.300)   # tesis eteği -> ekranda ~RGB 75


def _lin(v: float) -> float:
    """İstenen ekran tonunu köşe rengine yazılacak doğrusal değere çevirir."""
    v = max(0.0, min(1.0, v))
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


# Varyant C ölçüleri (onaylanan render'ın birebir aynısı)
APRON_SCALE  = 1.20    # etek yarıçapı = tesis yarıçapı × bu
TERRAIN_SCALE = 4.2    # arazi dış yarıçapı = tesis yarıçapı × bu
AMPLITUDE    = 2.2     # tepe genliği çarpanı
RADIAL, RINGS = 72, 14         # arazi halkası bölüntüsü
APRON_SEG, APRON_RINGS = 128, 6

# Pişirilmiş AO'nun arazide ne kadar etkili olacağı. 1.0 = AO yok sayılır,
# 0.0 = ham AO. Temas gölgesi görünsün ama zeytin tonu korunsun.
AO_SOFT_FLOOR = 0.70

_TERRAIN_NAME = "STATIC__TERRAIN"


def _height(x: float, y: float) -> float:
    """Katmanlı sinüs. Rastgelelik YOK — aynı config aynı araziyi üretir."""
    return (7.4 * math.sin(x * 0.0130) * math.cos(y * 0.0106)
            + 4.1 * math.sin(x * 0.0305 + 1.7) * math.cos(y * 0.0268 + 0.4)
            + 2.6 * math.sin(x * 0.0620 + 3.1) * math.sin(y * 0.0575 + 2.2)
            + 1.1 * math.sin(x * 0.1080 + 0.9) * math.cos(y * 0.0995 + 1.6))


def _lerp3(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _scene_bounds() -> tuple[Vector, Vector]:
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name == _TERRAIN_NAME:
            continue
        mw = ob.matrix_world
        for c in ob.bound_box:
            w = mw @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def _excavation_rect(ground_z: float, pad: float = 1.5):
    """Zemin kotunun ALTINDA kalan geometrinin XY sınırı = kazı ağzı."""
    xs, ys = [], []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name == _TERRAIN_NAME:
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            w = mw @ v.co
            if w.z < ground_z - 0.05:
                xs.append(w.x); ys.append(w.y)
    if not xs:
        return None
    return (min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)


def build(g: dict) -> dict:
    """Etek + tepeleri TEK mesh olarak kurar. Nesneyi döndürmez; rapor döndürür.

    generate.py bunu AO pişirmesinden ÖNCE çağırmalı (arazi de gölge alsın),
    `shade()` ise pişirmeden SONRA.
    """
    ground_z = g["channel"]["deck_el"] - GROUND_DROP
    rect = _excavation_rect(ground_z)
    if rect is None:
        return {"skipped": "kazı ağzı bulunamadı"}

    lo, hi = _scene_bounds()
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    footprint = max(hi.x - lo.x, hi.y - lo.y) / 2
    apron_r = footprint * APRON_SCALE
    outer_r = footprint * TERRAIN_SCALE

    x0, x1, y0, y1 = rect
    rcx, rcy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2

    def inner_r(a: float) -> float:
        """Merkezden dikdörtgen kenarına mesafe — kazı ağzının açı fonksiyonu."""
        ca, sa = math.cos(a), math.sin(a)
        cands = []
        if abs(ca) > 1e-9: cands.append(hx / abs(ca))
        if abs(sa) > 1e-9: cands.append(hy / abs(sa))
        return min(cands) if cands else hx

    me = bpy.data.meshes.new(_TERRAIN_NAME)
    bm = bmesh.new()

    # --- etek: kazı ağzından (dikdörtgen) etek yarıçapına (daire) --- #
    grid = []
    for j in range(APRON_RINGS + 1):
        t = j / APRON_RINGS
        row = []
        for i in range(APRON_SEG):
            a = 2.0 * math.pi * i / APRON_SEG
            ri = inner_r(a)
            ix, iy = rcx + ri * math.cos(a), rcy + ri * math.sin(a)
            ox, oy = cx + apron_r * math.cos(a), cy + apron_r * math.sin(a)
            row.append(bm.verts.new((ix + (ox - ix) * t, iy + (oy - iy) * t, ground_z)))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for j in range(APRON_RINGS):
        for i in range(APRON_SEG):
            k = (i + 1) % APRON_SEG
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))

    # --- tepeler: etek yarıçapından dışa, yükselerek --- #
    grid = []
    for j in range(RINGS + 1):
        t = j / RINGS
        r = apron_r + (outer_r - apron_r) * (t ** 1.45)
        row = []
        for i in range(RADIAL):
            a = 2.0 * math.pi * i / RADIAL
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            # iç kenar tam düz başlar; etekle dikişsiz birleşsin
            ramp = 0.0 if t <= 0.0 else min(1.0, (t / 0.55) ** 1.6)
            row.append(bm.verts.new((x, y, ground_z + _height(x, y) * AMPLITUDE * ramp)))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for j in range(RINGS):
        for i in range(RADIAL):
            k = (i + 1) % RADIAL
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))

    # Normalleri YUKARI çevir. Halka yüzeyini üreten dörtgen sarımı normalleri
    # aşağı bakacak şekilde veriyordu; three.js varsayılan FrontSide ile bu
    # yüzeyleri eleyince ekranda arazinin yalnız uzak sırtı görünüyor, geri
    # kalanı hiç çizilmiyordu (sahada ölçüldü — renk ayarları bu yüzden
    # etkisiz kalmıştı). AO pişirmesi de yanlış normalle çalışıyordu.
    bm.normal_update()
    flipped = 0
    for f in bm.faces:
        if f.normal.z < 0.0:
            f.normal_flip()
            flipped += 1

    bm.to_mesh(me); bm.free()
    me.update()
    ob = bpy.data.objects.new(_TERRAIN_NAME, me)
    bpy.context.scene.collection.objects.link(ob)

    # shade() için gereken ölçüler nesnede saklanır
    ob["_terr"] = [cx, cy, ground_z, apron_r, outer_r]
    return {"object": ob, "tris": len(me.polygons) * 2, "flipped": flipped,
            "verts": len(me.vertices), "apron_r": apron_r, "outer_r": outer_r,
            "ground_z": ground_z, "rect": rect}


def shade() -> dict:
    """Yüksekliğe göre ton + mesafeye göre sis; pişirilmiş AO ile ÇARPILIR.

    shading.bake()'ten SONRA çağrılmalı. Pişirilmiş AO'yu korumak temas
    gölgesini korur: etek yapının dibinde koyulaşır, bina zemine oturur.
    Yalnız gradyan yazsaydık bina havada duruyormuş gibi görünürdü.
    """
    ob = bpy.context.scene.objects.get(_TERRAIN_NAME)
    if ob is None:
        return {"skipped": "nesne yok"}
    if "_terr" not in ob:
        return {"skipped": "_terr ölçüleri yok"}
    cx, cy, ground_z, apron_r, outer_r = ob["_terr"]
    me = ob.data
    col = me.color_attributes.get("AO")
    if col is None:
        return {"skipped": "AO katmanı yok"}

    zmax = max(v.co.z for v in me.vertices)
    span = max(zmax - ground_z, 1e-6)
    for i, v in enumerate(me.vertices):
        d = math.hypot(v.co.x - cx, v.co.y - cy)
        if d <= apron_r:                       # etek: içten dışa hafif geçiş
            f = max(0.0, (d - apron_r * 0.6) / max(apron_r * 0.4, 1e-6))
            base = _lerp3(APRON, TERRAIN_LO, min(1.0, f) ** 1.2)
        else:                                  # tepeler: yükseklik + sis
            hgt = max(0.0, v.co.z - ground_z) / span
            base = _lerp3(TERRAIN_LO, TERRAIN_HI, hgt ** 0.85)
            f = (d - apron_r) / max(outer_r - apron_r, 1e-6)
            fog = max(0.0, (f - 0.45) / 0.55) ** 1.25
            base = _lerp3(base, HORIZON, fog)
        # AO YUMUŞATILARAK uygulanır. Ham AO [0.30, 1.0] aralığında; doğrudan
        # çarpmak arazi rengini üç katına kadar koyultuyor ve onaylanan
        # tasarımdaki zeytin tonu siyaha düşüyor (ölçüldü). Bu eğri temas
        # gölgesini korur ama tonu bozmaz.
        ao = AO_SOFT_FLOOR + (1.0 - AO_SOFT_FLOOR) * col.data[i].color[0]
        # AO doğrusal uzayda çarpılır — fiziksel olarak doğru olan da bu.
        col.data[i].color = (_lin(base[0]) * ao, _lin(base[1]) * ao, _lin(base[2]) * ao, 1.0)
    del ob["_terr"]
    # Yazılan aralık raporlanır: renk hedefe ulaşmazsa (yanlış katman, yanlış
    # renk uzayı) burada hemen görülür. Bir tur bu yüzden kaybedildi.
    sample = [col.data[i].color[0] for i in range(0, len(col.data), max(1, len(col.data) // 400))]
    return {"verts": len(me.vertices), "layer": col.name, "type": col.data_type,
            "min": min(sample), "max": max(sample),
            "layers": [c.name for c in me.color_attributes],
            "render_idx": me.color_attributes.render_color_index}
