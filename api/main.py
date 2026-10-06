"""Dijital ikiz API'si.

MQTT'yi dinler, anlık değer deposunu besler, alarm kurallarını işletir ve
frontend'e WebSocket üzerinden toplu (batched) delta gönderir.

Frontend bu API'ye bakar — simülatör mü gerçek PLC mi olduğunu bilmez.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import aiomqtt
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from alarms import AlarmEngine
from history import History
from ingest import route

# Geçmiş sağlayıcısı: `db` kalıcı (PLC fazı), `memory` bellekte (demo),
# `off` kapalı. İkisi de aynı arayüzü uygular; API ve arayüz farkı görmez.
HISTORY_MODE = os.getenv("HISTORY_MODE", "db").lower()
from store import TagStore

ROOT = Path(__file__).resolve().parent.parent
STATIONS_DIR = Path(os.getenv("STATIONS_DIR", ROOT / "stations"))
TYPES_FILE = Path(os.getenv("TYPES_FILE", ROOT / "common/equipment_types.json"))
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
BROADCAST_HZ = float(os.getenv("BROADCAST_HZ", "5"))
ALARM_HZ = float(os.getenv("ALARM_HZ", "2"))

# Dizindeki tüm istasyon konfigürasyonları yüklenir. Bir tesiste birden çok
# terfi merkezi olması kural, istisna değil.
STATIONS: dict[str, dict] = {}
for f in sorted(STATIONS_DIR.glob("*.json")):
    cfg = json.loads(f.read_text(encoding="utf-8"))
    STATIONS[cfg["station_id"]] = cfg
if not STATIONS:
    raise RuntimeError(f"{STATIONS_DIR} içinde istasyon konfigürasyonu yok")
types = json.loads(TYPES_FILE.read_text(encoding="utf-8"))["types"]
DEFAULT_STATION = next(iter(STATIONS))

store = TagStore()
alarms = AlarmEngine()
if HISTORY_MODE == "memory":
    from memhistory import MemoryHistory
    history = MemoryHistory()
else:
    history = History()


# --------------------------------------------------------------------------- #
# WebSocket dağıtımı
# --------------------------------------------------------------------------- #

class Hub:
    """Her bağlantı TEK bir istasyona abonedir.

    Üç istasyonun deltasını hepsine göndermek Pi'de boşuna ağ ve JSON ayrıştırma
    yükü demek. İstemci bağlanırken hangi istasyona baktığını söyler.
    """

    def __init__(self) -> None:
        self.clients: dict[WebSocket, str] = {}

    async def accept(self, ws: WebSocket) -> None:
        """Bağlantıyı kabul eder ama HENÜZ kaydetmez.

        Kayıt, ilk snapshot gönderildikten sonra yapılır. Aksi halde dağıtım
        görevi araya girip snapshot'tan ÖNCE bir delta gönderebiliyor —
        istemci eksik bir tabloyla başlıyor. (Ölçüldü: testte rastgele patlıyordu.)
        """
        await ws.accept()

    def register(self, ws: WebSocket, station: str) -> None:
        self.clients[ws] = station

    def set_station(self, ws: WebSocket, station: str) -> None:
        if ws in self.clients:
            self.clients[ws] = station

    def drop(self, ws: WebSocket) -> None:
        self.clients.pop(ws, None)

    def stations_in_use(self) -> set[str]:
        return set(self.clients.values())

    async def broadcast(self, msg: dict, station: str | None = None) -> None:
        """station verilirse yalnız o istasyona bakan istemcilere gider."""
        if not self.clients:
            return
        raw = json.dumps(msg, separators=(",", ":"))
        dead = []
        for ws, sid in list(self.clients.items()):
            if station and sid != station:
                continue
            try:
                await ws.send_text(raw)
            except Exception:                                     # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.drop(ws)


hub = Hub()


# --------------------------------------------------------------------------- #
# Arka plan görevleri
# --------------------------------------------------------------------------- #

async def mqtt_task(app: FastAPI) -> None:
    """MQTT dinleyicisi. Kopunca üstel geri çekilmeyle yeniden bağlanır."""
    backoff = 1.0
    while True:
        try:
            async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT,
                                      identifier="twin-api") as client:
                app.state.mqtt = client
                await client.subscribe("twin/#", qos=1)
                print(f"[api] MQTT bağlandı {MQTT_HOST}:{MQTT_PORT}", flush=True)
                backoff = 1.0
                async for message in client.messages:
                    kind = route(str(message.topic), message.payload, store, history)
                    if kind == "status_changed":
                        parts = str(message.topic).split("/")
                        st = store.status.get(f"{parts[1]}.{parts[2]}", {})
                        await history.log_status(parts[1], parts[2],
                                                 st.get("state", "UNKNOWN"), st.get("mode", "AUTO"))
        except Exception as exc:                                  # noqa: BLE001
            app.state.mqtt = None
            print(f"[api] MQTT koptu ({exc}); {backoff:.0f} sn sonra yeniden", flush=True)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def alarm_task() -> None:
    period = 1.0 / ALARM_HZ
    while True:
        await asyncio.sleep(period)
        changed = alarms.evaluate(store, period)
        for a in changed:
            payload = {"type": "alarm", "alarm": _alarm_dict(a)}
            await hub.broadcast(payload, station=a.station)
            await history.log_alarm(payload["alarm"])


def _split_by_station(delta: dict, stations: set[str]) -> dict[str, dict]:
    """Tek bir deltayı istasyonlarına ayırır. Tag biçimi: `PS-01.PMP-01.flow_m3h`."""
    out: dict[str, dict] = {s: {} for s in stations}
    for key in ("values", "status"):
        for tag, v in (delta.get(key) or {}).items():
            sid = tag.split(".", 1)[0]
            if sid in out:
                out[sid].setdefault(key, {})[tag] = v
    for tag in delta.get("stale") or []:
        sid = tag.split(".", 1)[0]
        if sid in out:
            out[sid].setdefault("stale", []).append(tag)
    return out


async def broadcast_task() -> None:
    period = 1.0 / BROADCAST_HZ
    while True:
        await asyncio.sleep(period)
        if not hub.clients:
            store.take_delta()          # birikmesin
            continue
        delta = store.take_delta()
        if not delta:
            continue
        for sid, part in _split_by_station(delta, hub.stations_in_use()).items():
            if not part:
                continue
            part["type"] = "delta"
            part["health"] = alarms.health_by_equipment(sid)
            part["component_health"] = alarms.health_by_component(sid)
            await hub.broadcast(part, station=sid)


def _alarm_dict(a) -> dict:
    from dataclasses import asdict
    return asdict(a)


@asynccontextmanager
async def lifespan(app: FastAPI):
    n = alarms.load(list(STATIONS.values()), types)
    for sid, cfg in STATIONS.items():
        print(f"[api] {sid}: {len(cfg['equipment'])} ekipman — {cfg.get('name','')}", flush=True)
    print(f"[api] toplam {n} alarm kuralı, varsayılan istasyon {DEFAULT_STATION}", flush=True)
    await history.connect()

    # Demo tohumlaması ARKA PLANDA. Açılışta senkron yapılınca API ~35 sn
    # cevap vermiyordu ve kiosk onu beklediği için ekran geç geliyordu.
    # Arka planda çalışınca API hemen açılır, geçmiş birkaç saniye içinde dolar.
    async def _seed() -> None:
        if HISTORY_MODE != "memory":
            return
        if os.getenv("HISTORY_SEED_DEMO", "1") in ("0", "false", "no"):
            return
        from memhistory import seed_demo
        t0 = time.time()
        # Olay döngüsünü bloklamamak için ayrı iş parçacığında
        n = await asyncio.to_thread(seed_demo, history, STATIONS, types)
        print("[api] " + "!" * 60, flush=True)
        print(f"[api] DEMO TOHUMLAMASI: {n:,} üretilmiş geçmiş noktası "
              f"({time.time() - t0:.1f} sn).", flush=True)
        print("[api] Bu veri ÖLÇÜM DEĞİLDİR. Gerçek PLC'ye geçerken", flush=True)
        print("[api] HISTORY_SEED_DEMO=0 yapılmalı.", flush=True)
        print("[api] " + "!" * 60, flush=True)

    tasks = [asyncio.create_task(t) for t in
             (mqtt_task(app), alarm_task(), broadcast_task(),
              history.flush_loop(), history.retention_loop(), _seed())]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await history.flush()


app = FastAPI(title="Su Yapısı Dijital İkiz API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------- #
# REST
# --------------------------------------------------------------------------- #

@app.get("/api/health")
async def health(station: str | None = None):
    sid = station or DEFAULT_STATION
    src = store.sources.get(sid, {})
    return {"ok": True, "station": sid, "stations": list(STATIONS),
            "tags": sum(1 for t in store.values if t.startswith(sid + ".")),
            "tags_total": len(store.values),
            "clients": len(hub.clients), "source_alive": src.get("alive", False),
            "source": src.get("source"), "history": history.enabled, "history_mode": HISTORY_MODE,
            "history_persistent": getattr(history, "persistent", True),
            "history_seeded": HISTORY_MODE == "memory" and
                              os.getenv("HISTORY_SEED_DEMO", "1") not in ("0", "false", "no"),
            "history_written": history.written, "rules": len(alarms.rules)}


@app.get("/api/stations")
async def list_stations():
    """Arayüzün istasyon seçicisi bunu okur. Model dosyaları ada göre türetilir."""
    out = []
    for sid, cfg in STATIONS.items():
        src = store.sources.get(sid, {})
        pumps = sum(1 for e in cfg["equipment"] if e["type"] == "pump_hsc")
        headers = sum(1 for e in cfg["equipment"] if e["type"] == "header")
        out.append({
            "id": sid, "name": cfg.get("name", sid),
            "description": cfg.get("description", ""),
            "pumps": pumps, "headers": headers,
            "cells": cfg["geometry"]["cells"]["count"],
            "equipment": len(cfg["equipment"]),
            "model": f"/models/{sid.lower()}.glb",
            "twin_map": f"/models/{sid.lower()}-twin-map.json",
            "source_alive": src.get("alive", False),
            "alarms": len(alarms.active(sid)),
        })
    return {"stations": out, "default": DEFAULT_STATION}


@app.get("/api/station/{sid}")
async def get_station(sid: str):
    if sid not in STATIONS:
        raise HTTPException(404, f"istasyon yok: {sid}")
    return STATIONS[sid]


@app.get("/api/types")
async def get_types():
    return types


@app.get("/api/snapshot")
async def snapshot(station: str | None = None):
    sid = station or DEFAULT_STATION
    s = store.snapshot(sid)
    s["alarms"] = alarms.active(sid)
    s["health"] = alarms.health_by_equipment(sid)
    s["component_health"] = alarms.health_by_component(sid)
    s["station"] = STATIONS.get(sid)
    return s


@app.get("/api/alarms")
async def get_alarms(station: str | None = None):
    a = alarms.active(station)
    return {"active": a, "count": len(a)}


@app.post("/api/alarms/{alarm_id}/ack")
async def ack_alarm(alarm_id: str, by: str = "operator"):
    a = alarms.ack(alarm_id, by)
    if not a:
        raise HTTPException(404, "alarm bulunamadı")
    await hub.broadcast({"type": "alarm", "alarm": _alarm_dict(a)}, station=a.station)
    return _alarm_dict(a)


@app.post("/api/alarms/ack-all")
async def ack_all(by: str = "operator", station: str | None = None):
    acked = [a for a in alarms.ack_all(by) if not station or a.station == station]
    for a in acked:
        await hub.broadcast({"type": "alarm", "alarm": _alarm_dict(a)}, station=a.station)
    return {"acked": len(acked)}


@app.get("/api/history")
async def get_history(tag: list[str] = Query(...), minutes: float = 60.0, buckets: int = 600,
                      start: float | None = None, end: float | None = None):
    """Kovalara indirgenmiş geçmiş. Aralık ya `minutes` (şimdiye kadar) ya da
    `start`/`end` (epoch sn) — grafiklerin zaman seçicisi ikincisini kullanır."""
    t1 = end if end is not None else time.time()
    t0 = start if start is not None else t1 - minutes * 60.0
    return await history.query(tag, t0, t1, max(1, min(buckets, 2000)))


@app.get("/api/history/range")
async def history_range():
    """Kayıtlı geçmişin sınırları — zaman çubuğunun uçları."""
    return await history.range()


@app.get("/api/history/at")
async def history_at(ts: float, lookback: float = 900.0, station: str | None = None):
    """Geçmişteki bir andaki tam görüntü — oynatma bunu kullanır.

    İstasyon filtresi ŞART: ekipman kimlikleri istasyonlar arasında tekrarlanır
    (her tesiste PMP-01 vardır). Filtresiz dönen görüntüde üç istasyonun verisi
    karışıyor ve arayüz yanlış ekipmanı gösteriyordu.
    """
    snap = await history.snapshot_at(ts, lookback)
    if station:
        pre = station + "."
        snap["values"] = {k: v for k, v in snap["values"].items() if k.startswith(pre)}
        snap["status"] = {k: v for k, v in snap["status"].items() if k.startswith(pre)}
    snap["ts"] = ts
    return snap


@app.post("/api/dev/fault")
async def inject_fault(body: dict, station: str | None = None):
    """Geliştirme/demo aracı — simülatöre arıza enjekte eder. Sahada kapatılacak."""
    client = getattr(app.state, "mqtt", None)
    if client is None:
        raise HTTPException(503, "MQTT bağlı değil")
    sid = station or body.pop("station", None) or DEFAULT_STATION
    if sid not in STATIONS:
        raise HTTPException(404, f"istasyon yok: {sid}")
    await client.publish(f"twin/{sid}/cmd/fault", json.dumps(body), qos=1)
    return {"sent": body, "station": sid}


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #

async def _send_snapshot(ws: WebSocket, sid: str) -> None:
    snap = store.snapshot(sid)
    snap.update({"type": "snapshot", "alarms": alarms.active(sid),
                 "health": alarms.health_by_equipment(sid),
                 "component_health": alarms.health_by_component(sid),
                 "station": STATIONS.get(sid)})
    await ws.send_text(json.dumps(snap, separators=(",", ":")))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, station: str | None = None):
    sid = station if station in STATIONS else DEFAULT_STATION
    await hub.accept(ws)
    try:
        await _send_snapshot(ws, sid)     # önce tam görüntü…
        hub.register(ws, sid)             # …sonra delta akışına kaydol
        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "subscribe":
                # İstasyon değiştirme: sayfa yenilemeden başka tesise geç
                new = msg.get("station")
                if new in STATIONS:
                    sid = new
                    hub.set_station(ws, sid)
                    await _send_snapshot(ws, sid)
            elif kind == "ack":
                a = alarms.ack(msg["alarm_id"], msg.get("by", "operator"))
                if a:
                    await hub.broadcast({"type": "alarm", "alarm": _alarm_dict(a)}, station=a.station)
            elif kind == "ack_all":
                for a in alarms.ack_all(msg.get("by", "operator")):
                    await hub.broadcast({"type": "alarm", "alarm": _alarm_dict(a)}, station=a.station)
            elif kind == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
    except (WebSocketDisconnect, json.JSONDecodeError, KeyError):
        pass
    finally:
        hub.drop(ws)


_static = Path(__file__).parent / "static"
if _static.is_dir():
    app.mount("/debug", StaticFiles(directory=_static, html=True), name="debug")

    @app.get("/")
    async def index():
        return FileResponse(_static / "index.html")
