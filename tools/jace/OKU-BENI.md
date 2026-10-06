# JACE araçları — `file:^twin` kurulumu

İkizin JACE sürümü istasyonun dosya alanında çalışır:
`https://192.168.1.140/file/twin/index.html` (istasyon **PSS21_JACE_04_09_2026**).
Veriyi `station:|slot:/Twin/PS-01/...` noktalarından BajaScript ile okur
(`web/src/data/niagara.ts`).

## Tek komut (önerilen)

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\DELL\Desktop\otomasyon\tools\jace\kur.ps1          # hazır paketi kurar
powershell -ExecutionPolicy Bypass -File C:\Users\DELL\Desktop\otomasyon\tools\jace\kur.ps1 -Build   # önce derler + paketler
```

Chrome'u gerekirse kendisi açar, JACE şifresini sorar, yedeği masaüstünde
`twin_yedek_<tarih_saat>` klasörüne alır. Giriş başarısızsa artık açıkça
"JACE'e giriş yapılamadı" der (önceden anlaşılmaz `/requirejs/config.js` hatası veriyordu).

## Hazırlık — elle (her oturumda bir kez)

Araçlar başsız Chrome'u DevTools portu 9333'ten sürer:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9333 `
  --user-data-dir="$env:TEMP\twin-chrome" --window-size=1600,900 --ignore-certificate-errors `
  --use-angle=swiftshader --enable-unsafe-swiftshader --proxy-server=direct:// --proxy-bypass-list=* about:blank
$env:Path = "C:\Users\User\tools\node-v24.21.0-win-x64;" + $env:Path
$env:JU = "admin"; $env:JP = "<şifre>"           # JACE web kullanıcısı (dosyaya yazılmaz)
# farklı JACE: $env:JACE_URL = "https://<ip>"
```

## Paket

```powershell
cd web
node node_modules\vite\bin\vite.js build
node scripts\niagara-pack.mjs --stations PS-01     # → web\dist-niagara
```

Model JACE için **Draco'suz** olmalı (`generate.py --plain-out build\ps-01-plain.glb`):
JACE'in CSP başlığı `blob:` Web Worker'ı yasaklıyor, Draco çözücüsü onsuz çalışmıyor.
Paketleyici modeli 512 KB'lık parçalara böler: JACE'e istasyon üzerinden
~1 MB'tan büyük tek yazma isteği takılıyor.

## Önizleme — JACE'e YAZMADAN

```powershell
node tools\jace\preview.mjs web\dist-niagara $env:TEMP\pv
```

`/file/twin_v2/*` isteklerini tarayıcıda yakalayıp yerel paketten verir; sayfa
gerçek JACE oturumu, gerçek `/Twin` verisi ve JACE'in gerçek CSP başlığıyla çalışır.

## Kurulum — JACE'e YAZAR (kullanıcı onayıyla)

```powershell
node tools\jace\deploy.mjs web\dist-niagara C:\Users\User\Desktop\twin_yedek_<tarih>
```

1. eski dosyaların yerel yedeği (klasör zaten varsa dokunmaz)
2. geçici `FileDropTmp` programı (`/Twin` altında) — derlenmiş sınıf `FileDrop.program.json`
3. yeni dosyalar `file:^twin`'e (index.html en sona), artık kullanılmayanlar silinir
4. program kaldırılır; `PMP-0x/MOTOR/temp` ve `PMP-0x/PUMP/vib` yoksa eklenir, eklendiyse istasyon kaydedilir

Claude Code'un otomatik güvenlik denetimi bu komutu "üretim kurulumu" sayıp
engelliyor — komutu kullanıcı kendi terminalinde çalıştırır.

## Durum — salt okunur

```powershell
node tools\jace\state.mjs
```
