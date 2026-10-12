// Çalışan istasyonun web ve Fox portlarını değiştirir (WebService / FoxService) ve istasyonu kaydeder.
// Yeni portlar istasyon YENİDEN BAŞLAYINCA geçerli olur (Application Director → Restart).
//
//   $env:JACE_URL = "https://127.0.0.1:8444"   # istasyonun ŞU ANKİ adresi
//   $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/kurulum/port-ayarla.mjs [--http 80] [--https 443] [--fox 1911] [--foxs 4911]
//
// Varsayılanlar Niagara'nın standart portları; her istasyon kendi PC'sinde çalışacağı için bunlar kullanılır.
import { bajaPage } from '../jace/baja-page.mjs'
import { H } from '../jace/auth.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d }
const P = { http: arg('--http', 80), https: arg('--https', 443), fox: arg('--fox', 1911), foxs: arg('--foxs', 4911) }
if (!process.env.JACE_URL) { console.error('DUR: $env:JACE_URL verilmedi (istasyonun şu anki adresi, ör. https://127.0.0.1:8444)'); process.exit(2) }

const p = await bajaPage()
console.log('istasyon:', H)
const out = await p.eval(`(async () => {
  const baja = window.__baja, P = ${JSON.stringify(P)}, out = []
  const set = async (svc, slot, v) => {
    const c = await baja.Ord.make('station:|slot:/Services/' + svc).get({ subscriber: new baja.Subscriber() })
    const sp = c.get(slot)
    const old = sp.get('publicServerPort')
    await sp.set({ slot: 'publicServerPort', value: baja.Integer.make(v) })
    out.push(svc + '.' + slot + ': ' + old + ' -> ' + v)
  }
  await set('WebService', 'httpPort', P.http)
  await set('WebService', 'httpsPort', P.https)
  await set('FoxService', 'foxPort', P.fox)
  await set('FoxService', 'foxsPort', P.foxs)
  const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' })
  out.push('istasyon kaydedildi — yeni portlar istasyon yeniden başlayınca geçerli')
  return out
})()`)
for (const l of out) console.log(' ', l)
await p.close()
process.exit(0)
