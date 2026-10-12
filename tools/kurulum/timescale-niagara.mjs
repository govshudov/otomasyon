// İstasyonda TimescaleNetwork → TimescaleDevice → TimescaleHistoryExport (kurulum ve durum).
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/kurulum/timescale-niagara.mjs --ayar ayarlar/magtymguly.json --kur   (ya da --station <dosya>)
//   node tools/kurulum/timescale-niagara.mjs --station stations/ps-01.json --kur      eksik olanları ekler
//   node tools/kurulum/timescale-niagara.mjs --station stations/ps-01.json --durum    rapor (yazmaz)
//   node tools/kurulum/timescale-niagara.mjs --station stations/ps-01.json --sema     createSchema eylemi (buradan
//       çağrılınca sürücü şifreyi okuyamıyor: "Sifre okunamadi (SecurityException)". Kurulum bunu kullanmaz,
//       tabloları TsSema.java ile kurar.)
//   node tools/kurulum/timescale-niagara.mjs --station stations/ps-01.json --bekle 180  bağlantıyı bekler
//
// Var olan bileşene dokunulmaz (ayarı farklıysa yalnız raporlanır). Veritabanı şifresi buradan
// YAZILMAZ: Workbench'te TimescaleDevice → password alanına girilir (BPassword istasyonda şifrelenir).
// Son satır makine için: "SONUC {json}" (kur-istasyon.ps1 okur).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from '../jace/baja-page.mjs'
import { H } from '../jace/auth.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
if (!process.env.JACE_URL) { console.error('DUR: $env:JACE_URL verilmedi (yerel istasyon için "https://127.0.0.1")'); process.exit(2) }
// Ayarlar: --ayar ayarlar/<istasyon>.json (tek kaynak) ya da eski yol: --station dosyasının site bölümü
let site, db
if (arg('--ayar')) {
  const A = JSON.parse(fs.readFileSync(path.resolve(ROOT, arg('--ayar')), 'utf8'))
  const v = A.veritabani ?? {}
  db = { host: v.host ?? 'localhost', port: v.port ?? 5432, name: v.ad ?? 'Niagara', user: v.kullanici ?? 'postgres' }
  site = { retention_years: A.saklama_yil, compress_after_days: A.sikistirma_gun }
} else {
  const ST = JSON.parse(fs.readFileSync(path.resolve(ROOT, arg('--station', 'stations/ps-01.json')), 'utf8'))
  site = ST.site ?? {}
  db = site.db ?? { host: 'localhost', port: 5432, name: 'Niagara' }
}
const MODE = ['--kur', '--durum', '--sema', '--bekle'].find((m) => process.argv.includes(m)) ?? '--durum'

const CFG = {
  dev: { serverHost: db.host, serverPort: db.port, databaseName: db.name, schemaName: 'niagara', username: db.user ?? 'postgres', autoCreateSchema: true },
  exp: { includeFilter: '*', excludeFilter: '', maxRecordsPerCycle: 100000, retentionYears: site.retention_years ?? 5, compressAfterDays: site.compress_after_days ?? 7 },
}

