// JACE'e kurulum (kullanıcı onayıyla; kullanıcı kendi terminalinde çalıştırır):
//  1) eski twin dosyalarının yerel yedeği
//  2) geçici FileDrop programı (station:|slot:/Twin/FileDropTmp) ile file:^twin'e yeni dosyalar
//  3) kullanılmayan eski asset/modellerin silinmesi, programın kaldırılması
//  4) /Twin/<istasyon> altında arayüzün KULLANDIĞI noktalardan eksik olanların eklenmesi
//     (pompa: 16 sinyal; esasy turba: akym, jemi göwrüm, basyş; howuz: suw derejesi;
//     hücre datçikleri LT-0x: level_m + state). Hedef istasyonda /Twin/<istasyon> yoksa hiçbir şey
//     yazılmaz — yalnız --create-twin verilirse (yeni istasyon kurulumu) boş klasörler oluşturulur.
//     Var olan noktaya ve değerine dokunulmaz; hiçbir nokta silinmez.
//  5) nokta eklendiyse istasyonun kaydedilmesi
//
//   node tools/jace/deploy.mjs <dist> <yedek-klasörü> [--station stations/ps-01.json] [--create-twin] [--plan]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const [, , DIST, BACKUP] = process.argv
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILEDROP = path.join(HERE, 'FileDrop.program.json')
const P = JSON.parse(fs.readFileSync(FILEDROP, 'utf8').replace(/^[^{]*/, '').replace(/;?\s*$/, ''))

// Eklenecek noktalar katalogdan türetilir (elle liste tutulmaz)
const ROOT = path.resolve(HERE, '../..')
const TYPES = JSON.parse(fs.readFileSync(path.join(ROOT, 'common/equipment_types.json'), 'utf8')).types
const STATION = JSON.parse(fs.readFileSync(path.resolve(ROOT, opt('--station', 'stations/ps-01.json')), 'utf8'))
const SID = STATION.station_id
const CREATE_TWIN = process.argv.includes('--create-twin')
const USED = { pump_hsc: null, header: ['flow_m3h', 'total_m3', 'press_bar'], basin: ['level_m'], level_sensor: null }
const SPEC = []
for (const e of STATION.equipment) {
  if (!(e.type in USED)) continue
  for (const [key, sd] of Object.entries(TYPES[e.type].signals)) {
    if (USED[e.type] && !USED[e.type].includes(key)) continue
    SPEC.push({ path: [e.id, ...key.split('.')], kind: sd.type === 'bool' ? 'bool' : 'num', unit: sd.unit ?? '' })
  }
  // Datçik kartının rozeti: RUNNING / FAULT / STOPPED / MAINT (boşsa rozet gösterilmez)
  if (e.type === 'level_sensor') SPEC.push({ path: [e.id, 'state'], kind: 'str', unit: '' })
}
const PT_TYPE = { num: 'control:NumericWritable', bool: 'control:BooleanWritable', str: 'control:StringWritable' }

// JACE'te bulunmuş/bulunabilecek her dosya: yeni pakette olmayanlar silinir.
// (2026-10-04: Draco'lu ilk kurulumun JS'i ve draco/ çözücüleri de artık gereksiz.)
const OLD = ['index.html', 'stations.json', 'assets/main-BF0-mYbc.js', 'assets/stations-BPAIQlAz.js', 'assets/main-CDSP6Zmk.css',
  'assets/three-DryZsNtz.js', 'models/ps-01.glb', 'models/ps-01-twin-map.json', 'models/ps-02.glb', 'models/ps-02-twin-map.json',
  'models/ps-03.glb', 'models/ps-03-twin-map.json',
  'assets/index-DWz777XG.js', 'assets/index-CV2qGtO1.js', 'assets/index-BH4tkQQQ.js', 'assets/index-BboAZoN4.js', 'assets/index-dldDpmq8.css', 'models/ps-01-station.json',
  'draco/gltf/draco_decoder.js', 'draco/gltf/draco_decoder.wasm', 'draco/gltf/draco_wasm_wrapper.js',
  // 4 Ekim kurulumları (bu PC: 3D + 2D şema; Dell: bina/toprak/datçik sürümleri)
  'assets/index-CFPaVDo4.js', 'assets/index-CRVcrTOC.css',
  'assets/index-BQ10q0hM.js', 'assets/index-DbwbtYDd.js', 'assets/index-CvpPhrAj.js',
  'assets/index-DHC1wxPk.js', 'assets/index-MsweaQ7G.css', 'assets/index-ChJTJYhX.js', 'assets/index-CUVKD536.css',
  'models/ps-01.part0.bin', 'models/ps-01.part1.bin', 'models/ps-01.part2.bin', 'models/ps-01.part3.bin']

// `--plan`: JACE'e bağlanmadan yalnız kontrol edilecek nokta listesini yazar
if (process.argv.includes('--plan')) {
  for (const s of SPEC) console.log(`  /Twin/${SID}/${s.path.join('/')}  ${PT_TYPE[s.kind].split(':')[1]}  ${s.unit}`)
  console.log(`${SPEC.length} nokta (yalnız EKSİK olanlar eklenir)`)
  process.exit(0)
}

const files = []
const walk =(d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(DIST, p).replace(/\\/g, '/')) } }
walk(DIST)
files.sort((a, b) => (a === 'index.html') - (b === 'index.html'))          // index.html en sona
const remove = OLD.filter((f) => !files.includes(f))

