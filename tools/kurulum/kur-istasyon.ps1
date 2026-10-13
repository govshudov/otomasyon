# Istasyon kurulumu - tek komut. Istasyonun calistigi PC'de calistirilir (veritabani localhost'ta).
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\kur-istasyon.ps1 -Ayar ayarlar\magtymguly.json
#   (ya da make kur AYAR=ayarlar/magtymguly.json; ayrintilar KURULUM.md)
#
#   -Ayar      ayar dosyasi (TEK KAYNAK: id, Niagara adi/adresi/kullanicisi, veritabani, saklama)
#   -Istasyon  eski yol: istasyon dosyasi + site bolumu (-Ayar verilmezse)
#   -Url       Niagara istasyonu (ayar dosyasindaki niagara.url'yi ezer)
#   -Basla N   N. adimdan basla (yarida kalan kurulum; adimlar zaten yapilmissa atlar)
#   -Bitir N   N. adimda dur
#   -Plan      yalniz adimlari yaz, hicbir sey yapma
#
# Adimlar (her biri once yapilmis mi diye bakar):
#   1 veritabani   PostgreSQL'e baglan, veritabani + timescaledb eklentisi (PostgreSQL/TimescaleDB ELLE kurulur)
#   2 modul        timescale-rt.jar >= 1.7.1.0 ve imzali mi (degilse ne yapilacagini yazar, durur)
#   3 okuma        okuma servisi /TsOkuma (istasyon adi denetimi de bununla)
#   4 surucu       TimescaleNetwork/Device/HistoryExport; veritabani sifresi Workbench'te girilir; tablolar
#   5 politika     saklama / sikistirma (site bolumunden)
#   6 okuma-sql    db\timescale\10_okuma.sql (gorunumler, saatlik/gunluk ozetler)
#   7 model        3D model (hazir paket paket\<id> varsa atlanir; yoksa build\<id>-plain.glb / Blender)
#   8 arayuz       arayuz + sozluk (hazir paket paket\<id> varsa o; yoksa derlenir), /Twin/<id> noktalari
#   9 history      Twin noktalarina history uzantisi (veritabanina aktarilsin)
#  10 kontrol      ozet: baglanti, aktarim, nokta sayilari
#
# Sifreler (Niagara admin, postgres) sorulur, hicbir dosyaya yazilmaz, bitince ortamdan silinir.
# TwinSim (simulasyon) KURULMAZ. (Dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i yanlis okur.)
param(
  [string]$Ayar,
  [string]$Istasyon,
  [string]$Url,
  [string]$User,
  [int]$Basla = 1,
  [int]$Bitir = 10,
  [switch]$Plan
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)    # node ciktisindaki Turkce harfler
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
if ($Ayar) {
  $ayarFile = Resolve-Path $Ayar
  $a = Get-Content $ayarFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $sid = $a.id; $low = $sid.ToLower()
  $stFile = Join-Path $root "stations\$low.json"
  if (-not (Test-Path $stFile)) { throw "stations\$low.json yok: hazirlik PC'sinde 'make istasyon AYAR=$Ayar' ile uretin ve bu PC'ye getirin" }
  $stFile = Resolve-Path $stFile
  $want = $a.niagara.istasyon
  if (-not $Url) { $Url = $a.niagara.url }
  if (-not $User) { $User = $a.niagara.kullanici }
  $dbName = $a.veritabani.ad; $dbHost = $a.veritabani.host; $dbPort = $a.veritabani.port
  $years = $a.saklama_yil; $days = $a.sikistirma_gun
  $tsArg = @('--ayar', "$ayarFile")
} elseif ($Istasyon) {
  $stFile = Resolve-Path $Istasyon
  $st0 = Get-Content $stFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $st0.site) { throw "$Istasyon icinde 'site' bolumu yok. Ayar dosyasi kullanin: -Ayar ayarlar\<istasyon>.json" }
  $sid = $st0.station_id; $low = $sid.ToLower()
  $want = $st0.site.niagara_station
  $dbName = $st0.site.db.name; $dbHost = $st0.site.db.host; $dbPort = $st0.site.db.port
  $years = $st0.site.retention_years; $days = $st0.site.compress_after_days
  $tsArg = @('--station', "$stFile")
} else { throw '-Ayar ayarlar\<istasyon>.json verilmeli' }
if (-not $Url) { $Url = 'https://127.0.0.1' }
if (-not $User) { $User = 'admin' }
if (-not $dbHost) { $dbHost = 'localhost' }; if (-not $dbPort) { $dbPort = 5432 }; if (-not $dbName) { $dbName = 'Niagara' }
if (-not $years) { $years = 5 }; if (-not $days) { $days = 7 }
$st = Get-Content $stFile -Raw -Encoding UTF8 | ConvertFrom-Json
$paket = Join-Path $root "paket\$low"
$hasPaket = Test-Path (Join-Path $paket 'index.html')

