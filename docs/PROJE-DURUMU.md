# Proje Durumu — Devir Notu

> Bu belge işi kaldığı yerden sürdürebilmek için yazıldı. Son güncelleme:
> 3D dijital ikiz Raspberry Pi 4'te çalışır durumda, müşteri demosuna hazır.

---

> **İlgili belgeler:** [TEKNOLOJI-YIGIN.md](TEKNOLOJI-YIGIN.md) — kullanılan
> diller, araçlar, kütüphaneler ve lisanslar · [MQTT-CONTRACT.md](MQTT-CONTRACT.md)
> — simülatör ve PLC'nin paylaştığı veri sözleşmesi

## 1. Nerede duruyoruz

| Faz | Durum |
|---|---|
| 0 · Fizibilite | ✅ Pi 4'te ölçüldü — 50 fps, bütçenin (30 fps) çok üstünde |
| 1 · Veri omurgası | ✅ Simülatör, MQTT, API, ISA 18.2 alarm motoru |
| 2 · Model üreticisi | ✅ Blender parametrik üretici, 3 istasyon varyantı |
| 3 · 3D çekirdek | ✅ three.js, 7 draw call, canlı bağlama |
| 4 · Trend + oynatma | ✅ Bellek içi geçmiş, demo tohumlaması |
| 5 · Pi dağıtımı | ✅ Çevrimdışı kurulum, kiosk, açılışta otomatik |
| 6 · **PLC entegrasyonu** | ⏳ **Sıradaki iş** — müşteri onayından sonra |
| 7 · Kumanda | — Bilerek kapsam dışı |

**Şu anki kurulum demo içindir:** PLC yok, üç simülatör çalışıyor, geçmiş bellekte
tutuluyor ve açılışta üretilmiş veriyle dolduruluyor.

---

## 2. Mimari — değişmeyecek olan

```
sim/ (ya da gateway/)  ──MQTT──▶  mosquitto  ──▶  api/  ──WebSocket──▶  web/
                                                    │
                                            geçmiş (bellek | veritabanı)
```

**Tek sözleşme:** `docs/MQTT-CONTRACT.md`. Simülatör ve gerçek PLC gateway'i aynı
topic yapısını ve yükü kullanır. Devreye alma günü `sim` durur, `gateway` başlar;
API ve arayüzde **tek satır değişmez**.

**Tek doğruluk kaynağı:** `common/equipment_types.json`. Ekipman tipleri,
3D bileşenleri, sinyalleri ve alarm eşikleri burada. Model üreticisi, simülatör,
alarm motoru ve arayüz panelleri hepsi bunu okur.

**Model ile veri modeli kilitli.** Katalogda sinyali olan her bileşenin 3D
düğümü olmak zorunda; olmazsa model üretimi durur. Tersi de doğrulanır
(`tests/test_model.py`).

---

## 3. Dosya haritası

| Yol | Ne |
|---|---|
| `common/equipment_types.json` | Ekipman tip kataloğu — **her şeyin kaynağı** |
| `stations/ps-0*.json` | İstasyon konfigürasyonları (geometri + ekipman + hidrolik) |
| `tools/make_station.py` | Yeni istasyon konfigürasyonu üretir |
| `tools/genmodel/` | Blender parametrik model üreticisi (9 modül) |
| `tools/cdp.py`, `tools/pi-eval.sh` | Pi'deki Chromium'a uzaktan JS/ekran görüntüsü |
| `sim/` | Fizik tabanlı simülatör (pompa eğrileri, termal, kavitasyon, PLC mantığı) |
| `api/` | FastAPI — MQTT→WS köprüsü, alarm motoru, geçmiş |
| `api/memhistory.py` | Bellek içi geçmiş + demo tohumlaması |
| `web/src/scene/` | three.js sahnesi (birleştirme, malzeme, kontroller) |
| `web/src/ui/` | React panelleri |
| `deploy/` | Pi kurulumu, kiosk, masaüstü kısayolları |
| `tests/` | 3 test paketi (aşağıda) |

---

## 4. Kritik teknik kararlar ve gerekçeleri

**Sahne için React Three Fiber DEĞİL.** React panellerde, 3D döngüsünde yok.
Pi 4'te her karede React uzlaştırması lüks.

**Malzemeye göre tek mesh'te birleştirme.** 130 kaynak mesh → 5 birleşik mesh,
7 draw call. Bileşen kimliği `aCompId` vertex özniteliğinde taşınır; her parça
hâlâ ayrı boyanabilir, patlatılabilir, gizlenebilir. Durum değişince geometri
değil 256×1 veri dokusu güncellenir.

**Doku yok, ışık yok.** Aydınlatmanın tamamı Blender'da vertex color'a pişirilir.
`MeshBasicMaterial` + `vertexColors`. AO kendi BVH ışın izleyicimizle hesaplanır
(Cycles değil) — deterministik ve motor bağımsız.

**Akış animasyonu vertex shader'da.** Boru ekseni boyunca koordinat + sinüs
dalgası. Hız gerçek: `v = Q/A`, kesit alanı modelin glTF `extras`'ından gelir.

