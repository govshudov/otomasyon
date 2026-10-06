"""Broker'sız geliştirme yığını: API + simülatörler tek süreçte.

MQTT yerine yayıncı mesajları doğrudan API'nin `route()` fonksiyonuna gider;
arıza enjeksiyonu da doğrudan simülatöre. Yalnız bu makinede arayüzü canlı
veriyle denemek için (MQTT broker ve Docker gerekmez).

    python tools/devstack.py [--port 8000] [--speed 10]
    npm --prefix web run dev -- --port 5199     # arayüz: http://localhost:5199
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "api"), str(ROOT / "sim")]
os.environ.setdefault("HISTORY_MODE", "memory")
os.environ.setdefault("STATIONS_DIR", str(ROOT / "stations"))
os.environ.setdefault("TYPES_FILE", str(ROOT / "common/equipment_types.json"))

import main                                        # noqa: E402  (api/main.py)
from ingest import route                           # noqa: E402
from plant import Plant                            # noqa: E402
from publisher import DeadbandPublisher            # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--speed", type=float, default=10.0)
ap.add_argument("--warmup", type=float, default=900.0, help="açılışta ilerletilecek sim saniyesi")
args = ap.parse_args()

PLANTS: dict[str, Plant] = {}


class Direct:
    """paho istemcisi yerine: mesajı doğrudan API deposuna yönlendirir."""

    def publish(self, topic, payload, qos=0, retain=False):
        route(topic, payload.encode() if isinstance(payload, str) else payload,
              main.store, None)


class FaultSink:
    """aiomqtt istemcisi yerine: arıza komutunu doğrudan simülatöre verir."""

    async def publish(self, topic, payload, qos=0):
        sid = topic.split("/")[1]
        cmd = json.loads(payload)
        out = PLANTS[sid].inject(cmd["target"], cmd.get("component"), cmd["kind"],
                                 float(cmd.get("severity", 1.0)), cmd.get("duration_s"))
        print(f"[dev] ARIZA -> {out}", flush=True)


async def fake_mqtt(app):
    pubs = {}
    for sid, cfg in main.STATIONS.items():
        eq_types = {e["id"]: e["type"] for e in cfg["equipment"]}
        pl = Plant(cfg, seed=7)
        for _ in range(int(args.warmup)):
            pl.step(1.0)
        pub = DeadbandPublisher(Direct(), sid, main.types, eq_types, random.Random(8))
        pub.publish_birth(list(eq_types), "dev")
        PLANTS[sid], pubs[sid] = pl, pub
    app.state.mqtt = FaultSink()
    print(f"[dev] {len(PLANTS)} istasyon canlı, hız x{args.speed}", flush=True)
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
