# Bir istasyonu baska PC'ye tasimak icin USB klasorunu hazirlar ve kopyayi denetler.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\tasima.ps1 -Ayar ayarlar\yasyldepe.json -Hedef E:\stations
#       [-Kaynak <istasyon klasoru>] [-Zorla]
#
# -Kaynak verilmezse (YONETICI PowerShell, istasyon CALISIRKEN): once calisan istasyon kaydedilir ve Workbench'in
# yerel klasorune kopyalanir (kur-istasyon.ps1 adim 11 = yerel-kopya.ps1; Niagara sifresi sorulur), sonra o klasor
# tasinir. Boylece burada ne varsa orada da o olur. -Kaynak <klasor>: verilen klasor oldugu gibi denetlenip tasinir.
#
# Denetler (biri tutmazsa durur; -Zorla ile yalniz uyarir):
#   - config.bog'daki stationName = ayardaki niagara.istasyon
#   - Twin altinda yalniz bu istasyonun klasoru var (/Twin/<id>); TwinSim ya da baska istasyon yok
# Uyarir: Twin noktalarinda hic link yoksa (gercek cihazlara baglanmamis).
# Hedef\<istasyon> klasorune kopyalar; arayuzu (shared\twin) paket\<id> ile degistirir (kurulum betiginin
# 8. adiminin istasyona yazdigiyla ayni dosyalar). Yanina surucu (jar + pem) ve ayar dosyasi konur.
# Kaynaga dokunulmaz. (Dosya bilerek ASCII.)
param(
  [Parameter(Mandatory = $true)][string]$Ayar,
  [Parameter(Mandatory = $true)][string]$Hedef,
  [string]$Kaynak,
  [switch]$Zorla
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$ayarPath = (Resolve-Path $Ayar).Path
$a = Get-Content $ayarPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sid = $a.id; $low = $sid.ToLower(); $ist = $a.niagara.istasyon
if (-not $sid -or -not $ist) { throw "$Ayar icinde id ya da niagara.istasyon yok" }
if (-not $Kaynak) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw 'Yonetici PowerShell gerekli (calisan istasyon yerel klasore alinir). Ya da -Kaynak <istasyon klasoru> verin.' }
  Write-Host "calisan istasyon kaydedilip yerel klasore aliniyor ($ist)..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools\kurulum\kur-istasyon.ps1') -Ayar $ayarPath -Basla 11 -Bitir 11
  if ($LASTEXITCODE) { throw 'calisan istasyon yerel klasore alinamadi (hata yukarida). Istasyon calisiyor mu?' }
  $loc = @(Get-ChildItem (Join-Path $env:USERPROFILE 'Niagara4.*\*\stations') -Directory -ErrorAction SilentlyContinue | Sort-Object FullName)
  $Kaynak = Join-Path $loc[-1].FullName $ist
  Write-Host ''
}
$bog = Join-Path $Kaynak 'config.bog'
if (-not (Test-Path $bog)) { throw "istasyon yok: $bog" }
$paket = Join-Path $root "paket\$low"
if (-not (Test-Path (Join-Path $paket 'stations.json'))) { throw "paket\$low yok: once make paket AYAR=$Ayar" }

$hatalar = New-Object System.Collections.Generic.List[string]
function Sorun([string]$m) { $script:hatalar.Add($m); Write-Host "  HATA: $m" -ForegroundColor Red }

Write-Host "kaynak: $Kaynak  (son kayit: $((Get-Item $bog).LastWriteTime))"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($bog)
try { $r = New-Object IO.StreamReader($z.Entries[0].Open(), [Text.Encoding]::UTF8); $xmlText = $r.ReadToEnd(); $r.Close() } finally { $z.Dispose() }
$d = New-Object Xml.XmlDocument; $d.LoadXml($xmlText)
$stn = $d.DocumentElement.SelectSingleNode('p')

# 1) ad
$name = $stn.SelectSingleNode("p[@n='stationName']")
$name = if ($name) { $name.GetAttribute('v') } else { '' }
if ($name -ne $ist) { Sorun "istasyon adi '$name', ayarda '$ist'. Station Copier'da dogru adla kopyalayin." } else { Write-Host "  ad: $name" }

# 2) Twin klasoru
$slot = $sid -replace '-', '$2d'
$tw = $stn.SelectSingleNode("p[@n='Twin']")
$kids = if ($tw) { @($tw.SelectNodes('p') | ForEach-Object { $_.GetAttribute('n') }) } else { @() }
if (-not ($kids -contains $slot)) {
  Sorun "/Twin/$sid yok: bu kopya kurulumdan ONCEKI hali. Calisan istasyonu Station Copier ile yerel klasore kopyalayin."
} else { Write-Host "  /Twin/$sid var" }
$fazla = @($kids | Where-Object { $_ -ne $slot })
if ($fazla) { Sorun ("Twin altinda baska: " + ($fazla -join ', ') + " (Workbench'te silin, Save, yeniden kopyalayin)") }

