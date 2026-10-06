#!/usr/bin/env bash
#
# Projeyi Raspberry Pi'ye gönderir ve başlatır.
#
#   ./deploy/push-to-pi.sh pi@raspberrypi.local              # normal (Pi internete çıkabiliyor)
#   ./deploy/push-to-pi.sh pi@raspberrypi.local --offline    # Pi'nin internete İHTİYACI YOK
#   ./deploy/push-to-pi.sh pi@raspberrypi.local --no-build   # yeniden derleme yapma
#
# --offline: Docker imajları Mac'te paketlenip Pi'ye taşınır. Apple Silicon
# Mac ve Pi 4 (64-bit OS) ikisi de linux/arm64 olduğu için imajlar birebir
# uyumludur. USB-C gadget bağlantısında ya da kapalı ağda tek çözüm budur.
#
# Pi'de Blender, Node.js ya da Python kurulu olmasına gerek yok — sadece Docker.
set -euo pipefail

TARGET=""; BUILD=1; OFFLINE=0
for a in "$@"; do
  case "$a" in
    --offline)  OFFLINE=1 ;;
    --no-build) BUILD=0 ;;
    -*)         echo "bilinmeyen seçenek: $a"; exit 1 ;;
    *)          TARGET="$a" ;;
  esac
done
[ -z "$TARGET" ] && { echo "kullanım: $0 kullanıcı@pi-adresi [--offline] [--no-build]"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
REMOTE_DIR="${REMOTE_DIR:-otomasyon}"
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"   # Pi'de varsayılan hafif imaj
blu(){ printf '\033[1;34m%s\033[0m\n' "$*"; }
grn(){ printf '\033[32m%s\033[0m\n' "$*"; }

STEP=0; TOTAL=$(( OFFLINE == 1 ? 7 : 5 ))
step(){ STEP=$((STEP+1)); blu "$STEP/$TOTAL  $*"; }

# ---------------------------------------------------------------- #
if [ "$BUILD" = 1 ]; then
  step "Modeller üretiliyor (Blender, masaüstünde)"
  if command -v blender >/dev/null 2>&1; then
    for cfg in stations/*.json; do
      sid=$(basename "$cfg" .json)
      blender --background --python tools/genmodel/generate.py -- \
        --config "$cfg" --out "build/$sid.glb" --twin-map "build/$sid-twin-map.json" \
        2>&1 | grep -E "model:" | sed "s/^/    [$sid]/" || true
    done
  else
    echo "    blender yok — mevcut build/ kullanılacak"
  fi

  step "Arayüz derleniyor (vite, masaüstünde)"
  mkdir -p web/public/models
  cp build/*.glb build/*-twin-map.json web/public/models/
  npm --prefix web ci --silent
  npm --prefix web run build >/dev/null
  grn "    web/dist hazır ($(du -sh web/dist | cut -f1))"
else
  STEP=2
fi

# ---------------------------------------------------------------- #
if [ "$OFFLINE" = 1 ]; then
  step "Docker imajları hazırlanıyor (arm64)"
  docker compose build api sim >/dev/null
  IMAGES=(su-yapisi-ikiz-api su-yapisi-ikiz-sim nginx:alpine eclipse-mosquitto:2 "$DB_IMAGE")
  for i in "${IMAGES[@]}"; do
    docker image inspect "$i" >/dev/null 2>&1 || { echo "    indiriliyor: $i"; docker pull -q "$i" >/dev/null; }
    arch=$(docker image inspect "$i" --format '{{.Architecture}}')
    [ "$arch" = "arm64" ] || { echo "    HATA: $i mimarisi $arch (arm64 olmalı)"; exit 1; }
  done
  step "İmajlar paketleniyor"
  # Paket tazeyse (30 dk) yeniden üretme — 199 MB'lık gzip her seferinde gereksiz
  if [ -s /tmp/twin-images.tar.gz ] && [ -z "$(find /tmp/twin-images.tar.gz -mmin +30 2>/dev/null)" ]; then
    echo "    mevcut paket kullanılıyor"
  else
    docker save "${IMAGES[@]}" | gzip -1 > /tmp/twin-images.tar.gz
  fi
  grn "    /tmp/twin-images.tar.gz  ($(du -h /tmp/twin-images.tar.gz | cut -f1))"
fi

# ---------------------------------------------------------------- #
step "Dosyalar gönderiliyor: $TARGET:~/$REMOTE_DIR"
ssh "$TARGET" "mkdir -p ~/$REMOTE_DIR/web"
# macOS'ta rsync = openrsync; --info=stats1 ve --delete uzun biçimi yok.
# --del kısa biçimi her iki uygulamada da çalışır.
RSYNC_OPTS=(-az --del
  --exclude node_modules --exclude .git --exclude __pycache__
  --exclude '*.blend*' --exclude .venv)
rsync "${RSYNC_OPTS[@]}" \
  docker-compose.yml README.md \
  api sim common stations infra deploy tools tests docs \
  "$TARGET:~/$REMOTE_DIR/"
rsync "${RSYNC_OPTS[@]}" web/dist web/nginx.conf "$TARGET:~/$REMOTE_DIR/web/"
echo "DB_IMAGE=$DB_IMAGE" | ssh "$TARGET" "cat > ~/$REMOTE_DIR/.env"

if [ "$OFFLINE" = 1 ]; then
  echo "    imajlar aktarılıyor…"
  gunzip -c /tmp/twin-images.tar.gz | ssh "$TARGET" "docker load" | sed 's/^/    /'
fi

# ---------------------------------------------------------------- #
# Pi 4'te donanım saati (RTC) yoktur ve ağa bağlı değilse NTP çalışmaz.
# Saat her elektrik kesintisinde son kapanış anına döner ve oradan sürüklenir.
# Yanlış saat = yanlış alarm zamanı, kaymış trend ekseni, bozuk oynatma çubuğu.
step "Saat eşitleniyor"
TZ_LOCAL=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')
NOW_UTC=$(date -u '+%Y-%m-%d %H:%M:%S')
ssh "$TARGET" "sudo timedatectl set-timezone '${TZ_LOCAL:-UTC}' 2>/dev/null; \
               sudo date -u -s '$NOW_UTC' >/dev/null; \
               command -v fake-hwclock >/dev/null && sudo fake-hwclock save; \
               echo \"    \$(date '+%Y-%m-%d %H:%M:%S %Z')\""

step "Pi'de başlatılıyor"
PULL_FLAG=""; [ "$OFFLINE" = 1 ] && PULL_FLAG="--pull never"
ssh "$TARGET" "cd ~/$REMOTE_DIR && docker compose --profile kiosk up -d $PULL_FLAG 2>&1 | tail -8 && \
  echo && docker compose ps --format '  {{.Service}}  {{.Status}}'"

HOST=$(echo "$TARGET" | cut -d@ -f2)
echo
grn "Bitti."
cat <<NEXT
  arayüz  : http://$HOST/
  sağlık  : curl -s http://$HOST/api/health
  kiosk   : ssh $TARGET 'mkdir -p ~/.config/systemd/user && \\
              cp ~/$REMOTE_DIR/deploy/twin-kiosk.service ~/.config/systemd/user/ && \\
              systemctl --user daemon-reload && systemctl --user enable --now twin-kiosk && \\
              sudo loginctl enable-linger \$USER'
NEXT
