/* SUW GEÇIRIJILER — Suw Hasaplaýjy Maglumatlary (gecirijiler.html)
 * Bir beket: suw göteriji beket → toplumlar (nasos toparlary) → esasy turbalar MT-1…MT-n (T-n = MT-n) →
 *   gövde sazlaýjylary, şahalar (MT-n/k) we olaryň sazlaýjylary, SAKA → beton akaba gatlalary. Howuz ýok.
 * Hasaplaýjylar maglumat binýadyndaky nokat adlaryndan özi tapylýar (ýazgy goşulanda sahypa özi görkezýär):
 *   MT1 esasy turba · MT2_1 şaha başy · MT1_S2 sazlaýjy · MT1_1_S3 şahanyň sazlaýjysy · Saka3 SAKA · BA3_G2 gatla;
 *   ahyry _Akym (akym) we _Toplam / _Jemi (totalizator). Böwetleýji gatlalaryň (B) hasaplaýjysy ýok.
 *   Ýyldyzly goşmaça şahalar (kartadaky MT-1/2*, MT-1/3**): MT1_2x / MT1_3xx (x = *), MT1_2* , MT1_2$2a (Niagara-nyň
 *   gaçyrylan *), MT1_3a/b/c (a = *, b = **, c = ***) ýa-da MT1_3_1/_2/_3; meselem MT1_3xx_S1 = MT-1/3** S-1.
 *   Içerde şaha nomeri 3.2 ýaly saklanýar (3 → MT-1/3, .2 → **); ene şahasy MT-1/3.
 * Atdan çykmaýanlar ulgam.json-da: SAKA → MT (saka_mt, saka_sub), at düzedişleri (atlar), gizlenýänler (gizle),
 *   turba boýunça tertip (turba_sira). Olary sahypanyň "Sazlamalar" bölüminden üýtgedip bolýar.
 * Toplum → MT beketiň konfigurasiýasyndan: stations.json → models/ps-0x-station.json (HDR-0n = MT-n, nasoslar
 *   HDR params.pumps / PMP header(s)). Okalmasa: 1-nji Maý, Magtymguly, Ýaşyldepe üçin içki nusga; ýogsa diňe MT boýunça.
 * Suw deňagramlylygy: MT başynyň sarp edilişi − turbada ölçenýän ähli çykyşlaryň jemi = ýitgi.
 * Sarp ediliş = totalizatoryň gün ahyryndaky bahalarynyň tapawudy. Soňky 62 gün ýerli wagt bilen sagatlyk
 * maglumatdan, ondan öňkisi gündelik jemlemeden. Häzirki akym: _Akym (soňky sagat), ýok bolsa
 * totalizatoryň soňky sagatdaky tapawudy.
 * Synag (Niagara-a degmeýär): gecirijiler.html?demo (1-nji Maý), ?demo&beket=PS-01 (Magtymguly), ?demo&beket=PS-05 (Ýaşyldepe)
 */
(function () {
'use strict'
const DEMO = /[?&]demo\b/.test(location.search)
const DEMO_BEKET = decodeURIComponent((location.search.match(/[?&]beket=([^&]+)/) || [])[1] || 'PS-04').toUpperCase()
const DAY = 86400000

/* ---------- BajaScript + TsOkuma ---------- */
let bajaP = null
function addScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok
    s.onerror = () => fail(new Error('Skript ýüklenmedi (' + src + ')')); document.head.appendChild(s) })
}
async function ensureCsrf() {
  if (document.getElementById('csrfToken')) return
  const html = await (await fetch('/ord?station:%7Cslot:/', { credentials: 'same-origin' })).text()
  const m = /id=['"]csrfToken['"][^>]*value=['"]([^'"]+)['"]/.exec(html)
  if (!m) return
  const i = document.createElement('input'); i.type = 'hidden'; i.id = 'csrfToken'; i.value = m[1]; document.body.appendChild(i)
}
function loadBaja() {
  bajaP = bajaP || (async () => {
    await ensureCsrf().catch(() => {})
    if (typeof window.require !== 'function') {
      await addScript('/requirejs/config.js')
      await addScript('/module/js/com/tridium/js/ext/require/require.min.js')
    }
    return new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error('BajaScript başlamady')), 60000)
      window.require(['baja!'], (b) => { clearTimeout(t); ok(b) }, (e) => { clearTimeout(t); fail(e) }) })
  })()
  return bajaP
}
let tsComp = null
async function ts(req) {
  if (DEMO) return demoTs(req)
  tsComp = tsComp || loadBaja().then((b) => b.Ord.make('station:|slot:/TsOkuma').get())
  const c = await tsComp
  const j = JSON.parse(String(await c.invoke({ slot: 'sorgu', value: req })))
  if (j && j.error) throw new Error(j.error)
  return j
}
/* synag: emeli maglumat gecirijiler-demo.js-den (Niagara-a degmeýär) */
let demoP = null
function demoTs(req) {
  demoP = demoP || addScript('gecirijiler-demo.js')
  return demoP.then(() => window.GecDemo.ts(req, { parseRoot, subLbl, beket: DEMO_BEKET, nusga: ULGAM_NUSGA }))
}
/** Köp ady bölekläp sorag (jogap uly bolmasyn) */
async function histMany(names, from, to, n, bolek) {
  const out = {}
  const parts = []
  for (let i = 0; i < names.length; i += bolek) parts.push(names.slice(i, i + bolek))
  await Promise.all(parts.map(async (p) => {
    const j = await ts('op=hist&names=' + encodeURIComponent(p.join(',')) + '&from=' + Math.round(from) + '&to=' + Math.round(to) + '&n=' + n)
    Object.assign(out, (j && j.data) || {})
  }))
  return out
}
/** JSON faýl: ýok ýa-da JSON däl bolsa null (dev serweri ýok faýla index.html berýär) */
async function jsonAl(url) {
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return null
    return JSON.parse(await r.text())
  } catch (e) { return null }
}

/* ---------- ulgam.json: içki nusga (faýl okalmasa — dev serweri, synag) — common/ulgam.json bilen deň ---------- */
const ULGAM_NUSGA = {
  _aciklama: ['SUW GEÇIRIJILER sahypasynyň (gecirijiler.html) sazlamalary. Faýl okalmady: sahypanyň içki nusgasy.'],
  BIRINJI_MAY: {
    ad: '1-nji Maý suw göteriji bekedi', beket: 'PS-04', taslama_q: 3.4, yitgi_cak: 5,
    saka_mt: { 1: 1, 2: 1, 3: 2, 4: 2 }, saka_sub: { 3: 5 }, bowet: { 1: 3, 2: 4, 3: 3, 4: 5 },
    atlar: {}, gizle: [],
    turba_sira: {
      1: ['saz:1', 'saz:2', 'saz:3', 'saz:4', 'sub:1', 'saz:5', 'saz:6', 'saz:7', 'saka:1', 'saka:2'],
      2: ['saz:1', 'saz:2', 'sub:1', 'sub:2', 'saz:3', 'sub:3', 'sub:4', 'saz:4', 'saz:5', 'sub:5', 'saz:6', 'saka:4'],
    },
  },
  MAGTYMGULY: {
    ad: 'Magtymguly suw göteriji bekedi', beket: 'PS-01', taslama_q: 3.2, yitgi_cak: 5,
    saka_mt: { 1: 1, 2: 1, 3: 2, 4: 2 }, saka_sub: { 1: 1, 3: 1 }, bowet: { 1: 6, 2: 11, 3: 11, 4: 7 },
    atlar: {}, gizle: [],
    turba_sira: {
      1: ['saz:1', 'saz:2', 'saz:3', 'saz:4', 'saz:5', 'sub:1', 'sub:4', 'sub:2', 'sub:2*', 'saz:6', 'saz:7', 'sub:3', 'saka:2'],
      2: ['saz:1', 'saz:2', 'sub:1', 'saz:3', 'saz:4', 'saz:5', 'saz:6', 'saz:7', 'saz:8', 'saka:4'],
    },
  },
  YASYLDEPE: {
    ad: 'Ýaşyldepe suw göteriji bekedi', beket: 'PS-05', taslama_q: 1.7, yitgi_cak: 5,
    saka_mt: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }, saka_sub: { 2: 2 }, bowet: { 1: 4, 2: 5, 3: 8, 4: 12, 5: 11, 6: 6, 7: 9 },
    atlar: {}, gizle: [],
    turba_sira: {
      1: ['saka:1', 'sub:1', 'saz:1', 'sub:2', 'saz:2', 'saz:3', 'saz:4', 'saka:3', 'saka:4', 'sub:3', 'sub:3*', 'sub:3**', 'sub:3***', 'saka:5', 'saka:6', 'saka:7'],
    },
  },
}
const BEKET_AT = { BIRINJI_MAY: 'PS-04', MAGTYMGULY: 'PS-01', YASYLDEPE: 'PS-05' }   // Niagara beketi → beket
/* beketiň konfigurasiýasy okalmasa (stations/ps-0x.json bilen deň):
   1-nji Maý PS-04: Toplum 1 = N-1…N-3 → HDR-02 (T-2); Toplum 2 = N-4…N-10 umumy kollektor → HDR-01, HDR-03, HDR-04
   Magtymguly PS-01: Toplum 1 = N-1…N-3 → HDR-01 (T-1); Toplum 2 = N-4…N-6 → HDR-02 (T-2)
   Ýaşyldepe PS-05: Toplum 1 = N-1…N-3 → HDR-01 (T-1) */
const BEKET_NUSGA = {
  'PS-04': { id: 'PS-04', ad: '1-nji Maý suw göteriji bekedi', cesme: 'içki nusga', toplumlar: [
    { n: 1, pumps: ['N-1', 'N-2', 'N-3'], mts: [2], turba: { 2: 'T-2' } },
    { n: 2, pumps: ['N-4', 'N-5', 'N-6', 'N-7', 'N-8', 'N-9', 'N-10'], mts: [1, 3, 4], turba: { 1: 'T-1', 3: 'T-3', 4: 'T-4' } }] },
  'PS-01': { id: 'PS-01', ad: 'Magtymguly suw göteriji bekedi', cesme: 'içki nusga', toplumlar: [
    { n: 1, pumps: ['N-1', 'N-2', 'N-3'], mts: [1], turba: { 1: 'T-1' } },
    { n: 2, pumps: ['N-4', 'N-5', 'N-6'], mts: [2], turba: { 2: 'T-2' } }] },
  'PS-05': { id: 'PS-05', ad: 'Ýaşyldepe suw göteriji bekedi', cesme: 'içki nusga', toplumlar: [
    { n: 1, pumps: ['N-1', 'N-2', 'N-3'], mts: [1], turba: { 1: 'T-1' } }] },
}

/* ---------- sazlamalary okamak / ýazmak ---------- */
const AYAR = { station: '', doc: null }            // yukle() doldurýar
const ayarAcar = (st) => 'gecirijiler.ulgam.' + st
function ayarOka(st) { try { const s = localStorage.getItem(ayarAcar(st)); return s ? JSON.parse(s) : null } catch (e) { return null } }
/** Sazlamalary ýazmak — ýeke ýer (soňra beketiň faýlyna göni ýazmak bilen çalşylar).
 *  cfg: bu beketiň ulgam.json bölegi. Synag: brauzeriň ýady; Niagara: faýlyň täze tekstini görkezýär. */
async function ayarYaz(cfg) {
  if (DEMO) {
    try { localStorage.setItem(ayarAcar(AYAR.station), JSON.stringify(cfg)) } catch (e) { return { ok: false, msg: 'Ýatda saklanmady: ' + e.message } }
    return { ok: true, reload: true, msg: 'Ýatda saklandy (synag: brauzeriň ýadynda). Sahypa täzeden ýüklenýär…' }
  }
  const doc = Object.assign({}, AYAR.doc || {}, { [AYAR.station]: cfg })
  ayarPenjire(JSON.stringify(doc, null, 1))
  return { ok: true, reload: false }
}
function ayarPenjire(text) {
  const old = document.getElementById('dlg'); if (old) old.remove()
  const d = document.createElement('div'); d.id = 'dlg'; d.className = 'dlg'
  d.innerHTML = `<div class="dlgbox" role="dialog" aria-modal="true" aria-labelledby="dlgT">
    <div class="ph"><h2 id="dlgT">ulgam.json — täze mazmuny</h2><button class="btn" data-x="1">Ýap</button></div>
    <div class="pb"><div class="dlgtx">Niagara-da faýla göni ýazmak entek ýok. <b>Workbench: Files → twin → ulgam.json</b> faýlyny açyň,
      içindäkini aşakdaky tekst bilen çalşyň we ýatda saklaň (Ctrl+S). Soňra bu sahypany täzeden ýükläň.</div>
      <textarea readonly spellcheck="false"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn pri" data-c="1">Göçür</button><button class="btn" data-x="1">Ýap</button></div></div></div>`
  d.querySelector('textarea').value = text
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.dataset.x) d.remove()
    if (e.target.dataset.c) { const ta = d.querySelector('textarea'); ta.select()
      try { navigator.clipboard.writeText(ta.value) } catch (_) { document.execCommand('copy') }
      e.target.textContent = 'Göçürildi'; setTimeout(() => { e.target.textContent = 'Göçür' }, 1500) }
  })
  document.body.appendChild(d)
}

/* ---------- nokat adyndan hasaplaýjy ---------- */
/* şaha nomeri: 3 → MT-n/3; 3.1 / 3.2 / 3.3 → MT-n/3* / 3** / 3*** (kartadaky ýyldyzly goşmaça şahalar) */
const AST = '((?:\\*|\\$2a|x){1,3}|[a-c])?'
const astSay = (t) => (!t ? 0 : /^[a-c]$/i.test(t) ? t.toLowerCase().charCodeAt(0) - 96 : t.replace(/\$2a/gi, '*').length)
const subKod = (n, t) => +n + astSay(t) / 10
function subLbl(b) { b = +b || 0; const i = Math.floor(b); return i + '*'.repeat(Math.round((b - i) * 10)) }
function subNorm(v) {            // 3, "3", "3**", "3xx" → 3 / 3.2
  if (typeof v === 'number') return v
  const m = String(v == null ? '' : v).trim().match(new RegExp('^(\\d+)' + AST + '$', 'i'))
  return m ? subKod(m[1], m[2]) : 0
}
const subKokda = (sub) => { const i = Math.floor(sub); return '_' + i + 'x'.repeat(Math.round((sub - i) * 10)) }
/** kanonik kök (maglumat binýadyndaky görnüşde): MT1, MT2_1, MT1_S2, MT1_1_S3, MT1_3xx_S1, Saka3, BA3_G2 */
function kokAt(tip, mt, sub, no, ba) {
  if (tip === 'ana') return 'MT' + mt + (sub ? subKokda(sub) : '')
  if (tip === 'sazlayjy') return 'MT' + mt + (sub ? subKokda(sub) : '') + '_S' + no
  if (tip === 'saka') return 'Saka' + no
  if (tip === 'gatla') return 'BA' + ba + '_G' + no
  return ''
}
function parseRoot(root, U) {
  const k = String(root).replace(/_new$/i, '')
  let x
  const sakaMt = (a) => +((U.saka_mt || {})[a] || 0)
  const sakaSub = (a) => subNorm((U.saka_sub || {})[a] || 0)
  const o = (tip, mt, sub, saz, saka, gatla, ad) => ({ tip, mt, sub, saz, saka, gatla, ad,
    kok: kokAt(tip, mt, sub, tip === 'saka' ? saka : tip === 'gatla' ? gatla : saz, saka) })
  if ((x = k.match(/^MT(\d+)$/i))) return o('ana', +x[1], 0, 0, 0, 0, 'MT-' + x[1])
  const sb = (n, t) => subKod(n, t)
  if ((x = k.match(new RegExp('^MT(\\d+)_(\\d+)' + AST + '$', 'i')))) return o('ana', +x[1], sb(x[2], x[3]), 0, 0, 0, 'MT-' + x[1] + '/' + subLbl(sb(x[2], x[3])))
  if ((x = k.match(/^MT(\d+)_(\d+)_([1-3])$/i))) return o('ana', +x[1], +x[2] + x[3] / 10, 0, 0, 0, 'MT-' + x[1] + '/' + subLbl(+x[2] + x[3] / 10))
  if ((x = k.match(/^MT(\d+)_S(\d+)$/i))) return o('sazlayjy', +x[1], 0, +x[2], 0, 0, 'MT-' + x[1] + ' S-' + x[2])
  if ((x = k.match(new RegExp('^MT(\\d+)_(\\d+)' + AST + '_S(\\d+)$', 'i')))) return o('sazlayjy', +x[1], sb(x[2], x[3]), +x[4], 0, 0, 'MT-' + x[1] + '/' + subLbl(sb(x[2], x[3])) + ' S-' + x[4])
  if ((x = k.match(/^MT(\d+)_(\d+)_([1-3])_S(\d+)$/i))) return o('sazlayjy', +x[1], +x[2] + x[3] / 10, +x[4], 0, 0, 'MT-' + x[1] + '/' + subLbl(+x[2] + x[3] / 10) + ' S-' + x[4])
  if ((x = k.match(/^Saka_?(\d+)$/i))) return o('saka', sakaMt(+x[1]), sakaSub(+x[1]), 0, +x[1], 0, 'SAKA-' + x[1])
  if ((x = k.match(/^BA_?(\d+)_G(\d+)$/i))) return o('gatla', sakaMt(+x[1]), 0, 0, +x[1], +x[2], 'BA-' + x[1] + ' G-' + x[2])
  return null
}
const flowK = (u) => { u = String(u || '').toLowerCase().replace(/\s/g, '')
  if (/^l\/s/.test(u)) return 3.6
  if (/^m(3|³)\/s/.test(u)) return 3600
  if (/^l\/(h|sag)/.test(u)) return 0.001
  if (/^l\/min/.test(u)) return 0.06
  return 1 }                                    // m³/h, m³/sag ýa-da birimsiz
const totK = (u) => (/^l$|litre|liter/i.test(String(u || '').trim()) ? 0.001 : 1)
const SUF = /^(.+)_(Akym|Toplam|Jemi)$/
const OLC = { Akym: 'akym', Toplam: 'jemi', Jemi: 'jemi' }
const birlikAkym = (u) => /\/(s|h|hr|sag|min|sek)\b|\/s$|\/h$/i.test(String(u || ''))
const birlikHasap = (u) => birlikAkym(u) || /^\s*(m(3|³)|l|litre|liter)\s*$/i.test(String(u || ''))

/** Her nokadyň tanalyşy. cls: hasaplayjy · tanalmadyk · gosmaca (hasaplaýjynyň goşmaça nokady: rssi, Status) ·
 *  beyleki (hasaplaýjy däl) · gizlenen. kok = sazlama açary (goşulmaly kök ýa-da goşulmasyz nokadyň öz ady). */
function nokatlar(pts, U) {
  const atlar = U.atlar || {}, gizle = new Set((U.gizle || []).map(String))
  return pts.map((p) => {
    const ad = String(p[0])
    const n = { ad, birlik: p[3] || '', grp: p[2] || '', cls: 'beyleki', olcum: null, kok: ad, kanon: null, s: null, src: 'ad', not: '', yeke: !SUF.test(ad) }
    const kn = atlar[ad] != null ? String(atlar[ad]) : null       // nokadyň özi üçin at düzedişi
    const m = (kn || ad).match(SUF)
    if (kn != null) n.src = 'sazlama'
    if (m) {
      n.olcum = OLC[m[2]]
      if (kn != null) n.kanon = m[1]
      else { n.kok = m[1]; n.kanon = atlar[m[1]] != null ? (n.src = 'sazlama', String(atlar[m[1]])) : m[1] }
    } else if (kn != null) { n.kanon = kn; n.olcum = birlikAkym(n.birlik) ? 'akym' : 'jemi' }
    if (gizle.has(ad) || gizle.has(n.kok)) { n.cls = 'gizlenen'; n.s = n.kanon ? parseRoot(n.kanon, U) : null; return n }
    if (n.kanon != null) {
      n.s = parseRoot(n.kanon, U)
      if (n.s) n.cls = 'hasaplayjy'
      else { n.cls = 'tanalmadyk'; n.not = n.src === 'sazlama' ? 'Sazlamadaky at düzgüne gabat gelmeýär' : 'Ady düzgüne gabat gelmeýär' }
      return n
    }
    const g = ad.match(/^(.+?)_(rssi|status|signal|batt\w*|err\w*|alarm\w*)$/i)
    const gs = g && parseRoot(atlar[g[1]] != null ? String(atlar[g[1]]) : g[1], U)
    if (gs) { n.cls = 'gosmaca'; n.s = gs; n.not = g[2]; return n }
    if (birlikHasap(n.birlik)) { n.cls = 'tanalmadyk'; n.not = 'Akym / göwrüm birligi bar, ady düzgüne gabat gelmeýär'; n.olcum = birlikAkym(n.birlik) ? 'akym' : 'jemi' }
    return n
  })
}

/* ---------- beketiň düzümi: toplum → MT (beketiň konfigurasiýasyndan) ---------- */
function beketDuz(conf, U) {
  const eq = conf.equipment || []
  const num = (s) => +((String(s).match(/(\d+)\s*$/) || [])[1] || 0)
  const hdr = eq.filter((e) => e.type === 'header').sort((a, b) => num(a.id) - num(b.id))
  if (!hdr.length) return null
  const pmp = eq.filter((e) => /^pump/.test(e.type))
  const pAd = {}
  for (const p of pmp) { const x = String(p.label || '').match(/N-?\s*(\d+)/i); pAd[p.id] = x ? 'N-' + x[1] : p.id }
  const ps = {}                                   // turba → nasoslar
  for (const h of hdr) ps[h.id] = new Set((h.params && h.params.pumps) || [])
  for (const p of pmp) for (const h of [p.header, ...(p.headers || [])]) if (h && ps[h]) ps[h].add(p.id)
  // toplum: umumy nasosy bolan turbalar bir toplum (umumy kollektor); nomeri nasoslardan: N-1 bar topar = Toplum 1
  let tops = hdr.map((h) => ({ pumps: new Set(ps[h.id]), hdr: [h] }))
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    if ([...tops[j].pumps].some((p) => tops[i].pumps.has(p))) {
      tops[j].pumps.forEach((p) => tops[i].pumps.add(p)); tops[i].hdr.push(...tops[j].hdr); tops.splice(j, 1); j = i
    }
  }
  tops = tops.map((t) => ({
    pumps: [...t.pumps].map((p) => pAd[p] || p).sort((a, b) => num(a) - num(b)),
    mts: t.hdr.map((h) => num(h.id)).sort((a, b) => a - b),
    turba: Object.fromEntries(t.hdr.map((h) => [num(h.id), (String(h.label || '').match(/T-\d+/) || [])[0] || 'T-' + num(h.id)])),
  })).sort((a, b) => (num(a.pumps[0]) || 1e9) - (num(b.pumps[0]) || 1e9)).map((t, i) => Object.assign(t, { n: i + 1 }))
  return { id: conf.station_id, ad: U.ad || conf.name || conf.station_id, cesme: 'konfigurasiýa', toplumlar: tops }
}
async function beketAl(U, station) {
  try {
    const doc = await jsonAl('stations.json')                       // Niagara: file:^twin/stations.json
    let conf = null
    if (doc && Array.isArray(doc.stations)) {
      const e = doc.stations.find((s) => s.id === U.beket) ||
        ((doc.niagara_station === station || doc.stations.length === 1) ? doc.stations.find((s) => s.id === doc.default) || doc.stations[0] : null)
      if (e && e.config) conf = await jsonAl(e.config)
    }
    if (!conf && DEMO && U.beket) conf = await jsonAl('/api/station/' + encodeURIComponent(U.beket))   // dev serweri
    if (conf && conf.equipment) { const b = beketDuz(conf, U); if (b) return b }
  } catch (e) { /* konfigurasiýa ýok: aşakda */ }
  const n = BEKET_NUSGA[U.beket || BEKET_AT[station]]
  return n ? Object.assign({}, n, { ad: U.ad || n.ad }) : null
}

