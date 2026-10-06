#!/usr/bin/env bash
# Doğrudan bağlı bir Raspberry Pi'yi bulur. Ağ taraması yapmaz — yalnız
# noktadan noktaya bağlı arayüzün komşularına bakar.
set -uo pipefail

found=0
for IFACE in $(ifconfig -l); do
  case "$IFACE" in lo0|gif0|stf0|awdl0|llw0|utun*|ap1|anpi*|bridge0) continue;; esac
  st=$(ifconfig "$IFACE" 2>/dev/null | awk '/status:/{print $2}')
  [ "$st" = "active" ] || continue
  [ "$IFACE" = "en0" ] && continue          # Wi-Fi'yi atla (kurumsal ağ)

  addr=$(ipconfig getifaddr "$IFACE" 2>/dev/null)
  echo "arayüz $IFACE  link VAR  adres ${addr:-yok}"

  # 1) mDNS
  for h in raspberrypi.local raspberrypi-2.local pi.local; do
    ip=$(dscacheutil -q host -a name "$h" 2>/dev/null | awk '/^ip_address/{print $2; exit}')
    [ -n "$ip" ] && { echo "  mDNS: $h -> $ip"; found=1; }
  done

  # 2) ARP komşuları (ping taraması yerine, önce broadcast'e dokun)
  if [ -n "$addr" ]; then
    net=$(echo "$addr" | cut -d. -f1-3)
    ping -c2 -t1 "$net.255" >/dev/null 2>&1 || true
    arp -an -i "$IFACE" 2>/dev/null | grep -v incomplete | while read -r l; do
      mac=$(echo "$l" | awk '{print $4}')
      ip=$(echo "$l" | sed 's/.*(\(.*\)).*/\1/')
      # Raspberry Pi OUI'leri: b8:27:eb (Pi 1-3), dc:a6:32 / e4:5f:01 / d8:3a:dd (Pi 4/5)
      case "$mac" in b8:27:eb*|dc:a6:32*|e4:5f:01*|d8:3a:dd*|2c:cf:67*)
        echo "  ARP: $ip  ($mac)  <- RASPBERRY PI";; esac
    done
  fi
done
[ "$found" = 0 ] && echo "(henüz Pi görünmüyor)"
exit 0