const p = await bajaPage()
const log = (...a) => console.log(...a)

// 0) İkiz nokta ağacı var mı? Dosya yazan geçici program da /Twin altına
// kurulduğu için ağaç yoksa hiçbir adım çalışmaz — hiçbir şey yazmadan dur.
const TWIN_ORD = `station:|slot:/Twin/${SID.replace(/-/g, '$2d')}`
const hasTwin = await p.eval(`window.__baja.Ord.make(${JSON.stringify(TWIN_ORD)}).get().then(() => true, () => false)`)
if (!hasTwin && !CREATE_TWIN) {
  log(`DUR: ${H} istasyonunda Config → Twin → ${SID} yok. Önce Workbench'te JACE'ten`)
  log(`'Twin' klasörünü kopyalayıp bu istasyonun Config'ine yapıştırın ve kaydedin. Hiçbir şey yazılmadı.`)
  log(`(Yeni istasyon kuruluyorsa --create-twin ile boş Twin klasörü oluşturulur.)`)
  await p.close(); process.exit(2)
}
if (!hasTwin) {
  log(await p.eval(`(async () => {
    const baja = window.__baja
    await baja.importTypes({ typeSpecs: ['baja:Folder'] })
    const root = await baja.Ord.make('station:|slot:/').get(); await root.loadSlots()
    if (!root.has('Twin')) await root.add({ slot: 'Twin', value: baja.$('baja:Folder') })
    const tw = await baja.Ord.make('station:|slot:/Twin').get(); await tw.loadSlots()
    const sid = baja.SlotPath.escape(${JSON.stringify(SID)})
    if (!tw.has(sid)) await tw.add({ slot: sid, value: baja.$('baja:Folder') })
    const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' })
    return 'Twin/' + ${JSON.stringify(SID)} + ' klasörü oluşturuldu (istasyon kaydedildi)'
  })()`))
}

// 1) yerel yedek — klasör zaten varsa (ilk kurulumun yedeği) ona dokunulmaz
for (const rel of fs.existsSync(BACKUP) ? [] : OLD) {
  const b64 = await p.eval(`fetch('/file/twin/${rel}', {credentials:'same-origin'}).then(async r => { if (!r.ok) return null
    const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) })`)
  if (b64) { const dst = path.join(BACKUP, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, Buffer.from(b64, 'base64')) }
}
log('yerel yedek:', BACKUP, fs.existsSync(BACKUP) ? '(var, korunuyor)' : '')

