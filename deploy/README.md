# Raspberry Pi 4 — Sahaya Alma

Hedef: açılışta kendiliğinden gelen, dokunmatik ekranda tam ekran çalışan,
elektrik kesintisine dayanıklı bir kiosk.

## 0. Ön koşullar

```bash
cat /proc/device-tree/model; free -h; head -2 /etc/os-release
```

| Gereksinim | Not |
|---|---|
| Raspberry Pi 4 Model B, **en az 4 GB** | 1–2 GB modelde Chromium + Docker sıkışır |
| Raspberry Pi OS **Bookworm 64-bit** | 32-bit'te TimescaleDB arm64 imajı çalışmaz |
| KMS sürücüsü etkin | `/boot/firmware/config.txt` içinde `dtoverlay=vc4-kms-v3d` |
| Soğutma | Sürekli 3D render CPU/GPU'yu ısıtır; ısı kısması FPS'i düşürür |

## 0.5 Bağlantı: ağ mı, USB-C mi?

**Ağ (önerilen).** Pi'yi modeme ethernet ile bağla ya da WiFi'ye al. SSH açılır,
Docker imajları iner, ve sahada zaten böyle çalışacak.

**USB-C gadget modu** Pi 4'te desteklenir (Pi 5'te DESTEKLENMEZ — orada USB-C
yalnız güç). Ama üç dezavantajı var:

| Sorun | Neden |
|---|---|
| İnternet | Docker imajları ~700 MB iner; Mac'in bağlantısını paylaştırman gerekir |
| Güç | Pi 4 yük altında 5V/3A ister. Mac portundan beslersen düşük voltaj kısması FPS'i düşürür — tam da ölçmek istediğimiz şeyi bozar |
| Kurulum | SD kartta `config.txt`'ye `dtoverlay=dwc2`, `cmdline.txt`'ye `modules-load=dwc2,g_ether` eklemek gerekir |

### USB-C gadget kurulumu (ağa bağlanamıyorsan)

Kurumsal ağda IP kaydı gerekiyorsa Pi'yi doğrudan Mac'e bağla. Mac'in
**İnternet Paylaşımı** özelliği Pi'yi kendi bağlantısı üzerinden NAT'lar —
kurumsal ağ yalnız Mac'i görür, Pi'nin IP kaydına gerek kalmaz.

```bash
./deploy/prepare-sd.sh
```

SD kart Mac'te takılıyken çalıştır. Boot bölümüne `dtoverlay=dwc2`,
`modules-load=dwc2,g_ether` ve `ssh` dosyasını ekler; her dosyanın `.bak`
yedeğini alır.

Sonra: kartı Pi'ye tak → USB-C'yi Mac'e **veri kablosuyla** bağla (şarj kablosu
veri taşımaz) → ~60 sn bekle → `ping raspberrypi.local`.

Mac ayarları → Genel → Paylaşma → İnternet Paylaşımı: kaynak Wi-Fi, hedef
*RNDIS/Ethernet Gadget*. Bu yalnız **Docker'ı kurmak için** gerekli; proje
imajları çevrimdışı taşınıyor.

⚠️ **Güç uyarısı.** Pi 4'te USB-C tek porttur: hem güç hem veri. Mac'ten
beslenirken 3D render altında düşük voltaj kısması olabilir ve bu tam da
ölçmek istediğimiz FPS'i bozar. Kurulumdan sonra mutlaka bak:

```bash
vcgencmd get_throttled
```

`0x0` değilse sonuçlar güvenilir değil — Pi'yi kendi adaptöründen besleyip
ölçümü tekrarla.

### Ağ kararlılığı — DHCP tuzağı

