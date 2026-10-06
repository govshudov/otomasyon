#!/usr/bin/env bash
# Dijital ikiz kontrolü — masaüstü kısayolları bunu çağırır.
#   twin-control.sh baslat | durdur | yenile | durum
set -uo pipefail
DIR="$HOME/otomasyon"
CMD="${1:-durum}"

bildir() { command -v notify-send >/dev/null 2>&1 && notify-send -t 4000 "Dijital İkiz" "$1" || echo "$1"; }

case "$CMD" in
  baslat)
    # Konteynerler zaten `restart: unless-stopped` ile açılışta gelir; elle
    # durdurulmuşlarsa geri getir.
    (cd "$DIR" && docker compose --profile kiosk up -d >/dev/null 2>&1)
    # API hazır olana kadar bekle — arayüz boş ekranla açılmasın
    for i in $(seq 1 60); do
      curl -fsS --max-time 2 http://localhost/api/health >/dev/null 2>&1 && break
      sleep 1
    done
    systemctl --user restart twin-kiosk
    bildir "Başlatıldı"
    ;;
  durdur)
    systemctl --user stop twin-kiosk
    bildir "Ekran kapatıldı (servisler çalışmaya devam ediyor)"
    ;;
  tamamen-durdur)
    systemctl --user stop twin-kiosk
    (cd "$DIR" && docker compose --profile kiosk stop >/dev/null 2>&1)
    bildir "Tamamen durduruldu"
    ;;
  yenile)
    systemctl --user restart twin-kiosk
    bildir "Yenilendi"
    ;;
  durum)
    echo "kiosk    : $(systemctl --user is-active twin-kiosk)"
    (cd "$DIR" && docker compose --profile kiosk ps --format '{{.Service}}: {{.Status}}')
    curl -s --max-time 3 http://localhost/api/health 2>/dev/null | head -c 200 || echo "API yanıt vermiyor"
    ;;
  *) echo "kullanım: $0 baslat|durdur|tamamen-durdur|yenile|durum"; exit 1;;
esac