/** ýerli gün başy (ms) */
const gunBasy = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

async function yukle() {
  const info = await ts('op=info')
  const station = (info && info.station) || ''
  const fayl = await jsonAl('ulgam.json')
  const UD = fayl && typeof fayl === 'object' && !Array.isArray(fayl) ? fayl : JSON.parse(JSON.stringify(ULGAM_NUSGA))
  let cfg = UD[station] || {}                 // bu beket ulgam.json-da ýok: diňe atlardan
  const saklanan = DEMO ? ayarOka(station) : null
  if (saklanan) cfg = saklanan                // synag: Sazlamalarda ýatda saklanan
  AYAR.station = station; AYAR.doc = UD
  const [pj, BEKET] = await Promise.all([ts('op=points'), beketAl(cfg, station)])
  const pts = (pj && pj.points) || []
  const unit = {}
  for (const p of pts) unit[p[0]] = p[3]
  const NOK = nokatlar(pts, cfg)
  // hasaplaýjylar: kanonik kök → {akym, toplam}
  const byKey = {}
  const METERS = []
  for (const n of NOK) {
    if (n.cls !== 'hasaplayjy') continue
    const key = n.s.kok.toUpperCase()
    let m = byKey[key]
    if (!m) { m = byKey[key] = Object.assign({}, n.s, { fid: n.kok, akym: null, toplam: null, yok: false }); METERS.push(m) }
    const slot = n.olcum === 'akym' ? 'akym' : 'toplam'
    if (m[slot]) { n.cls = 'tanalmadyk'; n.not = 'Gaýtalanýar: ' + m.ad + ' üçin ' + m[slot] + ' eýýäm bar'; continue }
    m[slot] = n.ad
  }
  for (const m of METERS) m.yok = !m.toplam
  const gizle = new Set((cfg.gizle || []).map((x) => String(x).toUpperCase()))
  const ekle = (r) => {                        // bolmaly, emma maglumat binýadynda ýok
    const s = parseRoot(r, cfg)
    if (!s || byKey[s.kok.toUpperCase()] || gizle.has(String(r).toUpperCase())) return
    const m = Object.assign({}, s, { fid: r, akym: null, toplam: null, yok: true }); byKey[s.kok.toUpperCase()] = m; METERS.push(m)
  }
  for (const g of cfg.garasylyan || []) ekle(String(g))
  for (const m of METERS.slice()) if (m.tip === 'gatla') ekle('Saka' + m.saka)     // gatlasy bar, SAKA hasaplaýjysy ýok
  // tertip: MT, ana, sazlaýjy (gövde, soň şahalar), SAKA, gatla
  const tipS = { ana: 0, sazlayjy: 1, saka: 2, gatla: 3 }
  METERS.sort((a, b) => (a.mt || 99) - (b.mt || 99) || (a.tip === 'gatla') - (b.tip === 'gatla') || (a.tip === 'saka') - (b.tip === 'saka') ||
    a.saka - b.saka || a.sub - b.sub || tipS[a.tip] - tipS[b.tip] || a.saz - b.saz || a.gatla - b.gatla)

  // ---- maglumat ----
  const now = Date.now()
  const today0 = gunBasy(now)
  const totNames = METERS.filter((m) => m.toplam).map((m) => m.toplam)
  const akNames = METERS.filter((m) => m.akym).map((m) => m.akym)
  const DAYS_MAX = 1095
  const fromD = today0 - (DAYS_MAX - 1) * DAY
  const [gun, sag, ak, akGun] = await Promise.all([
    histMany(totNames, fromD, now, DAYS_MAX, 20),                       // gündelik (UTC kovasy) maks
    histMany(totNames, today0 - 61 * DAY, now, 62 * 24, 12),             // sagatlyk (soňky 62 gün)
    histMany(akNames, now - 6 * 3600000, now, 6, 60),                   // soňky sagatlar, akym
    histMany(akNames, today0 - 61 * DAY, now, 62, 30),                  // gündelik akym min/maks (soňky 62 gün)
  ])
  // başlangyç: iň irki maglumat güni
  let first = today0
  for (const n of totNames) { const a = gun[n]; if (a && a.length) first = Math.min(first, gunBasy(a[0][0] * 1000)) }
  first = Math.min(first, today0 - 34 * DAY)          // grafikler üçin azyndan 35 gün (30 günlük deňagramlylyk)
  const START = new Date(first), DAYS = Math.round((today0 - first) / DAY) + 1
  const idx = (tMs) => Math.round((gunBasy(tMs) - first) / DAY)
  let son = 0
  for (const m of METERS) {
    m.d = new Float32Array(DAYS); m.flags = []; m.cum = new Float64Array(DAYS + 1); m.q = 0; m.qOk = false
    m.amn = new Float32Array(DAYS).fill(NaN); m.amx = new Float32Array(DAYS).fill(NaN); m.son = 0
    // maglumaty ýok hasaplaýjy: NaN → jemleri "—" bolýar (ýalňyş san görkezmez)
    if (!m.toplam) { m.flags.push('veri'); m.d.fill(NaN); m.cum.fill(NaN); m.q = NaN; continue }
    const k = totK(unit[m.toplam])
    const end = new Float64Array(DAYS).fill(NaN)       // gün ahyryndaky totalizator
    for (const [t, , , mx] of gun[m.toplam] || []) { const i = Math.round((Math.floor(t / 86400) * 86400 * 1000 - first) / DAY); if (i >= 0 && i < DAYS && mx != null) end[i] = Math.max(isNaN(end[i]) ? -Infinity : end[i], mx * k) }
    const hs = sag[m.toplam] || []
    const loc = new Float64Array(DAYS).fill(NaN)
    for (const [t, , , mx] of hs) { const i = idx(t * 1000); if (i >= 0 && i < DAYS && mx != null) loc[i] = Math.max(isNaN(loc[i]) ? -Infinity : loc[i], mx * k); m.son = Math.max(m.son, t * 1000) }
    for (let i = 0; i < DAYS; i++) if (!isNaN(loc[i])) end[i] = loc[i]
    // başlangyç bahasy: ilkinji maglumatly günüň minimumy
    let prev = NaN, firstI = -1
    for (let i = 0; i < DAYS; i++) if (!isNaN(end[i])) { firstI = i; break }
    if (firstI >= 0) {
      const g0 = (sag[m.toplam] || []).concat(gun[m.toplam] || []).filter((r) => idx(r[0] * 1000) === firstI).map((r) => r[2] * k)
      prev = g0.length ? Math.min(...g0) : end[firstI]
    }
    m.cum[0] = isNaN(prev) ? 0 : prev
    let gap = false
    for (let i = 0; i < DAYS; i++) {
      if (isNaN(end[i]) || isNaN(prev)) { m.d[i] = 0; m.cum[i + 1] = m.cum[i]; if (i >= firstI && firstI >= 0 && i > DAYS - 8) gap = true; continue }
      let v = end[i] - prev
      if (v < 0) { if (i > DAYS - 31) m.flags.push('neg'); v = 0 }
      m.d[i] = v; m.cum[i + 1] = end[i]; prev = end[i]
    }
    if (gap || !m.son || now - m.son > 26 * 3600000) m.flags.push('veri')
    // duýdansyz artyş: düýnki sarp ediliş soňky 7 günüň ortaça 2.5 essesinden köp
    const last7 = Array.from(m.d.slice(Math.max(0, DAYS - 9), DAYS - 2)).filter((v) => v > 0)
    const avg = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : 0
    if (avg > 0 && m.d[DAYS - 2] > avg * 2.5) m.flags.push('art')
    son = Math.max(son, m.son)
    // häzirki akym
    if (m.akym && ak[m.akym] && ak[m.akym].length) {
      const r = ak[m.akym][ak[m.akym].length - 1]
      m.q = (r[1] || 0) * flowK(unit[m.akym]); m.qOk = true
    } else if (hs.length >= 2 && now - hs[hs.length - 1][0] * 1000 < 3 * 3600000) {   // köne ýazgydan 'häzirki' akym ýok
      const a = hs[hs.length - 2], b = hs[hs.length - 1]
      const dt = (b[0] - a[0]) / 3600
      if (dt > 0 && b[3] >= a[3]) { m.q = (b[3] - a[3]) * k / dt; m.qOk = true }
    }
    if (m.akym) for (const [t, , mn, mx] of akGun[m.akym] || []) { const i = Math.round((Math.floor(t / 86400) * 86400 * 1000 - first) / DAY); if (i >= 0 && i < DAYS) { m.amn[i] = mn * flowK(unit[m.akym]); m.amx[i] = mx * flowK(unit[m.akym]) } }
    if (m.flags.includes('veri') && !m.qOk) m.q = 0
  }
  return { METERS, START, DAYS, cfg, station, son, NOK, pts, BEKET, UD, fayl: !!fayl, saklanan: !!saklanan,
    tanalmadyk: NOK.filter((n) => n.cls === 'tanalmadyk') }
}

