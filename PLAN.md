# Su Yapısı 3D Dijital İkiz HMI — Teknik Plan (v2, kararlar sonrası)

**Hedef donanım:** Raspberry Pi 4 Model B + dokunmatik ekran
**İlk sürüm kapsamı:** Salt izleme (read-only), kumanda yok
**Veri:** Simülasyon ile başlanacak, PLC entegrasyonu sonraki faz
**3D model:** Sıfırdan üretilecek — kaynak dosya yok, sadece referans render görselleri var

---

## 0. Alınan Kararlar Özeti

| Konu | Karar | Sonucu |
|---|---|---|
| Donanım | Raspberry Pi 4 Model B | Sıkı performans bütçesi, 720p render + upscale |
| 3D motor | three.js + React Three Fiber (Chromium kiosk) | Ücretsiz, HTML panel avantajı, tablet/telefonda da çalışır |
| Model üretimi | **Blender Python (bpy) parametrik üretici** — elle modelleme YOK | Tüm varyantlar tek script'ten, isimlendirme otomatik doğru |
| Veri | Simülatör → sonra Modbus/S7/OPC UA | Geliştirme PLC'yi beklemez |
| Kapsam | Salt izleme | Güvenli, hızlı devreye alma |

---

## 1. Neden Parametrik Üretici? (En kritik karar)

Referans görsellerdeki üç yapı aynı şablonun farklı sayılarla üretilmiş halleri:

| Görsel | Göz (bay) | Pompa | Basma hattı |
|---|---|---|---|
| 1 | 12 | 12 | 4 |
| 2 | 6 | 6 | 2 |
| 3 | 3 | 3 | 2 |

Elle modelleme yapılırsa: her varyant ayrı iş, isimlendirme elle yapılır ve mutlaka hata olur,
ölçü değişince baştan çizilir, poligon sayısı kontrolsüz büyür.

**Üretici yaklaşımı:** JSON konfigürasyon → Blender headless çalışır → `.glb` + `twin-map.json` çıkar.

```bash
blender --background --python tools/genmodel/generate.py -- \
        --config stations/ps-01.json --out build/ps-01.glb
```

Kazanımlar:
- Yeni istasyon = yeni JSON dosyası (dakikalar), yeni modelleme işi değil
- İsimlendirme standardı **kod tarafından dayatılır**, insan hatası imkânsız
- Poligon bütçesi tasarım gereği düşük (primitiflerden üretiliyor, decimate gerekmez)
- Ölçüler değişince tek satır düzenleyip yeniden üret
- **Üretici, tag eşleme dosyasının iskeletini de kendisi yazar** — hangi bileşeni ürettiyse
  onun sensör slotunu açar. Model ile veri modeli asla ayrışmaz.

Bu, "gerekirse kendi aracımızı yaparız" dediğin araç. Projenin en değerli parçası bu.

### 1.1 Üretici modülleri
| Modül | Ürettiği |
|---|---|
| `civil.py` | Trapez kanal, yan duvarlar, taban eğimi, başlık duvarı, ayaklar (pier), üst platform, korkuluk |
| `intake.py` | Izgara (trash rack), sürgülü kapaklar (gate), kapak kılavuzları, kaldırma mekanizması |
| `pumps.py` | Motor (gövde + soğutma kanatçıkları + terminal kutusu + **DE/NDE rulman muhafazaları ayrı parça**), kaplin, kaplin muhafazası, pompa salyangozu, salmastra bölgesi, kaide plakası, ankraj |
| `piping.py` | DN tablosundan boru çapı, dirsek, redüksiyon, flanş, vana, çekvalf, kompansatör, manometre, kolektör |
| `water.py` | Su yüzeyi düzlemi (seviye animasyonlu), akış yönüne hizalı UV |
| `naming.py` | İsimlendirme standardını zorlayan yardımcı — kurala uymayan isim üretilemez |
| `shading.py` | Vertex-color AO bake, malzeme atama (toplam ≤ 6 malzeme) |
| `export.py` | Statik parçaları malzemeye göre birleştir, glTF/Draco export, `twin-map.json` üret |

### 1.2 Ölçüler
Gerçek proje ölçüleri henüz elimizde yok. Referans görsellerden çıkarılan tipik oranlarla
başlıyoruz; **tüm ölçüler config dosyasında**, gerçek değerler gelince güncellemesi 5 dakika.

