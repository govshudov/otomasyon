# Teknoloji Yığını — Ne Kullandık, Nerede, Neden

> Sorunun kısa cevabı: **Pi'de yalnız Docker + Chromium var.** Python, Node.js
> ve Blender Pi'ye hiç kurulmadı — hepsi geliştirme makinesinde kalıyor.

---

## 1. Pi'de fiilen çalışan her şey

| Katman | Ne | Sürüm | Nereden geldi |
|---|---|---|---|
| İşletim sistemi | Raspberry Pi OS (Debian 12 Bookworm), 64-bit | — | Karta zaten kuruluydu |
| Pencere yöneticisi | labwc (Wayland) | — | OS ile birlikte |
| Tarayıcı | Chromium | 136.0.7103.92 | OS ile birlikte |
| GPU sürücüsü | Mesa V3D (VideoCore VI) | V3D 4.2.14.0 | OS ile birlikte |
| Konteyner motoru | Docker CE | 29.7.2 | **Biz kurduk** (çevrimdışı .deb) |
| " | containerd | 2.3.4 | Docker bağımlılığı |
| " | Compose eklentisi | 5.5.0 | Docker bağımlılığı |
| Servis yöneticisi | systemd (kullanıcı servisi) | — | OS ile birlikte |

> Sürümler kurulum oturumunda (Ağustos 2026) alındı. Pi şu an ağdan ayrı;
> teyit için Pi'de: `docker version`, `chromium --version`, `glxinfo -B`.

Docker'ı kurmak için tek ek paket gerekti: `iptables` + `libip6tc2`. Onları da
Debian havuzundan indirip elle taşıdık — Pi hiç internete çıkmadı.

### Pi'de kurulu systemd birimleri ve kısayollar