/* ---------- başla ---------- */
const view = document.getElementById('view')
view.innerHTML = '<div class="ok-box"><div class="ring">⟳</div>Maglumat binýadyndan okalýar…</div>'
yukle().then((r) => uygula(r)).catch((e) => {
  console.error(e)
  view.innerHTML = '<div class="ok-box" style="color:#ff8b8f">Maglumat okalmady: ' + String(e && e.message || e) +
    '<br><span style="color:var(--tx3)">Sahypa Niagara-dan (localhost) açylmalydyr; TsOkuma hyzmaty gurnalmaly. Synag: gecirijiler.html?demo</span></div>'
})
// 15 minutda bir täzele (hasabat we sazlama sahypalaryndan başga)
setInterval(() => { if (!/^#(rapor|ayar)/.test(location.hash) && document.visibilityState === 'visible') location.reload() }, 15 * 60000)

function uygula(VERI) {
const { METERS, START, DAYS, cfg: U, BEKET, station } = VERI
const TODAY = new Date(START.getTime() + (DAYS - 1) * DAY)
const LOGO="gecirijiler-logo.png";
const BEKET_AD=(BEKET&&BEKET.ad)||U.ad||station||"Suw göteriji beket";
const CAK=+U.yitgi_cak||5;                     // turba ýitgisiniň kabul çägi, %

/* ================= veri modeli ================= */
const LAST=DAYS-1;
const MONS=["Ýan","Few","Mart","Apr","Maý","Iýun","Iýul","Awg","Sen","Okt","Noý","Dek"];
const nf=(v,d=0)=>(v!=null&&Number.isNaN(+v))?"—":(v||0).toLocaleString("tr-TR",{minimumFractionDigits:d,maximumFractionDigits:d});
const dd=i=>new Date(START.getTime()+i*86400000);
const isoD=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const nfc=v=>Number.isNaN(+v)?"—":Math.abs(v)>=1e6?nf(v/1e6,2)+"M":Math.abs(v)>=1e4?nf(v/1e3,0)+"K":nf(v);
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
const byMT=m=>METERS.filter(x=>x.mt===m);
const MTS=[...new Set(METERS.map(m=>m.mt).filter(Boolean))].sort((a,b)=>a-b);
METERS.forEach((m,i)=>{m.i=i});

const sumR=(l,a,b)=>{let s=0;for(const m of l)for(let d=Math.max(0,a);d<=Math.min(LAST,b);d++)s+=m.d[d];return s};
const mS=(o=0)=>{const t=dd(LAST);return Math.round((new Date(t.getFullYear(),t.getMonth()+o,1)-START)/86400000)};
const yS=(o=0)=>Math.max(0,Math.round((new Date(dd(LAST).getFullYear()+o,0,1)-START)/86400000));
const q=l=>l.reduce((a,b)=>a+b.q,0);
const ok=l=>l.filter(m=>m&&!m.yok);           // totalizatory bar

/* düzüm: MT başy → gövde sazlaýjylary, şahalar (başy + sazlaýjylar + SAKA), SAKA → gatlalar */
const basy=(mt,sub=0)=>METERS.find(m=>m.tip==="ana"&&m.mt===mt&&m.sub===sub);
const HEADS=MTS.map(mt=>basy(mt)).filter(Boolean);
const SAKAS=METERS.filter(m=>m.tip==="saka").map(s=>Object.assign(s,{gs:METERS.filter(g=>g.tip==="gatla"&&g.saka===s.saka)}));
const govde=mt=>METERS.filter(m=>m.mt===mt&&m.sub===0&&m.tip==="sazlayjy");
const SUBS=mt=>[...new Set(METERS.filter(m=>m.mt===mt&&m.sub>0&&m.tip!=="gatla").map(m=>m.sub))].sort((a,b)=>a-b);
const subItems=(mt,b)=>METERS.filter(m=>m.mt===mt&&m.sub===b&&(m.tip==="sazlayjy"||m.tip==="saka"));
const tipAd=m=>m.tip==="ana"?(m.sub?"Şaha başy":"Esasy turba"):{sazlayjy:"Sazlaýjy",saka:"SAKA",gatla:"Gatla"}[m.tip]||m.tip;
const kisa=m=>m.tip==="sazlayjy"?"S-"+m.saz:m.tip==="saka"?"SAKA-"+m.saka:m.tip==="gatla"?"G-"+m.gatla:m.ad;
const subAd=(mt,b)=>"MT-"+mt+"/"+subLbl(b);
function yer(m){        // turbadaky ýeri: MT-2 › MT-2/5 › SAKA-3
  if(!m.mt)return "MT saýlanmadyk";
  const p=["MT-"+m.mt];
  if(m.sub)p.push(subAd(m.mt,m.sub));
  if(m.tip==="gatla"){const s=SAKAS.find(x=>x.saka===m.saka);if(s&&s.sub)p.push(subAd(s.mt,s.sub));p.push("SAKA-"+m.saka)}
  return p.join(" › ");
}
const yokAd=l=>l.filter(m=>m.yok).map(m=>m.ad).join(", ");
const CLR=["#39B6EE","#5CD07A","#A78BFA","#F0A03C","#F2635A","#5FD0FF","#E9C46A","#7FDBB6","#EF8FBB","#8AA9F0"];
const MTC=["#39B6EE","#E9C46A","#EF8FBB","#8AA9F0","#7FDBB6","#F2635A"];
const mtC=mt=>MTC[(mt-1)%MTC.length];

/* toplumlar (beketiň konfigurasiýasyndan); toplumy belli däl turbalar "BEKET" toparynda */
const TOPS=(()=>{
  const t=(BEKET?BEKET.toplumlar:[]).map(x=>Object.assign({},x,{mts:x.mts.filter(mt=>MTS.includes(mt))})).filter(x=>x.mts.length);
  const bos=MTS.filter(mt=>!t.some(x=>x.mts.includes(mt)));
  if(bos.length)t.push({n:0,pumps:[],mts:bos,turba:{}});
  return t;
})();
const topOf=mt=>TOPS.find(t=>t.mts.includes(mt));
const turbaAd=mt=>{const t=topOf(mt);return (t&&t.turba&&t.turba[mt])||""};
const mtBas=mt=>"MT-"+mt+(turbaAd(mt)?" · "+turbaAd(mt):"")+(topOf(mt)&&topOf(mt).n?" · Toplum "+topOf(mt).n:"");

/* ================= suw deňagramlylygy ================= */
/* turbada ölçenýän çykyşlar (gaýtalamazdan): gövde sazlaýjylary + SAKA (hasaplaýjysy ýok bolsa onuň gatlalary) +
   şaha: başy ölçenýän bolsa şahanyň başy, ýogsa şahanyň sazlaýjylary we SAKA-lary */
const sakaOlc=s=>!s.yok?[s]:s.gs;
/* şaha agajy: ýyldyzly goşmaça şaha (3.1, 3.2 …) ene şahasyndan (3) çykýar; ene şahasy ýok bolsa göni MT-den */
const subOwn=(mt,b)=>subItems(mt,b).flatMap(m=>m.tip==="saka"?sakaOlc(m):[m]);
const subKids=(mt,b)=>b%1?[]:SUBS(mt).filter(c=>c%1&&Math.floor(c)===b);
const topSubs=mt=>SUBS(mt).filter(b=>!(b%1)||!SUBS(mt).includes(Math.floor(b)));
const subOlc=(mt,b)=>{const h=basy(mt,b);return h&&!h.yok?[h]:[...subOwn(mt,b),...subKids(mt,b).flatMap(c=>subOlc(mt,c))]};
const subCyk=(mt,b)=>[...subOwn(mt,b),...subKids(mt,b).flatMap(c=>subOlc(mt,c))];     // şaha başynyň aşagyndaky ölçeg
function turbaCyk(mt){
  const o=[...govde(mt)];
  SAKAS.filter(s=>s.mt===mt&&s.sub===0).forEach(s=>o.push(...sakaOlc(s)));
  topSubs(mt).forEach(b=>o.push(...subOlc(mt,b)));
  return o;
}
function denge(gir,cyk,ad,href){
  const G=ok(gir),C=ok(cyk);
  const ara=(a,b)=>{const g=sumR(G,a,b),c=sumR(C,a,b);return{g,c,f:g-c,p:G.length&&g?(g-c)/g*100:NaN}};
  return {ad,href,gir,cyk,G,C,ara,bolmaz:!G.length,
    eksik:[...gir,...cyk].filter(m=>m.yok||m.flags.includes("veri")),
    d:ara(LAST,LAST),y:ara(LAST-1,LAST-1),y30:ara(LAST-30,LAST-1),qg:q(G),qc:q(C)};
}
const TRB={},SUBD={},SAKD={};
MTS.forEach(mt=>{
  const h=basy(mt);
  TRB[mt]=denge(h?[h]:[],turbaCyk(mt),"MT-"+mt,"#mt/"+mt);
  SUBS(mt).forEach(b=>{const hb=basy(mt,b);if(hb)SUBD[mt+"/"+b]=denge([hb],subCyk(mt,b),subAd(mt,b),"#mt/"+mt)});
});
SAKAS.forEach(s=>{if(s.gs.length)SAKD[s.saka]=denge([s],s.gs,"SAKA-"+s.saka,"#saka/SAKA-"+s.saka)});
const TURBALAR=MTS.map(mt=>TRB[mt]);
const BEK=denge(HEADS,MTS.flatMap(turbaCyk),"Beket","#denge");
const UNS=[...TURBALAR,...Object.values(SUBD)];              // üns berilýänler: esasy turbalar + başy ölçenýän şahalar
const dengeOf=m=>!m?null:m.tip==="ana"?(m.sub?SUBD[m.mt+"/"+m.sub]:TRB[m.mt]):m.tip==="saka"?SAKD[m.saka]:null;
const yGrade=p=>!Number.isFinite(p)?"n":p>2*CAK?"rd":p>CAK?"or":p<-CAK?"or":"ok";
const GC={ok:"#5CD07A",or:"#F0A03C",rd:"#F2635A",n:"#7D93A8"};
const yTag=p=>{const g=yGrade(p);return `<span class="tg ${{ok:"tg-ok",or:"tg-tr",rd:"tg-rd",n:"tg-n"}[g]}">${{ok:"KADALY",or:p<0?"ÖLÇEGI BARLA":"ÜNS BERIŇ",rd:"ÝITGI ÝOKARY",n:"MAGLUMAT ÝOK"}[g]}</span>`};
const dRows=(D,n)=>{const o=[];for(let d=LAST-n;d<=LAST-1;d++){const a=D.ara(d,d);o.push(Object.assign({t:dd(d),l:dd(d).getDate()+" "+MONS[dd(d).getMonth()]},a))}return o};

/* ================= grafik yardımcıları ================= */
const _f=v=>Number.isFinite(v)?v:0;

function chLine(data,{h=170,W=640,c="#39B6EE",lab=true,area=true,multi=null}={}){
  const ml=48,mr=10,mt=14,mb=lab?24:8,iw=W-ml-mr,ih=h-mt-mb;
  const sets=(multi||[{c,vals:data.map(d=>d.v)}]).map(s=>({...s,vals:s.vals.map(_f)}));
  const max=Math.max(...sets.flatMap(s=>s.vals),1)*1.18;
  let s=`<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto">`;
  for(let i=0;i<=3;i++){const y=mt+ih-ih*i/3;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-7}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${nfc(max*i/3)}</text>`}
  sets.forEach(st=>{
    const pts=st.vals.map((v,i)=>[ml+iw*i/(st.vals.length-1||1),mt+ih-ih*(v/max)]);
    const p=pts.map(a=>a[0].toFixed(1)+","+a[1].toFixed(1)).join(" ");
    if(area&&sets.length===1)s+=`<polygon points="${ml},${mt+ih} ${p} ${W-mr},${mt+ih}" fill="${st.c}" opacity=".14"/>`;
    s+=`<polyline points="${p}" fill="none" stroke="${st.c}" stroke-width="2"/>`;
    pts.forEach(a=>s+=`<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="2.6" fill="${st.c}"/>`);
  });
  if(lab)data.forEach((d,i)=>{const e=data.length>14?Math.ceil(data.length/8):data.length>8&&W<520?2:1;
    if(i%e===0)s+=`<text x="${ml+iw*i/(data.length-1||1)}" y="${h-7}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${d.s||d.l}</text>`});
  return s+"</svg>";
}
function chBar(data,{h=170,W=640,pairs=false,ca="#5CD07A",cb="#7D93A8"}={}){
  data=data.map(d=>({...d,v:_f(d.v),a:_f(d.a),b:_f(d.b)}));
  const ml=48,mr=10,mt=14,mb=24,iw=W-ml-mr,ih=h-mt-mb;
  const max=Math.max(...data.flatMap(d=>pairs?[d.a,d.b]:[d.v]),1)*1.15;
  const step=iw/data.length, bw=pairs?step*.30:step*.55;
  let s=`<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto">`;
  for(let i=0;i<=3;i++){const y=mt+ih-ih*i/3;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-7}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${nfc(max*i/3)}</text>`}
  data.forEach((d,i)=>{
    const x0=ml+step*i;
    if(pairs){
      [["a",ca,0],["b",cb,1]].forEach(([k,c,j])=>{
        const hh=ih*(d[k]/max);
        s+=`<rect x="${(x0+step/2-bw-2+j*(bw+4)).toFixed(1)}" y="${(mt+ih-hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.8,hh).toFixed(1)}" rx="1.5" fill="${c}"><title>${d.l}: ${nf(d[k])}</title></rect>`});
    }else{
      const hh=ih*(d.v/max);
      s+=`<rect x="${(x0+(step-bw)/2).toFixed(1)}" y="${(mt+ih-hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.8,hh).toFixed(1)}" rx="2" fill="${d.c||"#39B6EE"}"><title>${d.l}: ${nf(d.v)}</title></rect>`}
    const e=data.length>14?Math.ceil(data.length/12):data.length>8&&W<520?2:1;
    if(i%e===0)s+=`<text x="${(x0+step/2).toFixed(1)}" y="${h-7}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${d.s||d.l}</text>`});
  return s+"</svg>";
}
function chDonut(items,center,sub){
  items=items.map(i=>({...i,v:Math.max(0,_f(i.v))}));
  const R=62,r=40,C=90,tot=items.reduce((a,b)=>a+b.v,0)||1;
  let a0=-Math.PI/2,s=`<svg viewBox="0 0 180 180" style="width:100%;max-width:190px;height:auto">`;
  items.forEach(it=>{
    if(!it.v)return;
    const a1=a0+Math.min(it.v/tot,.9999)*2*Math.PI, big=a1-a0>Math.PI?1:0;
    const p=(rad,a)=>[C+rad*Math.cos(a),C+rad*Math.sin(a)];
    const[x1,y1]=p(R,a0),[x2,y2]=p(R,a1),[x3,y3]=p(r,a1),[x4,y4]=p(r,a0);
    s+=`<path d="M${x1} ${y1} A${R} ${R} 0 ${big} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${big} 0 ${x4} ${y4} Z" fill="${it.c}"><title>${it.l}: ${nf(it.v,1)}</title></path>`;
    a0=a1;
  });
  s+=`<text x="90" y="86" text-anchor="middle" fill="#9AABBC" font-size="9" font-family="ui-monospace,Consolas,monospace" letter-spacing="1">${sub||"JEMI"}</text>`;
  s+=`<text x="90" y="106" text-anchor="middle" fill="#E6EFF8" font-size="17" font-weight="600" font-family="ui-monospace,Consolas,monospace">${center}</text>`;
  return s+"</svg>";
}
function spark(vals,c="#5CD07A"){
  vals=Array.from(vals,v=>Math.max(0,_f(v)));
  const W=62,H=16,mx=Math.max(...vals,.001);
  const p=vals.map((v,i)=>(i*(W/(vals.length-1))).toFixed(1)+","+(H-H*.85*(v/mx)-1).toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:62px;height:16px"><polyline points="${p}" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`;
}
/* suw deňagramlylygy: giren (MT başy) we çykan (Σ çykyşlar) çyzyklary, aradaky zolak = ýitgi, aşakda gündelik ýitgi % */
function chHat(rows,{h=300,W=1180}={}){
  const n=rows.length;
  if(!n||!rows.some(r=>r.g>0))return `<div class="ok-box">Hasaplap bolmaýar: baş hasaplaýjynyň maglumaty ýok.</div>`;
  const ml=64,mr=16,mt=20,mb=62,iw=W-ml-mr,ih=h-mt-mb;
  const vals=rows.flatMap(r=>[r.g,r.c]).filter(v=>Number.isFinite(v)&&v>0);
  const max=Math.max(...vals,1)*1.08, min=Math.max(0,Math.min(...vals)*0.86);
  const Y=v=>mt+ih-ih*((_f(v)-min)/(max-min||1));
  const X=i=>ml+(n>1?iw*i/(n-1):iw/2);
  let s=`<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto">`;
  for(let i=0;i<=4;i++){const y=mt+ih-ih*i/4;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-8}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9.5">${nfc(min+(max-min)*i/4)}</text>`}
  s+=`<text x="16" y="${mt+ih/2}" fill="#9AABBC" font-size="9.5" transform="rotate(-90 16 ${mt+ih/2})" text-anchor="middle">m³</text>`;
  const pg=rows.map((r,i)=>X(i).toFixed(1)+","+Y(r.g).toFixed(1)).join(" ");
  const pc=rows.map((r,i)=>X(i).toFixed(1)+","+Y(r.c).toFixed(1)).join(" ");
  s+=`<polygon points="${pg} ${rows.map((_,i)=>X(n-1-i).toFixed(1)+","+Y(rows[n-1-i].c).toFixed(1)).join(" ")}" fill="#F0A03C" opacity=".22"/>`;
  s+=`<polyline points="${pc}" fill="none" stroke="#5CD07A" stroke-width="2.2"/>`;
  s+=`<polyline points="${pg}" fill="none" stroke="#39B6EE" stroke-width="2.2"/>`;
  rows.forEach((r,i)=>{
    const lb=r.t?r.t.getDate()+"."+(r.t.getMonth()+1):r.lbl;
    s+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(r.g).toFixed(1)}" r="2.5" fill="#39B6EE"><title>${lb} · giren ${nf(r.g)} m³</title></circle>`;
    s+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(r.c).toFixed(1)}" r="2.5" fill="#5CD07A"><title>${lb} · çykan ${nf(r.c)} m³</title></circle>`;
  });
  // aşaky zolak: gündelik ýitgi %
  const by=mt+ih+14, bh=24, mp=Math.max(2*CAK+1,...rows.map(r=>Math.abs(_f(r.p))));
  const yc=by+bh*(1-CAK/mp);
  s+=`<line x1="${ml}" y1="${yc.toFixed(1)}" x2="${W-mr}" y2="${yc.toFixed(1)}" stroke="#F0A03C" stroke-dasharray="3 4" opacity=".7"/>`;
  rows.forEach((r,i)=>{
    const w=Math.max(3,Math.min(26,iw/n-3)), x=X(i)-w/2, p=_f(r.p);
    const hh=Math.max(1.5,bh*(Math.abs(p)/mp));
    s+=`<rect x="${x.toFixed(1)}" y="${(by+bh-hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="${GC[yGrade(p)]==="#5CD07A"?"#3E6B57":GC[yGrade(p)]}"><title>ýitgi ${nf(r.f)} m³ (%${nf(p,1)})</title></rect>`;
    const e=Math.ceil(n/14);
    if(i%e===0)s+=`<text x="${X(i).toFixed(1)}" y="${h-7}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${r.t?r.t.getDate()+"."+(r.t.getMonth()+1):(/^\d\d\.\d\d\.\d{4}$/.test(r.lbl)?r.lbl.slice(0,5):r.lbl)}</text>`;
  });
  s+=`<text x="${ml-8}" y="${by+bh-2}" text-anchor="end" fill="#9AABBC" font-size="8.5">ýitgi %</text>`;
  s+=`<text x="${W-mr}" y="${(yc-3).toFixed(1)}" text-anchor="end" fill="#F0A03C" font-size="8" font-family="ui-monospace,Consolas,monospace">çäk %${nf(CAK,0)}</text>`;
  return s+"</svg>";
}

/* ================= seri ================= */
let PER="d";
function series(l,per=PER){
  const o=[];
  if(per==="d"){for(let d=LAST-13;d<=LAST;d++){const t=dd(d);o.push({l:t.getDate()+" "+MONS[t.getMonth()],s:t.getDate()+" "+MONS[t.getMonth()].slice(0,3),v:sumR(l,d,d),k:isoD(t)})}return o}
  if(per==="m"){const t=dd(LAST);for(let k=11;k>=0;k--){
    const a=new Date(t.getFullYear(),t.getMonth()-k,1),b=new Date(t.getFullYear(),t.getMonth()-k+1,0);
    const si=Math.max(0,Math.round((a-START)/86400000)),ei=Math.min(LAST,Math.round((b-START)/86400000));
    if(ei<0)continue;o.push({l:MONS[a.getMonth()]+" "+String(a.getFullYear()).slice(2),s:MONS[a.getMonth()],v:sumR(l,si,ei),k:a.getFullYear()+"-"+String(a.getMonth()+1).padStart(2,"0")})}
    return o}
  for(let y=Math.min(START.getFullYear(),dd(LAST).getFullYear()-2);y<=dd(LAST).getFullYear();y++){
    const si=Math.max(0,Math.round((new Date(y,0,1)-START)/86400000)),ei=Math.min(LAST,Math.round((new Date(y,11,31)-START)/86400000));
    if(ei>=si)o.push({l:String(y),s:String(y),v:sumR(l,si,ei),k:String(y)})}
  return o;
}
const YIL=dd(LAST).getFullYear();
function yoy(l){ // bu ýyl vs geçen ýyl aýlyk
  const o=[];for(let m=0;m<12;m++){
    const f=(y)=>{const a=Math.round((new Date(y,m,1)-START)/86400000),b=Math.round((new Date(y,m+1,0)-START)/86400000);
      return (b<0||a>LAST)?0:sumR(l,Math.max(0,a),Math.min(LAST,b))};
    o.push({l:MONS[m],s:MONS[m],a:f(YIL),b:f(YIL-1)})}
  return o;
}
const per3=l=>({d:sumR(l,LAST,LAST),y:sumR(l,LAST-1,LAST-1),m:sumR(l,mS(0),LAST),pm:sumR(l,mS(-1),mS(0)-1),
  yr:sumR(l,yS(0),LAST),py:sumR(l,yS(-1),yS(0)-1)});
const pct=(a,b)=>b?((a-b)/b*100):0;
const arrow=v=>`<span class="${v>=0?"up":"dn"}">${v>=0?"▲":"▼"} ${nf(Math.abs(v),2)} %</span>`;
const flagAd=f=>f==="veri"?"Maglumat ýok":f==="art"?"Duýdansyz artyş":"Otrisatel Δ";
const durum=m=>m.yok?'<span class="tg tg-n">Maglumat ýok</span>':m.flags.length?`<span class="tg tg-tr">${flagAd(m.flags[0])}</span>`:'<span class="tg tg-ok">Kadaly</span>';

/* ================= KPI ================= */
function kpi(ic,cl,lb,vl,un,sb){return `<div class="kpi">
  <span class="ico" style="background:${cl}22;color:${cl}">${ic}</span>
  <div style="min-width:0"><div class="lb">${lb}</div>
  <div class="vl">${vl} <small>${un||""}</small></div><div class="sb">${sb||""}</div></div></div>`}
const eksikPan=(D)=>D.eksik.length?`<div class="pan" style="border-color:#6B4A1F"><div class="pb" style="color:#F0C48A;font-size:12px">
  Maglumat ýok / gijikýär: <b>${D.eksik.map(m=>m.ad).join(", ")}</b> — deňagramlylyk doly däl.</div></div>`:"";

/* ================= SAYFALAR ================= */
const P={};

P.genel=()=>{
  const t=per3(ok(HEADS)), qT=q(ok(HEADS)), tq=+U.taslama_q||0;
  const err=METERS.filter(m=>m.flags.includes("veri")).length;
  const fl=UNS.filter(h=>yGrade(h.y30.p)!=="ok"&&yGrade(h.y30.p)!=="n");
  const g30=yGrade(BEK.y30.p);
  const per={d:"soňky 14 gün",m:"soňky 12 aý",y:"ýyllar"}[PER];
  return `
  <div class="h1row"><h1>Umumy Ulgam</h1><span class="crumb">${BEKET_AD} · ${MTS.length} esasy turba · ${METERS.length} hasaplaýjy</span></div>
  <div class="kpirow">
    ${kpi("◉","#39B6EE","Bekediň häzirki akymy",nf(qT,0),"m³/sag",`${nf(qT/3600,2)} m³/s${tq?` · taslama ${nf(tq,2)} m³/s (%${nf(qT/3600/tq*100,0)})`:""}`)}
    ${kpi("▤","#5CD07A","Şu günki sarp ediliş",nf(t.d),"m³",`Düýn: ${nf(t.y)} m³ &nbsp;${arrow(pct(t.d,t.y))}`)}
    ${kpi("▦","#A78BFA","Şu aýky sarp ediliş",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} m³ &nbsp;${arrow(pct(t.m,t.pm))}`)}
    ${kpi("▨","#F0A03C","Şu ýylky sarp ediliş",nf(t.yr),"m³",t.py?`Geçen ýyl: ${nf(t.py)} m³ &nbsp;${arrow(pct(t.yr,t.py))}`:"Geçen ýyl: maglumat ýok")}
    ${kpi("⚖",GC[g30],"Turba ýitgisi · 30 gün",nf(BEK.y30.p,1),"%",`${nf(BEK.y30.f)} m³ · ${fl.length?`<span class="${g30==="rd"?"dn":"wr"}">${fl.map(h=>h.ad).join(", ")}</span>`:"ähli turbalar kadaly"}`)}
    ${kpi("✓",err?"#F0A03C":"#5CD07A","Işleýän hasaplaýjy",(METERS.length-err)+" / "+METERS.length,"",err?`<span class="wr">${err} sanysynda maglumat ýok</span>`:"ählisi kadaly")}
  </div>

  <div class="pan"><div class="ph"><h2>Ulgamyň umumy shemasy</h2>
    <span class="crumb">Toplum → esasy turba (MT) → sazlaýjylar, şahalar, SAKA → beton akaba · häzirki akym · şu günki sarp ediliş</span></div>
    <div class="pb scroll">${schemaGenel()}</div></div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Esasy turbalar boýunça häzirki akym</h2><span class="crumb">${nf(qT,0)} m³/sag</span></div>
      <div class="pb" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        ${chDonut(HEADS.map(m=>({l:m.ad,v:m.q,c:mtC(m.mt)})),nf(qT,0),"m³/sag")}
        <div class="lgd">${HEADS.map(m=>`<span><i style="background:${mtC(m.mt)}"></i><a href="#mt/${m.mt}"><b>${m.ad}</b></a>
          <span style="color:var(--tx3)">${turbaAd(m.mt)}</span> <b class="mono">${nf(m.q,0)}</b> <span style="color:var(--tx3)">(%${nf(qT?m.q/qT*100:0,0)})</span></span>`).join("")}
        </div></div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Bekediň çykyşy (m³)</h2>
      <span class="crumb">${HEADS.map(m=>`<span style="color:${mtC(m.mt)}">■</span> ${m.ad}`).join(" ")} · ${per}</span></div>
      <div class="pb">${chLine(series(HEADS),{h:250,W:440,multi:HEADS.map(m=>({c:mtC(m.mt),vals:series([m]).map(x=>x.v)})),area:false})}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Suw deňagramlylygy · 30 gün</h2><a class="crumb" href="#denge">jikme-jik →</a></div>
      <div class="pb">${ranks()}
        <div class="crumb" style="margin-top:8px;line-height:1.6">Ýitgi = MT başynyň sarp edilişi − turbada ölçenýän çykyşlaryň jemi.
          Kabul çägi %${nf(CAK,0)}; %${nf(2*CAK,0)}-den köp bolsa esasy turba gyzyl bellenýär.</div></div></div>
  </div>

  <div class="pan"><div class="ph"><h2>Bekediň deňagramlylygy · gündelik</h2>
    <span class="crumb"><span style="color:#39B6EE">■</span> MT başlarynyň jemi &nbsp;<span style="color:#5CD07A">■</span> turbalarda ölçenen çykyşlar
      &nbsp;<span style="color:#F0A03C">■</span> ýitgi</span></div>
    <div class="pb">${chHat(dRows(BEK,30))}
      <div class="dfoot">
        <span>30 günde çykan <b class="mono" style="color:var(--cy)">${nf(BEK.y30.g)}</b> m³</span>
        <span>Ölçenen çykyşlar <b class="mono" style="color:var(--gr)">${nf(BEK.y30.c)}</b> m³</span>
        <span>Ýitgi <b class="mono" style="color:${GC[g30]}">${nf(BEK.y30.f)}</b> m³ (%${nf(BEK.y30.p,2)})</span>
        <span style="color:var(--tx3)">Gyzyl / mämişi sütün — şol gün ýitgi çäkden köp</span>
      </div></div></div>`;
};
function ranks(){
  const mx=Math.max(2*CAK+2,...TURBALAR.map(h=>_f(h.y30.p)));
  return TURBALAR.map(h=>{const p=h.y30.p,g=yGrade(p),mt=+h.ad.slice(3);
    return `<a class="rank" href="#mt/${mt}"><span class="n" style="background:${mtC(mt)};color:#0E1C2B">${mt}</span>
      <span style="width:46px;font-size:12px">${h.ad}</span>
      <span class="bar"><i style="width:${Math.max(1.5,Math.min(100,_f(p)/mx*100)).toFixed(1)}%;background:${GC[g]}"></i></span>
      <span class="v" style="color:${GC[g]}">${h.bolmaz?"—":"%"+nf(p,1)}</span>
      <span class="v" style="min-width:62px">${h.bolmaz?"":nf(h.y30.f)+" m³"}</span></a>`}).join("");
}

/* ---------- umumy shema: toplumlar → MT turbalary → çykyşlar → SAKA → deňagramlylyk ---------- */
function schemaGenel(){
  if(!MTS.length)return `<div class="ok-box">Esasy turba (MT) hasaplaýjysy tapylmady. Sazlamalar bölümine serediň.</div>`;
  const ROWS=TOPS.flatMap(t=>t.mts);              // setirler toplum boýunça: birleşdiriji turbalar kesişmesin
  const n=ROWS.length, RH=90, Y0=42, W=1310, H=Y0+n*RH+6;
  const F=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"${o.a?` text-anchor="${o.a}"`:""}${o.w?` font-weight="${o.w}"`:""}${o.m?' font-family="ui-monospace,Consolas,monospace"':""}${o.ls?` letter-spacing="${o.ls}"`:""}>${t}</text>`;
  const A=(x,y,c,z=4.5)=>`<path d="M${x} ${y-z} L${x+z*1.7} ${y} L${x} ${y+z} Z" fill="${c}"/>`;
  const yR=i=>Y0+i*RH+RH/2;
  const XB=18, BW=212, XM=292, MW=172, XD=XM+MW, XS=862, XE=1150, EW=144;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="min-width:1060px">`;
  s+=F(XB,18,BEKET_AD.toUpperCase(),{s:10.5,w:600,f:"#E6EFF8",ls:".5"});
  s+=F(XM,18,"ESASY TURBA (MT)",{s:9,f:"#7D93A8",ls:"1.2"});
  s+=F(XD+20,18,"SAZLAÝJYLAR · ŞAHALAR (turba boýunça tertipde)",{s:9,f:"#7D93A8",ls:"1.2"});
  s+=F(XS,18,"SAKA → BETON AKABA",{s:9,f:"#7D93A8",ls:"1.2"});
  s+=F(XE,18,"ÝITGI · 30 GÜN",{s:9,f:"#7D93A8",ls:"1.2"});
  s+=`<rect x="${XB-8}" y="${Y0-12}" width="${BW+16}" height="${n*RH+14}" rx="11" fill="none" stroke="#5E7E96" stroke-dasharray="4 4"/>`;
  /* toplumlar */
  TOPS.forEach(t=>{
    const rows=t.mts.map(mt=>ROWS.indexOf(mt)), i0=Math.min(...rows), i1=Math.max(...rows);
    const y=Y0+i0*RH+6, h=(i1-i0+1)*RH-12;
    const yc=rows.length%2?yR(rows[(rows.length-1)/2]):yR(i0)+RH/2*(rows.length-1);
    const xc=XB+BW-16, np=t.pumps.length, gap=np?Math.min(25,(xc-XB-34)/np):0, px0=XB+16;
    s+=`<rect x="${XB}" y="${y}" width="${BW}" height="${h}" rx="8" fill="#3D5262" stroke="#39B6EE" stroke-opacity=".5"/>`;
    s+=F(XB+12,y+17,t.n?"TOPLUM "+t.n:"BEKET",{s:10,w:600,f:"#E6EFF8",ls:"1"});
    s+=F(XB+BW-12,y+17,"Σ "+nf(q(ok(t.mts.map(mt=>basy(mt)).filter(Boolean))),0)+" m³/sag",{s:9.5,a:"end",f:"#5FD0FF",m:1});
    s+=`<line x1="${xc}" y1="${Math.min(yc,yR(i0))-4}" x2="${xc}" y2="${Math.max(yc,yR(i1))+4}" stroke="#39B6EE" stroke-width="6"/>`;
    if(np){
      s+=`<line x1="${px0}" y1="${yc}" x2="${xc}" y2="${yc}" stroke="#39B6EE" stroke-width="3"/>`;
      t.pumps.forEach((p,j)=>{const cx=px0+gap*j+gap/2;
        s+=`<circle cx="${cx.toFixed(1)}" cy="${yc}" r="8.5" fill="#394D5C" stroke="#39B6EE" stroke-width="1.5"/>`;
        s+=`<path d="M${(cx-3.5).toFixed(1)} ${yc-4.5} L${(cx+5).toFixed(1)} ${yc} L${(cx-3.5).toFixed(1)} ${yc+4.5} Z" fill="#39B6EE"/>`;
        s+=F(cx.toFixed(1),yc+21,p,{s:7.5,a:"middle",f:"#9AABBC",m:1})});
      if(h>RH)s+=F(XB+12,yc+40,np+" nasos · umumy kollektor → "+t.mts.map(mt=>t.turba[mt]||"MT-"+mt).join(", "),{s:8.5,f:"#9AABBC"});
    }else s+=F(XB+12,yc+4,"toplum maglumaty ýok",{s:9,f:"#9AABBC"});
    t.mts.forEach(mt=>{const y2=yR(ROWS.indexOf(mt));s+=`<line x1="${xc}" y1="${y2}" x2="${XB+BW}" y2="${y2}" stroke="#39B6EE" stroke-width="3"/>`});
  });
  /* esasy turbalar */
  ROWS.forEach((mt,i)=>{
    const y=yR(i), c=mtC(mt), h=basy(mt), D=TRB[mt], cols=turbaTertip(mt);
    const sk=SAKAS.filter(x=>x.mt===mt).sort((a,b)=>a.saka-b.saka);
    s+=`<line x1="${XB+BW}" y1="${y}" x2="${XM-8}" y2="${y}" stroke="#6F8EA5" stroke-width="3"/>`+A(XM-9,y,c);
    s+=F((XB+BW+XM)/2-2,y-7,turbaAd(mt)||"",{s:9,a:"middle",f:"#9AABBC",m:1});
    s+=`<a href="#mt/${mt}"><rect x="${XM}" y="${y-32}" width="${MW}" height="64" rx="7" fill="#3D5262" stroke="${c}" stroke-width="1.3"/>`;
    s+=F(XM+12,y-13,"MT-"+mt,{s:12.5,w:600,f:"#E6EFF8"});
    s+=F(XM+MW-10,y-13,h?h.fid:"baş hasaplaýjy ýok",{s:8.5,a:"end",f:"#7D93A8",m:1});
    s+=`<text x="${XM+12}" y="${y+8}" fill="${c}" font-size="15" font-weight="600" font-family="ui-monospace,Consolas,monospace">${h?nf(h.q,0):"—"}<tspan font-size="9" fill="#9AABBC" font-weight="400"> m³/sag</tspan></text>`;
    s+=F(XM+12,y+24,"şu gün "+(h?nf(h.d[LAST]):"—")+" m³",{s:9.5,f:"#9AABBC",m:1})+"</a>";
    /* paýlaýjy turba we çykyşlar */
    const xEnd=sk.length?XS-6:XE-70;
    s+=`<line x1="${XD}" y1="${y}" x2="${xEnd}" y2="${y}" stroke="${c}" stroke-width="4" opacity=".85"/>`;
    const tk=cols.filter(x=>!(x.t==="saka"));
    const span=(sk.length?XS-24:XE-84)-(XD+16), step=span/Math.max(tk.length,1);
    tk.forEach((x,j)=>{const cx=XD+16+step*(j+.5);
      if(x.t==="saz"){const f=x.m.flags.length||x.m.yok;
        s+=`<circle cx="${cx.toFixed(1)}" cy="${y}" r="4.6" fill="${f?"#F0A03C":"#5CD07A"}" stroke="#2B3D4A" stroke-width="1.2"><title>${x.m.ad} · ${nf(x.m.q,1)} m³/sag</title></circle>`;
        s+=F(cx.toFixed(1),y-9,"S-"+x.m.saz,{s:7.5,a:"middle",f:"#93AECB",m:1});}
      else{const nn=x.items.length;
        s+=`<line x1="${cx.toFixed(1)}" y1="${y}" x2="${cx.toFixed(1)}" y2="${y+15}" stroke="#5FD0FF" stroke-width="2.4"/>`;
        s+=`<line x1="${(cx-6).toFixed(1)}" y1="${y+15}" x2="${(cx+6).toFixed(1)}" y2="${y+15}" stroke="#5FD0FF" stroke-width="2.4"><title>${subAd(mt,x.u)} · ${nn} çykyş</title></line>`;
        s+=F(cx.toFixed(1),y+26,mt+"/"+subLbl(x.u),{s:8,a:"middle",f:"#5FD0FF",m:1});}
    });
    const nS=govde(mt).length, subs=SUBS(mt), nSub=subs.reduce((a,b)=>a+subItems(mt,b).filter(m=>m.tip==="sazlayjy").length,0);
    s+=F(XD+16,y+40,`${nS} sazlaýjy`+(subs.length?` · ${subs.length} şaha (${nSub} sazlaýjy)`:"")+(sk.length?` · ${sk.length} SAKA`:"")+` · ${nS+nSub+sk.length} çykyş`,{s:8.5,f:"#7D93A8"});
    if(sk.length){
      /* 1–2 SAKA: uly bloklar; köp bolsa iki setirde ykjam bloklar */
      const k=sk.length, iki=k>2, cols=iki?Math.ceil(k/2):k, gp=iki?6:8, bw=(XE-24-XS-(cols-1)*gp)/cols;
      s+=`<line x1="${XS-6}" y1="${y}" x2="${XE-24}" y2="${y}" stroke="#A78BFA" stroke-width="3"/>`;
      sk.forEach((x,j)=>{
        const bx=XS+(j%cols)*(bw+gp);
        if(iki){const by=y-38+Math.floor(j/cols)*41;
          s+=`<a href="#saka/SAKA-${x.saka}"><rect x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="35" rx="6" fill="#2E2C4F" stroke="#A78BFA" stroke-width="1.1"><title>SAKA-${x.saka} → BA-${x.saka}${x.sub?" ("+subAd(mt,x.sub)+")":""} · ${x.gs.length} gatla · şu gün ${nf(x.d[LAST])} m³</title></rect>`;
          s+=F((bx+7).toFixed(1),by+13,"SAKA-"+x.saka+(x.sub?` <tspan fill="#9AABBC" font-size="7.5">${mt}/${subLbl(x.sub)}</tspan>`:""),{s:9,f:"#C9BAFB"});
          s+=`<text x="${(bx+7).toFixed(1)}" y="${by+28}" fill="#E6EFF8" font-size="10" font-weight="600" font-family="ui-monospace,Consolas,monospace">${nf(x.q,0)}<tspan font-size="7.5" fill="#9AABBC" font-weight="400"> m³/sag</tspan></text></a>`;
          return}
        s+=`<a href="#saka/SAKA-${x.saka}"><rect x="${bx.toFixed(1)}" y="${y-27}" width="${bw.toFixed(1)}" height="54" rx="7" fill="#2E2C4F" stroke="#A78BFA" stroke-width="1.2"/>`;
        s+=F((bx+10).toFixed(1),y-11,"SAKA-"+x.saka+" → BA-"+x.saka+(x.sub?` <tspan fill="#9AABBC" font-size="8.5">(${mt}/${subLbl(x.sub)})</tspan>`:""),{s:10,f:"#C9BAFB"});
        s+=`<text x="${(bx+10).toFixed(1)}" y="${y+6}" fill="#E6EFF8" font-size="12.5" font-weight="600" font-family="ui-monospace,Consolas,monospace">${nf(x.q,0)}<tspan font-size="8.5" fill="#9AABBC" font-weight="400"> m³/sag</tspan></text>`;
        s+=F((bx+10).toFixed(1),y+20,x.gs.length+" gatla · "+nf(x.d[LAST])+" m³",{s:8.5,f:"#9AABBC",m:1})+"</a>";
      });
    } else {
      s+=`<line x1="${xEnd}" y1="${y-9}" x2="${xEnd}" y2="${y+9}" stroke="${c}" stroke-width="3"/>`;
      s+=F(xEnd+8,y+3,"turba soňy",{s:8.5,f:"#7D93A8"});
    }
    /* deňagramlylyk */
    const g=yGrade(D.y30.p);
    s+=`<a href="#denge"><rect x="${XE}" y="${y-27}" width="${EW}" height="54" rx="7" fill="#3A4E5E" stroke="${GC[g]}" stroke-width="1.2"/>`;
    s+=F(XE+11,y-11,"ÝITGI",{s:8.5,f:"#9AABBC",ls:"1"});
    s+=F(XE+EW-10,y-11,{ok:"KADALY",or:"ÜNS BER",rd:"ÝOKARY",n:"—"}[g],{s:8,a:"end",f:GC[g],m:1,w:600});
    s+=`<text x="${XE+11}" y="${y+7}" fill="${GC[g]}" font-size="16" font-weight="600" font-family="ui-monospace,Consolas,monospace">${D.bolmaz?"—":"%"+nf(D.y30.p,1)}</text>`;
    s+=F(XE+11,y+21,D.bolmaz?"baş hasaplaýjy ýok":"şu gün %"+nf(D.d.p,1)+" · "+nfc(D.y30.f)+" m³",{s:8.5,f:"#9AABBC",m:1})+"</a>";
  });
  return s+"</svg>";
}

