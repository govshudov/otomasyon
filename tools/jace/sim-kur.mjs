// TwinSim simülasyon programını istasyona kurar (ya da kaldırır).
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/jace/sim/build.mjs          # önce derle (TwinSim.program.json)
//   node tools/jace/sim-kur.mjs            # kur: /Twin/TwinSim (varsa yenilenir), istasyon kaydedilir
//   node tools/jace/sim-kur.mjs --kaldir   # kaldır: noktalar kendi fallback değerine döner
//
// Program istasyonla birlikte çalışır (her saniye). Workbench'te /Twin/TwinSim:
//   etkin       aç/kapa (kapatınca noktalar eski değerine döner)
//   hizCarpani  1 = gerçek zaman (10 = 10 kat hızlı)
//   arizaNasos  1..6 → arizaTuru: sargy | podsipnik | tok | trip   (0 = arıza yok)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REMOVE = process.argv.includes('--kaldir')
const P = REMOVE ? null : JSON.parse(fs.readFileSync(path.join(HERE, 'sim', 'TwinSim.program.json'), 'utf8'))

const p = await bajaPage()
const log = (...a) => console.log(...a)
log('istasyon:', H)

const r = await p.eval(`(async () => {
  const baja = window.__baja
  const P = ${JSON.stringify(P)}
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
  const ps = await baja.Ord.make('station:|slot:/Twin/PS$2d01').get().then(() => true, () => false)
  if (!ps) return ['DUR: Config → Twin → PS-01 yok, hiçbir şey yazılmadı']
  await baja.importTypes({ typeSpecs: ['program:Program', 'program:ProgramCode', 'baja:Blob'] })
  const tw = await baja.Ord.make('station:|slot:/Twin').get(); await tw.loadSlots()
  const out = []
  if (tw.has('TwinSim')) { await tw.remove('TwinSim'); out.push('eski TwinSim kaldırıldı (noktaların in16 girişi boşaltıldı)') }
  if (!P) return out
  const prog = baja.$('program:Program')
  for (const q of P.props) {
    const v = q.type === 'baja:Double' ? baja.Double.make(q.value) : q.type === 'baja:Integer' ? baja.Integer.make(q.value) : q.value
    prog.add({ slot: q.name, value: v })
  }
  const c = baja.$('program:ProgramCode')
  c.set({ slot: 'className', value: P.className })
  c.set({ slot: 'classFile', value: baja.$('baja:Blob').decodeFromString(P.classFile) })
  c.set({ slot: 'dependencies', value: P.dependencies })
  c.set({ slot: 'userDefinedImports', value: P.userDefinedImports })
  c.set({ slot: 'source', value: P.source })
  c.set({ slot: 'checksum', value: baja.Integer.make(P.checksum) })
  prog.set({ slot: 'code', value: c })
  await tw.add({ slot: 'TwinSim', value: prog })
  out.push('TwinSim eklendi (' + P.className + ')')
  // ilk adımları bekle ve oku
  await sleep(6000)
  const sim = await baja.Ord.make('station:|slot:/Twin/TwinSim').get({ subscriber: new baja.Subscriber() })
  out.push('durum: ' + sim.get('durum'))
  const val = async (o) => { try { const x = await baja.Ord.make('station:|slot:/Twin/PS$2d01/' + o).get(); return String(x.get('out')) } catch (e) { return '?' } }
  out.push('heartbeat: ' + await val('heartbeat'))
  out.push('PMP-01 current_a: ' + await val('PMP$2d01/current_a') + ' · run_inv: ' + await val('PMP$2d01/run_inv'))
  out.push('BASIN-01 level_m: ' + await val('BASIN$2d01/level_m') + ' · HDR-01 flow: ' + await val('HDR$2d01/flow_m3h'))
  const fault = sim.get('code').get('faultCause')
  if (fault) out.push('PROGRAM HATASI: ' + fault)
  return out
})()`)
for (const l of r) log(' ', l)
if (!r[0]?.startsWith('DUR')) log(await p.eval(`(async () => { const st = await window.__baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); return 'istasyon kaydedildi' })()`))
await p.close()
process.exit(r[0]?.startsWith('DUR') ? 2 : 0)