Noktadan noktaya bir linkte (Mac'e doğrudan kablo) DHCP sunucusu yoktur.
NetworkManager varsayılan `ipv4.method=auto` ile DHCP'yi sonsuza kadar dener ve
**her denemede arayüzü indirip kaldırır**. Ethernet linki (PHY) ayakta kalır ama
IP yığını gider gelir; SSH oturumları rastgele kopar ve bu "güç yetersiz" gibi
görünür. Ayırt etmenin yolu `uptime`: Pi yeniden başlamıyorsa sorun güç değildir.

```bash
sudo nmcli con mod "Wired connection 1" ipv4.method link-local
sudo nmcli con up "Wired connection 1"
```

`deploy/stabilize-link.sh` bunu otomatik uygular (Pi erişilebilir olur olmaz).

### Saat — RTC yok, NTP yok

Pi 4'te donanım saati **yoktur**. Ağa bağlı değilse NTP de çalışmaz. Sonuç:
her elektrik kesintisinde saat `fake-hwclock`'un kaydettiği son kapanış anına
döner ve oradan sürüklenir. Sahada 22 saatlik sapma ölçüldü.

Yanlış saatin görünen etkileri: alarm yaşları ("15 sn önce") saçmalar, trend
ekseni kayar, oynatma çubuğu geçmişi bulamaz.

`push-to-pi.sh` her dağıtımda saati ve saat dilimini masaüstünden eşitler.
Kalıcı çözüm iki seçenekten biri:

| Çözüm | Not |
|---|---|
| **DS3231 RTC modülü** (~3 $) | I²C'ye takılır, pil ile saati korur. Ağsız kiosk için doğru çözüm. |
| Ağ + NTP | Tesis ağına bağlanacaksa zaten çözülür. |

### Çevrimdışı kurulum

```bash
./deploy/push-to-pi.sh pi@raspberrypi.local --offline
```

Docker imajları Mac'te paketlenip (199 MB sıkıştırılmış) Pi'ye taşınır.
Apple Silicon Mac ve 64-bit Pi OS ikisi de `linux/arm64` olduğu için imajlar
birebir uyumludur; script mimarileri kontrol eder ve uymazsa durur.

Pi'de gereken tek şey **Docker**. Blender, Node.js, Python gerekmez.

## 1. Kurulum

```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
```

Oturumu kapatıp aç, sonra proje dizininde:

```bash
blender --background --python tools/genmodel/generate.py -- --config stations/ps-01.json --out build/ps-01.glb
```

Masaüstünden tek komutla gönder ve başlat:

```bash
./deploy/push-to-pi.sh pi@<pi-adresi>
```

Bu script modelleri **masaüstünde** üretir, arayüzü **masaüstünde** derler ve
yalnız hazır dosyaları gönderir. Pi'de Blender, Node.js ya da Python kurulu
olmasına gerek yok — sadece Docker.

Göndermeden önce Pi'nin hazır olup olmadığına bak (hiçbir şey değiştirmez):

```bash
./deploy/check-pi.sh pi@<pi-adresi>
```

### Veritabanı imajı seçimi

| İmaj | Boyut | Ne zaman |
|---|---|---|
| `timescale/timescaledb:latest-pg16` (varsayılan) | 2,27 GB | SSD varsa, uzun geçmiş tutulacaksa |
| `postgres:16-alpine` | 250 MB | SD kartta yer darsa |

API hypertable yoksa **düz PostgreSQL'e düşer** — trend, geçmiş oynatma ve tüm
sorgular çalışmaya devam eder, yalnız çok büyük veri hacminde daha yavaştır.

```bash
echo "DB_IMAGE=postgres:16-alpine" >> .env && docker compose --profile kiosk up -d
```

⚠️ İmaj değişimi ancak **temiz birimle** çalışır. TimescaleDB ile kurulmuş bir
birimin `postgresql.conf`'unda `shared_preload_libraries = 'timescaledb'` yazılıdır
ve düz postgres o birimle açılmaz. Değiştireceksen önce `docker compose down -v`.

## 2. Kiosk servisi

```bash
mkdir -p ~/.config/systemd/user && cp deploy/twin-kiosk.service ~/.config/systemd/user/
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now twin-kiosk
```

```bash
sudo loginctl enable-linger $USER
```

Son komut, kullanıcı oturum açmadan da servisin başlamasını sağlar — elektrik
gelince ekran kendiliğinden açılır.

Servis, arayüzü açmadan önce `/api/health` yanıt verene kadar bekler (en fazla
2 dakika). Chromium donarsa systemd öldürüp yeniden başlatır.

X11 kullanıyorsan `deploy/chromium-flags.conf` içindeki iki `ozone` satırını sil.

## 3. Performans ölçümü

Arayüzdeki **Performans ölç** butonu 1280×720'de 150 kare çizip sonucu gösterir.
Ölçüm kapalı bir render hedefine yapılır ve `readPixels` ile senkronize edilir —
`gl.finish()` bazı sürücülerde gerçekten beklemez ve sahte sonuç verir.

### Sahada ölçülen sonuç (Pi 4 Model B Rev 1.4, 4 GB, Bookworm)

| Aşama | ms/kare @1280×800 | fps |
|---|---|---|
| Başlangıç — GPU kullanılmıyordu | 111 | 9 |
| GPU açıldı | 50,1 | 20 |
| **`backdrop-filter` kaldırıldı** | **19,9** | **50** |
| Bütçe | 33 | 30 |

Ekran dışı saf render, çözünürlüğe göre (dolgu hızı sınırlı, poligon değil):

| Çözünürlük | ms/kare | fps |
|---|---|---|
| 800×480 | 7,5 | 133 |
| 960×540 | 10,2 | 98 |
| 1024×600 | 11,9 | 84 |
| 1280×720 | 17,4 | 57 |

Referans: Apple M4 aynı sahnede 1280×720'de 0,497 ms/kare.

### Sahada bulunan üç tuzak

**1. `--use-gl=egl` Chromium 136'da GEÇERSİZ.** Geçersiz değer görünce Chromium
sessizce SwiftShader'a (CPU yazılım render'ı) düşüyor ve hiçbir uyarı vermiyor.
Doğrusu:

```
--use-gl=angle
--use-angle=gl
```

Kontrol: `chrome://gpu` ya da sayfada `WEBGL_debug_renderer_info`. Renderer'da
`SwiftShader` yazıyorsa GPU kullanılmıyordur. Doğrusu
`ANGLE (Broadcom, V3D 4.2.14.0, Mesa …)`.

**2. `backdrop-filter: blur()` kare süresini ikiye katlıyor.** Bulanıklık arkadaki
kareyi geri okuyup işlemeyi gerektirir; VideoCore VI bunu her karede yapamaz.
Ölçüldü: beş panelde bulanıklık 19,9 ms'yi 50,1 ms'ye çıkarıyor, p95'i 33 ms'den
133 ms'ye. Arayüz CSS'inde bu özellik yasaktır.

**3. labwc dokunmayı fareye çeviriyor.** Raspberry Pi OS varsayılanı
`mouseEmulation="yes"` — dokunma olayları Chromium'a **fare** olarak ulaşır,
tek `pointerId` ile. İki parmak jestleri (yakınlaştırma) çalışmaz.
`~/.config/labwc/rc.xml` içinde:

```xml
<touch deviceName="..." mapToOutput="DSI-1" mouseEmulation="no"/>
```

Sonra `pkill -HUP -x labwc`. Kontrol: sayfada `pointerType` değeri `touch`
olmalı, `mouse` değil.

### Hâlâ tıkanırsa

1. Ekran çözünürlüğünü düşür (dolgu hızı sınırlı, poligon değil)
2. `--force-device-scale-factor=0.75`
3. `TwinScene` içinde `antialias: false`
4. Donanım: Orange Pi 5 / Rock 5B (~2× GPU) veya Intel N100 mini PC

## 4. Elektrik kesintisine dayanıklılık

SD kart, yazma sırasında gelen kesintide bozulur. Sisteme alıştıktan sonra
kök dosya sistemini salt okunur yap:

```bash
sudo raspi-config nonint do_overlayfs 0
```

Docker verisi (`/var/lib/docker`) ve TimescaleDB birimleri salt okunur olamaz —
onları ayrı bir bölüme ya da USB SSD'ye taşı. **SD kart üzerinde sürekli veritabanı
yazmak kartı aylar içinde bitirir; SSD şiddetle önerilir.**

Log yazımını azalt:

```bash
sudo apt install -y log2ram
```

## 5. Uzaktan bakım

