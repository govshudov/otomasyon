"""Broker'sız geliştirme yığını: API + simülatörler tek süreçte.

MQTT yerine yayıncı mesajları doğrudan API'nin `route()` fonksiyonuna gider;
arıza enjeksiyonu da doğrudan simülatöre. Yalnız bu makinede arayüzü canlı
veriyle denemek için (MQTT broker ve Docker gerekmez).

    python tools/devstack.py [--port 8000] [--speed 10] [--stations PS-01]
    npm --prefix web run dev -- --port 5199     # arayüz: http://localhost:5199

Geçmiş bellekte tutulur ve açılışta simülatör `--history-hours` saat geriye
doğru koşturularak doldurulur: grafikler üretilmiş rastgele eğri değil,
simülatörün tutarlı çıktısını gösterir (pompa durunca tok/Hz/kW gerçekten sıfır).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "api"), str(ROOT / "sim")]

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--speed", type=float, default=10.0)
ap.add_argument("--warmup", type=float, default=900.0, help="açılışta ilerletilecek sim saniyesi")
ap.add_argument("--stations", default="PS-01", help="simüle edilecek istasyonlar (virgüllü) ya da 'all'")
ap.add_argument("--history-hours", type=float, default=24.0, help="açılışta doldurulacak geçmiş (saat)")
args = ap.parse_args()

# memhistory ortam değişkenlerini içe aktarılırken okur — main'den ÖNCE
os.environ.setdefault("HISTORY_MODE", "memory")
os.environ.setdefault("HISTORY_SEED_DEMO", "0")          # rastgele tohum yerine simülatör geçmişi
os.environ.setdefault("HISTORY_WINDOW_MIN", str(int(max(args.history_hours, 2.0) * 60)))
os.environ.setdefault("HISTORY_MIN_INTERVAL_S", "20")
os.environ.setdefault("STATIONS_DIR", str(ROOT / "stations"))
os.environ.setdefault("TYPES_FILE", str(ROOT / "common/equipment_types.json"))

import main                                        # noqa: E402  (api/main.py)
from ingest import route                           # noqa: E402
from plant import Plant                            # noqa: E402
from publisher import DeadbandPublisher            # noqa: E402

PLANTS: dict[str, Plant] = {}


class Direct:
    """paho istemcisi yerine: mesajı doğrudan API deposuna (ve geçmişe) yönlendirir."""

    def publish(self, topic, payload, qos=0, retain=False):
        route(topic, payload.encode() if isinstance(payload, str) else payload,
              main.store, main.history)


class FaultSink:
    """aiomqtt istemcisi yerine: arıza komutunu doğrudan simülatöre verir."""

    async def publish(self, topic, payload, qos=0):
        sid = topic.split("/")[1]
        cmd = json.loads(payload)
        out = PLANTS[sid].inject(cmd["target"], cmd.get("component"), cmd["kind"],
                                 float(cmd.get("severity", 1.0)), cmd.get("duration_s"))
        print(f"[dev] ARIZA -> {out}", flush=True)


def backfill(pl: Plant, sid: str, hours: float, step: float = 10.0) -> int:
    """Simülatörü geçmiş pencere boyunca koşturup her örneği geçmişe yazar."""
    hist = main.history
    every = max(1, round(float(os.environ["HISTORY_MIN_INTERVAL_S"]) / step))
    now = time.time()
    n = int(hours * 3600 / step)
    t0 = now - n * step
    count = 0
    for i in range(n):
        pl.step(step)
        if i % every:
            continue
        samples = []
        for eq, d in pl.snapshot().items():
            for k, v in d["v"].items():
                if isinstance(v, bool):
                    samples.append((f"{sid}.{eq}.{k}", 1.0 if v else 0.0))
                elif isinstance(v, (int, float)):
                    samples.append((f"{sid}.{eq}.{k}", float(v)))
        hist.push(samples, int((t0 + i * step) * 1000))
        count += len(samples)
    return count


async def fake_mqtt(app):
    pubs = {}
    want = None if args.stations.lower() == "all" else {s.strip().upper() for s in args.stations.split(",")}
    for sid, cfg in main.STATIONS.items():
        if want and sid not in want:
            continue
        eq_types = {e["id"]: e["type"] for e in cfg["equipment"]}
        pl = Plant(cfg, seed=7)
        for _ in range(int(args.warmup)):
            pl.step(1.0)
        if args.history_hours > 0 and getattr(main.history, "enabled", False):
            t = time.time()
            n = await asyncio.to_thread(backfill, pl, sid, args.history_hours)
            print(f"[dev] {sid}: {args.history_hours:g} sa geçmiş simüle edildi "
                  f"({n:,} örnek, {time.time() - t:.1f} sn)", flush=True)
        pub = DeadbandPublisher(Direct(), sid, main.types, eq_types, random.Random(8))
        pub.publish_birth(list(eq_types), "dev")
        PLANTS[sid], pubs[sid] = pl, pub
    app.state.mqtt = FaultSink()
    print(f"[dev] {len(PLANTS)} istasyon canlı ({', '.join(PLANTS)}), hız x{args.speed}", flush=True)
    dt = 0.2
    while True:
        for sid, pl in PLANTS.items():
            pl.step(dt * args.speed)
            pubs[sid].publish_snapshot(pl.snapshot(), pl.dropouts())
        await asyncio.sleep(dt)


main.mqtt_task = fake_mqtt

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(main.app, host="127.0.0.1", port=args.port, log_level="warning")
