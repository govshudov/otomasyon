// JACE oturumu: gerekirse giriş yapar (kimlik bilgileri JU/JP ortam değişkenlerinden).
export const H = process.env.JACE_URL ?? 'https://192.168.1.140'

export async function ensureLogin(p) {
  await p.goto(`${H}/login`, 10000)
  await p.sleep(800)
  const href = await p.eval('location.href')
  if (!/prelogin|login/.test(href)) return href
  if (await p.eval(`!!document.querySelector('input[name=j_username]:not([readonly])')`)) {
    await p.eval(`(() => { document.querySelector('input[name=j_username]').value = ${JSON.stringify(process.env.JU)}; document.querySelector('#login-submit').click(); return 1 })()`)
    await p.waitFor(`!!document.querySelector('input[type=password]')`)
    await p.sleep(500)
  }
  await p.eval(`(() => { const pw = document.querySelector('input[type=password]'); pw.value = ${JSON.stringify(process.env.JP)};
    document.querySelector('#login-submit').click(); return 1 })()`)
  await p.waitFor(`!/login/.test(location.pathname)`, 20000)
  return p.eval('location.href')
}
