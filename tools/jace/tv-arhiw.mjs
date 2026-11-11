// Eski TV arayüzünün "ARHIW MAGLUMATLARY" sayfasına (file:^TV_PX/HISTORY.px) bizim
// Grafikler | Hasabatlar sayfasını koyar. TV menüsü (başlık, PxInclude) olduğu gibi kalır;
// altındaki Niagara geçmiş grafiği (WebWidget) yerine WebBrowser → file:^twin/arhiw_git.html.
//
//   $env:JACE_URL = "https://127.0.0.1"; $env:JU = "admin"; $env:JP = "<şifre>"
//   node tools/jace/tv-arhiw.mjs            kur (eski sayfa önce masaüstüne yedeklenir)
//   node tools/jace/tv-arhiw.mjs --geri     yedekteki eski sayfayı geri yükle
//
// Önce arayüz paketi kurulmuş olmalı (kur-istasyon.ps1 adım 8: file:^twin/arhiw.html).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { bajaPage } from './baja-page.mjs'
import { H } from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const P = JSON.parse(fs.readFileSync(path.join(HERE, 'FileDrop.program.json'), 'utf8').replace(/^[^{]*/, '').replace(/;?\s*$/, ''))
const GERI = process.argv.includes('--geri')
const SAYFA = 'TV_PX/HISTORY.px'
const YEDEK = path.join(os.homedir(), 'Desktop', 'tv_yedek', 'HISTORY.px')
const log = (...a) => console.log(...a)

const p = await bajaPage()
log('istasyon:', H)
const get = (rel) => p.eval(`fetch('/file/${rel}', { credentials: 'same-origin', cache: 'no-store' }).then(async (r) => ({ s: r.status, t: r.ok ? await r.text() : '' }))`)

let yeni
if (GERI) {
  if (!fs.existsSync(YEDEK)) { log('DUR: yedek yok:', YEDEK); process.exit(2) }
  yeni = fs.readFileSync(YEDEK, 'utf8')
  log('geri yükleniyor:', YEDEK)
} else {
  const a = await get('twin/arhiw.html'), b = await get('twin/arhiw_git.html')
  if (a.s !== 200 || b.s !== 200) { log('DUR: istasyonda file:^twin/arhiw.html yok. Önce: kur-istasyon.ps1 -Ayar ... -Basla 8 -Bitir 8'); process.exit(2) }
  const eski = await get(SAYFA)
  if (eski.s !== 200) { log('DUR: ' + SAYFA + ' okunamadı (' + eski.s + ')'); process.exit(2) }
  if (eski.t.includes('arhiw_git.html')) { log('zaten kurulu: ' + SAYFA + ' bizim sayfayı gösteriyor'); await p.close(); process.exit(0) }
  if (!fs.existsSync(YEDEK)) { fs.mkdirSync(path.dirname(YEDEK), { recursive: true }); fs.writeFileSync(YEDEK, eski.t); log('yedek:', YEDEK) }
  else log('yedek zaten var (korunuyor):', YEDEK)
  // TV başlığı (PxInclude) kalır; geçmiş grafiği WebWidget'ı aynı yer ve boyutta WebBrowser olur
  const m = eski.t.match(/<WebWidget\b[^>]*\blayout="([^"]+)"[^>]*>[\s\S]*?<\/WebWidget>/)
  if (!m) { log('DUR: ' + SAYFA + ' içinde WebWidget bulunamadı (sayfa beklenenden farklı); hiçbir şey yazılmadı'); process.exit(2) }
  yeni = eski.t.replace(m[0], `<WebBrowser layout="${m[1]}" ord="file:^twin/arhiw_git.html" showProgressIndicator="false"/>`)
  // WebBrowser tipi workbench modülünde (workbench:WebBrowser); mevcut Px'ler jxBrowser'ı da ekliyor
  for (const mod of ['jxBrowser', 'workbench']) if (!new RegExp(`<module name="${mod}"/>`).test(yeni)) yeni = yeni.replace('<import>', `<import>\n  <module name="${mod}"/>`)
  log('yeni içerik: başlık aynı, ' + m[1] + ' alanında WebBrowser → file:^twin/arhiw_git.html')
}

// Dosyayı yaz: geçici FileDrop programı (deploy.mjs ile aynı), sonra kaldırılır
const r = await p.eval(`(async () => {
  const baja = window.__baja, P = ${JSON.stringify(P)}, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
  await baja.importTypes({ typeSpecs: ['program:Program', 'program:ProgramCode', 'program:ProgramAction', 'baja:Blob'] })
  const root = await baja.Ord.make('station:|slot:/Twin').get(); await root.loadSlots()
  if (root.has('FileDropTmp')) await root.remove('FileDropTmp')
  const prog = baja.$('program:Program')
  for (const q of P.props) prog.add({ slot: q.name, value: q.type === 'baja:Boolean' ? q.value === 'true' : q.value })
  const c = baja.$('program:ProgramCode')
  c.set({ slot: 'className', value: P.className }); c.set({ slot: 'classFile', value: baja.$('baja:Blob').decodeFromString(P.classFile) })
  c.set({ slot: 'dependencies', value: P.dependencies }); c.set({ slot: 'userDefinedImports', value: P.userDefinedImports })
  c.set({ slot: 'source', value: P.source }); c.set({ slot: 'checksum', value: baja.Integer.make(P.checksum) })
  prog.set({ slot: 'code', value: c })
  await root.add({ slot: 'FileDropTmp', value: prog })
  try {
    const fd = await baja.Ord.make('station:|slot:/Twin/FileDropTmp').get({ subscriber: new baja.Subscriber() })
    await fd.set({ slot: 'path', value: '^${SAYFA}' }); await fd.set({ slot: 'remove', value: false })
    await fd.set({ slot: 'data', value: ${JSON.stringify(Buffer.from(yeni, 'utf8').toString('base64'))} })
    await fd.invoke({ slot: 'execute' })
    let res = ''
    for (let i = 0; i < 150; i++) { res = String(fd.get('result')); if (res.includes('${SAYFA}')) break; await sleep(100) }
    return res || 'yanıt yok'
  } finally { await root.loadSlots(); if (root.has('FileDropTmp')) await root.remove('FileDropTmp') }
})()`)
log('yazma:', r)
if (!String(r).startsWith('OK')) { await p.close(); process.exit(1) }

// Kontrol: sayfayı açıp ekran görüntüsü
await p.goto(H + '/ord/file:%5ETV_PX/HISTORY.px%7Cview:hx:HxPxView', 15000)
await p.sleep(8000)
const shot = path.join(os.homedir(), 'Desktop', 'tv_yedek', GERI ? 'HISTORY_geri.png' : 'HISTORY_yeni.png')
await p.shot(shot)
log('ekran görüntüsü:', shot)
log(GERI ? 'TAMAM: eski ARHIW sayfası geri yüklendi' : 'TAMAM: ARHIW MAGLUMATLARY artık Grafikler | Hasabatlar gösteriyor (tarayıcıda Ctrl+F5)')
await p.close()
process.exit(0)
