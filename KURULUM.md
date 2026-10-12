# İstasyon kurulumu

Bir suw göteriji beketin (nasos istasyonunun) izleme arayüzünü, 3D modelini ve geçmiş
verisini (TimescaleDB, 5 yıl) kurmak için gereken her şey. Bu belgeyle kurulum,
başka bir yardım olmadan baştan sona yapılabilir.

- Her istasyonun **tek bir ayar dosyası** vardır: `ayarlar/<istasyon>.json`.
- Komutlar `make` ile çalışır (`make` yoksa her komutun karşılığı §7'de).
- Şifreler hiçbir dosyaya yazılmaz; kurulum sırasında sorulur.

---

## 1. Genel akış

İki tür bilgisayar vardır:

| | Hazırlık PC'si | İstasyon PC'si |
|---|---|---|
| Ne yapılır | Ayar → istasyon dosyası, 3D model, arayüz paketi | Kurulum: veritabanı, sürücü, arayüz, Twin noktaları |
| Ne gerekir | Python, Blender, `web/node_modules`, Node | Niagara, PostgreSQL + TimescaleDB, Node, Chrome |
| İnternet | `npm ci` için bir kez | Gerekmez |

```
 Hazırlık PC'si                                     İstasyon PC'si
 ─────────────                                      ──────────────
 ayarlar/1-may.json  (elle)                         PostgreSQL + TimescaleDB (elle)
   │ make istasyon                                  Niagara istasyonu: adı ayardaki ad (elle)
   ▼                                                timescale-rt.jar + sertifika (elle)
 stations/ps-04.json                                        │
   │ make model                                             │
   ▼                                                        ▼
 build/ps-04-plain.glb  ── make paket ──►  paket/ps-04/ ──► make kur AYAR=ayarlar/1-may.json
                                           (git / USB)              │
                                                                    ▼
                                                 Twin noktalarını gerçek noktalara bağla (elle)
```

---

## 2. Gereksinimler

Önce kontrol edin, hiçbir şeyi değiştirmez:

```
make gereksinim                 (istasyon PC'si)
make gereksinim ROL=hazirlik    (hazırlık PC'si)
```

Aşağıdaki sürümler bu projede denenmiş olanlardır. Aynı ana sürüm (ör. PostgreSQL 18.x)
yeterlidir.

### 2.0 Kurulum dosyaları (internetsiz kurulum)

Niagara dışındaki bütün kurulum dosyaları projenin `gereksinimler/` klasöründedir. Dosya
adları, sürümleri, indirme adresleri ve SHA256 parmak izleri `gereksinimler/LISTE.md`'de
yazar. Dosyalar büyük olduğu için (PostgreSQL ~370 MB) **Git'e girmez**: proje klasörüyle
birlikte USB'ye kopyalanır. Eksikse LISTE.md'deki adreslerden indirilir.

İstasyon PC'sinde, `make`'ten önce:

```
powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim-kur.ps1
```

Bu komut:
1. Dosyaların parmak izlerini listeyle karşılaştırır; bozuk ya da yanlış dosyayı kurmaz.
2. Node.js'i ve GNU make'i `C:\Users\<kullanıcı>\tools` altına açar ve PATH'e ekler. Yeni açılan pencerelerde geçerli olur.
3. Chrome, PostgreSQL ve TimescaleDB kurulu değilse kurulum programlarını sırayla başlatır. Şifre ve seçenekleri siz girersiniz (aşağıdaki tablodaki notlar). TimescaleDB'den sonra PostgreSQL servisini yeniden başlatmayı önerir.

Kurulu olana dokunmaz; tekrar çalıştırmak güvenlidir. Sonra **yeni bir PowerShell
penceresinde** `make gereksinim`.

### 2.1 İstasyon PC'si

| Yazılım | Denenen sürüm | Nereden / nasıl |
|---|---|---|
| **Niagara 4** | 4.15.5.22 | Lisanslı Tridium kurulumu. Kurulum yolu `C:\Niagara\Niagara-4.15.x` olmalı (betikler orada arar). |
| **PostgreSQL** | 18.1 | EnterpriseDB Windows kurulumu: enterprisedb.com → Downloads → PostgreSQL 18 Windows x86-64. Kurulumda `postgres` kullanıcısının şifresini belirleyin (unutmayın), port **5432**. Varsayılan yol `C:\Program Files\PostgreSQL\18`. |
| **TimescaleDB** | 2.23.1 (PostgreSQL 18 için) | github.com/timescale/timescaledb → Releases → **PostgreSQL 18 için Windows** zip dosyası. Zip'i açın, içindeki `setup.exe`'yi **yönetici olarak** çalıştırın; sorduğu `postgresql.conf` ayarlarına "evet" deyin (`shared_preload_libraries = 'timescaledb'` eklenir). Sonra **postgresql-x64-18** Windows servisini yeniden başlatın. |
| **Node.js** | 24.21.0 (22 ve üstü olur) | nodejs.org → Windows x64. Kurulum (msi) ya da zip: zip'i `C:\Users\<kullanıcı>\tools\node-v24…-win-x64` klasörüne açmak yeterli, betikler orada bulur. |
| **Google Chrome** | güncel | google.com/chrome. Betikler Niagara'ya görünmeyen (başsız) bir Chrome penceresiyle bağlanır. |
| **GNU make** | 4.4.1 (ezwinports) | `gereksinim-kur.ps1` kurar. Elle: zip'i `C:\Users\<kullanıcı>\tools\make-4.4.1-without-guile-w32-bin` altına açın, içindeki `bin` klasörünü PATH'e ekleyin. Olmasa da olur: §7'deki doğrudan komutlar. |
| **Proje klasörü** | — | `git clone` ya da hazırlık PC'sinden USB ile kopya. Klasörde `paket/<id>/`, `paket/surucu/`, `stations/<id>.json`, `ayarlar/<istasyon>.json` ve (Git'te olmayan) `gereksinimler/` bulunmalı. |