// sayfa tarafı yardımcılar
await p.eval(`(() => {
  const baja = window.__baja
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.__fdSetup = async (P) => {
    await baja.importTypes({ typeSpecs: ['program:Program', 'program:ProgramCode', 'program:ProgramAction', 'baja:Blob', 'baja:Folder', 'control:NumericWritable'] })
    const root = await baja.Ord.make('station:|slot:/Twin').get(); await root.loadSlots()
    if (root.has('FileDropTmp')) await root.remove('FileDropTmp')
    const prog = baja.$('program:Program')
    for (const q of P.props) prog.add({ slot: q.name, value: q.type === 'baja:Boolean' ? q.value === 'true' : q.value })
    const c = baja.$('program:ProgramCode')
    c.set({ slot: 'className', value: P.className })
    c.set({ slot: 'classFile', value: baja.$('baja:Blob').decodeFromString(P.classFile) })
    c.set({ slot: 'dependencies', value: P.dependencies })
    c.set({ slot: 'userDefinedImports', value: P.userDefinedImports })
    c.set({ slot: 'source', value: P.source })
    c.set({ slot: 'checksum', value: baja.Integer.make(P.checksum) })
    prog.set({ slot: 'code', value: c })
    await root.add({ slot: 'FileDropTmp', value: prog })
    window.__fd = await baja.Ord.make('station:|slot:/Twin/FileDropTmp').get({ subscriber: new baja.Subscriber() })
    return 'FileDropTmp eklendi'
  }
  window.__fdWrite = async (pth, b64, rm) => {
    const fd = window.__fd
    await fd.set({ slot: 'path', value: pth })
    await fd.set({ slot: 'remove', value: !!rm })
    await fd.set({ slot: 'data', value: rm ? '' : b64 })
    await fd.invoke({ slot: 'execute' })
    let r = ''
    for (let i = 0; i < 150; i++) { r = String(fd.get('result')); if (r.includes(pth)) break; await sleep(100) }
    return r || 'yanıt yok'
  }
  window.__fdTeardown = async () => {
    const root = await baja.Ord.make('station:|slot:/Twin').get(); await root.loadSlots()
    if (root.has('FileDropTmp')) await root.remove('FileDropTmp')
    return 'FileDropTmp kaldırıldı'
  }
  // spec: [{ path: ['PMP-01','MOTOR','t1'], kind: num|bool|str, unit }] — eksik klasör/nokta eklenir, var olana dokunulmaz.
  // Birim (facets) aynı birimli MEVCUT bir noktadan kopyalanır; yoksa facets'siz eklenir.
  window.__addPoints = async (spec) => {
    await baja.importTypes({ typeSpecs: ['control:NumericWritable', 'control:BooleanWritable', 'control:StringWritable', 'baja:Folder'] })
    const esc = (s) => baja.SlotPath.escape(s)
    const root = await baja.Ord.make('station:|slot:/Twin/' + esc(${JSON.stringify(SID)})).get()
    const load = async (c) => { await Promise.resolve(c.loadSlots && c.loadSlots()); return c }
    const find = async (p) => {
      let c = await load(root)
      for (const seg of p) { if (!c.has(esc(seg))) return null; c = await load(c.get(esc(seg))) }
      return c
    }
    const facetsByUnit = {}
    // °C birimi 3 Ekim'de eklenen MOTOR/temp noktasında var (yeni sıcaklıklar ondan kopyalanır)
    const tPt = await find(['PMP-01', 'MOTOR', 'temp'])
    if (tPt) facetsByUnit['°C'] = tPt.get('facets')
    for (const s of spec) {
      if (s.kind !== 'num' || !s.unit || facetsByUnit[s.unit]) continue
      const pt = await find(s.path)
      if (pt) facetsByUnit[s.unit] = pt.get('facets')
    }
    const out = []
    let had = 0
    for (const s of spec) {
      let c = await load(root)
      for (const seg of s.path.slice(0, -1)) {
        if (!c.has(esc(seg))) await c.add({ slot: esc(seg), value: baja.$('baja:Folder') })
        c = await load(c.get(esc(seg)))
      }
      const name = esc(s.path[s.path.length - 1])
      if (c.has(name)) { had++; continue }
      const pt = baja.$(${JSON.stringify(PT_TYPE)}[s.kind])
      try {
        if (s.kind === 'bool') pt.set({ slot: 'facets', value: baja.Facets.make(['trueText', 'falseText'], ['işleýär', 'durýar']) })
        else if (s.kind === 'num' && facetsByUnit[s.unit]) pt.set({ slot: 'facets', value: facetsByUnit[s.unit] })
      } catch (e) { /* facets olmadan da çalışır */ }
      await c.add({ slot: name, value: pt })
      out.push(s.path.join('/') + ' eklendi')
    }
    out.push(had + ' nokta zaten vardı (dokunulmadı)')
    return out
  }
  window.__save = async () => { const st = await baja.Ord.make('station:|slot:/').get(); await st.invoke({ slot: 'save' }); return 'istasyon kaydedildi' }
  return 1 })()`)

