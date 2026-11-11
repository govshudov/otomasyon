// Nasos popup'ı neden açılmıyor: SALT OKUR, istasyonda hiçbir şey değiştirmez.
//   tools\jace\tv-bak.ps1   (şifre sorar)
// Bakılanlar: paket dosyaları istasyonda mı, Pump.px / MainPage.px'te WebBrowser kutusu var mı
// (ord'u ne), HTML5 sayfada kutu iframe olarak çiziliyor mu, üstünde başka bir şey var mı,
// tıklanınca popup açılıyor mu. Rapor ve ekran görüntüleri: Desktop\tv_yedek\
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { open } from './cdp.mjs'
import { ensureLogin, H } from './auth.mjs'

const OUT = path.join(os.homedir(), 'Desktop', 'tv_yedek')
fs.mkdirSync(OUT, { recursive: true })
const rapor = []
const log = (...a) => { const s = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, null, 1)).join(' '); console.log(s); rapor.push(s) }

const p = await open()
await ensureLogin(p)
await p.goto(`${H}/file/twin/__yok__.html`, 8000)
log('istasyon:', H)

const get = (u) => p.eval(`fetch(${JSON.stringify(u)}, { credentials: 'same-origin', cache: 'no-store' }).then(async (r) => ({ s: r.status, ct: r.headers.get('content-type'), t: r.ok ? (await r.text()).slice(0, 400000) : '' }))`)

log('\n== 1. Paket dosyaları (file:^twin)')
for (const f of ['index.html', 'nasos.html', 'dugme.js', 'dugme.css', 'dugme/PMP-01.html', 'eski_noktalar.json', 'stations.json']) {
  const r = await get('/file/twin/' + f)
  log(`  ${r.s === 200 ? 'VAR ' : 'YOK '} ${f}  (${r.s})`)
}

log('\n== 2. Px sayfalarındaki WebBrowser kutuları')
for (const sayfa of ['TV_PX/Pump.px', 'TV_PX/MainPage.px']) {
  const r = await get('/file/' + sayfa)
  if (r.s !== 200) { log(`  ${sayfa}: okunamadı (${r.s})`); continue }
  const wb = [...r.t.matchAll(/<WebBrowser\b[^>]*>/g)].map((m) => m[0])
  log(`  ${sayfa}: ${wb.length} WebBrowser`)
  for (const w of wb) log('    ' + w)
  const imp = [...r.t.matchAll(/<module name="([^"]+)"\/>/g)].map((m) => m[1])
  log(`    import: ${imp.join(', ')}`)
}

log('\n== 3. HTML5 sayfa (Pump.px)')
await p.goto(`${H}/ord/file:%5ETV_PX/Pump.px%7Cview:hx:HxPxView`, 20000)
await p.sleep(9000)
await p.shot(path.join(OUT, 'bak-1-pump.png'))
const ifr = await p.eval(`(() => {
  const out = []
  const walk = (doc, ox, oy, derin) => {
    for (const f of doc.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const ust = doc.elementFromPoint(cx, cy)
      let pe = '', el = f
      while (el && el.nodeType === 1) { const cs = getComputedStyle(el); if (cs.pointerEvents === 'none') { pe = el.tagName + '.' + el.className; break } el = el.parentElement }
      let ic = ''
      try { ic = f.contentDocument ? (f.contentDocument.location.href + ' | ' + f.contentDocument.documentElement.outerHTML.slice(0, 300)) : '(contentDocument yok)' } catch (e) { ic = 'erişilemedi: ' + e.message }
      out.push({ derin, src: f.getAttribute('src'), rect: [Math.round(r.left + ox), Math.round(r.top + oy), Math.round(r.width), Math.round(r.height)],
        gorunur: getComputedStyle(f).visibility + '/' + getComputedStyle(f).display, pointerNoneAtasi: pe,
        ortadakiEleman: ust ? (ust === f ? 'KENDİSİ' : ust.tagName + '#' + ust.id + '.' + ust.className) : null, ic })
      try { if (f.contentDocument) walk(f.contentDocument, ox + r.left, oy + r.top, derin + 1) } catch (e) { /* yok */ }
    }
  }
  walk(document, 0, 0, 0)
  return { url: location.href, top: window.top === window, iframes: out }
})()`)
log(ifr)

const dugmeler = ifr.iframes.filter((f) => /dugme/i.test(f.src ?? '') || /dugme/i.test(f.ic))
log(`\n  düğme iframe sayısı: ${dugmeler.length}`)
if (dugmeler.length) {
  const d = dugmeler[0], [x, y, w, h] = d.rect
  const cx = x + w / 2, cy = y + h / 2
  log(`  tıklanıyor: ${d.src} @ ${Math.round(cx)},${Math.round(cy)}`)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  await p.sleep(6000)
  const pop = await p.eval(`(() => { const k = document.getElementById('twinNasosKatman'); if (!k) return null
    let t = ''; try { t = k.contentDocument.body.innerText.slice(0, 600) } catch (e) { t = 'erişilemedi' }
    return { src: k.src, rect: JSON.stringify(k.getBoundingClientRect()), yazi: t } })()`)
  log('  popup:', pop ?? 'AÇILMADI')
  await p.shot(path.join(OUT, 'bak-2-tik.png'))
} else {
  log('  Sayfada düğme iframe yok: WebBrowser kutusu eklenmemiş, kaydedilmemiş ya da HTML5 görünümde çizilmiyor.')
}

fs.writeFileSync(path.join(OUT, 'tv-bak.txt'), rapor.join('\n'))
log('\nrapor: ' + path.join(OUT, 'tv-bak.txt'))
await p.close()
process.exit(0)