**İstasyon başına tek WebSocket aboneliği.** Üç istasyonun deltasını hepsine
göndermek Pi'de boşuna yük.

**Ekipman kimlikleri istasyonla nitelenir** (`PS-02.PMP-01/MOTOR__BEARING-DE`).
Her tesiste `PMP-01` vardır; niteleme olmazsa alarmlar birbirine sızar.
Regresyon testi var.

---

## 5. Ölçülen performans (Pi 4 Model B Rev 1.4, 4 GB)

| Aşama | ms/kare @1280×800 | fps |
|---|---|---|
| GPU kullanılmıyordu (SwiftShader) | 111 | 9 |
| GPU açıldı | 50,1 | 20 |
| `backdrop-filter` kaldırıldı | **19,9** | **50** |
| Bütçe | 33 | 30 |

Ekran dışı saf render — sahne **dolgu hızı sınırlı**, poligon sınırlı değil:

| Çözünürlük | ms/kare |
|---|---|
| 800×480 | 7,5 |
| 1280×720 | 17,4 |
| Apple M4 referans @1280×720 | 0,497 |

**Sonuç:** tıkanırsa çözünürlük düşürülür, model sadeleştirmek işe yaramaz.
PS-02 (50.856 üçgen) ile PS-01 (25.952) arasında kare süresi farkı yok.

---

## 6. Sahada bulunan tuzaklar — hepsi tekrar çıkar

| Sorun | Belirti | Çözüm |
|---|---|---|
| `--use-gl=egl` Chromium 136'da geçersiz | Sessizce SwiftShader'a düşer, 9 fps | `--use-gl=angle --use-angle=gl` |
| `backdrop-filter: blur()` | Kare süresi ikiye katlanır | CSS'te kullanma |
| labwc `mouseEmulation="yes"` | İki parmak jesti çalışmaz, `pointerType=mouse` | `rc.xml`'de `"no"` + `pkill -HUP labwc` |
| NetworkManager `ipv4.method=auto` | DHCP'siz linkte SSH sürekli kopar, "güç sorunu" sanılır | `ipv4.method=link-local` |
| `NetworkManager-wait-online` | Açılış 72 sn (ağsızken) | `systemctl disable` |
| nginx yukarı akış DNS önbelleği | api yeniden başlayınca kalıcı 502 | `resolver 127.0.0.11` + değişkenli `proxy_pass` |
| Pi 4'te RTC yok | Saat 22 saat sapar, alarm/trend zamanları bozulur | Dağıtımda eşitlenir; kalıcı için DS3231 |
| Draco COLOR_0 `normalized` bayrağı taşımaz | Vertex renkleri 0–255 gelir, sahne beyaza doyar | Değere bakarak ölçek tespiti |
| three.js araya geçmiş tampon | `.array` ile indeksleme pozisyonu renk sanar | `getX/getY/getZ` kullan |
| `gl.finish()` ANGLE/Metal'de senkronize etmez | Benchmark 20.000 fps gösterir | `readPixels` ile senkronize et |

---

## 6.5 İstasyon değiştirince donma — çözüldü (2 Eylül 2026)

**Belirti:** PS-01 → PS-02 → PS-03 → PS-01 sırası izlenince ekran donuyordu.
Tek değişimde değil, birkaç değişimden sonra — birikimli bir sorun.

**Sebep:** `TwinScene.dispose()` yalnız `renderer.dispose()` çağırıyordu.
three.js'te `renderer.dispose()` **geometri, malzeme ve doku BIRAKMAZ** —
sadece kendi iç defterini temizler. Ayrıca `App.tsx` her istasyon değişiminde
TwinScene'i komple yeniden kuruyordu ve her `load()` yeni bir `DRACOLoader`
(dolayısıyla yeni bir Web Worker havuzu) açıp hiç kapatmıyordu.

**Ölçüm (yerel Chrome, `renderer.info.memory`):**

| Adım | Bırakma kapalıyken | Düzeltilmiş |
|---|---|---|
| başlangıç PS-01 | 6 geometri / 3 doku | 6 / 3 |
| → PS-02 | 12 / 6 | 6 / 3 |
| → PS-03 | 18 / 9 | 6 / 3 |
| → PS-01 | **24 / 12** | **6 / 3** |

Her değişim bir istasyonluk GPU belleğini kalıcı bırakıyordu. Pi 4'te V3D
belleği CMA havuzundan geliyor (tipik 256–512 MB) ve dört istasyonluk birikim
onu bitiriyordu.

**Düzeltme:**
1. `TwinScene.unload()` — birleştirilmiş geometriler, malzemeler, üç veri
   dokusu, su yüzeyi ve kaynak glTF'in geometrileri tek tek bırakılıyor.
   (`mergeByMaterial` klonlarla çalışıyor; kaynak glTF geometrileri elde
   kalıyordu, onlar da bırakılıyor.)