```jsonc
{
  "station_id": "PS-01",
  "channel":  { "length": 40, "width_top": 24, "width_bottom": 14, "depth": 6, "wall_t": 0.8 },
  "headwall": { "bays": 6, "bay_width": 2.4, "pier_width": 0.6, "height": 4.5 },
  "gates":    [{ "id": "GATE-01", "bay": 2, "width": 2.0, "height": 3.0 }],
  "pumps":    [{ "id": "PMP-01", "row": 0, "col": 0, "motor_kw": 250, "dn_suction": 400, "dn_discharge": 350 }],
  "headers":  [{ "id": "HDR-01", "dn": 500, "pumps": ["PMP-01","PMP-02","PMP-03"] }]
}
```

---

## 2. Raspberry Pi 4 Performans Bütçesi (revize — sıkı)

Pi 4'ün VideoCore VI'sında darboğaz **piksel doldurma hızı (fill rate)**, poligon değil.
Bu yüzden strateji: düşük çözünürlükte render, çok az draw call, sıfır doku.

| Metrik | Pi 4 hedefi | Kırmızı çizgi | Yöntem |
|---|---|---|---|
| Canvas çözünürlüğü | **1280×720**, CSS ile tam ekrana ölçeklenir | 1080p'de render etme | `devicePixelRatio` = 1'e sabitlenir |
| FPS | 30 | < 24 | — |
| Draw call | **< 80** | 120 | Statik geometri malzemeye göre tek mesh'e birleştirilir |
| Üçgen | **< 150k** | 250k | Primitif tabanlı üretim, iç geometri yok |
| Malzeme | ≤ 6 | 10 | Beton / metal / boya-mavi / su / cam / vurgulama |
| Doku | **0** (geometri için) | 1 küçük su dokusu | Işık **vertex color**'a pişirilir — doku belleği ~0 |
| Gerçek zamanlı gölge | 0 | — | Bake edilmiş AO |
| Post-process | 0 | — | MSAA yeterli (VideoCore tile-based, MSAA ucuz) |
| Chromium RAM | < 700 MB | — | Pi 4 en az 4 GB olmalı |

**Doğrulama gerekli:** Pi'nin RAM'i. 1 GB veya 2 GB modelse Chromium + WebGL sıkışır.
```bash
cat /proc/device-tree/model && free -h
```

### Yedek planlar (Faz 0'da FPS tutmazsa)
1. 960×540 render + upscale
2. Sahneyi bölgelere ayır — sadece aktif bölge render edilir (frustum + manuel culling)
3. Orange Pi 5 / Rock 5B (~2 kat GPU, benzer fiyat)
4. Intel N100 mini PC (~150 $) — bu iş için fazlasıyla yeterli

---

## 3. Mimari

```
   SİMÜLATÖR (Faz 1)          EDGE — Raspberry Pi 4              EKRAN
┌──────────────────┐    ┌────────────────────────────┐    ┌──────────────────┐
│ sim.py           │    │  Mosquitto (MQTT)          │    │ Chromium kiosk   │
│ gerçekçi pompa   │───▶│    plant/PS-01/PMP-01/...  │    │  React + R3F     │
│ istasyonu verisi │    ├────────────────────────────┤    │  three.js        │
└──────────────────┘    │  FastAPI                   │◀───│  1280×720 canvas │
        ▲               │   REST (config, geçmiş)    │ WS │  HTML panel UI   │
        │               │   WebSocket (canlı, 5 Hz)  │───▶│                  │
   SONRA yerini alır    │   Alarm/kural motoru        │    └──────────────────┘
        │               ├────────────────────────────┤              ▲
┌──────────────────┐    │  TimescaleDB (geçmiş)      │              │ aynı uygulama
│ Gateway          │    │  Grafana (trend)           │    ┌─────────┴────────┐
│ pymodbus/snap7/  │───▶└────────────────────────────┘    │ Tablet / Telefon │
│ asyncua → PLC    │                                       └──────────────────┘
└──────────────────┘
```

Simülatör ile gateway **aynı MQTT sözleşmesini** konuşur. PLC bağlandığında frontend'de
tek satır değişmez — sadece simülatör kapatılır, gateway açılır.

---

## 4. Proje Yapısı

