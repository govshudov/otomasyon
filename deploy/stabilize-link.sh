#!/usr/bin/env bash
# Pi erişilebilir olur olmaz ağ bağlantısını KALICI hale getirir.
#
# Sorun: DHCP sunucusu olmayan noktadan noktaya bir linkte NetworkManager
# DHCP'yi sonsuza kadar dener ve her denemede arayüzü indirip kaldırır.
# Link (PHY) ayakta kalır ama IP yığını gidip gelir — SSH oturumları kopar.
#
# Çözüm: IPv4'ü link-local'e sabitle, otomatik bağlanmayı garantile.
set -uo pipefail
PI_HOST="${1:-twinpi}"

echo "Pi bekleniyor…"
until ssh -o BatchMode=yes -o ConnectTimeout=4 "$PI_HOST" true 2>/dev/null; do sleep 2; done
echo "yakalandı — düzeltme uygulanıyor"

ssh -o BatchMode=yes "$PI_HOST" 'bash -s' <<'REMOTE'
set -uo pipefail
CON=$(nmcli -t -f NAME,DEVICE con show | awk -F: '$2=="eth0"{print $1; exit}')
[ -z "$CON" ] && CON=$(nmcli -t -f NAME con show | grep -i "wired" | head -1)
echo "  bağlantı profili: ${CON:-BULUNAMADI}"
[ -z "$CON" ] && exit 1

echo "  önceki ayar: ipv4.method=$(nmcli -g ipv4.method con show "$CON") autoconnect=$(nmcli -g connection.autoconnect con show "$CON")"

# DHCP'yi bırak: link-local yeterli, sonsuz yeniden deneme döngüsü biter
sudo nmcli con mod "$CON" ipv4.method link-local
sudo nmcli con mod "$CON" ipv4.may-fail yes
sudo nmcli con mod "$CON" ipv6.method link-local
sudo nmcli con mod "$CON" connection.autoconnect yes
sudo nmcli con mod "$CON" connection.autoconnect-retries 0
echo "  yeni ayar:   ipv4.method=$(nmcli -g ipv4.method con show "$CON")"

# Yeniden başlatmadan uygula (bağlantı bir an kopabilir, sonra kalıcı olur)
sudo nmcli con up "$CON" >/dev/null 2>&1 || true
sleep 3
echo "  adresler:"; ip -br addr show eth0 | sed 's/^/    /'
echo "  NM son olaylar:"
journalctl -u NetworkManager -n 6 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
REMOTE
