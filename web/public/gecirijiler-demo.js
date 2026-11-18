/* SUW GEÇIRIJILER — synag maglumaty (gecirijiler.html?demo[&beket=PS-01|PS-05]). Niagara-a degmeýär; diňe ?demo bilen ýüklenýär.
 *   op=info   → beketiň Niagara ady (BIRINJI_MAY / MAGTYMGULY / YASYLDEPE)
 *   op=points → demo/noktalar*.json (beketiň karta boýunça nokat sanawy; birnäçe tanalmadyk at bilen — Sazlamalar synagy)
 *   op=hist   → nokat atlaryndan gurlan ulgam modeli: sazlaýjy we gatla akymlary gündelik/sagatlyk nusga bilen;
 *               SAKA = Σ gatla, şaha başy = Σ şahanyň çykyşlary (ýyldyzly goşmaça şahalar bilen),
 *               MT başy = Σ turbadaky çykyşlar + ýitgi. Bekediň iň ýokary akymy ≈ taslama Q.
 *               Totalizatorlar diňe artýar; ~4 aý taryh. Bahalar seed bilen (senä bagly): her gezek şol bir san.
 */
(function () {
'use strict'
const H = 3600
const GUN = 124                                              // taryhyň uzynlygy (gün)
/* beketler: hedef = MT başynyň iň ýokary akymy, m³/sag (jemi ≈ taslama Q); ýitgi = MT ýitgisi;
   subYitgi = şaha başynyň ýitgisi ("mt/şaha"); gercek = synagyň "hakyky" ulgamy: sahypa tanamaýan atlar haýsy
   hasaplaýjy (akymy şol ýere goşulýar, sahypa Sazlamalarda bellenende deňagramlylyk düzelýär); oflayn: soňky N sagat ýazgy ýok */
const BEKETLER = {
  'PS-04': { st: 'BIRINJI_MAY', file: 'demo/noktalar.json',               // Q = 3,40 m³/s
    hedef: { 1: 3650, 2: 3800, 3: 1870, 4: 3220 }, yitgi: { 1: 0.032, 2: 0.04, 3: 0.12, 4: 0.026 },
    subYitgi: {}, gercek: {}, oflayn: { BA2_G4: 30 } },
  'PS-01': { st: 'MAGTYMGULY', file: 'demo/noktalar-ps-01.json',          // Q = 3,20 m³/s; MT-2 ýitgisi ýokary
    hedef: { 1: 6250, 2: 5600 }, yitgi: { 1: 0.034, 2: 0.118 },
    subYitgi: { '1/2': 0.022 }, gercek: {}, oflayn: { BA3_G7: 28 } },
  'PS-05': { st: 'YASYLDEPE', file: 'demo/noktalar-ps-05.json',           // Q = 1,70 m³/s; MT-1/3 şahasynda ýitgi ýokary
    hedef: { 1: 6380 }, yitgi: { 1: 0.036 },
    subYitgi: { '1/3': 0.128 }, gercek: { MT1_3uc_S1: 'MT1_3xxx_S1' }, oflayn: { BA4_G9: 30 } },
}

function hs(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
/** [0,1) — at we san boýunça hemişe şol bir baha */
function rnd(s, k) {
  let t = (hs(s) + Math.imul(k | 0, 0x9E3779B1)) >>> 0
  t = Math.imul(t ^ (t >>> 16), 0x85EBCA6B); t = Math.imul(t ^ (t >>> 13), 0xC2B2AE35)
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296
}

let ptsP = null, modelP = null
const noktalar = (B) => (ptsP = ptsP || fetch(B.file, { cache: 'no-store' })
  .then((r) => r.json()).then((j) => j.points || []))

/* ---------- ulgam modeli ---------- */
function gur(points, ctx, B) {
  const U = ctx.nusga[B.st] || {}
  const now = Math.floor(Date.now() / 1000)
  const h1 = Math.floor(now / H), h0 = h1 - GUN * 24, N = h1 - h0 + 1
  const tz = -new Date().getTimezoneOffset() * 60
  const gunOf = (k) => Math.floor(((h0 + k) * H + tz) / 86400)        // ýerli gün nomeri
  const sagOf = (k) => (((h0 + k) * H + tz) / H) % 24                 // ýerli sagat
  const unit = {}, kok = {}
  for (const p of points) {
    unit[p[0]] = p[3]
    const m = String(p[0]).match(/^(.+)_(Akym|Toplam|Jemi)$/)
    if (m) kok[m[1]] = 1
  }
  const node = {}
  for (const r of Object.keys(kok)) node[r] = { r, s: ctx.parseRoot(B.gercek[r] || r, U), f: null }
  const all = Object.values(node)
  const tip = (n) => (n.s ? n.s.tip : '')

  // ýapraklar: sazlaýjy, gatla, gatlasyz SAKA, tanalmadyk nokat (gidrant ýaly)
  const ypr = all.filter((n) => !n.s || n.s.tip === 'sazlayjy' || n.s.tip === 'gatla' ||
    (n.s.tip === 'saka' && !all.some((g) => tip(g) === 'gatla' && g.s.saka === n.s.saka)))
  const wJemi = {}
  for (const n of ypr) {
    n.w = (0.55 + 0.9 * rnd(n.r, 1)) * (tip(n) === 'gatla' ? 1.7 : 1)
    n.ph = (rnd(n.r, 2) - 0.5) * 4
    const mt = n.s ? n.s.mt : 0
    wJemi[mt] = (wJemi[mt] || 0) + n.w
  }
  const kMt = (mt) => (mt && B.hedef[mt] ? B.hedef[mt] / (1 + (B.yitgi[mt] || 0.03)) / 1.02 / wJemi[mt] : 16)
  const pasyl = (g) => 0.94 + 0.06 * Math.cos(2 * Math.PI * ((g % 365.25) - 196) / 365.25)   // tomus ýokary
  for (const n of ypr) {
    const k = kMt(n.s ? n.s.mt : 0) * (n.s ? 1 : 1 / n.w), g = tip(n) === 'gatla'
    n.f = new Float64Array(N)
    let gun = -1, df = 0
    for (let i = 0; i < N; i++) {
      const d = gunOf(i)
      if (d !== gun) { gun = d; df = rnd(n.r, d * 31 + 17) < (g ? 0.06 : 0.04) ? 0 : (0.88 + 0.22 * rnd(n.r, d * 7 + 3)) * pasyl(d) }
      const sf = 0.78 + 0.22 * Math.cos(2 * Math.PI * (sagOf(i) - 14 - n.ph) / 24)
      n.f[i] = n.w * k * df * sf * (1 + 0.05 * (rnd(n.r, h0 + i) - 0.5))
    }
  }
  const jem = (list, key, L) => {
    const f = new Float64Array(N)
    for (const c of list) if (c && c.f) for (let i = 0; i < N; i++) f[i] += c.f[i]
    if (L) { let gun = -1, x = 0; for (let i = 0; i < N; i++) { const d = gunOf(i); if (d !== gun) { gun = d; x = L * (0.75 + 0.5 * rnd(key, d)) } f[i] *= 1 + x } }
    return f
  }
  // SAKA = Σ gatla
  for (const n of all) if (tip(n) === 'saka' && !n.f) n.f = jem(all.filter((g) => tip(g) === 'gatla' && g.s.saka === n.s.saka), n.r, 0.015)
  // şahalar (rekursiw): öz sazlaýjylary + SAKA-lary + ýyldyzly goşmaça şahalary; başy bar bolsa başy = Σ × (1 + ýitgi)
  const subsOf = (mt) => [...new Set(all.filter((x) => x.s && x.s.mt === mt && x.s.sub && x.s.tip !== 'gatla').map((x) => x.s.sub))]
  const subAkym = (mt, b) => {
    const own = all.filter((x) => x.s && x.s.mt === mt && x.s.sub === b && (x.s.tip === 'sazlayjy' || x.s.tip === 'saka'))
    const kids = b % 1 ? [] : subsOf(mt).filter((c) => c % 1 && Math.floor(c) === b)
    const parts = [...own, ...kids.flatMap((c) => subAkym(mt, c))]
    const bas = all.find((x) => tip(x) === 'ana' && x.s.mt === mt && x.s.sub === b)
    if (!bas) return parts
    const key = mt + '/' + ctx.subLbl(b)
    bas.f = jem(parts, bas.r, B.subYitgi[key] != null ? B.subYitgi[key] : 0.018)
    return [bas]
  }
  // MT başy = Σ (gövde sazlaýjylary + gövde SAKA-lary + şahalar) × (1 + ýitgi)
  const mts = [...new Set(all.filter((x) => x.s && x.s.mt).map((x) => x.s.mt))]
  for (const mt of mts) {
    const subs = subsOf(mt), top = subs.filter((b) => !(b % 1) || !subs.includes(Math.floor(b)))
    const cyk = all.filter((x) => x.s && x.s.mt === mt && !x.s.sub && (x.s.tip === 'sazlayjy' || x.s.tip === 'saka'))
    for (const b of top) cyk.push(...subAkym(mt, b))
    const bas = all.find((x) => tip(x) === 'ana' && x.s.mt === mt && !x.s.sub)
    if (bas) bas.f = jem(cyk, bas.r, B.yitgi[mt] || 0.03)
  }
  // totalizator: başlangyç baha + ∫ akym
  for (const n of all) {
    if (!n.f) n.f = new Float64Array(N)
    n.cum = new Float64Array(N + 1)
    n.cum[0] = Math.round((tip(n) === 'ana' ? 2e6 : 1.5e5) * (0.3 + 2 * rnd(n.r, 9)))
    for (let i = 0; i < N; i++) n.cum[i + 1] = n.cum[i] + n.f[i]
  }
  return { node, unit, now, h0, N, t0: h0 * H, oflayn: B.oflayn }
}
function baha(M, n, t) {             // totalizator t pursatda
  const k = Math.floor(t / H) - M.h0
  if (k < 0) return n.cum[0]
  if (k >= M.N) return n.cum[M.N]
  return n.cum[k] + n.f[k] * (t - (M.h0 + k) * H) / H
}

/* ---------- op=hist: [epoch_s, avg, min, max] kovalary ---------- */
function hist(M, q) {
  const from = +q.from / 1000, to = Math.min(+q.to / 1000, M.now), n = Math.max(1, +q.n)
  let w = Math.ceil((to - from) / n)
  if (Math.abs(w - 86400) < 4400) w = 86400; else if (Math.abs(w - H) < 300) w = H
  w = Math.max(w, 60)
  const data = {}
  for (const name of String(q.names || '').split(',').filter(Boolean)) {
    const m = name.match(/^(.+)_(Akym|Toplam|Jemi)$/), nd = m && M.node[m[1]]
    if (!nd) { data[name] = []; continue }
    const st = Math.max(from, M.t0), end = Math.min(to, M.now - (M.oflayn[nd.r] || 0) * H)
    const akym = m[2] === 'Akym', kf = /^l\/s/i.test(M.unit[name] || '') ? 1 / 3.6 : 1
    const rows = []
    for (let b = Math.floor(st / w) * w; b < end; b += w) {
      const a = Math.max(b, st), z = Math.min(b + w, end)
      if (z <= a) continue
      if (akym) {
        let s = 0, c = 0, mn = Infinity, mx = -Infinity
        const k1 = Math.min(M.N - 1, Math.floor((z - 1) / H) - M.h0)
        for (let k = Math.max(0, Math.floor(a / H) - M.h0); k <= k1; k++) { const v = nd.f[k]; s += v; c++; if (v < mn) mn = v; if (v > mx) mx = v }
        if (c) rows.push([b, +(s / c * kf).toFixed(3), +(mn * 0.97 * kf).toFixed(3), +(mx * 1.03 * kf).toFixed(3)])
      } else {
        const v0 = baha(M, nd, a), v1 = baha(M, nd, z)
        rows.push([b, +((v0 + v1) / 2).toFixed(2), +v0.toFixed(2), +v1.toFixed(2)])
      }
    }
    data[name] = rows
  }
  return { data }
}

async function ts(req, ctx) {
  const B = BEKETLER[ctx.beket] || BEKETLER['PS-04']
  const q = Object.fromEntries(String(req).split('&').map((kv) => kv.split('=').map(decodeURIComponent)))
  if (q.op === 'info') return { station: B.st }
  if (q.op === 'points') return { points: await noktalar(B) }
  if (q.op === 'hist') {
    modelP = modelP || noktalar(B).then((p) => gur(p, ctx, B))
    return hist(await modelP, q)
  }
  return { error: 'synag: näbelli op ' + q.op }
}
window.GecDemo = { ts }
})()