const p = await bajaPage()
console.log('istasyon:', H, '·', MODE)
const r = await p.eval(`(async () => {
  const baja = window.__baja, CFG = ${JSON.stringify(CFG)}, MODE = ${JSON.stringify(MODE)}, WAIT = ${Number(arg('--bekle', 0)) || 0}
  const out = [], res = {}
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
  const get = (o) => baja.Ord.make(o).get({ subscriber: new baja.Subscriber() }).then((c) => c, () => null)
  const NET = 'station:|slot:/Drivers/TimescaleNetwork', DEV = NET + '/TimescaleDevice', EXP = DEV + '/TimescaleHistoryExport'

  // İstasyon adı: okuma servisi (TsOkuma) varsa ondan — Niagara'nın kendi adı, sürücü veriyi bununla yazar
  const ts = await get('station:|slot:/TsOkuma')
  if (ts) { try { res.station = JSON.parse(String(await ts.invoke({ slot: 'sorgu', value: 'op=info' }))).station } catch (e) { res.stationError = String(e) } }

  if (MODE === '--kur') {
    await baja.importTypes({ typeSpecs: ['timescale:TimescaleNetwork', 'timescale:TimescaleDevice', 'timescale:TimescaleHistoryExport'] })
    const drivers = await baja.Ord.make('station:|slot:/Drivers').get(); await drivers.loadSlots()
    let added = 0
    if (!drivers.has('TimescaleNetwork')) { await drivers.add({ slot: 'TimescaleNetwork', value: baja.$('timescale:TimescaleNetwork') }); out.push('+ TimescaleNetwork'); added++ }
    const net = await baja.Ord.make(NET).get(); await net.loadSlots()
    if (!net.has('TimescaleDevice')) {
      const d = baja.$('timescale:TimescaleDevice')
      for (const [k, v] of Object.entries(CFG.dev)) d.set({ slot: k, value: typeof v === 'number' ? baja.Integer.make(v) : v })
      await net.add({ slot: 'TimescaleDevice', value: d }); out.push('+ TimescaleDevice (' + CFG.dev.serverHost + ':' + CFG.dev.serverPort + '/' + CFG.dev.databaseName + ', kullanıcı ' + CFG.dev.username + ')'); added++
    }
    const dev = await baja.Ord.make(DEV).get(); await dev.loadSlots()
    if (!dev.has('TimescaleHistoryExport')) {
      const x = baja.$('timescale:TimescaleHistoryExport')
      x.set({ slot: 'deviceOrd', value: baja.Ord.make(DEV) })
      for (const [k, v] of Object.entries(CFG.exp)) x.set({ slot: k, value: typeof v === 'number' ? baja.Integer.make(v) : v })
      await dev.add({ slot: 'TimescaleHistoryExport', value: x }); out.push('+ TimescaleHistoryExport (tüm history\\'ler, ' + CFG.exp.retentionYears + ' yıl / ' + CFG.exp.compressAfterDays + ' gün)'); added++
    }
    if (added) { const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); out.push('istasyon kaydedildi') }
    else out.push('TimescaleNetwork / Device / HistoryExport zaten var — dokunulmadı')
    res.added = added
  }

  if (MODE === '--sema') {
    const dev = await get(DEV)
    if (!dev) return { out: ['TimescaleDevice yok'], res }
    await dev.invoke({ slot: 'createSchema' }); out.push('createSchema çağrıldı')
    await sleep(5000)
  }

  // timescaleVersion yalnız ping'te güncellenir (sürücünün ping'i dakikalar arayla çalışır):
  // beklerken ping'i kendimiz tetikleriz, yoksa doğru girilen şifreden sonra da eski hata görünür.
  const ping = async () => { const d = await get(DEV); if (!d) return; try { await d.invoke({ slot: 'ping' }) } catch (e) { /* eylem yoksa geç */ } ; await sleep(3000) }
  if (MODE === '--bekle') {
    for (let i = 0; i < WAIT; i += 6) {
      await ping()
      const d = await get(DEV)
      const v = d ? String(d.get('timescaleVersion') || '') : ''
      if (v) break
      await sleep(3000)
    }
  }
  if (MODE === '--durum' || MODE === '--kur') {
    const d = await get(DEV)
    if (d && !String(d.get('timescaleVersion') || '')) await ping()
  }

  // durum (her modda)
  const dev = await get(DEV), exp = await get(EXP)
  res.hasDevice = !!dev; res.hasExport = !!exp
  if (dev) {
    res.timescaleVersion = String(dev.get('timescaleVersion') || '')
    res.connected = !!res.timescaleVersion
    res.deviceStatus = String(dev.get('status')); res.lastWriteError = String(dev.get('lastWriteError') || '')
    for (const k of Object.keys(CFG.dev)) { const v = String(dev.get(k)); if (v !== String(CFG.dev[k])) out.push('  not: TimescaleDevice.' + k + ' = ' + v + ' (dosyada ' + CFG.dev[k] + ')') }
    out.push('TimescaleDevice: ' + (res.connected ? 'bağlı, TimescaleDB ' + res.timescaleVersion : 'BAĞLI DEĞİL') + ' · durum ' + res.deviceStatus + (res.lastWriteError ? ' · hata: ' + res.lastWriteError : ''))
  } else out.push('TimescaleDevice YOK')
  if (exp) {
    res.lastRun = String(exp.get('lastRun')); res.exportError = String(exp.get('lastError') || '')
    res.historiesMatched = Number(exp.get('historiesMatched')); res.rowsExported = Number(exp.get('rowsExported'))
    out.push('HistoryExport: son tur ' + res.lastRun + ' · ' + res.historiesMatched + ' history · ' + res.rowsExported + ' kayıt' + (res.exportError ? ' · ' + res.exportError : ''))
  } else out.push('TimescaleHistoryExport YOK')
  out.push('Niagara istasyon adı: ' + (res.station || '? (okuma servisi kurulu değil)'))
  return { out, res }
})()`)
for (const l of r.out) console.log(' ', l)
console.log('SONUC ' + JSON.stringify(r.res))
await p.close()
process.exit(0)