2. `draco.dispose()` — worker havuzu her yüklemeden sonra kapatılıyor.
3. `App.tsx` sahneyi **bir kez** kuruyor; istasyon değişiminde yalnız
   `scene.load()` çağrılıyor. Böylece aynı tuvalde ikinci bir WebGLRenderer
   kurma riski de ortadan kalktı (aynı canvas'ta `getContext` aynı bağlamı
   döndürür; eski renderer'ın `dispose()`'u paylaşılan program önbelleğini
   siliyordu).
4. `loadToken` — hızlı istasyon değişiminde geç gelen yükleme sahneye
   eklenmiyor, kaynakları bırakılıyor.

**Dikkat:** `unload()` render döngüsünü durduruyor (`apply*` metotları
`this.tex`'e koşulsuz yazıyor). `this.controls` referansı BIRAKILMIYOR —
döngü ve kamera yardımcıları onu sekiz yerde koşulsuz kullanıyor.

## 6.10 Pompa izleme panosu — 6 Ekim 2026 (BURADAN DEVAM)

**İki bilgisayarın birleştirilmesi (6 Ekim akşamı):** 4 Ekim'den sonra iş ikiye ayrıldı —
Dell'de 3D model (§6.9: bina, toprak, debimetre kuyuları, hücre seviye datçikleri LT-01…06,
motorlu vanalar, NRV'siz basma hattı, sarı uyarı rengi), bu PC'de pompa izleme panosu (aşağısı).
GitHub'daki iki ilk commit ortak geçmişe sahip değildi; birleştirmede 3D/model/üretici dosyaları
Dell'den, pano/veri modeli/simülatör bu PC'den alındı, çakışan dosyalar (App, InfoCard, Schema2D,
styles, TwinScene, katalog, istasyon, plant.py, deploy.mjs, belgeler) elle birleştirildi.
Nasos kartındaki **Suw derejesi** artık nasosun kendi LT datçiğinden (yoksa howuzdan);
2D şema Dell'deki gibi salt görüntü (3D'ye geçirmez). `.gitignore`'daki `data/` satırı
`web/src/data/`'yı da dışlıyordu — iki tarafta da GitHub'a gitmemişti; `/data/` yapıldı.
JACE paketi Dell'in modeliyle (parçalardan birleştirilen `build/ps-01-plain.glb`) yeniden üretildi.

**KURULDU (6 Ekim 18:32) — yerel istasyon `ANEW_MAGTYMGULY_20261006`** (bu PC'de daemon
altında çalışıyor; JACE istasyonunun kopyası, Twin ağacı ve TV_PX/MAPS.px içinde). Hedef JACE
DEĞİL (kullanıcı kararı). Sayfa: **https://localhost/file/twin/index.html** — Karta gömülü
çalışıyor (aynı kaynak). Kurulum: `deploy.mjs` JACE_URL=https://127.0.0.1 (ya da
`kur.ps1 -Url https://127.0.0.1`); 11 dosya, Dell'in eski paketi silindi, 72 yeni nokta
(run_inv/run_pano, hours_inv/pano, MOTOR/t1–t6, PUMP/bearing1–2, HDR/total_m3), istasyon
kaydedildi; yedek `Desktop\twin_yedek_yerel_2026-10-06_1832`. Yeni noktalar boş ("—") —
gerçek noktalara link'lenene kadar nasosun durumu eski `state` noktasından okunur.
İstasyon dosyaları `C:\ProgramData\Niagara4.15\...` altında (erişim yok) — kurulum yalnız
istasyon üzerinden. JACE (192.168.1.140) o akşam bu ağdan HTTPS el sıkışmasını tamamlamıyordu.

Kullanıcı referans olarak i4 Cortex pompa panosunun iki ekranını verdi (kart düzeni +
büyük grafik). İstekler ve karşılıkları:

| İstek | Yapılan |
|---|---|
| 8 sıcaklık (6 nasos + 2 podşipnik), grafiksiz | `MOTOR.t1..t6`, `PUMP.bearing1..2`; kartta 6+2 ızgara |
| Durum: durýar / inverterde / panoda | `run_inv`, `run_pano` (bool) |
| Uyarı 3 kategori × 3 hal | temperatura / tok / suw derejesi × kadaly / duýduryş / näsazlyk (eşikler katalogda) |
| Çalışma süresi inverter + pano + toplam | `hours_inv`, `hours_pano` (sayaç); toplam arayüzde |
| Pump flow yerine basınç | `discharge_press_bar` + son 30 dk mini grafik |
| Hz, tok/kW | ark göstergesi; tok + kW kutusu |
| Power usage / Flow rate / Total — her çıkış borusu ayrı | alt çubuk: kW toplamı, `HDR-0x.flow_m3h`, `HDR-0x.total_m3` (+ basyş, suw derejesi) |
| Pressure trends, Station command | çıkarıldı |
| Pompaya tıkla → 8 grafik + ortak zaman seçimi | `PumpCharts` / `ChartBoard`: temperatura, ýagdaýy, duýduryş, işlän wagty, basyş, ýygylyk, tok, kuwwat |
| Menü: Network/Systems/Message panel yok; Pump Stations → Toplumlar | `Shell.tsx`: 3D ekiz · Umumy syn · Toplumlar ▸ 1/2 · Duýduryşlar · Hasabatlar · Howpsuzlyk · Grafikler |

