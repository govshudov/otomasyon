# 18 Kasım güncellemesi: Arhiw maglumatlary, Suw geçirijiler, nasos popup'ı

Eski TV arayüzündeki iki sayfa (**ARHIW MAGLUMATLARY** ve **SUW GEÇIRIJILER**) düzeltildi, nasos popup'ına
**Grafigi aç** eklendi, 1-nji Maý'ın nasos/turba yapısı gerçeğe göre düzeltildi.

**Durum:** Mac'te Chrome'da sahte verilerle (`?demo`) denendi; tip denetimi ve derleme temiz, konsolda hata yok.
**Niagara içinde henüz çalıştırılmadı.** `paket/ps-01`, `paket/ps-04`, `paket/ps-05` bu sürümle yeniden üretildi.

## 1. Yapılanlar

### 1.1 Flash'taki 17 Kasım çalışması projeye alındı
Flash belleğe kopyalanmış, push'lanmamış değişiklikler (12 Kasım `0b0a37e` üzerine) alındı:
- Nasos sıcaklık adları: T1–T6 → **U1, U2, V1, V2, W1, W2** (motor sargıları), podşipnik → **Öň / Arka**; değerler tam sayı.
- Sözlüğe (`common/sozluk.json`) yeni kelimeler ve ölçekler (Toplum, Temps, Arka, U1…W2).
- Teşhis araçları: `tools/kurulum/veri-bak.sql` (veritabanında hangi istasyon adıyla, ne zamana kadar veri var),
  `tools/kurulum/grafik-bak.sql` (grafiğin sorgusunun aynısı), `tools/jace/wb-test/` (sayfa Workbench içinden
  `stations.json`'a ulaşabiliyor mu).
- `nasos_temperatura.json` eşleme dosyası artık gerekmiyor (bkz. 1.3, adlardan otomatik tanıma).

### 1.2 1-nji Maý'ın yapısı düzeltildi
`ayarlar/1-may.json`'daki kolektörler varsayımdı ve yanlıştı. Gerçek yapı:

| Toplum | Nasoslar | Esasy turba |
|---|---|---|
| Toplum 1 | N-1, N-2, N-3 | T-2 = **MT-2** |
| Toplum 2 | N-4 … N-10 (ortak kolektör) | T-1, T-3, T-4 = **MT-1, MT-3, MT-4** |

- `stations/ps-04.json` ayardan yeniden üretildi (geometri ve hidrolik korundu), 3D model yeniden üretildi.
- **Toplum numarası artık nasoslara göre:** N-1'i içeren toplum Toplum 1 (`web/src/data/pump.ts` → `toplumlarOf`).
  Önceden ilk borunun sırasına göreydi; yeni yapıda toplumlar yer değiştirirdi.
- Twin nokta adları (`/Twin/PS-04/PMP-0x/...`) değişmedi.

### 1.3 ARHIW MAGLUMATLARY (`arhiw.html`)
- Sekmeler: **Grafikler | Hasabatlar | Sazlamalar** (Sazlamalar yalnız Niagara'ya **admin** ile girilince görünür).
  Suw geçirijiler'i yanlışlıkla içinde açan
  "Hasaplaýjy hasabaty" sekmesi kaldırıldı.
- **Daşyna çykar:** Suw geçirijiler'deki gibi PDF (logolu başlık, istasyon, tarih aralığı, özet kutuları; grafikler
  gerçek grafik olarak, sonda min/ortalama/maks tablosu). Beket, nasos, Ähli nokatlar ve Hasabatlar'da çalışır.
  Yazdırma penceresinde **PDF olarak kaydet** seçilir.
- **Yakınlaştırma:** grafiğin üstünde fareyle sağa/sola sürükleyin → seçilen aralığa yakınlaşır, veri daha ayrıntılı
  gelir. **Yzyna** ya da çift tık geri döner. Büyütmek yalnız ⤢ simgesiyle.
- **Işlän wagty:** üst üste sütun grafiği — her sütun bir zaman dilimi (aralığa göre 5 dk / 30 dk / 1 sa / 1 gün),
  içinde **Inwertorda** ve **Transformatorda (tokda)** süreleri, sütunun üstünde toplam.
- **Temperatura:** U1…W2 düz çizgi, Öň/Arka podşipnik kesikli; bütün değerler tam sayı; alarm çizgileri etiketli.
- **Sazlamalar (sıcaklık noktaları):** veritabanındaki adlar kendiliğinden tanınır:
  `Toplum_1_Temps_P3_U1` → Toplum 1'in 3. nasosu · U1; sonek yoksa (`Toplum2_Temps_P1`) → Öň podşipnik; `_Arka` → arka.
  "k. nasos" istasyon yapısındaki sıradır (1 Maý: Toplum 1 = N-1…N-3, Toplum 2 = N-4…N-10).
  Tanınmayan ya da yanlış eşleşen hücre listeden seçilir (bkz. 2.4).
- Pompa grafikleri (çalışma süresi, basınç, ýygylyk, tok, kuwwat) `/Twin/<kod>/PMP-xx/...` noktalarının geçmişinden;
  sıcaklıklar doğrudan veritabanındaki adlardan okunur.

### 1.4 SUW GEÇIRIJILER (`gecirijiler.html`)
- **Havuz ve PS-21/PS-22 tamamen kaldırıldı.** Sayfa, açıldığı Niagara istasyonunu anlatır (1-nji Maý, Magtymguly,
  Ýaşyldepe); yapı istasyonun kendi dosyasından (toplum → MT) ve nokta adlarından çizilir.
- **Nokta adları kendiliğinden tanınır:** `MT1` / `MT2_1` (turba / şaha başı), `MT1_S2` (gövdedeki sazlaýjy),
  `MT1_1_S3` (şahadaki sazlaýjy), `Saka3`, `BA3_G2` (beton akaba gatlası); sonek `_Akym` ve `_Toplam` / `_Jemi`.
  Yıldızlı şahalar (haritadaki `MT-1/2*`, `MT-1/3**` …) için şu yazımlar tanınır: `MT1_2x`, `MT1_3xx`,
  `MT1_3a/b/c`, `MT1_3_1/2/3`, `MT1_2*`. Gerçek adları farklıysa Sazlamalar'dan atanır.
- **Suw deňagramlylygy** (eski adı "Hat deňagramlylygy"; "hat" kelimesi her yerden kaldırıldı): her esasy turba için
  başındaki sayaç (giren) ile turbadaki bütün ölçülen çıkışlar (sazlaýjylar, şahalar, SAKA) karşılaştırılır;
  fark = kayıp (sızıntı, ölçülmeyen çekiş ya da hatalı sayaç). Bugün ve son 30 gün, m³ ve %.
  ≤ %5 kadaly, %5–10 üns beriň, > %10 gyzyl (`yitgi_cak` ile değişir).
- **Sazlamalar** (yalnız **admin** kullanıcısına görünür; diğer kullanıcılarda menüde yok, `#ayar` adresi genel bakışa
  döner): bütün noktalar "ne olarak tanındı" bilgisiyle; tanınmayanlar en üstte (ata ya da gizle); SAKA → MT / şaha
  bağları listeden seçilir.
- Haritalara göre yapı (`common/ulgam.json`; haritalar: `magtymguly.jpeg`, `yasyldepe.jpeg`, 1-nji Maý için `WhatsApp Image 2026-11-05 …jpeg` — hazırlık PC'sinde proje klasöründe, git'e eklenmedi):

| İstasyon | Esasy turbalar | SAKA → beton akaba |
|---|---|---|
| 1-nji Maý (BIRINJI_MAY) | MT-1 (MT-1/1), MT-2 (MT-2/1…MT-2/5), MT-3, MT-4 | SAKA-1, 2 → MT-1; SAKA-3 (MT-2/5 ucu), 4 → MT-2 |
| Magtymguly (MAGTYMGULY) | MT-1 (MT-1/1, /2, /2*, /3, /4), MT-2 (MT-2/1) | SAKA-1 (MT-1/1), 2 → MT-1; SAKA-3 (MT-2/1), 4 → MT-2 |
| Ýaşyldepe (YASYLDEPE) | MT-1 (MT-1/1, /2, /3, /3*, /3**, /3***) | SAKA-1…7 → MT-1 (SAKA-2 MT-1/2 ucunda) |

### 1.5 Nasos popup'ı: **Grafigi aç**
- Popup'ın altındaki düğme o nasosun **H–Q penceresini** (zawod egrisi, Qmin, taslama, geçmiş noktalar, häzirki iş
  nokady, değer kutuları) sayfanın ortasında büyük açar. Popup açık kalır; ×, Esc ya da dışarı tıklama kapatır.
