"""twin-map.json'daki sinyal tanımlarını katalogdan yeniler — Blender'sız.

Model (GLB) değişmeden yalnız sinyal kataloğu değiştiğinde modeli yeniden
üretmek gereksiz: düğümler, bileşenler ve kamera çerçeveleri aynı kalır.
Bu betik mevcut twin-map'in iskeletini korur, her ekipmanın `signals`
alanlarını `common/equipment_types.json`'dan `naming.build_twin_map` ile
AYNI kuralla yeniden yazar.

    python tools/genmodel/refresh_twin_map.py [PS-01 PS-02 ...]

Yazılan dosyalar: build/<id>-twin-map.json ve web/public/models/<id>-twin-map.json
(hangisi varsa).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TYPES = json.loads((ROOT / "common/equipment_types.json").read_text(encoding="utf-8"))["types"]


def refresh(tm: dict, cfg: dict) -> dict:
    sid = cfg["station_id"]
    by_id = {e["id"]: e for e in cfg["equipment"]}
    for eq_id, eq in tm["equipment"].items():
        tdef = TYPES.get(eq["type"], {})
        built = set(eq.get("components", {}))
        label = by_id.get(eq_id, {}).get("label", eq.get("label", eq_id))
        eq["label"] = label
        eq_signals: dict = {}
        for c in eq.get("components", {}).values():
            c["signals"] = {}
        for key, sd in tdef.get("signals", {}).items():
            entry = {"tag": f"{sid}.{eq_id}.{key}",
                     "label": sd.get("label", key), "unit": sd.get("unit"),
                     "type": sd.get("type", "float"), "range": sd.get("range"),
                     "alarms": sd.get("alarms", [])}
            if "." in key:
                comp, meas = key.split(".", 1)
                if comp in built:
                    eq["components"][comp]["signals"][meas] = entry
            else:
                eq_signals[key] = entry
        eq["signals"] = eq_signals
        for ck, c in eq.get("components", {}).items():
            if ck in tdef.get("components", {}):
                c["label"] = tdef["components"][ck].get("label", ck)
    return tm


def main(ids: list[str]) -> None:
    stations = {json.loads(p.read_text(encoding="utf-8"))["station_id"]: p
                for p in (ROOT / "stations").glob("*.json")}
    for sid in ids or sorted(stations):
        cfg = json.loads(stations[sid].read_text(encoding="utf-8"))
        low = sid.lower()
        for path in (ROOT / "build" / f"{low}-twin-map.json",
                     ROOT / "web/public/models" / f"{low}-twin-map.json"):
            if not path.exists():
                continue
            tm = refresh(json.loads(path.read_text(encoding="utf-8")), cfg)
            path.write_text(json.dumps(tm, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            n = sum(len(e["signals"]) + sum(len(c["signals"]) for c in e["components"].values())
                    for e in tm["equipment"].values())
            print(f"{path.relative_to(ROOT)}: {len(tm['equipment'])} ekipman, {n} sinyal")


if __name__ == "__main__":
    main([a.upper() for a in sys.argv[1:]])