**Kararlarım (kullanıcıya söylendi, gerekirse değişir):** 6 sıcaklık "nasos" etiketiyle
motor bileşenine bağlandı (sargı varsayımı; 3D'de motor boyanır), podşipnikler pompa
gövdesine. Eşikler: T1–T6 110/130 °C, podşipnik 80/95 °C, tok 294/322 A (kataloğu
düzenle). Suw derejesi uyarısı howuzun tek seviye datçiğinden — tüm nasoslara aynı.
Toplum kuwwatı ayrı sayaç değil, nasosların kW toplamı. Nasos başına debimetre artık
yok; 3D akış animasyonu turbanın debisini çalışan nasoslara böler.

**Kod:** `web/src/data/pump.ts` (anlam katmanı), `history.ts` (API / Niagara taryhy /
oturum tamponu), `usePumps.ts`; `web/src/ui/Shell.tsx`, `PumpBoard.tsx`, `PumpCard.tsx`,
`Gauges.tsx`, `Chart.tsx`, `ChartBoard.tsx`, `PumpCharts.tsx`, `Pages.tsx`, `icons.tsx`.
Katalog sürümü 0.3.0; twin-map Blender'sız yenilenir: `tools/genmodel/refresh_twin_map.py`.
Simülatör: PS-01'de N-3 ve N-6 panodan (`params.drive = "pano"`), yeni arıza türleri
`bearing`, `overcurrent`. `tools/devstack.py` açılışta 24 saatlik geçmişi simülatörle
doldurur (grafik testi için). Testler: test_pipeline ve test_model geçiyor.

**JACE:** paket hazır (`web/dist-niagara`), **henüz kurulmadı** — 6 Ekim'de JACE bu
ağdan erişilemiyordu (192.168.1.140:443 kapalı). Kurulum betiği eksik noktaları ekler
(`node tools/jace/deploy.mjs x y --plan` listeyi gösterir: 103 nokta, var olanlara
dokunulmaz). Yeni bool noktalar `false` başlar → bağlanana kadar nasoslar DURÝAR görünür.
Grafik geçmişi için noktalara Workbench'te history uzantısı eklenirse arayüz kendiliğinden
Niagara taryhyny okur (`niagara.ts` → `historyIdOf`); BajaScript sorgusu
(`history:<id>?start=…;end=…|bql:select timestamp, value`) JACE'te **henüz denenmedi**.

**Menü sonradan (6 Ekim):** Howpsuzlyk çıkarıldı; Duýduryşlar'ın üstüne **Karta** eklendi —
istasyonun `file:^TV_PX/MAPS.px` Px'i içerik alanında iframe ile (`ui/Karta.tsx`). Niagara
her yanıtta `X-Frame-Options: SAMEORIGIN` gönderiyor (yerel istasyonda ölçüldü): gömme yalnız
arayüz Px ile AYNI istasyondan açılınca çalışır. TV_PX/MAPS.px yerel süpervizör
istasyonlarında (SCADA_ANEW_*) var; JACE'te olup olmadığı bilinmiyor → arayüzün hangi
istasyondan açılacağı kullanıcıya soruldu.

**Simülasyon servisi (6 Ekim 19:05):** yerel istasyonda `/Twin/TwinSim` Program bileşeni
çalışıyor (kaynak `tools/jace/sim/TwinSim.body.java`, Niagara'nın JRE'sindeki javac ile
`build.mjs` derler, `sim-kur.mjs` kurar). Gerçek saate göre her saniye `/Twin/PS-01`
noktalarının in16'sına yazar; heartbeat güncel olduğu için arayüz "janly". Arıza denemesi
Workbench'ten `arizaNasos` + `arizaTuru` ile. Ayrıntı: `tools/jace/OKU-BENI.md`.

## 6.9 Bina, toprak, alçak pompalar — 4 Ekim 2026 (web'de denendi, JACE'e henüz gitmedi)

Ölçüler `1-25-4-Здание насосной станции_TX.dwg`'den (AutoCAD `accoreconsole` ile DXF/PDF'e
çevrilip okundu). Kanal tabanı 0 = mutlak 197,40:

| | Çizim | Model |
|---|---|---|
| Zemin ±0.00 | 203,90 | `deck_el` 6,5 |
| Makine dairesi tabanı | 200,10 | `pump_area.ground_el` 2,7 (önce 6,5) |
| Pompa kaidesi | 200,70 | `pad_h` 0,6 → eksen 4,06 |
| Saçak / mahya | +7,83 / +8,78 | `building.eave_h` / `ridge_h` |

- **Emme hattı** başlık duvarını pompa ekseni kotunda yatay geçer (suyun üstünden),
  hücrenin ortasında dik iner, ucunda voronka suyun içinde (`suction_el: null`).