$steps = @('', 'veritabani', 'modul', 'okuma', 'surucu', 'politika', 'okuma-sql', 'model', 'arayuz', 'history', 'kontrol')
Write-Host "Istasyon: $sid ($($st.name))  Niagara adi: $want  Niagara: $Url  veritabani: ${dbHost}:${dbPort}/$dbName"
if ($Plan) { for ($i = $Basla; $i -le $Bitir; $i++) { Write-Host "  $i $($steps[$i])" }; exit 0 }
if ($Url -notmatch '127\.0\.0\.1|localhost') { Write-Warning 'Uzak istasyon: betik istasyonun calistigi PC icin yazildi (veritabani ve modul kontrolu bu PC''de yapilir).' }

# ---- araclar ----
$env:JACE_URL = $Url.TrimEnd('/'); $env:JU = $User
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
  if (-not $nodeDir) { throw 'node bulunamadi: PATH''e ekleyin ya da C:\Users\<ad>\tools altina kurun' }
  $env:Path = $nodeDir.FullName + ';' + $env:Path
}
$nodeExe = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
# Niagara kurulum klasoru: once calisan 'Niagara' servisinin (niagarad.exe) klasoru - istasyonu o calistirir
# ve modulleri oradan yukler; servis yoksa <surucu>:\Niagara\Niagara-4* (C:, D: ...).
function Find-NiagaraHome {
  $svc = Get-CimInstance Win32_Service -Filter "Name='Niagara'" -ErrorAction SilentlyContinue
  if ($svc -and $svc.PathName -match '^"?(.+?)\\bin\\niagarad\.exe' -and (Test-Path $Matches[1])) { return Get-Item $Matches[1] }
  $roots = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { Join-Path $_.Name 'Niagara' } | Where-Object { Test-Path $_ })
  if (-not $roots) { return $null }
  return Get-ChildItem $roots -Directory -Filter 'Niagara-4*' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
}
$nh = Find-NiagaraHome

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  if (-not $v) { throw 'sifre bos' }
  return $v
}
function Need-Niagara { if (-not $env:JP) { $env:JP = Read-Secret "Niagara sifresi ($User)" } ; Ensure-Chrome }
function Need-Pg {
  if (-not $psql) { throw 'psql bulunamadi (C:\Program Files\PostgreSQL\<surum>\bin). PostgreSQL kurulu mu?' }
  if (-not $env:PGPASSWORD) { $env:PGPASSWORD = Read-Secret 'PostgreSQL sifresi (postgres)' }
}
# SQL stdin'den verilir: PowerShell 5.1 komut satirindaki cift tirnaklari siler
# (CREATE DATABASE "Niagara" -> niagara). NOTICE'lar (stderr) betigi durdurmasin diye yerel Continue.
function Pg([string]$db, [string]$sql) {
  $ErrorActionPreference = 'Continue'
  $OutputEncoding = New-Object Text.UTF8Encoding($false)    # stdin UTF-8 (5.1 varsayilani ASCII)
  $env:PGCLIENTENCODING = 'UTF8'
  $o = $sql | & $psql.FullName -h $dbHost -p $dbPort -U postgres -d $db -v ON_ERROR_STOP=1 -At -f - 2>&1
  $code = $LASTEXITCODE
  $txt = @($o | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^(NOTICE|psql:.*NOTICE)' })
  if ($code) { throw "psql: $($txt -join ' ')" }
  return ($txt -join "`n").Trim()
}
$script:chromeProc = $null
function Test-Cdp { try { Invoke-WebRequest http://127.0.0.1:9333/json/version -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false } }
function Ensure-Chrome {
  if (Test-Cdp) { return }
  Write-Host 'Bassiz Chrome baslatiliyor (port 9333)...'
  $script:chromeProc = Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -PassThru -ArgumentList @(
    '--headless=new', '--remote-debugging-port=9333', "--user-data-dir=$env:TEMP\twin-chrome",
    '--window-size=1600,900', '--ignore-certificate-errors', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--proxy-server=direct://', '--proxy-bypass-list=*', 'about:blank')
  for ($i = 0; $i -lt 30 -and -not (Test-Cdp); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Cdp)) { throw 'Chrome 9333 portunda acilmadi' }
}
# node.exe tam yoluyla: "node" adli bir PowerShell fonksiyonu kendini cagirirdi (sonsuz dongu)
function Run-Node([string[]]$a) { & $nodeExe @a; if ($LASTEXITCODE) { throw "basarisiz: node $($a -join ' ')" } }
function TsDurum([string]$mode, [string[]]$extra = @()) {
  $lines = & $nodeExe tools\kurulum\timescale-niagara.mjs @tsArg $mode @extra
  if ($LASTEXITCODE) { throw 'timescale-niagara.mjs basarisiz' }
  $json = $null
  foreach ($l in $lines) { if ($l -like 'SONUC *') { $json = $l.Substring(6) | ConvertFrom-Json } else { Write-Host $l } }
  return $json
}
# Sema ve tablolar: surucunun kendi kodu (TsSchema) istasyonun disinda calistirilir. TimescaleDevice'in
# createSchema eylemi tarayicidan cagrilinca sifreyi okuyamiyor (SecurityException), tablolar olusmuyordu.
function Sema-Kur {
  $ErrorActionPreference = 'Continue'    # javac/java'nin stderr satirlari betigi durdurmasin
  if (-not $nh) { throw 'Niagara kurulumu bulunamadi (sema icin jre ve modules\timescale-rt.jar gerekir)' }
  $jar = Join-Path $nh.FullName 'modules\timescale-rt.jar'
  $javac = Join-Path $nh.FullName 'jre\bin\javac.exe'; $java = Join-Path $nh.FullName 'jre\bin\java.exe'
  foreach ($f in $jar, $javac, $java) { if (-not (Test-Path $f)) { throw "bulunamadi: $f" } }
  $tmp = Join-Path $env:TEMP ('tssema-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    & $javac -nowarn -encoding UTF-8 -cp $jar -d $tmp tools\kurulum\TsSema.java
    if ($LASTEXITCODE) { throw 'tools\kurulum\TsSema.java derlenemedi' }
    & $java -cp "$tmp;$jar" TsSema $dbHost $dbPort $dbName niagara postgres
    if ($LASTEXITCODE) { throw 'sema olusturulamadi (hata yukarida)' }
  } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
function Step([int]$n) { if ($n -lt $Basla -or $n -gt $Bitir) { return $false }; Write-Host ''; Write-Host "== $n/10 $($steps[$n]) ==" -ForegroundColor Cyan; return $true }

try {
  # 1 ---------------------------------------------------------------- veritabani
  if (Step 1) {
    Need-Pg
    Write-Host ('  PostgreSQL: ' + (Pg 'postgres' 'SHOW server_version'))
    if ((Pg 'postgres' "SELECT count(*) FROM pg_database WHERE datname = '$dbName'") -eq '0') {
      Pg 'postgres' "CREATE DATABASE `"$dbName`"" | Out-Null; Write-Host "  + veritabani $dbName"
    } else { Write-Host "  veritabani $dbName var" }
    try { Pg $dbName 'CREATE EXTENSION IF NOT EXISTS timescaledb' | Out-Null }
    catch { throw "timescaledb eklentisi kurulamadi. TimescaleDB bu PostgreSQL surumu icin kurulu mu ve postgresql.conf'ta shared_preload_libraries = 'timescaledb' var mi? ($_)" }
    Write-Host ('  TimescaleDB: ' + (Pg $dbName "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"))
  }

  # 2 ---------------------------------------------------------------- modul
  if (Step 2) {
    if (-not $nh) { throw 'Niagara kurulumu bulunamadi: ''Niagara'' servisi yok ve hicbir surucude \Niagara\Niagara-4.x klasoru yok. Niagara kurulu mu?' }
    Write-Host "  Niagara: $($nh.FullName)"
    $jar = Join-Path $nh.FullName 'modules\timescale-rt.jar'
    if (-not (Test-Path $jar)) { $ver = 'YOK'; $signed = $false } else {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead($jar)
      try {
        $rd = New-Object IO.StreamReader($z.GetEntry('META-INF/module.xml').Open()); $xml = $rd.ReadToEnd(); $rd.Close()
        $ver = [regex]::Match($xml, 'vendorVersion="([^"]+)"').Groups[1].Value
        $signed = [bool]$z.GetEntry('META-INF/AKYLLYOY.SF')
      } finally { $z.Dispose() }
    }
    Write-Host "  timescale-rt: $ver, imzali: $signed"
    if ($ver -eq 'YOK' -or [version]$ver -lt [version]'1.7.1.0' -or -not $signed) {
      Write-Host ''
      Write-Host '  Modul kurulmali (1.7.1.0 ya da yenisi, imzali):' -ForegroundColor Yellow
      Write-Host '   1) Imzali jar: paket\surucu\timescale-rt.jar (repoda hazir; yeni surum: make surucu + make imzala)'
      Write-Host "   2) Istasyonu durdurun, Workbench'i kapatin; jar'i $($nh.FullName)\modules\ altina koyun"
      Write-Host '   3) Ilk kurulumsa paket\surucu\akyllyoy-codesign.pem: Workbench ve Platform -> Certificate Management -> User Trust Store -> Import'
      Write-Host "   4) Istasyonu baslatin ve bu betigi -Basla 3 ile yeniden calistirin"
      exit 3
    }
  }

  # 3 ---------------------------------------------------------------- okuma servisi
  if (Step 3) {
    Need-Niagara
    Run-Node @('tools\jace\okuma-kur.mjs')
  }

  # 4 ---------------------------------------------------------------- surucu
  if (Step 4) {
    Need-Niagara; Need-Pg
    $r = TsDurum '--kur'
    if ($r.station -and $r.station -ne $want) {
      Write-Warning "Niagara istasyon adi '$($r.station)', dosyada '$want'. Surucu veriyi '$($r.station)' adiyla yazar."
      if ((Read-Host 'Yine de devam edilsin mi? (e/h)') -ne 'e') { throw 'istasyon adi uyusmuyor: Niagara istasyonunu dosyadaki adla kurun ya da dosyayi duzeltin' }
    }
    if (-not $r.connected) {
      Write-Host ''
      Write-Host '  Veritabani sifresi Workbench''te girilmeli (bu betik sifreye dokunmaz):' -ForegroundColor Yellow
      Write-Host '   Drivers -> TimescaleNetwork -> TimescaleDevice -> Property Sheet -> password -> postgres sifresi -> Save'
      Read-Host '  Girdikten sonra Enter'
      $r = TsDurum '--bekle' @('120')
      if (-not $r.connected) { throw 'TimescaleDevice veritabanina baglanamadi (sifre, host/port, pg_hba.conf?). Duzeltip -Basla 4 ile tekrar calistirin.' }
    }
    if ((Pg $dbName "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'niagara' AND table_name = 'point'") -eq '0') {
      Write-Host '  tablolar yok: olusturuluyor (surucunun sema kodu)...'
      Sema-Kur
      if ((Pg $dbName "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'niagara' AND table_name = 'point'") -eq '0') { throw 'tablolar olusmadi (niagara.point yok)' }
    }
    Write-Host ('  tablolar: ' + (Pg $dbName "SELECT string_agg(hypertable_name, ', ' ORDER BY hypertable_name) FROM timescaledb_information.hypertables WHERE hypertable_schema = 'niagara'"))
  }

  # 5 ---------------------------------------------------------------- politika
  if (Step 5) {
    Need-Niagara
    Run-Node @('tools\jace\ts-export-ayar.mjs', '--yil', "$years", '--sikistir', "$days")
  }

  # 6 ---------------------------------------------------------------- okuma-sql
  if (Step 6) {
    Need-Pg
    Pg $dbName (Get-Content db\timescale\10_okuma.sql -Raw -Encoding UTF8) | Out-Null
    Write-Host '  gorunumler ve ozetler hazir'
  }

  # 7 ---------------------------------------------------------------- model
  if (Step 7) {
    $plain = "build\$low-plain.glb"; $glb = "web\public\models\$low.glb"; $map = "web\public\models\$low-twin-map.json"
    if ($hasPaket) { Write-Host "  hazir paket var (paket\$low): model paketin icinde, atlandi" }
    elseif ((Test-Path $plain) -and (Test-Path $glb) -and (Test-Path $map)) { Write-Host "  model var ($plain)" } else {
      $blender = Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Recurse -Filter blender.exe -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $blender) { throw "3D model yok ($plain) ve Blender bulunamadi. Modeli Blender olan PC'de uretin (bu adim) ve build\$low-plain.glb ile web\public\models\$low*.{glb,json} dosyalarini buraya getirin." }
      Write-Host "  Blender ile uretiliyor ($($blender.FullName))..."
      & $blender.FullName --background --python tools\genmodel\generate.py -- --config $stFile --out "build\$low.glb" --twin-map "build\$low-twin-map.json" --plain-out $plain
      if ($LASTEXITCODE) { throw 'model uretilemedi' }
      Copy-Item "build\$low.glb" $glb -Force; Copy-Item "build\$low-twin-map.json" $map -Force
      Write-Host "  model: $plain, $glb"
    }
  }

  # 8 ---------------------------------------------------------------- arayuz + Twin noktalari
  if (Step 8) {
    Need-Niagara
    if ($hasPaket) {
      # Hazir paket (hazirlik PC'sinde 'make paket'): bu PC'de derleme / node_modules gerekmez
      $dist = $paket
      Write-Host "  hazir paket: paket\$low"
    } else {
      if (-not (Test-Path 'web\node_modules\vite')) { throw "hazir paket (paket\$low) yok ve web\node_modules kurulu degil. Hazirlik PC'sinde 'make paket AYAR=...' calistirip paket\$low klasorunu getirin." }
      Push-Location web
      try {
        & $nodeExe node_modules\vite\bin\vite.js build; if ($LASTEXITCODE) { throw 'web derlemesi basarisiz' }
        & $nodeExe scripts\niagara-pack.mjs --stations $sid; if ($LASTEXITCODE) { throw 'paket uretilemedi' }
      } finally { Pop-Location }
      $dist = 'web\dist-niagara'
    }
    $backup = Join-Path ([Environment]::GetFolderPath('Desktop')) ("twin_yedek_${low}_" + (Get-Date -Format 'yyyy-MM-dd_HHmm'))
    Run-Node @('tools\jace\deploy.mjs', $dist, $backup, '--station', $stFile, '--create-twin')
  }

  # 9 ---------------------------------------------------------------- history
  if (Step 9) {
    Need-Niagara
    Run-Node @('tools\jace\twin-history.mjs', '--station', $stFile)
  }

  # 10 --------------------------------------------------------------- kontrol
  if (Step 10) {
    Need-Niagara; Need-Pg
    $r = TsDurum '--durum'
    $name = if ($r.station) { $r.station } else { $want }
    Write-Host ('  veritabaninda ' + $name + ': ' + (Pg $dbName "SELECT count(*) || ' nokta, ' || count(*) FILTER (WHERE name LIKE 'TWIN_%') || ' Twin' FROM niagara.point WHERE station = '$name'"))
    Write-Host ''
    Write-Host 'Kalan elle isler:' -ForegroundColor Yellow
    Write-Host "  - Twin noktalari (/Twin/$sid) gercek pompa/kolektor noktalarina Workbench'te baglanmali; baglanmazsa kartlar sabit deger gosterir"
    Write-Host '  - Ilk aktarim turu 5 dakika icinde; sonra arayuzde grafiklerin altinda "maglumat binyady" gorunmeli'
    Write-Host "  - Sayfa: $Url/file/twin/index.html (Ctrl+F5)"
  }
  Write-Host ''
  Write-Host 'TAMAM' -ForegroundColor Green
} finally {
  $env:JP = $null; $env:PGPASSWORD = $null
  if ($script:chromeProc) {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'twin-chrome' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
