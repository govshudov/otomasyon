// JACE oturumu: gerekirse giriş yapar (kimlik bilgileri JU/JP ortam değişkenlerinden).
export const H = process.env.JACE_URL ?? 'https://192.168.1.140'

export async function ensureLogin(p) {
  if (!process.env.JU || !process.env.JP) {
    throw new Error('JACE kullanıcı adı/şifresi yok: $env:JU ve $env:JP ayarlanmalı (ya da tools\\jace\\kur.ps1 kullanın — şifreyi sorar)')
  }
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
  // Giriş olmazsa sessizce devam etmek, BajaScript'in yüklenemediği anlaşılmaz
  // bir hataya ("/requirejs/config.js") dönüşüyordu — burada açıkça dur.
  if (!await p.waitFor(`!/login/.test(location.pathname)`, 20000)) {
    throw new Error(`JACE'e giriş yapılamadı (${H}) — kullanıcı adı ya da şifre yanlış`)
  }
  return p.eval('location.href')
}