- **Bina** (`tools/genmodel/building.py`): bodrum (hep görünür) + 4 duvar + çatı. Duvarlar
  dış normalini `face_n` extras'ında taşır; arayüz **çatıyı ve kameraya bakan duvarları
  gizler** ("Bina: kesik"), üst çubuktaki düğme binayı tam gösterir ("Bina: doly").
  Gizli duvarlar seçim ışınında da atlanır.
- **Toprak** (`STATIC__SOIL`): yapıların altını/çevresini dolduran blok. Yeni malzeme
  açılmadı — beton malzemesinde, rengi köşe tonundan (`bake_tint`). **Draw call değişmedi.**
- **Debimetre kuyuları** (`STATIC__FM-PIT`, `geometry.meter_pit`): toprak bina arkasında
  9 m uzatıldı; her ana hatta bina dış yüzünden 4 m ötede, toprağa gömülü üstü açık
  beton kuyu (3,0 × 4,0 m). Ana hat kuyudan geçer, debimetre (kolektör düğümünün
  parçası) kuyunun ortasında. Kuyu ~2,6 m derin: debimetre yukarıdan/dik açıdan görünür.
- Verisi olmayan yapılar (beton, toprak, bina, kuyu) seçilmez/vurgulanmaz; 2D şema
  3D'ye geçirmez; "Bina: doly"ya geçince açık pompa kartı kapanır.
- **Emme hücresi seviye datçikleri** LT-01…06 (yeni tip `level_sensor`, `source_pump` ile
  pompaya bağlı): **temassız radar** — başlık duvarında dikme + hücre üstüne kol + aşağı
  bakan horn, suya girmez. Tek düğüm, dokununca kendi kartı; üstünde sürekli değer
  etiketi ("1.96 m", `SensorTags`). Sinyal `level_m` "Suwuň derejesi" (WARN < 1,3,
  ALARM < 0,9). Simülatör: havuz seviyesi − 0,15·(Q/Q_anma)². JACE:
  `/Twin/PS-01/LT-0x/level_m` + `state` (StringWritable, boşsa kartta rozet yok) —
  `deploy.mjs` yoksa ekler.
- **Durum renkleri koyulaştı:** koyu yeşil çalışıyor, koyu kırmızı alarm/arıza, **sarı**
  = herhangi bir uyarı (bir şey iyi çalışmıyor). Gövde + motor birlikte boyanır; borular
  artık tonlanmıyor. Arayüzdeki `--warn` de amberden sarıya döndü.
- **Datçik yeri:** havuz tarafı — hücrenin ön kirişinde, zeminle bir, ön havuza çıkıntı;
  yanında sahnede sabit boyda ölçüm yazısı (`SensorLabels`, yakınlaşınca büyür).
- **Basma hattı (PS-01):** kompansatör (körük) kaldırıldı — düz boru; **çekvalfler (NRV)
  konfigürasyondan çıkarıldı**; vanalar **motorlu** (redüktör + aktüatör + yanda elektrik
  motoru + yerel kumanda kutusu, el çarkı yok). JACE'teki eski `NRV-0x` noktaları
  zararsız, arayüz kullanmıyor.
- `building` / `soil` / `meter_pit` / `level_sensor` yalnız PS-01'de tanımlı; PS-02/03 eski hâliyle (yeniden üretilmedi).

## 6.8 JACE'e taşındı — 3–4 Ekim 2026

**Asıl hedef artık Pi değil JACE.** İkiz, JACE'in istasyon dosyalarında çalışıyor:

| | |
|---|---|
| Adres | `https://192.168.1.140/file/twin/index.html` |
| Platform / istasyon | **PSS21_JACE_04_09_2026** (ikisi aynı ad) |
| Dosyalar | `file:^twin` — index.html, assets/, models/ (model 4 parça), stations.json |
| Veri | BajaScript → `station:|slot:/Twin/PS-01/<ekipman>/<sinyal>` |
| Kod | `web/src/data/niagara.ts` — sayfa `/file/...` altında açılınca API yerine bu |

**Durum (4 Ekim):** son sürüm yüklü (renkler + "KÖNE MAGLUMAT" uyarısı). `/Twin`
noktalarındaki değerler **2 Ağustos'tan kalma sabit görüntü**; onları besleyen bir
şey yok. Heartbeat eski → arayüz değerleri ve pompa renklerini gösterir ama "KÖNE"
diye uyarır.

**Sıradaki iş:** gerçek VFD (Siemens) ve debimetre (M1–M8) noktalarını Workbench'te
`/Twin/PS-01/PMP-0x/...` noktalarına link'lemek (+ değişen bir heartbeat). Gerçek
PS-21'de 8 pompa var, ikizde 6 (kullanıcı kararı) — eşleme kararı gerekir.

**JACE'te bulunan iki tuzak:**
1. **CSP `blob:` Web Worker'ı yasaklıyor** → Draco'lu GLB hiç yüklenmiyor ("model ýüklenýär"da
   kalır). JACE paketi Draco'suz model kullanır: `generate.py ... --plain-out build/ps-01-plain.glb`.
