// /Twin/PS-01 noktalarına history uzantısı ekler (TimescaleHistoryExport bunları veritabanına aktarır).
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/jace/twin-history.mjs [--station stations/ps-01.json] [--plan]
//
// Ad standardı (her istasyonda aynı; istasyon adı veritabanında ayrı sütunda):
//   TWIN_<EKIPMAN>_<SİNYAL>    örn. TWIN_PMP03_current_a, TWIN_PMP03_t1, TWIN_HDR01_flow_m3h, TWIN_LT02_level_m
// Sayısal noktalar: NumericIntervalHistoryExt, 1 dakika. Bool (run_inv/run_pano): BooleanCovHistoryExt.
// Kapasite 14 400 kayıt (1 dakikada ~10 gün): veritabanına bağlantı koparsa veri istasyonda bekler.
// Uzantısı olan noktaya dokunulmaz. Nokta yoksa atlanır (önce deploy.mjs noktaları ekler).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const STATION = JSON.parse(fs.readFileSync(path.resolve(ROOT, arg('--station', 'stations/ps-01.json')), 'utf8'))
const TYPES = JSON.parse(fs.readFileSync(path.join(ROOT, 'common/equipment_types.json'), 'utf8')).types
const INTERVAL_MS = 60_000
const CAPACITY = 14_400

// Arayüzün kullandığı sinyaller (deploy.mjs ile aynı küme)
const USED = { pump_hsc: null, header: ['flow_m3h', 'total_m3', 'press_bar'], basin: ['level_m'], level_sensor: null }
const SPEC = []
for (const e of STATION.equipment) {
  if (!(e.type in USED)) continue
  for (const [key, sd] of Object.entries(TYPES[e.type].signals)) {
    if (USED[e.type] && !USED[e.type].includes(key)) continue
    const sig = key.split('.').pop()
    SPEC.push({ path: [e.id, ...key.split('.')], name: `TWIN_${e.id.replace(/-/g, '')}_${sig}`, bool: sd.type === 'bool' })
  }
}
const names = new Set(SPEC.map((s) => s.name))
if (names.size !== SPEC.length) throw new Error('history adları çakışıyor')

if (process.argv.includes('--plan')) {
  for (const s of SPEC) console.log(`  /Twin/${STATION.station_id}/${s.path.join('/')}  →  ${s.name}  (${s.bool ? 'BooleanCov' : 'NumericInterval 1 dk'})`)
  console.log(`${SPEC.length} nokta`)
  process.exit(0)
}

const p = await bajaPage()
console.log('istasyon:', H)
const out = await p.eval(`(async () => {
  const baja = window.__baja, out = [], spec = ${JSON.stringify(SPEC)}
  await baja.importTypes({ typeSpecs: ['history:NumericIntervalHistoryExt', 'history:BooleanCovHistoryExt', 'history:Capacity', 'baja:Format'] })
  const esc = (s) => baja.SlotPath.escape(s)
  const base = 'station:|slot:/Twin/' + esc(${JSON.stringify(STATION.station_id)}) + '/'
  let added = 0, had = 0, missing = 0
  for (const s of spec) {
    let pt
    try { pt = await baja.Ord.make(base + s.path.map(esc).join('/')).get(); await pt.loadSlots() } catch (e) { missing++; out.push('YOK: ' + s.path.join('/')); continue }
    let exists = false
    pt.getSlots().properties().each((sl) => { const v = pt.get(sl); const t = v && v.getType && v.getType(); if (t && t.isComponent() && t.is('history:HistoryExt')) exists = true })
    if (exists) { had++; continue }
    const ext = baja.$(s.bool ? 'history:BooleanCovHistoryExt' : 'history:NumericIntervalHistoryExt')
    const fmt = baja.$('baja:Format').decodeFromString(s.name)
    ext.set({ slot: 'historyName', value: fmt })
    if (!s.bool) ext.set({ slot: 'interval', value: baja.RelTime.make(${INTERVAL_MS}) })
    ext.get('historyConfig').set({ slot: 'capacity', value: baja.$('history:Capacity').decodeFromString('1:${CAPACITY}') })
    ext.set({ slot: 'enabled', value: true })
    await pt.add({ slot: s.bool ? 'historyBool' : 'historyNum', value: ext })
    added++
  }
  out.unshift(added + ' eklendi, ' + had + ' zaten vardı, ' + missing + ' nokta bulunamadı')
  if (added) { const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); out.push('istasyon kaydedildi') }
  // doğrulama: bir örnek
  const ex = spec.find((s) => !s.bool)
  if (ex) {
    const pt = await baja.Ord.make(base + ex.path.map(esc).join('/')).get(); await pt.loadSlots()
    pt.getSlots().properties().each((sl) => { const v = pt.get(sl); const t = v && v.getType && v.getType(); if (t && t.isComponent() && t.is('history:HistoryExt')) out.push('örnek: ' + ex.name + ' → ' + v.get('historyConfig') + ' · ad=' + v.get('historyName')) })
  }
  return out
})()`)
for (const l of out) console.log(' ', l)
await p.close()
process.exit(0)
