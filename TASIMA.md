# İstasyonu başka bir PC'ye taşıma

Her istasyon kendi PC'sinde çalışır (Niagara lisansı aynı anda 1 istasyon). Portlar hepsinde
aynıdır: web 80/443, Fox 1911/4911.

## Bu klasörde ne var

| Dosya / klasör | Ne | Durum |
|---|---|---|
| `MAGTYMGULY\` | PS-01 istasyon kopyası | **Eski kopya:** adı `ANEW_MAGTYMGULY_20261006`, `Twin` altında `TwinSim` (benzetim programı) var. Sahaya bu haliyle götürmeyin (aşağıda 3. adım). |
| `YASYLDEPE\` | PS-05 istasyon kopyası | Portlar 80/443/1911/4911. Twin yok, hedefte `make kur` kurar. |
| `BIRINJI_MAY\` | PS-04 istasyon kopyası | Portlar 80/443/1911/4911. Twin yok, hedefte `make kur` kurar. |
| `timescale-rt.jar` | TimescaleDB sürücüsü 1.7.1.0, imzalı | Hazır |
| `gereksinimler\` | PostgreSQL 18.1, TimescaleDB 2.23.1, Node 24.21.0, Chrome, make 4.4.1 | Hazır |
| `akyllyoy-codesign.pem` | Sürücünün imza sertifikası | **Bu klasörde yok.** `otomasyon\paket\surucu\akyllyoy-codesign.pem` dosyasını alın. |

USB'ye bunlarla birlikte **`otomasyon` proje klasörünün tamamı** da gider (ya da hedefte
`git clone https://github.com/govshudov/otomasyon`; önce bu PC'den `git push` yapılmış olmalı).
Hedef PC'de proje klasörünün `gereksinimler\` alt klasörüne bu klasördeki `gereksinimler\`
içeriğini koyun.

## Hedef PC'de adımlar

1. **Niagara 4.15.5** kurun, lisansı yükleyin.

2. **Gereksinimler** (yönetici PowerShell, proje klasöründe):
   ```
   powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim-kur.ps1
   ```
   PostgreSQL kurulumunda `postgres` şifresini siz belirlersiniz; unutmayın.

3. **İstasyonu kopyalayın:** Workbench → Platform → Station Copier ile istasyon klasörünü
   (ör. `YASYLDEPE`) platforma gönderin, başlatın.
   - MAGTYMGULY için: ad `MAGTYMGULY` olmalı (Station Copier'da yeni adla kopyalayın) ve
     başlattıktan sonra `Config → Twin → TwinSim` silinmeli, Save.
   - Milesight / Modbus sürücüleri ve cihazları bu PC'deki örnek cihazlardır; sahadaki
     gerçek cihazlarla yeniden eklenir / ayarlanır.

4. **Sürücü modülü (elle, bir kez):**
   1. Workbench → Tools → Certificate Management → User Trust Store → Import → `akyllyoy-codesign.pem`.
   2. Platform'a bağlanın → Certificate Management → User Trust Store → Import → aynı dosya.
      Parmak izi: `9D:25:35:92:…:8D:7F:B4`.
   3. İstasyonu durdurun, Workbench'i kapatın.
   4. `timescale-rt.jar` → `C:\Niagara\Niagara-4.15.5.22\modules\`.
   5. İstasyonu ve Workbench'i başlatın.

5. **Kurulum betiği** (PowerShell, proje klasöründe):
   ```
   make kur AYAR=ayarlar/yasyldepe.json
   ```
   (`ayarlar/magtymguly.json`, `ayarlar/1-may.json` aynı şekilde.)
   - 1. adım ve 4. adım `postgres` şifresini, 3. adım Niagara şifresini sorar.
   - 4. adımda: Workbench → Drivers → TimescaleNetwork → TimescaleDevice → Property Sheet →
     `password` → postgres şifresi → Save, sonra PowerShell'de Enter.
   - Yarıda kalırsa: `make kur AYAR=… ADIM=4` (o adımdan devam).

6. **Twin noktalarını bağlayın:** `Config → Twin → <id>` altındaki noktalar boş oluşur;
   Workbench'te gerçek noktalara bağlanır. Liste:
   ```
   node tools\jace\deploy.mjs x y --station stations\ps-05.json --plan
   ```

7. **Kontrol:**
   - `make durum AYAR=ayarlar/yasyldepe.json`
   - `https://127.0.0.1/file/twin/index.html` (Ctrl+F5): grafikler, Ähli nokatlar, Hasabatlar.
   - `TimescaleHistoryExport` → `lastRun` 5 dakikada bir değişmeli, `lastError` boş olmalı.

Ayrıntı ve sorun giderme: `otomasyon\KURULUM.md`.

## Kurulumun kendisi neyi kurar, neyi kurmaz

| Ne | Kim kurar |
|---|---|
| PostgreSQL, TimescaleDB, Node, Chrome, make | `gereksinim-kur.ps1` |
| `timescale-rt.jar` (modules klasörü) ve sertifika (trust store) | **Elle** (4. adım). `make kur` 2. adımda yalnız denetler; eksikse durur. |
| İstasyon içinde TimescaleNetwork / TimescaleDevice / TimescaleHistoryExport, okuma servisi TsOkuma | `make kur` |
| Veritabanı, tablolar, saklama politikaları, görünümler | `make kur` |
| Arayüz (`file:^twin`), `/Twin/<id>` noktaları, history uzantıları | `make kur` |
| Milesight / Modbus saha sürücüleri ve cihazları | **Elle** |
| Twin noktalarının gerçek noktalara bağlanması | **Elle** (6. adım) |
