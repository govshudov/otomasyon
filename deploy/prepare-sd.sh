#!/usr/bin/env bash
#
# SD kartı USB-C gadget modu + SSH için hazırlar. macOS'ta, kart TAKILIYKEN çalıştır.
#
#   ./deploy/prepare-sd.sh
#
# Ne yapar (hepsi boot bölümünde, sistem dosyalarına dokunmaz):
#   config.txt   -> dtoverlay=dwc2            (USB-C'yi çevre birim moduna al)
#   cmdline.txt  -> modules-load=dwc2,g_ether (USB üzerinden ethernet)
#   ssh          -> boş dosya                 (SSH sunucusunu aç)
#
# Değiştirdiği her dosyanın .bak yedeğini alır. Zaten yapılmışsa tekrar yazmaz.
set -euo pipefail

red(){ printf '\033[31m%s\033[0m\n' "$*"; }
grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
blu(){ printf '\033[1;34m%s\033[0m\n' "$*"; }

BOOT=""
for c in /Volumes/bootfs /Volumes/boot /Volumes/BOOT; do
  [ -f "$c/config.txt" ] && { BOOT="$c"; break; }
done
if [ -z "$BOOT" ]; then
  red "Boot bölümü bulunamadı."
  echo "  SD kart takılı mı? Beklenen konumlar: /Volumes/bootfs, /Volumes/boot"
  echo "  Takılı diskler:"; ls /Volumes 2>/dev/null | sed 's/^/    /'
  exit 1
fi
blu "Boot bölümü: $BOOT"

# --- config.txt ---
if grep -qE '^\s*dtoverlay=dwc2' "$BOOT/config.txt"; then
  grn "  config.txt   zaten hazır"
else
  cp "$BOOT/config.txt" "$BOOT/config.txt.bak"
  printf '\n# USB-C gadget modu (dijital ikiz kurulumu icin eklendi)\n[all]\ndtoverlay=dwc2\n' >> "$BOOT/config.txt"
  grn "  config.txt   dtoverlay=dwc2 eklendi (yedek: config.txt.bak)"
fi

# --- cmdline.txt --- tek satırdır, rootwait'ten HEMEN SONRA eklenmeli
if grep -q 'dwc2' "$BOOT/cmdline.txt"; then
  grn "  cmdline.txt  zaten hazır"
else
  cp "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.bak"
  # macOS sed -i farklı; python ile güvenli düzenleme
  python3 - "$BOOT/cmdline.txt" <<'PY'
import sys
p = sys.argv[1]
line = open(p).read().strip()
if "rootwait" in line:
    line = line.replace("rootwait", "rootwait modules-load=dwc2,g_ether", 1)
else:
    line += " modules-load=dwc2,g_ether"
open(p, "w").write(line + "\n")
PY
  grn "  cmdline.txt  modules-load=dwc2,g_ether eklendi (yedek: cmdline.txt.bak)"
fi

# --- SSH ---
if [ -f "$BOOT/ssh" ] || [ -f "$BOOT/ssh.txt" ]; then
  grn "  ssh          zaten açık"
else
  touch "$BOOT/ssh"
  grn "  ssh          açıldı"
fi

# --- SSH anahtarını kullanıcıya kopyalamayı öner ---
KEY="$HOME/.ssh/id_ed25519.pub"
[ -f "$KEY" ] || KEY="$HOME/.ssh/id_rsa.pub"
if [ -f "$KEY" ]; then
  echo
  echo "SSH anahtarın: $KEY"
  echo "  Pi ilk açıldıktan sonra parolasız giriş için:"
  echo "    ssh-copy-id -i $KEY <kullanıcı>@raspberrypi.local"
fi

echo
blu "Hazır. Sırada:"
cat <<'NEXT'
  1. SD kartı güvenle çıkar, Pi'ye tak
  2. Pi'nin USB-C portunu Mac'e VERİ kablosuyla bağla (şarj kablosu olmaz)
  3. ~60 sn bekle, sonra:  ping raspberrypi.local
  4. Mac ayarları > Genel > Paylaşma > İnternet Paylaşımı:
     kaynak Wi-Fi, hedef "RNDIS/Ethernet Gadget"  (Pi'nin internete çıkması için;
     çevrimdışı kurulum yapacaksan gerekmez)
NEXT
