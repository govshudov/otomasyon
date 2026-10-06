# JACE kurulumu - tek komut (sifreyi sorar, Chrome'u gerekirse kendisi acar):
#
#   powershell -ExecutionPolicy Bypass -File C:\Users\DELL\Desktop\otomasyon\tools\jace\kur.ps1
#
# -Build : once web derlemesi + JACE paketi (web\dist-niagara) yeniden uretilir.
# -Url   : hedef istasyon (varsayilan JACE https://192.168.1.140). Bu PC'deki
#          yerel istasyon icin: -Url https://127.0.0.1
# -User  : istasyon kullanicisi (varsayilan admin)
# Yedek her calistirmada masaustunde yeni klasore alinir: twin_yedek_<tarih_saat>.
# (Dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i yanlis okur.)
param([switch]$Build, [string]$Url = 'https://192.168.1.140', [string]$User = 'admin')
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$env:JACE_URL = $Url.TrimEnd('/')
$env:JU = $User
Write-Host "Hedef istasyon: $env:JACE_URL  (kullanici: $env:JU)"

# Node PATH'te yoksa tasinabilir surum aranir (C:\Users\<ad>\tools\node-v*-win-x64)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name | Select-Object -Last 1
  if (-not $nodeDir) { throw 'node bulunamadi: PATH''e ekleyin ya da C:\Users\<ad>\tools altina kurun' }
  $env:Path = $nodeDir.FullName + ';' + $env:Path
  Write-Host "node: $($nodeDir.FullName)"
}

function Test-Cdp {
  try { Invoke-WebRequest http://127.0.0.1:9333/json/version -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

$chromeProc = $null
if (-not (Test-Cdp)) {
  Write-Host 'Bassiz Chrome baslatiliyor (port 9333)...'
  $chromeProc = Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -PassThru -ArgumentList @(
    '--headless=new', '--remote-debugging-port=9333', "--user-data-dir=$env:TEMP\twin-chrome",
    '--window-size=1600,900', '--ignore-certificate-errors', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--proxy-server=direct://', '--proxy-bypass-list=*', 'about:blank')
  for ($i = 0; $i -lt 30 -and -not (Test-Cdp); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Cdp)) { throw 'Chrome 9333 portunda acilmadi' }
}

# Her seferinde sorulur: pencerede kalmis eski/yanlis $env:JP girisi bozmasin
$sec = Read-Host "JACE sifresi ($env:JU)" -AsSecureString
$env:JP = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $env:JP) { throw 'sifre bos' }

try {
  if ($Build) {
    Push-Location web
    node node_modules\vite\bin\vite.js build
    if ($LASTEXITCODE) { throw 'web derlemesi basarisiz' }
    node scripts\niagara-pack.mjs --stations PS-01
    if ($LASTEXITCODE) { throw 'JACE paketi uretilemedi' }
    Pop-Location
  }
  $backup = Join-Path ([Environment]::GetFolderPath('Desktop')) ('twin_yedek_' + (Get-Date -Format 'yyyy-MM-dd_HHmm'))
  node tools\jace\deploy.mjs web\dist-niagara $backup
  if ($LASTEXITCODE) { throw "kurulum basarisiz (cikis kodu $LASTEXITCODE)" }
  Write-Host ''
  Write-Host "TAMAM. Sayfa: $env:JACE_URL/file/twin/index.html  (Ctrl+F5 ile yenileyin)"
} finally {
  $env:JP = $null    # sifre bu pencerede ortam degiskeninde kalmasin
  # Betigin actigi Chrome'u kapat: acik kalan bassiz Chrome (yazilimsal GPU)
  # bilgisayari yorup sayfalari dondurabiliyor.
  if ($chromeProc) {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.CommandLine -match 'twin-chrome' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