```bash
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
```

SSH'ı yalnız anahtarla aç, parola girişini kapat. 3D arayüz salt okunur olduğu
için dışarıya açmak risk taşımaz, ama yine de VPN arkasında tut.

## 6. Bakım komutları

| İş | Komut |
|---|---|
| Durum | `docker compose ps` |
| Loglar | `docker compose logs -f api` |
| Kiosk yeniden başlat | `systemctl --user restart twin-kiosk` |
| Model güncelle | `build/` dizinini kopyala, `docker compose --profile kiosk up -d --build web` |
| Sıcaklık / kısma | `vcgencmd measure_temp && vcgencmd get_throttled` |

`get_throttled` çıktısı `0x0` değilse ısı kısması ya da besleme sorunu var —
FPS düşüklüğünü önce burada ara.

## 7. Simülatörden gerçek PLC'ye geçiş

Devreye alma günü tek değişiklik: `docker-compose.yml` içinde `sim` servisini
durdur, `gateway` servisini başlat. API ve arayüzde **tek satır değişmez** —
ikisi de aynı MQTT sözleşmesini konuşur (`docs/MQTT-CONTRACT.md`).

```bash
docker compose stop sim && docker compose up -d gateway
```

Ayrıca `POST /api/dev/fault` ucunu sahada kapat — geliştirme aracıdır.

## Isınma ve donma

Sahada ölçüldü: sürekli çalışan kiosk **54 dakikada 55 °C'den 74,5 °C'ye** çıktı.
Pi 4'te yumuşak kısma **80 °C**, sert kısma **85 °C**'de başlar. Kısma başlayınca
ARM frekansı düşer, kare süresi uzar ve arayüz **donuyor gibi görünür** —
sebep kod değil ısıdır.

```bash
./deploy/thermal-check.sh                 # anlık teşhis
./deploy/thermal-check.sh izle 600        # 10 dakika CSV kaydı
```

`get_throttled` çıktısı `0x0` değilse yorumu script yapar. Yapışkan bitler
(`0x1____`) "geçmişte oldu" demektir — anlık değer temiz olsa bile geçmişte
kısma yaşandığını gösterir.

### Sebepler ve çözümleri, etki sırasına göre

**1. Soğutma yok (en büyük etken).** Pi 4 pasif soğutmayla sürekli 3D render
kaldıramaz. Isı emici + fan şart. Fansız bir kutu içindeyse durum daha kötü:
DSI ekran da aynı hacmi ısıtır.

**2. Sahne sürekli tam hızda render ediliyordu.** İlk sürümde kare hızı sınırı
yoktu; 50 fps demek GPU'nun hiç boş kalmaması demek. Düzeltildi:

| Mod | Kare hızı | Ne zaman |
|---|---|---|
| Aktif | 30 fps | dokunma, kamera hareketi, akış animasyonu |
| Boşta | 6 fps | 2,5 sn hareketsizlikten sonra |

Herhangi bir etkileşim ya da **gerçek** durum değişimi anında uyandırır.
"Gerçek" önemli: veri 5 Hz akıyordu ve sahne her akışta uyanıyordu; artık
sağlık/durum/akış haritaları öncekiyle karşılaştırılıyor, değişmediyse
hiçbir şey yapılmıyor.

**3. Gereksiz arka plan servisleri.** Sahada `wayvnc` ve `influxdb` çalışır
durumda bulundu — kiosk için gereksiz, sürekli CPU tüketiyorlar.
`thermal-check.sh` bunları listeler.

**4. Simülatör ve yayın hızları.** Üç simülatör 10 Hz fizik + 5 Hz yayın
yapıyordu. 5 Hz fizik + 2 Hz yayına indirildi — bir SCADA ekranı için
fazlasıyla yeterli, CPU yükü belirgin düşer.

### Kısma olup olmadığını nasıl anlarsın

Donma yaşadığında `vcgencmd get_throttled` ve `vcgencmd measure_clock arm`
bak. ARM frekansı 1500 MHz yerine 1000-1200 MHz gösteriyorsa kısma
başlamıştır ve sorun ısıdır, yazılım değil.
