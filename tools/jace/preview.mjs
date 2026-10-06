// JACE'e YAZMADAN önizleme: /file/twin_v2/* isteklerini tarayıcıda yakalayıp yerel
// dist-niagara'dan cevaplar. Sayfa gerçek JACE origin'inde, gerçek oturum ve
// BajaScript ile çalışır; istasyona hiçbir dosya gitmez.
//   node tools/jace/preview.mjs web/dist-niagara <çıktı-öneki> [adımlar.json]
import fs from 'node:fs'
import path from 'node:path'
import { open } from './cdp.mjs'
import { ensureLogin, H } from './auth.mjs'

const [, , DIST, PREFIX, STEPS] = process.argv
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.json': 'application/json; charset=utf-8', '.glb': 'application/octet-stream', '.wasm': 'application/wasm' }
const steps = STEPS ? JSON.parse(fs.readFileSync(STEPS, 'utf8').replace(/^﻿/, '')) : [{ shot: 'view' }]

const p = await open()
console.log('giriş:', await ensureLogin(p))
let served = 0
p.on('Fetch.requestPaused', async (ev) => {
  const u = new URL(ev.request.url)
  const rel = decodeURIComponent(u.pathname.replace(/^\/file\/twin_v2\//, '')) || 'index.html'
  const f = path.join(DIST, rel)
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    served++
    await p.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200,
      // JACE'in gerçek CSP başlığı — önizleme sahadakiyle aynı kısıtlar altında çalışsın
      responseHeaders: [{ name: 'Content-Type', value: MIME[path.extname(f)] ?? 'application/octet-stream' }, { name: 'Cache-Control', value: 'no-store' },
        { name: 'Content-Security-Policy', value: `connect-src 'self' workbench ws://${new URL(H).host}:443 wss://${new URL(H).host}:443; default-src 'self' workbench; img-src 'self' workbench data: module:; script-src 'self' workbench 'unsafe-inline' 'unsafe-eval'; style-src 'self' workbench 'unsafe-inline'` }],
      body: fs.readFileSync(f).toString('base64') })
  } else {
    await p.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 404, responseHeaders: [], body: '' })
  }
})
await p.send('Fetch.enable', { patterns: [{ urlPattern: `${H}/file/twin_v2/*`, requestStage: 'Request' }] })
await p.goto(`${H}/file/twin_v2/index.html`, 20000)
await p.waitFor('!!(window.__twin && window.__twin.info && window.__twin.info.merged)', 60000)
await p.sleep(4000)
console.log('yerelden sunulan dosya:', served)

for (const s of steps) {
  if (s.wait) await p.sleep(s.wait)
  if (s.eval) console.log('eval:', JSON.stringify(await p.eval(s.eval)))
  if (s.clickEq) {
    const pt = await p.eval(`(() => { const t = window.__twin, m = t.info.merged
      const ids = (m.byEquipment.get(${JSON.stringify(s.clickEq)}) || []).filter(i => /__(MOTOR|PUMP)$/.test(m.components[i].node))
      const c = m.components[ids[0]].center.clone().project(t.camera), r = t.renderer.domElement.getBoundingClientRect()
      return { x: (c.x * 0.5 + 0.5) * r.width + r.left, y: (-c.y * 0.5 + 0.5) * r.height + r.top } })()`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await p.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
    await p.sleep(1000)
  }
  if (s.shot) { await p.shot(`${PREFIX}-${s.shot}.png`); console.log('görüntü:', `${PREFIX}-${s.shot}.png`) }
}
console.log('--- konsol ---\n' + p.logs.slice(-15).join('\n'))
await p.close()
process.exit(0)