```
otomasyon/
├─ PLAN.md
├─ docker-compose.yml            # mosquitto + timescaledb + api + grafana
├─ stations/                     # istasyon konfigürasyonları
│   ├─ ps-01.json                # 6 gözlü (referans görsel 2)
│   ├─ ps-02.json                # 12 gözlü (referans görsel 1)
│   └─ ps-03.json                # 3 gözlü (referans görsel 3)
├─ tools/
│   └─ genmodel/                 # ⭐ Blender parametrik model üreticisi
│       ├─ generate.py           # giriş noktası (blender --background)
│       ├─ civil.py  intake.py  pumps.py  piping.py  water.py
│       ├─ naming.py  shading.py  export.py
│       └─ dn_table.py           # DN → dış çap / flanş ölçüleri
├─ sim/
│   └─ simulator.py              # gerçekçi telemetri üreteci (asyncio + paho-mqtt)
├─ gateway/                      # Faz 7: gerçek PLC sürücüleri
├─ api/                          # FastAPI: WS push, geçmiş, alarm motoru
│   ├─ main.py  alarms.py  rules.py  history.py
├─ web/                          # React + R3F 3D HMI
│   ├─ src/scene/                # sahne, kamera, seçim, vurgulama
│   ├─ src/ui/                   # paneller, alarm listesi, trend
│   ├─ src/data/                 # WS istemcisi, tag store (zustand)
│   └─ public/models/            # üretilmiş .glb dosyaları
├─ build/                        # üretilen model çıktıları (git'e girmez)
└─ deploy/
    ├─ kiosk.service  chromium-flags  overlayfs-setup.sh
```

---

## 5. İsimlendirme Standardı (üretici tarafından dayatılır)

```
<VARLIK>__<GRUP>__<BILESEN>

PMP-01__MOTOR__BODY            motor gövdesi
PMP-01__MOTOR__BEARING-DE      tahrik tarafı rulman      ← ayrı mesh, ayrı renklenebilir
PMP-01__MOTOR__BEARING-NDE     karşı taraf rulman        ← ayrı mesh
PMP-01__MOTOR__TERMBOX         klemens kutusu
PMP-01__COUPLING               kaplin
PMP-01__PUMP__CASING           salyangoz gövde
PMP-01__PUMP__SEAL             mekanik salmastra         ← sızıntı sensörü noktası
PMP-01__BASE                   kaide plakası
VLV-03__BODY / VLV-03__ACTUATOR
GATE-02__LEAF / GATE-02__FRAME / GATE-02__HOIST
RACK-01                        ızgara
HDR-01                         kolektör (akış animasyonlu)
WATER__BASIN                   su yüzeyi (seviye animasyonlu)
STATIC__CIVIL                  beton yapı (tek mesh'e birleştirilir)
```

Kural: **arıza gösterilecek her nokta ayrı bir mesh olmalı.** Üretici bunu garanti eder.

---

## 6. Bileşen → Sensör Haritası

| 3D bileşen | Ölçüm | Sensör | Alarm eşiği (tipik) |
|---|---|---|---|
| `MOTOR__WINDING-U/V/W` | Sıcaklık | PT100 | 130 °C uyarı / 155 °C alarm |
| `MOTOR__BEARING-DE` | Sıcaklık + titreşim | PT100 + ivmeölçer | 75/85 °C, 4.5/7.1 mm/s (ISO 10816) |
| `MOTOR__BEARING-NDE` | Sıcaklık + titreşim | aynı | aynı |
| `COUPLING` | Eksenel titreşim | ivmeölçer | — |
| `PUMP__SEAL` | Sızıntı | kaçak sensörü | dijital |
| `PUMP__CASING` | Emme/basma basıncı | basınç transmitteri 4–20 mA | kavitasyon tespiti |
| `HDR-xx` | Debi | elektromanyetik debimetre | — |
| VFD | Akım, frekans, DC bus, arıza kodu | sürücüden Modbus | — |
| `VLV-xx` | Açık/kapalı/pozisyon | limit switch / 0–100 % | — |
| `GATE-xx` | Pozisyon %, termik, limit | enkoder | — |
| `WATER__BASIN` | Seviye | radar / ultrasonik | düşük seviye → pompa koruma |

> **Kritik uyarı:** Bir bileşeni kırmızı gösterebilmek için o noktada **fiziksel sensör olmalı**.
> Sahada yoksa çözünürlük ekipman seviyesinde kalır ("PMP-01 arızalı"). Simülasyon fazında
> tümünü üretiyoruz; gerçek sahada eksik olanlar enstrümantasyon teklifi olarak çıkarılır.

---

## 7. Arayüz Tasarımı

**ISA-101 / EEMUA 191 yüksek performanslı HMI kuralları:** proses gri tonlarda,
**renk yalnızca alarm ve durum için**. Rengarenk ekran operatörde alarm körlüğü yaratır.
Bu prensip arayüzü "oyun" değil "endüstriyel ürün" yapan şeydir.

### Navigasyon
```
Genel Bakış → Bölge (emme / pompa salonu / basma hattı) → Ekipman (PMP-01) → Bileşen (DE rulman)
```