**TimescaleDB doğrulaması** (pgAdmin ya da `psql -U postgres`):

```sql
CREATE DATABASE "Niagara";
\c Niagara
CREATE EXTENSION IF NOT EXISTS timescaledb;   -- hata vermemeli
SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';
```

(Kurulum betiği de veritabanını ve eklentiyi oluşturur. Bu yalnız kontrol içindir.)

### 2.2 Hazırlık PC'si

İstasyon PC'sindekilere ek olarak:

| Yazılım | Denenen sürüm | Not |
|---|---|---|
| **Blender** | 5.2.1 | blender.org, taşınabilir zip yeterli: `C:\Users\<kullanıcı>\tools\blender-5.2.1-windows-x64\`. 3D model için. |
| **Python** | 3.13 (Blender'ın içindeki) | Ayrı kurulum gerekmez; Blender'ın Python'u bulunur. `make istasyon` için. |
| **web/node_modules** | — | Bir kez: `web` klasöründe `npm ci` (internet gerekir; vekil sunucu varsa `npm ci --proxy http://…`). `make paket` için. |
| **Git** | 2.x | Değişiklikleri kaydetmek / istasyon PC'sine taşımak için. |

### 2.3 Sürücü modülü (her istasyon PC'si, bir kez)

`paket/surucu/` klasöründe hazırdır:

| Dosya | Ne |
|---|---|
| `timescale-rt.jar` | Niagara → TimescaleDB sürücüsü 1.7.1.0, imzalı (Akyllyoy) |
| `akyllyoy-codesign.pem` | İmzanın açık sertifikası. Gizli değildir. |

