# Gereksinimleri gereksinimler\ klasorundeki kurulum dosyalarindan kurar (internet gerekmez).
# make'ten ONCE calisir (make'i de bu kurar):
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim-kur.ps1
#
# 1) Dosyalarin SHA256'si gereksinimler\LISTE.md ile karsilastirilir (bozuk/yanlis dosya kurulmaz)
# 2) Node.js ve GNU make: C:\Users\<ad>\tools altina acilir, PATH'e (kullanici) eklenir
# 3) Chrome, PostgreSQL, TimescaleDB: kurulu degilse kurulum programi baslatilir (sorulari siz yanitlarsiniz)
# Kurulu olana dokunulmaz. Niagara bu klasorde yoktur (lisansli kurulum).
# -Denetle: yalniz dosyalari dogrular, hicbir sey kurmaz.
# (Dosya bilerek ASCII.)
param([switch]$Denetle)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dir = Join-Path $root 'gereksinimler'
$tools = Join-Path $env:USERPROFILE 'tools'
New-Item -ItemType Directory -Force $tools | Out-Null

# ---- 1) dogrulama: LISTE.md'deki "```sha256" blogu (sha256sum bicimi: <hash>  <dosya>)
$liste = Get-Content (Join-Path $dir 'LISTE.md') -Raw -Encoding UTF8
$block = [regex]::Match($liste, '(?s)```sha256\s*(.*?)```').Groups[1].Value
$want = @{}
foreach ($l in ($block -split "`n")) { $m = [regex]::Match($l.Trim(), '^([0-9a-fA-F]{64})\s+\*?(.+)$'); if ($m.Success) { $want[$m.Groups[2].Value.Trim()] = $m.Groups[1].Value.ToLower() } }
$bad = 0
foreach ($f in $want.Keys) {
  $p = Join-Path $dir $f
  if (-not (Test-Path $p)) { Write-Host "  EKSIK  $f" -ForegroundColor Yellow; $bad++; continue }
  $h = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $want[$f]) { Write-Host "  BOZUK  $f (SHA256 uyusmuyor)" -ForegroundColor Red; $bad++ } else { Write-Host "  TAMAM  $f" }
}
if ($bad) { throw "$bad dosya eksik/bozuk: gereksinimler\LISTE.md'deki adreslerden yeniden indirin" }
if (-not $want.Count) { throw 'gereksinimler\LISTE.md icinde sha256 listesi bulunamadi' }
if ($Denetle) { Write-Host "$($want.Count) dosya dogrulandi (kurulum yapilmadi: -Denetle)" -ForegroundColor Green; exit 0 }

function Add-UserPath([string]$p) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($cur -split ';') -notcontains $p) { [Environment]::SetEnvironmentVariable('Path', ($cur.TrimEnd(';') + ';' + $p), 'User'); Write-Host "  PATH'e eklendi: $p (yeni acilan pencerelerde gecerli)" }
  if (($env:Path -split ';') -notcontains $p) { $env:Path = $env:Path + ';' + $p }
}
function Ask([string]$q) { return ((Read-Host "$q (e/h)") -eq 'e') }

# ---- 2) Node.js
$nodeZip = Get-ChildItem $dir -Filter 'node-v*-win-x64.zip' | Select-Object -First 1
$nodeDir = Join-Path $tools ($nodeZip.BaseName)
if (Get-Command node -CommandType Application -ErrorAction SilentlyContinue) { Write-Host "Node: kurulu ($(node --version))" }
elseif (Test-Path (Join-Path $nodeDir 'node.exe')) { Write-Host "Node: $nodeDir var"; Add-UserPath $nodeDir }
else { Write-Host "Node: $nodeDir acilir..."; Expand-Archive $nodeZip.FullName $tools -Force; Add-UserPath $nodeDir }

# ---- GNU make
$makeZip = Get-ChildItem $dir -Filter 'make-*-w32-bin.zip' | Select-Object -First 1
$makeDir = Join-Path $tools ($makeZip.BaseName)
if (Get-Command make -CommandType Application -ErrorAction SilentlyContinue) { Write-Host 'make: kurulu' }
else {
  if (-not (Test-Path (Join-Path $makeDir 'bin\make.exe'))) { Write-Host "make: $makeDir acilir..."; Expand-Archive $makeZip.FullName $makeDir -Force }
  Add-UserPath (Join-Path $makeDir 'bin')
}

# ---- 3) Chrome
if (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') { Write-Host 'Chrome: kurulu' }
elseif (Ask 'Chrome kurulsun mu (yonetici izni ister)?') {
  $msi = Get-ChildItem $dir -Filter 'googlechrome*.msi' | Select-Object -First 1
  Start-Process msiexec.exe -ArgumentList '/i', "`"$($msi.FullName)`"", '/passive' -Verb RunAs -Wait
}

# ---- PostgreSQL
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($psql) { Write-Host "PostgreSQL: kurulu ($($psql.FullName))" }
elseif (Ask 'PostgreSQL kurulsun mu? (postgres sifresini belirleyin ve UNUTMAYIN; port 5432; Stack Builder gerekmez)') {
  $pg = Get-ChildItem $dir -Filter 'postgresql-*-windows-x64.exe' | Select-Object -First 1
  Start-Process $pg.FullName -Verb RunAs -Wait
  $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
}

# ---- TimescaleDB
if ($psql) {
  $pgRoot = Split-Path (Split-Path $psql.FullName)
  $dll = Get-ChildItem (Join-Path $pgRoot 'lib') -Filter 'timescaledb-2*.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($dll) { Write-Host "TimescaleDB: kurulu ($($dll.BaseName))" }
  elseif (Ask 'TimescaleDB kurulsun mu? (setup.exe postgresql.conf ayarini sorar: evet deyin)') {
    $zip = Get-ChildItem $dir -Filter 'timescaledb-*-windows-amd64.zip' | Select-Object -First 1
    $tmp = Join-Path $env:TEMP 'timescaledb-kurulum'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip.FullName $tmp -Force
    $setup = Get-ChildItem $tmp -Recurse -Filter 'setup.exe' | Select-Object -First 1
    if (-not $setup) { throw "setup.exe bulunamadi ($tmp)" }
    Start-Process $setup.FullName -WorkingDirectory $setup.DirectoryName -Verb RunAs -Wait
    $svc = Get-Service 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc -and (Ask "PostgreSQL servisi ($($svc.Name)) yeniden baslatilsin mi (TimescaleDB icin gerekli)?")) {
      Start-Process powershell -ArgumentList '-NoProfile', '-Command', "Restart-Service '$($svc.Name)'" -Verb RunAs -Wait
    }
  }
} else { Write-Host 'TimescaleDB: once PostgreSQL kurulmali' -ForegroundColor Yellow }

Write-Host ''
Write-Host 'Bitti. Yeni bir PowerShell penceresi acip kontrol edin: make gereksinim' -ForegroundColor Green
