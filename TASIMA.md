# İstasyonu başka bir PC'ye taşıma

Her istasyon kendi PC'sinde çalışır (Niagara lisansı aynı anda 1 istasyon). Portlar hepsinde
aynıdır: web 80/443, Fox 1911/4911.

## Neden "nasoslar uymadı" (12 Ekim)

`C:\Users\<kullanıcı>\Niagara4.15\TridiumEMEA\stations\<istasyon>` klasörü Workbench'in **yerel
kopyasıdır**. Çalışan istasyon başka yerdedir (`C:\ProgramData\Niagara4.15\…`, erişim kapalı).
Kurulum betiği (`make kur`) **çalışan** istasyona yazar: Twin noktaları, arayüz (`file:^twin`),
history. Yerel kopya bundan habersiz kalır.

YASYLDEPE ve BIRINJI_MAY, MAGTYMGULY'den kopyalanarak oluşturuldu. Yerel kopyalarında hâlâ
Magtymguly'nin arayüzü (`shared\twin\stations.json` → PS-01, 6 nasos) vardı ve `/Twin/PS-05`,
`/Twin/PS-04` yoktu. Bu klasör taşınınca yeni PC'de Magtymguly'nin nasosları göründü. `make kur`
8. adımda doğru arayüzü yazınca düzeldi.

Önlem:
- **`tasima.ps1`**: taşınacak kopyayı denetler. Ad, `/Twin/<kod>` ve Twin altında başka bir şey
  (TwinSim, başka istasyon) olup olmadığına bakar. Bir sorun varsa durur ve **kopyalamaz**.
  Arayüzü her zaman `paket\<kod>` ile değiştirir.
- **Arayüz kendini denetler:** Paket başka bir Niagara istasyonuna açılırsa ya da `/Twin/<kod>`
  yoksa ekranın üstünde kırmızı uyarı çıkar.
- `istasyon-kopyala.ps1` yeni istasyona kaynağın arayüzünü (`shared\twin`) artık taşımıyor.

## A. Bu PC'de (taşımadan önce)

1. **Çalışan istasyonu kaydedin:** Workbench → istasyona bağlanın → istasyona sağ tık →
   **Save Station**.
2. **Çalışan istasyonu yerel klasöre alın:** Workbench → Platform → **Station Copier** →
   sağdaki (platform) istasyonu seçin → **sola** (yerel) kopyalayın. Aynı ad varsa üzerine yazın.
3. **Taşıma klasörünü hazırlayın** (PowerShell, proje klasöründe):
   ```
   powershell -ExecutionPolicy Bypass -File tools\kurulum\tasima.ps1 -Ayar ayarlar\yasyldepe.json -Hedef E:\stations
   ```
   `E:\stations\YASYLDEPE` (istasyon, arayüzü `paket\ps-05`), `E:\stations\surucu`
   (`timescale-rt.jar`, `akyllyoy-codesign.pem`) ve ayar dosyası oluşur.
   - "HATA … kurulumdan ÖNCEKİ hali" → 1. ve 2. adım yapılmamış.
   - "Twin altında başka: TwinSim" → Workbench'te `Config → Twin → TwinSim` silin, Save, 1–3'ü tekrarlayın.
   - "istasyon adı …" → Station Copier'da doğru adla kopyalayın.
4. USB'ye bunlarla birlikte **`otomasyon` proje klasörünün tamamı** da gider (ya da hedefte
   `git clone`; önce bu PC'den `git push`). Kurulum dosyaları (`gereksinimler\`) git'te yoktur,
   USB ile gider.

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