/* ---------- TRB DEŇAGRAMLYLYGY ---------- */
P.denge=()=>{
  const B=BEK, sap=TURBALAR.filter(h=>!h.bolmaz), kad=sap.filter(h=>yGrade(h.y30.p)==="ok");
  const fl=UNS.filter(h=>!h.bolmaz&&yGrade(h.y30.p)!=="ok");
  const row=(D,lvl,lbl,cyk)=>`<tr class="${lvl?"":"trbrow"}"><td>${lvl?'<span class="ind">└</span>':""}<a href="${D.href}"><b>${lbl}</b></a></td>
    <td class="mono" style="color:var(--tx3)">${D.gir.map(m=>m.fid).join(", ")||"—"}</td><td class="m">${cyk}</td>
    <td class="m">${nf(D.d.g)}</td><td class="m">${nf(D.d.c)}</td><td class="m">${nf(D.d.f)}</td><td class="m" style="color:${GC[yGrade(D.d.p)]}">${nf(D.d.p,1)}</td>
    <td class="m">${nf(D.y30.g)}</td><td class="m">${nf(D.y30.c)}</td><td class="m">${nf(D.y30.f)}</td><td class="m" style="color:${GC[yGrade(D.y30.p)]}"><b>${nf(D.y30.p,1)}</b></td>
    <td>${spark(dRows(D,30).map(r=>r.p),GC[yGrade(D.y30.p)])}</td><td>${D.bolmaz?'<span class="tg tg-n">BAŞ ÝOK</span>':yTag(D.y30.p)}${D.eksik.length?' <span class="tg tg-n" title="'+esc(D.eksik.map(m=>m.ad).join(", "))+'">doly däl</span>':""}</td></tr>`;
  return `
  <div class="h1row"><h1>Suw deňagramlylygy</h1><span class="crumb">MT başynyň sarp edilişi ↔ turbada ölçenýän ähli çykyşlaryň jemi · ${BEKET_AD}</span></div>
  <div class="kpirow">
    ${kpi("◉","#39B6EE","Bekediň çykyşy · şu gün",nf(B.d.g),"m³",`MT başlarynyň jemi · düýn ${nf(B.y.g)} m³`)}
    ${kpi("⑃","#5CD07A","Turbalarda ölçenen · şu gün",nf(B.d.c),"m³",`${ok(B.cyk).length} çykyş hasaplaýjysy`)}
    ${kpi("⚖",GC[yGrade(B.d.p)],"Ýitgi · şu gün",nf(B.d.f),"m³",`%${nf(B.d.p,2)} · düýn %${nf(B.y.p,2)}`)}
    ${kpi("⚖",GC[yGrade(B.y30.p)],"Ýitgi · 30 gün",nf(B.y30.f),"m³",`%${nf(B.y30.p,2)} · ${nf(B.y30.g)} m³-den`)}
    ${kpi("✓",kad.length===sap.length?"#5CD07A":"#F0A03C","Kadaly turbalar",kad.length+" / "+TURBALAR.length,"",`kabul çägi %${nf(CAK,0)}`)}
    ${kpi("⚑",fl.length?"#F2635A":"#5CD07A","Üns berilmeli",fl.length,"",fl.length?fl.map(h=>h.ad+" %"+nf(h.y30.p,1)).join(" · "):"ýok")}
  </div>

  <div class="pan"><div class="ph"><h2>Esasy turbalar, şahalar we SAKA-lar boýunça deňagramlylyk</h2>
    <span class="crumb">Ýitgi % = (giren − çykan) / giren · şahanyň başy ölçenýän bolsa MT-de şahanyň başy hasaba alynýar</span></div>
    <div class="scroll"><table class="dtbl"><thead><tr>
      <th rowspan="2">Turba / bölüm</th><th rowspan="2">Baş hasaplaýjy</th><th rowspan="2" class="m">Çykyş</th>
      <th colspan="4" class="grp">Şu gün (m³)</th><th colspan="4" class="grp">Soňky 30 doly gün (m³)</th><th rowspan="2">Ýitgi % · 30 g</th><th rowspan="2">Ýagdaýy</th></tr>
      <tr><th class="m">Giren</th><th class="m">Çykan</th><th class="m">Ýitgi</th><th class="m">%</th><th class="m">Giren</th><th class="m">Çykan</th><th class="m">Ýitgi</th><th class="m">%</th></tr></thead><tbody>
      ${MTS.map(mt=>{const D=TRB[mt];
        return row(D,0,mtBas(mt),ok(D.cyk).length)+
          SUBS(mt).filter(b=>SUBD[mt+"/"+b]).map(b=>row(SUBD[mt+"/"+b],1,subAd(mt,b)+" şaha",ok(SUBD[mt+"/"+b].cyk).length)).join("")+
          SAKAS.filter(s=>s.mt===mt&&SAKD[s.saka]).map(s=>row(SAKD[s.saka],1,"SAKA-"+s.saka+" → BA-"+s.saka,s.gs.length)).join("")}).join("")}
      <tr class="tot"><td colspan="2">BEKET JEMI</td><td class="m">${ok(B.cyk).length}</td>
        <td class="m">${nf(B.d.g)}</td><td class="m">${nf(B.d.c)}</td><td class="m">${nf(B.d.f)}</td><td class="m">${nf(B.d.p,1)}</td>
        <td class="m">${nf(B.y30.g)}</td><td class="m">${nf(B.y30.c)}</td><td class="m">${nf(B.y30.f)}</td><td class="m">${nf(B.y30.p,1)}</td><td></td><td>${yTag(B.y30.p)}</td></tr>
    </tbody></table></div></div>

  <div class="trbgrid"${MTS.length<2?' style="grid-template-columns:minmax(0,1fr)"':""}>${MTS.map(mt=>{const D=TRB[mt],g=yGrade(D.y30.p),h=basy(mt);
    const sb=SUBS(mt), sk=SAKAS.filter(s=>s.mt===mt);
    return `<div class="pan" style="margin:0;${g==="rd"?"border-color:#8E3B36":g==="or"?"border-color:#6B4A1F":""}">
      <div class="ph"><h2><a href="#mt/${mt}">${mtBas(mt)}</a></h2>${D.bolmaz?'<span class="tg tg-n">BAŞ ÝOK</span>':yTag(D.y30.p)}</div>
      <div class="pb">${chHat(dRows(D,30),MTS.length<2?{h:300,W:1180}:{h:250,W:640})}
        <div class="dfoot">
          <span>Giren <b class="mono" style="color:var(--cy)">${nf(D.y30.g)}</b></span>
          <span>Çykan <b class="mono" style="color:var(--gr)">${nf(D.y30.c)}</b></span>
          <span>Ýitgi <b class="mono" style="color:${GC[g]}">${nf(D.y30.f)}</b> m³ (%${nf(D.y30.p,1)})</span></div>
        <div class="crumb" style="margin-top:6px;line-height:1.6">Baş: ${h?h.fid:"—"} · çykyşlar: ${govde(mt).length} gövde sazlaýjysy${sb.length?" · "+sb.map(b=>subAd(mt,b)+(basy(mt,b)&&!basy(mt,b).yok?" (baş ölçeýji)":" ("+subItems(mt,b).length+")")).join(", "):""}${sk.length?" · "+sk.map(s=>"SAKA-"+s.saka).join(", "):""}
          ${D.eksik.length?`<br><span class="wr">Maglumat ýok / gijikýär: ${D.eksik.map(m=>m.ad).join(", ")}</span>`:""}</div>
      </div></div>`}).join("")}</div>

  <div class="pan"><div class="ph"><h2>Hasaplaýyş düzgüni</h2></div><div class="pb" style="color:var(--tx2);line-height:1.9;font-size:12.5px">
    <b style="color:var(--cy2)">Turba ýitgisi</b> = MT başy (MTn_Jemi) − Σ(gövde sazlaýjylary + SAKA + şahalar). Şahanyň başy ölçenýän bolsa (MT2_1 ýaly)
    şaha başy bilen, ýogsa şahanyň sazlaýjylary bilen hasaplanýar; SAKA hasaplaýjysy ýok bolsa onuň gatlalary alynýar.<br>
    Bekediň çykyşy = ähli MT başlarynyň jemi. Bahalar totalizator tapawudyndan (gündelik). “30 gün” — düýne çenli soňky 30 doly gün; şu gün aýratyn görkezilýär (doly däl gün).<br>
    Kabul çägi: ýitgi ≤ %${nf(CAK,0)} kadaly; %${nf(CAK,0)}–${nf(2*CAK,0)} üns beriň; %${nf(2*CAK,0)}-den köp — ýitgi ýokary (turba syzmasy, hasaba alynmadyk çykyş ýa-da hasaplaýjy ýalňyşy).
    Çykan girenden köp bolsa (otrisatel ýitgi) hasaplaýjylaryň koeffisiýentini barlaň. Çägi ulgam.json-da <span class="mono">yitgi_cak</span> bilen üýtgedip bolýar.
  </div></div>`;
};

/* ---------- MT ESASY TURBA ---------- */
/* Turba boýunça fiziki tertip (ulgam.json turba_sira; köne ady hat_sira hem okalýar): "saz:n" gövde sazlaýjy, "sub:n" şaha, "saka:n" SAKA.
   Sanawda ýok çykyş öz tebigy goňşusynyň yzyna goýulýar (meselem täze S-7 → S-6-dan soň). */
const TURBA_SIRA=U.turba_sira||U.hat_sira||{};
function turbaTertip(mt){
  const items=[];
  govde(mt).sort((a,b)=>a.saz-b.saz).forEach(m=>items.push({k:"saz:"+m.saz,t:"saz",m}));
  SUBS(mt).forEach(b=>items.push({k:"sub:"+subLbl(b),t:"sub",u:b,h:basy(mt,b),items:subItems(mt,b)}));
  SAKAS.filter(s=>s.mt===mt&&s.sub===0).forEach(s=>items.push({k:"saka:"+s.saka,t:"saka",m:s}));
  const sira=(TURBA_SIRA[mt]||null)&&TURBA_SIRA[mt].map(k=>String(k).replace(/^sub:(.+)$/,(_,v)=>"sub:"+subLbl(subNorm(v))));
  if(!sira)return items;
  const out=[];
  sira.forEach(k=>{const c=items.find(x=>x.k===k);if(c&&!out.includes(c))out.push(c)});
  items.forEach((c,i)=>{if(out.includes(c))return;
    let j=-1;for(let p=i-1;p>=0&&j<0;p--)j=out.indexOf(items[p]);
    out.splice(j+1,0,c)});
  return out;
}
const subQ=(mt,b)=>{const h=basy(mt,b);return h&&!h.yok?h.q:q(ok(subCyk(mt,b)))};

P.mt=(mt)=>{
  const h=basy(mt), main=h?[h]:[], D=TRB[mt], t=per3(ok(main));
  const gv=govde(mt), subs=SUBS(mt), skT=SAKAS.filter(s=>s.mt===mt&&s.sub===0), skA=SAKAS.filter(s=>s.mt===mt);
  const gvQ=q(ok(gv)), sbQ=topSubs(mt).reduce((a,b)=>a+subQ(mt,b),0), skQ=q(ok(skT.flatMap(sakaOlc)));
  const dif=q(ok(main))-q(ok(D.cyk)), nSubS=subs.reduce((a,b)=>a+subItems(mt,b).filter(m=>m.tip==="sazlayjy").length,0);
  const rows=[];
  if(h)rows.push({m:h,lv:0});
  turbaTertip(mt).forEach(c=>{
    if(c.t==="sub"){if(c.h)rows.push({m:c.h,lv:0});c.items.forEach(m=>rows.push({m,lv:1}))}
    else rows.push({m:c.m,lv:0})});
  const qm=q(ok(main));
  const tr=({m,lv})=>{const p=per3([m]),sk=m.tip==="saka";
    return `<tr><td>${lv?'<span class="ind">└</span>':""}<span class="tg ${m.tip==="ana"?"tg-c":sk?"tg-sz":"tg-n"}">${tipAd(m).toUpperCase()}</span></td>
      <td class="mono" style="color:var(--tx3)">${m.fid}</td>
      <td>${sk?`<a href="#saka/SAKA-${m.saka}" style="color:#C9BAFB"><b>${m.ad}</b> ↗</a>`:`<b>${m.ad}</b>`}</td>
      <td class="m">${nf(m.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td><td class="m">${nf(p.yr)}</td>
      <td class="m">${m===h?"100,0":nf(qm?m.q/qm*100:0,1)}</td>
      <td>${spark(Array.from({length:7},(_,i)=>m.d[LAST-6+i]),m.flags.length?"#F0A03C":"#5CD07A")}</td><td>${durum(m)}</td></tr>`};
  const C=ok(D.cyk);
  return `
  <div class="h1row"><h1>MT-${mt} esasy turba</h1><span class="crumb">Baş sahypa › Turbaly Suw Geçirijiler › <b>${mtBas(mt)}</b></span></div>
  <div class="kpirow">
    ${kpi("≋",mtC(mt),`MT-${mt} başy (häzirki)`,h?nf(h.q,0):"—","m³/sag",`Şu gün: ${nf(t.d)} m³ · ${h?h.fid:"baş hasaplaýjy ýok"}`)}
    ${kpi("⑃","#5CD07A","Gövde sazlaýjylary",nf(gvQ,0),"m³/sag",`${gv.length} sazlaýjy`)}
    ${kpi("⑂","#5FD0FF","Şahalar",nf(sbQ,0),"m³/sag",subs.length?`${subs.map(b=>subAd(mt,b)).join(", ")} · ${nSubS} sazlaýjy`:"şaha ýok")}
    ${kpi("◍","#A78BFA","SAKA → beton akaba",nf(q(ok(skA)),0),"m³/sag",skA.length?`${skA.map(s=>"SAKA-"+s.saka).join(", ")} · ${skA.reduce((a,s)=>a+s.gs.length,0)} gatla`:"SAKA ýok")}
    ${kpi("⚖",GC[yGrade(D.d.p)],"Turba ýitgisi · şu gün",nf(D.d.p,1),"%",`${nf(D.d.f)} m³ · 30 gün %${nf(D.y30.p,1)} · häzir ${nf(dif,0)} m³/sag`)}
    ${kpi("▦","#F0A03C","Şu aýky sarp ediliş",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} ${arrow(pct(t.m,t.pm))}`)}
  </div>
  ${eksikPan(D)}
  <div class="pan"><div class="ph"><h2>MT-${mt} turba shemasy</h2>
    <span class="crumb"><span style="color:#5CD07A">■</span> gövde sazlaýjy &nbsp;<span style="color:#5FD0FF">■</span> şaha (gapdal turba)
      &nbsp;<span style="color:#A78BFA">■</span> SAKA (bas → beton akaba)</span></div>
    <div class="pb scroll">${schemaMT(mt)}</div></div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Häzirki akymyň paýlanyşy</h2></div>
      <div class="pb" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        ${chDonut([{l:"Gövde",v:gvQ,c:"#5CD07A"},{l:"Şahalar",v:sbQ,c:"#5FD0FF"},{l:"SAKA",v:skQ,c:"#A78BFA"},{l:"Ýitgi",v:Math.max(0,dif),c:"#F0A03C"}],h?nf(h.q,0):"—","m³/sag")}
        <div class="lgd">
          <span><i style="background:#5CD07A"></i>Gövde sazlaýjylary <b class="mono">${nf(gvQ,1)}</b></span>
          <span><i style="background:#5FD0FF"></i>Şahalar <b class="mono">${nf(sbQ,1)}</b></span>
          <span><i style="background:#A78BFA"></i>SAKA <b class="mono">${nf(skQ,1)}</b></span>
          <span><i style="background:#F0A03C"></i>Ýitgi <b class="mono">${nf(Math.max(0,dif),1)}</b></span>
        </div></div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Sarp ediliş grafigi (m³)</h2><span class="crumb">MT-${mt} başy</span></div>
      <div class="pb">${chLine(series(ok(main)),{h:250,W:440,c:mtC(mt)})}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Giren / çykan deňeşdirmesi</h2></div>
      <div class="pb">${chBar(series(ok(main)).map((x,i)=>({l:x.l,s:x.s,a:x.v,b:series(C)[i].v})),{h:250,W:440,pairs:true,ca:"#39B6EE",cb:"#5CD07A"})}
      <div class="crumb" style="margin-top:6px"><span style="color:#39B6EE">■</span> Giren (MT başy) &nbsp;<span style="color:#5CD07A">■</span> Çykan (Σ ölçenýän çykyş)</div></div></div>
  </div>

  <div class="pan"><div class="ph"><h2>MT-${mt} suw deňagramlylygy · soňky 30 gün</h2>${D.bolmaz?"":yTag(D.y30.p)}</div>
    <div class="pb">${chHat(dRows(D,30),{h:260})}
      <div class="dfoot"><span>Giren <b class="mono" style="color:var(--cy)">${nf(D.y30.g)}</b> m³</span>
        <span>Çykan <b class="mono" style="color:var(--gr)">${nf(D.y30.c)}</b> m³</span>
        <span>Ýitgi <b class="mono" style="color:${GC[yGrade(D.y30.p)]}">${nf(D.y30.f)}</b> m³ (%${nf(D.y30.p,2)})</span>
        <a href="#denge" class="crumb" style="margin-left:auto">ähli turbalar →</a></div></div></div>

  <div class="pan"><div class="ph"><h2>Sazlaýjylar, şahalar we SAKA-lar</h2>
    <span class="crumb">Turba boýunça tertipde · beton akaba gatlalary SAKA sahypalarynda</span></div>
    <div class="scroll scrollY"><table><thead><tr>
      <th>Görnüş</th><th>ID</th><th>Hasaplaýjy</th><th class="m">Häzirki m³/sag</th><th class="m">Şu gün</th>
      <th class="m">Şu aý</th><th class="m">Şu ýyl</th><th class="m">% MT-${mt}</th><th>Meýil 7g</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${rows.map(tr).join("")}
      <tr class="tot"><td colspan="3">ÖLÇENEN ÇYKYŞ (Σ ${C.length})</td><td class="m">${nf(q(C),1)}</td>
        <td class="m">${nf(per3(C).d)}</td><td class="m">${nf(per3(C).m)}</td><td class="m">${nf(per3(C).yr)}</td>
        <td class="m">${nf(qm?q(C)/qm*100:0,1)}</td><td></td><td></td></tr>
      <tr class="tot"><td colspan="3" style="color:${GC[yGrade(D.d.p)]}">ÝITGI (MT başy − Σ çykyş)</td><td class="m">${nf(dif,1)}</td>
        <td class="m">${nf(D.d.f)}</td><td class="m">${nf(D.ara(mS(0),LAST).f)}</td><td class="m">${nf(D.ara(yS(0),LAST).f)}</td>
        <td class="m">${nf(qm?dif/qm*100:0,1)}</td><td></td><td></td></tr>
    </tbody></table></div></div>`;
};

/* MT shemasy: ýokarda gövde; gövde sazlaýjylary aşak düşýär; şahalar gapdal turba bolup aşak uzaýar
   (şahanyň başy + onuň sazlaýjylary sagda); SAKA → beton akaba (bas → SAKA sahypasy) */
function schemaMT(mt){
  const cols=turbaTertip(mt), head=basy(mt), c0=mtC(mt);
  const SW=132, BWD=176, TY=58, X0=214, IH=46;
  cols.forEach(c=>{c.w=c.t==="sub"?BWD:SW});
  const maxN=Math.max(0,...cols.filter(c=>c.t==="sub").map(c=>c.items.length));
  const H=Math.max(236,TY+106+maxN*IH+14);
  const W=X0+cols.reduce((a,c)=>a+c.w,0)+96;
  const T=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"${o.a?` text-anchor="${o.a}"`:""}${o.w?` font-weight="${o.w}"`:""}${o.m?' font-family="ui-monospace,Consolas,monospace"':""}>${t}</text>`;
  const meter=(cx,cy,c,r=7.5)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#384B5A" stroke="${c}" stroke-width="1.5"/>
    <line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${cy+r}" stroke="${c}" stroke-width="1.2"/>`;
  let acc=X0; const ends=[];
  cols.forEach(c=>{ends.push(c.t==="sub"?acc+24:acc+c.w/2);acc+=c.w});
  const END=ends.length?ends[ends.length-1]:X0+40;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;max-width:none">`;
  /* MT başy */
  s+=`<rect x="18" y="${TY-30}" width="176" height="60" rx="7" fill="#3D5262" stroke="${c0}" stroke-width="1.4"/>`;
  s+=T(30,TY-12,"MT-"+mt+" BAŞY"+(turbaAd(mt)?" · "+turbaAd(mt):""),{s:10});
  s+=`<text x="30" y="${TY+9}" fill="${c0}" font-size="16" font-weight="600" font-family="ui-monospace,Consolas,monospace">${head?nf(head.q,1):"—"}<tspan font-size="9" fill="#9AABBC" font-weight="400"> m³/sag</tspan></text>`;
  s+=T(30,TY+24,"şu gün "+(head?nf(head.d[LAST]):"—")+" m³",{s:8.5,f:"#9AABBC",m:1});
  s+=T(184,TY-12,head?head.fid:"",{s:8.5,a:"end",f:"#7D93A8",m:1});
  /* gövde */
  s+=`<line x1="194" y1="${TY}" x2="${END}" y2="${TY}" stroke="${c0}" stroke-width="6"/>`;
  s+=`<line x1="${END}" y1="${TY-13}" x2="${END}" y2="${TY+13}" stroke="${c0}" stroke-width="4"/>`;
  s+=T(END+10,TY-16,"TURBANYŇ SOŇY",{s:9,f:"#7D93A8",m:1});
  let x=X0;
  cols.forEach(c=>{
    if(c.t==="sub"){
      const cx=x+24, n=c.items.length, hb=c.h, hasH=hb&&!hb.yok, by=TY+34, ene=c.u%1?Math.floor(c.u):0;
      s+=`<line x1="${cx}" y1="${TY}" x2="${cx}" y2="${by}" stroke="#5FD0FF" stroke-width="${ene?2:3.4}"${ene?' stroke-dasharray="5 4"':""}/>`;
      if(ene)s+=T(cx+6,TY+24,"↳ "+mt+"/"+ene+" şahasyndan",{s:8,f:"#9AABBC"});
      s+=`<rect x="${x+6}" y="${by}" width="${c.w-18}" height="44" rx="6" fill="#3D5262" stroke="#5FD0FF" stroke-width="1.3"/>`;
      if(hb)s+=meter(x+22,by+22,"#5FD0FF",7);
      s+=T(hb?x+36:x+16,by+17,subAd(mt,c.u)+" şaha",{s:10,f:"#E6EFF8",w:600});
      s+=T(x+c.w-18,by+17,hb?hb.fid:"Σ",{s:8,a:"end",f:"#7D93A8",m:1});
      s+=T(hb?x+36:x+16,by+34,(hasH?"":"Σ ")+nf(hasH?hb.q:q(ok(subCyk(mt,c.u))),1)+" m³/sag",{s:11,w:600,f:"#5FD0FF",m:1});
      const ly=TY+106+(n-1)*IH;
      if(n)s+=`<line x1="${cx}" y1="${by+44}" x2="${cx}" y2="${ly}" stroke="#5FD0FF" stroke-width="3"/>`;
      c.items.forEach((it,j)=>{
        const iy=TY+106+j*IH, sk=it.tip==="saka", col=sk?"#A78BFA":it.flags.length?"#F0A03C":"#5CD07A";
        if(sk)s+=`<a href="#saka/SAKA-${it.saka}">`;
        s+=`<line x1="${cx}" y1="${iy}" x2="${cx+16}" y2="${iy}" stroke="${sk?"#A78BFA":"#5FD0FF"}" stroke-width="2"/>`;
        s+=meter(cx+23,iy,col,6.5);
        s+=`<rect x="${cx+34}" y="${iy-17}" width="${c.w-58}" height="34" rx="5" fill="${sk?"#2E2C4F":"#3D5262"}" stroke="${sk?"#A78BFA":"#6F8EA5"}"/>`;
        s+=T(cx+42,iy-4,kisa(it)+(sk?" ↗":""),{s:9,f:sk?"#C9BAFB":"#93AECB"});
        s+=T(cx+c.w-30,iy-4,sk?it.gs.length+" G":it.fid.replace(/^MT\d+_\d+_/,""),{s:7.5,a:"end",f:"#7D93A8",m:1});
        s+=T(cx+42,iy+11,nf(it.q,1)+" m³/sag",{s:10,w:600,f:it.q>0.05?"#E6EFF8":"#7D93A8",m:1});
        if(sk)s+="</a>";
      });
      x+=c.w;return;
    }
    const cx=x+c.w/2, sk=c.t==="saka", m=c.m, col=sk?"#A78BFA":(m.flags.length||m.yok)?"#F0A03C":"#5CD07A", BW=SW-16, by=TY+70;
    if(sk)s+=`<a href="#saka/SAKA-${m.saka}">`;
    s+=`<line x1="${cx}" y1="${TY}" x2="${cx}" y2="${TY+44}" stroke="${sk?"#A78BFA":c0}" stroke-width="2.4"/>`;
    s+=meter(cx,TY+52,col);
    s+=`<line x1="${cx}" y1="${TY+60}" x2="${cx}" y2="${by}" stroke="${sk?"#A78BFA":c0}" stroke-width="2.4"/>`;
    s+=`<rect x="${cx-BW/2}" y="${by}" width="${BW}" height="${sk?60:50}" rx="6" fill="${sk?"#2E2C4F":"#3D5262"}" stroke="${sk?"#A78BFA":"#6F8EA5"}" stroke-width="1.2"/>`;
    s+=T(cx-BW/2+10,by+17,(sk?m.ad:"S-"+m.saz)+(sk?" ↗":""),{s:10.5,f:sk?"#C9BAFB":"#93AECB"});
    s+=T(cx+BW/2-8,by+17,m.fid,{s:7.5,a:"end",f:"#7D93A8",m:1});
    s+=T(cx-BW/2+10,by+36,nf(m.q,1)+" m³/sag",{s:12,w:600,f:m.q>0.05?"#E6EFF8":"#7D93A8",m:1});
    if(sk)s+=T(cx+BW/2-8,by+52,"→ BA-"+m.saka+" · "+m.gs.length+" gatla",{s:8.5,a:"end",f:"#9AABBC",m:1});
    else s+=T(cx-BW/2+10,by+46,"şu gün "+nf(m.d[LAST])+" m³",{s:8,f:"#9AABBC",m:1});
    if(sk)s+=`</a>`;
    x+=c.w;
  });
  return s+"</svg>";
}

