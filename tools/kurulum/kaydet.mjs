// Çalışan istasyonu kaydeder (Workbench'teki "Save Station" ile aynı): config.bog diske yazılır.
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/kurulum/kaydet.mjs
import { bajaPage } from '../jace/baja-page.mjs'
import { H } from '../jace/auth.mjs'

if (!process.env.JACE_URL) { console.error('DUR: $env:JACE_URL verilmedi'); process.exit(2) }
const p = await bajaPage()
const name = await p.eval(`(async () => {
  const st = await window.__baja.Ord.make('station:|slot:/').get()
  await st.invoke({ slot: 'save' })
  return String(st.get('stationName'))
})()`)
console.log(`  istasyon kaydedildi: ${name} (${H})`)
await p.close()
process.exit(0)
