#!/usr/bin/env bash
#
# Isınma ve donma teşhisi. Pi'de doğrudan ya da SSH ile:
#   ./deploy/thermal-check.sh              (Pi üzerinde)
#   ssh twinpi 'bash -s' < deploy/thermal-check.sh
#
# İzleme modu: sıcaklık ve kısma durumunu sürekli kaydeder
#   ./deploy/thermal-check.sh izle 600     (10 dakika, 5 sn aralık)
set -uo pipefail

decode_throttled() {
  local v=$((${1:-0}))
  [ "$v" = 0 ] && { echo "sorun yok"; return; }
  local out=""
  (( v & 0x1     )) && out+="ŞU AN düşük voltaj; "
  (( v & 0x2     )) && out+="ŞU AN ARM frekansı kısılı; "
  (( v & 0x4     )) && out+="ŞU AN kısma aktif; "
  (( v & 0x8     )) && out+="ŞU AN yumuşak sıcaklık sınırı; "
  (( v & 0x10000 )) && out+="GEÇMİŞTE düşük voltaj oldu; "
  (( v & 0x20000 )) && out+="GEÇMİŞTE frekans kısıldı; "
  (( v & 0x40000 )) && out+="GEÇMİŞTE kısma oldu; "
  (( v & 0x80000 )) && out+="GEÇMİŞTE yumuşak sınır aşıldı; "
  echo "${out:-bilinmeyen $1}"
}

if [ "${1:-}" = "izle" ]; then
  SURE=${2:-600}
  echo "zaman,sicaklik_C,arm_MHz,gpu_MHz,throttled,yuk1dk"
  END=$(( $(date +%s) + SURE ))
  while [ "$(date +%s)" -lt "$END" ]; do
    T=$(vcgencmd measure_temp | tr -dc '0-9.')
    A=$(( $(vcgencmd measure_clock arm | cut -d= -f2) / 1000000 ))
    G=$(( $(vcgencmd measure_clock v3d | cut -d= -f2) / 1000000 ))
    TH=$(vcgencmd get_throttled | cut -d= -f2)
    L=$(awk '{print $1}' /proc/loadavg)
    echo "$(date +%H:%M:%S),$T,$A,$G,$TH,$L"
    sleep 5
  done
  exit 0
fi

echo "═══ SICAKLIK VE KISMA ═══"
T=$(vcgencmd measure_temp | tr -dc '0-9.')
echo "  sıcaklık      : ${T} °C"
awk -v t="$T" 'BEGIN{
  if (t>=85) print "                  ❗ SERT KISMA BÖLGESİ (>=85) — donma kaçınılmaz";
  else if (t>=80) print "                  ⚠ YUMUŞAK KISMA BÖLGESİ (>=80) — ARM frekansı düşürülüyor";
  else if (t>=70) print "                  ⚠ sınıra yakın (kısma 80 °C\x27de başlar)";
  else print "                  ✓ güvenli";
}'
TH=$(vcgencmd get_throttled | cut -d= -f2)
echo "  throttled     : $TH  ->  $(decode_throttled "$TH")"
echo "  ARM frekansı  : $(( $(vcgencmd measure_clock arm | cut -d= -f2) / 1000000 )) MHz  (nominal 1500)"
echo "  GPU frekansı  : $(( $(vcgencmd measure_clock v3d | cut -d= -f2) / 1000000 )) MHz  (nominal 500)"
echo "  çekirdek volt : $(vcgencmd measure_volts core | cut -d= -f2)"

echo
echo "═══ SOĞUTMA ═══"
if [ -d /sys/class/thermal/cooling_device0 ]; then
  for d in /sys/class/thermal/cooling_device*; do
    echo "  $(cat $d/type 2>/dev/null): seviye $(cat $d/cur_state 2>/dev/null)/$(cat $d/max_state 2>/dev/null)"
  done
else
  echo "  ❗ Sistemde tanımlı soğutma aygıtı YOK — fan takılı değil."
fi

echo
echo "═══ CPU YÜKÜ (en çok tüketen 8) ═══"
ps -eo pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -9 | sed 's/^/  /'
echo "  yük ortalaması: $(cat /proc/loadavg | cut -d' ' -f1-3)  (4 çekirdek; 4.0 = tam dolu)"

echo
echo "═══ GEREKSİZ SERVİSLER ═══"
# Kiosk için gerekmeyen ama CPU/ısı üreten servisler
for s in wayvnc influxdb grafana-server bluetooth ModemManager cups avahi-daemon triggerhappy; do
  st=$(systemctl is-active "$s" 2>/dev/null)
  [ "$st" = "active" ] && printf "  %-18s ÇALIŞIYOR — kapatılabilir\n" "$s"
done
echo "  (kapatmak için: sudo systemctl disable --now <servis>)"

echo
echo "═══ DİJİTAL İKİZ YÜKÜ ═══"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker stats --no-stream --format '  {{.Name}}: CPU {{.CPUPerc}}  RAM {{.MemUsage}}' 2>/dev/null | head -8
fi
echo "  chromium süreç: $(pgrep -c chromium || echo 0)"
CPU_CHROME=$(ps -eo pcpu,comm 2>/dev/null | awk '/chromium/{s+=$1} END{printf "%.1f", s}')
echo "  chromium toplam CPU: %${CPU_CHROME:-0}"

echo
echo "═══ ÖNERİLER ═══"
awk -v t="$T" 'BEGIN{ if (t>=70) {
  print "  1. SOĞUTMA: ısı emici + fan. Pi 4 sürekli 3D render altında pasif";
  print "     soğutmayla 80 °C\x27yi geçer. En etkili tek müdahale budur.";
  print "  2. Kutu içindeyse hava akışı sağla; DSI ekran da aynı hacmi ısıtıyor.";
}}'
echo "  3. Gereksiz servisleri kapat (yukarıda listelendi)."
echo "  4. Arayüz kare hızı sınırı: aktif 30 fps, boşta 6 fps (v2'de eklendi)."
