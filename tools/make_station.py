#!/usr/bin/env python3
"""İstasyon konfigürasyonu üreticisi.

Yeni bir istasyon = birkaç sayı. Elle 12 pompalık JSON yazmak hem sıkıcı hem
hatalı; buradan üretilir. Model üreticisi de bu dosyayı okur — yani yeni bir
tesis eklemek "yeni JSON üret + generate.py çalıştır" demek, modelleme işi değil.

    python3 tools/make_station.py --id PS-02 --pumps 12 --per-header 3

Her pompanın kendi emme hücresi vardır; hücreler başlık duvarı boyunca tek
sıra dizilir. Kanal planı hücre sırasının genişliğinden türetilir: dar giriş
kanalı → köprü → genişleme → ön havuz → dikey duvarlı hücre bölgesi.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def channel_plan(cells_w: float) -> list[list[float]]:
    """Hücre sırası genişliğinden kanal planı: [y, taban, üst] istasyonları."""
    inlet_b = round(max(4.0, min(6.0, cells_w * 0.35)), 2)
    inlet_t = round(inlet_b + 5.5, 2)
    fore_t = round(cells_w + 2.8, 2)
    return [
        [-30.0, inlet_b, inlet_t],
        [-21.0, inlet_b, inlet_t],
        [-11.0, round(max(inlet_b, cells_w - 2.7), 2), fore_t],
        [-6.0, round(cells_w - 1.4, 2), fore_t],
        [-4.0, round(cells_w, 2), round(cells_w, 2)],
        [0.0, round(cells_w, 2), round(cells_w, 2)],
    ]


def build(sid: str, name: str, n_pumps: int, per_header: int,
          motor_kw: float = 160.0, rated_flow: float = 900.0,
          rated_head: float = 45.0, split: list[int] | None = None,
          site: dict | None = None, members: list[list[int]] | None = None) -> dict:
    # members: kolektör başına pompa NUMARALARI (1'den), örn. [[1, 3, 5], [2, 4, 6]] — sıralı
    # olmayan bağlantı için (ayar dosyası). Verilmezse split: kolektör başına pompa SAYISI
    # (örn. [4, 3, 3]); o da verilmezse per_header'a göre eşit dağılım.
    if members is None:
        if split is None:
            split = [min(per_header, n_pumps - k) for k in range(0, n_pumps, per_header)]
        if sum(split) != n_pumps or min(split) < 1:
            raise SystemExit(f"kolektör dağılımı {split} toplamı {n_pumps} pompa olmalı")
        starts = [sum(split[:h]) for h in range(len(split))]
        members = [list(range(starts[h] + 1, starts[h] + split[h] + 1)) for h in range(len(split))]
    # Bir nasos birden çok kolektörde olabilir (ortak hat, ör. 1 Maý: N-1…N-7 → T-1/T-2/T-3).
    # Ana kolektör = nasosun geçtiği İLK liste (3D model, etiket "T-1 N-3"); hepsi "headers"a yazılır.
    flat = sorted(set(n for m in members for n in m))
    if flat != list(range(1, n_pumps + 1)) or any(not m for m in members) \
            or any(len(set(m)) != len(m) for m in members):
        raise SystemExit(f"kolektörlerdeki nasos numaraları {members}: 1..{n_pumps} her biri en az bir "
                         "kolektörde olmalı (bir kolektörde iki kez yazılmamalı)")
    n_headers = len(members)
    header_of = [None] * n_pumps
    headers_of: list[list[int]] = [[] for _ in range(n_pumps)]
    for h, m in enumerate(members):
        for n in m:
            if header_of[n - 1] is None:
                header_of[n - 1] = h
            headers_of[n - 1].append(h)

    # Her pompaya bir hücre; kanal planı hücre sırasının genişliğinden türer
    cell_w, pier = 2.0, 0.64
    cells_w = n_pumps * cell_w + (n_pumps - 1) * pier

    pumps, valves, nrvs, headers = [], [], [], []
    start_levels = [2.0 + i * 0.55 for i in range(n_pumps)]
    stop_levels = [1.4 + i * 0.16 for i in range(n_pumps)]

    for i in range(n_pumps):
        n = i + 1
        hid = f"HDR-{header_of[i] + 1:02d}"
        pumps.append(collections.OrderedDict([
            ("id", f"PMP-{n:02d}"), ("type", "pump_hsc"),
            ("label", f"T-{header_of[i] + 1} N-{n}"), ("header", hid),
            # birden çok kolektöre basabiliyorsa hepsi (tek kolektörlüde alan yazılmaz: dosya eskisiyle aynı)
            *([("headers", [f"HDR-{h + 1:02d}" for h in headers_of[i]])] if len(headers_of[i]) > 1 else []),
            ("layout", {"cell": i, "row": i % 2}),
            ("params", collections.OrderedDict([
                ("motor_kw", motor_kw), ("rated_flow_m3h", rated_flow),
                ("rated_head_m", rated_head), ("shutoff_head_m", rated_head * 1.29),
                ("rated_rpm", 1480), ("rated_current_a", round(motor_kw * 1.75)),
                ("voltage_v", 400), ("cos_phi", 0.87), ("vfd", True),
                ("min_speed_pct", 85.0), ("dn_suction", 400), ("dn_discharge", 350),
                ("bep_flow_m3h", rated_flow), ("bep_efficiency_pct", 84.0),
                ("min_run_s", 180), ("min_stop_s", 120),
                ("start_ramp_s", 12), ("stop_ramp_s", 10),
                ("discharge_el_m", 41.0), ("centerline_el_m", 4.0)])),
            ("control", {"start_level_m": round(start_levels[i], 2),
                         "stop_level_m": round(stop_levels[i], 2), "duty_order": n}),
        ]))
        valves.append(collections.OrderedDict([
            ("id", f"VLV-{n:02d}"), ("type", "butterfly_valve"),
            ("label", f"N-{n} basyş klapany"), ("interlock_pump", f"PMP-{n:02d}"),
            ("params", {"dn": 350, "travel_s": 25})]))
        nrvs.append(collections.OrderedDict([
            ("id", f"NRV-{n:02d}"), ("type", "check_valve"),
            ("label", f"N-{n} gaýtarmaýan klapan"), ("source_pump", f"PMP-{n:02d}"),
            ("params", {"dn": 350})]))

    for h in range(n_headers):
        ids = [f"PMP-{n:02d}" for n in sorted(members[h])]
        headers.append(collections.OrderedDict([
            ("id", f"HDR-{h+1:02d}"), ("type", "header"),
            ("label", f"T-{h+1} esasy turba"),
            ("params", {"dn": 600, "length_m": 180.0, "static_head_m": 38.0,
                        "roughness_c": 130, "pumps": ids})]))

    return collections.OrderedDict([
        ("station_id", sid), ("name", name),
        ("description", f"{n_pumps} nasosly, {n_headers} basyş liniýaly suw göteriji beket"),
        ("schema_version", "0.1.0"),
        *([("site", site)] if site else []),
        ("units", {"length": "m", "flow": "m3h", "pressure": "bar",
                   "temp": "C", "vib": "mm/s"}),
        ("geometry", collections.OrderedDict([
            ("channel", {"invert_el": 0.0, "deck_el": 6.5, "wall_t": 0.9, "base_t": 0.9,
                         "plan": channel_plan(cells_w)}),
            ("cells", {"count": n_pumps, "width": cell_w, "pier": pier, "depth": 2.3,
                       "front_beam": 0.6, "slab_t": 0.5, "end_wall": 1.0}),
            ("bridge", {"y": -21.6, "width": 1.3, "thickness": 0.6}),
            ("pump_area", {"ground_el": 6.5, "pitch": 3.8, "group_gap": 1.2,
                           "rows": [7.8, 9.4], "riser_y": 1.6, "suction_el": 2.2}),
            ("headers", {"y": 13.4, "run_length": 22.0}),
        ])),
        ("hydraulics", collections.OrderedDict([
            ("basin", {"invert_el": 0.0, "llwl": 0.8, "lwl": 1.2, "hwl": 5.5,
                       "hhwl": 5.9, "max_el": 6.0, "design_level": 3.2}),
            ("inflow", {"base_m3h": round(n_pumps * rated_flow * 0.6),
                        "diurnal_amp_m3h": round(n_pumps * rated_flow * 0.26),
                        "diurnal_peak_hour": 9.0,
                        "noise_m3h": round(n_pumps * 20),
                        "storm_probability_per_hour": 0.02}),
        ])),
        ("equipment", [
            collections.OrderedDict([("id", "BASIN-01"), ("type", "basin"),
                                     ("label", "Sorujy howuz")]),
            collections.OrderedDict([("id", "RACK-01"), ("type", "trash_rack"),
                                     ("label", "Giriş panjarasy"),
                                     ("params", {"clean_trigger_dp_m": 0.25,
                                                 "clean_duration_s": 240})]),
            collections.OrderedDict([("id", "GATE-01"), ("type", "slide_gate"),
                                     ("label", "Giriş gapagy"),
                                     ("params", {"width": 2.0, "height": 3.0,
                                                 "travel_s": 90, "bay": 1})]),
            *headers, *pumps, *valves, *nrvs,
        ]),
    ])


GENERATED = {"basin", "trash_rack", "slide_gate", "header", "pump_hsc", "butterfly_valve", "check_valve"}


def from_ayar(path: Path, yeniden: bool) -> int:
    """Ayar dosyasından (ayarlar/<istasyon>.json) stations/<id>.json.

    Dosya yoksa üretir. Varsa yalnız denetler: nasos/kolektör eşlemesi ayarla aynı mı.
    --yeniden: ekipman ayardan yeniden üretilir; elle ayarlanmış geometry, hydraulics ve
    üreticinin bilmediği ekipman (ör. LT seviye datçikleri) korunur.
    """
    a = json.loads(path.read_text(encoding="utf-8"))
    sid = a["id"]
    members = [sorted(int(n) for n in k["nasoslar"]) for k in a["kolektorler"]]
    n_pumps = len({n for m in members for n in m})       # bir nasos birden çok kolektörde olabilir
    out = ROOT / f"stations/{sid.lower()}.json"
    # nasos → bağlanabildiği kolektörler (ayardaki sırayla; ilki ana kolektör)
    want: dict[str, list[str]] = {}
    for h, m in enumerate(members):
        for n in m:
            want.setdefault(f"PMP-{n:02d}", []).append(f"HDR-{h + 1:02d}")

    old = json.loads(out.read_text(encoding="utf-8"), object_pairs_hook=collections.OrderedDict) if out.exists() else None
    if old is not None and not yeniden:
        have = {e["id"]: e.get("headers") or [e.get("header")] for e in old["equipment"] if e["type"] == "pump_hsc"}
        diff = [f"  {p}: dosyada {','.join(have.get(p) or ['YOK'])}, ayarda {','.join(h)}"
                for p, h in sorted(want.items()) if have.get(p) != h]
        diff += [f"  {p}: dosyada var, ayarda YOK" for p in sorted(have) if p not in want]
        if diff:
            print(f"{out.relative_to(ROOT)} ayarla UYUŞMUYOR:\n" + "\n".join(diff))
            print("Ekipmanı ayardan yeniden üretmek için: make istasyon YENIDEN=1 "
                  "(geometri ve elle eklenen ekipman korunur; 3D modeli de yeniden üretin)")
            return 1
        print(f"{out.relative_to(ROOT)} ayarla uyumlu ({n_pumps} nasos, {len(members)} kolektör) — değişiklik yok")
        return 0

    n = a.get("nasos", {})
    cfg = build(sid, a.get("ad") or "Suw göteriji beket", n_pumps, 3,
                motor_kw=float(n.get("motor_kw", 160.0)), rated_flow=float(n.get("debi_m3h", 900.0)),
                rated_head=float(n.get("basys_m", 45.0)), members=members)
    for h, k in enumerate(a["kolektorler"]):
        if k.get("ad"):
            next(e for e in cfg["equipment"] if e["id"] == f"HDR-{h + 1:02d}")["label"] = k["ad"]
    if old is not None:
        for key in ("geometry", "hydraulics"):
            if key in old:
                cfg[key] = old[key]
        extra = [e for e in old["equipment"] if e["type"] not in GENERATED]
        cfg["equipment"].extend(extra)
        print(f"korunan: geometry, hydraulics, {len(extra)} ek ekipman")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}  —  {n_pumps} nasos, {len(members)} kolektör: "
          + ", ".join(f"HDR-{h + 1:02d}={m}" for h, m in enumerate(members)))
    return 0


def main() -> int:
    if "--ayar" in sys.argv:
        i = sys.argv.index("--ayar")
        return from_ayar(Path(sys.argv[i + 1]).resolve(), "--yeniden" in sys.argv)

    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", default=None)
    ap.add_argument("--pumps", type=int, required=True)
    ap.add_argument("--per-header", type=int, default=3)
    ap.add_argument("--kolektor", default=None,
                    help="kolektör başına pompa sayısı, virgülle (örn. 4,3,3); --per-header yerine")
    ap.add_argument("--niagara", default=None,
                    help="Niagara istasyon adı (sabit, örn. YASYLDEPE); kurulum betiği bunu denetler")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    split = [int(x) for x in a.kolektor.split(",")] if a.kolektor else None
    site = None
    if a.niagara:
        site = collections.OrderedDict([
            ("niagara_station", a.niagara),
            ("db", {"host": "localhost", "port": 5432, "name": "Niagara"}),
            ("retention_years", 5), ("compress_after_days", 7)])
    cfg = build(a.id, a.name or "Suw göteriji beket", a.pumps, a.per_header, split=split, site=site)
    out = Path(a.out or ROOT / f"stations/{a.id.lower()}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n = len(cfg["equipment"])
    n_hdr = sum(1 for e in cfg["equipment"] if e["type"] == "header")
    print(f"{out}  —  {a.pumps} pompa, {n_hdr} kolektör, "
          f"{a.pumps} hücre, {n} ekipman")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