1. **Sertifikayı tanıtın (iki yerde):**
   - Workbench → Tools → Certificate Management → **User Trust Store** → Import → `akyllyoy-codesign.pem`.
   - Workbench'te Platform'a bağlanın → Certificate Management → **User Trust Store** → Import → aynı dosya.
   - Parmak izi şu olmalı: `9D:25:35:92:5E:73:27:6F:C1:AD:0A:9D:57:D7:3F:C9:D0:D6:C2:98:1E:C2:18:70:76:22:C3:23:86:8D:7F:B4`.
2. İstasyonu durdurun ve Workbench'i kapatın.
3. `timescale-rt.jar` dosyasını `C:\Niagara\Niagara-4.15.x\modules\` altına kopyalayın. Eskisi varsa önce yedekleyin.
4. İstasyonu ve Workbench'i başlatın.

`moduleVerificationMode`'u `low` yaparak imza denetimini kapatmayın; sertifikayı tanıtmak doğru yoldur.

---

## 3. Ayar dosyası

Her istasyon için bir dosya: `ayarlar/<istasyon>.json`. Yeni istasyonda `ayarlar/ornek.json`'u
kopyalayıp değiştirin.

```json
{
  "id": "PS-04",
  "ad": "1 Maý suw göteriji beket",
  "niagara":    { "istasyon": "BIRINJI_MAY", "url": "https://127.0.0.1", "kullanici": "admin" },
  "veritabani": { "host": "localhost", "port": 5432, "ad": "Niagara", "kullanici": "postgres" },
  "saklama_yil": 5,
  "sikistirma_gun": 7,
  "kolektorler": [
    { "ad": "T-1 esasy turba", "nasoslar": [1, 2, 3, 4] },
    { "ad": "T-2 esasy turba", "nasoslar": [5, 6, 7] },
    { "ad": "T-3 esasy turba", "nasoslar": [8, 9, 10] }
  ],
  "nasos": { "motor_kw": 160, "debi_m3h": 900, "basys_m": 45 }
}
```

| Alan | Anlamı |
|---|---|
| `id` | İstasyonun kodu: PS-01, PS-04 … **Her istasyonda farklı.** Niagara'da `/Twin/<id>` klasörü, dosya adları (`stations/ps-04.json`, `paket/ps-04/`) bundan gelir. |
| `ad` | Ekranda görünen ad. |
| `niagara.istasyon` | Niagara istasyonunun **adı**. İstasyon tam bu adla oluşturulmalı: sürücü veriyi bu adla yazar, kurulum bunu denetler. Sonradan değiştirmeyin. |
| `niagara.url` | İstasyonun adresi. Kurulum istasyon PC'sinde yapıldığı için `https://127.0.0.1`. |
| `niagara.kullanici` | Niagara yönetici kullanıcısı. Şifre kurulumda sorulur. |
| `veritabani` | PostgreSQL bağlantısı. Aynı PC'de: `localhost`, 5432, veritabanı `Niagara`, kullanıcı `postgres`. |
| `saklama_yil` | Ham veri kaç yıl tutulsun (özetler 10 yıl). |
| `sikistirma_gun` | Kaç günden eski veri sıkıştırılsın. |
| `kolektorler` | **Borular (esasy turba) ve onlara bağlı nasosların numaraları.** Nasoslar 1'den başlayarak numaralanır; her nasos en az bir boruda yer alır. Nasos sayısı buradan çıkar. Sıralı olmak zorunda değildir (`[1, 3, 5]` ve `[2, 4, 6]`), ama §8.6'daki 3D sınırına bakın. **Ortak hat:** bir nasos birden fazla boruya basabiliyorsa birden fazla listeye yazılır; nasosun ilk geçtiği boru ana borusudur. Örnek aşağıda. |
| `nasos` | Nasos değerleri (motor gücü kW, debi m³/sag, basınç m). Simülasyon ve 3D model ölçüsü için. |

**Ortak hat örneği (1 Maý).** N-1…N-7 vanalarla T-1, T-2 ve T-3'ün hepsine basabiliyor, N-8…N-10 yalnız T-4'e:

```json
"kolektorler": [
  { "ad": "T-1 esasy turba", "nasoslar": [1, 2, 3, 4, 5, 6, 7] },
  { "ad": "T-2 esasy turba", "nasoslar": [1, 2, 3, 4, 5, 6, 7] },
  { "ad": "T-3 esasy turba", "nasoslar": [1, 2, 3, 4, 5, 6, 7] },
  { "ad": "T-4 esasy turba", "nasoslar": [8, 9, 10] }
]
```

Arayüzde **toplum** = birbirine bağlı nasoslar ve borular. Burada Toplum 1, N-1…N-7 nasosları ve T-1, T-2, T-3 borularıdır; Toplum 2, N-8…N-10 ve T-4'tür.
- **Ekranlar:** borular ayrı ayrı gösterilir. Akym, basyş ve jemi her borunun kendi debimetresinden gelir. Kuwwat toplum başına toplanır, ortak nasos iki kez sayılmaz.
- **3D model:** ortak hattaki borular arka arkaya çizilir; nasosların basma hattı hepsini keser.
- **Tek borulu toplumlar:** Magtymguly ve Ýaşyldepe gibi her borunun kendi nasosları olan istasyonlarda toplum = bir borudur, bir şey değişmez.

Mevcut istasyonlar:

| Ayar | id | Niagara adı | Nasos / boru |
|---|---|---|---|
| `ayarlar/magtymguly.json` | PS-01 | MAGTYMGULY | 6 nasos; [1,2,3], [4,5,6] |
| `ayarlar/yasyldepe.json` | PS-05 | YASYLDEPE | 3 nasos; [1,2,3] |
| `ayarlar/1-may.json` | PS-04 | BIRINJI_MAY | 10 nasos; ortak hat [1–7] → T-1/T-2/T-3, [8,9,10] → T-4 |

Bir PC'de birden çok istasyon (deneme) çalışacaksa her istasyonun portları farklı olmalı
(Workbench → istasyon → `Services → FoxService` / `WebService`) ve ayardaki `niagara.url`
o HTTPS portunu içermeli; ör. `https://127.0.0.1:8444`.

---

## 4. Yeni istasyon — hazırlık PC'si

```
copy ayarlar\ornek.json ayarlar\1-may.json      (sonra dosyayı düzenleyin)
make istasyon AYAR=ayarlar/1-may.json            → stations/ps-04.json
make model    AYAR=ayarlar/1-may.json            → build/ps-04-plain.glb, web/public/models/ps-04.*  (Blender, ~1 dk)
make paket    AYAR=ayarlar/1-may.json            → paket/ps-04/
```

Ya da üçü birden: `make hazirla AYAR=ayarlar/1-may.json`.

- 3D önizleme `build/ps-04.png` olarak çıkar; açıp kontrol edin.
- Gerçek bina ve kanal ölçüleri için `stations/ps-04.json` → `geometry` bölümü çizime göre düzeltilebilir. Düzelttikten sonra `make model` ve `make paket`'i tekrarlayın. Ayrıntı: `docs/PROJE-DURUMU.md`.
- Hücre seviye datçikleri (LT-01…) üretilmez. Varsa `stations/ps-04.json`'a elle eklenir; `stations/ps-01.json`'daki `level_sensor` örneklerine bakın.

Sonra kaydedip istasyon PC'sine götürün:

```
git add ayarlar/1-may.json stations/ps-04.json web/public/models/ps-04* paket/ps-04
git commit -m "PS-04 1 May: istasyon dosyasi, model, paket"
git push        (ya da proje klasörünü USB ile kopyalayın)
```

---

## 5. Kurulum — istasyon PC'si

### 5.1 Önce elle yapılanlar

1. PostgreSQL + TimescaleDB kur ve doğrula (§2.1).
2. Niagara istasyonunu **ayardaki `niagara.istasyon` adıyla** oluştur. Milesight ve diğer sürücüleri, cihazları ekle.
3. Sürücü modülü ve sertifika (§2.3).
4. Proje klasörü bu PC'de olsun (`git pull` ya da USB).