### Etkileşim
| Dokunma | Sonuç |
|---|---|
| Ekipman | Kamera yumuşak geçişle çerçeveler + sağdan detay paneli |
| Su yüzeyi | Seviye, debi, akış hızı, hacim kartı |
| Arızalı parça | Yakınlaş + patlatılmış görünüm + arıza detayı + trend + geçmiş |
| Alarm listesi satırı | Kamera ilgili ekipmana uçar |
| Zaman çubuğu | Playback — geçmiş anın 3D durumu oynatılır |

### Görsel durum dili
| Durum | Görsel |
|---|---|
| Normal | Nötr gri |
| Çalışıyor | Yumuşak mavi vurgu + boru içinde akış animasyonu |
| Uyarı | Amber kontur, yanıp sönme yok |
| Alarm | Kırmızı emissive + yavaş nabız + 3D etiket |
| Bakımda | Çapraz tarama, gri |
| Veri yok | Yarı saydam + "?" — **son değeri canlıymış gibi gösterme** |

Dokunmatik: min 48 px hedef, hover'a bağlı bilgi yok, kamera açıları sınırlı
(kullanıcı sahneyi kaybedemez), her ekranda "Ana Görünüm" butonu.

---

## 8. Faz Planı

| Faz | İş | Çıktı | Süre |
|---|---|---|---|
| **0. Fizibilite** | Pi 4'e Blender'sız test .glb yükle, FPS ölç; RAM tespiti; Chromium kiosk ayarları | Git/no-go + gerçek performans sayıları | 2–3 gün |
| ~~1. Veri omurgası~~ | ✅ **TAMAM** — Simülatör + Mosquitto + FastAPI + WS + TimescaleDB + alarm motoru | 226 tag canlı akıyor, 192 alarm kuralı, uçtan uca test geçti | — |
| ~~2. Model üreticisi~~ | ✅ **TAMAM** — civil, intake, pumps, piping, water, naming, shading, export | 3 varyant üretildi, model↔veri çapraz doğrulaması geçti | — |
| **3. 3D çekirdek** | Yükleme, orbit (sınırlı), raycast seçim, kamera çerçeveleme, breadcrumb | Pi 4'te 30 FPS gezilebilir tesis | 1.5 hafta |
| **4. Canlı bağlama** | Su seviyesi, akış animasyonu, kapak pozisyonu, pompa durumu | Çalışan L1 dijital ikiz | 1.5 hafta |
| **5. Alarm & teşhis** | Kural motoru, bileşen kırmızı, patlatılmış görünüm, detay kartları | L2 dijital ikiz | 2 hafta |
| **6. Geçmiş & playback** | Trend (uPlot), zaman çubuğu, CSV dışa aktarma | Analiz yeteneği | 1 hafta |
| **7. Saha** | Kiosk sertleştirme, watchdog, read-only FS, **gerçek PLC gateway'i**, kabul testi | Devreye alınmış sistem | 1.5 hafta |

Toplam ~10–11 hafta (tek geliştirici).

---

## 9. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Pi 4 GPU'su yetmez | **Yüksek** | Faz 0'da ölç; 720p→540p, bölge culling, donanım yükseltme yedekleri hazır |
| Pi 4 RAM'i 1–2 GB | Yüksek | İlk iş tespit; 4 GB'a yükselt |
| Gerçek ölçüler yok | Orta | Her ölçü config'de, güncelleme dakikalar sürer |
| Sahada bileşen sensörü yok | Yüksek | Envanter çıkar; çözünürlüğü ekipman seviyesine indir; sensör teklifi ayrı kalem |
| Kapsam kayması (kumanda talebi) | Orta | Faz 1–7 salt izleme; kumanda ayrı faz, PLC interlock şart |
| Blender üreticisi karmaşıklaşır | Orta | Modül başına tek sorumluluk, her modül tek başına test edilebilir |

---

## 10. Güvenlik İlkesi

İlk sürüm **salt okunur**. 3D arayüzden kumanda yok. Kumanda istenirse ayrı faz:
kullanıcı yetkilendirme, iki adımlı onay, denetim kaydı — ve **güvenlik mantığı asla HMI'da
değil, PLC'de**. HMI çökse bile tesis güvenli kalmalı.

---

## 11. Hemen Gereken İki Şey

1. **Blender kurulumu** (ücretsiz, ~400 MB) — model üreticisi bunun üzerinde çalışacak
   ```bash
   brew install --cask blender
   ```
2. **Pi'nin RAM'i ve OS sürümü** — performans bütçesini kesinleştirmek için
   ```bash
   cat /proc/device-tree/model; free -h; cat /etc/os-release | head -2
   ```
