// TsOkuma okuma servisini istasyona kurar (ya da kaldırır): /TsOkuma (Program).
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/jace/okuma/build.mjs          # önce derle (TsOkuma.program.json)
//   node tools/jace/okuma-kur.mjs            # kur (varsa yenilenir) + deneme sorgusu, istasyon kaydedilir
//   node tools/jace/okuma-kur.mjs --kaldir
//
// Arayüz "sorgu" eylemini çağırır (bkz. TsOkuma.body.java). Veritabanı ayarı TimescaleDevice'tan okunur.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REMOVE = process.argv.includes('--kaldir')
const P = REMOVE ? null : JSON.parse(fs.readFileSync(path.join(HERE, 'okuma', 'TsOkuma.program.json'), 'utf8'))

// Varsayılan adres JACE olduğu için adres açıkça verilmeden kurulmaz (yerel istasyon: https://127.0.0.1)
if (!process.env.JACE_URL) { console.error('DUR: $env:JACE_URL verilmedi (yerel istasyon için "https://127.0.0.1")'); process.exit(2) }
const p = await bajaPage()
console.log('istasyon:', H)
const r = await p.eval(`(async () => {
  const baja = window.__baja, P = ${JSON.stringify(P)}, out = []
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
  await baja.importTypes({ typeSpecs: ['program:Program', 'program:ProgramCode', 'program:ProgramAction', 'baja:Blob', 'baja:TypeSpec'] })
  const root = await baja.Ord.make('station:|slot:/').get(); await root.loadSlots()
  if (root.has('TsOkuma')) { await root.remove('TsOkuma'); out.push('eski TsOkuma kaldırıldı') }
  if (!P) return out
  const prog = baja.$('program:Program')
  for (const q of P.props) prog.add({ slot: q.name, value: q.value })
  for (const a of P.actions) {
    const act = baja.$('program:ProgramAction')
    act.set({ slot: 'parameterTypeSpec', value: baja.$('baja:TypeSpec').decodeFromString(a.param) })
    act.set({ slot: 'returnTypeSpec', value: baja.$('baja:TypeSpec').decodeFromString(a.ret) })
    prog.add({ slot: a.name, value: act })
  }
  const c = baja.$('program:ProgramCode')
  c.set({ slot: 'className', value: P.className })
  c.set({ slot: 'classFile', value: baja.$('baja:Blob').decodeFromString(P.classFile) })
  c.set({ slot: 'dependencies', value: P.dependencies })
  c.set({ slot: 'userDefinedImports', value: P.userDefinedImports })
  c.set({ slot: 'source', value: P.source })
  c.set({ slot: 'checksum', value: baja.Integer.make(P.checksum) })
  prog.set({ slot: 'code', value: c })
  await root.add({ slot: 'TsOkuma', value: prog })
  out.push('TsOkuma eklendi (' + P.className + ')')
  await sleep(3000)
  const t = await baja.Ord.make('station:|slot:/TsOkuma').get({ subscriber: new baja.Subscriber() })
  const fault = t.get('code').get('faultCause')
  if (fault) out.push('PROGRAM HATASI: ' + fault)
  out.push('durum: ' + t.get('durum'))
  out.push('info: ' + String(await t.invoke({ slot: 'sorgu', value: 'op=info' })))
  // deneme: nokta listesi + son 1 saat
  const t0 = Date.now()
  const pts = String(await t.invoke({ slot: 'sorgu', value: 'op=points' }))
  out.push('points (' + (Date.now() - t0) + ' ms): ' + pts.slice(0, 300))
  const now = Date.now(), t1 = Date.now()
  const h = String(await t.invoke({ slot: 'sorgu', value: 'op=hist&names=TWIN_PMP03_current_a,TWIN_PMP03_run_inv&from=' + (now - 3600e3) + '&to=' + now + '&n=12' }))
  out.push('hist 1 saat (' + (Date.now() - t1) + ' ms): ' + h.slice(0, 600))
  const t2 = Date.now()
  const y = String(await t.invoke({ slot: 'sorgu', value: 'op=hist&names=TWIN_PMP03_current_a&from=' + (now - 365 * 86400e3) + '&to=' + now + '&n=12' }))
  out.push('hist 1 yıl (' + (Date.now() - t2) + ' ms): ' + y.slice(0, 400))
  return out
})()`)
for (const l of r) console.log(' ', l)
if (!REMOVE) console.log(await p.eval(`(async () => { const st = await window.__baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); return 'istasyon kaydedildi' })()`))
await p.close()
process.exit(0)
