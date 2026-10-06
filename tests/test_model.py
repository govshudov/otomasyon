#!/usr/bin/env python3
"""Faz 2 kabul testi: üretilen .glb ile twin-map.json tutarlı mı?

Bu testin varlık sebebi: 3D model ile veri modelinin ayrışmadığını KANITLAMAK.
Bir bileşenin sinyali varsa modelde düğümü olmalı; düğümü varsa haritada
karşılığı olmalı. Aradaki her boşluk sahada "arıza gösterilemiyor" demektir.

Harici bağımlılık yok — GLB ikili formatı elle ayrıştırılıyor.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLB = ROOT / "build/ps-01.glb"
TMAP = ROOT / "build/ps-01-twin-map.json"
TYPES = json.loads((ROOT / "common/equipment_types.json").read_text(encoding="utf-8"))["types"]
STATION = json.loads((ROOT / "stations/ps-01.json").read_text(encoding="utf-8"))

NAME_RE = re.compile(r"^[A-Z][A-Z0-9-]*(__[A-Z0-9-]+)*$")
fails: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  {'✓' if cond else '✗'} {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)
    return cond


def read_glb(path: Path) -> tuple[dict, int]:
    raw = path.read_bytes()
    magic, version, total = struct.unpack("<4sII", raw[:12])
    assert magic == b"glTF", "GLB imzası geçersiz"
    off, gltf = 12, None
    while off < total:
        ln, ty = struct.unpack("<II", raw[off:off + 8])
        if ty == 0x4E4F534A:                       # 'JSON'
            gltf = json.loads(raw[off + 8:off + 8 + ln].decode("utf-8"))
            break
        off += 8 + ln + (-ln % 4)
    return gltf, len(raw)


def main() -> int:
    print("\n[1] GLB dosyası")
    if not GLB.exists():
        check("build/ps-01.glb var", False, "önce üreticiyi çalıştır")
        return 1
    gltf, size = read_glb(GLB)
    tmap = json.loads(TMAP.read_text(encoding="utf-8"))
    nodes = {n["name"]: n for n in gltf.get("nodes", []) if "name" in n}
    check("GLB ayrıştırıldı", bool(gltf), f"{size/1024:.1f} KB, {len(nodes)} düğüm")
    check("Draco sıkıştırma etkin",
          "KHR_draco_mesh_compression" in gltf.get("extensionsUsed", []),
          ", ".join(gltf.get("extensionsUsed", [])) or "yok")

    print("\n[2] İsimlendirme standardı")
    bad = [n for n in nodes if not NAME_RE.match(n)]
    check("tüm düğüm adları standarda uyuyor", not bad, ", ".join(bad[:3]) or f"{len(nodes)} düğüm")

    print("\n[3] Vertex color (Pi'nin tek aydınlatma kaynağı)")
    prims = [p for m in gltf.get("meshes", []) for p in m["primitives"]]
    def attrs(p):
        a = dict(p.get("attributes", {}))
        a.update(p.get("extensions", {}).get("KHR_draco_mesh_compression", {})
                 .get("attributes", {}))
        return a
    with_col = sum(1 for p in prims if "COLOR_0" in attrs(p))
    check("her primitifte COLOR_0 var", with_col == len(prims),
          f"{with_col}/{len(prims)} primitif")
    no_tex = all("TEXCOORD_1" not in attrs(p) for p in prims)
    check("doku yükü minimum", "images" not in gltf or not gltf.get("images"),
          f"{len(gltf.get('images', []))} görsel")

    print("\n[4] glTF extras — tag bağlantısı modelin içinde")
    tagged = [n for n in gltf.get("nodes", []) if n.get("extras")]
    with_eq = [n for n in tagged if "equipment" in n.get("extras", {})]
    check("düğümler extras taşıyor", len(tagged) > 60, f"{len(tagged)} düğüm")
    check("ekipman bağlantısı gömülü", len(with_eq) > 60,
          f"{len(with_eq)} düğümde `equipment` alanı")
    sample = next((n for n in with_eq if n["extras"].get("component")), None)
    if sample:
        e = sample["extras"]
        check("örnek düğüm tam bağlı",
              all(k in e for k in ("station", "equipment", "eq_type", "component")),
              f"{sample['name']} -> {e.get('equipment')}/{e.get('component')}")

    print("\n[5] MODEL ↔ VERİ MODELİ EŞLEŞMESİ (bu testin asıl amacı)")
    missing_nodes, missing_map = [], []
    signalled = 0
    for eq_id, eq in tmap["equipment"].items():
        if eq["node"] not in nodes:
            missing_nodes.append(eq["node"])
        for comp, c in eq["components"].items():
            if c["node"] not in nodes:
                missing_nodes.append(c["node"])
            signalled += len(c["signals"])
    check("haritadaki her düğüm modelde var", not missing_nodes,
          ", ".join(missing_nodes[:3]) or f"{len(tmap['equipment'])} ekipman")

    # Ters yön: sinyali olan her bileşenin modelde düğümü var mı?
    orphan = []
    for e in STATION["equipment"]:
        tdef = TYPES.get(e["type"], {})
        for key in tdef.get("signals", {}):
            if "." not in key:
                continue
            comp = key.split(".", 1)[0]
            if f"{e['id']}__{comp}" not in nodes:
                orphan.append(f"{e['id']}.{key}")
    check("sinyali olan her bileşenin 3D düğümü var", not orphan,
          ", ".join(orphan[:3]) or f"{signalled} bileşen sinyali bağlı")

    print("\n[6] Kamera çerçeveleri (dokun→yakınlaş özelliği)")
    no_cam = [eq["node"] for eq in tmap["equipment"].values() if not eq.get("camera")]
    no_cam += [c["node"] for eq in tmap["equipment"].values()
               for c in eq["components"].values() if not c.get("camera")]
    check("her düğümün kamera çerçevesi var", not no_cam,
          ", ".join(no_cam[:3]) or "hepsi hazır")
    cam = tmap["equipment"]["PMP-01"]["components"]["MOTOR"]["camera"]
    check("çerçeve makul ölçekte", cam and 0.1 < cam["radius"] < 3.0,
          f"motor: hedef {cam['target']}, yarıçap {cam['radius']} m")

    print("\n[7] Su yüzeyi frontend'de yeniden hesaplanabilir mi?")
    w = tmap.get("geometry", {}).get("water", {})
    plan = w.get("plan", [])
    check("kanal plan istasyonları haritada",
          len(plan) >= 2 and all(len(p) == 3 for p in plan) and "invert_el" in w,
          f"{len(plan)} istasyon")
    check("plan memba → mansap sıralı", all(a[0] < b[0] for a, b in zip(plan, plan[1:])))

    print("\n[7b] Pompa izleme veri seti ve düz arka plan")
    pmp = tmap["equipment"]["PMP-01"]
    n_sig = len(pmp["signals"]) + sum(len(c["signals"]) for c in pmp["components"].values())
    check("pompa başına 16 sinyal (8 sıcaklık + 8)", n_sig == 16, f"{n_sig} sinyal")
    check("arazi katmanı yok", "STATIC__TERRAIN" not in nodes)
    n_pumps = sum(1 for e in tmap["equipment"].values() if e["type"] == "pump_hsc")
    check("6 pompa", n_pumps == 6, f"{n_pumps} pompa")

    print("\n[8] Pi 4 bütçesi")
    b = tmap.get("budget", {})
    check("üçgen bütçesi", b.get("tris", 1e9) <= 150_000, f"{b.get('tris'):,} / 150,000")
    check("malzeme bütçesi", b.get("materials", 99) <= 6, f"{b.get('materials')} / 6")
    check("dosya boyutu makul", size < 3 * 1024 * 1024, f"{size/1024:.0f} KB")

    print("\n" + ("MODEL DOĞRULANDI ✓" if not fails
                  else f"BAŞARISIZ ✗ — {', '.join(fails)}") + "\n")
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