### 5.2 Kurulum komutu

PowerShell'i proje klasöründe açın:

```
make gereksinim
make kur AYAR=ayarlar/1-may.json
```

Adımlar (her adım önce yapılmış mı diye bakar; yapılmışsa atlar):

| # | Adım | Ne yapar | Sizden istenen |
|---|---|---|---|
| 1 | veritabanı | `Niagara` veritabanı + TimescaleDB eklentisi | postgres şifresi |
| 2 | modül | `timescale-rt` ≥ 1.7.1.0 ve imzalı mı | Değilse ne yapılacağını yazar ve durur (§2.3) |
| 3 | okuma | Okuma servisi `Config → TsOkuma` (arayüz geçmiş veriyi buradan okur) | Niagara şifresi |
| 4 | sürücü | `Drivers → TimescaleNetwork → TimescaleDevice → TimescaleHistoryExport`, istasyon adı denetimi, tablolar | **Workbench'te şifre:** TimescaleDevice → Property Sheet → `password` → postgres şifresi → Save, sonra PowerShell'de Enter |
| 5 | politika | Saklama ve sıkıştırma süreleri | — |
| 6 | okuma-sql | Görünümler, saatlik/günlük özetler (`db/timescale/10_okuma.sql`) | — |
| 7 | model | Hazır paket varsa atlanır | — |
| 8 | arayüz | `paket/<id>/` → istasyonun `file:^twin` klasörü; `/Twin/<id>` noktaları (yoksa oluşturulur). Eski arayüz masaüstüne yedeklenir. | — |
| 9 | history | Twin noktalarına history uzantısı (dakikada bir, veritabanına aktarılır) | — |
| 10 | kontrol | Bağlantı, aktarım ve nokta sayıları raporu | — |

Yarıda kalırsa: `make kur AYAR=… ADIM=4` (4. adımdan devam). Tek bir adım: `ADIM=8 BITIR=8`.

### 5.3 Sonra elle yapılan: Twin noktalarını bağlama

Kartlar, 3D model ve nasos grafikleri `Config → Twin → <id>` altındaki noktaları okur. Bu
noktalar kurulumda **boş** oluşturulur. Gerçek değerler için her biri Workbench'te gerçek
noktaya bağlanmalıdır, örneğin inwertörün akım noktasının `out`'u → `/Twin/PS-04/PMP-01/current_a` `in10`.
Bağlanmayan nokta sabit değerde kalır.

Nokta listesi (her nasos için 16 sinyal, borular için akym / jemi / basyş, havuz derejesi):

```
node tools\jace\deploy.mjs x y --station stations\ps-04.json --plan
```

### 5.4 Kontrol

- `make durum AYAR=…`: TimescaleDevice bağlı mı, son aktarım turu, nokta sayıları.
- Arayüz: `https://127.0.0.1/file/twin/index.html` (Ctrl+F5).
  - **Grafikler:** grafiklerin altında "Çeşme: maglumat binýady" yazmalı.
  - **Ähli nokatlar:** gruplar ve gatlalar görünmeli; birine tıklayınca Akym ve Jemi grafikleri açılmalı.
  - **Hasabatlar:** "Ähli enjamlar" grupları olmalı.
- Workbench: `TimescaleHistoryExport` → `lastRun` 5 dakikada bir değişmeli, `lastError` boş olmalı.
- Veritabanı: son 10 dakikanın kayıt sayısı artmalı.
  ```sql
  SELECT count(*) FROM niagara.hist_numeric h JOIN niagara.point p USING (point_id)
  WHERE p.station = 'BIRINJI_MAY' AND h.time > now() - interval '10 minutes';
  ```

---

## 6. Değişiklikler sonrası

