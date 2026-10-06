# Su Yapısı 3D Dijital İkiz

Pompa istasyonu / su alma yapısının Raspberry Pi üzerinde çalışan 3D dijital ikizi.
Planın tamamı: [PLAN.md](PLAN.md) · MQTT sözleşmesi: [docs/MQTT-CONTRACT.md](docs/MQTT-CONTRACT.md)

## Durum

| Faz | İş | Durum |
|---|---|---|
| 0 | Pi 4 fizibilite ölçümü | ⏳ Pi'de test bekliyor |
| **1** | **Veri omurgası — simülatör, MQTT, API, alarm motoru, geçmiş** | **✅ Tamam** |
| **2** | **Blender parametrik model üreticisi** | **✅ Tamam** |
| **3** | **3D çekirdek + canlı bağlama (three.js)** | **✅ Çalışıyor** |
| **4** | **Trend grafikleri + geçmiş oynatma** | **✅ Çalışıyor** |



| **5** | **Üretim derlemesi + kiosk dosyaları** | **✅ Hazır, Pi'de denenmedi** |
| 6 | Pi 4'te devreye alma ve ölçüm | ⏳ Donanım bekliyor |
| 7 | Kumanda (yetkilendirme + PLC interlock) | — |

## Hızlı başlangıç

```bash
docker compose up -d --build
```

Sonra: **http://localhost:8000** — veri omurgası test arayüzü.

| Servis | Adres | Not |
|---|---|---|
| **3D HMI** | http://localhost:5199 | `npm --prefix web run dev -- --port 5199` |
| Veri test arayüzü | http://localhost:8000 | Canlı tablo + alarm + arıza enjeksiyonu |
| API dokümanı | http://localhost:8000/docs | FastAPI otomatik |
| MQTT | `localhost:1883` | WebSocket: 9001 |
| TimescaleDB | `localhost:5432` | twin / twin / twin |
| Grafana | http://localhost:3000 | `docker compose --profile trends up -d` ile |

Durdurmak için `docker compose down`, veriyi de silmek için `docker compose down -v`.

## Docker olmadan çalıştırma

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r sim/requirements.txt -r api/requirements.txt
```

Üç ayrı terminalde:

```bash
docker run --rm -p 1883:1883 -v "$PWD/infra/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" eclipse-mosquitto:2
```

```bash
python sim/main.py --station stations/ps-01.json --speed 20 --degrade 0.4
```

```bash
uvicorn main:app --app-dir api --reload --port 8000
```

`TIMESCALE_DSN` verilmezse geçmiş veri sessizce devre dışı kalır; canlı görüntü çalışır.

## Mimari

```
sim/  ──MQTT──▶  mosquitto  ──▶  api/  ──WebSocket──▶  web/ (Faz 3)
                                   │
                            TimescaleDB (geçmiş)
```

Simülatör ile gerçek PLC gateway'i **aynı MQTT sözleşmesini** konuşur. Devreye alma
günü `sim` servisi durur, `gateway` başlar — API ve frontend'de tek satır değişmez.

## Dizinler

| Dizin | İçerik |
|---|---|
| `common/equipment_types.json` | Ekipman tip kataloğu: 3D bileşenler + sinyaller + alarm kuralları. **Tek doğruluk kaynağı.** |
| `stations/ps-01.json` | İstasyon örneği: geometri, hidrolik, ekipman listesi, kademe seviyeleri |
| `sim/` | Fizik tabanlı simülatör (pompa eğrileri, termal model, kavitasyon, PLC kademe mantığı) |
| `api/` | FastAPI: MQTT→WebSocket köprüsü, ISA 18.2 alarm motoru, TimescaleDB |
| `tools/genmodel/` | Blender parametrik model üreticisi — JSON → `.glb` + `twin-map.json` |
| `tools/make_station.py` | İstasyon konfigürasyonu üreticisi — yeni tesis = birkaç sayı |
| `web/` | React + three.js 3D HMI (Faz 3) |
| `deploy/` | Pi kiosk servisleri, watchdog, read-only FS (Faz 7) |

## Simülatör ne kadar gerçek?

- **Pompa eğrileri** — `H = s²·H₀ − k·Q²`, affinite yasaları uygulanmış
- **Paralel çalışma** — kolektöre basan pompaların ortak denge noktası bisection ile çözülür
- **Sistem eğrisi** — statik yükseklik havuz seviyesiyle değişir; seviye düşünce debi düşer
- **Verim** — BEP etrafında parabolik; BEP dışında çalışma verimi düşürür
- **Termal** — her rulman/sargı/salmastra için birinci mertebe gecikme, gerçek zaman sabitleriyle
- **Kavitasyon** — emme basıncı düşünce debi ve verim düşer, titreşim artar
- **Titreşim** — hız + BEP sapması + kavitasyon + arıza bileşenlerinden
- **PLC** — kademe mandalları, min çalışma/durma süresi, görev rotasyonu, kuru çalışma koruması
- **Sensörler** — gürültü, ölü bant yayını, sensör kaybı

Bir gözlemlenen sonuç: 38 m statik yükseklikte pompa **%72 hızın altında hiç su basamıyor** —
VFD kısma aralığı hidrolik olarak sınırlı. Bu simülasyonun ürettiği doğru bir mühendislik sonucu.

## Arıza enjeksiyonu

Test arayüzündeki panelden ya da doğrudan:

```bash
docker exec twin-mqtt mosquitto_pub -t twin/PS-01/cmd/fault -m '{"target":"PMP-02","kind":"overheat","severity":1.0}'
```

`kind`: `overheat` (motor) · `vibration` (pompa gövdesi) · `vfd_trip` · `sensor_dropout` · `clear`

## Model üretimi

```bash
blender --background --python tools/genmodel/generate.py -- --config stations/ps-01.json \
        --out build/ps-01.glb --twin-map build/ps-01-twin-map.json --preview build/ps-01.png
