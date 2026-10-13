# İstasyonu başka bir PC'ye taşıma

Her istasyon kendi PC'sinde çalışır (Niagara lisansı aynı anda 1 istasyon). Portlar hepsinde
aynıdır: web 80/443, Fox 1911/4911.

## Neden "nasoslar uymadı" (12 Ekim)

Aynı adlı iki istasyon klasörü var:

| Klasör | Ne |
|---|---|
| `C:\ProgramData\Niagara4.15\TridiumEMEA\stations\<istasyon>` | **Çalışan istasyon.** Niagara servisi buradan çalıştırır. Save Station ve `make kur` buraya yazar. Windows yalnız yöneticiye açar. |
| `C:\Users\<kullanıcı>\Niagara4.15\TridiumEMEA\stations\<istasyon>` | **Workbench'in yerel kopyası.** Station Copier'ın sol tarafı. Niagara buraya kendiliğinden hiç yazmaz; yalnız Station Copier ile sağdan sola kopyalanınca güncellenir. |

YASYLDEPE ve BIRINJI_MAY, MAGTYMGULY'nin yerel kopyasından üretilip platforma gönderildi. Sonra
`make kur` doğru arayüzü ve `/Twin/PS-05`, `/Twin/PS-04` noktalarını çalışan istasyona yazdı.
Yerel kopyalar hiç geri alınmadı; içlerinde Magtymguly'nin arayüzü (PS-01, 6 nasos) kaldı. Bu
klasörler taşınınca yeni PC'de Magtymguly'nin nasosları göründü.