/* ---------- SAKA ---------- */
const BOWET=U.bowet||{};
P.saka=(key)=>{
  const sk=SAKAS.find(s=>"SAKA-"+s.saka===key)||SAKAS[0];
  if(!sk)return `<div class="ok-box">SAKA hasaplaýjysy ýok.</div>`;
  const t=per3(ok([sk])), gt=sk.gs, dif=sk.q-q(ok(gt)), nb=+BOWET[sk.saka]||0, D=SAKD[sk.saka];
  const ust=sk.sub?basy(sk.mt,sk.sub):basy(sk.mt), ustAd=sk.sub?subAd(sk.mt,sk.sub):"MT-"+sk.mt;
  const ustQ=sk.sub?subQ(sk.mt,sk.sub):ust?ust.q:NaN;
  return `
  <div class="h1row"><h1>SAKA-${sk.saka} · beton akaba-${sk.saka}</h1>
    <span class="crumb">Baş sahypa › ${sk.mt?`<a href="#mt/${sk.mt}">MT-${sk.mt}</a>`:"MT saýlanmadyk"}${sk.sub?" › "+subAd(sk.mt,sk.sub):""} › <b>SAKA-${sk.saka}</b></span></div>
  <div class="kpirow">
    ${kpi("◉","#A78BFA","SAKA häzirki akymy",nf(sk.q,1),"m³/sag",sk.fid)}
    ${kpi("▤","#5CD07A","Günlük sarp ediliş",nf(t.d),"m³",`Düýn: ${nf(t.y)} ${arrow(pct(t.d,t.y))}`)}
    ${kpi("▦","#39B6EE","Şu aý",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} ${arrow(pct(t.m,t.pm))}`)}
    ${kpi("▨","#F0A03C","Şu ýyl",nf(t.yr),"m³",t.py?`Geçen ýyl: ${nf(t.py)}`:"Geçen ýyl: maglumat ýok")}
    ${kpi("⚖",D?GC[yGrade(D.d.p)]:"#7D93A8","SAKA − Σ gatla (şu gün)",D?nf(D.d.f):"—","m³",D?`%${nf(D.d.p,2)} · häzir ${nf(dif,1)} m³/sag`:"gatla ýok")}
    ${kpi("⛭","#5CD07A","Açyk gatla",gt.filter(g=>g.q>0.05).length+" / "+gt.length,"",nb?`${nb} böwetleýji gatla (hasaplaýjysyz)`:`%${nf(gt.length?gt.filter(g=>g.q>0.05).length/gt.length*100:0)} açyk`)}
  </div>

  ${D?eksikPan(D):yokAd([sk])?`<div class="pan" style="border-color:#6B4A1F"><div class="pb" style="color:#F0C48A;font-size:12px">Maglumat ýok: <b>${yokAd([sk])}</b></div></div>`:""}
  <div class="gm" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>SAKA-${sk.saka} gidrawlik shema</h2>
      <span class="crumb">SAKA hasaplaýjysy → beton akabanyň paýlaýjy (G) we böwetleýji (B) gatlalary</span></div>
      <div class="pb scroll">${schemaSAKA(sk)}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Gysgaça beýan</h2></div><div class="pb">
      <div class="kv"><span>Ýokarky çeşme (${ustAd})</span><b>${nf(ustQ,1)} m³/sag</b></div>
      <div class="kv"><span>SAKA-${sk.saka} akymy</span><b>${nf(sk.q,1)} m³/sag</b></div>
      <div class="kv"><span>BA-${sk.saka} gatlalarynyň jemi</span><b>${nf(q(ok(gt)),1)} m³/sag</b></div>
      <div class="kv"><span>Deňagramlylyk tapawudy</span><b>${nf(dif,1)} m³/sag</b></div>
      <div class="kv"><span>Günlük sarp ediliş</span><b>${nf(t.d)} m³</b></div>
      <div class="kv"><span>Aýlyk sarp ediliş</span><b>${nf(t.m)} m³</b></div>
      <div class="kv"><span>Ýyllyk sarp ediliş</span><b>${nf(t.yr)} m³</b></div>
      <div class="kv" style="color:var(--cy2)"><span>Paýlaýjy / böwetleýji gatla</span><b>${gt.length} / ${nb||"—"}</b></div>
    </div></div>
  </div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Günlük sarp ediliş grafigi (m³)</h2></div>
      <div class="pb">${chLine(series(ok([sk]),"d"),{h:250,W:440,c:"#A78BFA"})}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>BA-${sk.saka} çykyş paýlanyşy</h2></div>
      <div class="pb" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        ${chDonut(gt.map((g,i)=>({l:g.ad,v:g.q,c:CLR[i%CLR.length]})),nf(q(ok(gt)),1),"m³/sag")}
        <div class="lgd" style="max-height:150px;overflow-y:auto">${gt.map((g,i)=>
          `<span><i style="background:${CLR[i%CLR.length]}"></i>${kisa(g)} <b class="mono">${nf(q(ok(gt))?g.q/q(ok(gt))*100:0,1)}%</b></span>`).join("")}</div>
      </div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Aýlyk deňeşdirme (m³)</h2>
      <span class="crumb"><span style="color:#5CD07A">■</span>${YIL} <span style="color:#7D93A8">■</span>${YIL-1}</span></div>
      <div class="pb">${chBar(yoy(ok([sk])),{h:250,W:440,pairs:true})}</div></div>
  </div>

  <div class="pan"><div class="ph"><h2>BA-${sk.saka} gatlalar</h2></div>
    <div class="scroll"><table><thead><tr>
      <th>Gatla</th><th>ID</th><th class="m">Häzirki m³/sag</th><th class="m">Şu gün</th><th class="m">Şu aý</th>
      <th class="m">Şu ýyl</th><th class="m">% paý</th><th>Meýil 7g</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${gt.map(g=>{const p=per3([g]);
        return `<tr><td><b>${g.ad}</b></td><td class="mono" style="color:var(--tx3)">${g.fid}</td>
        <td class="m">${nf(g.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td><td class="m">${nf(p.yr)}</td>
        <td class="m">${nf(q(ok(gt))?g.q/q(ok(gt))*100:0,1)}</td>
        <td>${spark(Array.from({length:7},(_,i)=>g.d[LAST-6+i]),g.flags.length?"#F0A03C":"#5CD07A")}</td>
        <td>${durum(g)}</td></tr>`}).join("")}
      <tr class="tot"><td colspan="2">JEMI</td><td class="m">${nf(q(ok(gt)),1)}</td><td class="m">${nf(per3(ok(gt)).d)}</td>
      <td class="m">${nf(per3(ok(gt)).m)}</td><td class="m">${nf(per3(ok(gt)).yr)}</td><td class="m">100,0</td><td></td><td></td></tr>
    </tbody></table></div></div>

  <div class="pan"><div class="ph"><h2>Maglumat we düşündiriş</h2></div><div class="pb" style="color:var(--tx2);line-height:1.9;font-size:12.5px">
    <b style="color:var(--cy2)">SAKA-${sk.saka} deňagramlylygy</b> = SAKA-${sk.saka} − Σ(BA-${sk.saka} G-1 … G-${gt.length}). Böwetleýji gatlalaryň (B) hasaplaýjysy ýok.<br>
    SAKA-${sk.saka} ${sk.mt?(sk.sub?subAd(sk.mt,sk.sub)+" şahasynda":"MT-"+sk.mt+" gövdesinde"):"haýsy MT-de — Sazlamalarda saýlaň"} (ulgam.json: saka_mt${sk.sub?", saka_sub":""}).<br>
    Sarp ediliş bahalary totalizator tapawudyndan hasaplanýar; häzirki akym _Akym nokadyndan (ýok bolsa totalizatoryň soňky sagatdaky tapawudyndan).
  </div></div>`;
};
function schemaSAKA(sk){
  const gs=sk.gs, n=gs.length, nb=+BOWET[sk.saka]||0, k=Math.max(n,nb);
  const GW=104, BWc=40, X0=286, TOP=104, CH=54, H=270;
  const slots=[];for(let i=1;i<=k;i++){if(i<=n)slots.push({g:gs[i-1]});if(i<=nb)slots.push({b:i})}
  const SWs=slots.map(x=>x.g?GW:BWc), Wt=SWs.reduce((a,b)=>a+b,0);
  const W=Math.max(760, X0+Wt+70);
  const T=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"${o.a?` text-anchor="${o.a}"`:""}${o.w?` font-weight="${o.w}"`:""}${o.m?' font-family="ui-monospace,Consolas,monospace"':""}>${t}</text>`;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,2400)}px">`;
  const cy=TOP+CH/2;
  s+=`<rect x="18" y="${cy-40}" width="212" height="80" rx="8" fill="#2E2C4F" stroke="#A78BFA" stroke-width="1.6"/>`;
  s+=`<circle cx="${18+24}" cy="${cy}" r="10" fill="none" stroke="#A78BFA" stroke-width="1.6"/>`;
  s+=`<line x1="${18+24}" y1="${cy-10}" x2="${18+24}" y2="${cy+10}" stroke="#A78BFA" stroke-width="1.3"/>`;
  s+=T(66,cy-15,sk.ad,{s:12,f:"#C9BAFB"});
  s+=T(226,cy-15,sk.fid,{s:8.5,a:"end",f:"#7D93A8",m:1});
  s+=T(66,cy+8,nf(sk.q,1)+" m³/sag",{s:15,w:600,f:"#E6EFF8",m:1});
  s+=T(66,cy+26,"şu gün "+nf(sk.d[LAST])+" m³",{s:9,f:"#9AABBC",m:1});
  s+=T(18,cy-52,"↑ "+(sk.sub?subAd(sk.mt,sk.sub):sk.mt?"MT-"+sk.mt:"MT ?"),{s:9.5,f:"#9AABBC",m:1});
  s+=`<line x1="230" y1="${cy}" x2="${X0-24}" y2="${cy}" stroke="#5CD07A" stroke-width="3"/>`;
  s+=`<path d="M${X0-24} ${cy-5} L${X0-12} ${cy} L${X0-24} ${cy+5} Z" fill="#5CD07A"/>`;
  const cx1=X0-12, cx2=X0+Wt+26;
  s+=`<path d="M${cx1} ${TOP} H${cx2} L${cx2-22} ${TOP+CH} H${cx1} Z" fill="#3F5465" stroke="#6F8EA5" stroke-width="1.4"/>`;
  s+=`<path d="M${cx1+3} ${TOP+16} H${cx2-9} L${cx2-27} ${TOP+CH-3} H${cx1+3} Z" fill="#39B6EE" opacity=".16"/>`;
  s+=T(cx2-12,TOP-10,"BETON AKABA-"+sk.saka,{s:9.5,a:"end",f:"#9AABBC"});
  let x=X0;
  slots.forEach((sl,i)=>{
    if(sl.b){const bx=x+BWc/2;
      s+=`<rect x="${bx-3.5}" y="${TOP-8}" width="7" height="${CH+16}" rx="1.5" fill="#7D93A8"><title>B-${sl.b} böwetleýji gatla</title></rect>`;
      s+=T(bx,TOP+CH+22,"B-"+sl.b,{s:8.5,a:"middle",f:"#9AABBC",m:1});
      x+=BWc;return}
    const g=sl.g, gx=x+GW/2, on=g.q>0.05, col=g.yok||g.flags.includes("veri")?"#F0A03C":on?"#5CD07A":"#7D93A8";
    s+=`<rect x="${gx-9}" y="${TOP-26}" width="18" height="26" rx="2" fill="${on?"#5CD07A":"#526E83"}" opacity="${on?.9:.6}"/>`;
    s+=`<line x1="${gx}" y1="${TOP-40}" x2="${gx}" y2="${TOP-26}" stroke="${col}" stroke-width="2"/>`;
    s+=`<circle cx="${gx}" cy="${TOP+CH/2}" r="12" fill="#384B5A" stroke="${col}" stroke-width="1.8"/>`;
    s+=`<line x1="${gx}" y1="${TOP+CH/2-12}" x2="${gx}" y2="${TOP+CH/2+12}" stroke="${col}" stroke-width="1.4"/>`;
    s+=`<line x1="${gx}" y1="${TOP+CH}" x2="${gx}" y2="${TOP+CH+18}" stroke="${col}" stroke-width="2"/>`;
    s+=`<path d="M${gx-5} ${TOP+CH+18} L${gx+5} ${TOP+CH+18} L${gx} ${TOP+CH+27} Z" fill="${col}"/>`;
    s+=`<rect x="${gx-GW/2+6}" y="${TOP+CH+34}" width="${GW-12}" height="40" rx="5" fill="#3D5262" stroke="${on?"#6F8EA5":"#526E83"}"/>`;
    s+=T(gx,TOP+CH+50,kisa(g)+(g.flags.includes("veri")?" ⚠":""),{s:10,a:"middle",f:g.flags.includes("veri")?"#F0A03C":"#93AECB"});
    s+=T(gx,TOP+CH+66,(on?nf(g.q,1)+" m³/sag":"ýapyk"),{s:10.5,a:"middle",w:600,f:on?"#E6EFF8":"#9AABBC",m:1});
    x+=GW;
  });
  return s+"</svg>";
}

/* ---------- SAYAÇ LİSTESİ ---------- */
let LQ="",LT="*",LM="*";
const TIP_SEC=[["ana","Esasy turba / şaha başy"],["sazlayjy","Sazlaýjy"],["saka","SAKA"],["gatla","Gatla"]];
P.liste=()=>{
  const var1=METERS.filter(m=>!m.yok).length, tn=VERI.tanalmadyk.length;
  return `<div class="h1row"><h1>Hasaplaýjylaryň Sanawy</h1><span class="crumb">${METERS.length} akym ölçeýji · maglumat binýadyndan</span></div>
  <div class="kpirow" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
    ${kpi("⧉","#39B6EE","Hasaplaýjy",METERS.length,"","Nokat atlaryndan tapylan + garaşylýan")}
    ${kpi("✓","#5CD07A","Maglumatly",var1,"","Maglumat binýadynda bar")}
    ${kpi("✕",METERS.length-var1?"#F0A03C":"#5CD07A","Maglumat ýok",METERS.length-var1,"","ulgam.json-da garaşylýan")}
    ${kpi("?",tn?"#F2635A":"#5CD07A","Tanalmadyk nokat",tn,"",tn?'<a href="#ayar" class="wr">Sazlamalarda belläň →</a>':"Ählisi tanaldy")}
  </div>
  ${tn?`<div class="pan" style="margin:0 0 14px;border-color:#8E3B36"><div class="pb" style="color:var(--tx2);font-size:12.5px;line-height:1.8">
    <b style="color:var(--rd)">Tanalmadyk hasaplaýjy nokatlary:</b> ${VERI.tanalmadyk.map(n=>esc(n.ad)).join(", ")} — <a href="#ayar" style="color:var(--cy)">Sazlamalar</a> bölüminde belläň ýa-da gizläň.<br>
    Ady düzgüne laýyk bolmaly: MT1 · MT2_1 · MT1_S2 · MT1_1_S3 · Saka4 · BA4_G3 (+ _Akym / _Toplam / _Jemi).</div></div>`:""}
  <div class="pan" style="margin-top:0"><div class="ph">
    <div style="display:flex;gap:9px;flex-wrap:wrap">
      <input type="search" id="lq" placeholder="Gözle: BA-4 G-3, MT-2/1, MT2_1_S2…" value="${esc(LQ)}">
      <select class="sel" id="lm"><option value="*">Ähli turbalar</option>${MTS.map(m=>`<option ${LM==="MT-"+m?"selected":""}>MT-${m}</option>`).join("")}</select>
      <select class="sel" id="lt"><option value="*">Ähli görnüşler</option>
        ${TIP_SEC.map(([t,a])=>`<option value="${t}" ${LT===t?"selected":""}>${a}</option>`).join("")}</select>
    </div><span class="crumb" id="lcnt"></span></div>
    <div class="scroll scrollY" style="max-height:640px"><table id="ltbl"><thead><tr>
      <th>ADY</th><th class="m">Nokat</th><th>Görnüş</th><th>Ýerleşişi</th><th class="m">Häzirki m³/sag</th>
      <th class="m">Şu gün</th><th class="m">Şu aý</th><th>Akym nokady</th><th>Jemi nokady</th><th>Soňky ýazgy</th><th>Ýagdaýy</th></tr></thead><tbody></tbody></table></div>
  </div>`;
};
function fillListe(){
  const L=METERS.filter(m=>(LM==="*"||("MT-"+m.mt)===LM)&&(LT==="*"||m.tip===LT)&&
    (!LQ||(m.ad+" "+m.fid+" "+yer(m)).toLowerCase().includes(LQ.toLowerCase())));
  const c=document.getElementById("lcnt"); if(c)c.textContent=L.length+" / "+METERS.length+" hasaplaýjy";
  const tb=document.querySelector("#ltbl tbody"); if(!tb)return;
  tb.innerHTML=L.map(m=>{const p=per3([m]);
    return `<tr><td><b>${m.ad}</b></td><td class="m" style="color:var(--tx3)">${esc(m.fid)}</td>
    <td><span class="tg ${m.tip==="ana"?"tg-c":m.tip==="gatla"?"tg-tr":m.tip==="saka"?"tg-sz":"tg-n"}">${tipAd(m)}</span></td>
    <td style="color:var(--tx2)">${yer(m)}</td>
    <td class="m">${nf(m.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td>
    <td class="mono" style="color:var(--tx3)">${esc(m.akym||"—")}</td><td class="mono" style="color:var(--tx3)">${esc(m.toplam||"—")}</td>
    <td class="mono">${m.son?new Date(m.son).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</td>
    <td>${durum(m)}</td></tr>`}).join("");
}

