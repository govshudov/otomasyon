#!/usr/bin/env bash
# Pi'deki kiosk Chromium'unda JS çalıştırır. Tüneli gerekirse kendi kurar.
#   ./tools/pi-eval.sh "1+1"
#   ./tools/pi-eval.sh --file script.js
set -uo pipefail
cd "$(dirname "$0")/.."

tunnel_ok() { curl -s --max-time 4 "http://[::1]:9222/json/version" >/dev/null 2>&1; }

if ! tunnel_ok; then
  pkill -f "ssh .*-L 9222" 2>/dev/null || true
  for i in $(seq 1 20); do
    ssh -f -N -L 9222:127.0.0.1:9222 -o ExitOnForwardFailure=yes twinpi 2>/dev/null
    sleep 1
    tunnel_ok && break
    pkill -f "ssh .*-L 9222" 2>/dev/null || true
    sleep 2
  done
fi
tunnel_ok || { echo "DevTools'a ulaşılamadı — kiosk çalışıyor mu?" >&2; exit 1; }
exec python3 tools/cdp.py "$@"
