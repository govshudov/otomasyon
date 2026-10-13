# Calisan istasyonun klasorunu Workbench'in yerel istasyon klasorune birebir kopyalar.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\yerel-kopya.ps1 -Istasyon YASYLDEPE
#   (YONETICI PowerShell; make kur'un 11. adimi da bunu cagirir)
#
# Neden: istasyon C:\ProgramData\Niagara4.x\<marka>\stations\<ad> klasorunden calisir; Save Station ve
# make kur oraya yazar. Workbench'in yerel klasoru (%USERPROFILE%\Niagara4.x\<marka>\stations\<ad>)
# kendiliginden guncellenmez. Bu klasor baska PC'ye kopyalanirsa eski hali gider (12 Ekim: baska
# istasyonun nasoslari). ProgramData klasorunu Windows yalniz yoneticiye acar (robocopy /B).
#
# Once istasyonu kaydedin (Workbench -> Save Station; make kur kendisi kaydeder). Eski yerel kopya
# silinmez: <marka>\stations_yedek\<ad>_<tarih> klasorune tasinir. (Dosya bilerek ASCII.)
param(
  [Parameter(Mandatory = $true)][string]$Istasyon,
  [string]$Klasor
)
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Yonetici PowerShell gerekli (calisan istasyonun klasorunu Windows yalniz yoneticiye acar). Ya da Workbench -> Platform -> Station Copier ile sagdan sola kopyalayin.' }

# yerel klasor: %USERPROFILE%\Niagara4.x\<marka>\stations (en yeni surum)
if (-not $Klasor) {
  $c = @(Get-ChildItem (Join-Path $env:USERPROFILE 'Niagara4.*\*\stations') -Directory -ErrorAction SilentlyContinue | Sort-Object FullName)
  if (-not $c) { throw "Workbench'in yerel istasyon klasoru bulunamadi ($env:USERPROFILE\Niagara4.x\<marka>\stations); -Klasor ile verin" }
  $Klasor = $c[-1].FullName
}
$Klasor = $Klasor.TrimEnd('\')
# calisan istasyon: ayni goreli yol ProgramData altinda (Niagara4.15\TridiumEMEA\stations)
$rel = $Klasor.Substring($env:USERPROFILE.TrimEnd('\').Length).TrimStart('\')
$src = Join-Path (Join-Path $env:ProgramData $rel) $Istasyon
$dst = Join-Path $Klasor $Istasyon
$base = Split-Path $Klasor -Parent
$tmp = Join-Path $base "stations_gecici\$Istasyon"
Write-Host "  calisan istasyon: $src"
Write-Host "  yerel kopya     : $dst"

if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
# /B: yedekleme yetkisiyle oku (ACL'ye takilmaz). Kilitli dosyada uzun beklemesin: /R:2 /W:2
$o = robocopy $src $tmp /E /B /R:2 /W:2 /NP /NFL /NDL /NJH /XF 'config_backup_*.bog' 'console_backup_*.txt'
$code = $LASTEXITCODE
if (-not (Test-Path (Join-Path $tmp 'config.bog'))) {
  $o | Select-Object -Last 12 | ForEach-Object { Write-Host "  $_" }
  throw "calisan istasyon okunamadi: $src (istasyon adi dogru mu? robocopy $code)"
}
if ($code -ge 8) {
  Write-Warning "bazi dosyalar kopyalanamadi (robocopy $code; calisan istasyonun kilitli dosyalari olabilir):"
  $o | Select-Object -Last 12 | ForEach-Object { Write-Host "  $_" }
}

# kopyadaki ad dogru mu
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead((Join-Path $tmp 'config.bog'))
try { $r = New-Object IO.StreamReader($z.Entries[0].Open(), [Text.Encoding]::UTF8); $x = $r.ReadToEnd(); $r.Close() } finally { $z.Dispose() }
$n = [regex]::Match($x, '<p n="stationName"[^>]*v="([^"]*)"').Groups[1].Value
if ($n -and $n -ne $Istasyon) { Write-Warning "config.bog'daki stationName '$n' (klasor adi '$Istasyon')" }
Write-Host "  config.bog son kayit: $((Get-Item (Join-Path $tmp 'config.bog')).LastWriteTime)"

if (Test-Path $dst) {
  $yedek = Join-Path $base ("stations_yedek\${Istasyon}_" + (Get-Date -Format 'yyyy-MM-dd_HHmm'))
  New-Item -ItemType Directory -Force (Split-Path $yedek -Parent) | Out-Null
  Move-Item -LiteralPath $dst $yedek
  Write-Host "  eski yerel kopya: $yedek"
}
Move-Item -LiteralPath $tmp $dst
Remove-Item -LiteralPath (Split-Path $tmp -Parent) -Force -ErrorAction SilentlyContinue
Write-Host "  TAMAM: yerel kopya calisan istasyonla ayni ($dst)" -ForegroundColor Green