- Umumy syn'deki H–Q penceresiyle aynı hesap (`web/src/data/nasosEgri.ts`).
- Popup verisi eski TV noktalarından (`eski_noktalar.json`): basyş → H, akym (m³/sag → m³/s) → Q, suw → emme seviyesi.

### 1.6 Paketleme
- Sahte veri dosyaları (`demo/`, `gecirijiler-demo.js`) pakete girmez.
- `niagara-pack.mjs` korumalı: istasyon bulunmazsa ya da çıktı klasörü paketlerin kökü ise hiçbir şey silmeden durur.
- `deploy.mjs` eski dosyalar listesine 14 Kasım paketinin JS/CSS'i eklendi.

### Chrome'da deneme (Niagara'sız, sahte veri)
Proje kökünde: `.venv/bin/uvicorn main:app --app-dir api --port 8000` ve `web` klasöründe `npx vite --port 5199`, sonra:
- `http://localhost:5199/arhiw.html?demo`
- `http://localhost:5199/gecirijiler.html?demo` (1-nji Maý), `…?demo&beket=PS-01` (Magtymguly), `…?demo&beket=PS-05` (Ýaşyldepe)
- `http://localhost:5199/nasos.html?demo#PMP-03`
- Sahte veri modunda kullanıcı admin sayılır; `&ulanyjy=operator` eklenirse başka kullanıcı gibi (Sazlamalar görünmez).

