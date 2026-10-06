// JACE'e kurulum (kullanıcı onayıyla, 2026-10-03):
//  1) eski twin dosyalarının yerel yedeği
//  2) geçici FileDrop programı (station:|slot:/Twin/FileDropTmp) ile file:^twin'e yeni dosyalar
//  3) kullanılmayan eski asset/modellerin silinmesi, programın kaldırılması
//  4) /Twin/PS-01/PMP-0x altına MOTOR/temp ve PUMP/vib, /Twin/PS-01/LT-0x/level_m + state noktaları
//  5) istasyonun kaydedilmesi
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const [, , DIST, BACKUP] = process.argv
const FILEDROP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'FileDrop.program.json')
const P = JSON.parse(fs.readFileSync(FILEDROP, 'utf8').replace(/^[^{]*/, '').replace(/;?\s*$/, ''))

// JACE'te bulunmuş/bulunabilecek her dosya: yeni pakette olmayanlar silinir.
// (2026-10-04: Draco'lu ilk kurulumun JS'i ve draco/ çözücüleri de artık gereksiz.)
const OLD = ['index.html', 'stations.json', 'assets/main-BF0-mYbc.js', 'assets/stations-BPAIQlAz.js', 'assets/main-CDSP6Zmk.css',
  'assets/three-DryZsNtz.js', 'models/ps-01.glb', 'models/ps-01-twin-map.json', 'models/ps-02.glb', 'models/ps-02-twin-map.json',
  'models/ps-03.glb', 'models/ps-03-twin-map.json',
  'assets/index-DWz777XG.js', 'assets/index-CV2qGtO1.js', 'assets/index-BH4tkQQQ.js', 'assets/index-BboAZoN4.js', 'assets/index-dldDpmq8.css', 'models/ps-01-station.json',
  'assets/index-CFPaVDo4.js',                                     // 2026-10-04 renk/KÖNE sürümü
  'assets/index-BQ10q0hM.js',                                     // 2026-10-04 bina/toprak/datçik sürümü
  'assets/index-DbwbtYDd.js',                                     // 2026-10-04 "Suwuň derejesi" sürümü
  'assets/index-CvpPhrAj.js',                                     // 2026-10-04 radar datçik sürümü
  'models/ps-01.part0.bin', 'models/ps-01.part1.bin', 'models/ps-01.part2.bin', 'models/ps-01.part3.bin',
  'draco/gltf/draco_decoder.js', 'draco/gltf/draco_decoder.wasm', 'draco/gltf/draco_wasm_wrapper.js']

const files = []
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(DIST, p).replace(/\\/g, '/')) } }
walk(DIST)
files.sort((a, b) => (a === 'index.html') - (b === 'index.html'))          // index.html en sona
const remove = OLD.filter((f) => !files.includes(f))

const p = await bajaPage()
const log = (...a) => console.log(...a)

// 0) İkiz nokta ağacı var mı? Dosya yazan geçici program da /Twin altına
// kurulduğu için ağaç yoksa hiçbir adım çalışmaz — hiçbir şey yazmadan dur.
const hasTwin = await p.eval(`window.__baja.Ord.make('station:|slot:/Twin/PS$2d01').get().then(() => true, () => false)`)
if (!hasTwin) {
  log(`DUR: ${H} istasyonunda Config → Twin → PS-01 yok. Önce Workbench'te JACE'ten`)
  log(`'Twin' klasörünü kopyalayıp bu istasyonun Config'ine yapıştırın ve kaydedin. Hiçbir şey yazılmadı.`)
  await p.close(); process.exit(2)
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
  window.__addPoints = async () => {
    const base = 'station:|slot:/Twin/PS$2d01', out = []
    const facetsOf = async (o) => { try { return (await baja.Ord.make(o).get()).get('facets') } catch (e) { return null } }
    const fTemp = await facetsOf(base + '/PMP$2d01/MOTOR__WINDING$2dU/temp')
    const fVib = await facetsOf(base + '/PMP$2d01/PUMP__BEARING/vib')
    for (let i = 1; i <= 6; i++) {
      const pmp = await baja.Ord.make(base + '/PMP$2d0' + i).get(); await pmp.loadSlots()
      for (const [folder, name, facets] of [['MOTOR', 'temp', fTemp], ['PUMP', 'vib', fVib]]) {
        if (!pmp.has(folder)) await pmp.add({ slot: folder, value: baja.$('baja:Folder') })
        const f = pmp.get(folder); await Promise.resolve(f.loadSlots && f.loadSlots())
        if (f.has(name)) { out.push('PMP-0' + i + '/' + folder + '/' + name + ' zaten var'); continue }
        const pt = baja.$('control:NumericWritable')
        if (facets) pt.set({ slot: 'facets', value: facets })
        await f.add({ slot: name, value: pt })
        out.push('PMP-0' + i + '/' + folder + '/' + name + ' eklendi')
      }
    }
    // Emme hücresi seviye datçikleri: /Twin/PS-01/LT-0x/level_m (birim havuz seviyesinden)
    const fLvl = await facetsOf(base + '/BASIN$2d01/level_m')
    const root = await baja.Ord.make(base).get(); await root.loadSlots()
    for (let i = 1; i <= 6; i++) {
      const id = 'LT$2d0' + i
      if (!root.has(id)) await root.add({ slot: id, value: baja.$('baja:Folder') })
      const f = root.get(id); await Promise.resolve(f.loadSlots && f.loadSlots())
      if (f.has('level_m')) out.push('LT-0' + i + '/level_m zaten var')
      else {
        const pt = baja.$('control:NumericWritable')
        if (fLvl) pt.set({ slot: 'facets', value: fLvl })
        await f.add({ slot: 'level_m', value: pt })
        out.push('LT-0' + i + '/level_m eklendi')
      }
      // Kart rozeti: RUNNING / FAULT / STOPPED / MAINT (boşsa rozet gösterilmez)
      if (f.has('state')) out.push('LT-0' + i + '/state zaten var')
      else { await f.add({ slot: 'state', value: baja.$('control:StringWritable') }); out.push('LT-0' + i + '/state eklendi') }
    }
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
const pts = await p.eval('window.__addPoints()')
for (const line of pts) log('  nokta', line)

// 5) kaydet — yalnız yeni nokta eklendiyse (FileDrop eklenip kaldırıldı, iz kalmaz)
if (pts.some((l) => l.endsWith('eklendi'))) log(await p.eval('window.__save()'))
else log('yeni nokta yok — istasyon kaydı gerekmedi')

// doğrulama
const idx = await p.eval(`fetch('/file/twin/index.html?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'}).then(r => r.text())`)
log('yeni index.html:', /Sanly ekiz/.test(idx) ? 'YENİ sürüm' : 'ESKİ/beklenmeyen', '|', (idx.match(/assets\/index-[\w-]+\.js/) || ['?'])[0])
const glb = await p.eval(`fetch('/file/twin/models/ps-01.glb?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'}).then(async r => {
  const b = new Uint8Array(await r.arrayBuffer()); const j = new TextDecoder().decode(b.subarray(20, 20 + new DataView(b.buffer).getUint32(12, true)))
  return b.length + ' bayt, Draco: ' + (j.includes('KHR_draco_mesh_compression') ? 'VAR (JACE\\'te yüklenmez!)' : 'yok') })`)
log('model:', glb)
await p.close()
process.exit(0)
