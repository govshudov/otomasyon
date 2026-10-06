// JACE origin'inde boş bir sayfa açıp BajaScript'i (CSRF jetonuyla) yükler.
import { open } from './cdp.mjs'
import { ensureLogin, H } from './auth.mjs'

export async function bajaPage() {
  const p = await open()
  await ensureLogin(p)
  await p.goto(`${H}/file/twin/__yok__.html`, 8000)
  await p.eval(`(async () => {
    const add = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src)); document.head.appendChild(s) })
    const html = await (await fetch('/ord?station:%7Cslot:/', {credentials: 'same-origin'})).text()
    const m = /id=['"]csrfToken['"][^>]*value=['"]([^'"]+)['"]/.exec(html)
    if (m) { const i = document.createElement('input'); i.type = 'hidden'; i.id = 'csrfToken'; i.value = m[1]; document.body.appendChild(i) }
    await add('/requirejs/config.js'); await add('/module/js/com/tridium/js/ext/require/require.min.js')
    window.__baja = await new Promise((ok, fail) => window.require(['baja!'], ok, fail))
    return 1 })()`)
  return p
}
