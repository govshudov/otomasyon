#!/usr/bin/env bash
# Chromium'u kiosk modunda başlatır. systemd servisi bunu çağırır.
set -euo pipefail

URL="${TWIN_URL:-http://localhost/}"
FLAGS_FILE="$(dirname "$0")/chromium-flags.conf"
PROFILE="${HOME}/.twin-kiosk-profile"

# Ekran uyumasın / kararmasın
if command -v wlopm >/dev/null 2>&1; then wlopm --on '*' || true; fi
if command -v xset  >/dev/null 2>&1; then xset s off; xset -dpms; xset s noblank; fi

# Önceki oturumun "düzgün kapanmadı" balonunu bastır
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" || true
fi

mapfile -t FLAGS < <(grep -vE '^\s*(#|$)' "$FLAGS_FILE")

# Uzaktan hata ayıklama — YALNIZ geliştirme/ölçüm için.
# TWIN_DEBUG_PORT tanımlıysa açılır; sahada tanımlanmaz.
if [ -n "${TWIN_DEBUG_PORT:-}" ]; then
  FLAGS+=("--remote-debugging-port=${TWIN_DEBUG_PORT}" "--remote-allow-origins=*")
fi

BIN=$(command -v chromium-browser || command -v chromium)
exec "$BIN" "${FLAGS[@]}" --user-data-dir="$PROFILE" "$URL"