| Dosya | Ne yapar |
|---|---|
| `~/.config/systemd/user/twin-kiosk.service` | Açılışta Chromium'u tam ekran başlatır |
| `~/.config/labwc/rc.xml` | `mouseEmulation="no"` — çoklu dokunma için şart |
| `~/.config/chromium-flags.conf` | `--use-gl=angle --use-angle=gl` (GPU'yu açan iki satır) |
| `~/Masaüstü/dijital-ikiz.desktop` | Elle açma kısayolu |
| `~/Masaüstü/dijital-ikiz-kapat.desktop` | Elle kapatma kısayolu |
| `loginctl enable-linger` | Kullanıcı oturum açmadan da servislerin çalışması için |

`fake-hwclock` ile saat kapanırken diske yazılıyor (Pi'de RTC yok, ağ da yok).

> **Açık nokta:** Docker kurulumu elle yapıldı, scripti yok. `deploy/` içinde
> uygulama dağıtımı tamamen otomatik (`push-to-pi.sh`) ama sıfırdan bir Pi'yi
> hazırlamak için Docker'ı elle kurmak gerekiyor. İkinci bir cihaz kurulacaksa
> bu adım scriptlenmeli — `deploy/README.md` "Çevrimdışı kurulum" bölümünde
> komutlar yazılı.

**Pi'de OLMAYAN şeyler:** Python, Node.js, npm, Blender, git, derleyici.
Model üretimi ve arayüz derlemesi masaüstünde yapılıp hazır dosya gönderiliyor.

### Pi'de çalışan konteynerler

| Konteyner | İmaj | Boyut | İşi |
|---|---|---|---|
| `twin-api` | `python:3.12-slim` üstüne kendi imajımız | ~62 MB | MQTT→WebSocket köprüsü, alarm motoru, geçmiş |
| `twin-sim` ×3 | `python:3.12-slim` üstüne kendi imajımız | ~47 MB (paylaşılan) | Üç istasyonun fizik simülatörü |
| `twin-mqtt` | `eclipse-mosquitto:2` | 36 MB | MQTT broker |
| `twin-web` | `nginx:alpine` | 93 MB | Arayüzü sunar, API'yi proxy'ler |
| `twin-db` | `postgres:16-alpine` | 250 MB | **Şu an kapalı** — demo modunda geçmiş bellekte |

Toplam çevrimdışı paket: **199 MB** (sıkıştırılmış). Pi'nin internete çıkmasına
hiç gerek yok; imajlar masaüstünde `docker save` ile paketlenip taşınıyor.

---

## 2. Diller

| Dil | Satır | Nerede | Neden bu dil |
|---|---|---|---|
| **Python** | 5.249 | Simülatör, API, Blender model üreticisi, testler | Blender'ın gömülü dili Python; aynı dili API ve simülatörde de kullanmak tek zihinsel model demek |
| **TypeScript** | 2.580 | 3D sahne (1.749) + React arayüzü (831) | Tip güvenliği; 130 bileşenli bir sahnede isim/alan hatalarını derleme anında yakalıyor |
| **GLSL** | ~40 | Vertex/fragment shader (TypeScript içine gömülü) | Bileşen boyama, patlatma, akış animasyonu GPU'da |
| **Bash** | 537 | Dağıtım, teşhis, kiosk scriptleri | Pi'de ek çalışma zamanı gerektirmiyor |
| **SQL** | ~60 | Geçmiş veri sorguları (Python içinde) | TimescaleDB / PostgreSQL |
| **CSS** | 266 | Arayüz | — |
| **JSON** | 24.835 | Konfigürasyon + üretilmiş eşleme dosyaları | Büyük kısmı `twin-map.json` — üretici yazıyor, elle yazılmıyor |
| **YAML** | 177 | Docker Compose | — |
| **Markdown** | 1.312 | Belgeler | — |

Toplam elle yazılmış kod: **~8.700 satır**.

---

## 3. Araçlar ve kütüphaneler

### 3D model üretimi (yalnız geliştirme makinesinde)

| Araç | Sürüm | Lisans | Ne için |
|---|---|---|---|
| **Blender** | 5.2.1 LTS | GPL-3.0 | Geometri üretimi — komut satırından, arayüzsüz |
| `bpy` (Blender Python API) | — | GPL-3.0 | Kanal, pompa, boru, kapak geometrisi kod ile üretiliyor |
| `bmesh` | — | GPL-3.0 | Düşük seviye mesh inşası (poligon bütçesi kontrolü) |
| `mathutils.BVHTree` | — | GPL-3.0 | Ambient occlusion ışın izleme — saniyede 2,7 milyon ışın |
| **Draco** | Blender içinde | Apache-2.0 | Mesh sıkıştırma (~3,5× küçültme) |
| glTF 2.0 | — | Açık standart | Çıktı formatı |

> **Lisans notu:** Blender GPL-3.0'dır ve `bpy` kullanan scriptler Blender
> Vakfı'na göre türev eser sayılır. Ancak **üretilen `.glb` dosyası GPL değildir**
> — tıpkı GCC ile derlenen programın GPL olmaması gibi. Blender'ı ürünle birlikte
> dağıtmıyoruz, yalnız derleme aracı olarak kullanıyoruz. Üretici scriptlerini
> müşteriye vermek isterseniz bu konu gözden geçirilmeli.

### Backend (Pi'de konteyner içinde)

| Kütüphane | Sürüm | Lisans | Ne için |
|---|---|---|---|
| **FastAPI** | 0.115.6 | MIT | REST + WebSocket sunucusu |
| **Uvicorn** | 0.34.0 | BSD-3 | ASGI sunucusu |
| **aiomqtt** | 2.3.0 | BSD-3 | API'nin MQTT aboneliği (asyncio) |
| **paho-mqtt** | 2.1.0 | EPL-2.0 / EDL-1.0 | Simülatörün MQTT yayını |
| **asyncpg** | 0.30.0 | Apache-2.0 | PostgreSQL sürücüsü (geçmiş veri) |

Simülatörün fizik motoru **sıfır bağımlılıkla** yazıldı — pompa eğrileri,
paralel çalışma çözümü, termal modeller, kavitasyon ve PLC kademe mantığı
saf Python (`math`, `random`).

### Frontend (masaüstünde derlenir, Pi'de statik dosya olarak sunulur)

| Kütüphane | Sürüm | Lisans | Ne için |
|---|---|---|---|
| **three.js** | 0.171 | MIT | WebGL 3D motoru |
| **React** | 19.1 | MIT | Yalnız paneller — 3D döngüsünde React yok |
| **zustand** | 5.0.2 | MIT | Durum yönetimi (canlı tag deposu) |
| **TypeScript** | 5.7.2 | Apache-2.0 | — |
| **Vite** | 6.0.5 | MIT | Derleme aracı |

Grafik kütüphanesi **kullanılmadı** — trend grafikleri 120 satır canvas kodu.
Pi'de ölçülebilir maliyeti olan her bağımlılıktan kaçındık.

### Altyapı

| Araç | Sürüm | Lisans | Nerede |
|---|---|---|---|
| **Docker CE** | 29.7.2 | Apache-2.0 | Pi + masaüstü |
| **Eclipse Mosquitto** | 2 | EPL-2.0 | Pi (konteyner) |
| **nginx** | alpine | BSD-2 | Pi (konteyner) |
| **PostgreSQL** | 16-alpine | PostgreSQL Lisansı | Pi (şu an kapalı) — `push-to-pi.sh` varsayılanı |
| **TimescaleDB** | pg16 | Apache-2.0 | Compose varsayılanı ama imaj 2,27 GB — Pi'de SSD varsa |
| **Grafana OSS** | latest | AGPL-3.0 | İsteğe bağlı profil, kullanılmıyor |

### Geliştirme ve teşhis araçları (kendi yazdıklarımız)

| Araç | Dil | Ne yapar |
|---|---|---|
| `tools/genmodel/` | Python + bpy | JSON'dan `.glb` + `twin-map.json` üretir (9 modül) |
| `tools/make_station.py` | Python | Yeni istasyon konfigürasyonu üretir |
| `tools/cdp.py` | Python | Chrome DevTools Protocol istemcisi — bağımlılıksız, ham soket üzerine WebSocket |
| `tools/pi-eval.sh` | Bash | Pi'deki Chromium'da JS çalıştırır, tüneli kendi kurar |
| `deploy/push-to-pi.sh` | Bash | Model üret → arayüz derle → imaj paketle → gönder → başlat |
| `deploy/check-pi.sh` | Bash | Donanım/OS/GPU/Docker hazırlık raporu |
| `deploy/thermal-check.sh` | Bash | Sıcaklık, kısma bitleri, CPU yükü, gereksiz servisler |
| `deploy/stabilize-link.sh` | Bash | NetworkManager DHCP döngüsünü kalıcı düzeltir |
| `tests/` ×3 | Python | Simülatör zinciri, model↔veri tutarlılığı, canlı yığın |

**Hepsi bağımlılıksız.** Test paketleri `pytest` bile kullanmıyor; CDP istemcisi
WebSocket kütüphanesi kullanmıyor. Sebep: Pi'de ya da CI'da ek kurulum gerekmesin.

---

## 4. Geliştirme makinesi vs Pi

```
MASAÜSTÜ (macOS / Linux)                    RASPBERRY PI 4
────────────────────────────                ──────────────────────
Blender 5.2       → .glb üretir             (Blender YOK)
Node 22 + Vite    → dist/ derler            (Node YOK)
Python 3.12       → testler, araçlar        (Python YOK — konteyner içinde var)
Docker            → imaj derler + paketler  Docker → imajları çalıştırır
                                            Chromium → arayüzü gösterir
        │                                          ▲
        └──── rsync + docker save/load ────────────┘
                    (SSH üzerinden, 199 MB)
```

Bu ayrımın sebebi: Pi 4'te `npm ci` + Vite derlemesi dakikalar sürer ve RAM
yer. Blender'ı Pi'ye kurmak ise hem gereksiz hem de ARM'de sancılı. Masaüstünde
saniyeler süren iş, Pi'de dakikalara çıkıyor — o yüzden Pi yalnız çalıştırıyor.

---

## 5. Bilerek KULLANILMAYAN araçlar

| Araç | Neden değil |
|---|---|
| **Qt / Qt Quick 3D** | En ciddi alternatif — ayrıntı aşağıda. Kapı kapalı değil. |
| **React Three Fiber** | Her karede React uzlaştırması Pi 4'te lüks. React yalnız panellerde. |
| **Unity / Unreal** | Pi'de pratik değil; ücretli/ağır. PixelStreaming sunucu gerektirir. |
| **Godot** | 3D iyi ama HTML/CSS panelleri kadar hızlı ve şık arayüz yapmak zor. |
| **uPlot / Chart.js** | 120 satır canvas yeterliydi; her bağımlılık Pi'de maliyet. |
| **pytest** | Testler saf Python; Pi'de ya da CI'da ek kurulum istemiyoruz. |
| **websockets / websocket-client** | CDP ve test istemcileri ham soketle yazıldı. |
| **Cycles (Blender render motoru)** | AO için kendi BVH ışın izleyicimiz: deterministik, motor bağımsız, 0,8 sn. |
| **Node-RED / FUXA** | Hazır SCADA araçları 2D; 3D dijital ikiz için uygun değil. |


### Qt neden seçilmedi — en ciddi alternatifin muhasebesi

Qt, endüstriyel HMI'ın fiili standardı ve bu işi yapabilirdi. Karşılaştırma:

**Qt'nin kazandığı yerler** (hepsi bu projede fiilen çarptığımız duvarlar):

- Chromium tamamen ortadan kalkardı. EGLFS ile doğrudan KMS/DRM'e çizim —
  pencere yöneticisi, kompozitör, tarayıcı süreç ağacı yok. RAM ~500 MB → ~120 MB.
  **Isınma sorunumuzun büyük kısmı Chromium kaynaklı; Qt'de muhtemelen çıkmazdı.**
- Çoklu dokunma evdev'den doğrudan gelir — `mouseEmulation` tuzağı yaşanmazdı.
- Açılış 35 sn yerine 3-5 sn.
- `Qt OPC UA` ve `Qt Modbus` hazır (gerçi PLC katmanını biz Python'da çözüyoruz).

**Qt'nin kaybettiği yerler:**

- ARM64 çapraz derleme sancılı (sysroot toolchain ya da Pi'de saatlerce derleme).
  Bizim dağıtımda çapraz derleme hiç yok — Docker imajı + rsync.
- C++ değişikliği her seferinde yeniden derleme + dağıtım. Biz kaydet-yenile.
- Uzaktan ölçüm: fps ve ekran görüntülerini CDP ile SSH üzerinden aldık.
  Qt'de kolay karşılığı yok.
- **Tek cihaza hapsolma.** Şu an operatör tesisteki herhangi bir tarayıcıdan
  aynı arayüzü açabilir. Qt uygulaması o Pi'ye ait; uzaktan erişim için ayrıca
  web arayüzü yazmak gerekir. SCADA'da bu ciddi kayıp.

**Lisans — projenin "ücretsiz araç" önceliği açısından belirleyici oldu:**

| Yol | Durum |
|---|---|
| LGPL v3 | Ücretsiz, ama dinamik bağlama ve yeniden bağlanabilirlik şartı var |
| GPL v3 | Ücretsiz, ama kendi kodunu da açmak zorundasın |
| Ticari | Geliştirici başına yıllık dört haneli + olası cihaz başına dağıtım bedeli |

İki ayrıntı: **Qt Charts ve Qt Data Visualization LGPL değil** (GPL veya ticari)
— trend grafiği için tam onlar gerekirdi. **Boot2Qt / Qt for Device Creation**
yalnızca ticari. Lisans koşulları değişebilir, karar öncesi teyit edilmeli.

**Sonuç:** Sistem çalışıyor (50 fps, 72-74 °C, kısma yok). Isı sorununun çözümü
5 $'lık fan, birkaç haftalık yeniden yazım değil.

**Ama kapı kapalı değil:** Qt'ye geçiş yalnız arayüzü etkiler. MQTT sözleşmesi,
FastAPI, simülatör ve alarm motoru aynen kalır. Müşteri "tek cihaz, maksimum
performans, uzaktan erişim gerekmiyor" derse arayüz Qt Quick 3D'ye taşınabilir;
model zaten glTF, Qt'nin `balsam` aracı onu kendi formatına çeviriyor.

---

## 6. Maliyet

**Sıfır lisans ücreti.** Kullanılan her araç açık kaynak ve ticari kullanıma
açık. Tek dikkat noktası yukarıdaki Blender/GPL notu (ürünü değil, üretim
aracını ilgilendiriyor).

Donanım: Raspberry Pi 4 (4 GB) + DSI dokunmatik ekran + güç adaptörü.
Eksik: **fanlı ısı emici** (~5-10 $) — sürekli 3D render için şart.

---

## 7. Çıktı boyutları

Ölçülmüş değerler (`web/dist`, 1 Eylül 2026 derlemesi):

| Ne | Boyut |
|---|---|
| Arayüz (uygulama js) | 307 KB → **94 KB** gzip |
| three.js (ayrı parça) | 508 KB → **127 KB** gzip |
| Model `ps-01.glb` (6 pompa) | 526 KB |
| Model `ps-02.glb` (12 pompa) | 1.022 KB |
| Model `ps-03.glb` (3 pompa) | 291 KB |
| `twin-map.json` (PS-01 / 02 / 03) | 144 / 279 / 78 KB |
| Draco çözücü (wasm + js) | 752 KB |
| **Toplam `dist/`** | **3,8 MB** |
| Docker imajları (çevrimdışı paket) | 199 MB sıkıştırılmış |

Arayüzün tamamı ilk açılışta ~1,1 MB gzip iniyor; sonrası tarayıcı önbelleğinden.
Pi çevrimdışı çalıştığı için hepsi zaten yerelde.

---

## 8. İlgili belgeler

- [PROJE-DURUMU.md](PROJE-DURUMU.md) — mimari, dosya haritası, sahada bulunan
  tuzaklar, PLC'ye geçiş adımları
- [MQTT-CONTRACT.md](MQTT-CONTRACT.md) — simülatör ve gerçek PLC'nin paylaştığı
  konu/yük sözleşmesi
- [../deploy/README.md](../deploy/README.md) — Pi'ye kurulum, kiosk, ısınma
