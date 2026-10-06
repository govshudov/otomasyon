#!/usr/bin/env python3
"""Pompa istasyonu simülatörü — MQTT giriş noktası.

Gerçek PLC gateway'i ile AYNI MQTT sözleşmesini konuşur (docs/MQTT-CONTRACT.md).
Devreye alma günü bu servis durur, gateway başlar; API ve frontend değişmez.

    python sim/main.py --station stations/ps-01.json --broker localhost --speed 10
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import paho.mqtt.client as mqtt

from plant import Plant
from publisher import DeadbandPublisher

VERSION = "0.1.0"
_running = True


def _stop(*_):
    global _running
    _running = False


def build_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Pompa istasyonu dijital ikiz simülatörü")
    ap.add_argument("--station", default=os.getenv("STATION_FILE", "stations/ps-01.json"))
    ap.add_argument("--types", default=os.getenv("TYPES_FILE", "common/equipment_types.json"))
    ap.add_argument("--broker", default=os.getenv("MQTT_HOST", "localhost"))
    ap.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    ap.add_argument("--speed", type=float, default=float(os.getenv("SIM_SPEED", "1.0")),
                    help="Zaman hızlandırma çarpanı (10 = 10x hızlı)")
    # Adım aralığı: 0,1 sn (10 Hz) fizik için gereğinden sık. Pi 4'te üç
    # simülatör birden çalışırken bu belirgin CPU yükü ve ısı demek.
    ap.add_argument("--dt", type=float, default=float(os.getenv("SIM_DT", "0.2")),
                    help="Duvar saati adım aralığı (s)")
    ap.add_argument("--pub-hz", type=float, default=float(os.getenv("PUB_HZ", "5")))
    ap.add_argument("--seed", type=int, default=int(os.getenv("SIM_SEED", "7")))
    ap.add_argument("--no-noise", action="store_true", help="Sensör gürültüsünü kapat")
    ap.add_argument("--degrade", type=float, default=float(os.getenv("DEGRADE_PER_HOUR", "0.0")),
                    help="Saatte kendiliğinden bozulma olasılığı (0.15 = demo için iyi)")
    ap.add_argument("--duration", type=float, default=0.0, help="Kaç saniye çalışsın (0 = sonsuz)")
    return ap.parse_args()


def main() -> int:
    a = build_args()
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    station = json.loads(Path(a.station).read_text(encoding="utf-8"))
    types = json.loads(Path(a.types).read_text(encoding="utf-8"))["types"]
    sid = station["station_id"]
    eq_types = {e["id"]: e["type"] for e in station["equipment"]}

    plant = Plant(station, seed=a.seed)
    rng = random.Random(a.seed + 1)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{sid}")
    client.will_set(f"twin/{sid}/death",
                    json.dumps({"ts": int(time.time() * 1000), "source": "sim"}),
                    qos=1, retain=True)

    pub = DeadbandPublisher(client, sid, types, eq_types, rng, noise=not a.no_noise)

    def on_connect(c, userdata, flags, rc, props=None):
        print(f"[sim] bağlandı: {a.broker}:{a.port}  rc={rc}", flush=True)
        c.subscribe(f"twin/{sid}/cmd/fault", qos=1)
        c.publish(f"twin/{sid}/death", "", qos=1, retain=True)   # eski death'i sil
        pub.publish_birth(list(eq_types), VERSION)

    def on_message(c, userdata, msg):
        try:
            cmd = json.loads(msg.payload.decode())
            out = plant.inject(cmd["target"], cmd.get("component"), cmd["kind"],
                               float(cmd.get("severity", 1.0)), cmd.get("duration_s"))
            print(f"[sim] ARIZA -> {out}", flush=True)
        except Exception as exc:                                  # noqa: BLE001
            print(f"[sim] geçersiz arıza komutu: {exc}", flush=True)

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(a.broker, a.port, keepalive=30)
    except OSError as exc:
        print(f"[sim] broker'a bağlanılamadı ({a.broker}:{a.port}): {exc}", file=sys.stderr)
        return 1
    client.loop_start()

    print(f"[sim] {sid} — {len(eq_types)} ekipman, hız x{a.speed}, "
          f"yayın {a.pub_hz} Hz, gürültü {'kapalı' if a.no_noise else 'açık'}", flush=True)

    pub_period = 1.0 / a.pub_hz
    next_pub = 0.0
    t0 = time.monotonic()
    next_tick = t0
    last_report = t0

    while _running:
        next_tick += a.dt
        plant.step(a.dt * a.speed)

        msg = plant.maybe_degrade(a.dt * a.speed, a.degrade)
        if msg:
            print(f"[sim] BOZULMA -> {msg}", flush=True)

        now = time.monotonic()
        if now >= next_pub:
            next_pub = now + pub_period
            pub.publish_snapshot(plant.snapshot(), plant.dropouts())

        if now - last_report >= 10.0:
            last_report = now
            running = sum(1 for p in plant.pumps.values() if p.is_running)
            print(f"[sim] t={plant.sim_time/3600:6.2f}h  seviye={plant.basin.level:.2f} m  "
                  f"giriş={plant.q_in:5.0f}  çıkış={plant.q_out:5.0f} m³/h  "
                  f"çalışan={running}  mesaj={pub.tx_count}", flush=True)

        if a.duration and (now - t0) >= a.duration:
            break

        delay = next_tick - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            next_tick = time.monotonic()      # geride kaldık, yetiş

    print("[sim] kapanıyor", flush=True)
    client.publish(f"twin/{sid}/death",
                   json.dumps({"ts": int(time.time() * 1000), "source": "sim"}),
                   qos=1, retain=True)
    time.sleep(0.3)
    client.loop_stop()
    client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
