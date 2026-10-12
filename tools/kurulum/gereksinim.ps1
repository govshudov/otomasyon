# Gereksinim denetimi: bu PC'de kurulum icin gerekenler var mi, hangi surum? Hicbir sey kurmaz/degistirmez.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\gereksinim.ps1 [-Rol istasyon|hazirlik]
#   (make gereksinim / make gereksinim ROL=hazirlik)
#
# istasyon : Niagara, PostgreSQL + TimescaleDB, Node, Chrome, timescale-rt modulu (istasyon PC'si)
# hazirlik : + Python, Blender, web\node_modules, Git (istasyon dosyasi / 3D model / paket ureten PC)
# Beklenen surumler KURULUM.md'de. (Dosya bilerek ASCII.)
param([ValidateSet('istasyon', 'hazirlik')][string]$Rol = 'istasyon')
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
$rows = New-Object System.Collections.ArrayList
function Row([string]$what, [string]$need, [string]$have, [bool]$ok, [string]$note = '') {
  [void]$rows.Add([pscustomobject]@{ Durum = $(if ($ok) { 'TAMAM' } else { 'EKSIK' }); Gereksinim = $what; Beklenen = $need; Bulunan = $have; Not = $note })
}
function Find-Tool([string]$name, [string]$filter, [int]$depth = 4) {
  $c = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' } | Select-Object -First 1
  if ($c) { return $c.Source }
  $f = Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Recurse -Filter $filter -Depth $depth -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}

# Niagara
# Kurulum klasoru: once calisan 'Niagara' servisinin (niagarad.exe) klasoru; servis yoksa <surucu>:\Niagara\Niagara-4*
# (kur-istasyon.ps1 ile ayni arama)
function Find-NiagaraHome {
  $svc = Get-CimInstance Win32_Service -Filter "Name='Niagara'" -ErrorAction SilentlyContinue
  if ($svc -and $svc.PathName -match '^"?(.+?)\\bin\\niagarad\.exe' -and (Test-Path $Matches[1])) { return Get-Item $Matches[1] }
  $roots = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { Join-Path $_.Name 'Niagara' } | Where-Object { Test-Path $_ })
  if (-not $roots) { return $null }
  return Get-ChildItem $roots -Directory -Filter 'Niagara-4*' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
}
$nh = Find-NiagaraHome
Row 'Niagara 4' '4.15.x (Niagara servisi ya da <surucu>:\Niagara\Niagara-4.*)' $(if ($nh) { $nh.FullName } else { 'yok' }) ([bool]$nh) 'lisansli kurulum; istasyon Workbench ile olusturulur'
if ($nh) {
  $jar = Join-Path $nh.FullName 'modules\timescale-rt.jar'
  $ver = 'yok'; $signed = $false
  if (Test-Path $jar) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($jar)
    try { $rd = New-Object IO.StreamReader($z.GetEntry('META-INF/module.xml').Open()); $x = $rd.ReadToEnd(); $rd.Close()
          $ver = [regex]::Match($x, 'vendorVersion="([^"]+)"').Groups[1].Value; $signed = [bool]$z.GetEntry('META-INF/AKYLLYOY.SF') } finally { $z.Dispose() }
  }
  $okJar = $ver -ne 'yok' -and [version]$ver -ge [version]'1.7.1.0' -and $signed
  Row 'timescale-rt modulu' '>= 1.7.1.0, imzali' "$ver, imzali=$signed" $okJar 'paket\surucu\timescale-rt.jar -> modules (KURULUM.md 2.3)'
}

# PostgreSQL + TimescaleDB
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
$pgv = if ($psql) { (& $psql.FullName --version) -replace '^psql \(PostgreSQL\) ', '' } else { 'yok' }
Row 'PostgreSQL' '18.x' $pgv ([bool]$psql) 'EDB Windows kurulumu'
$tsdll = if ($psql) { Get-ChildItem (Join-Path (Split-Path (Split-Path $psql.FullName)) 'lib') -Filter 'timescaledb-2*.dll' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1 } else { $null }
Row 'TimescaleDB eklentisi' '2.23.x (PostgreSQL 18 icin)' $(if ($tsdll) { $tsdll.BaseName -replace '^timescaledb-', '' } else { 'yok' }) ([bool]$tsdll) 'PostgreSQL lib klasorunde timescaledb-*.dll'
if ($psql) {
  $conf = Get-ChildItem 'C:\Program Files\PostgreSQL\*\data\postgresql.conf' -ErrorAction SilentlyContinue | Select-Object -Last 1
  $pre = if ($conf) { (Select-String -Path $conf.FullName -Pattern "^\s*shared_preload_libraries\s*=.*timescaledb" -ErrorAction SilentlyContinue) } else { $null }
  Row 'shared_preload_libraries' "'timescaledb'" $(if ($pre) { 'ayarli' } elseif ($conf) { 'ayarsiz' } else { 'postgresql.conf okunamadi' }) ([bool]$pre) 'TimescaleDB setup.exe ayarlar; elle: postgresql.conf + servis yeniden baslatma'
}

# Node
$node = Find-Tool 'node' 'node.exe' 1
$nv = if ($node) { & $node --version } else { 'yok' }
$nodeOk = $node -and ([int]($nv -replace '^v(\d+).*', '$1') -ge 22)
Row 'Node.js' '>= 22 (denenen 24.21.0)' $nv $nodeOk 'PATH ya da C:\Users\<ad>\tools\node-v*-win-x64'

# Chrome
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$cv = if (Test-Path $chrome) { (Get-Item $chrome).VersionInfo.ProductVersion } else { 'yok' }
Row 'Google Chrome' 'guncel' $cv (Test-Path $chrome) 'kurulum betikleri Niagara''ya bassiz Chrome ile baglanir'

# make
$make = Find-Tool 'make' 'make.exe' 3
Row 'GNU make' '4.x (istege bagli)' $(if ($make) { ((& $make --version) | Select-Object -First 1) } else { 'yok' }) ([bool]$make) 'yoksa KURULUM.md''deki dogrudan komutlar'

if ($Rol -eq 'hazirlik') {
  $py = Find-Tool 'python' 'python.exe' 5
  Row 'Python' '3.10+ (Blender''inki yeter)' $(if ($py) { & $py --version } else { 'yok' }) ([bool]$py) 'make istasyon'
  $bl = Find-Tool 'blender' 'blender.exe' 2
  Row 'Blender' '5.2.x' $(if ($bl) { Split-Path (Split-Path $bl -Parent) -Leaf } else { 'yok' }) ([bool]$bl) 'make model'
  Row 'web\node_modules' 'npm ci ile' $(if (Test-Path 'web\node_modules\vite') { 'var' } else { 'yok' }) (Test-Path 'web\node_modules\vite') 'make paket'
  $git = Find-Tool 'git' 'git.exe' 3
  if (-not $git -and (Test-Path 'C:\Program Files\Git\cmd\git.exe')) { $git = 'C:\Program Files\Git\cmd\git.exe' }
  Row 'Git' 'guncel' $(if ($git) { (& $git --version) } else { 'yok' }) ([bool]$git) 'repo ve degisiklikler'
}

$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
$miss = @($rows | Where-Object { $_.Durum -eq 'EKSIK' -and $_.Gereksinim -ne 'GNU make' }).Count
if ($miss) { Write-Host "$miss eksik var (KURULUM.md -> Gereksinimler)" -ForegroundColor Yellow; exit 1 } else { Write-Host 'Gereksinimler tamam' -ForegroundColor Green }
