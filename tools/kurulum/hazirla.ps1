# Hazirlik PC'si islemleri (Blender / Python / web derlemesi olan PC). make hedefleri bunu cagirir.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\hazirla.ps1 -Ayar ayarlar\1-may.json -Hedef istasyon [-Yeniden]
#   -Hedef istasyon   ayar -> stations\<id>.json (varsa yalniz denetler; -Yeniden: ekipmani yeniden uret;
#                     -Geometri: geometriyi de sablondan al - bina, toprak, debimetre kuyusu)
#   -Hedef model      stations\<id>.json -> 3D model (Blender): build\<id>*.glb, web\public\models\<id>*
#   -Hedef paket      arayuz + model + sozluk -> paket\<id>\ (istasyon PC'sine giden hazir paket)
#   -Hedef surucu     timescale-rt.jar derlemesi (driver\timescale\build.mjs)
#   -Hedef imzala     jar imzasi (p12 sifresini jarsigner sorar) -> paket\surucu\timescale-rt.jar
# (Dosya bilerek ASCII.)
param([string]$Ayar, [Parameter(Mandatory = $true)][string]$Hedef, [switch]$Yeniden, [switch]$Geometri)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

function Find-Tool([string]$name, [string]$filter, [int]$depth = 4) {
  # WindowsApps\python.exe: Python kurulu degilken Store'a yonlendiren sahte program, atlanir
  $c = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' } | Select-Object -First 1
  if ($c) { return $c.Source }
  $f = Get-ChildItem (Join-Path $env:USERPROFILE 'tools') -Recurse -Filter $filter -Depth $depth -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}
$node = Find-Tool 'node' 'node.exe' 1
if ($Ayar) {
  $a = Get-Content (Resolve-Path $Ayar) -Raw -Encoding UTF8 | ConvertFrom-Json
  $sid = $a.id; $low = $sid.ToLower()
}
function Need-Ayar { if (-not $Ayar) { throw "AYAR verilmeli (ornek: make $Hedef AYAR=ayarlar/1-may.json)" } }

switch ($Hedef) {
  'istasyon' {
    Need-Ayar
    # Python: PATH'te yoksa tasinabilir Blender'in Python'u
    $py = Find-Tool 'python' 'python.exe' 5
    if (-not $py) { throw 'Python bulunamadi (PATH ya da C:\Users\<ad>\tools\blender-*\...\python\bin\python.exe)' }
    $args2 = @('tools\make_station.py', '--ayar', (Resolve-Path $Ayar).Path)
    if ($Yeniden) { $args2 += '--yeniden' }
    if ($Geometri) { $args2 += '--geometri' }
    & $py @args2
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }
  'model' {
    Need-Ayar
    $st = "stations\$low.json"
    if (-not (Test-Path $st)) { throw "$st yok: once make istasyon AYAR=$Ayar" }
    $blender = Find-Tool 'blender' 'blender.exe' 2
    if (-not $blender) { throw 'Blender bulunamadi (PATH ya da C:\Users\<ad>\tools\blender-*\blender.exe)' }
    New-Item -ItemType Directory -Force build | Out-Null
    & $blender --background --python tools\genmodel\generate.py -- --config $st --out "build\$low.glb" --twin-map "build\$low-twin-map.json" --plain-out "build\$low-plain.glb" --preview "build\$low.png"
    if ($LASTEXITCODE) { throw 'model uretilemedi' }
    Copy-Item "build\$low.glb" "web\public\models\$low.glb" -Force
    Copy-Item "build\$low-twin-map.json" "web\public\models\$low-twin-map.json" -Force
    Write-Host "model: build\$low-plain.glb (istasyon), web\public\models\$low.glb, onizleme build\$low.png"
  }
  'paket' {
    Need-Ayar
    if (-not $node) { throw 'node bulunamadi' }
    if (-not $a.niagara.istasyon) { throw "$Ayar icinde niagara.istasyon yok (paket hangi Niagara istasyonuna ait?)" }
    if (-not (Test-Path "build\$low-plain.glb")) { throw "build\$low-plain.glb yok: once make model AYAR=$Ayar" }
    if (-not (Test-Path 'web\node_modules\vite')) { throw 'web\node_modules yok: web klasorunde npm ci (internet gerekir)' }
    Push-Location web
    try {
      & $node node_modules\vite\bin\vite.js build; if ($LASTEXITCODE) { throw 'web derlemesi basarisiz' }
      & $node scripts\niagara-pack.mjs --stations $sid --niagara $a.niagara.istasyon --out "..\paket\$low"; if ($LASTEXITCODE) { throw 'paket uretilemedi' }
    } finally { Pop-Location }
    Write-Host "paket: paket\$low  (istasyon PC'sine bu klasor gider; git ile ya da kopyalayarak)"
  }
  'surucu' {
    if (-not $node) { throw 'node bulunamadi' }
    & $node driver\timescale\build.mjs; if ($LASTEXITCODE) { throw 'surucu derlenemedi' }
  }
  'imzala' {
    & powershell -NoProfile -ExecutionPolicy Bypass -File driver\timescale\imzala.ps1
    if ($LASTEXITCODE) { throw 'imzalama basarisiz' }
    New-Item -ItemType Directory -Force paket\surucu | Out-Null
    Copy-Item driver\timescale\build\imzali\timescale-rt.jar paket\surucu\timescale-rt.jar -Force
    Write-Host 'paket\surucu\timescale-rt.jar guncellendi (commit edin; istasyonlara bu jar gider)'
  }
  default { throw "bilinmeyen hedef: $Hedef (istasyon | model | paket | surucu | imzala)" }
}
