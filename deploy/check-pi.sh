#!/usr/bin/env bash
# Pi'nin bu iş için hazır olup olmadığını kontrol eder. Hiçbir şey değiştirmez.
#   ./deploy/check-pi.sh pi@10.16.30.42
set -uo pipefail
TARGET="${1:-}"
[ -z "$TARGET" ] && { echo "kullanım: $0 kullanıcı@pi-adresi"; exit 1; }

ssh -o ConnectTimeout=8 "$TARGET" 'bash -s' <<'REMOTE'
ok(){ printf "  \033[32m✓\033[0m %-32s %s\n" "$1" "${2:-}"; }
no(){ printf "  \033[31m✗\033[0m %-32s %s\n" "$1" "${2:-}"; }

echo; echo "DONANIM"
MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)
case "$MODEL" in *"Pi 4"*|*"Pi 5"*) ok "model" "$MODEL";; *) no "model" "$MODEL (Pi 4/5 bekleniyor)";; esac
RAM=$(awk '/MemTotal/{printf "%.1f", $2/1048576}' /proc/meminfo)
awk -v r="$RAM" 'BEGIN{exit !(r>=3.5)}' && ok "RAM" "${RAM} GB" || no "RAM" "${RAM} GB (en az 4 GB önerilir)"
ARCH=$(uname -m)
[ "$ARCH" = "aarch64" ] && ok "mimari" "$ARCH" || no "mimari" "$ARCH (64-bit OS gerekli)"

echo; echo "SİSTEM"
. /etc/os-release 2>/dev/null
case "$VERSION_CODENAME" in bookworm|trixie) ok "OS" "$PRETTY_NAME";; *) no "OS" "$PRETTY_NAME (Bookworm önerilir)";; esac
grep -q "vc4-kms-v3d" /boot/firmware/config.txt 2>/dev/null || grep -q "vc4-kms-v3d" /boot/config.txt 2>/dev/null \
  && ok "KMS GPU sürücüsü" "vc4-kms-v3d etkin" || no "KMS GPU sürücüsü" "config.txt'de dtoverlay=vc4-kms-v3d yok"
[ -e /dev/dri/card0 ] || [ -e /dev/dri/card1 ] && ok "DRI aygıtı" "$(ls /dev/dri 2>/dev/null | tr '\n' ' ')" || no "DRI aygıtı" "yok — GPU hızlandırma çalışmaz"
echo "  oturum: ${XDG_SESSION_TYPE:-bilinmiyor}  masaüstü: ${XDG_CURRENT_DESKTOP:-yok}"

echo; echo "YAZILIM"
command -v docker >/dev/null && ok "docker" "$(docker --version | cut -d, -f1)" || no "docker" "kurulu değil"
docker compose version >/dev/null 2>&1 && ok "docker compose" "$(docker compose version --short 2>/dev/null)" || no "docker compose" "yok"
docker info >/dev/null 2>&1 && ok "docker erişimi" "parolasız" || no "docker erişimi" "sudo gerekiyor — usermod -aG docker \$USER"
command -v chromium-browser >/dev/null || command -v chromium >/dev/null && ok "chromium" "$(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null)" || no "chromium" "kurulu değil"

echo; echo "KAYNAK"
DISK=$(df -h / | awk 'NR==2{print $4}')
ok "boş disk" "$DISK"
TEMP=$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)
THR=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
[ "$THR" = "0x0" ] && ok "sıcaklık / kısma" "$TEMP, kısma yok" || no "sıcaklık / kısma" "$TEMP, get_throttled=$THR"
case "$(findmnt -no FSTYPE /)" in overlay) echo "  NOT: kök dosya sistemi salt okunur (overlayfs) — kurulum için geçici olarak kapat";; esac
echo
REMOTE
