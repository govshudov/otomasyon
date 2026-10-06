// SALT OKUNUR: JACE'teki twin kurulumunun durumu.
import { bajaPage } from './baja-page.mjs'
const p = await bajaPage()
console.log(await p.eval(`(async () => {
  const baja = window.__baja
  const tw = await baja.Ord.make('station:|slot:/Twin').get(); await tw.loadSlots()
  let fd = 'yok'
  if (tw.has('FileDropTmp')) { const f = tw.get('FileDropTmp'); fd = 'VAR — path=' + f.get('path') + ' result=' + f.get('result') + ' data uzunluğu=' + String(f.get('data')).length }
  const idx = await (await fetch('/file/twin/index.html?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'})).text()
  const js = (idx.match(/assets\\/index-[\\w-]+\\.js/) || ['?'])[0]
  const head = async (u) => { const r = await fetch('/file/twin/' + u + '?x=' + Date.now(), {credentials:'same-origin', cache:'no-store'}); return r.status + ' ' + (await r.arrayBuffer()).byteLength }
  return 'FileDropTmp: ' + fd + '\\nindex.html → ' + js +
    '\\nmodels/ps-01.glb: ' + await head('models/ps-01.glb') + '\\nmodels/ps-01.part0.bin: ' + await head('models/ps-01.part0.bin') + '\\nassets/index-CV2qGtO1.js: ' + await head('assets/index-CV2qGtO1.js') +
    '\\nassets/index-DWz777XG.js: ' + await head('assets/index-DWz777XG.js')
})()`))
await p.close()
process.exit(0)
