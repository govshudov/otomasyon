#!/usr/bin/env python3
"""Parametrik istasyon modeli üreticisi.

    blender --background --python tools/genmodel/generate.py -- \
            --config stations/ps-01.json --out build/ps-01.glb --preview build/ps-01.png

JSON konfigürasyonundan tam bir 3D istasyon, isimlendirme standardına uygun
düğüm ağacıyla ve `twin-map.json` eşleme dosyasıyla birlikte üretir.
Elle modelleme yoktur; her ölçü konfigürasyondan gelir.

Sahne düz arka plan önünde durur — arazi/tepe yok (referans görsel).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent.parent

import bpy                                                     # noqa: E402

import civil                                                   # noqa: E402
import export as exportmod                                     # noqa: E402
import intake                                                  # noqa: E402
import piping                                                  # noqa: E402
import shading                                                 # noqa: E402
import water as watermod                                       # noqa: E402
import pumps as pumpmod                                        # noqa: E402
import materials                                               # noqa: E402
import prim                                                    # noqa: E402
from naming import Registry, build_twin_map                    # noqa: E402


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="generate.py")
    ap.add_argument("--config", default=str(ROOT / "stations/ps-01.json"))
    ap.add_argument("--types", default=str(ROOT / "common/equipment_types.json"))
    ap.add_argument("--out", default=str(ROOT / "build/ps-01.glb"))
    ap.add_argument("--twin-map", default=None)
    ap.add_argument("--preview", default=None, help="PNG önizleme yolu")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--plain-out", default=None,
                    help="ek olarak Draco'suz GLB (JACE paketi için: CSP blob: worker yasağı)")
    ap.add_argument("--rays", type=int, default=40,
                    help="AO örnekleme ışın sayısı (kalite/hız dengesi)")
    return ap.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            block.remove(item)


def main() -> int:
    a = parse_args()
    station = json.loads(Path(a.config).read_text(encoding="utf-8"))
    types = json.loads(Path(a.types).read_text(encoding="utf-8"))["types"]
    g = station["geometry"]
    pa = g["pump_area"]
    ground = pa["ground_el"]

    reset_scene()
    mats = materials.build()
    reg = Registry(station, types)
    by_type: dict[str, list[dict]] = {}
    for e in station["equipment"]:
        by_type.setdefault(e["type"], []).append(e)

    print(f"\n=== {station['station_id']} — {station.get('name','')} ===")

    # ---------------- Yerleşim ---------------- #
    cg = civil.cell_grid(g)
    civil.check_plan(g, cg)
    units, y_shift = pumpmod.layout(station, g, cg["centers"])
    if y_shift > 0:
        print(f"  yelpaze için pompa sıraları ve kolektör {y_shift:.2f} m geri çekildi")
    if len(units) > cg["n"]:
        raise ValueError(f"{len(units)} pompa var ama {cg['n']} hücre — her pompanın hücresi olmalı")

    # ---------------- Beton yapı (tek mesh) ---------------- #
    b = prim.Builder()
    civil.channel(g, b)
    civil.cells(g, b, cg)
    br = civil.bridge(g, b)
    civil.pump_pads(b, [pumpmod.footprint(u["eq"]["params"], u["x"], u["y"], u["side"], ground)
                        for u in units])
    ob = b.finish("STATIC__CIVIL")
    reg.structural(ob, "CIVIL")
    materials.assign(ob, mats["CONCRETE"])

    print(f"  hücre sırası: {cg['n']} hücre, {cg['total_w']:.2f} m; "
          f"kanal {abs(g['channel']['plan'][0][0]):.1f} m")
    for u in units:
        print(f"    {u['eq']['id']}  x={u['x']:+6.2f}  y={u['y']:5.2f}  "
              f"hücre x={u['cell_x']:+6.2f}  motor {'+X' if u['side'] > 0 else '-X'}")

    # ---------------- Pompa üniteleri + emme/basma hatları ---------------- #
    nrv_of = {e["source_pump"]: e for e in by_type.get("check_valve", [])}
    vlv_of = {e["interlock_pump"]: e for e in by_type.get("butterfly_valve", [])}
    hdr_cfg = dict(g["headers"], y=g["headers"]["y"] + y_shift)
    by_id = {e["id"]: e for e in station["equipment"]}
    header_xs: dict[str, list[float]] = {}
    built = {}
    for u in units:
        eq = u["eq"]
        prm = eq["params"]
        parts = pumpmod.build(reg, mats, eq, u["x"], u["y"], u["side"], ground,
                              piping.radius(prm["dn_suction"]), piping.radius(prm["dn_discharge"]))
        built[eq["id"]] = parts
        piping.suction_line(reg, mats, eq, u["cell_x"], cg["end_wall"], pa["riser_y"],
                            pa["suction_el"], parts["_suction_point"])
        r_hdr = piping.radius(by_id[eq["header"]]["params"]["dn"])
        p_nrv, p_vlv, r = piping.discharge_line(reg, mats, eq, parts["_discharge_point"],
                                                hdr_cfg["y"], r_hdr)
        if eq["id"] in nrv_of:
            piping.check_valve(reg, mats, nrv_of[eq["id"]], p_nrv, r)
        if eq["id"] in vlv_of:
            piping.butterfly_valve(reg, mats, vlv_of[eq["id"]], p_vlv, r)
        header_xs.setdefault(eq["header"], []).append(u["x"])
    print(f"  pompa üniteleri: {len(built)} adet")

    z_pipe = ground + pumpmod.axis_height(units[0]["eq"]["params"])
    for hid, xs in header_xs.items():
        xm = piping.header(reg, mats, by_id[hid], xs, hdr_cfg["y"], z_pipe, hdr_cfg["run_length"])
        print(f"  {hid}: {len(xs)} pompa, ana hat x={xm:+.2f}")
    print(f"  armatür: {len(nrv_of)} çekvalf, {len(vlv_of)} vana")

    # ---------------- Kapak, ızgara, su ---------------- #
    for e in by_type.get("slide_gate", []):
        intake.slide_gate(reg, mats, e, g, br)
    for e in by_type.get("trash_rack", []):
        intake.trash_rack(reg, mats, e, g, br)

    nominal = station["hydraulics"]["basin"].get("design_level", 3.2)
    for e in by_type.get("basin", []):
        watermod.build(reg, mats, e, g["channel"], nominal)
    print(f"  kapak/ızgara/su yüzeyi eklendi (nominal seviye {nominal:.1f} m)")

    # ---------------- Model ile veri modeli çapraz doğrulaması ---------------- #
    reg.validate()
    print("\n  isimlendirme doğrulaması:")
    print(reg.report())

    # ---------------- Işığı köşe renklerine pişir ---------------- #
    t0 = time.time()
    ao = shading.bake(rays=a.rays)
    print(f"\n  AO pişirme: {ao['objects']} nesne, {ao['vertices']} köşe, "
          f"{ao['rays']:,} ışın, {time.time()-t0:.1f} sn")

    # ---------------- Bütçe raporu ---------------- #
    stats = prim.scene_stats()
    per_mat = exportmod.stats_by_material()
    print("\n  === Raspberry Pi 4 bütçesi ===")
    # Not: "kaynak düğüm" bir çalışma zamanı kısıtı DEĞİL — glTF ayrıştırma
    # süresini sınırlar. Gerçek Pi 4 kısıtı üçgen ve draw call'dır; draw call
    # birleştirme sonrası malzeme sayısına eşittir.
    budget = [("üçgen", stats["tris"], 150_000),
              ("draw call", len(per_mat), 8),
              ("kaynak düğüm", stats["objects"], 600)]
    for label, val, limit in budget:
        mark = "✓" if val <= limit else "✗ BÜTÇE AŞIMI"
        print(f"    {label:9s} {val:7,d} / {limit:7,d}  {mark}")
    print("    malzeme dağılımı:")
    for m, agg in sorted(per_mat.items(), key=lambda kv: -kv[1]["tris"]):
        print(f"      {m:10s} {agg['objects']:4d} nesne  {agg['tris']:7,d} üçgen")

    if not a.no_export:
        frames = exportmod.camera_frames()
        tmap = build_twin_map(reg, frames)
        tmap["geometry"] = {"water": watermod.surface_params(g["channel"]),
                            "cells": [[round(x, 3), round(-cg["depth"] / 2.0, 3)]
                                      for x in cg["centers"]]}
        tmap["budget"] = {"tris": stats["tris"], "objects": stats["objects"],
                          "materials": len(per_mat)}
        tm_path = a.twin_map or str(Path(a.out).with_name("twin-map.json"))
        n = exportmod.write_twin_map(tm_path, tmap)
        size = exportmod.write_glb(a.out)
        print(f"\n  model:    {a.out}  ({size/1024:.1f} KB, Draco sıkıştırmalı)")
        if a.plain_out:
            psize = exportmod.write_glb(a.plain_out, draco=False)
            print(f"  düz:      {a.plain_out}  ({psize/1024:.1f} KB, sıkıştırmasız — JACE)")
        print(f"  eşleme:   {tm_path}  ({n/1024:.1f} KB, "
              f"{len(tmap['equipment'])} ekipman, {len(frames)} kamera çerçevesi)")

    # DİKKAT: önizleme malzemelerin node ağacını emisyona çevirir (yıkıcı).
    # Bu yüzden export'tan SONRA çalışmalı — aksi halde .glb'de baseColor siyah çıkar.
    if a.preview:
        # Mutlak yol şart: Blender göreli render yolunu çalışma dizinine değil
        # kendi köküne göre çözüyor (C:\build\... gibi yanlış yere yazıyordu).
        out_png = Path(a.preview).resolve()
        out_png.parent.mkdir(parents=True, exist_ok=True)
        import preview
        preview.render(str(out_png))
        print(f"\n  önizleme: {out_png}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