Önlem:
- **`make kur` 11. adımı:** İstasyonu kaydeder ve çalışan istasyonun klasörünü yerel klasöre bire bir
  kopyalar (yönetici PowerShell gerekir). Kurulumdan sonra yerel klasör çalışan istasyonla aynıdır.
  Eski yerel kopya silinmez; `TridiumEMEA\stations_yedek\` klasörüne taşınır.
- **`make tasi`:** Önce aynı şeyi yapar: kaydeder ve çalışan istasyonu yerel klasöre alır. Sonra
  kopyayı denetler: ad, `/Twin/<kod>`, Twin altında TwinSim ya da başka istasyon. Bir sorun varsa
  **kopyalamaz**.
- **Arayüz kendini denetler:** Paket başka bir Niagara istasyonunda açılırsa ya da `/Twin/<kod>`
  yoksa ekranın üstünde kırmızı uyarı çıkar.
- `istasyon-kopyala.ps1` yeni istasyona kaynağın arayüzünü (`shared\twin`) artık taşımıyor.

## A. Bu PC'de (taşımadan önce)

1. İstasyon **çalışırken**, **yönetici olarak açılmış PowerShell'de**, proje klasöründe:
   ```
   make tasi AYAR=ayarlar/yasyldepe.json HEDEF=E:\stations
   ```
   (make yoksa: `powershell -ExecutionPolicy Bypass -File tools\kurulum\tasima.ps1 -Ayar ayarlar\yasyldepe.json -Hedef E:\stations`)

   Niagara şifresi sorulur. Betik istasyonu kaydeder, yerel klasöre alır ve denetler. Ardından
   `E:\stations\YASYLDEPE` (istasyon), `E:\stations\surucu` (`timescale-rt.jar`,
   `akyllyoy-codesign.pem`) ve ayar dosyası oluşur.
   - "Twin altında başka: TwinSim" → Workbench'te `Config → Twin → TwinSim` silin, sonra tekrar çalıştırın.
   - "istasyon adı …" → istasyonun adı ayar dosyasındaki `niagara.istasyon` ile aynı olmalı.
2. USB'ye bunlarla birlikte **`otomasyon` proje klasörünün tamamı** da gider (ya da hedefte
   `git clone`; önce bu PC'den `git push`). Kurulum dosyaları (`gereksinimler\`) git'te yoktur,
   USB ile gider.

Elle yapmak isterseniz (betik yerine): Workbench → istasyona sağ tık → **Save Station**. Sonra
Platform → **Station Copier** → sağdaki (platform) istasyonu **sola** kopyalayın. Ardından
`tasima.ps1 … -Kaynak <yerel klasör>`.

## B. Hedef PC'de

1. **Niagara 4.15** kurun, lisansı yükleyin.
2. **Gereksinimler** (yönetici PowerShell, proje klasöründe):
   ```
   powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim-kur.ps1
   ```
   PostgreSQL kurulumunda `postgres` şifresini siz belirlersiniz; unutmayın.
3. **Sürücü modülü (elle, bir kez)**, `surucu\` klasöründen:
   1. Workbench → Tools → Certificate Management → User Trust Store → Import → `akyllyoy-codesign.pem`.
   2. Platform'a bağlanın → Certificate Management → User Trust Store → Import → aynı dosya.
      Parmak izi: `9D:25:35:92:…:8D:7F:B4`.
   3. İstasyonu durdurun, Workbench'i kapatın.
   4. `timescale-rt.jar` → Niagara kurulum klasörünün `modules\` klasörüne (`make gereksinim` gösterir).
   5. Workbench'i başlatın.
4. **İstasyonu kopyalayın:** USB'deki istasyon klasörünü (ör. `YASYLDEPE`)
   `C:\Users\<kullanıcı>\Niagara4.15\TridiumEMEA\stations\` altına koyun. Ardından Workbench →
   Platform → Station Copier ile platforma kopyalayın ve başlatın.
5. **Kurulum betiği** (PowerShell, proje klasöründe):
   ```
   make kur AYAR=ayarlar/yasyldepe.json
   ```
   - Veritabanı her PC'de yenidir: 1. ve 4. adımda `postgres` şifresi, 3. adımda Niagara şifresi sorulur.
   - 4. adımda: Workbench → Drivers → TimescaleNetwork → TimescaleDevice → Property Sheet →
     `password` → postgres şifresi → Save, sonra PowerShell'de Enter.
   - Yarıda kalırsa: `make kur AYAR=… ADIM=4` (o adımdan devam).
6. **Saha cihazları:** Milesight / Modbus sürücüleri ve cihazları sahadaki gerçek cihazlara göre
   ayarlanır. Twin noktaları bağlı değilse bağlanır. Liste:
   ```
   node tools\jace\deploy.mjs x y --station stations\ps-05.json --plan
   ```
7. **Kontrol:**
   - `make durum AYAR=ayarlar/yasyldepe.json`
   - `https://127.0.0.1/file/twin/index.html` → **Ctrl+F5**. Başlıkta istasyonun adı olmalı, kırmızı uyarı olmamalı.
   - `TimescaleHistoryExport` → `lastRun` 5 dakikada bir değişmeli, `lastError` boş olmalı.

## Kurulumun kendisi neyi kurar, neyi kurmaz

| Ne | Kim kurar |
|---|---|
| PostgreSQL, TimescaleDB, Node, Chrome, make | `gereksinim-kur.ps1` |
| `timescale-rt.jar` (modules klasörü) ve sertifika (trust store) | **Elle** (B.3). `make kur` 2. adımda yalnız denetler; eksikse durur. |
| İstasyonun içinde TimescaleNetwork / TimescaleDevice / TimescaleHistoryExport, TsOkuma okuma servisi | `make kur` |
| Veritabanı, tablolar, saklama politikaları, görünümler | `make kur` |
| Arayüz (`file:^twin`), `/Twin/<kod>` noktaları, history uzantıları | `make kur` (arayüz ayrıca `tasima.ps1` ile kopyaya konur) |
| Milesight / Modbus saha sürücüleri ve cihazları | **Elle** |
| Twin noktalarının gerçek noktalara bağlanması | **Elle** (B.6) |

Ayrıntı ve sorun giderme: `KURULUM.md`.
