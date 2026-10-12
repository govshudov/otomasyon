# Workbench'in istasyon klasorunde bir istasyonu yeni adla kopyalar (ayni PC'de deneme istasyonu icin):
# portlar degistirilir, Twin klasoru cikarilir (kurulum betigi istasyonun kendi Twin'ini kurar).
# Kaynak istasyona dokunulmaz. Sonra: Workbench -> Platform -> Station Copier ile platforma kopyala, baslat.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\istasyon-kopyala.ps1 -Kaynak MAGTYMGULY -Hedef YASYLDEPE `
#       -Http 8081 -Https 8444 -Fox 1912 -Foxs 4912
#
# History verisi istasyon klasorunde tutulmaz (Niagara'nin kendi alaninda); kopya bos gecmisle baslar.
# (Dosya bilerek ASCII.)
param(
  [Parameter(Mandatory = $true)][string]$Kaynak,
  [Parameter(Mandatory = $true)][string]$Hedef,
  [Parameter(Mandatory = $true)][int]$Http,
  [Parameter(Mandatory = $true)][int]$Https,
  [Parameter(Mandatory = $true)][int]$Fox,
  [Parameter(Mandatory = $true)][int]$Foxs,
  [string]$Klasor = (Join-Path $env:USERPROFILE 'Niagara4.15\TridiumEMEA\stations'),
  [switch]$TwinBirak
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $Klasor $Kaynak; $dst = Join-Path $Klasor $Hedef
if (-not (Test-Path (Join-Path $src 'config.bog'))) { throw "kaynak istasyon yok: $src" }
if (Test-Path $dst) { throw "hedef zaten var: $dst (once silin ya da baska ad verin)" }
if ($Hedef -notmatch '^[A-Za-z][A-Za-z0-9_]*$') { throw "istasyon adi harfle baslamali; yalniz harf, rakam, _ : $Hedef" }

Write-Host "kopyalaniyor: $src -> $dst"
robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /XF 'console_backup_*.txt' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy hatasi ($LASTEXITCODE)" }

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$bog = Join-Path $dst 'config.bog'
$z = [IO.Compression.ZipFile]::OpenRead($bog)
$entry = $z.Entries[0].FullName
$r = New-Object IO.StreamReader($z.Entries[0].Open(), [Text.Encoding]::UTF8)
$xmlText = $r.ReadToEnd(); $r.Close(); $z.Dispose()
$d = New-Object Xml.XmlDocument; $d.PreserveWhitespace = $true; $d.LoadXml($xmlText)
$stn = $d.DocumentElement.SelectSingleNode('p')

$sn = $stn.SelectSingleNode("p[@n='stationName']")
if ($sn) { Write-Host "  stationName: $($sn.GetAttribute('v')) -> $Hedef"; $sn.SetAttribute('v', $Hedef) }

$svc = $stn.SelectSingleNode("p[@n='Services']")
$ports = [ordered]@{ 'WebService/httpPort' = $Http; 'WebService/httpsPort' = $Https; 'FoxService/foxPort' = $Fox; 'FoxService/foxsPort' = $Foxs }
foreach ($k in $ports.Keys) {
  $s, $p = $k -split '/'
  $node = $svc.SelectSingleNode("p[@n='$s']/p[@n='$p']")
  if (-not $node) { throw "$k bulunamadi" }
  $ps = $node.SelectSingleNode("p[@n='publicServerPort']")
  if (-not $ps) { $ps = $d.CreateElement('p'); $ps.SetAttribute('n', 'publicServerPort'); [void]$node.AppendChild($ps) }
  Write-Host "  ${k}: $($ps.GetAttribute('v')) -> $($ports[$k])"
  $ps.SetAttribute('v', [string]$ports[$k])
}

if (-not $TwinBirak) {
  $tw = $stn.SelectSingleNode("p[@n='Twin']")
  if ($tw) { [void]$stn.RemoveChild($tw); Write-Host '  Twin klasoru cikarildi (kurulum betigi istasyonun kendi Twin''ini kurar)' }
}

$ms = New-Object IO.MemoryStream
$ws = New-Object Xml.XmlWriterSettings; $ws.Encoding = New-Object Text.UTF8Encoding($false)
$w = [Xml.XmlWriter]::Create($ms, $ws); $d.Save($w); $w.Close()
Remove-Item $bog
$zw = [IO.Compression.ZipFile]::Open($bog, 'Create')
$e = $zw.CreateEntry($entry, [IO.Compression.CompressionLevel]::Optimal)
$es = $e.Open(); $bytes = $ms.ToArray(); $es.Write($bytes, 0, $bytes.Length); $es.Close(); $zw.Dispose()
Write-Host "TAMAM: $dst"
Write-Host "Sonra: Workbench -> Platform -> Station Copier -> $Hedef'i platforma kopyala, baslat (Auto-Start)."
