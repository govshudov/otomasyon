// JACE paketi: web/dist → web/dist-niagara
//
//   node scripts/niagara-pack.mjs [--stations PS-01,PS-02]
//
// Derlenmiş arayüzün yanına JACE'te API olmadığı için gereken iki şeyi koyar:
//   stations.json            istasyon listesi (göreli model yolları, niagara_root)
//   sozluk.json              nokta adları sözlüğü (common/sozluk.json)
//   models/<id>-station.json istasyon konfigürasyonu (2D şemada pompa → kolektör)
// Çıkan klasör istasyonun dosya alanına (file:^twin) olduğu gibi kopyalanır.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WEB, '..')
const DIST = path.join(WEB, 'dist')
const OUT = path.join(WEB, 'dist-niagara')

const arg = process.argv.indexOf('--stations')
const only = arg > 0 ? process.argv[arg + 1].split(',').map((s) => s.trim().toUpperCase()) : null

if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('önce: npm run build')
fs.rmSync(OUT, { recursive: true, force: true })
fs.cpSync(DIST, OUT, { recursive: true })

const stations = fs.readdirSync(path.join(ROOT, 'stations'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'stations', f), 'utf8')))
  .filter((s) => !only || only.includes(s.station_id))
  .sort((a, b) => a.station_id.localeCompare(b.station_id))

const keep = new Set()
const list = stations.map((s) => {
  const id = s.station_id.toLowerCase()
  fs.writeFileSync(path.join(OUT, 'models', `${id}-station.json`), JSON.stringify(s, null, 2) + '\n')
  keep.add(`${id}.glb`); keep.add(`${id}-twin-map.json`); keep.add(`${id}-station.json`)
  const count = (t) => s.equipment.filter((e) => e.type === t).length
  return {
    id: s.station_id, name: s.name, description: s.description ?? '',
    pumps: count('pump_hsc'), headers: count('header'), cells: s.geometry.cells.count,
    equipment: s.equipment.length,
    model: `models/${id}.glb`, twin_map: `models/${id}-twin-map.json`, config: `models/${id}-station.json`,
    source_alive: false, alarms: 0,
  }
})
// Pakette yalnız seçilen istasyonların modelleri kalsın (JACE'in diski dar)
for (const f of fs.readdirSync(path.join(OUT, 'models'))) if (!keep.has(f)) fs.rmSync(path.join(OUT, 'models', f))

// JACE'in CSP'si blob: Web Worker'ı yasaklıyor; Draco çözücüsü onsuz çalışmıyor.
// Üreticinin --plain-out ile yazdığı sıkıştırmasız model varsa o kullanılır.
// Dosyalar JACE'e istasyon üzerinden yazılıyor ve ~1 MB üstü tek yazma
// isteği takılıyor (1,8 MB'lık model yazılırken kurulum dondu). Model bu
// yüzden 512 KB'lık parçalara bölünür; arayüz parçaları uç uca ekler.
const PART = 512 * 1024
let plain = 0
for (const [i, s] of stations.entries()) {
  const id = s.station_id.toLowerCase()
  const src = path.join(ROOT, 'build', `${id}-plain.glb`)
  if (!fs.existsSync(src)) {
    console.warn(`UYARI: build/${id}-plain.glb yok — Draco'lu model JACE'te YÜKLENMEZ (generate.py --plain-out)`)
    continue
  }
  plain++
  fs.rmSync(path.join(OUT, 'models', `${id}.glb`), { force: true })
  const buf = fs.readFileSync(src)
  const parts = []
  for (let off = 0, k = 0; off < buf.length; off += PART, k++) {
    const name = `models/${id}.part${k}.bin`
    fs.writeFileSync(path.join(OUT, name), buf.subarray(off, off + PART))
    parts.push(name)
  }
  list[i].model_parts = parts
}
if (plain === stations.length) fs.rmSync(path.join(OUT, 'draco'), { recursive: true, force: true })

// Nokta adları sözlüğü: arayüz çalışırken okur (değişince yalnız bu dosya yeniden yüklenir)
fs.copyFileSync(path.join(ROOT, 'common', 'sozluk.json'), path.join(OUT, 'sozluk.json'))

fs.writeFileSync(path.join(OUT, 'stations.json'), JSON.stringify({
  stations: list, default: list[0]?.id, niagara_root: 'slot:/Twin',
}, null, 2) + '\n')

let n = 0, bytes = 0
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else { n++; bytes += st.size } } }
walk(OUT)
console.log(`dist-niagara: ${n} dosya, ${(bytes / 1024).toFixed(0)} KB — istasyonlar: ${list.map((s) => s.id).join(', ')}`)
