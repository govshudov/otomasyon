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

import building as bldmod                                      # noqa: E402
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


def links_of(pump: dict) -> list[str]:
    """Nasosun basabildiği kolektörler: "headers" (ortak hat) ya da yalnız "header"."""
    return list(pump.get("headers") or [pump["header"]])


def header_layout(headers: list[dict], units: list[dict], base_y: float) -> dict[str, dict]:
    """Kolektör yerleşimi: {id: {y, xm, xs, transverse}} (konfigürasyon sırasıyla; nasossuz çizilmez).

    Kolektörler ortak nasoslar üzerinden gruplanır (bağlı bileşen). Grupta tek kolektör varsa
    eskisi gibi: enine hat beslediği nasosları toplar, ana hat ortasından çıkar. Ortak hatta
    (ör. 1 Maý: N-1…N-7 → T-1, T-2, T-3) nasoslar TEK enine kolektöre basar (grubun ilk
    kolektörü çizer, bütün nasosları kapsar); her kolektörün yalnız ana hattı çizilir ve
    ortak kolektörden T ile çıkar — ana hatlar nasos sırası boyunca yan yana dağılır.
    """
    xs_of: dict[str, list[float]] = {h["id"]: [] for h in headers}
    for u in units:
        for h in links_of(u["eq"]):
            if h in xs_of:
                xs_of[h].append(u["x"])
    order = [h["id"] for h in headers if xs_of[h["id"]]]
    parent = {h: h for h in order}

    def find(x: str) -> str:
        while parent[x] != x:
            x = parent[x]
        return x
    for u in units:
        ls = [h for h in links_of(u["eq"]) if h in parent]
        for h in ls[1:]:
            ra, rb = find(ls[0]), find(h)
            if ra != rb:
                parent[rb] = ra
    comps: dict[str, list[str]] = {}
    for h in order:
        comps.setdefault(find(h), []).append(h)

    out: dict[str, dict] = {}
    for h in order:
        comp = comps[find(h)]
        k, n = comp.index(h), len(comp)
        xs = xs_of[h]
        if n == 1:
            xm = sum(xs) / len(xs)
        else:
            allx = sorted({x for c in comp for x in xs_of[c]})
            x0, x1 = min(allx) - 0.45, max(allx) + 0.45
            xm = x0 + (k + 0.5) * (x1 - x0) / n
            xs = allx                                    # ortak enine kolektör: bütün nasoslar
        out[h] = {"y": base_y, "xm": xm, "xs": xs, "transverse": k == 0}
    return out


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
    pumpmod.configure(pa)
    cg = civil.cell_grid(g)
    civil.check_plan(g, cg)
    units, y_shift = pumpmod.layout(station, g, cg["centers"])
    if y_shift > 0:
        print(f"  yelpaze için pompa sıraları ve kolektör {y_shift:.2f} m geri çekildi")
    if len(units) > cg["n"]:
        raise ValueError(f"{len(units)} pompa var ama {cg['n']} hücre — her pompanın hücresi olmalı")
    pads = [pumpmod.footprint(u["eq"]["params"], u["x"], u["y"], u["side"], ground) for u in units]
    hdr_cfg = dict(g["headers"], y=g["headers"]["y"] + y_shift)
    hdr_lay = header_layout(by_type.get("header", []), units, hdr_cfg["y"])
    hdr_y_max = max((v["y"] for v in hdr_lay.values()), default=hdr_cfg["y"])

    # ---------------- Beton yapı (tek mesh) ---------------- #
    b = prim.Builder()
    civil.channel(g, b)
    civil.cells(g, b, cg)
    br = civil.bridge(g, b)
    if g["bridge"].get("gate_wall_t"):
        # Köprünün altı beton perde: kapak ve ızgara panellerinin yeri açık, yanları kapalı
        # (panel yoksa dolu perde)
        gates = by_type.get("slide_gate", [])
        op = intake.panel_opening(gates[0] if gates else None, bool(by_type.get("trash_rack")), g)
        civil.gate_wall(g, b, intake.wall_face_y(br), op)
        print(f"  giriş perdesi: {g['bridge']['gate_wall_t']:.2f} m beton, "
              + (f"açıklık x {op[0]:+.2f} … {op[1]:+.2f} (paneller), yanlar kapalı" if op else "açıklıksız"))
    civil.pump_pads(b, pads)
    ob = b.finish("STATIC__CIVIL")
    reg.structural(ob, "CIVIL")
    materials.assign(ob, mats["CONCRETE"])

    # ---------------- Bina + toprak ---------------- #
    bp = None
    if "building" in g:
        bp = bldmod.plan(g["building"], pa, g["channel"]["deck_el"], pads, hdr_y_max)
        bldmod.build(reg, mats, bp)
        print(f"  bina: {2 * bp['xo']:.1f} × {bp['y1'] - bp['y0']:.1f} m, taban {bp['floor']:.2f}, "
              f"saçak {bp['eave']:.2f}, mahya {bp['ridge']:.2f}")
    z_pipe = ground + pumpmod.axis_height(units[0]["eq"]["params"])
    by_id = {e["id"]: e for e in station["equipment"]}
    fm_offset = bp["fm_offset"] if bp else None
    pits = []
    if bp and "meter_pit" in g:
        # Ana hatlar binadan çıkınca toprağa girer; debimetreler binanın
        # arkasında toprağa gömülü, üstü açık beton kuyularda durur.
        # Ana hat x'i: kolektör yerleşiminden (tek kolektörde beslediği pompaların ortası).
        mp = g["meter_pit"]
        cy = bp["y1"] + mp["dist"]
        pits = bldmod.meter_pits(reg, mats, mp, [v["xm"] for v in hdr_lay.values()], cy,
                                 g["channel"]["deck_el"], z_pipe,
                                 max(piping.radius(by_id[h]["params"]["dn"]) for h in hdr_lay))
        fm_offset = cy - hdr_cfg["y"]
        print(f"  debimetre kuyusu: {len(pits)} adet, bina arkasından {mp['dist']:.1f} m")
    if "soil" in g:
        sb = bldmod.soil(reg, mats, g, cg, bp, g["soil"], pits)
        print(f"  toprak: x ±{sb['X']:.1f}, y {sb['y_a']:.1f} … {sb['y_b']:.1f}, taban {sb['z_bottom']:.2f}")
        if bp:
            # Ana hat bina duvarından çıkıp toprağın kesit yüzünde biter
            hdr_cfg["run_length"] = sb["y_b"] - hdr_cfg["y"]

    print(f"  hücre sırası: {cg['n']} hücre, {cg['total_w']:.2f} m; "
          f"kanal {abs(g['channel']['plan'][0][0]):.1f} m")
    for u in units:
        print(f"    {u['eq']['id']}  x={u['x']:+6.2f}  y={u['y']:5.2f}  "
              f"hücre x={u['cell_x']:+6.2f}  motor {'+X' if u['side'] > 0 else '-X'}")

    # ---------------- Pompa üniteleri + emme/basma hatları ---------------- #
    nrv_of = {e["source_pump"]: e for e in by_type.get("check_valve", [])}
    vlv_of = {e["interlock_pump"]: e for e in by_type.get("butterfly_valve", [])}
    built = {}
    for u in units:
        eq = u["eq"]
        prm = eq["params"]
        parts = pumpmod.build(reg, mats, eq, u["x"], u["y"], u["side"], ground,
                              piping.radius(prm["dn_suction"]), piping.radius(prm["dn_discharge"]))
        built[eq["id"]] = parts
        piping.suction_line(reg, mats, eq, u["cell_x"], cg["end_wall"], pa["riser_y"],
                            pa.get("suction_el"), parts["_suction_point"],
                            drop_y=-cg["depth"] / 2.0,
                            bell_z=g["channel"]["invert_el"] + pa.get("bell_clearance", 0.45))
        # Birden çok kolektöre basan nasosun (ortak hat) basma hattı en arkadaki kolektöre kadar
        # uzanır ve aradakileri keser; tek kolektörlüde kendi kolektörü (eskisi gibi).
        links = links_of(eq)
        y_dis = max(hdr_lay[h]["y"] for h in links if h in hdr_lay)
        r_hdr = piping.radius(by_id[eq["header"]]["params"]["dn"])
        p_nrv, p_vlv, r = piping.discharge_line(reg, mats, eq, parts["_discharge_point"],
                                                y_dis, r_hdr, with_nrv=eq["id"] in nrv_of)
        if eq["id"] in nrv_of:
            piping.check_valve(reg, mats, nrv_of[eq["id"]], p_nrv, r)
        if eq["id"] in vlv_of:
            piping.butterfly_valve(reg, mats, vlv_of[eq["id"]], p_vlv, r)
    print(f"  pompa üniteleri: {len(built)} adet")

    for hid, lay in hdr_lay.items():
        dy = lay["y"] - hdr_cfg["y"]                    # arka sıradaki kolektör: ana hat o kadar kısa
        xm = piping.header(reg, mats, by_id[hid], lay["xs"], lay["y"], z_pipe, hdr_cfg["run_length"] - dy,
                           fm_offset=None if fm_offset is None else fm_offset - dy,
                           xm=lay["xm"], transverse=lay["transverse"])
        print(f"  {hid}: {len(lay['xs'])} pompa, ana hat x={xm:+.2f}"
              + ("" if lay["transverse"] else " (ortak kolektörden çıkış)"))
    print(f"  armatür: {len(nrv_of)} çekvalf, {len(vlv_of)} vana")

    # ---------------- Kapak, ızgara, su ---------------- #
    for e in by_type.get("slide_gate", []):
        intake.slide_gate(reg, mats, e, g, br)
    for e in by_type.get("trash_rack", []):
        intake.trash_rack(reg, mats, e, g, br)
    cell_of = {u["eq"]["id"]: u["cell_x"] for u in units}
    for e in by_type.get("level_sensor", []):
        # Havuz tarafı: hücrenin ön kirişinde, hücrenin içine bakar; havuzdan
        # bakınca SAĞ köşede (+X, perdenin yanı). Horn yarıçapı 0,16 + 0,09 pay.
        intake.level_sensor(reg, mats, e, cell_of[e["source_pump"]] + cg["w"] / 2.0 - 0.25, g, cg)
    if by_type.get("level_sensor"):
        print(f"  seviye datçiği: {len(by_type['level_sensor'])} adet (hücre girişlerinde, havuz tarafı)")

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
