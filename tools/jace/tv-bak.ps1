# Nasos popup kontrolu (tools\jace\tv-bak.mjs): SALT OKUR, istasyonda hicbir sey degistirmez.
#   powershell -ExecutionPolicy Bypass -File tools\jace\tv-bak.ps1
# Sifre sorulur, hicbir dosyaya yazilmaz. (Dosya bilerek ASCII.)
param([string]$Url = 'https://127.0.0.1', [string]$User = 'admin')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$node = (Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) { $node = (Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Recurse -Filter node.exe -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $node) { throw 'node bulunamadi' }
$env:JACE_URL = $Url.TrimEnd('/'); $env:JU = $User
$sec = Read-Host "Niagara sifresi ($User)" -AsSecureString
$env:JP = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
function Test-Cdp { try { Invoke-WebRequest http://127.0.0.1:9333/json/version -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Cdp)) {
  Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @(
    '--headless=new', '--remote-debugging-port=9333', "--user-data-dir=$env:TEMP\twin-chrome",
    '--window-size=1600,900', '--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--proxy-server=direct://', '--proxy-bypass-list=*', 'about:blank') | Out-Null
  for ($i = 0; $i -lt 30 -and -not (Test-Cdp); $i++) { Start-Sleep -Milliseconds 500 }
}
try { & $node tools\jace\tv-bak.mjs }
finally {
  $env:JP = $null
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'twin-chrome' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
