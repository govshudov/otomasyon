// TimescaleHistoryExport ayarları (saklama, sıkıştırma, okuma sınırı) + Apply Policies.
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/jace/ts-export-ayar.mjs [--yil 5] [--sikistir 7] [--tur 100000]
//
// tur (maxRecordsPerCycle) kuyruk kapasitesinin altında olmalı: sürücü "kaldığı yeri"
// veri yazılmadan ilerletiyor ve kuyruk dolunca eski kaydı atıyor (1.5/1.6).
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d }
const YIL = arg('--yil', 5), GUN = arg('--sikistir', 7), TUR = arg('--tur', 100000)

const p = await bajaPage()
console.log('istasyon:', H)
const out = await p.eval(`(async () => {
  const baja = window.__baja, out = []
  const ex = await baja.Ord.make('station:|slot:/Drivers/TimescaleNetwork/TimescaleDevice/TimescaleHistoryExport').get()
  const dev = await baja.Ord.make('station:|slot:/Drivers/TimescaleNetwork/TimescaleDevice').get()
  const q = dev.get('queueCapacity')
  if (${TUR} >= q) return ['DUR: tur sınırı (${TUR}) kuyruk kapasitesinden (' + q + ') küçük olmalı']
  await ex.set({ slot: 'maxRecordsPerCycle', value: baja.Integer.make(${TUR}) })
  await ex.set({ slot: 'retentionYears', value: baja.Integer.make(${YIL}) })
  await ex.set({ slot: 'compressAfterDays', value: baja.Integer.make(${GUN}) })
  await ex.invoke({ slot: 'applyPolicies' })
  await new Promise((ok) => setTimeout(ok, 8000))
  out.push('maxRecordsPerCycle=' + ex.get('maxRecordsPerCycle') + ' retentionYears=' + ex.get('retentionYears') + ' compressAfterDays=' + ex.get('compressAfterDays'))
  out.push('durum=' + ex.get('status') + ' hata="' + ex.get('lastError') + '"')
  const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); out.push('istasyon kaydedildi')
  return out
})()`)
for (const l of out) console.log(' ', l)
await p.close()
process.exit(0)
