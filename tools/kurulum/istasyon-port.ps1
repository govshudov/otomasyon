# Workbench'in istasyon klasorundeki (CALISMAYAN) bir istasyonun web ve Fox portlarini degistirir.
# Calisan istasyon icin: port-ayarla.mjs. Sonra: Workbench -> Platform -> Station Copier ile platforma kopyala.
#
#   powershell -ExecutionPolicy Bypass -File tools\kurulum\istasyon-port.ps1 -Istasyon BIRINJI_MAY
#   (varsayilan portlar 80 / 443 / 1911 / 4911; -Http -Https -Fox -Foxs ile degistirilir)
# (Dosya bilerek ASCII.)
param(
  [Parameter(Mandatory = $true)][string]$Istasyon,
  [int]$Http = 80, [int]$Https = 443, [int]$Fox = 1911, [int]$Foxs = 4911,
  [string]$Klasor = (Join-Path $env:USERPROFILE 'Niagara4.15\TridiumEMEA\stations')
)
$ErrorActionPreference = 'Stop'
$bog = Join-Path (Join-Path $Klasor $Istasyon) 'config.bog'
if (-not (Test-Path $bog)) { throw "istasyon yok: $bog" }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
Copy-Item $bog "$bog.yedek" -Force

$z = [IO.Compression.ZipFile]::OpenRead($bog)
$entry = $z.Entries[0].FullName
$r = New-Object IO.StreamReader($z.Entries[0].Open(), [Text.Encoding]::UTF8)
$xmlText = $r.ReadToEnd(); $r.Close(); $z.Dispose()
$d = New-Object Xml.XmlDocument; $d.PreserveWhitespace = $true; $d.LoadXml($xmlText)
$svc = $d.DocumentElement.SelectSingleNode("p/p[@n='Services']")
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
$ms = New-Object IO.MemoryStream
$ws = New-Object Xml.XmlWriterSettings; $ws.Encoding = New-Object Text.UTF8Encoding($false)
$w = [Xml.XmlWriter]::Create($ms, $ws); $d.Save($w); $w.Close()
Remove-Item $bog
$zw = [IO.Compression.ZipFile]::Open($bog, 'Create')
$e = $zw.CreateEntry($entry, [IO.Compression.CompressionLevel]::Optimal)
$es = $e.Open(); $bytes = $ms.ToArray(); $es.Write($bytes, 0, $bytes.Length); $es.Close(); $zw.Dispose()
Remove-Item "$bog.yedek"
Write-Host "TAMAM: $bog"
