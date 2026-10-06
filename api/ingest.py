"""MQTT topic yönlendirme — main.py ve testler aynı kodu kullanır."""
from __future__ import annotations

import json
import time


def route(topic: str, payload: bytes, store, history=None) -> str | None:
    """Bir MQTT mesajını depoya işler. Dönen: işlenen mesaj türü (veya None)."""
    parts = topic.split("/")
    if len(parts) < 3 or not payload:
        return None
    _, sid, *rest = parts
    try:
        data = json.loads(payload.decode() if isinstance(payload, (bytes, bytearray)) else payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None

    if rest[0] == "birth":
        store.sources[sid] = {**data, "alive": True}
        return "birth"
    if rest[0] == "death":
        store.sources.setdefault(sid, {})["alive"] = False
        return "death"
    if len(rest) < 2:
        return None

    equipment, kind = rest[0], rest[1]
    ts = data.get("ts", int(time.time() * 1000))
    if kind == "t":
        numeric = store.ingest_telemetry(sid, equipment, ts, data.get("v", {}))
        if history is not None:
            history.push(numeric, ts)
        return "telemetry"
    if kind == "s":
        prev = store.status.get(f"{sid}.{equipment}", {}).get("state")
        store.ingest_status(sid, equipment, data)
        if history is not None and data.get("state") != prev:
            return "status_changed"
        return "status"
    return None