2. **İstasyon üzerinden ~1 MB'tan büyük tek yazma isteği takılıyor** → paketleyici modeli 512 KB'lık
   parçalara böler (`stations.json` → `model_parts`), arayüz uç uca ekler.

**Workbench'te elle deneme (arıza):** `Twin/PS-01/PMP-01/state` → Set `FAULT` (kırmızı) /
`RUNNING` (yeşil) / `STOPPED` (gri). `PMP-01/MOTOR/temp` → 135'ten büyük = motor alarmı.

**Araçlar:** `tools/jace/OKU-BENI.md` — paket, JACE'e yazmadan önizleme (gerçek CSP ile),
kurulum (`deploy.mjs`), salt okunur durum. **Kurulumu kullanıcı kendi PowerShell'inde
çalıştırır**: Claude Code'un güvenlik denetimi üretim sistemine yazmayı engelliyor.
Yerel önizleme (MQTT/Docker'sız): `tools/devstack.py` + `npm --prefix web run dev -- --port 5199`.

**Bu PC'deki araç zinciri:** Node `C:\Users\User\tools\node-v24.21.0-win-x64`, Blender 5.2.1
`C:\Users\User\tools\blender-5.2.1-windows-x64` (Python'u testler ve devstack için), internet
yalnız VPN proxy `127.0.0.1:12334` üzerinden.

## 6.7 Referans görsele göre yenileme — 3 Ekim 2026

Müşterinin verdiği render ve hasaplaýjy paneli ekranları esas alındı.

**3D model (`tools/genmodel/`)** — yerleşim baştan yazıldı:
- Dar giriş kanalı → köprü (kapak + ızgara panelleri) → genişleyen ön havuz →
  pompa başına bir emme hücresi (tek sıra, yuvarlak burunlu perdeler) → başlık duvarı.
  Kanal kesiti artık `channel.plan` istasyonlarından ([y, taban, üst]) örülüyor.
- Pompalar platform üstünde değil, başlık duvarının mansabında zeminde: yatay
  bölünmüş gövdeli pompa (boru hattı içinden geçer, motor yanda), zikzak iki sıra.
  Emme hatları hücreden yükselip 45° yelpazeyle pompaya kayar; basma tarafında
  kompansatör + çekvalf + el çarklı vana, sonra kolektör ve ana hat.
- **Arazi/tepeler kaldırıldı** (§6.6 geçersiz). Gökyüzü gradyanı yerine düz
  #464D57 arka plan. `terrain.py` artık çağrılmıyor; frontend eski modellerdeki
  `STATIC__TERRAIN` düğümünü de atlıyor.
- Işık: üst yüz/dikey yüz kontrastı referanstaki gibi güçlendirildi; keskin
  kenarlarda köşeler ayrılıyor (`shading.split_sharp`) — beton yüzler lekeli değil düz.
- Boru düğümleri `flow_w` / `flow_join_x` extras'ı taşıyor: akış bandı artık
  gerçek akış yönünde (emme yukarı, basma ve ana hat mansaba) yürüyor.

**Sade pompa veri seti** — pompa başına 27 sinyal → 8: akym, çykyş basyşy,
ýygylyk, motoryň togy, kuwwat, işlän sagady, `MOTOR.temp`, `PUMP.vib`.
Bileşen 17 → 6. Simülatörün termal modeli tek düğüme indi (sargı, I²);
arıza türleri `overheat` (motor), `vibration` (gövde), `vfd_trip`,
`sensor_dropout`, `clear`. Motor koruması 180 °C.

**Arayüz** — sağ panel kaldırıldı. Pompaya dokununca **pompanın üstünde** 8
bilgilik kart açılıyor; kartın konumu render döngüsünde 3D noktadan izdüşürülüyor,
sahne dönerken pompayla birlikte gidiyor. 2D şema sayfası eklendi (README
"2D şema"). Arayüz dili Türkmence; katalog etiketleri ve istasyon adları da.

**Bu makinede (Windows) çalışma:** Blender 5.2.1 taşınabilir sürümü
`C:\Users\User\tools\` altında; Python olarak Blender'ın gömülü Python'u
(3.13) kullanıldı. `web/node_modules`'a Windows için `@esbuild/win32-x64` ve
`@rollup/rollup-win32-x64-msvc` eklendi (Mac ikilileri yerinde duruyor).

## 6.6 Arazi katmanı (varyant C) — 2 Eylül 2026 — KALDIRILDI (bkz. §6.7)

Sahne düz tek renk arka planda duruyordu; ölçek hissi ve yapının araziye
kazılmış olduğu okunmuyordu. `tools/genmodel/terrain.py` + `TwinScene` gökyüzü
gradyanı.

**Ne eklendi:** tesis eteği + çevre tepeleri, TEK mesh, TEK malzeme
(`TERRAIN`, taban beyaz — bütün geçişleri köşe rengi taşıyor). Gökyüzü dikey
gradyan (2×64 veri dokusu — projedeki tek doku).

| İstasyon | Öncesi | Sonrası | Artış |
|---|---|---|---|
| PS-01 | 25.962 | 29.514 | +13,7 % |
| PS-02 | 50.866 | 54.418 | +7,0 % |
| PS-03 | 14.466 | 18.018 | +24,6 % |

Arazi her istasyonda 3.552 üçgen. **Draw call 7 → 9** (arazi +1, gradyan
gökyüzü +1). Tasarım sunumunda 8 demiştim; düz renk arka plan çizim çağrısı
değildi, doku olan var. Bütçe satırı 8'de kaldığı için raporda aşım görünür —
ölçülen etkisi yok (Pi'de 23 fps, 72 °C, kısma yok).

**Sahada ölçülen dört tuzak:**

1. **Ters yüz normalleri — asıl hata buydu.** Halka yüzeyini üreten dörtgen
   sarımı normalleri AŞAĞI veriyordu; three.js varsayılan `FrontSide` ile
   1776 yüzün tamamı eleniyor, ekranda yalnız uzak sırtın ince çizgisi
   görünüyordu. `bm.normal_update()` + `f.normal_flip()` ile düzeltildi.
   **İki tur renk ayarı bu yüzden boşa gitti:** arazi çizilmediği için
   gökyüzü piksellerini arazi sanıp ölçtüm ve olmayan bir renk sorunu
   kovaladım. Ders: renkten şüphelenmeden ÖNCE yüzeyin gerçekten çizildiğini
   doğrula.

2. **Zemin kanalı gömüyordu.** Dairesel düz disk su alma kanalını tamamen
   örttü. Çözüm: kot altında kalan geometrinin XY sınırı ölçülüp zeminde o
   kadar DİKDÖRTGEN ağız bırakılıyor (`_excavation_rect`).

3. **Kamera dört kat geri çekildi.** Arazi yarıçapı ~240 m, tesis ~57 m.
   `Box3().setFromObject(merged.group)` araziyi kapsayınca tesis nokta kadar
   kaldı. `preview.py` ve `TwinScene` artık araziyi hariç tutuyor
   (`plantBox()`).

4. **Model önbelleği.** nginx `/models/` için `immutable, 30 gün` gönderiyordu
   ama `.glb` adları hash'siz. Yeni model Pi'ye gitti, ekranda çıkmadı.
   İki taraflı düzeltildi: nginx artık ETag ile doğrulatıyor, VE Vite her
   derlemede `__BUILD_ID__` üretip model URL'ine `?v=` ekliyor (sunucu
   başlığını değiştirmek zaten önbelleklenmiş yanıtı geçersiz kılmıyor).

**Renk kalibrasyonu.** Köşe rengine yazılan değer DOĞRUSAL uzayda birebir
geçiyor, ekrana `toSRGB` ile çıkıyor (ölçüm: 0,500 yazıldı → ekranda 0,749).
`terrain.py` renkleri istenen EKRAN TONU olarak tanımlıyor ve `_lin()` ile
çeviriyor. Blender önizlemesine göre ayarlamak YANLIŞ: o kendi AgX dönüşümünü
uyguluyor, three.js uygulamıyor.

**Sis THREE.Fog ile YAPILMADI.** Sahne sisi tesise de vurup pompaları
puslandırırdı; arazinin sisi köşe rengine pişirilmiş, tesis net kalıyor.

**Açık kalan iki seçenek:** tepeler her yönde simetrik (referans fotoğraf
varsa asimetrik kurulabilir, maliyet aynı); kanal ağzı dışında rezervuar suyu
yok (~200 üçgen).

## 7. Demo kurulumu (şu anki durum)

```bash
# Pi'de, elle bir şey yapmaya gerek yok — açılışta gelir
```

| Ayar | Değer | Neden |
|---|---|---|
| `HISTORY_MODE` | `memory` | SD karta yazma yok |
| `HISTORY_SEED_DEMO` | `1` | Grafikler boş açılmasın |
| `HISTORY_WINDOW_MIN` | `120` | 2 saatlik pencere, ~11 MB RAM |
| `SIM_SPEED` | `2` | Görünür hareket, makul veri hacmi |
| Veritabanı | **çalışmıyor** | `history` profilinde, demo için gereksiz |

Masaüstünde iki kısayol var: **Dijital İkiz** (aç/yenile) ve **Dijital İkizi Kapat**.

**Açılış:** Pi'yi güce takmak yeterli — ağ, kablo, bilgisayar gerekmez.
Ölçüldü: **elektrikten ekrana 42 saniye**.

Zincirdeki her halka doğrulandı:

| Halka | Nasıl sağlandı |
|---|---|
| Docker açılışta | `systemctl enable docker` (varsayılan) |
| Konteynerler | `restart: unless-stopped` |
| Ağ beklemesi yok | `NetworkManager-wait-online` kapatıldı (72 sn kazandırdı) |
| Grafik oturumu | lightdm otomatik giriş (`autologin-user=dovran`) |
| Kiosk servisi | `WantedBy=default.target` — labwc `graphical-session.target`'ı **aktive etmiyor**, o hedefe bağlarken servis hiç tetiklenmiyordu |
| Wayland hazır | `ExecStartPre` soketi bekler |
| API hazır | `ExecStartPre` `/api/health` bekler — arayüz boş ekranla açılmaz |
| Chromium donarsa | `Restart=always` |

---

## 8. PLC'ye geçiş — yapılacaklar

1. **`gateway/` servisini yaz.** `sim/` ile aynı MQTT sözleşmesini konuşacak.
   Protokol seçimine göre `pymodbus` / `python-snap7` / `asyncua`.
   Tag eşlemesi `stations/*.json` içindeki ekipman listesine göre.
2. **Sahada sensör envanteri çıkar.** Katalogdaki her bileşen sinyalinin fiziksel
   karşılığı var mı? Yoksa o bileşen 3D'de kırmızı yanamaz — ya sensör eklenir
   ya çözünürlük ekipman seviyesine iner.
3. **Geçmişi kalıcıya al:**
   ```
   HISTORY_MODE=db  HISTORY_SEED_DEMO=0
   docker compose --profile kiosk --profile history up -d
   ```
   **`HISTORY_SEED_DEMO=0` unutulmamalı** — gerçek veriyle uydurma karışmamalı.
   SD kart yerine SSD şart (ölçüldü: 789 tag ile günde ~4 GB).
4. **`POST /api/dev/fault` ucunu kapat.** Geliştirme aracı.
5. **Kiosk hata ayıklama portunu kapat.** `TWIN_DEBUG_PORT` tanımlanmamalı.
6. **Salt okunur kök dosya sistemi** (`raspi-config nonint do_overlayfs 0`).

---

## 9. Ölçeklenebilirlik — nasıl büyütülür

**Yeni istasyon eklemek:**
```bash
python3 tools/make_station.py --id PS-04 --pumps 8 --per-header 4
blender --background --python tools/genmodel/generate.py -- --config stations/ps-04.json --out build/ps-04.glb --twin-map build/ps-04-twin-map.json
./deploy/push-to-pi.sh twinpi --offline
```
Arayüzdeki seçicide kendiliğinden belirir. Frontend'de hiçbir değişiklik yok.
Yeni simülatör servisi `docker-compose.yml`'ye eklenir (mevcut üçünü kopyala).

**Yeni ekipman tipi eklemek:**
1. `common/equipment_types.json`'a tip tanımı (bileşenler + sinyaller + alarmlar)
2. `tools/genmodel/` altında geometri üreteci
3. `sim/machines.py`'ye davranış modeli
Arayüz otomatik uyum sağlar — paneller katalogdan üretiliyor.

**Yeni sinyal eklemek:** yalnız kataloğa satır eklemek yeterli. Panel, alarm
motoru ve trend kendiliğinden görür. Bileşen seviyesindeyse 3D düğümü de
gerekir, yoksa üretim uyarır.

---

## 10. Test paketleri

```bash
python3 tests/test_pipeline.py    # simülatör→depo→alarm, 10 başlık, MQTT gerekmez
python3 tests/test_model.py       # .glb ↔ twin-map.json tutarlılığı
python3 tests/smoke_live.py       # ayakta duran yığın, WebSocket dahil
```

Üçü de geçiyor. `smoke_live.py` gerçek bir arıza enjekte edip alarmın doğuşunu
ve 3D düğüm eşleşmesini doğrular.

---

## 11. Pi'ye erişim

```bash
ssh twinpi                        # ~/.ssh/config'de tanımlı
./tools/pi-eval.sh "ifade"        # kiosk Chromium'unda JS çalıştır
python3 tools/cdp.py --screenshot ekran.png
./deploy/check-pi.sh twinpi       # hazırlık raporu
```

Bağlantı: doğrudan ethernet kablosu, IPv6 link-local
(`fe80::5c06:991e:9340:ea65%en6`), kullanıcı `dovran`.
Kurumsal ağ gerekmez; Pi'nin IP kaydı yapılmadı.

---

## 12. Bilinen eksikler

- **Kumanda yok** (bilerek). Eklenecekse: yetkilendirme, iki adımlı onay,
  denetim kaydı ve güvenlik mantığı **PLC'de**, HMI'da değil.
- **Soğutma gerekli — açık iş.** 54 dakika sürekli render sonrası 74,5 °C
  ölçüldü; kısma eşiği 80 °C. Kullanıcı sonradan donma artışı bildirdi, yani
  eşik muhtemelen aşıldı. Yazılım tarafı düzeltildi (kare hızı sınırı, boşta
  modu, düşürülmüş simülatör/yayın hızları) ama **ısı emici + fan hâlâ şart**.
  Teşhis: `deploy/thermal-check.sh`.
- **Vana aktüatörü ve kaplin dönmüyor.** Görsel cila; shader'a döndürme
  eklemek gerekir (öteleme var, dönme yok).
- **Dokunmatik ekran dikey panel** (800×1280), labwc 270° döndürüyor.
  Düzen 1280×800'e göre ayarlı, sorun yok ama panel yönü değişirse gözden geçir.