## 2. Workbench'te yapılacaklar

Her istasyonda, o istasyon **çalışırken**, istasyon PC'sinde. Önce Ýaşyldepe ya da 1-nji Maý ile deneyin.

### 2.1 Dosyaları alın
`git pull` (ya da `paket\ps-0x` klasörünü USB ile taşıyın).

| Niagara istasyonu | Paket | Ayar |
|---|---|---|
| MAGTYMGULY | `paket\ps-01` | `ayarlar/magtymguly.json` |
| BIRINJI_MAY | `paket\ps-04` | `ayarlar/1-may.json` |
| YASYLDEPE | `paket\ps-05` | `ayarlar/yasyldepe.json` |

### 2.2 Arayüzü istasyona kopyalayın (KURULUM.md §6.1)
1. Workbench → **My Host → My File System** → `…\otomasyon\paket\ps-04` → sağ tık → **Refresh**.
2. Ctrl+A → **Copy**.
3. İstasyona bağlanın → **Files → twin** → **Paste** → **Yes to All**.
4. TV'de ve tarayıcıda **Ctrl+F5**.

Ya da PowerShell: `make kur AYAR=ayarlar/1-may.json ADIM=8 BITIR=8` (aynı işi yapar, eski dosyaları da siler,
eksik Twin noktalarını ekler).

### 2.3 Kontrol listesi
- [ ] **ARHIW MAGLUMATLARY:** sekmeler Grafikler | Hasabatlar | Sazlamalar; "Hasaplaýjy hasabaty" yok.
- [ ] Arhiw → Grafikler → bir nasos: Temperatura tam sayı, Işlän wagty üst üste sütun; sürükleyince yakınlaşıyor, Yzyna geri alıyor.
- [ ] Arhiw → **Daşyna çykar** → yazdırma penceresi → PDF olarak kaydet: grafikler PDF'te görünüyor.
- [ ] Arhiw → **Sazlamalar** (admin ile girin): 10 nasos × 8 hücre (1 Maý) dolu; boş/kırmızı hücre varsa 2.4.
- [ ] Admin olmayan bir kullanıcıyla girin: Arhiw'de ve Suw geçirijiler'de **Sazlamalar görünmemeli**.
- [ ] **SUW GEÇIRIJILER** (TV'de MT.px'teki kutu → `gecirijiler_git.html`): Umumy ulgam şeması istasyonun yapısını
  gösteriyor (1 Maý: Toplum 1 → MT-2; Toplum 2 → MT-1, MT-3, MT-4); havuz yok; "Suw deňagramlylygy" sayfası açılıyor.
- [ ] Suw geçirijiler → **Sazlamalar** (admin ile): "Tanalmadyk" listesi; SAKA → MT bağları haritayla aynı.
- [ ] **Nasos popup'ı:** nasos resmine tıkla → popup → **Grafigi aç** → H–Q penceresi; × ve Esc kapatıyor.

### 2.4 Sazlamalar ekranındaki değişikliği kalıcı yapmak
Sayfalar ayarı henüz istasyona kendisi yazmıyor. **Ýatda sakla** dosyanın yeni metnini gösterir:

