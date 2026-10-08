# timescale-rt.jar imzalama (build.mjs'ten sonra). p12 sifresini jarsigner kendisi sorar:
# hicbir dosyaya ya da komut satirina yazilmaz.
#
#   powershell -ExecutionPolicy Bypass -File driver\timescale\imzala.ps1 [-P12 <yol>]
#
# Cikti: driver\timescale\build\imzali\timescale-rt.jar (imzali, dogrulanmis).
# Imza dosyalari META-INF/AKYLLYOY.SF/.RSA (-sigfile AKYLLYOY; onceki surumlerle ayni).
# (Dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i yanlis okur.)
param([string]$P12 = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'akyllyoy-codesign.p12'),
      [string]$Alias = 'akyllyoy-codesign')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$nh = Get-ChildItem 'C:\Niagara' -Directory -Filter 'Niagara-4*' | Sort-Object Name | Select-Object -Last 1
if (-not $nh) { throw 'Niagara kurulumu bulunamadi (C:\Niagara\Niagara-4.x)' }
$java = Join-Path $nh.FullName 'jre\bin\java.exe'
$tools = Join-Path $nh.FullName 'jre\lib\tools.jar'
$src = Join-Path $here 'build\timescale-rt.jar'
if (-not (Test-Path $src)) { throw "once derleyin: node driver\timescale\build.mjs ($src yok)" }
if (-not (Test-Path $P12)) { throw "p12 bulunamadi: $P12" }

$outDir = Join-Path $here 'build\imzali'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'timescale-rt.jar'
Copy-Item $src $out -Force

Write-Host "Imzalaniyor: $out"
Write-Host "p12: $P12 (sifreyi asagida jarsigner soracak)"
& $java -cp $tools sun.security.tools.jarsigner.Main -keystore $P12 -storetype PKCS12 `
  -sigfile AKYLLYOY -digestalg SHA-256 -sigalg SHA256withRSA $out $Alias
if ($LASTEXITCODE) { throw "imzalama basarisiz (cikis $LASTEXITCODE)" }

Write-Host ''
Write-Host 'Dogrulama:'
& $java -cp $tools sun.security.tools.jarsigner.Main -verify -verbose:summary -certs $out |
  Select-String -Pattern 'jar verified|CN=|SHA-256|unsigned|not signed' | Select-Object -First 6 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE) { throw 'dogrulama basarisiz' }

$sha = (Get-FileHash $out -Algorithm SHA256).Hash
Write-Host ''
Write-Host "TAMAM: $out"
Write-Host "  SHA256: $sha"
Write-Host '  Kurulum: istasyonu durdurun, Niagara-4.15.x\modules\timescale-rt.jar yedeklenip bununla degistirilir, istasyonu baslatin.'