| Ne değişti | Nerede | Sonra |
|---|---|---|
| **Nokta adları (sözlük):** "BA4_G9_Toplam" → "Beton akaba 4 · Gatla 9 · jemi" | `common/sozluk.json` | Hazırlık PC'sinde `make paket`, istasyonda `make kur ADIM=8 BITIR=8`. Kontrol: `node tools\sozluk-onizle.mjs <NiagaraAdı>` (PGPASSWORD gerekir). |
| **Nasos / boru eşlemesi** | `ayarlar/<istasyon>.json` → `kolektorler` | `make istasyon YENIDEN=1`, `make model`, `make paket`; istasyonda `make kur ADIM=8`. `YENIDEN=1` olmadan dosya yalnız denetlenir, fark varsa gösterilir. Elle düzeltilen `geometry`, `hydraulics` ve ek ekipman korunur. |
| **Saklama süresi** | `saklama_yil`, `sikistirma_gun` | `make kur ADIM=5 BITIR=5` |
| **Arayüz kodu** | `web/` | `make paket`; istasyonda `make kur ADIM=8 BITIR=8` |
| **Sürücü** | `driver/timescale/` (değişiklik notları: `DEGISIKLIKLER-1.7.md`) | `make surucu`, `make imzala` (p12 ve şifresi gerekir) → `paket/surucu/timescale-rt.jar`; her istasyonda §2.3 (2–4). Yeni tablo sütunu gerekiyorsa sürücünün şema koduna `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` eklenir; tablolar silinmez. |

---

## 7. Komutlar — `make` olmadan

Her `make` hedefi bir PowerShell betiğini çağırır. `make` kurulu değilse aynısı:

| make | Doğrudan |
|---|---|
| `make gereksinim [ROL=hazirlik]` | `powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim.ps1 [-Rol hazirlik]` |
| `make istasyon AYAR=X [YENIDEN=1]` | `powershell -ExecutionPolicy Bypass -File tools\kurulum\hazirla.ps1 -Ayar X -Hedef istasyon [-Yeniden]` |
| `make model AYAR=X` | `… hazirla.ps1 -Ayar X -Hedef model` |
| `make paket AYAR=X` | `… hazirla.ps1 -Ayar X -Hedef paket` |
| `make surucu` / `make imzala` | `… hazirla.ps1 -Hedef surucu` / `-Hedef imzala` |
| `make kur AYAR=X [ADIM=N] [BITIR=N]` | `powershell -ExecutionPolicy Bypass -File tools\kurulum\kur-istasyon.ps1 -Ayar X [-Basla N] [-Bitir N]` |
| `make plan AYAR=X` | `… kur-istasyon.ps1 -Ayar X -Plan` |
| `make durum AYAR=X` | `… kur-istasyon.ps1 -Ayar X -Basla 10 -Bitir 10` |

---

## 8. Sorun giderme

### 8.1 Adım 2: "Modul kurulmali" ya da Niagara "Module not signed / failed signature validation"
Sertifika tanıtılmamış ya da jar eski. §2.3'ü uygulayın. Sertifika **hem Workbench'te hem
Platform'da** içe aktarılmalı; ardından istasyon ve Workbench tamamen kapatılıp açılmalı.

### 8.2 Adım 4: "password authentication failed for user postgres"
TimescaleDevice'ın `password` alanı boş ya da yanlış. Workbench'te girin ve Save'e basın.
Betik bağlantıyı kendisi dener (ping); hâlâ olmuyorsa:
- postgres şifresini pgAdmin ile doğrulayın.
- `veritabani.host` ve `veritabani.port` değerlerini kontrol edin.
- PostgreSQL servisinin çalıştığını kontrol edin.

Sonra `ADIM=4` ile devam edin.

### 8.3 Adım 4: "Niagara istasyon adı '…', dosyada '…'"
Niagara istasyonunun adı ayardaki `niagara.istasyon` ile aynı değil. Doğrusu istasyonu
doğru adla oluşturmaktır (Workbench → Platform → Station Copier ile yeni adla kopya).
"e" derseniz veri Niagara'daki adla yazılır.