// 2-3) dosyalar
const MAX = 800 * 1024       // tek yazma isteği sınırı (base64 öncesi); üstü JACE'te takılıyor
const big = files.filter((rel) => fs.statSync(path.join(DIST, rel)).size > MAX)
if (big.length) { log('DUR: çok büyük dosya (parçalanmalı):', big.join(', ')); await p.close(); process.exit(1) }
// Takılan bir istek betiği sonsuza dek bekletmesin
const withTimeout = (pr, ms, what) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error(`zaman aşımı: ${what}`)), ms))])
log(await p.eval(`window.__fdSetup(${JSON.stringify(P)})`))
let ok = 0, fail = 0
try {
  for (const rel of files) {
    const b64 = fs.readFileSync(path.join(DIST, rel)).toString('base64')
    const r = await withTimeout(p.eval(`window.__fdWrite(${JSON.stringify('^twin/' + rel)}, ${JSON.stringify(b64)}, false)`), 90_000, rel)
    r.startsWith('OK') ? ok++ : fail++
    log('  yaz ', rel, '→', r)
  }
  if (fail === 0) {
    for (const rel of remove) {
      const r = await withTimeout(p.eval(`window.__fdWrite(${JSON.stringify('^twin/' + rel)}, '', true)`), 60_000, rel)
      log('  sil ', rel, '→', r)
    }
  } else log('yazma hatası var — eski dosyalar SİLİNMEDİ')
} catch (e) {
  log('HATA:', e.message, '— sayfa yenilenip geçici program kaldırılıyor')
  await p.goto(`${H}/file/twin/__yok__.html`, 8000).catch(() => {})
  await p.close()
  const q = await bajaPage()
  await q.eval(`(async () => { const r = await window.__baja.Ord.make('station:|slot:/Twin').get(); await r.loadSlots(); if (r.has('FileDropTmp')) await r.remove('FileDropTmp'); return 1 })()`)
  log('FileDropTmp kaldırıldı'); await q.close(); process.exit(1)
} finally {
  // (catch yolu process.exit ile çıktığı için buraya yalnız hatasız gelinir)
  log(await p.eval('window.__fdTeardown()').catch((e) => 'kaldırma hatası: ' + e.message))
}
log(`dosyalar: ${ok} yazıldı, ${fail} hata`)

// 4) noktalar (varsa dokunulmaz)
const pts = await p.eval(`window.__addPoints(${JSON.stringify(SPEC)})`)
for (const line of pts) log('  nokta', line)

// 5) kaydet — yalnız yeni nokta eklendiyse (FileDrop eklenip kaldırıldı, iz kalmaz)
if (pts.some((l) => l.endsWith('eklendi'))) log(await p.eval('window.__save()'))
else log('yeni nokta yok — istasyon kaydı gerekmedi')

// doğrulama
const idx = await p.eval(`fetch('/file/twin/index.html?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'}).then(r => r.text())`)
log('yeni index.html:', /Sanly ekiz/.test(idx) ? 'YENİ sürüm' : 'ESKİ/beklenmeyen', '|', (idx.match(/assets\/index-[\w-]+\.js/) || ['?'])[0])
// model: paket parçalı (models/<id>.partN.bin) ya da tek .glb taşır; stations.json'dan okunur
const glb = await p.eval(`fetch('/file/twin/stations.json?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'}).then((r) => r.json()).then((j) => {
  const s = (j.stations || []).find((x) => x.id === ${JSON.stringify(SID)})
  return s ? (s.model_parts ? s.model_parts.length + ' parça (Draco\\'suz)' : s.model + ' (tek dosya — Draco\\'lu olabilir)') : 'stations.json\\'da ${SID} yok!'
}).catch((e) => 'okunamadı: ' + e.message)`)
log('model:', glb)
await p.close()
process.exit(0)
