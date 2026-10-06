#!/usr/bin/env bash
# en6 üzerindeki komşuları izler. IPv6 link-local (fe80::) bir Linux arayüzü
# ayağa kalkar kalkmaz atanır — DHCP beklemeye gerek yok, en hızlı dedektör bu.
IFACE="${1:-en6}"
SELF=$(ifconfig "$IFACE" 2>/dev/null | awk '/inet6 fe80/{print $2}' | cut -d% -f1)
while true; do
  peers=$(ping6 -c2 -i0.4 -I "$IFACE" ff02::1 2>/dev/null \
          | awk '/bytes from/{print $4}' | cut -d% -f1 | sort -u | grep -v "^$SELF$")
  if [ -n "$peers" ]; then
    echo "KOMŞU BULUNDU: $peers"
    for p in $peers; do
      # Linux OUI'sinden MAC'i çıkar, Pi mi bak
      mac=$(ndp -an 2>/dev/null | grep "$p" | awk '{print $2}')
      echo "  $p  mac=$mac"
    done
    exit 0
  fi
  sleep 3
done
