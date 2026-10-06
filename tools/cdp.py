#!/usr/bin/env python3
"""Chrome DevTools Protocol istemcisi — bağımlılıksız.

Pi'de kiosk modunda çalışan Chromium'a bağlanıp sayfada JavaScript çalıştırır.
Ölçümü uzaktan tetiklemek için; sahada bu port hiç açılmaz.

    python3 tools/cdp.py "1+1"
    python3 tools/cdp.py --file script.js
"""
from __future__ import annotations

import base64, json, os, socket, sys, urllib.request


HOSTS = ["[::1]"]


class WS:
    def __init__(self, url: str):
        assert url.startswith("ws://")
        rest = url[5:]
        hostport, path = rest.split("/", 1)
        if hostport.startswith("["):
            host, port = hostport[1:].split("]:")
        else:
            host, port = hostport.rsplit(":", 1)
        self.s = socket.create_connection((host, int(port)), timeout=20)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\n"
                        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            c = self.s.recv(4096)
            if not c:
                raise ConnectionError("el sıkışma başarısız")
            self.buf += c
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b"101" not in head.split(b"\r\n")[0]:
            raise ConnectionError(head.splitlines()[0].decode())

    def _need(self, n: int) -> bytes:
        while len(self.buf) < n:
            c = self.s.recv(65536)
            if not c:
                raise ConnectionError("bağlantı kapandı")
            self.buf += c
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj: dict) -> None:
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            hdr = bytes([0x81, 0x80 | n])
        elif n < 65536:
            hdr = bytes([0x81, 0xFE]) + n.to_bytes(2, "big")
        else:
            hdr = bytes([0x81, 0xFF]) + n.to_bytes(8, "big")
        self.s.sendall(hdr + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))

    def recv(self, timeout: float = 120.0) -> dict:
        self.s.settimeout(timeout)
        b0, b1 = self._need(2)
        masked, ln = b1 & 0x80, b1 & 0x7F
        if ln == 126:
            ln = int.from_bytes(self._need(2), "big")
        elif ln == 127:
            ln = int.from_bytes(self._need(8), "big")
        mask = self._need(4) if masked else b""
        pay = self._need(ln)
        if masked:
            pay = bytes(c ^ mask[i % 4] for i, c in enumerate(pay))
        if (b0 & 0x0F) == 0x8:
            raise ConnectionError("sunucu close gönderdi")
        return json.loads(pay.decode())


def evaluate(expr: str, port: int = 9222, timeout: float = 180.0):
    # SSH yerel yönlendirmesi AddressFamily inet6 ile yalnız ::1'e bağlanabiliyor;
    # ikisini de dene.
    targets = None
    for host in ("[::1]", "127.0.0.1"):
        try:
            targets = json.load(urllib.request.urlopen(f"http://{host}:{port}/json", timeout=8))
            HOSTS[0] = host
            break
        except Exception:
            continue
    if targets is None:
        raise RuntimeError(f"DevTools portuna ({port}) ulaşılamadı")
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    if not pages:
        raise RuntimeError(f"sayfa hedefi yok ({len(targets)} hedef)")
    wsurl = pages[0]["webSocketDebuggerUrl"]
    if HOSTS[0] != "127.0.0.1":
        wsurl = wsurl.replace("ws://127.0.0.1:", f"ws://{HOSTS[0]}:").replace("ws://localhost:", f"ws://{HOSTS[0]}:")
    ws = WS(wsurl)
    ws.send({"id": 1, "method": "Runtime.enable"})
    ws.send({"id": 2, "method": "Runtime.evaluate",
             "params": {"expression": expr, "awaitPromise": True,
                        "returnByValue": True, "timeout": int(timeout * 1000)}})
    while True:
        m = ws.recv(timeout + 20)
        if m.get("id") == 2:
            r = m.get("result", {})
            if "exceptionDetails" in r:
                raise RuntimeError(r["exceptionDetails"].get("text", "JS hatası") + " :: " +
                                   str(r["exceptionDetails"].get("exception", {}).get("description", "")))
            return r.get("result", {}).get("value")


def browser_info(port: int = 9222) -> dict:
    """Tarayıcı seviyesinde SystemInfo.getInfo — GPU'ya neden düşüldüğünü söyler."""
    for host in ("[::1]", "127.0.0.1"):
        try:
            v = json.load(urllib.request.urlopen(f"http://{host}:{port}/json/version", timeout=8))
            HOSTS[0] = host
            break
        except Exception:
            continue
    else:
        raise RuntimeError("DevTools portuna ulaşılamadı")
    url = v["webSocketDebuggerUrl"].replace("ws://127.0.0.1:", f"ws://{HOSTS[0]}:").replace("ws://localhost:", f"ws://{HOSTS[0]}:")
    ws = WS(url)
    ws.send({"id": 1, "method": "SystemInfo.getInfo"})
    while True:
        m = ws.recv(30)
        if m.get("id") == 1:
            return m.get("result", {})


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--screenshot":
        # Pi'nin ekranındaki sayfayı PNG olarak al — görsel değişiklikleri
        # gerçekten doğrulayabilmek için.
        out_path = args[1] if len(args) > 1 else "pi-screen.png"
        for host in ("[::1]", "127.0.0.1"):
            try:
                targets = json.load(urllib.request.urlopen(f"http://{host}:9222/json", timeout=8))
                HOSTS[0] = host
                break
            except Exception:
                continue
        else:
            raise RuntimeError("DevTools portuna ulaşılamadı")
        pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
        url = pages[0]["webSocketDebuggerUrl"].replace("ws://127.0.0.1:", f"ws://{HOSTS[0]}:").replace("ws://localhost:", f"ws://{HOSTS[0]}:")
        ws = WS(url)
        ws.send({"id": 1, "method": "Page.enable"})
        ws.send({"id": 2, "method": "Page.captureScreenshot", "params": {"format": "png"}})
        while True:
            m = ws.recv(60)
            if m.get("id") == 2:
                data = m.get("result", {}).get("data")
                if not data:
                    raise RuntimeError("ekran görüntüsü alınamadı: " + json.dumps(m)[:200])
                open(out_path, "wb").write(base64.b64decode(data))
                print(f"{out_path} ({len(base64.b64decode(data))//1024} KB)")
                raise SystemExit(0)

    if args and args[0] == "--sysinfo":
        info = browser_info()
        gpu = info.get("gpu", {})
        print("═══ GPU aygıtları ═══")
        for d in gpu.get("devices", []):
            print(f"  {d.get('vendorString','?')} / {d.get('deviceString','?')}")
        aux = gpu.get("auxAttributes", {})
        for k in ("glRenderer", "glVendor", "glVersion", "isSoftwareRendering",
                  "gpuCompositingDisabled", "canSupportThreadedTextureMailbox",
                  "sandboxed", "inProcessGpu", "passthroughCmdDecoder"):
            if k in aux:
                print(f"  {k}: {aux[k]}")
        print("\n═══ sürücü hataları ═══")
        for e in gpu.get("driverBugWorkarounds", [])[:8]:
            print(f"  {e}")
        fm = info.get("gpu", {}).get("featureStatus")
        if fm:
            print("\n═══ özellik durumu ═══")
            for k, v in fm.items():
                print(f"  {k:34s} {v}")
        raise SystemExit(0)
    if args and args[0] == "--file":
        expr = open(args[1], encoding="utf-8").read()
    else:
        expr = args[0] if args else "1+1"
    out = evaluate(expr)
    print(json.dumps(out, ensure_ascii=False, indent=2) if isinstance(out, (dict, list)) else out)