/* ---------- RAPORLAR ---------- */
const totAt=(m,d)=>m.cum[Math.max(0,Math.min(DAYS,d))];

let R={fid:"", tip:"tuketim", from:"", to:"", per:"d", page:1, size:10, all:false};
(function(){
  const a=dd(LAST-16), b=dd(LAST);
  R.from=isoD(a); R.to=isoD(b);
  const pref=HEADS.find(m=>!m.yok)||METERS.find(m=>!m.yok)||METERS[0];
  R.fid=pref?pref.fid:"";
})();
const dIdx=s=>Math.max(0,Math.min(LAST,Math.round((new Date(s+"T00:00:00")-START)/86400000)));
const trDate=s=>{const p=s.split("-");return p[2]+"."+p[1]+"."+p[0]};
const TIP_RAP={tuketim:"Sarp ediliş hasabaty",debi:"Akym hasabaty",toplam:"Totalizator hasabaty",denge:"Deňagramlylyk hasabaty"};
const PER_AD={d:"Günlük",m:"Aýlyk",y:"Ýyllyk"};
const repMeter=()=>METERS.find(x=>x.fid===R.fid);
const repTip=m=>R.tip==="denge"&&!dengeOf(m)?"tuketim":R.tip;
const bolum=m=>yer(m)+(m.tip==="saka"?" › SAKA-"+m.saka:"");

/* döwürler: saýlanan aralyk günlük / aýlyk / ýyllyk bölünýär */
function donemler(){
  const a=dIdx(R.from), b=dIdx(R.to), o=[];
  if(R.per==="d"){for(let d=a;d<=b;d++)o.push({lbl:trDate(isoD(dd(d))),si:d,ei:d})}
  else if(R.per==="m"){
    let c=new Date(dd(a).getFullYear(),dd(a).getMonth(),1);
    while(c<=dd(b)){
      const si=Math.max(a,Math.round((c-START)/86400000));
      const e=new Date(c.getFullYear(),c.getMonth()+1,0);
      const ei=Math.min(b,Math.round((e-START)/86400000));
      if(ei>=si)o.push({lbl:MONS[c.getMonth()]+" "+c.getFullYear(),si,ei});
      c=new Date(c.getFullYear(),c.getMonth()+1,1);
    }
  } else {
    for(let y=dd(a).getFullYear();y<=dd(b).getFullYear();y++){
      const si=Math.max(a,Math.round((new Date(y,0,1)-START)/86400000));
      const ei=Math.min(b,Math.round((new Date(y,11,31)-START)/86400000));
      if(ei>=si)o.push({lbl:String(y),si,ei});
    }
  }
  return o;
}
/* dönem satırları: totalizer başı/sonu + delta */
function repRows(){
  const m=repMeter(); if(!m)return{m:null,rows:[]};
  const rows=donemler().map(({lbl,si,ei})=>{
    const st=totAt(m,si), en=totAt(m,ei+1), tk=en-st;
    let mn=Infinity,mx=-Infinity;
    for(let d=si;d<=ei;d++){if(Number.isFinite(m.amn[d]))mn=Math.min(mn,m.amn[d]);if(Number.isFinite(m.amx[d]))mx=Math.max(mx,m.amx[d])}
    const h2=ei>=LAST?Math.max(1,(ei-si)*24+(Date.now()-TODAY.getTime())/3600000):(ei-si+1)*24;   // bu gün: geçen sagatlar
    return {lbl,si,ei,st,en,tk,ort:tk/h2,mn:Number.isFinite(mn)?mn:NaN,mx:Number.isFinite(mx)?mx:NaN,ok:tk>=0};
  });
  return {m,rows};
}
/* deňagramlylyk setirleri: giren (baş) − çykan (Σ çykyş) */
function repDenge(){
  const m=repMeter(), D=dengeOf(m); if(!D)return{m,D:null,rows:[]};
  return {m,D,rows:donemler().map(({lbl,si,ei})=>Object.assign({lbl,si,ei},D.ara(si,ei)))};
}

function chReport(rows){
  rows=rows.map(r=>({...r,tk:_f(r.tk)}));
  const W=880,H=300,ml=64,mr=16,mt=30,mb=32,iw=W-ml-mr,ih=H-mt-mb;
  const max=Math.max(...rows.map(r=>r.tk),1)*1.22;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
  for(let i=0;i<=5;i++){const y=mt+ih-ih*i/5;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72" stroke-dasharray="3 4"/>`;
    s+=`<text x="${ml-8}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9.5">${nfc(max*i/5)}</text>`}
  s+=`<text x="${ml-46}" y="${mt+ih/2}" fill="#9AABBC" font-size="9.5" transform="rotate(-90 ${ml-46} ${mt+ih/2})" text-anchor="middle">m³</text>`;
  const n=rows.length, pts=rows.map((r,i)=>[ml+(n>1?iw*i/(n-1):iw/2), mt+ih-ih*(r.tk/max)]);
  const p=pts.map(a=>a[0].toFixed(1)+","+a[1].toFixed(1)).join(" ");
  s+=`<defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#39B6EE" stop-opacity=".45"/><stop offset="100%" stop-color="#39B6EE" stop-opacity=".02"/></linearGradient></defs>`;
  s+=`<polygon points="${ml},${mt+ih} ${p} ${W-mr},${mt+ih}" fill="url(#rg)"/>`;
  s+=`<polyline points="${p}" fill="none" stroke="#5FD0FF" stroke-width="2.2"/>`;
  const every=n>26?Math.ceil(n/16):1;
  pts.forEach((a,i)=>{
    s+=`<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="3.2" fill="#384B5A" stroke="#5FD0FF" stroke-width="1.8"><title>${rows[i].lbl}: ${nf(rows[i].tk)} m³</title></circle>`;
    if(i%every===0&&n<=34)s+=`<text x="${a[0].toFixed(1)}" y="${(a[1]-11).toFixed(1)}" text-anchor="middle" fill="#93AECB" font-family="ui-monospace,Consolas,monospace" font-size="9.5">${nf(rows[i].tk)}</text>`;
    if(i%every===0)s+=`<text x="${a[0].toFixed(1)}" y="${H-9}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${rows[i].lbl.length>7?rows[i].lbl.slice(0,5):rows[i].lbl}</text>`;
  });
  return s+"</svg>";
}

P.rapor=()=>{
  const m=repMeter();
  if(!m)return `<div class="ok-box">Hasaplaýjy ýok.</div>`;
  const tip=repTip(m), D=dengeOf(m);
  const opts=METERS.map(x=>`<option value="${esc(x.fid)}" ${x.fid===R.fid?"selected":""}>${esc(x.fid)} / ${x.ad}</option>`).join("");
  const form=`
  <div class="h1row noprint"><h1>Hasabat taýýarlamak</h1>
    <span class="crumb">Baş sahypa › Hasabatlar › <b>${TIP_RAP[tip]}</b></span></div>
  <div class="pan noprint" style="margin-top:0"><div class="pb">
    <div class="rgrid">
      <label><span>Hasaplaýjy saýla</span><select class="sel" id="rFid">${opts}</select></label>
      <label><span>Hasabat görnüşi</span><select class="sel" id="rTip">
        ${Object.entries(TIP_RAP).map(([k,a])=>`<option value="${k}" ${tip===k?"selected":""} ${k==="denge"&&!D?"disabled":""}>${a}${k==="denge"&&!D?" (bu hasaplaýjy üçin ýok)":""}</option>`).join("")}
      </select></label>
      <label><span>Başlangyç</span><input class="sel" type="date" id="rFrom" value="${R.from}" min="${isoD(START)}" max="${isoD(dd(LAST))}"></label>
      <label><span>Ahyry</span><input class="sel" type="date" id="rTo" value="${R.to}" min="${isoD(START)}" max="${isoD(dd(LAST))}"></label>
      <label><span>Döwür</span><select class="sel" id="rPer">
        ${Object.entries(PER_AD).map(([k,a])=>`<option value="${k}" ${R.per===k?"selected":""}>${a}</option>`).join("")}
      </select></label>
      <div class="racts">
        <button class="btn pri" id="rGen">▶ Hasabaty döret</button>
        <button class="btn" id="rPdf" style="border-color:#8E3B36;color:#F2A9A3">⎙ PDF çykar</button>
        <button class="btn" id="rXls" style="border-color:#2E6B4E;color:#8FE0AC">⤓ Excel / CSV</button>
      </div>
    </div>
  </div></div>`;
  const cykis=`
  <div class="pan noprint"><div class="ph"><h2>Çykyş</h2></div>
    <div class="pb" style="color:var(--tx2);line-height:1.9;font-size:12.5px">
      <b style="color:#F2A9A3">PDF çykar</b> → brauzeriň çap ediş penjiresini açýar; niýet hökmünde
      “PDF hökmünde ýatda sakla” saýlanda hasabat açyk reňkli, sahypa görnüşinde ýatda saklanýar.
      Tablisanyň hemmesi çap edilýär, sahypalara bölünmeýär.<br>
      <b style="color:#8FE0AC">Excel / CSV</b> → nokatly otur bilen bölünen, onluk otur bilen; Excel-de göni açylýar.
      <b>Suw deňagramlylygy</b> sahypasynda “Daşyna çykar” ähli esasy turbalaryň 30 günlük hasabatyny çap edýär.
    </div>
    <div class="pb" id="csvWrap" style="display:none;padding-top:0">
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn" id="csvCopy">Panele göçür</button></div>
      <textarea id="csvTa" readonly></textarea></div>
  </div>`;
  return form+(tip==="denge"?raporDenge():raporSayac())+cykis;
};
function pager(n){
  const pages=Math.max(1,Math.ceil(n/R.size));
  if(R.page>pages)R.page=pages;
  return {pages,html:`<div class="pgbar noprint">
      <span class="crumb">Jemi ${n} ýazgy · sahypa ${R.page}/${pages}</span>
      <div style="display:flex;gap:5px;align-items:center;margin-left:auto">
        <button class="btn pgb" data-pg="${Math.max(1,R.page-1)}">‹</button>
        ${Array.from({length:Math.min(5,pages)},(_,i)=>{
          const st=Math.max(1,Math.min(R.page-2,pages-4)), k=st+i;
          return k<=pages?`<button class="btn pgb ${k===R.page?"pri":""}" data-pg="${k}">${k}</button>`:""}).join("")}
        <button class="btn pgb" data-pg="${Math.min(pages,R.page+1)}">›</button>
        <select class="sel" id="rSize" style="margin-left:6px">
          ${[10,25,50,100].map(k=>`<option ${R.size===k?"selected":""}>${k}</option>`).join("")}
        </select><span class="crumb">/ sahypa</span>
      </div></div>`};
}
function raporSayac(){
  const {m,rows}=repRows();
  const tot=rows.reduce((a,b)=>a+b.tk,0);
  const ort=rows.length?rows.reduce((a,b)=>a+b.ort,0)/rows.length:0;
  const mx=rows.filter(r=>Number.isFinite(r.mx)).reduce((a,b)=>!(b.mx<=a.mx)?b:a,{mx:NaN,lbl:"—"});
  const mn=rows.filter(r=>Number.isFinite(r.mn)).reduce((a,b)=>!(b.mn>=a.mn)?b:a,{mn:NaN,lbl:"—"});
  const pg=pager(rows.length), show=rows.slice((R.page-1)*R.size,R.page*R.size);
  return `
  <div id="printArea">
  <div class="kpirow" style="margin-top:14px">
    ${kpi("⊙","#39B6EE","Saýlanan hasaplaýjy",esc(m.fid),"",m.ad+" · "+tipAd(m))}
    ${kpi("◆","#5FD0FF","Jemi sarp ediliş",nf(tot),"m³","Saýlanan döwür")}
    ${kpi("≋","#5CD07A","Ortaça akym",nf(ort,1),"m³/sag","Saýlanan döwür")}
    ${kpi("↗","#A78BFA","Iň ýokary akym",nf(mx.mx,1),"m³/sag",mx.lbl)}
    ${kpi("↘","#F0A03C","Iň pes akym",nf(mn.mn,1),"m³/sag",mn.lbl)}
    ${kpi("▤","#93AECB","Ýazgy sany",rows.length,"","Jemi ýazgy")}
  </div>
  <div class="gm" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Döwürleýin sarp ediliş grafigi (m³)</h2>
      <span class="crumb"><span style="color:#5FD0FF">■</span> ${esc(m.fid)} / ${m.ad}</span></div>
      <div class="pb">${rows.length?chReport(rows):'<div class="ok-box">Saýlanan aralykda ýazgy ýok</div>'}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Hasabatyň gysgaça beýany</h2></div><div class="pb">
      <div class="kv"><span>Hasaplaýjynyň ady</span><b>${m.ad}</b></div>
      <div class="kv"><span>Flowmeter ID</span><b>${esc(m.fid)}</b></div>
      <div class="kv"><span>Ýerleşişi</span><b>${yer(m)} · ${tipAd(m)}</b></div>
      <div class="kv"><span>Hasabat döwri</span><b>${trDate(R.from)} – ${trDate(R.to)}</b></div>
      <div class="kv"><span>Döwür</span><b>${PER_AD[R.per]} (${rows.length} ýazgy)</b></div>
      <div class="kv"><span>Başlangyç totalizator</span><b>${nf(rows.length?rows[0].st:0)} m³</b></div>
      <div class="kv"><span>Ahyrky totalizator</span><b>${nf(rows.length?rows[rows.length-1].en:0)} m³</b></div>
      <div class="kv" style="color:var(--cy2)"><span>Jemi sarp ediliş (delta)</span><b>${nf(tot)} m³</b></div>
      <div class="kv"><span>Jemi nokady</span><b>${esc(m.toplam||"—")}</b></div>
      <div class="kv"><span>Akym nokady</span><b>${esc(m.akym||"—")}</b></div>
      <div class="kv"><span>Soňky ýazgy</span><b>${m.son?new Date(m.son).toLocaleString("ru-RU"):"—"}</b></div>
    </div></div>
  </div>
  <div class="pan"><div class="ph"><h2>Jikme-jik hasabat tablisasy</h2>
    <span class="crumb noprint">Sarp ediliş = ahyrky totalizator − başlangyç totalizator</span></div>
    <div class="scroll"><table><thead><tr>
      <th>Döwür</th><th class="m">Başlangyç jemi (m³)</th><th class="m">Ahyrky jemi (m³)</th>
      <th class="m">Sarp ediliş (m³)</th><th class="m">Ortaça akym (m³/sag)</th>
      <th class="m">Iň pes</th><th class="m">Iň ýokary</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${show.map(r=>`<tr><td><b>${r.lbl}</b></td><td class="m">${nf(r.st)}</td><td class="m">${nf(r.en)}</td>
        <td class="m" style="color:var(--cy2)">${nf(r.tk)}</td><td class="m">${nf(r.ort,1)}</td>
        <td class="m">${nf(r.mn,1)}</td><td class="m">${nf(r.mx,1)}</td>
        <td>${r.tk<0?'<span class="tg tg-tr">Otrisatel Δ</span>':!(r.tk>0)?'<span class="tg tg-n">Maglumat ýok</span>':'<span class="tg tg-ok">✓ Tamamlandy</span>'}</td></tr>`).join("")}
      <tr class="tot"><td>JEMI</td><td class="m">${nf(rows.length?rows[0].st:0)}</td>
        <td class="m">${nf(rows.length?rows[rows.length-1].en:0)}</td><td class="m">${nf(tot)}</td>
        <td class="m">${nf(ort,1)}</td><td class="m">${nf(mn.mn,1)}</td><td class="m">${nf(mx.mx,1)}</td><td></td></tr>
    </tbody></table></div>
    ${pg.html}
  </div>
  </div>`;
}
function raporDenge(){
  const {m,D,rows}=repDenge();
  const G=rows.reduce((a,b)=>a+b.g,0), Cc=rows.reduce((a,b)=>a+b.c,0), f=G-Cc, p=G?f/G*100:NaN;
  const mx=rows.filter(r=>Number.isFinite(r.p)).reduce((a,b)=>!(b.p<=a.p)?b:a,{p:NaN,lbl:"—"});
  const pg=pager(rows.length), show=rows.slice((R.page-1)*R.size,R.page*R.size);
  return `
  <div id="printArea">
  <div class="kpirow" style="margin-top:14px">
    ${kpi("⊙","#39B6EE","Baş hasaplaýjy",esc(m.fid),"",m.ad+" · "+tipAd(m))}
    ${kpi("◉","#39B6EE","Giren",nf(G),"m³","Baş hasaplaýjy")}
    ${kpi("⑃","#5CD07A","Çykan (Σ çykyş)",nf(Cc),"m³",ok(D.cyk).length+" hasaplaýjy")}
    ${kpi("⚖",GC[yGrade(p)],"Ýitgi",nf(f),"m³",`%${nf(p,2)} · çäk %${nf(CAK,0)}`)}
    ${kpi("↗","#F0A03C","Iň ýokary ýitgi",nf(mx.p,1),"%",mx.lbl)}
    ${kpi("▤","#93AECB","Ýazgy sany",rows.length,"",PER_AD[R.per])}
  </div>
  ${eksikPan(D)}
  <div class="gm" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Giren / çykan (m³)</h2>
      <span class="crumb"><span style="color:#39B6EE">■</span> giren &nbsp;<span style="color:#5CD07A">■</span> çykan &nbsp;<span style="color:#F0A03C">■</span> ýitgi</span></div>
      <div class="pb">${rows.length?chHat(rows,{h:300,W:880}):'<div class="ok-box">Saýlanan aralykda ýazgy ýok</div>'}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Hasabatyň gysgaça beýany</h2></div><div class="pb">
      <div class="kv"><span>Bölüm</span><b>${bolum(m)}</b></div>
      <div class="kv"><span>Baş hasaplaýjy</span><b>${esc(m.fid)}</b></div>
      <div class="kv"><span>Çykyş hasaplaýjylary</span><b>${ok(D.cyk).length}</b></div>
      <div class="kv"><span>Hasabat döwri</span><b>${trDate(R.from)} – ${trDate(R.to)}</b></div>
      <div class="kv"><span>Döwür</span><b>${PER_AD[R.per]} (${rows.length} ýazgy)</b></div>
      <div class="kv"><span>Giren jemi</span><b>${nf(G)} m³</b></div>
      <div class="kv"><span>Çykan jemi</span><b>${nf(Cc)} m³</b></div>
      <div class="kv" style="color:${GC[yGrade(p)]}"><span>Ýitgi</span><b>${nf(f)} m³ · %${nf(p,2)}</b></div>
      <div class="kv"><span>Ýagdaýy</span><b>${yTag(p)}</b></div>
    </div></div>
  </div>
  <div class="pan"><div class="ph"><h2>Jikme-jik deňagramlylyk tablisasy</h2>
    <span class="crumb noprint">Ýitgi = giren − çykan · % girene görä</span></div>
    <div class="scroll"><table><thead><tr>
      <th>Döwür</th><th class="m">Giren (m³)</th><th class="m">Çykan Σ (m³)</th><th class="m">Ýitgi (m³)</th><th class="m">Ýitgi %</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${show.map(r=>`<tr><td><b>${r.lbl}</b></td><td class="m">${nf(r.g)}</td><td class="m">${nf(r.c)}</td>
        <td class="m">${nf(r.f)}</td><td class="m" style="color:${GC[yGrade(r.p)]}">${nf(r.p,2)}</td><td>${yTag(r.p)}</td></tr>`).join("")}
      <tr class="tot"><td>JEMI</td><td class="m">${nf(G)}</td><td class="m">${nf(Cc)}</td><td class="m">${nf(f)}</td><td class="m">${nf(p,2)}</td><td></td></tr>
    </tbody></table></div>
    ${pg.html}
  </div>
  </div>`;
}

/* ---------- SAZLAMALAR: nokatlaryň tanalyşy, el bilen bellemek, SAKA → MT ---------- */
const CLS={hasaplayjy:["Hasaplaýjy","tg-ok"],tanalmadyk:["Tanalmadyk","tg-rd"],gosmaca:["Goşmaça","tg-c"],beyleki:["Hasaplaýjy däl","tg-n"],gizlenen:["Gizlenen","tg-tr"]};
const CLS_S={tanalmadyk:0,hasaplayjy:1,gizlenen:2,gosmaca:3,beyleki:4};
const TIP_ED=[["ana","Esasy turba / şaha başy"],["sazlayjy","Sazlaýjy"],["saka","SAKA"],["gatla","Gatla (beton akaba)"],["gizle","Gizle (hasaplaýjy däl)"]];
const ayBas=()=>({atlar:Object.assign({},U.atlar||{}),gizle:(U.gizle||[]).map(String),
  saka_mt:Object.fromEntries(Object.entries(U.saka_mt||{}).map(([k,v])=>[k,+v])),saka_sub:Object.fromEntries(Object.entries(U.saka_sub||{}).map(([k,v])=>{const n=subNorm(v);return [k,n%1?subLbl(n):n]}))});