### 8.4 Adım 1: "timescaledb eklentisi kurulamadı"
TimescaleDB, PostgreSQL'in sürümüne uygun kurulmamış ya da `shared_preload_libraries`
ayarlanmamış. TimescaleDB `setup.exe`'yi yönetici olarak yeniden çalıştırın ve
PostgreSQL servisini yeniden başlatın. Kontrol: `make gereksinim`.

### 8.5 "Chrome 9333 portunda açılmadı" / "BajaScript yüklenmedi"
- Chrome kurulu mu: `make gereksinim`.
- Başka bir program 9333 portunu kullanıyor olabilir.
- Niagara istasyonu çalışıyor ve `niagara.url` doğru mu?

### 8.6 3D modelde borular üst üste
Model her boruyu bağlı nasosların en solundan en sağına kadar çizer. Nasoslar sıralı
değilse (`[1,3,5]` ve `[2,4,6]`) borular üst üste görünür. Twin noktaları, grafikler ve
raporlar doğru çalışır; sorun yalnız görüntüdedir.

### 8.7 Grafikte "Taryhy maglumat tapylmady" ya da veri gelmiyor
- `make durum`: TimescaleDevice bağlı mı, HistoryExport'un son turu ne zaman?
- İlk aktarım turu 5 dakika içinde çalışır.
- Okuma servisi kurulu mu: `Config → TsOkuma` → `durum`.

### 8.8 Bir history aktarılamıyor (`lastError`: "… java.io.EOFException")
Niagara'daki o history'nin dosyası bozuk. Workbench → History → ilgili history → Delete. History uzantısı yeniden oluşturur.

### 8.9 Birimler boş (grafiklerde "L/s", "m³" yok)
Niagara noktasında birim tanımlı değil. Noktanın Facets'ine birimi girin. İstasyon yeniden
başladığında veritabanına geçer.

### 8.10 PowerShell "running scripts is disabled"
Komutları `powershell -ExecutionPolicy Bypass -File …` ile çalıştırın (make hedefleri zaten böyle çağırır).

---

## 9. Güvenlik

- Şifreler (Niagara, postgres, p12) **hiçbir dosyaya yazılmaz**; betikler sorar, bitince ortamdan siler.
- `akyllyoy-codesign.p12` (özel anahtar) **repoya konmaz** ve paylaşılmaz. Kaybolursa yeni anahtar üretilir ama her istasyonda yeni sertifika tanıtılmalıdır. Yedekleyin; şifresini ayrı saklayın.
- `paket/surucu/akyllyoy-codesign.pem` açık sertifikadır, paylaşılabilir.
- TimescaleDevice'ın şifresi Niagara'da şifreli tutulur; betik ona dokunmaz.

---

## 10. Dosya haritası

| Yol | Ne |
|---|---|
| `ayarlar/` | İstasyon ayarları (tek kaynak) — `ornek.json` şablon |
| `stations/<id>.json` | Üretilen istasyon dosyası: ekipman, kolektörler, geometri |
| `paket/<id>/` | İstasyona giden hazır arayüz paketi |
| `paket/surucu/` | İmzalı sürücü + açık sertifika |
| `common/sozluk.json` | Nokta adları sözlüğü |
| `common/equipment_types.json` | Ekipman sinyalleri ve birimleri |
| `db/timescale/10_okuma.sql` | Okuma katmanı (görünümler, özetler) |
| `driver/timescale/` | Sürücü kaynağı, derleme (`build.mjs`), imza (`imzala.ps1`), testler |
| `tools/kurulum/` | Kurulum betikleri (`kur-istasyon.ps1`, `hazirla.ps1`, `gereksinim.ps1`, `timescale-niagara.mjs`) |
| `tools/jace/` | Niagara'ya yazan araçlar (arayüz, Twin noktaları, history, okuma servisi) |
| `tools/genmodel/` | 3D model üreticisi (Blender) |
| `tools/make_station.py` | Ayar → istasyon dosyası |