| Sayfa | Dosya (istasyonda) | Not |
|---|---|---|
| Arhiw → Sazlamalar | `twin/nasos_temperatura.json` | Yalnız elle değiştirilen hücreler; dosya yoksa yeni oluşturulur |
| Suw geçirijiler → Sazlamalar | `twin/ulgam.json` | Dosyanın **tamamı** gösterilir (üç istasyonun bölümü birlikte); dosya baştan değiştirilir |

1. Penceredeki **Göçür** ile metni kopyalayın.
2. **Dosya istasyonda varsa** (`ulgam.json` pakette gelir): Workbench → istasyonda **Files → twin → <dosya>** → çift tık
   (metin düzenleyici) → içindekini silip yapıştırın → **Ctrl+S**.
   **Yoksa** (`nasos_temperatura.json` ilk kez): Not Defteri'ne yapıştırıp **UTF-8** olarak bu adla kaydedin →
   Workbench → **My File System** → dosya → **Copy** → istasyonda **Files → twin** → **Paste**.
3. Sayfada **Ctrl+F5**.

Not: Bu dosyalar paketin içinde de var; bir sonraki paket kurulumu `ulgam.json`'u depodaki haliyle değiştirir.
Kalıcı olması için sahada yapılan değişikliği `common/ulgam.json`'a da işleyin (ya da bana gönderin).

### 2.5 Popup'ın eski TV noktaları (`twin/eski_noktalar.json`)
- `toplumlar` → her toplum klasörünün nasos listesi. Şu an `Toplum2: [4, 5, 6, 7, 8]`; 1 Maý'da Toplum 2 = N-4…N-10
  ise ve N-9 / N-10 popup'ı boş geliyorsa listeye **9, 10** ekleyin.
- H–Q penceresindeki **Kuwwat, Tok, Ýygylyk** kutuları için eski Px sayfasındaki nokta yolu biliniyorsa
  `kuwwat`, `tok`, `ygylyk` anahtarlarını ekleyin (örnek dosyanın açıklamasında); eklenmezse "—" görünür.
- Workbench'te: **Files → twin → eski_noktalar.json** → çift tık (metin düzenleyici) → kaydet → popup'ı yeniden açın.

### 2.6 Veri koşulları (boş grafik görürseniz)
| Belirti | Sebep | Ne yapılır |
|---|---|---|
| "Maglumat okalmady" / TsOkuma | Okuma servisi yok | `make kur AYAR=… ADIM=3 BITIR=3` |
| Arhiw'de nasosun basyş / tok / kuwwat / işlän wagty boş | `/Twin/<kod>/PMP-xx` noktaları gerçek noktalara bağlı değil | KURULUM.md §5.3 (bağla), `make kur … ADIM=9 BITIR=9` (history) |
| Sıcaklıklar boş | Veritabanındaki ad farklı | Arhiw → Sazlamalar (2.4) |
| Suw geçirijiler'de sayaç yok / "maglumat ýok" | Nokta veritabanında yok ya da adı tanınmadı | `psql … -f tools\kurulum\veri-bak.sql`; Suw geçirijiler → Sazlamalar |
| Yıldızlı şaha (`MT-1/3**` …) tanınmadı | Gerçek ad bilinmiyordu | Sazlamalar → "Goşmaça şaha" seçicisi |

## 3. Açık konular
- **Ayarı istasyona doğrudan yazma** (TsOkuma servisine eylem): sonraki adım; şimdilik 2.4'teki elle yol.
- **Magtymguly ve Ýaşyldepe nasos → turba eşleşmesi** doğrulanmadı: Magtymguly N-1…N-3 → MT-1, N-4…N-6 → MT-2;
  Ýaşyldepe 3 nasos → MT-1 (`ayarlar/yasyldepe.json`'da hâlâ "varsayım" notu var).
- **Haritadan okunan varsayımlar:** Magtymguly'de SAKA-1 MT-1/1'de, SAKA-3 MT-2/1'de; istasyon yanında üst üste çizilmiş
  MT-1/MT-2'de S-1…S-7 MT-1'e verildi; Ýaşyldepe'de SAKA-2 MT-1/2 ucunda.
- **Elle güncellenen kopyalar** (yerel sunucu `common/`'u sunmadığı için): `web/public/demo/nasos_egrileri.json`,
  `web/src/data/demo.ts` içindeki `DEMO_SOZLUK`, `web/public/gecirijiler.js` içindeki `ULGAM_NUSGA` — `common/` altındaki
  asılları değişince bunlar da güncellenmeli (yalnız sahte veri modu ve yedek için kullanılır).