# 3) Twin noktalarina gelen linkler
$links = if ($tw) { @($tw.SelectNodes(".//p[@t='b:Link']")).Count } else { 0 }
if ($links -eq 0) { Write-Host "  UYARI: Twin noktalarinda hic link yok (gercek cihazlara baglanmamis; hedefte baglanacak)" -ForegroundColor Yellow } else { Write-Host "  Twin linkleri: $links" }

# bilgi: surucu, okuma servisi, portlar
$drv = $stn.SelectSingleNode("p[@n='Drivers']/p[@n='TimescaleNetwork']")
$ts = $stn.SelectSingleNode(".//p[@n='TsOkuma']")
Write-Host ("  TimescaleNetwork: " + $(if ($drv) { 'var' } else { 'YOK (make kur kurar)' }) + ", TsOkuma: " + $(if ($ts) { 'var' } else { 'YOK (make kur kurar)' }))
$svc = $stn.SelectSingleNode("p[@n='Services']")
$port = { param($s, $p) $n = $svc.SelectSingleNode("p[@n='$s']/p[@n='$p']/p[@n='publicServerPort']"); if ($n) { $n.GetAttribute('v') } else { '?' } }
Write-Host ("  portlar: http " + (& $port 'WebService' 'httpPort') + ", https " + (& $port 'WebService' 'httpsPort') + ", fox " + (& $port 'FoxService' 'foxPort') + ", foxs " + (& $port 'FoxService' 'foxsPort'))

# kopyadaki arayuz hangi istasyonun
$ui = Join-Path $Kaynak 'shared\twin\stations.json'
if (Test-Path $ui) {
  $uiIds = @((Get-Content $ui -Raw -Encoding UTF8 | ConvertFrom-Json).stations | ForEach-Object { $_.id })
  if (($uiIds -join ',') -ne $sid) { Write-Host "  kaynaktaki arayuz: $($uiIds -join ', ') (yanlis) -> paket\$low ile degistirilecek" -ForegroundColor Yellow }
  else { Write-Host "  kaynaktaki arayuz: $sid -> paket\$low ile tazelenecek" }
} else { Write-Host "  kaynakta arayuz yok -> paket\$low konacak" }

if ($hatalar.Count -and -not $Zorla) {
  Write-Host ''
  Write-Host "DURDU: $($hatalar.Count) sorun. Duzeltip tekrar calistirin (bilerek devam: -Zorla)." -ForegroundColor Red
  exit 1
}

# kopyala
$dst = Join-Path $Hedef $ist
if (Test-Path $dst) { throw "hedef zaten var: $dst (once silin ya da baska klasor verin)" }
New-Item -ItemType Directory -Force $Hedef | Out-Null
Write-Host ''
Write-Host "kopyalaniyor: $Kaynak -> $dst"
robocopy $Kaynak $dst /E /NFL /NDL /NJH /NJS /NP /XF 'console_backup_*.txt' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy hatasi ($LASTEXITCODE)" }
$dstUi = Join-Path $dst 'shared\twin'
if (Test-Path $dstUi) { Remove-Item -LiteralPath $dstUi -Recurse -Force }
robocopy $paket $dstUi /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy hatasi ($LASTEXITCODE)" }
$chk = Get-Content (Join-Path $dstUi 'stations.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "  arayuz: $(@($chk.stations | ForEach-Object { $_.id }) -join ', '), Niagara istasyonu: $($chk.niagara_station)"

$sur = Join-Path $Hedef 'surucu'
New-Item -ItemType Directory -Force $sur | Out-Null
Copy-Item (Join-Path $root 'paket\surucu\timescale-rt.jar'), (Join-Path $root 'paket\surucu\akyllyoy-codesign.pem') $sur -Force
Copy-Item $ayarPath $Hedef -Force
Write-Host "  surucu: $sur (timescale-rt.jar, akyllyoy-codesign.pem); ayar: $(Split-Path $ayarPath -Leaf)"
Write-Host ''
if ($hatalar.Count) { Write-Host "TAMAM (-Zorla, $($hatalar.Count) sorunla): $dst" -ForegroundColor Yellow } else { Write-Host "TAMAM: $dst" -ForegroundColor Green }
Write-Host "Hedef PC: TASIMA.md (Station Copier ile platforma kopyala, baslat; sonra make kur AYAR=ayarlar/$(Split-Path $ayarPath -Leaf))"
