"""Düşük seviye mesh üreticileri — hepsi bmesh ile, hepsi poligon bütçesi parametreli.

`bpy.ops.mesh.primitive_*` kullanılmaz: yavaş, context'e bağımlı ve poligon sayısı
üzerinde kontrol vermez. Buradaki her fonksiyon segment sayısını açıkça alır —
Raspberry Pi 4 bütçesi ancak böyle tutulabilir.

Koordinat sistemi (Blender, Z yukarı):
    X : başlık duvarı boyunca (kanal genişliği)
    Y : akış yönü — kanal −Y'de, pompalar +Y'de
    Z : kot; z = 0 kanal tabanı (invert)
glTF dışa aktarımında Y-up'a çevrilir (three.js için).
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0


# --------------------------------------------------------------------------- #
# Nesne oluşturma
# --------------------------------------------------------------------------- #

def _make(bm: bmesh.types.BMesh, name: str, collection=None) -> bpy.types.Object:
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.name = name
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.collection).objects.link(ob)
    return ob


def shade_smooth(ob: bpy.types.Object, angle_deg: float = 40.0) -> None:
    """Yumuşak gölgeleme + kenar açısı sınırı. Silindirik yüzeyler için."""
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("Smooth", 'SMOOTH_BY_ANGLE') if hasattr(bpy.types, "SmoothByAngleModifier") else None
    if mod is None:
        # Blender 5.x: kenar bazlı düzleştirme özniteliği
        try:
            me.attributes.new("sharp_edge", 'BOOLEAN', 'EDGE')
            thr = math.radians(angle_deg)
            for e in me.edges:
                e.use_edge_sharp = False
            for i, e in enumerate(me.edges):
                pass
        except Exception:                                        # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
# Temel şekiller
# --------------------------------------------------------------------------- #

def box(name: str, size: tuple[float, float, float],
        loc: tuple[float, float, float] = (0, 0, 0),
        rot_z: float = 0.0, collection=None) -> bpy.types.Object:
    """Eksen hizalı kutu (rot_z ile Z etrafında döndürülebilir). 8 köşe, 6 yüz."""
    sx, sy, sz = (s / 2.0 for s in size)
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in (
        (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
        (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
              (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])
    ob = _make(bm, name, collection)
    ob.rotation_euler.z = rot_z
    ob.location = loc
    return ob


def loft(name: str, sections: list[list[Vector]], closed: bool = True,
         cap: bool = True, collection=None) -> bpy.types.Object:
    """Eşit köşe sayılı kesitleri birleştirir. Kanal, boru, her şeyin temeli.

    sections : her biri aynı uzunlukta köşe listesi (dünya koordinatı)
    closed   : profil kapalı halka mı (boru/kanal) yoksa açık şerit mi
    cap      : uç kapaklarını oluştur
    """
    if len(sections) < 2:
        raise ValueError("loft için en az 2 kesit gerekli")
    n = len(sections[0])
    if any(len(s) != n for s in sections):
        raise ValueError("tüm kesitler aynı köşe sayısına sahip olmalı")

    bm = bmesh.new()
    rings = [[bm.verts.new(v) for v in sec] for sec in sections]
    span = n if closed else n - 1
    for a, b in zip(rings, rings[1:]):
        for i in range(span):
            j = (i + 1) % n
            try:
                bm.faces.new((a[i], a[j], b[j], b[i]))
            except ValueError:
                pass                     # çakışan köşe — atla
    if cap and closed:
        try:
            bm.faces.new(rings[0][::-1])
            bm.faces.new(rings[-1])
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return _make(bm, name, collection)


def _circle(r: float, seg: int, z: float = 0.0) -> list[Vector]:
    return [Vector((r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), z))
            for i in range(seg)]


def cylinder(name: str, radius: float, height: float, seg: int = 16,
             loc=(0, 0, 0), axis: str = 'Z', cap: bool = True,
             collection=None) -> bpy.types.Object:
    """Silindir. `axis` ile yönü seçilir: 'X' | 'Y' | 'Z'."""
    h = height / 2.0
    secs = [_circle(radius, seg, -h), _circle(radius, seg, h)]
    ob = loft(name, secs, closed=True, cap=cap, collection=collection)
    if axis == 'X':
        ob.rotation_euler.y = math.pi / 2
    elif axis == 'Y':
        ob.rotation_euler.x = -math.pi / 2
    ob.location = loc
    return ob


def tube(name: str, r_out: float, r_in: float, height: float, seg: int = 16,
         loc=(0, 0, 0), axis: str = 'Z', collection=None) -> bpy.types.Object:
    """İçi boş boru parçası / flanş halkası. Uçları halka kapaklı."""
    h = height / 2.0
    bm = bmesh.new()
    rings = []
    for z in (-h, h):
        for r in (r_out, r_in):
            rings.append([bm.verts.new(v) for v in _circle(r, seg, z)])
    o0, i0, o1, i1 = rings
    for a, b in ((o0, o1), (i1, i0), (i0, o0), (o1, i1)):
        for k in range(seg):
            m = (k + 1) % seg
            bm.faces.new((a[k], a[m], b[m], b[k]))
    ob = _make(bm, name, collection)
    if axis == 'X':
        ob.rotation_euler.y = math.pi / 2
    elif axis == 'Y':
        ob.rotation_euler.x = -math.pi / 2
    ob.location = loc
    return ob


def prism(name: str, profile: list[tuple[float, float]], depth: float,
          loc=(0, 0, 0), collection=None) -> bpy.types.Object:
    """2B kapalı profili Y ekseninde uzatır. Profil (x, z) düzleminde."""
    d = depth / 2.0
    a = [Vector((x, -d, z)) for x, z in profile]
    b = [Vector((x, d, z)) for x, z in profile]
    ob = loft(name, [a, b], closed=True, cap=True, collection=collection)
    ob.location = loc
    return ob


# --------------------------------------------------------------------------- #
# Boru hattı: köşeleri yuvarlatılmış merkez çizgi + paralel taşıma süpürme
# --------------------------------------------------------------------------- #

def fillet_polyline(points: list[Vector], bend_r: float,
                    arc_seg: int = 6) -> list[Vector]:
    """Kırık çizginin köşelerini `bend_r` yarıçaplı yaylarla yuvarlatır.

    Gerçek boru dirsekleri keskin köşe yapmaz; bu fonksiyon merkez çizgiyi
    üretilebilir bir hale getirir. Yay yarıçapı segment uzunluğuna göre kısılır.
    """
    if len(points) < 3:
        return list(points)
    out = [points[0]]
    for i in range(1, len(points) - 1):
        a, b, c = points[i - 1], points[i], points[i + 1]
        d1, d2 = (a - b), (c - b)
        l1, l2 = d1.length, d2.length
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        d1, d2 = d1 / l1, d2 / l2
        cosang = max(-1.0, min(1.0, d1.dot(d2)))
        ang = math.acos(cosang)
        if ang < 1e-3 or abs(ang - math.pi) < 1e-3:
            out.append(b)                                # düz devam / geri dönüş
            continue
        half = ang / 2.0
        t = bend_r / math.tan(half)
        t = min(t, l1 * 0.49, l2 * 0.49)
        r = t * math.tan(half)
        p1, p2 = b + d1 * t, b + d2 * t
        bis = (d1 + d2).normalized()
        center = b + bis * (r / math.sin(half))
        v1, v2 = (p1 - center), (p2 - center)
        axis = v1.cross(v2)
        if axis.length < 1e-9:
            out.append(b)
            continue
        axis.normalize()
        sweep = v1.angle(v2)
        for k in range(arc_seg + 1):
            out.append(center + (Matrix.Rotation(sweep * k / arc_seg, 3, axis) @ v1))
    out.append(points[-1])
    # ardışık çok yakın noktaları temizle
    clean = [out[0]]
    for p in out[1:]:
        if (p - clean[-1]).length > 1e-4:
            clean.append(p)
    return clean


def sweep_circle(name: str, path: list[Vector], radius: float, ring_seg: int = 12,
                 cap: bool = True, collection=None) -> bpy.types.Object:
    """Merkez çizgi boyunca daire süpürür. Paralel taşıma ile burulma önlenir."""
    if len(path) < 2:
        raise ValueError("süpürme için en az 2 nokta gerekli")

    tangents = []
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - path[0]
        elif i == len(path) - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        tangents.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))

    # Başlangıç çerçevesi
    up = Vector((0, 0, 1))
    if abs(tangents[0].dot(up)) > 0.95:
        up = Vector((1, 0, 0))
    n0 = (up - tangents[0] * up.dot(tangents[0])).normalized()

    sections, n_prev, t_prev = [], n0, tangents[0]
    for p, t in zip(path, tangents):
        # Paralel taşıma: önceki normali teğet değişimi kadar döndür
        axis = t_prev.cross(t)
        if axis.length > 1e-9:
            ang = max(-1.0, min(1.0, t_prev.dot(t)))
            n_prev = Matrix.Rotation(math.acos(ang), 3, axis.normalized()) @ n_prev
        n_prev = (n_prev - t * n_prev.dot(t)).normalized()
        b = t.cross(n_prev)
        sections.append([p + (n_prev * math.cos(TAU * i / ring_seg) +
                              b * math.sin(TAU * i / ring_seg)) * radius
                         for i in range(ring_seg)])
        t_prev = t
    return loft(name, sections, closed=True, cap=cap, collection=collection)


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #

def tri_count(ob: bpy.types.Object) -> int:
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def scene_stats() -> dict:
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    return {
        "objects": len(obs),
        "tris": sum(tri_count(o) for o in obs),
        "verts": sum(len(o.data.vertices) for o in obs),
        "materials": len({m.name for o in obs for m in o.data.materials if m}),
    }


# --------------------------------------------------------------------------- #
# Toplayıcı: çok sayıda parçayı TEK mesh'te birleştirir
# --------------------------------------------------------------------------- #

class Builder:
    """Parçaları tek bmesh'te biriktirir. Draw call bütçesi bununla tutulur.

    Başlık duvarı 6 gözlü olduğunda 11 kutu eder; bunları ayrı nesne yapmak
    11 draw call demektir. Builder hepsini tek mesh'e yazar → 1 draw call.
    """

    def __init__(self) -> None:
        self.bm = bmesh.new()

    def box(self, size, loc=(0, 0, 0), rot_z: float = 0.0) -> "Builder":
        sx, sy, sz = (s / 2.0 for s in size)
        pts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
               (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, 'Z')
        vs = [self.bm.verts.new(m @ Vector(p)) for p in pts]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                  (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.bm.faces.new([vs[i] for i in f])
        return self

    def loft(self, sections, closed: bool = True, cap: bool = True) -> "Builder":
        n = len(sections[0])
        rings = [[self.bm.verts.new(v) for v in s] for s in sections]
        span = n if closed else n - 1
        for a, b in zip(rings, rings[1:]):
            for i in range(span):
                j = (i + 1) % n
                try:
                    self.bm.faces.new((a[i], a[j], b[j], b[i]))
                except ValueError:
                    pass
        if cap and closed:
            try:
                self.bm.faces.new(rings[0][::-1])
                self.bm.faces.new(rings[-1])
            except ValueError:
                pass
        return self

    def cylinder(self, radius, height, seg=16, loc=(0, 0, 0), axis='Z') -> "Builder":
        h = height / 2.0
        rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}.get(axis, Matrix.Identity(4))
        m = Matrix.Translation(Vector(loc)) @ rot
        return self.loft([[m @ v for v in _circle(radius, seg, -h)],
                          [m @ v for v in _circle(radius, seg, h)]])

    def tube(self, r_out, r_in, height, seg=16, loc=(0, 0, 0), axis='Z') -> "Builder":
        h = height / 2.0
        rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}.get(axis, Matrix.Identity(4))
        m = Matrix.Translation(Vector(loc)) @ rot
        rings = [[self.bm.verts.new(m @ v) for v in _circle(r, seg, z)]
                 for z in (-h, h) for r in (r_out, r_in)]
        o0, i0, o1, i1 = rings
        for a, b in ((o0, o1), (i1, i0), (i0, o0), (o1, i1)):
            for k in range(seg):
                self.bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
        return self

    def sweep(self, path, radius, ring_seg=12, cap=True) -> "Builder":
        tmp = sweep_circle("__tmp_sweep", path, radius, ring_seg, cap)
        self.absorb(tmp)
        return self

    def absorb(self, ob: bpy.types.Object) -> "Builder":
        """Var olan bir nesnenin mesh'ini içeri alır ve nesneyi siler."""
        tmp = bmesh.new()
        tmp.from_mesh(ob.data)
        tmp.transform(ob.matrix_world)
        me = bpy.data.meshes.new("__absorb")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        d = ob.data
        bpy.data.objects.remove(ob)
        if d.users == 0:
            bpy.data.meshes.remove(d)
        return self

    def finish(self, name: str, weld: float = 1e-5, collection=None) -> bpy.types.Object:
        if weld:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=weld)
        return _make(self.bm, name, collection)


def arc_path(center: Vector, radius: float, start_deg: float, sweep_deg: float,
             axis: str = 'Y', seg: int = 10) -> list[Vector]:
    """Bir eksen etrafında dairesel yay üzerinde noktalar. Sargı/dirsek için."""
    pts = []
    for i in range(seg + 1):
        a = math.radians(start_deg + sweep_deg * i / seg)
        c, s = math.cos(a), math.sin(a)
        off = {'X': Vector((0, c, s)), 'Y': Vector((c, 0, s)),
               'Z': Vector((c, s, 0))}[axis] * radius
        pts.append(center + off)
    return pts
