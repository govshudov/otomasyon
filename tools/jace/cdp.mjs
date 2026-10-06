// Küçük CDP yardımcısı: başsız Chrome'da tek bir sekme açar, adım adım JS çalıştırır.
//   import { open } from './cdp.mjs'
import fs from 'node:fs'

export async function open(port = 9333) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 1
  const pending = new Map()
  const logs = []
  const waiters = []
  const handlers = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params)
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text))
    if (m.method === 'Page.loadEventFired') { while (waiters.length) waiters.shift()() }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
  const page = {
    send, logs,
    on: (method, fn) => handlers.set(method, fn),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async goto(url, wait = 15000) {
      const loaded = new Promise((r) => { waiters.push(r); setTimeout(r, wait) })
      await send('Page.navigate', { url })
      await loaded
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails))
      return r.result?.result?.value
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    },
    async waitFor(expr, ms = 20000) {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try { if (await page.eval(expr)) return true } catch { /* sayfa geçişi */ }
        await page.sleep(300)
      }
      return false
    },
    close: async () => {
      try { ws.close() } catch { /* */ }
      // sekmeyi de kapat — açık kalan sekmede 3D sayfa çalışmaya devam ediyordu
      try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`) } catch { /* */ }
    },
  }
  return page
}
