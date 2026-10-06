#!/usr/bin/env python3
"""Ayakta duran yığının uçtan uca doğrulaması.

Konteynerler → API → WebSocket → arıza enjeksiyonu → alarm → onay.
Harici bağımlılık yok: WebSocket istemcisi ham soketle yazıldı (frontend'in
kritik yolu bu, mutlaka test edilmeli).
"""
from __future__ import annotations

import base64, json, os, socket, subprocess, sys, time, urllib.error, urllib.request

API = os.getenv("API", "http://localhost:8000")
SID = "PS-01"
fails: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  {'✓' if cond else '✗'} {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)
    return cond


def get(path: str):
    with urllib.request.urlopen(API + path, timeout=6) as r:
        return json.load(r)


def post(path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(API + path, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=6) as r:
        return json.load(r)


# --------------------------------------------------------------------------- #
# Bağımlılıksız minimal WebSocket istemcisi
# --------------------------------------------------------------------------- #

class WS:
    def __init__(self, host: str, port: int, path: str = "/ws"):
        self.s = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("el sıkışma sırasında bağlantı kapandı")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b"101" not in head.split(b"\r\n")[0]:
            raise ConnectionError(f"yükseltme reddedildi: {head.splitlines()[0]!r}")

    def _need(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("bağlantı kapandı")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self, timeout: float = 5.0) -> dict:
        self.s.settimeout(timeout)
        b0, b1 = self._need(2)
        opcode = b0 & 0x0F
        masked = b1 & 0x80
        length = b1 & 0x7F
        if length == 126:
            length = int.from_bytes(self._need(2), "big")
        elif length == 127:
            length = int.from_bytes(self._need(8), "big")
        mask = self._need(4) if masked else b""
        payload = self._need(length)
        if masked:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if opcode == 0x8:
            raise ConnectionError("sunucu close gönderdi")
        return json.loads(payload.decode())

    def send(self, obj: dict) -> None:
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        masked = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        n = len(data)
        header = b"\x81" + (bytes([0x80 | n]) if n < 126 else b"\xfe" + n.to_bytes(2, "big"))
        self.s.sendall(header + mask + masked)

    def close(self) -> None:
        try:
            self.s.close()
        except OSError:
            pass


# --------------------------------------------------------------------------- #

def main() -> int:
    print("\n[1] Konteynerler")
    for c in ("twin-mqtt", "twin-db", "twin-api", "twin-sim", "twin-sim-ps02", "twin-sim-ps03"):
        st = subprocess.run(["docker", "inspect", "-f", "{{.State.Status}}", c],
                            capture_output=True, text=True).stdout.strip()
        check(c, st == "running", st or "yok")

    print("\n[2] API sağlık")
    try:
        h = get(f"/api/health?station={SID}")
    except (urllib.error.URLError, TimeoutError) as exc:
        check("API yanıt veriyor", False, str(exc))
        return 1
    check("simülatör canlı", h["source_alive"], h.get("source"))
    check("tag akıyor", h["tags"] > 150, f"{h['tags']} tag")
    check("alarm kuralları yüklü", h["rules"] > 100, f"{h['rules']} kural")
    check("TimescaleDB yazıyor", h["history"] and h["history_written"] > 0,
          f"{h['history_written']} örnek")

    print("\n[3] Anlık görüntü tutarlı mı?")
    snap = get(f"/api/snapshot?station={SID}")
    v = snap["values"]
    lvl = v.get(f"{SID}.BASIN-01.level_m", {}).get("v")
    running = sorted(k.split(".")[1] for k, s in snap["status"].items()
                     if s["state"] == "RUNNING" and ".PMP-" in k)
    check("havuz seviyesi geçerli", lvl is not None and 0.5 < lvl < 6.4,
          f"{lvl:.2f} m" if lvl else "yok")
    check("pompa çalışıyor", len(running) >= 1, ", ".join(running) or "hiç")
    check("bileşen seviyeli tag var",
          any(k.endswith(".MOTOR.t1") for k in v) and any(k.endswith(".PUMP.bearing1") for k in v),
          f"{sum(k.endswith('.MOTOR.t1') for k in v)} motor sıcaklığı tag'i")

    print("\n[4] WebSocket canlı akışı (frontend'in kritik yolu)")
    ws = None
    try:
        ws = WS("localhost", 8000, f"/ws?station={SID}")
        first = ws.recv(8.0)
        check("ilk mesaj snapshot", first.get("type") == "snapshot", first.get("type"))
        check("snapshot istasyon konfigürasyonunu taşıyor",
              first.get("station", {}).get("station_id") == SID,
              f"{len(first.get('station', {}).get('equipment', []))} ekipman")
        deltas, t0 = 0, time.time()
        while deltas < 3 and time.time() - t0 < 8:
            m = ws.recv(8.0)
            if m.get("type") == "delta":
                deltas += 1
        check("delta akıyor", deltas >= 3, f"{deltas} delta / {time.time()-t0:.1f} sn")
        ws.send({"type": "ping"})
        t0 = time.time()
        while time.time() - t0 < 5:
            if ws.recv(5.0).get("type") == "pong":
                check("çift yönlü iletişim (ping/pong)", True)
                break
        else:
            check("çift yönlü iletişim (ping/pong)", False, "pong gelmedi")
    except (ConnectionError, OSError, TimeoutError, json.JSONDecodeError) as exc:
        check("WebSocket", False, f"{type(exc).__name__}: {exc}")
    finally:
        if ws:
            ws.close()

    print("\n[5] Arıza enjeksiyonu → alarm zinciri")
    if not running:
        check("test edilecek çalışan pompa var", False)
        return 1
    target = running[0]
    comp = "MOTOR"
    # severity 1.0 -> hedef sıcaklık 25 + 85*(I/In)² + 85: I/In 0,6..0,9 aralığında
    # 141..179 °C — 130 °C alarm eşiğinin üstünde, 180 °C motor korumasının altında.
    post("/api/dev/fault", {"target": target, "component": comp,
                            "kind": "overheat", "severity": 1.0})
    print(f"  … {target}/{comp} ısıtılıyor, alarm bekleniyor (sim 20x)")
    hit, t0 = [], time.time()
    while time.time() - t0 < 150:
        time.sleep(2)
        hit = [a for a in get(f"/api/alarms?station={SID}")["active"]
               if a["equipment"] == target and a["component"] == comp]
        if any(a["level"] == "ALARM" for a in hit):
            break
    check("alarm doğdu", bool(hit), f"{time.time()-t0:.0f} sn sonra")
    for a in hit:
        print(f"      {a['level']:5s} {a['state']:10s} {a['value']:6.1f} °C  {a['msg']}")
    check("ALARM seviyesine yükseldi", any(a["level"] == "ALARM" for a in hit))

    ch = get(f"/api/snapshot?station={SID}")["component_health"]
    # Anahtarlar istasyonla nitelenmiş: ekipman kimlikleri istasyonlar arasında
    # tekrarlandığı için `PMP-01/...` tek başına belirsiz olurdu.
    key = f"{SID}.{target}/{comp}"
    check("bileşen sağlığı istasyon+düğüm adıyla eşleşiyor", ch.get(key) == "ALARM",
          f"{key} = {ch.get(key)}")
    # Not: simülatörde kendiliğinden bozulma (DEGRADE_PER_HOUR) açık olabilir, o yüzden
    # "başka hiçbir şey işaretli değil" demek yanlış olur. Anlamlı kontrol şudur:
    # işaretli HER bileşenin arkasında gerçekten aktif bir alarm var mı (hayalet yok mu)?
    active = {(f'{a["station"]}.{a["equipment"]}', a["component"])
              for a in get(f"/api/alarms?station={SID}")["active"]
              if a["component"] and a["state"] in ("UNACK_ALM", "ACKED_ALM")}
    phantom = [k for k in ch if tuple(k.split("/", 1)) not in active]
    check("işaretli her bileşenin arkasında aktif alarm var (hayalet yok)",
          not phantom, ", ".join(phantom) or f"{len(ch)} bileşen, hepsi alarmlı")
    others = [k for k in ch if not k.startswith(f"{SID}.{target}")]
    if others:
        print(f"      (ayrıca kendiliğinden bozulma: {', '.join(others)})")

    print("\n[6] Temizlik")
    post("/api/dev/fault", {"target": target, "kind": "clear"})
    check("arıza temizlendi", True)
    check("alarmlar onaylandı", post("/api/alarms/ack-all")["acked"] >= 1)

    print("\n" + ("CANLI YIĞIN DOĞRULANDI ✓" if not fails
                  else f"BAŞARISIZ ✗ — {', '.join(fails)}") + "\n")
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