const AY=Object.assign(ayBas(),{ed:{},ac:new Set(),q:"",f:"*",msg:""});
const ayCfg=()=>Object.assign({},U,{atlar:AY.atlar,gizle:AY.gizle,saka_mt:AY.saka_mt,saka_sub:AY.saka_sub});
const nrm=o=>Object.keys(o||{}).sort().map(k=>k+"="+o[k]);
function ayFark(){              // ýatda saklanmadyk üýtgeşmeler
  const b=ayBas(), d=(x,y)=>{const a=new Set(x),c=new Set(y);return [...a].filter(v=>!c.has(v)).length+[...c].filter(v=>!a.has(v)).length};
  return d(nrm(AY.atlar),nrm(b.atlar))+d(AY.gizle,b.gizle)+d(nrm(AY.saka_mt),nrm(b.saka_mt))+d(nrm(AY.saka_sub),nrm(b.saka_sub));
}
const ayMTL=()=>{const s=new Set([...MTS,...(BEKET?BEKET.toplumlar.flatMap(t=>t.mts):[])]);const mx=Math.max(4,...s);for(let i=1;i<=mx+1;i++)s.add(i);return [...s].sort((a,b)=>a-b)};
function edBasla(n){
  const s=n.s, t=n.cls==="gizlenen"?"gizle":s?s.tip:"";
  return {tip:t,mt:s?s.mt||"":"",sub:s?Math.floor(s.sub):0,ast:s?Math.round((s.sub%1)*10):0,no:s?(s.tip==="sazlayjy"?s.saz:s.tip==="saka"?s.saka:s.tip==="gatla"?s.gatla:""):"",
    ba:s&&s.tip==="gatla"?s.saka:"",olc:n.olcum||"jemi",yeke:n.yeke};
}
function kokTap(e){
  const mt=+e.mt, no=+e.no, ba=+e.ba, sub=(+e.sub||0)?(+e.sub)+(+e.ast||0)/10:0;
  if(e.tip==="ana"&&mt)return kokAt("ana",mt,sub);
  if(e.tip==="sazlayjy"&&mt&&no)return kokAt("sazlayjy",mt,sub,no);
  if(e.tip==="saka"&&no)return kokAt("saka",0,0,no);
  if(e.tip==="gatla"&&ba&&no)return kokAt("gatla",0,0,no,ba);
  return null;
}
function edUygula(k){
  const e=AY.ed[k]; if(!e)return;
  AY.gizle=AY.gizle.filter(x=>x!==k); delete AY.atlar[k];
  if(e.tip==="gizle")AY.gizle.push(k);
  else{
    const c=kokTap(e);
    if(c){
      const s0=e.yeke?null:parseRoot(k,ayCfg());
      if(e.yeke)AY.atlar[k]=c+(e.olc==="akym"?"_Akym":"_Jemi");
      else if(!s0||s0.kok.toUpperCase()!==c.toUpperCase())AY.atlar[k]=c;
    }
  }
}
function edHtml(n){
  const k=n.kok, e=AY.ed[k]||(AY.ed[k]=edBasla(n));
  const o=(v,t,sel)=>`<option value="${esc(v)}" ${String(sel)===String(v)?"selected":""}>${t}</option>`;
  const lb=(t,h)=>`<label><span>${t}</span>${h}</label>`;
  let h=`<div class="ayed" data-k="${esc(k)}">`;
  h+=lb("Görnüş",`<select class="sel sm" data-f="tip">${o("","— saýlaň —",e.tip)}${TIP_ED.map(([v,t])=>o(v,t,e.tip)).join("")}</select>`);
  if(e.tip==="ana"||e.tip==="sazlayjy"){
    h+=lb("MT",`<select class="sel sm" data-f="mt">${o("","—",e.mt)}${ayMTL().map(i=>o(i,"MT-"+i,e.mt)).join("")}</select>`);
    h+=lb(e.tip==="ana"?"Baş / şaha":"Gövde / şaha",`<select class="sel sm" data-f="sub">${o(0,e.tip==="ana"?"MT başy":"gövde",e.sub)}${[1,2,3,4,5,6,7,8,9].map(i=>o(i,(e.mt?"MT-"+e.mt:"MT")+"/"+i,e.sub)).join("")}</select>`);
    if(+e.sub)h+=lb("Goşmaça şaha",`<select class="sel sm" data-f="ast">${o(0,"—",e.ast||0)}${[1,2,3].map(i=>o(i,(e.mt?"MT-"+e.mt:"MT")+"/"+e.sub+"*".repeat(i),e.ast||0)).join("")}</select>`);
  }
  if(e.tip==="gatla")h+=lb("Beton akaba",`<select class="sel sm" data-f="ba">${o("","—",e.ba)}${[...new Set([...SAKAS.map(s=>s.saka),1,2,3,4,5,6,7,8])].sort((a,b)=>a-b).map(i=>o(i,"BA-"+i,e.ba)).join("")}</select>`);
  if(e.tip==="sazlayjy"||e.tip==="saka"||e.tip==="gatla")
    h+=lb({sazlayjy:"Nomer (S-)",saka:"Nomer (SAKA-)",gatla:"Nomer (G-)"}[e.tip],`<input class="sel sm num" type="number" min="1" max="99" data-f="no" value="${esc(e.no)}">`);
  if(e.yeke&&e.tip&&e.tip!=="gizle")h+=lb("Ölçeg",`<select class="sel sm" data-f="olc">${o("akym","Akym",e.olc)}${o("jemi","Jemi (totalizator)",e.olc)}</select>`);
  const c=e.tip==="gizle"?null:kokTap(e), s=c&&parseRoot(c,ayCfg());
  const dub=c&&VERI.NOK.some(x=>x.kok!==k&&x.cls==="hasaplayjy"&&x.s&&x.s.kok.toUpperCase()===c.toUpperCase()&&(!e.yeke||x.olcum===e.olc));
  h+=`<div class="aypv">${e.tip==="gizle"?'<span class="tg tg-tr">gizlenýär</span> sahypada görkezilmez':
    s?`→ <b>${s.ad}</b> <span class="mono" style="color:var(--tx3)">${c}${e.yeke?(e.olc==="akym"?"_Akym":"_Jemi"):""}</span>${dub?' <span class="wr">· bu hasaplaýjy eýýäm bar — iki nokat bir hasaplaýjy bolar</span>':""}`:
    '<span style="color:var(--tx3)">görnüşi we nomeri saýlaň</span>'}</div>`;
  if(AY.atlar[k]!=null||AY.gizle.includes(k))h+=`<button class="btn sm" data-ay="asyl" title="Sazlamany aýyr: ady boýunça tanalsyn">Asyl ady</button>`;
  return h+"</div>";
}
const ayNok=()=>nokatlar(VERI.pts,ayCfg());
function ayRow(n,shown){
  const s=n.s, k=n.kok, ed=AY.ac.has(k)&&!shown.has(k), sz=AY.atlar[k]!=null||AY.atlar[n.ad]!=null||AY.gizle.includes(k);
  const no=s?(s.tip==="sazlayjy"?"S-"+s.saz:s.tip==="saka"?"SAKA-"+s.saka:s.tip==="gatla"?"G-"+s.gatla+" (BA-"+s.saka+")":"—"):"—";
  const tip=s?(n.cls==="gosmaca"?"goşmaça · "+esc(n.not):tipAd(s)):n.cls==="beyleki"?"—":"?";
  let h=`<tr class="${n.cls==="tanalmadyk"?"ayun":""}"><td class="mono">${esc(n.ad)}</td><td class="mono" style="color:var(--tx3)">${esc(n.birlik)||"—"}</td>
    <td><span class="tg ${CLS[n.cls][1]}">${CLS[n.cls][0]}</span>${sz?' <span class="tg tg-sz">sazlama</span>':""}</td>
    <td>${tip}</td><td>${s&&s.mt?"MT-"+s.mt:s&&(s.tip==="saka"||s.tip==="gatla")?'<span class="dn">MT ?</span>':"—"}</td>
    <td>${s&&s.sub?subAd(s.mt,s.sub):"—"}</td><td class="mono">${no}</td>
    <td>${n.olcum?(n.olcum==="akym"?"akym":"jemi"):"—"}</td><td>${s&&n.cls!=="beyleki"?"<b>"+s.ad+"</b>":n.not?'<span style="color:var(--tx3)">'+esc(n.not)+"</span>":"—"}</td>
    <td>${n.cls==="tanalmadyk"?"":`<button class="btn sm" data-ay="ac" data-k="${esc(k)}">${ed?"Ýap":"Üýtget"}</button>`}</td></tr>`;
  if(ed){shown.add(k);h+=`<tr class="ayedrow"><td colspan="10">${edHtml(n)}</td></tr>`}
  return h;
}
function ayTablo(N){
  const sr=x=>{const s=x.s,o=s?[s.mt||99,s.tip==="gatla"?1:0,s.saka,s.sub,s.saz,s.gatla]:[99,9,0,0,0,0];return o};
  const L=N.filter(n=>(AY.f==="*"||n.cls===AY.f||(AY.f==="sazlama"&&(AY.atlar[n.kok]!=null||AY.atlar[n.ad]!=null||AY.gizle.includes(n.kok))))&&
    (!AY.q||(n.ad+" "+(n.s?n.s.ad:"")+" "+n.birlik).toLowerCase().includes(AY.q.toLowerCase())))
    .sort((a,b)=>{const d=CLS_S[a.cls]-CLS_S[b.cls];if(d)return d;const x=sr(a),y=sr(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return a.ad.localeCompare(b.ad)});
  const shown=new Set();
  return {n:L.length,html:L.map(n=>ayRow(n,shown)).join("")};
}
P.ayar=()=>{
  const N=ayNok(), cnt=k=>N.filter(n=>n.cls===k).length, tan=N.filter(n=>n.cls==="tanalmadyk"), fk=ayFark();
  const tan0=new Set(VERI.tanalmadyk.map(n=>n.kok));      // ýüklenende tanalmadyklar: bellenenden soň hem şu ýerde galýar
  const tanK=[...new Map(N.filter(n=>n.cls==="tanalmadyk"||tan0.has(n.kok)).map(n=>[n.kok,n])).values()];
  const tanG=new Set(tan.map(n=>n.kok));
  const sakaNo=[...new Set([...SAKAS.map(s=>s.saka),...Object.keys(AY.saka_mt).map(Number),...N.filter(n=>n.s&&(n.s.tip==="saka"||n.s.tip==="gatla")).map(n=>n.s.saka)])].filter(Boolean).sort((a,b)=>a-b);
  const tb=ayTablo(N);
  const o=(v,t,sel)=>`<option value="${v}" ${String(sel)===String(v)?"selected":""}>${t}</option>`;
  return `
  <div class="h1row"><h1>Sazlamalar</h1><span class="crumb">Nokatlaryň tanalyşy · ulgam.json → <b>${esc(station||"?")}</b>
    ${VERI.fayl?"":" · <span class='wr'>ulgam.json okalmady: içki nusga</span>"}${VERI.saklanan?" · synag sazlamalary (brauzerde)":""}</span></div>
  <div class="kpirow">
    ${kpi("⧉","#39B6EE","Jemi nokat",N.length,"","op=points")}
    ${kpi("✓","#5CD07A","Hasaplaýjy nokady",cnt("hasaplayjy"),"",METERS.filter(m=>!m.yok).length+" hasaplaýjy")}
    ${kpi("?",tan.length?"#F2635A":"#5CD07A","Tanalmadyk",tan.length,"",tan.length?"aşakda belläň ýa-da gizläň":"ählisi tanaldy")}
    ${kpi("⋯","#93AECB","Goşmaça / hasaplaýjy däl",cnt("gosmaca")+" / "+cnt("beyleki"),"","rssi, Status · temperatura, dereje…")}
    ${kpi("⊘","#F0A03C","Gizlenen",cnt("gizlenen"),"","sahypada görkezilmeýär")}
    ${kpi("✎",fk?"#F0A03C":"#5CD07A","Üýtgeşme",fk,"",fk?"ýatda saklanmadyk":"ýatda saklanan")}
  </div>

  <div class="pan aybar ${fk?"on":""}"><div class="pb">
    <span>${AY.msg||(fk?`<b class="wr">${fk} üýtgeşme</b> ýatda saklanmady. Ýatda saklanandan soň sahypa täze sazlamalar bilen açylýar.`:
      "Sazlamalar ulgam.json-dan okaldy. Bellemeler, gizlemeler we SAKA → MT baglanyşygy şu ýerde üýtgedilýär.")}</span>
    <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">
      ${DEMO&&VERI.saklanan?'<button class="btn" data-ay="pozt" title="Brauzerde saklanan synag sazlamalaryny poz">Synag sazlamalaryny poz</button>':""}
      <button class="btn" data-ay="yza" ${fk?"":"disabled"}>Yza al</button>
      <button class="btn pri" data-ay="sakla" ${fk?"":"disabled"}>✓ Ýatda sakla</button>
    </div></div></div>

  ${tanK.length?`<div class="pan" style="border-color:${tanG.size?"#8E3B36":"#2E6B4E"}"><div class="ph"><h2 style="color:${tanG.size?"#F2A9A3":"#8FE0AC"}">Tanalmadyk nokatlar · ${tanG.size?tanG.size+" galdy":"ählisi bellendi"}</h2>
      <span class="crumb">Görnüşini, MT / şahany we nomerini saýlaň ýa-da gizläň</span></div>
    <div class="pb" style="display:flex;flex-direction:column;gap:10px">${tanK.map(n=>`<div class="ayun-k ${tanG.has(n.kok)?"":"bellendi"}">
      <div class="ayun-h"><b class="mono">${esc(n.kok)}</b> <span style="color:var(--tx3)">· ${N.filter(x=>x.kok===n.kok).map(x=>esc(x.ad)+" ("+(esc(x.birlik)||"—")+")").join(", ")}${n.not?" · "+esc(n.not):""}</span>
        ${tanG.has(n.kok)?"":`<span class="tg ${n.cls==="gizlenen"?"tg-tr":"tg-ok"}" style="margin-left:6px">${n.cls==="gizlenen"?"gizlenýär":"bellendi"}</span>`}</div>
      ${edHtml(n)}</div>`).join("")}</div></div>`:
    `<div class="pan"><div class="pb" style="color:var(--gr);font-size:12.5px">✓ Ähli hasaplaýjy nokatlary tanaldy.</div></div>`}

  <div class="pan"><div class="ph"><h2>SAKA → MT baglanyşygy</h2>
    <span class="crumb">Atdan çykmaýar: SAKA haýsy esasy turbada (ýa-da şahada) · gatlalar SAKA bilen bile geçýär</span></div>
    <div class="scroll"><table><thead><tr><th>SAKA</th><th>Beton akaba</th><th>Esasy turba</th><th>Gövde / şaha</th><th>Häzirki ýerleşişi</th><th></th></tr></thead><tbody>
      ${sakaNo.map(k=>{const mt=+AY.saka_mt[k]||0, sb=subNorm(AY.saka_sub[k]||0), s=SAKAS.find(x=>x.saka===k);
        const sbL=[...new Set([1,2,3,4,5,6,7,8,9,...(mt?SUBS(mt):[]),...(sb?[sb]:[])])].sort((a,b)=>a-b);
        const ng=N.filter(n=>n.cls==="hasaplayjy"&&n.s.tip==="gatla"&&n.s.saka===k&&n.olcum==="jemi").length;
        return `<tr><td><b>SAKA-${k}</b> <span class="mono" style="color:var(--tx3)">${s?esc(s.fid):"—"}</span></td><td>BA-${k} · ${ng} gatla${BOWET[k]?" · "+BOWET[k]+" böwet":""}</td>
          <td><select class="sel sm" data-sk="${k}" data-f="mt">${o(0,"— saýlanmadyk —",mt)}${ayMTL().map(i=>o(i,"MT-"+i,mt)).join("")}</select></td>
          <td><select class="sel sm" data-sk="${k}" data-f="sub" ${mt?"":"disabled"}>${o(0,"gövde",sb)}${sbL.map(i=>o(subLbl(i),"MT-"+(mt||"?")+"/"+subLbl(i),subLbl(sb))).join("")}</select></td>
          <td>${mt?"MT-"+mt+(sb?" › "+subAd(mt,sb):" gövdesi"):'<span class="dn">MT saýlanmadyk</span>'}</td>
          <td>${mt?'<span class="tg tg-ok">belli</span>':'<span class="tg tg-rd">saýlaň</span>'}</td></tr>`}).join("")||'<tr><td colspan="6" style="color:var(--tx3)">SAKA ýok</td></tr>'}
    </tbody></table></div></div>

  <div class="pan"><div class="ph">
    <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center"><h2 style="margin-right:6px">Ähli nokatlar</h2>
      <input type="search" id="ayq" placeholder="Gözle: nokat ady, MT-2/1, °C…" value="${esc(AY.q)}">
      <select class="sel" id="ayf">${o("*","Ählisi",AY.f)}${Object.entries(CLS).map(([k,v])=>o(k,v[0],AY.f)).join("")}${o("sazlama","Diňe sazlananlar",AY.f)}</select></div>
    <span class="crumb" id="aycnt">${tb.n} / ${N.length} nokat</span></div>
    <div class="scroll scrollY" style="max-height:620px" id="ayscr"><table class="aytbl"><thead><tr>
      <th>Nokat</th><th>Birlik</th><th>Tanalyşy</th><th>Görnüş</th><th>MT</th><th>Şaha</th><th>Nomer</th><th>Ölçeg</th><th>Hasaplaýjy</th><th></th></tr></thead>
      <tbody id="aytb">${tb.html}</tbody></table></div></div>

  <div class="pan"><div class="ph"><h2>Düşündiriş · ulgam.json</h2></div><div class="pb" style="color:var(--tx2);line-height:1.85;font-size:12.5px">
    <b style="color:var(--cy2)">Atdan tanalýar:</b> MT1 (esasy turba başy) · MT2_1 (şaha başy) · MT1_S2 (gövde sazlaýjysy) · MT1_1_S3 (şahanyň sazlaýjysy) ·
    Saka3 · BA3_G2 (beton akabanyň gatlasy); ahyry _Akym (akym) we _Toplam / _Jemi (totalizator). Ahyrdaky _new aýrylýar.<br>
    <b style="color:var(--cy2)">Ýyldyzly goşmaça şahalar</b> (kartada MT-1/2*, MT-1/3**): MT1_2x_S1 (x = *), MT1_3xx_S1, MT1_2*_S1 ýa-da MT1_2$2a_S1, MT1_3a/b/c_S1 (a = *, b = **, c = ***),
    MT1_3_1_S1 … MT1_3_3_S1. Başga at bolsa ýokardaky “Goşmaça şaha” saýlawy bilen el bilen belläň.<br>
    <b style="color:var(--cy2)">ulgam.json</b> (Niagara beketiniň ady boýunça): <span class="mono">saka_mt</span> SAKA → MT ·
    <span class="mono">saka_sub</span> SAKA şahada bolsa · <span class="mono">atlar</span> {"nokat ýa-da kök": "kanonik kök"} · <span class="mono">gizle</span> görkezilmeýän nokatlar ·
    <span class="mono">turba_sira</span> turba boýunça tertip · <span class="mono">bowet</span> böwetleýji gatlalaryň sany · <span class="mono">yitgi_cak</span> ýitgi çägi % ·
    <span class="mono">beket</span> beketiň konfigurasiýasy (toplum → MT) · <span class="mono">garasylyan</span> bolmaly hasaplaýjylar.<br>
    Beketiň düzümi: <b>${BEKET?esc(BEKET.id)+" · "+esc(BEKET.cesme):"tapylmady (diňe MT boýunça)"}</b>${BEKET?" — "+BEKET.toplumlar.map(t=>"Toplum "+t.n+": "+t.pumps.join(", ")+" → "+t.mts.map(mt=>"MT-"+mt).join(", ")).join(" · "):""}.
    ${DEMO?"<br>Synag: ýatda saklanan sazlamalar diňe şu brauzerde saklanýar.":"<br>Niagara: “Ýatda sakla” ulgam.json-yň täze tekstini görkezýär — Workbench: Files → twin → ulgam.json."}
  </div></div>`;
};
function ayYenile(){          // sahypany täzeden çyz, aýlawy saklap
  const sy=window.scrollY, sc=document.getElementById("ayscr"), st=sc?sc.scrollTop:0;
  route(true);
  window.scrollTo({top:sy}); const s2=document.getElementById("ayscr"); if(s2)s2.scrollTop=st;
}
async function aySakla(){
  const c=JSON.parse(JSON.stringify(ayCfg()));
  c.gizle=[...new Set(c.gizle)];
  if(c.hat_sira){if(!c.turba_sira)c.turba_sira=c.hat_sira;delete c.hat_sira}     // köne açar → turba_sira
  const r=await ayarYaz(c);
  AY.msg=r&&r.msg?(r.ok?`<b class="up">${r.msg}</b>`:`<b class="dn">${r.msg}</b>`):AY.msg;
  if(r&&r.reload){ayYenile();setTimeout(()=>location.reload(),900)}
}

/* ---------- ÇAP (PDF) ---------- */
const PCSS=`
   @page{size:A4 landscape;margin:11mm}
   *{box-sizing:border-box}
   body{margin:0;font-family:Inter,Arial,sans-serif;color:#12212F;font-size:10.5px}
   .hd{display:flex;align-items:center;gap:14px;border-bottom:2.5px solid #0B4E6B;padding-bottom:9px}
   .hd img{width:62px;height:62px;object-fit:contain}
   .hd h1{margin:0;font-size:15px;letter-spacing:.04em;color:#0B4E6B}
   .hd .s{font-size:10px;color:#4A5F76;margin-top:3px;line-height:1.5}
   .hd .r{margin-left:auto;text-align:right;font-size:10px;color:#4A5F76;line-height:1.6}
   .kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:11px 0}
   .kpi>div{border:1px solid #C7D2DD;border-radius:5px;padding:6px 8px}
   .kpi .l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#6B7F94}
   .kpi .v{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;margin-top:2px}
   .kpi .u{font-size:8.5px;color:#6B7F94;font-weight:400}
   table{width:100%;border-collapse:collapse;margin-top:4px}
   th,td{border-bottom:1px solid #DDE5EC;padding:4px 7px;font-size:9.5px;text-align:left}
   th{background:#EEF3F8;color:#4A5F76;font-size:8.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:600}
   td.m,th.m{text-align:right;font-family:"IBM Plex Mono",monospace}
   tr.tot td{border-top:1.4px solid #9AAABB;font-weight:700;color:#0B4E6B}
   tr.sub td:first-child{padding-left:18px;color:#4A5F76}
   .row2{display:grid;grid-template-columns:1.55fr 1fr;gap:8px;margin:9px 0 4px;break-inside:avoid}
   .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
   .bx{border:1px solid #C7D2DD;border-radius:5px;padding:7px 9px;break-inside:avoid}
   .bt{font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin-bottom:5px;display:flex;justify-content:space-between}
   .bt2{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin:10px 0 2px}
   table.kv{margin:0}
   table.kv td{border-bottom:1px solid #E7EDF3;padding:3.2px 2px;font-size:9px}
   table.kv td.m{text-align:right;font-family:"IBM Plex Mono",monospace}
   thead{display:table-header-group}
   tr{break-inside:avoid}
   .ft{margin-top:9px;border-top:1px solid #C7D2DD;padding-top:5px;font-size:8px;color:#6B7F94}
   .ok{color:#25683F}.wr{color:#8A5116}.rd{color:#B3261E}
   .pb{break-before:page}`;
const acyk=svg=>svg.replace(/#475F72/g,"#DCE6EE").replace(/#9AABBC/g,"#5B7085").replace(/#93AECB/g,"#33506B")
  .replace(/#5FD0FF/g,"#1478B0").replace(/#39B6EE/g,"#1E8FD0").replace(/#384B5A/g,"#FFFFFF").replace(/#5CD07A/g,"#2E9E52")
  .replace(/#F0A03C/g,"#C77A16").replace(/#3E6B57/g,"#9CCFB0").replace(/#F2635A/g,"#D9453B").replace(/#E6EFF8/g,"#12212F");
const prKls=p=>({ok:"ok",or:"wr",rd:"rd",n:""}[yGrade(p)]);
const prDur=p=>({ok:"Kadaly",or:p<0?"Ölçegi barla":"Üns beriň",rd:"Ýitgi ýokary",n:"Maglumat ýok"}[yGrade(p)]);
const prHead=(sub,right)=>`<div class="hd"><img src="${LOGO}">
     <div><h1>SUW HASAPLAÝJY MAGLUMATLARY</h1>
       <div class="s">Türkmenistanyň Suw Hojalygy baradaky Döwlet Komiteti<br>${BEKET_AD} · ${sub}</div></div>
     <div class="r">${right}</div></div>`;
const prKpi=a=>`<div class="kpi">${a.map(([l,v,u])=>`<div><div class="l">${l}</div><div class="v">${v}${u?` <span class="u">${u}</span>`:""}</div></div>`).join("")}</div>`;
function printDoc(title,body){
  const doc=`<!DOCTYPE html><html lang="tk"><head><meta charset="utf-8"><title>${title}</title><style>${PCSS}</style></head><body>${body}</body></html>`;
  const old=document.getElementById("printFrame"); if(old)old.remove();
  const f=document.createElement("iframe");
  f.id="printFrame"; f.setAttribute("aria-hidden","true");
  f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  document.body.appendChild(f);
  f.srcdoc=doc;
  f.onload=()=>{
    setTimeout(()=>{
      try{ f.contentWindow.focus(); f.contentWindow.print(); }
      catch(err){ showPrintFallback(doc); }
    },350);
  };
  setTimeout(()=>{ if(!f.contentWindow||!f.contentDocument||!f.contentDocument.body) showPrintFallback(doc); },2500);
}
function printReport(){
  const m=repMeter(); if(!m)return;
  const tip=repTip(m), perAd=PER_AD[R.per], tipAd_=TIP_RAP[tip];
  const right=`<b>${m.ad}</b> · ${esc(m.fid)}<br>${yer(m)} · ${tipAd(m)}<br>${trDate(R.from)} – ${trDate(R.to)}`;
  const foot=`<div class="ft">Çeşme: Tridium Niagara · maglumat binýady (TimescaleDB) · Sarp ediliş totalizator tapawudyndan hasaplanýar.<br>
     Hasabat senesi: ${new Date().toLocaleDateString("ru-RU")}</div>`;
  if(tip==="denge"){
    const {D,rows}=repDenge();
    const G=rows.reduce((a,b)=>a+b.g,0), Cc=rows.reduce((a,b)=>a+b.c,0), f=G-Cc, p=G?f/G*100:NaN;
    const ch=rows.length?acyk(chHat(rows,{h:300,W:880})):'<div style="padding:24px;text-align:center;color:#6B7F94">Saýlanan aralykda ýazgy ýok</div>';
    printDoc(m.ad+" · "+tipAd_,prHead(tipAd_+" · "+perAd,right)+
      prKpi([["Baş hasaplaýjy",esc(m.fid)],["Giren",nf(G),"m³"],["Çykan (Σ çykyş)",nf(Cc),"m³"],["Ýitgi",nf(f),"m³"],["Ýitgi",nf(p,2),"%"],["Ýazgy sany",rows.length]])+
      `<div class="row2"><div class="bx"><div class="bt">Giren / çykan (m³) · aşakda ýitgi %</div>${ch}</div>
       <div class="bx"><div class="bt">Hasabatyň gysgaça beýany</div><table class="kv">
         <tr><td>Bölüm</td><td class="m">${bolum(m)}</td></tr>
         <tr><td>Baş hasaplaýjy</td><td class="m">${esc(m.fid)}</td></tr>
         <tr><td>Çykyş hasaplaýjylary</td><td class="m">${ok(D.cyk).length}</td></tr>
         <tr><td>Hasabat döwri</td><td class="m">${trDate(R.from)} – ${trDate(R.to)}</td></tr>
         <tr><td>Döwür</td><td class="m">${perAd} (${rows.length} ýazgy)</td></tr>
         <tr><td>Giren / çykan</td><td class="m">${nf(G)} / ${nf(Cc)} m³</td></tr>
         <tr><td><b>Ýitgi</b></td><td class="m"><b class="${prKls(p)}">${nf(f)} m³ · %${nf(p,2)}</b></td></tr>
         <tr><td>Kabul çägi</td><td class="m">%${nf(CAK,0)}</td></tr>
         <tr><td>Ýagdaýy</td><td class="m ${prKls(p)}">${prDur(p)}</td></tr>
         ${D.eksik.length?`<tr><td>Maglumat ýok</td><td class="m wr">${D.eksik.map(x=>x.ad).join(", ")}</td></tr>`:""}
       </table></div></div>
       <div class="bt2">Jikme-jik deňagramlylyk tablisasy</div>
       <table><thead><tr><th>Döwür</th><th class="m">Giren (m³)</th><th class="m">Çykan Σ (m³)</th><th class="m">Ýitgi (m³)</th><th class="m">Ýitgi %</th><th>Ýagdaýy</th></tr></thead><tbody>
       ${rows.map(r=>`<tr><td><b>${r.lbl}</b></td><td class="m">${nf(r.g)}</td><td class="m">${nf(r.c)}</td><td class="m">${nf(r.f)}</td>
         <td class="m ${prKls(r.p)}">${nf(r.p,2)}</td><td class="${prKls(r.p)}">${prDur(r.p)}</td></tr>`).join("")}
       <tr class="tot"><td>JEMI</td><td class="m">${nf(G)}</td><td class="m">${nf(Cc)}</td><td class="m">${nf(f)}</td><td class="m">${nf(p,2)}</td><td></td></tr></tbody></table>`+foot);
    return;
  }
  const {rows}=repRows();
  const tot=rows.reduce((a,b)=>a+b.tk,0);
  const ort=rows.length?rows.reduce((a,b)=>a+b.ort,0)/rows.length:0;
  const chart=rows.length?acyk(chReport(rows)):'<div style="padding:24px;text-align:center;color:#6B7F94">Saýlanan aralykda ýazgy ýok</div>';
  printDoc(m.ad+" · "+tipAd_,prHead(tipAd_+" · "+perAd,right)+
    prKpi([["Saýlanan hasaplaýjy",esc(m.fid)],["Jemi sarp ediliş",nf(tot),"m³"],["Ortaça akym",nf(ort,1),"m³/sag"],
      ["Başlangyç totalizator",nf(rows.length?rows[0].st:0)],["Ahyrky totalizator",nf(rows.length?rows[rows.length-1].en:0)],["Ýazgy sany",rows.length]])+
    `<div class="row2">
     <div class="bx"><div class="bt">Döwürleýin sarp ediliş grafigi (m³)</div>${chart}</div>
     <div class="bx"><div class="bt">Hasabatyň gysgaça beýany</div>
       <table class="kv">
         <tr><td>Hasaplaýjynyň ady</td><td class="m">${m.ad}</td></tr>
         <tr><td>Flowmeter ID</td><td class="m">${esc(m.fid)}</td></tr>
         <tr><td>Ýerleşişi / görnüş</td><td class="m">${yer(m)} · ${tipAd(m)}</td></tr>
         <tr><td>Hasabat döwri</td><td class="m">${trDate(R.from)} – ${trDate(R.to)}</td></tr>
         <tr><td>Döwür</td><td class="m">${perAd} (${rows.length} ýazgy)</td></tr>
         <tr><td>Başlangyç totalizator</td><td class="m">${nf(rows.length?rows[0].st:0)} m³</td></tr>
         <tr><td>Ahyrky totalizator</td><td class="m">${nf(rows.length?rows[rows.length-1].en:0)} m³</td></tr>
         <tr><td><b>Jemi sarp ediliş (delta)</b></td><td class="m"><b>${nf(tot)} m³</b></td></tr>
         <tr><td>Jemi nokady</td><td class="m">${esc(m.toplam||"—")}</td></tr>
         <tr><td>Akym nokady</td><td class="m">${esc(m.akym||"—")}</td></tr>
       </table></div>
   </div>
   <div class="bt2">Jikme-jik hasabat tablisasy</div>
   <table><thead><tr><th>Döwür</th><th class="m">Başlangyç jemi (m³)</th><th class="m">Ahyrky jemi (m³)</th>
     <th class="m">Sarp ediliş (m³)</th><th class="m">Ortaça akym</th><th class="m">Iň pes</th><th class="m">Iň ýokary</th><th>Ýagdaýy</th></tr></thead><tbody>
     ${rows.map(r=>`<tr><td><b>${r.lbl}</b></td><td class="m">${nf(r.st)}</td><td class="m">${nf(r.en)}</td>
       <td class="m">${nf(r.tk)}</td><td class="m">${nf(r.ort,1)}</td><td class="m">${nf(r.mn,1)}</td><td class="m">${nf(r.mx,1)}</td>
       <td class="${r.tk>0?"ok":"wr"}">${r.tk<0?"Otrisatel Δ":!(r.tk>0)?"Maglumat ýok":"Tamamlandy"}</td></tr>`).join("")}
     <tr class="tot"><td>JEMI</td><td class="m">${nf(rows.length?rows[0].st:0)}</td>
       <td class="m">${nf(rows.length?rows[rows.length-1].en:0)}</td><td class="m">${nf(tot)}</td>
       <td class="m">${nf(ort,1)}</td><td class="m"></td><td class="m"></td><td></td></tr></tbody></table>`+
    foot.replace("· Sarp","· nokat "+esc(m.toplam||"—")+" · Sarp"));
}
/* Suw deňagramlylygy sahypasynyň PDF-i: ähli esasy turbalar, soňky 30 gün */
function printDenge(){
  const B=BEK, a=isoD(dd(LAST-30)), b=isoD(dd(LAST-1));
  const r=(D,lbl,sub,n)=>`<tr class="${sub?"sub":""}"><td>${sub?"└ ":""}<b>${lbl}</b></td><td>${D.gir.map(m=>esc(m.fid)).join(", ")||"—"}</td><td class="m">${n}</td>
    <td class="m">${nf(D.d.g)}</td><td class="m">${nf(D.d.c)}</td><td class="m ${prKls(D.d.p)}">${nf(D.d.p,1)}</td>
    <td class="m">${nf(D.y30.g)}</td><td class="m">${nf(D.y30.c)}</td><td class="m">${nf(D.y30.f)}</td><td class="m ${prKls(D.y30.p)}"><b>${nf(D.y30.p,1)}</b></td>
    <td class="${prKls(D.y30.p)}">${D.bolmaz?"Baş ýok":prDur(D.y30.p)}${D.eksik.length?" · doly däl":""}</td></tr>`;
  const sap=TURBALAR.filter(h=>!h.bolmaz), kad=sap.filter(h=>yGrade(h.y30.p)==="ok").length;
  const tbl=MTS.map(mt=>r(TRB[mt],mtBas(mt),0,ok(TRB[mt].cyk).length)+
    SUBS(mt).filter(x=>SUBD[mt+"/"+x]).map(x=>r(SUBD[mt+"/"+x],subAd(mt,x)+" şaha",1,ok(SUBD[mt+"/"+x].cyk).length)).join("")+
    SAKAS.filter(s=>s.mt===mt&&SAKD[s.saka]).map(s=>r(SAKD[s.saka],"SAKA-"+s.saka+" → BA-"+s.saka,1,s.gs.length)).join("")).join("");
  const eks=[...new Set(TURBALAR.flatMap(h=>h.eksik.map(m=>m.ad)))];
  printDoc("Suw deňagramlylygy · "+BEKET_AD,prHead("Suw deňagramlylygy hasabaty · soňky 30 gün",
      `<b>${MTS.length} esasy turba</b> · ${ok(B.cyk).length} çykyş hasaplaýjysy<br>${trDate(a)} – ${trDate(b)}<br>kabul çägi %${nf(CAK,0)}`)+
    prKpi([["Bekediň çykyşy · 30 gün",nf(B.y30.g),"m³"],["Ölçenen çykyş · 30 gün",nf(B.y30.c),"m³"],["Ýitgi · 30 gün",nf(B.y30.f),"m³"],
      ["Ýitgi · 30 gün",nf(B.y30.p,2),"%"],["Ýitgi · şu gün",nf(B.d.p,2),"%"],["Kadaly turbalar",kad+" / "+TURBALAR.length]])+
    `<table><thead><tr><th>Turba / bölüm</th><th>Baş hasaplaýjy</th><th class="m">Çykyş</th><th class="m">Şu gün giren</th><th class="m">Şu gün çykan</th><th class="m">%</th>
      <th class="m">30 g giren</th><th class="m">30 g çykan</th><th class="m">30 g ýitgi</th><th class="m">30 g %</th><th>Ýagdaýy</th></tr></thead><tbody>${tbl}
      <tr class="tot"><td colspan="2">BEKET JEMI</td><td class="m">${ok(B.cyk).length}</td><td class="m">${nf(B.d.g)}</td><td class="m">${nf(B.d.c)}</td><td class="m">${nf(B.d.p,1)}</td>
        <td class="m">${nf(B.y30.g)}</td><td class="m">${nf(B.y30.c)}</td><td class="m">${nf(B.y30.f)}</td><td class="m">${nf(B.y30.p,1)}</td><td>${prDur(B.y30.p)}</td></tr></tbody></table>
    <div class="g2" style="break-before:page${MTS.length<2?";grid-template-columns:1fr":""}">${MTS.map(mt=>{const D=TRB[mt];
      return `<div class="bx"><div class="bt"><span>${mtBas(mt)} · giren / çykan (m³), ýitgi %</span><b class="${prKls(D.y30.p)}">${D.bolmaz?"—":"%"+nf(D.y30.p,1)+" · "+prDur(D.y30.p)}</b></div>${acyk(chHat(dRows(D,30),MTS.length<2?{h:280,W:1180}:{h:250,W:640}))}</div>`}).join("")}</div>
    <div class="ft">Turba ýitgisi = MT başy − Σ(gövde sazlaýjylary + SAKA + şahalar; şahanyň başy ölçenýän bolsa şaha başy). Bekediň çykyşy = MT başlarynyň jemi.
      Bahalar totalizator tapawudyndan (gündelik); 30 gün — düýne çenli doly günler, şu gün — doly däl gün.${eks.length?"<br>Maglumat ýok / gijikýär: "+eks.join(", ")+".":""}<br>
      Çeşme: Tridium Niagara · maglumat binýady (TimescaleDB) · Hasabat senesi: ${new Date().toLocaleDateString("ru-RU")}</div>`);
}
function showPrintFallback(doc){
  let ov=document.getElementById("prOv");
  if(!ov){
    ov=document.createElement("div"); ov.id="prOv";
    ov.style.cssText="position:fixed;inset:0;background:#384B5A;z-index:99;display:flex;flex-direction:column";
    ov.innerHTML=`<div style="display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #526D82">
        <span style="font-size:12px;color:#93AECB">Çap görnüşi — brauzerde <b>Ctrl+P</b> bilen PDF hökmünde ýatda sakla</span>
        <button class="btn" id="prClose" style="margin-left:auto">Ýap</button></div>
      <iframe id="prFrame" style="flex:1;border:0;background:#fff"></iframe>`;
    document.body.appendChild(ov);
    ov.querySelector("#prClose").onclick=()=>ov.remove();
  }
  ov.querySelector("#prFrame").srcdoc=doc;
}

/* ================= NAV / ROUTER ================= */
const nUns=UNS.filter(h=>["or","rd"].includes(yGrade(h.y30.p))).length;
const NAV=[
 {g:"",items:[["genel","⌂","Umumy Ulgam"],["denge","⚖","Suw deňagramlylygy",nUns]]},
 {g:"Turbaly Suw Geçirijiler (MT)",items:MTS.map(m=>["mt/"+m,"≋","MT-"+m+(turbaAd(m)?' <span class="navsub">'+turbaAd(m)+"</span>":"")])},
 {g:"SAKA → Beton Akaba",items:SAKAS.map(s=>["saka/SAKA-"+s.saka,"◍","SAKA-"+s.saka+' <span class="navsub">'+(s.mt?"MT-"+s.mt+(s.sub?"/"+subLbl(s.sub):""):"MT ?")+"</span>"])},
].filter(s=>s.items.length).concat([
 {g:"",items:[["liste","☰","Hasaplaýjylaryň Sanawy"],["rapor","▤","Hasabatlar"],["ayar","⚙","Sazlamalar",VERI.tanalmadyk.length]]}
]);
document.getElementById("navwrap").innerHTML=NAV.map(s=>
  (s.g?`<div class="navgrp">${s.g}</div>`:`<div style="height:9px"></div>`)+
  s.items.map(([h,ic,t,n])=>`<div class="nav" data-h="${h}"><span class="ic">${ic}</span>${t}${n?`<span class="dotN">${n}</span>`:""}</div>`).join("")).join("");
/* ýokarky ýagdaý: ýitgisi ýokary esasy turba bar bolsa */
(function(){
  const rd=UNS.filter(h=>yGrade(h.y30.p)==="rd"), st=document.getElementById("sysState");
  if(rd.length&&st){st.textContent="Ýitgi ýokary: "+rd.map(h=>h.ad+" %"+nf(h.y30.p,1)).join(", ");
    st.previousElementSibling.className="dotWR";st.parentElement.style.cursor="pointer";st.parentElement.onclick=()=>{location.hash="#denge"}}
})();

function route(keep){
  let h=(location.hash||"#genel").slice(1);
  if(h.startsWith("ps/")){location.hash="#genel";return}       // köne beket sahypalary (PS-21/PS-22) ýok
  const [p,a]=h.split("/");
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("on",n.dataset.h===h));
  const v=document.getElementById("view");
  v.innerHTML = p==="mt"&&MTS.includes(+a)?P.mt(+a) : p==="saka"?P.saka(a) : p==="denge"?P.denge()
    : p==="liste"?P.liste() : p==="rapor"?P.rapor() : p==="ayar"?P.ayar() : P.genel();
  document.getElementById("crumb").innerHTML = {genel:"Umumy Ulgam",denge:"<b>Suw deňagramlylygy</b>",
    mt:"Turbaly Suw Geçirijiler › <b>MT-"+a+"</b>",saka:"SAKA Beton Akaba › <b>"+a+"</b>",
    liste:"<b>Hasaplaýjylaryň Sanawy</b>",rapor:"<b>Hasabatlar</b>",ayar:"<b>Sazlamalar</b>"}[p]||"Umumy Ulgam";
  if(p==="liste")fillListe();
  document.getElementById("side").classList.remove("open");
  if(!keep)window.scrollTo({top:0});
}
addEventListener("hashchange",()=>route());
document.getElementById("navwrap").addEventListener("click",e=>{
  const n=e.target.closest(".nav"); if(n)location.hash="#"+n.dataset.h});
document.getElementById("per").onchange=e=>{PER=e.target.value;route(true)};
document.getElementById("burger").onclick=()=>document.getElementById("side").classList.toggle("open");
document.addEventListener("input",e=>{
  if(e.target.id==="lq"){LQ=e.target.value;fillListe()}
  if(e.target.id==="ayq"){AY.q=e.target.value;const t=ayTablo(ayNok());document.getElementById("aytb").innerHTML=t.html;
    document.getElementById("aycnt").textContent=t.n+" / "+VERI.pts.length+" nokat"}});
document.addEventListener("change",e=>{
  const ed=e.target.closest(".ayed");
  if(ed&&e.target.dataset.f){const k=ed.dataset.k;AY.ed[k][e.target.dataset.f]=e.target.value;
    if(e.target.dataset.f==="tip"&&e.target.value==="ana")AY.ed[k].no="";
    edUygula(k);AY.msg="";ayYenile();return}
  if(e.target.dataset.sk){const k=e.target.dataset.sk,v=subNorm(e.target.value);
    if(e.target.dataset.f==="mt"){if(v)AY.saka_mt[k]=v;else{delete AY.saka_mt[k];delete AY.saka_sub[k]}}
    else{if(v)AY.saka_sub[k]=v%1?subLbl(v):v;else delete AY.saka_sub[k]}
    AY.msg="";ayYenile();return}
  if(e.target.id==="ayf"){AY.f=e.target.value;ayYenile();return}
  if(e.target.id==="lm"){LM=e.target.value;fillListe()}
  if(e.target.id==="lt"){LT=e.target.value;fillListe()}
  if(e.target.id==="rFid"){R.fid=e.target.value;R.page=1;route(true)}
  if(e.target.id==="rTip"){R.tip=e.target.value;R.page=1;route(true)}
  if(e.target.id==="rPer"){R.per=e.target.value;R.page=1;route(true)}
  if(e.target.id==="rSize"){R.size=+e.target.value;R.page=1;route(true)}
  if(e.target.id==="rFrom"){R.from=e.target.value;if(R.from>R.to)R.to=R.from;R.page=1;route(true)}
  if(e.target.id==="rTo"){R.to=e.target.value;if(R.to<R.from)R.from=R.to;R.page=1;route(true)}});
document.addEventListener("click",e=>{
  const ay=e.target.closest("[data-ay]");
  if(ay){const k=ay.dataset.k||(ay.closest(".ayed")||{}).dataset?.k, act=ay.dataset.ay;
    if(act==="ac"){if(AY.ac.has(k))AY.ac.delete(k);else AY.ac.add(k);ayYenile()}
    else if(act==="asyl"){delete AY.atlar[k];AY.gizle=AY.gizle.filter(x=>x!==k);delete AY.ed[k];AY.msg="";ayYenile()}
    else if(act==="yza"){Object.assign(AY,ayBas(),{ed:{},msg:""});ayYenile()}
    else if(act==="sakla")aySakla();
    else if(act==="pozt"){try{localStorage.removeItem(ayarAcar(AYAR.station))}catch(_){}location.reload()}
    return}
  const pg=e.target.closest(".pgb");
  if(pg){R.page=+pg.dataset.pg;route(true);return}
  if(e.target.id==="rGen"){R.page=1;route(true);return}
  const hh=location.hash;
  if(e.target.id==="rPdf"||(e.target.id==="exp"&&hh==="#rapor")){printReport();return}
  if(e.target.id==="exp"){
    if(hh==="#denge"){printDenge();return}
    const mm=hh.match(/^#mt\/(\d+)/), sk=hh.match(/^#saka\/SAKA-(\d+)/);
    const m=mm?basy(+mm[1]):sk?SAKAS.find(s=>s.saka===+sk[1]):null;
    if(m){R.fid=m.fid;R.tip=dengeOf(m)?"denge":"tuketim";R.page=1}
    location.hash="#rapor";return}
  if(e.target.id==="rXls"){
    const m=repMeter(), q2=v=>nf(v,2).replace(/\./g,""), tip=repTip(m);
    const L=["Hasaplayjy;"+m.fid+" "+m.ad+" ("+yer(m)+")","Dowur;"+trDate(R.from)+" - "+trDate(R.to),"Beket;"+BEKET_AD,""];
    if(tip==="denge"){L.push("dowur;giren_m3;cykan_m3;yitgi_m3;yitgi_pct");repDenge().rows.forEach(r=>L.push([r.lbl,q2(r.g),q2(r.c),q2(r.f),q2(r.p)].join(";")))}
    else{L.push("dowur;baslangyc_jemi;ahyrky_jemi;sarp_edilis_m3;ort_akym;min_akym;maks_akym");
      repRows().rows.forEach(r=>L.push([r.lbl,q2(r.st),q2(r.en),q2(r.tk),q2(r.ort),q2(r.mn),q2(r.mx)].join(";")))}
    document.getElementById("csvWrap").style.display="";
    document.getElementById("csvTa").value=L.join("\n");
    document.getElementById("csvWrap").scrollIntoView({behavior:"smooth",block:"center"});
    return}
  if(e.target.id==="csvCopy"){const ta=document.getElementById("csvTa");ta.select();
    try{navigator.clipboard.writeText(ta.value)}catch(_){document.execCommand("copy")}
    e.target.textContent="Göçürildi";setTimeout(()=>e.target.textContent="Panele göçür",1500)}
});
function freshTick(){
  const d=new Date(), p=x=>String(x).padStart(2,"0");
  const s=VERI.son?Math.round((Date.now()-VERI.son)/60000):null;
  document.getElementById("clock").innerHTML=p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes())+
    ' <span style="color:var(--tx3)">· soňky maglumat '+(s==null?"ýok":s<90?s+" min öň":Math.round(s/60)+" sag öň")+'</span>'+(DEMO?' <span class="tg tg-tr">SYNAG</span>':"");
}
freshTick(); setInterval(freshTick,20000);
route();

}
})()