cp build/ps-0*.glb build/ps-0*-twin-map.json web/public/models/
```

Yollar mutlak verilmeli ya da proje kökünden çalıştırılmalı: Blender göreli
render yolunu kendi köküne göre çözüyor (önizleme `C:\build\` gibi yere yazılıyordu;
üretici artık yolu kendisi mutlak yapıyor).

Yerleşim referans görseldeki gibidir: dar giriş kanalı → köprü (kapak + ızgara
panelleri) → genişleyen ön havuz → **pompa başına bir emme hücresi** (tek sıra) →
başlık duvarı → hücrelerden yelpaze gibi açılan emme hatları → zikzak iki sıra
pompa (motor yanda) → kompansatör + çekvalf + el çarklı vana → kolektör → ana hat.
Arazi/tepe yok; sahne düz arka plan önünde durur.

Yeni bir istasyon eklemek modelleme işi değil, konfigürasyon işidir:

```bash
python3 tools/make_station.py --id PS-04 --pumps 8 --per-header 4
```

| İstasyon | Pompa | Kolektör | Hücre | Üçgen | GLB | Düğüm |
|---|---|---|---|---|---|---|
| PS-01 | 6  | 2 | 6  | 32.622 | 469 KB | 85 |
| PS-02 | 12 | 4 | 12 | 64.438 | 913 KB | 161 |
| PS-03 | 3  | 2 | 3  | 17.754 | 255 KB | 49 |

Üçünde de tek satır geometri kodu yazılmadı — yalnız konfigürasyon değişti.
Yelpaze çok genişse (PS-02) pompa sıraları ve kolektör kendiliğinden geri çekilir.

### Üreticinin garantileri

- **İsimlendirme kod ile dayatılır.** `PMP-01__PIPE__SUCTION` biçimine uymayan
  isim üretilemez; deneyen üretim hata verir.
- **Model ile veri modeli çapraz doğrulanır.** `equipment_types.json` içinde sinyali
  olan her bileşenin 3D düğümü olmak zorunda. Eksikse üretim durur — çünkü o eksiklik
  sahada "bu arızayı gösteremiyoruz" demektir.
- **Tag bağlantısı modelin içine gömülür.** Her düğüm glTF `extras` alanında
  `station / equipment / eq_type / component` taşır; frontend isim ayrıştırmaz.
- **Kamera çerçeveleri önceden hesaplanır.** "Arızalı parçaya dokun → yakınlaş"
  için her düğümün hedef noktası ve yarıçapı `twin-map.json` içinde hazır.
- **Işık köşe renklerine pişirilir.** Doku yok, gerçek zamanlı ışık yok — Pi 4'te
  aydınlatmanın tamamı vertex color. Önizleme render'ı bu modu kullanır, yani
  gördüğün görüntü Pi'de görünecek görüntüdür.

## 3D Arayüz (Faz 3)

```bash
npm --prefix web install
npm --prefix web run dev -- --port 5199
```

API'ye `/api` ve `/ws` üzerinden proxy'lenir; ayrı CORS ayarı gerekmez.

### Pi 4 için alınan kararlar

| Karar | Gerekçe |
|---|---|
| **React Three Fiber DEĞİL, vanilla three.js** | Sahnede her karede React uzlaştırması çalıştırmak Pi 4'te lüks. React yalnız panellerde. |
| **Malzemeye göre tek mesh'te birleştirme** | 130 kaynak mesh → **5 birleşik mesh, 7 draw call**. Bileşen kimliği vertex özniteliğinde (`aCompId`) taşındığı için her parça hâlâ ayrı boyanabilir, patlatılabilir, seçilebilir. |
| **Durum/dönüşüm/akış veri dokularında** | Bir bileşenin rengi değişince geometri değil 256×1 doku güncelleniyor. |
| **Doku yok, ışık yok** | Aydınlatmanın tamamı pişirilmiş vertex color. `MeshBasicMaterial` + `vertexColors`. |
| **devicePixelRatio = 1** | Pi 4'ün darboğazı dolgu hızı. Retina'da bile 1'e sabit. |
| **Draco çözücüsü yerel** | Saha internetsiz; CDN bağımlılığı olamaz. |

### Ölçülen performans

Masaüstü referansı (Apple M4), kapalı render hedefine çizip `readPixels` ile senkronize edilerek:

| Çözünürlük | ms/kare | p95 | draw call | üçgen |
|---|---|---|---|---|
| 960×540 | 0,277 | 1,2 | 7 | 25.972 |
| **1280×720** | **0,497** | 1,5 | 7 | 25.972 |
| 1920×1080 | 0,979 | 1,6 | 7 | 25.972 |

Süre piksel sayısıyla doğru orantılı artıyor → sahne **dolgu hızı sınırlı**, poligon sınırlı değil.
Pi 4 için anlamlı sonuç: üçgen sayısını değil çözünürlüğü düşürmek işe yarar.
Pi 4 bütçesi 33 ms/kare (30 fps).

> `gl.finish()` ANGLE/Metal üzerinde gerçekten senkronize etmiyor — ölçüm buna
> güvenirse çözünürlük arttıkça süre DÜŞÜYOR gibi görünüyor. `readPixels` şart.

### Çalışan özellikler

- Canlı WebSocket bağlantısı; kaynak susarsa **VERİ YOK** durumu
- **Pompaya dokun → üstünde bilgi kartı açılır**: durum + 8 sinyal (debi, basma
  basıncı, frekans, akım, güç, motor sıcaklığı, titreşim, çalışma saati). Kart 3D
  noktaya bağlıdır; sahne döndürülürken/yakınlaştırılırken pompanın üstünde kalır.
  × ile ya da başka ekipmana dokununca kapanır; boşluğa dokunmak kapatmaz.
  Konumu render döngüsünde doğrudan DOM'a yazılır — kare başına React çalışmaz.
- Bileşen bazlı arıza boyaması — motor ısınırsa motor, titreşim artarsa pompa gövdesi kırmızı
- Alarm listesinden satıra dokun → kamera o ekipmana uçar, ünite patlatılır, çevre söner
- Kartın satırları `twin-map.json`'dan üretiliyor — katalogda sinyal eklenince kart kendiliğinden büyür
- **Akış animasyonu**: hız `v = Q/A` ile gerçek; kesit alanı ve akış yönü modelin glTF extras'ından
- Su yüzeyi canlı seviyeyi izliyor ve kanalın şevine göre genişliğini değiştiriyor

### 2D şema ve arayüz dili

Üst çubuktaki **3D ekiz / 2D shema** geçişi. 2D sayfa hasaplaýjy panelinin
(SUW HASAPLAÝJY MAGLUMATLARY) tasarım dilindedir: 6 KPI kartı (beket debisi,
girýän akym, howuz derejesi, işleýän nasoslar, jemi kuwwat, duýduryşlar), her
pompa grubu için şema (nasos → kollektör → esasy turba, balans), son 2 saatin
ýük paýlanyşy grafiği ve 8 sinyalli nasos tablosu. 2D sayfa salt görüntüdür:
pompaya ya da tablo satırına dokunmak 3D'ye geçirmez (yalnız üst çubuktaki
geçiş düğmesi geçirir). 2D açıkken 3D render
döngüsü tamamen durur (Pi'de GPU boşa çalışmaz).

**Arayüz dili Türkmencedir.** Sinyal/ekipman adları ve alarm mesajları katalogdan
(`common/equipment_types.json`) ve istasyon konfigürasyonundan gelir; arayüzün kendi
kelimeleri `web/src/ui/labels.ts` ve bileşenlerde. Kod yorumları ve belgeler Türkçe kaldı.

### Trend ve geçmiş oynatma (Faz 4)

**Trend** — paneldeki herhangi bir sayısal sinyale dokun, grafiği açılır. Alarm eşikleri
kesikli çizgi olarak çizilir (trendin eşiğe ne kadar yaklaştığı görülebilsin). Sunucu
veriyi zaman kovalarına indirgeyerek gönderir; ekrana asla 100 bin nokta çizilmez.
Harici grafik kütüphanesi yok — 120 satır canvas kodu, Pi 4 için ölçülü.

**Geçmiş oynatma** — üst çubuktaki *Geçmişi oynat*. Zaman çubuğu kayıtlı geçmişin
tamamını kapsar; 1× / 8× / 60× / 300× hızlarda oynatılır.

| Ne | Nasıl |
|---|---|
| Analog değerler | `GET /api/history/at?ts=` → TimescaleDB'de `DISTINCT ON (tag)` ile o andan önceki son değer |
| Ekipman durumları | Ayrı `status_events` tablosu — FAULT ile STOPPED'ı analog veriden ayırt etmek mümkün değil |
| Alarm durumu | İstemcide `twin-map.json` eşiklerinden hesaplanır (sunucunun canlı alarm durumu geçmiş için geçersiz) |
| Canlı akış | Arka planda devam eder, ekranı ezmez. *Canlıya dön* ile tek tuşta güncel duruma dönülür. |

Oynatmada arayüz "canlı" demez — HUD **GEÇMİŞ** gösterir, alarm listesi *eşik ihlalleri*ne
döner. Durum kaydı olmayan bir an için ekipman rozeti `UNKNOWN` olur; arayüz tahmin etmez.

### Küçük ekran

Düzen 1280×800 ve 1024×600 için ayarlandı (tipik Pi dokunmatik ekranları). Panel
genişlikleri CSS değişkeniyle daralır, zaman çubuğu iki panelin arasındaki boşluğa
yerleşir — hiçbir boyutta çakışma yok, 3D alanı hiç ezilmez.

## Üretim / kiosk (Faz 5)

Geliştirmede vite, sahada nginx. Aynı origin'den sunulur — WebSocket ve fetch
için CORS ya da karışık içerik sorunu oluşmaz.

```bash
docker compose --profile kiosk up -d --build
```

http://localhost/ — Pi'de Chromium kiosk buna bakar.

| Varlık | Boyut | Önbellek |
|---|---|---|
| uygulama js | 309 KB (95 KB gzip) | 30 gün |
| three.js (ayrı parça) | 520 KB (130 KB gzip) | 30 gün |
| model `.glb` | 538 KB | 30 gün, immutable |
| `twin-map.json` | 147 KB | 30 gün |
| Draco çözücü | 752 KB | 30 gün |
| **index.html** | 0,6 KB | **no-store** |

three.js ayrı parçaya alındı: uygulama kodu güncellenince Pi 520 KB'ı yeniden
indirmez. Draco paketinden kullanılmayan kodlayıcılar çıkarıldı (3,6 MB → 752 KB).

Pi kurulumunun tamamı: [deploy/README.md](deploy/README.md)

### Dayanıklılık — ölçüldü

| Senaryo | Davranış |
|---|---|
| API konteyneri düşer | HUD **BAĞLANTI YOK**, sahne kalır, panel boşalır — bayat veri gösterilmez |
| API geri gelir | **1 saniyede** kendiliğinden yeniden bağlanır, 227 tag geri gelir, sayfa yenilenmez |
| Kaynak (sim/gateway) susar | 12 sn sonra **VERİ YOK** |
| Chromium donar | systemd öldürür, yeniden başlatır |
| Açılış | Kiosk servisi `/api/health` yanıt verene kadar bekler (en fazla 2 dk) |

### Dokunmatik

| Jest | Sonuç |
|---|---|
| Tek parmak sürükle | Döndür |
| İki parmak | Yakınlaştır + kaydır |
| Tek dokunma | Parçayı seç |
| **Çift dokunma** | Ekipmanı çerçevele (boşluğa çift dokunma → ana görünüm) |

Dokunma ile sürükleme ayrı: parmak 14 px'den fazla kayarsa ya da 700 ms'den uzun
basılırsa seçim yapılmaz. İki parmak varken hiç seçim yapılmaz — yakınlaştırırken
yanlışlıkla ekipman seçilmesin.

## Çok istasyonlu çalışma

Bir tesiste birden çok terfi merkezi olması kural. Üç istasyon aynı anda canlı:

| İstasyon | Pompa | Kolektör | Göz | Ekipman | Üçgen | GLB |
|---|---|---|---|---|---|---|
| PS-01 | 6 | 2 | 3×2 | 23 | 25.962 | 538 KB |
| PS-02 | 12 | 4 | 6×2 | 43 | 50.866 | 1.047 KB |
| PS-03 | 3 | 2 | 3×2 | 14 | 14.466 | 298 KB |

Her istasyonun kendi simülatörü var (`sim`, `sim-ps02`, `sim-ps03`), hepsi tek
MQTT broker'a farklı topic ön ekiyle basıyor. API `stations/` dizinindeki tüm
konfigürasyonları yükler — yeni bir JSON düşünce arayüzdeki seçicide
kendiliğinden belirir, frontend'de hiçbir şey değişmez.

### Ekipman kimliği çakışması

Her tesiste `PMP-01` vardır. Sağlık ve alarm anahtarları bu yüzden istasyonla
nitelenir: `PS-02.PMP-01/MOTOR__BEARING-DE`. Nitelenmezse PS-02'nin arızası
PS-01'in pompasını kırmızıya boyardı. Regresyon testi bunu koruyor
(`test_pipeline.py` [10]).

### Bant genişliği

Her WebSocket bağlantısı TEK bir istasyona abonedir. Üç istasyonun deltasını
hepsine göndermek Pi'de boşuna ağ ve JSON ayrıştırma yükü olurdu. İstasyon
değiştirmek bağlantıyı koparmaz — `{type:'subscribe', station}` mesajı gider,
sunucu yeni tam görüntüyü yollar.

### Ölçülen sonuç

| İstasyon | Üçgen | ms/kare @1280×720 | Draw call |
|---|---|---|---|
| PS-03 | 14.456 | 0,498 | 7 |
| PS-01 | 25.952 | 0,507 | 7 |
| PS-02 | 50.856 | 0,518 | 7 |

PS-02'nin üçgen sayısı PS-01'in iki katı ama kare süresi neredeyse aynı.
Sahne dolgu hızı sınırlı, poligon sınırlı değil — Pi 4'te tıkanırsak
çözünürlüğü düşürmek işe yarayacak, modeli sadeleştirmek yaramayacak.

## Seçim ve iç parça görünürlüğü

Ekipmana dokunulduğunda gövde parçaları (borular hariç) hafif camgöbeği tonla
işaretlenir ve bilgi kartı açılır. Alarm listesinden bir bileşene inildiğinde
(ör. ısınan motor) üç mekanizma birlikte çalışır:

**1. Tek renk seçim.** Seçili parça HER ZAMAN aynı camgöbeği ile işaretlenir —
parça alarmda olsa bile. Seçim bir *durum* değil bir *etkileşim* göstergesidir;
renginin duruma göre değişmesi "hangisini seçtim" sorusunu okunamaz yapıyordu.
Alarm bilgisi kaybolmaz: bilgi kartında, çip renginde ve alarm listesinde durur,
seçim kalkar kalkmaz 3D'de de geri gelir.

**2. Kaplama gücü bilerek düşük (0,55).** Daha yükseğinde parça düz tek renge
boyanıyor, pişirilmiş gölgeleme siliniyor ve parçanın ne olduğu anlaşılmaz hale
geliyor. 0,55'te renk tartışmasız ama şekil hâlâ okunur.

**3. Kontrast üç kademeli.**

| | sönüklük |
|---|---|
| Seçili parça | 1,00 |
| Aynı ünitenin diğer parçaları | 0,50 |
| Diğer üniteler ve beton yapı | 0,28 |
| **Seçili parçayı kapatan kabuk** | **0 (gizli)** |

Son satır iç parçalar için. Sade pompa modelinde gövde içinde parça yok (kaplin
dışında), ama mekanizma genel kalır: kabuk geometrik olarak otomatik bulunur —
kardeş parçanın sınır küresi seçili parçanın merkezini içeriyorsa, ondan büyük
ama 4 katından küçükse ve merkezleri yakınsa, o bir kabuktur. Kaide ve boru
hattı gibi büyük ama kapatmayan parçalar yerinde kalır.
