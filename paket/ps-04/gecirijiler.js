/* SUW GEÇIRIJILER — Suw Hasaplaýjy Maglumatlary (gecirijiler.html)
 * Hasaplaýjylar maglumat binýadyndaky nokat adlaryndan özi tapylýar (ýazgy goşulanda sahypa özi görkezýär):
 *   MT1 / MT2_1 esasy turba · MT1_S2 sazlaýjy · MT1_1_S3 kömekçi turbanyň sazlaýjysy · Saka4 SAKA · BA4_G9 gatla ·
 *   PS21_T1_N1 nasos;  ahyry _Akym (akym) we _Toplam / _Jemi (totalizator).
 * Atdan çykmaýan baglanyşyklar: ulgam.json (Workbench-de üýtgedip bolýar).
 * Sarp ediliş = totalizatoryň gün ahyryndaky bahalarynyň tapawudy. Soňky 62 gün ýerli wagt bilen sagatlyk
 * maglumatdan, ondan öňkisi gündelik jemlemeden. Häzirki akym: _Akym (soňky sagat), ýok bolsa
 * totalizatoryň soňky sagatdaky tapawudy.  Synag: gecirijiler.html?demo
 */
(function () {
'use strict'
const DEMO = /[?&]demo\b/.test(location.search)
const DAY = 86400000

/* ---------- BajaScript + TsOkuma ---------- */
let bajaP = null
function addScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok
    s.onerror = () => fail(new Error('BajaScript ýüklenmedi (' + src + ')')); document.head.appendChild(s) })
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

/* ---------- nokat adyndan hasaplaýjy ---------- */
function parseRoot(root, U) {
  const k = root.replace(/_new$/i, '')
  let x
  const sakaMt = (a) => (U.saka_mt && U.saka_mt[a]) || 0
  if ((x = k.match(/^MT(\d+)$/i))) return { tip: 'ana', mt: +x[1], sub: 0, saz: 0, saka: 0, gatla: 0, nasos: 0, ad: 'MT-' + x[1] + ' Main' }
  if ((x = k.match(/^MT(\d+)_(\d+)$/i))) return { tip: 'ana', mt: +x[1], sub: +x[2], saz: 0, saka: 0, gatla: 0, nasos: 0, ad: 'MT-' + x[1] + '/' + x[2] + ' Main' }
  if ((x = k.match(/^MT(\d+)_S(\d+)$/i))) return { tip: 'sazlayjy', mt: +x[1], sub: 0, saz: +x[2], saka: 0, gatla: 0, nasos: 0, ad: 'MT-' + x[1] + ' S-' + x[2] }
  if ((x = k.match(/^MT(\d+)_(\d+)_S(\d+)$/i))) return { tip: 'sazlayjy', mt: +x[1], sub: +x[2], saz: +x[3], saka: 0, gatla: 0, nasos: 0, ad: 'MT-' + x[1] + '/' + x[2] + ' S-' + x[3] }
  if ((x = k.match(/^Saka(\d+)$/i))) return { tip: 'saka', mt: sakaMt(+x[1]), sub: (U.saka_sub && U.saka_sub[+x[1]]) || 0, saz: 0, saka: +x[1], gatla: 0, nasos: 0, ad: 'SAKA-' + x[1] }
  if ((x = k.match(/^BA(\d+)_G(\d+)$/i))) return { tip: 'gatla', mt: sakaMt(+x[1]), sub: 0, saz: 0, saka: +x[1], gatla: +x[2], nasos: 0, ad: 'BA-' + x[1] + ' G-' + x[2] }
  if ((x = k.match(/^PS(\d+)_T(\d+)_N(\d+)$/i))) {
    const b = (U.beketler || []).find((s) => s.id === 'PS-' + x[1])
    const t = b && b.toparlar[+x[2] - 1]
    return { tip: 'pompa', mt: t ? t.mt : 0, sub: 0, saz: 0, saka: 0, gatla: 0, nasos: +x[3], ad: 'PS-' + x[1] + ' T-' + x[2] + ' N-' + x[3], bek: 'PS-' + x[1], top: +x[2] }
  }
  return null
}
const flowK = (u) => { u = String(u || '').toLowerCase().replace(/\s/g, '')
  if (/^l\/s/.test(u)) return 3.6
  if (/^m(3|³)\/s/.test(u)) return 3600
  if (/^l\/(h|sag)/.test(u)) return 0.001
  if (/^l\/min/.test(u)) return 0.06
  return 1 }                                    // m³/h, m³/sag ýa-da birimsiz
const totK = (u) => (/^l$|litre|liter/i.test(String(u || '').trim()) ? 0.001 : 1)

/** ýerli gün başy (ms) */
const gunBasy = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

async function yukle() {
  const U = await fetch('ulgam.json', { cache: 'no-store' }).then((r) => r.json())
  const info = await ts('op=info')
  const station = (info && info.station) || ''
  const cfg = U[station] || {}          // bu beket ulgam.json-da ýok: diňe atlardan
  const pts = (await ts('op=points')).points || []
  const unit = {}
  for (const p of pts) unit[p[0]] = p[3]
  // hasaplaýjylar: kök → {akym, toplam}
  const roots = {}, tanalmadyk = []
  for (const p of pts) {
    const m = String(p[0]).match(/^(.+)_(Akym|Toplam|Jemi)$/)
    if (!m) continue
    const r = roots[m[1]] || (roots[m[1]] = {})
    if (m[2] === 'Akym') r.akym = p[0]; else r.toplam = p[0]
  }
  const byKey = {}
  const METERS = []
  for (const [root, r] of Object.entries(roots)) {
    const s = parseRoot(root, cfg)
    if (!s) { tanalmadyk.push(root); continue }
    const key = root.replace(/_new$/i, '')
    const m = Object.assign(s, { fid: root, akym: r.akym || null, toplam: r.toplam || null, yok: !r.toplam })
    byKey[key.toUpperCase()] = m; METERS.push(m)
  }
  for (const g of cfg.garasylyan || []) {          // bolmaly, emma maglumat binýadynda ýok
    if (byKey[g.toUpperCase()]) continue
    const s = parseRoot(g, cfg)
    if (!s) continue
    const m = Object.assign(s, { fid: g, akym: null, toplam: null, yok: true })
    byKey[g.toUpperCase()] = m; METERS.push(m)
  }
  // tertip: MT, nasos, ana, sazlaýjy, SAKA, gatla
  const tipS = { ana: 0, pompa: 1, sazlayjy: 2, saka: 3, gatla: 4 }
  METERS.sort((a, b) => a.mt - b.mt || (a.tip === 'gatla') - (b.tip === 'gatla') || a.saka - b.saka || tipS[a.tip] - tipS[b.tip] || a.sub - b.sub || a.saz - b.saz || a.gatla - b.gatla || a.nasos - b.nasos)

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
  first = Math.min(first, today0 - 13 * DAY)          // grafikler üçin azyndan 14 gün
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
    } else if (hs.length >= 2) {
      const a = hs[hs.length - 2], b = hs[hs.length - 1]
      const dt = (b[0] - a[0]) / 3600
      if (dt > 0 && b[3] >= a[3]) { m.q = (b[3] - a[3]) * k / dt; m.qOk = true }
    }
    if (m.akym) for (const [t, , mn, mx] of akGun[m.akym] || []) { const i = Math.round((Math.floor(t / 86400) * 86400 * 1000 - first) / DAY); if (i >= 0 && i < DAYS) { m.amn[i] = mn * flowK(unit[m.akym]); m.amx[i] = mx * flowK(unit[m.akym]) } }
    if (m.flags.includes('veri') && !m.qOk) m.q = 0
  }
  return { METERS, START, DAYS, cfg, station, tanalmadyk, son }
}

/* ---------- synag (demo): hakyky nokat sanawy, emeli bahalar ---------- */
const DEMO_ROOTS = ['MT1', 'MT1_S1', 'MT1_S2', 'MT1_1_S1', 'MT1_1_S2', 'MT1_1_S3', 'MT1_2_S1', 'Saka1', 'Saka2', 'Saka3', 'Saka4', 'BA1_G1', 'BA1_G3_new', 'BA1_G4', 'BA2_G1', 'BA4_G2', 'BA4_G3',
  'MT2_1', 'MT2_2', 'MT3', 'MT3_S1', 'MT3_S2', 'MT3_1_S1', 'Saka5', 'Saka6', 'BA5_G2', 'BA6_G1', 'BA6_G2', 'MT4', 'MT4_S2', 'Saka7', 'BA7_G1', 'MT5', 'MT5_S1', 'MT5_S3', 'Saka8', 'BA8_G1', 'BA8_G2']
function demoTs(req) {
  const q = Object.fromEntries(req.split('&').map((kv) => kv.split('=').map(decodeURIComponent)))
  if (q.op === 'info') return { station: 'BIRINJI_MAY' }
  if (q.op === 'points') return { points: DEMO_ROOTS.flatMap((r) => [[r + '_Akym', r, '', /^MT\d$|^MT2_/.test(r) ? 'm³/hr' : 'L/s', 'n'], [r + (/^MT\d$|^MT2_/.test(r) ? '_Jemi' : '_Toplam'), r, '', 'm³', 'n']]) }
  const from = +q.from, to = +q.to, n = +q.n, w = Math.max(3600, Math.ceil((to - from) / 1000 / n))
  const data = {}
  for (const name of q.names.split(',')) {
    const root = name.replace(/_(Akym|Toplam|Jemi)$/, '')
    let seed = 0; for (const ch of root) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const base = /^MT\d$|^MT2_/.test(root) ? 600 + seed % 400 : /^Saka/.test(root) ? 120 + seed % 80 : 20 + seed % 60     // m³/sag
    const rows = []
    for (let t = Math.max(from, Date.now() - 34 * DAY) / 1000; t < to / 1000; t += w) {
      const h = new Date(t * 1000).getHours(), f = 0.8 + 0.4 * Math.sin((h / 24) * 6.28)
      if (/_Akym$/.test(name)) rows.push([Math.round(t), (base * f) / (/^MT\d$|^MT2_/.test(root) ? 1 : 3.6), base * 0.7 / 3.6, base * 1.2 / 3.6])
      else { const tot = 50000 + base * ((t * 1000 - (Date.now() - 34 * DAY)) / 3600000); rows.push([Math.round(t), tot, tot - base * w / 7200, tot + base * w / 7200]) }
    }
    data[name] = rows
  }
  return { data }
}

/* ---------- başla ---------- */
const view = document.getElementById('view')
view.innerHTML = '<div class="ok-box"><div class="ring">⟳</div>Maglumat binýadyndan okalýar…</div>'
yukle().then((r) => uygula(r)).catch((e) => {
  view.innerHTML = '<div class="ok-box" style="color:#ff8b8f">Maglumat okalmady: ' + String(e && e.message || e) +
    '<br><span style="color:var(--tx3)">Sahypa Niagara-dan (localhost) açylmalydyr; TsOkuma hyzmaty gurnalmaly.</span></div>'
})
// 15 minutda bir täzele (hasabat sahypasyndan başga)
setInterval(() => { if (!/^#rapor/.test(location.hash) && document.visibilityState === 'visible') location.reload() }, 15 * 60000)

function uygula(VERI) {
const { METERS, START, DAYS, cfg: U, tanalmadyk } = VERI
const TODAY = new Date(START.getTime() + (DAYS - 1) * DAY)
const LOGO="gecirijiler-logo.png";

/* ================= veri modeli ================= */
const LAST=DAYS-1;
const MONS=["Ýan","Few","Mart","Apr","Maý","Iýun","Iýul","Awg","Sen","Okt","Noý","Dek"];
const nf=(v,d=0)=>(v!=null&&Number.isNaN(+v))?"—":(v||0).toLocaleString("tr-TR",{minimumFractionDigits:d,maximumFractionDigits:d});
const dd=i=>new Date(START.getTime()+i*86400000);
const isoD=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const SUB=t=>["sazlayjy","saka"].includes(t);   // MT dağıtım noktaları (gatla SAKA altında)
const nfc=v=>Number.isNaN(+v)?"—":Math.abs(v)>=1e6?nf(v/1e6,2)+"M":Math.abs(v)>=1e4?nf(v/1e3,0)+"K":nf(v);
const byMT=m=>METERS.filter(x=>x.mt===m);
const MTS=[...new Set(METERS.map(m=>m.mt).filter(Boolean))].sort((a,b)=>a-b);

METERS.forEach((m,i)=>{m.i=i});
const TRANSFER=new Set((U.transfer||[]).map(x=>x.toUpperCase()));
const kokAd=m=>m.fid.replace(/_new$/i,"").toUpperCase();
METERS.forEach(m=>{
  m.rol = m.tip==="ana" ? (TRANSFER.has(kokAd(m))?"transfer":"giris") : m.tip==="pompa"?"pompa":"dagitim";
});

const sumR=(l,a,b)=>{let s=0;for(const m of l)for(let d=Math.max(0,a);d<=Math.min(LAST,b);d++)s+=m.d[d];return s};
const mS=(o=0)=>{const t=dd(LAST);return Math.round((new Date(t.getFullYear(),t.getMonth()+o,1)-START)/86400000)};
const yS=(o=0)=>Math.max(0,Math.round((new Date(dd(LAST).getFullYear()+o,0,1)-START)/86400000));
const q=l=>l.reduce((a,b)=>a+b.q,0);

/* alt yapı: SAKA → gatla */
const SAKAS=METERS.filter(m=>m.tip==="saka").map(s=>({...s,
  gs:METERS.filter(g=>g.tip==="gatla"&&g.mt===s.mt&&g.saka===s.saka)}));
const STATIONS=(U.beketler||[]).map(b=>({id:b.id,ad:b.ad,gr:b.toparlar.map((t,i)=>{
  const pumps=METERS.filter(m=>m.tip==="pompa"&&m.bek===b.id&&m.top===i+1);
  return {ad:t.ad+" ("+pumps.length+" nasos)",kfg:"rotasyonlu",mt:t.mt,pumps,outs:byMT(t.mt).filter(m=>m.tip==="ana"&&m.saka===0)}}).filter(g=>g.pumps.length)})).filter(s=>s.gr.length);
const byRoot=r=>METERS.find(m=>kokAd(m)===String(r).toUpperCase());
const HW={giren:((U.howuz||{}).giren||[]).map(byRoot).filter(Boolean),cykan:((U.howuz||{}).cykan||[]).map(byRoot).filter(Boolean)};
const yokAd=l=>l.filter(m=>m.yok).map(m=>m.ad).join(", ");
const CLR=["#39B6EE","#5CD07A","#A78BFA","#F0A03C","#F2635A","#5FD0FF","#E9C46A","#7FDBB6","#EF8FBB","#8AA9F0"];

/* ================= grafik yardımcıları ================= */
const _f=v=>Number.isFinite(v)?v:0;

function chLine(data,{h=170,c="#39B6EE",lab=true,area=true,multi=null}={}){
  const W=640,ml=48,mr=10,mt=14,mb=lab?24:8,iw=W-ml-mr,ih=h-mt-mb;
  const sets=(multi||[{c,vals:data.map(d=>d.v)}]).map(s=>({...s,vals:s.vals.map(_f)}));
  const max=Math.max(...sets.flatMap(s=>s.vals),1)*1.18;
  let s=`<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto">`;
  for(let i=0;i<=3;i++){const y=mt+ih-ih*i/3;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-7}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${nf(max*i/3)}</text>`}
  sets.forEach(st=>{
    const pts=st.vals.map((v,i)=>[ml+iw*i/(st.vals.length-1||1),mt+ih-ih*(v/max)]);
    const p=pts.map(a=>a[0].toFixed(1)+","+a[1].toFixed(1)).join(" ");
    if(area&&sets.length===1)s+=`<polygon points="${ml},${mt+ih} ${p} ${W-mr},${mt+ih}" fill="${st.c}" opacity=".14"/>`;
    s+=`<polyline points="${p}" fill="none" stroke="${st.c}" stroke-width="2"/>`;
    pts.forEach(a=>s+=`<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="2.6" fill="${st.c}"/>`);
  });
  if(lab)data.forEach((d,i)=>{const e=data.length>14?Math.ceil(data.length/8):1;
    if(i%e===0)s+=`<text x="${ml+iw*i/(data.length-1||1)}" y="${h-7}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${d.s||d.l}</text>`});
  return s+"</svg>";
}
function chBar(data,{h=170,pairs=false}={}){
  data=data.map(d=>({...d,v:_f(d.v),a:_f(d.a),b:_f(d.b)}));
  const W=640,ml=48,mr=10,mt=14,mb=24,iw=W-ml-mr,ih=h-mt-mb;
  const max=Math.max(...data.flatMap(d=>pairs?[d.a,d.b]:[d.v]),1)*1.15;
  const step=iw/data.length, bw=pairs?step*.30:step*.55;
  let s=`<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto">`;
  for(let i=0;i<=3;i++){const y=mt+ih-ih*i/3;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-7}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${nfc(max*i/3)}</text>`}
  data.forEach((d,i)=>{
    const x0=ml+step*i;
    if(pairs){
      [["a","#5CD07A",0],["b","#7D93A8",1]].forEach(([k,c,j])=>{
        const hh=ih*(d[k]/max);
        s+=`<rect x="${(x0+step/2-bw-2+j*(bw+4)).toFixed(1)}" y="${(mt+ih-hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.8,hh).toFixed(1)}" rx="1.5" fill="${c}"><title>${d.l}: ${nf(d[k])}</title></rect>`});
    }else{
      const hh=ih*(d.v/max);
      s+=`<rect x="${(x0+(step-bw)/2).toFixed(1)}" y="${(mt+ih-hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.8,hh).toFixed(1)}" rx="2" fill="${d.c||"#39B6EE"}"><title>${d.l}: ${nf(d.v)}</title></rect>`}
    const e=data.length>14?Math.ceil(data.length/12):1;
    if(i%e===0)s+=`<text x="${(x0+step/2).toFixed(1)}" y="${h-7}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${d.s||d.l}</text>`});
  return s+"</svg>";
}
function chDonut(items,center,sub){
  items=items.map(i=>({...i,v:Math.max(0,_f(i.v))}));
  const R=62,r=40,C=90,tot=items.reduce((a,b)=>a+b.v,0)||1;
  let a0=-Math.PI/2,s=`<svg viewBox="0 0 180 180" style="width:100%;max-width:190px;height:auto">`;
  items.forEach(it=>{
    const a1=a0+it.v/tot*2*Math.PI, big=a1-a0>Math.PI?1:0;
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
  vals=Array.from(vals,_f);
  const W=62,H=16,mx=Math.max(...vals,.001);
  const p=vals.map((v,i)=>(i*(W/(vals.length-1))).toFixed(1)+","+(H-H*.85*(v/mx)-1).toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:62px;height:16px"><polyline points="${p}" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`;
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
  [2024,2025,2026].forEach(y=>{const si=Math.max(0,Math.round((new Date(y,0,1)-START)/86400000)),
    ei=Math.min(LAST,Math.round((new Date(y,11,31)-START)/86400000));
    if(ei>=si)o.push({l:String(y),s:String(y),v:sumR(l,si,ei),k:String(y)})});
  return o;
}
function yoy(l){ // 2026 vs 2025 aylık
  const o=[];for(let m=0;m<12;m++){
    const f=(y)=>{const a=Math.round((new Date(y,m,1)-START)/86400000),b=Math.round((new Date(y,m+1,0)-START)/86400000);
      return (b<0||a>LAST)?0:sumR(l,Math.max(0,a),Math.min(LAST,b))};
    o.push({l:MONS[m],s:MONS[m],a:f(2026),b:f(2025)})}
  return o;
}
const per3=l=>({d:sumR(l,LAST,LAST),y:sumR(l,LAST-1,LAST-1),m:sumR(l,mS(0),LAST),pm:sumR(l,mS(-1),mS(0)-1),
  yr:sumR(l,yS(0),LAST),py:sumR(l,yS(-1),yS(0)-1)});
const pct=(a,b)=>b?((a-b)/b*100):0;
const arrow=v=>`<span class="${v>=0?"up":"dn"}">${v>=0?"▲":"▼"} ${nf(Math.abs(v),2)} %</span>`;

/* ================= KPI ================= */
function kpi(ic,cl,lb,vl,un,sb){return `<div class="kpi">
  <span class="ico" style="background:${cl}22;color:${cl}">${ic}</span>
  <div style="min-width:0"><div class="lb">${lb}</div>
  <div class="vl">${vl} <small>${un||""}</small></div><div class="sb">${sb||""}</div></div></div>`}

/* ================= SAYFALAR ================= */
const P={};

P.genel=()=>{
  const giris=METERS.filter(m=>m.rol==="giris"), tr=METERS.filter(m=>m.rol==="transfer");
  const t=per3(giris), sakalar=METERS.filter(m=>m.tip==="saka");
  const err=METERS.filter(m=>m.flags.includes("veri")).length;
  const mtItems=METERS.filter(m=>m.tip==="ana").map((m,i)=>({l:m.ad,v:m.q,c:CLR[i]}));
  const top5=MTS.map(mt=>({l:"MT-"+mt,v:sumR(byMT(mt).filter(m=>m.tip==="ana"),mS(0),LAST),c:CLR[mt-1]}))
    .sort((a,b)=>b.v-a.v);
  const psP=id=>(STATIONS.find(s=>s.id===id)||{gr:[]}).gr.flatMap(g=>g.pumps);
  const ps21=psP("PS-21"), ps22=psP("PS-22");
  const l21=byMT(1).filter(m=>m.tip==="ana").concat(byMT(2).filter(m=>m.tip==="ana"));
  const l22=HW.cykan;
  return `
  <div class="h1row"><h1>Umumy Ulgam</h1><span class="crumb">Ähli ulgam · ${METERS.length} hasaplaýjy</span></div>
  <div class="kpirow">
    ${kpi("◉","#39B6EE","Jemi häzirki akym",nf(q(giris),1),"m³/sag",giris.map(m=>m.ad.replace(" Main","")).join(" + ")+" (howza gidýän goşulmaýar)")}
    ${kpi("▤","#5CD07A","Şu günki sarp ediliş",nf(t.d),"m³",`Düýn: ${nf(t.y)} m³ &nbsp;${arrow(pct(t.d,t.y))}`)}
    ${kpi("▦","#A78BFA","Şu aýky sarp ediliş",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} m³ &nbsp;${arrow(pct(t.m,t.pm))}`)}
    ${kpi("▨","#F0A03C","Şu ýylky sarp ediliş",nf(t.yr),"m³",`Geçen ýyl: ${nf(t.py)} m³ &nbsp;${arrow(pct(t.yr,t.py))}`)}
    ${kpi("✓","#5CD07A","Işleýän hasaplaýjy",(METERS.length-err)+" / "+METERS.length,"",`%${nf((METERS.length-err)/METERS.length*100,1)}`)}
    ${kpi("✕",err?"#F2635A":"#5CD07A","Aragatnaşyk näsazlygy",err,"",err?"kontrol gerekli":"sorun yok")}
  </div>

  <div class="pan"><div class="ph"><h2>Ulgamyň umumy shemasy</h2>
    <span class="crumb">Häzirki akym · şu günki sarp ediliş</span></div>
    <div class="pb scroll">${schemaGenel(l21,l22,ps21,ps22,sakalar)}</div></div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>PS-21 çykyşy · häzirki akym</h2>
      <span class="crumb">${nf(q(l21),1)} m³/sag</span></div>
      <div class="pb" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        ${chDonut(l21.map((m,i)=>({l:m.ad,v:m.q,c:m.mt===2?["#F0A03C","#E9C46A"][i-1]||"#F0A03C":"#39B6EE"})),nf(q(l21),1),"m³/sag")}
        <div class="lgd">${l21.map((m,i)=>`<span><i style="background:${m.mt===2?["#F0A03C","#E9C46A"][i-1]||"#F0A03C":"#39B6EE"}"></i>${m.ad} <b class="mono">${nf(m.q,1)}</b>
          ${m.mt===2?'<span class="tg tg-tr" style="margin-left:4px">havuza</span>':'<span class="tg tg-c" style="margin-left:4px">sarp edijä</span>'}</span>`).join("")}
          <span style="border-top:1px solid var(--brd);padding-top:6px;margin-top:2px;color:var(--tx3)">
            Howza gidýän: <b class="mono" style="color:var(--or)">${nf(q(tr),1)}</b> m³/sag</span>
        </div></div></div>

    <div class="pan" style="margin:0"><div class="ph"><h2>PS-22 çykyşy · häzirki akym</h2>
      <span class="crumb">${nf(q(l22),1)} m³/sag</span></div>
      <div class="pb" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        ${chDonut(l22.map((m,i)=>({l:m.ad,v:m.q,c:["#5CD07A","#A78BFA","#5FD0FF"][i]})),nf(q(l22),1),"m³/sag")}
        <div class="lgd">${l22.map((m,i)=>`<span><i style="background:${["#5CD07A","#A78BFA","#5FD0FF"][i]}"></i>${m.ad} <b class="mono">${nf(m.q,1)}</b></span>`).join("")}
          <span style="border-top:1px solid var(--brd);padding-top:6px;margin-top:2px;color:var(--tx3)">
            Howuzdan çykýan: <b class="mono" style="color:var(--gr)">${nf(q(l22),1)}</b> m³/sag</span>
        </div></div></div>

    ${havuzDenge(tr,l22)}
  </div>

  <div class="pan"><div class="ph"><h2>Howzuň deňagramlylyk gözegçiligi · günlük</h2>
    <span class="crumb">
      <span style="color:#F0A03C">■</span> Girýän (MT-2/1 + MT-2/2) &nbsp;
      <span style="color:#5CD07A">■</span> Çykýan (MT-3 + MT-4 + MT-5) &nbsp;
      <span style="color:#3E6B57">■</span> günlük tapawut %</span></div>
    <div class="pb">${chDenge(tr,l22,30)}
      <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--brd);font-size:12px;color:var(--tx2)">
        <span>30 günde girýän <b class="mono" style="color:var(--or)">${nf(sumR(tr,LAST-29,LAST))}</b> m³</span>
        <span>30 günde çykýan <b class="mono" style="color:var(--gr)">${nf(sumR(l22,LAST-29,LAST))}</b> m³</span>
        <span>Toplanan tapawut <b class="mono ${Math.abs(pct(sumR(tr,LAST-29,LAST),sumR(l22,LAST-29,LAST)))<=2?"up":"wr"}">${nf(sumR(tr,LAST-29,LAST)-sumR(l22,LAST-29,LAST))}</b> m³
          (%${nf(pct(sumR(tr,LAST-29,LAST),sumR(l22,LAST-29,LAST)),2)})</span>
        <span style="color:var(--tx3)">Mämişi zolak girýäniň artykmaçlygyny, gyzyl sütün çykýanyň girýänden geçen günlerini görkezýär</span>
      </div></div></div>`;
};

function schemaGenel(l21,l22,ps21,ps22,sakalar){
  const W=1310,H=316;
  const F=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}" ${o.a?`text-anchor="${o.a}"`:""} ${o.w?`font-weight="${o.w}"`:""} ${o.m?'font-family="ui-monospace,Consolas,monospace"':""} ${o.ls?`letter-spacing="${o.ls}"`:""}>${t}</text>`;
  const P=(d,c,w=2)=>`<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
  const A=(x,y,c)=>`<path d="M${x} ${y-4} L${x+7} ${y} L${x} ${y+4} Z" fill="${c}"/>`;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="min-width:1180px">`;

  const stBox=(x,y,id,dq,dd_,c)=>`
    <rect x="${x}" y="${y}" width="170" height="130" rx="9" fill="#415767" stroke="${c}"/>
    ${F(x+85,y+26,"SUW GÖTERIJI BEKET",{a:"middle",s:9,ls:"1"})}
    ${F(x+85,y+52,id,{a:"middle",s:19,w:700,f:"#E6EFF8"})}
    ${F(x+85,y+76,"Häzirki akym",{a:"middle",s:9.5,f:"#9AABBC"})}
    ${F(x+85,y+95,dq+" m³/sag",{a:"middle",s:14,w:600,f:c,m:1})}
    ${F(x+85,y+113,"şu gün "+dd_+" m³",{a:"middle",s:9.5,f:"#9AABBC",m:1})}`;
  const mtBox=(x,y,m,c)=>`
    <rect x="${x}" y="${y}" width="140" height="58" rx="7" fill="#3D5262" stroke="${c}" stroke-width="1.2"/>
    ${F(x+11,y+18,m.ad,{s:10.5})}
    ${F(x+11,y+38,nf(m.q,1)+" m³/sag",{s:14,w:600,f:c,m:1})}
    ${F(x+11,y+52,nf(m.d[LAST])+" m³",{s:9.5,f:"#9AABBC",m:1})}`;

  const outArrow=(x,y,c,t)=>P(`M${x} ${y} H${x+46}`,c)+A(x+46,y,c)+F(x+56,y+4,t,{s:10,f:"#9AABBC"});

  const YS=[30,125,210];
  /* ---- PS-21 ---- */
  s+=stBox(20,95,"PS-21",nf(q(ps21.length?ps21:l21),1),nf(sumR(ps21.length?ps21:l21,LAST,LAST)),"#39B6EE");
  s+=P("M190 160 H215",'#6F8EA5');
  l21.forEach((m,i)=>{
    const y=YS[i], tr=m.mt===2, c=tr?"#F0A03C":"#39B6EE";
    s+=P(`M215 160 V${y+29} H233`,'#6F8EA5')+A(233,y+29,c)+mtBox(240,y,m,c);
  });
  s+=outArrow(380,59,"#39B6EE","→ sarp edijä · SAKA-1…4");

  /* ---- havuz ---- */
  s+=`<rect x="560" y="118" width="120" height="104" rx="8" fill="#3F5465" stroke="#6F8EA5"/>`;
  s+=`<rect x="564" y="152" width="112" height="66" fill="#39B6EE" opacity=".2"/>`;
  s+=P("M564 152 q14 -6 28 0 t28 0 t28 0 t28 0","#39B6EE",1.6);
  s+=F(620,110,"HOWUZ",{a:"middle",s:11,ls:"1.2",f:"#93AECB"});
  s+=F(620,142,nf(q(METERS.filter(m=>m.rol==="transfer")),1)+" m³/sag",{a:"middle",s:12,f:"#5FD0FF",m:1});
  s+=F(620,236,"PS-22 sorujy çeşmesi",{a:"middle",s:9,f:"#9AABBC"});
  l21.filter(m=>m.mt===2).forEach((m,i)=>{
    const y=YS[i+1]+29;
    s+=P(`M380 ${y} H500 V${162+i*34} H552`,"#F0A03C")+A(552,162+i*34,"#F0A03C");
  });

  /* ---- PS-22 ---- */
  s+=P("M680 170 H722","#39B6EE")+A(722,170,"#39B6EE");
  s+=stBox(730,95,"PS-22",nf(q(ps22.length?ps22:l22),1),nf(sumR(ps22.length?ps22:l22,LAST,LAST)),"#5CD07A");
  s+=P("M900 160 H925","#6F8EA5");
  l22.forEach((m,i)=>{
    const y=YS[i];
    s+=P(`M925 160 V${y+29} H943`,"#6F8EA5")+A(943,y+29,"#5CD07A")+mtBox(950,y,m,"#5CD07A");
    const sk=SAKAS.filter(x=>x.mt===m.mt);
    s+=outArrow(1090,y+29,"#5CD07A",sk.length?"→ "+sk.map(x=>"SAKA-"+x.saka).join(", "):"→ sarp edijä");
  });
  /* MT-1 uyarı etiketi */
  s+=F(400,H-12,"MT-1 howza girmeýär — SAKA-1…4 gönüden-göni MT-1 turbasyndadyr",{s:9.5,f:"#9AABBC"});
  return s+"</svg>";
}

/* ---------- günlük havuz denge grafiği ---------- */
function chDenge(tr,l22,n=30){
  if(yokAd([...tr,...l22]))return `<div class="ok-box">Hesaplap bolmaýar: <b>${yokAd([...tr,...l22])}</b> maglumaty ýok.<br>Bu nokatlar Niagara-da taryh bilen goşulanda grafik özi çykar.</div>`;
  const W=1180,H=300,ml=64,mr=16,mt=22,mb=54,iw=W-ml-mr,ih=H-mt-mb;
  const days=[];
  for(let d=LAST-n+1;d<=LAST;d++){
    const g=sumR(tr,d,d), c=sumR(l22,d,d), t=dd(d);
    days.push({t,g,c,f:g-c,p:c?(g-c)/c*100:0,l:t.getDate()+" "+MONS[t.getMonth()]});
  }
  const max=Math.max(...days.flatMap(d=>[d.g,d.c]),1)*1.12;
  const min=Math.min(...days.flatMap(d=>[d.g,d.c]))*0.88;
  const Y=v=>mt+ih-ih*((v-min)/(max-min||1));
  const X=i=>ml+iw*i/(n-1||1);
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`;
  for(let i=0;i<=4;i++){const y=mt+ih-ih*i/4;
    s+=`<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="#475F72"/>`;
    s+=`<text x="${ml-8}" y="${y+3.5}" text-anchor="end" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9.5">${nfc(min+(max-min)*i/4)}</text>`}
  s+=`<text x="18" y="${mt+ih/2}" fill="#9AABBC" font-size="9.5" transform="rotate(-90 18 ${mt+ih/2})" text-anchor="middle">m³ / gün</text>`;
  const pg=days.map((d,i)=>X(i).toFixed(1)+","+Y(d.g).toFixed(1)).join(" ");
  const pc=days.map((d,i)=>X(i).toFixed(1)+","+Y(d.c).toFixed(1)).join(" ");
  // aradaki bant = tapawut
  s+=`<polygon points="${pg} ${days.map((d,i)=>X(n-1-i).toFixed(1)+","+Y(days[n-1-i].c).toFixed(1)).join(" ")}"
      fill="#F0A03C" opacity=".20"/>`;
  s+=`<polyline points="${pc}" fill="none" stroke="#5CD07A" stroke-width="2.2"/>`;
  s+=`<polyline points="${pg}" fill="none" stroke="#F0A03C" stroke-width="2.2"/>`;
  days.forEach((d,i)=>{
    s+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(d.g).toFixed(1)}" r="2.6" fill="#F0A03C"><title>${d.l} · giren ${nf(d.g)} m³</title></circle>`;
    s+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(d.c).toFixed(1)}" r="2.6" fill="#5CD07A"><title>${d.l} · çıkan ${nf(d.c)} m³</title></circle>`;
  });
  // alt şerit: günlük tapawut %
  const by=mt+ih+16, bh=20;
  const mp=Math.max(...days.map(d=>Math.abs(d.p)),1);
  days.forEach((d,i)=>{
    const w=Math.max(3,iw/n-3), x=X(i)-w/2;
    const hh=Math.max(1.5,bh*(Math.abs(d.p)/mp));
    const c=Math.abs(d.p)<=2?"#3E6B57":d.p>0?"#F0A03C":"#F2635A";
    s+=`<rect x="${x.toFixed(1)}" y="${(by+bh-hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="${c}"><title>${d.l} · tapawut ${nf(d.f)} m³ (%${nf(d.p,2)})</title></rect>`;
    const e=Math.ceil(n/12);
    if(i%e===0)s+=`<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" fill="#9AABBC" font-family="ui-monospace,Consolas,monospace" font-size="9">${d.t.getDate()}.${d.t.getMonth()+1}</text>`;
  });
  s+=`<text x="${ml-8}" y="${by+bh}" text-anchor="end" fill="#9AABBC" font-size="8.5">tapawut %</text>`;
  return s+"</svg>";
}

/* ---------- havuz denge paneli ---------- */
function havuzDenge(tr,l22){
  if(yokAd([...tr,...l22]))return `<div class="pan" style="margin:0"><div class="ph"><h2>Howzuň deňagramlylyk gözegçiligi</h2><span class="tg tg-n">DOLY DÄL</span></div>
    <div class="pb"><div class="ok-box">Hesaplap bolmaýar: <b>${yokAd([...tr,...l22])}</b> maglumaty ýok.</div></div></div>`;
  const gi=q(tr), ci=q(l22), df=gi-ci, pc=ci?df/ci*100:0;
  const kayip=Math.abs(pc)>2;
  const gd=sumR(tr,LAST,LAST), cd=sumR(l22,LAST,LAST);
  const gm=sumR(tr,mS(0),LAST), cm=sumR(l22,mS(0),LAST);
  const cls=Math.abs(pc)<=2?"up":Math.abs(pc)<=5?"wr":"dn";
  return `<div class="pan" style="margin:0;${kayip?"border-color:#6B4A1F":""}">
    <div class="ph"><h2>Howzuň deňagramlylyk gözegçiligi</h2>
      <span class="tg ${Math.abs(pc)<=2?"tg-ok":"tg-tr"}">${Math.abs(pc)<=2?"DEŇAGRAMLYLYK KADALY":"ÝITGI BAR"}</span></div>
    <div class="pb">
      <div style="text-align:center;padding:4px 0 10px">
        <div class="lb" style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--tx3)">Häzirki tapawut</div>
        <div class="mono ${cls}" style="font-size:27px;font-weight:600;line-height:1.2">${df>=0?"+":""}${nf(df,1)} <span style="font-size:12px;color:var(--tx3)">m³/sag</span></div>
        <div class="mono ${cls}" style="font-size:12px">%${nf(pc,2)} · kabul ±%2</div>
      </div>
      <div class="kv"><span>Girýän · MT-2/1 + MT-2/2</span><b>${nf(gi,1)} m³/sag</b></div>
      <div class="kv"><span>Çykýan · MT-3 + MT-4 + MT-5</span><b>${nf(ci,1)} m³/sag</b></div>
      <div class="kv"><span>Şu gün girýän / çykýan</span><b>${nf(gd)} / ${nf(cd)} m³</b></div>
      <div class="kv"><span>Şu aý girýän / çykýan</span><b>${nf(gm)} / ${nf(cm)} m³</b></div>
      ${kayip?`<div style="margin-top:10px;border-top:1px solid var(--brd);padding-top:9px">
        <div class="lb" style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--or);margin-bottom:6px">Tapawut tablisasy</div>
        <table style="margin:0"><thead><tr><th>Döwür</th><th class="m">Girýän</th><th class="m">Çykýan</th><th class="m">Tapawut</th><th class="m">%</th></tr></thead><tbody>
        ${[["Şu gün",gd,cd],["Düýn",sumR(tr,LAST-1,LAST-1),sumR(l22,LAST-1,LAST-1)],
           ["Şu aý",gm,cm],["Geçen aý",sumR(tr,mS(-1),mS(0)-1),sumR(l22,mS(-1),mS(0)-1)],
           ["Şu ýyl",sumR(tr,yS(0),LAST),sumR(l22,yS(0),LAST)]]
          .map(([l,g,c])=>`<tr><td>${l}</td><td class="m">${nf(g)}</td><td class="m">${nf(c)}</td>
            <td class="m ${g-c>0?"wr":"up"}">${g-c>=0?"+":""}${nf(g-c)}</td>
            <td class="m ${Math.abs(c?(g-c)/c*100:0)<=2?"up":"wr"}">${nf(c?(g-c)/c*100:0,2)}</td></tr>`).join("")}
        </tbody></table>
        <div style="font-size:11px;color:var(--tx2);line-height:1.7;margin-top:8px">
          Girýän > çykýan bolsa: howzuň derejesi galýar, daşyna dökülýär ýa-da howuzda syzma bar.<br>
          Girýän < çykýan bolsa: howuz boşaýar ýa-da turba hasaplaýjysynyň koeffisiýenti ýokary.<br>
          Dereje datçigi birikdirilse <b>ΔHacim</b> deňlemeden aýrylýar we galany göni ýitgi bolýar.
        </div></div>`:`
        <div style="font-size:11.5px;color:var(--tx2);line-height:1.7;margin-top:8px;border-top:1px solid var(--brd);padding-top:9px">
          MT-2/1 + MT-2/2 jemi, MT-3 + MT-4 + MT-5 jemine deň bolmaly. Häzir çäk içinde;
          tapawut %2'yi aşarsa bu panelde dönem dönem tapawut tablosu açılır.</div>`}
    </div></div>`;
}

/* ---------- İSTASYON ---------- */
P.ps=(id)=>{
  const st=STATIONS.find(s=>s.id===id);
  const pumps=st.gr.flatMap(g=>g.pumps), outs=st.gr.flatMap(g=>g.outs);
  const t=per3(outs);
  const sakalar=SAKAS.filter(s=>st.gr.some(g=>g.mt===s.mt));
  return `
  <div class="h1row"><h1>${st.ad}</h1><span class="crumb">Baş sahypa › Suw Göteriji Beketler › <b>${st.id}</b></span></div>
  <div class="kpirow">
    ${kpi("◉","#39B6EE",st.id+" häzirki debi",nf(q(outs),1),"m³/sag","Beketiň jemi")}
    ${kpi("▤","#5CD07A","Günlük sarp ediliş",nf(t.d),"m³",`Düýn: ${nf(t.y)} &nbsp;${arrow(pct(t.d,t.y))}`)}
    ${kpi("▦","#A78BFA","Şu aýky sarp ediliş",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} &nbsp;${arrow(pct(t.m,t.pm))}`)}
    ${kpi("▨","#F0A03C","Şu ýylky sarp ediliş",nf(t.yr),"m³",`Geçen ýyl: ${nf(t.py)}`)}
    ${kpi("⚖","#5FD0FF","Deňagramlylyk tapawudy (häzirki)",nf(q(pumps)-q(outs),1),"m³/sag",`%${nf(pct(q(pumps),q(outs)),2)}`)}
    ${kpi("⚑","#5CD07A","Nasoslaryň sany",pumps.length,"",st.gr.length+" grup · deň ulanylyş nobaty")}
  </div>

  <div class="grpgrid">${(()=>{const maxN=Math.max(...st.gr.map(g=>Math.max(g.pumps.length,g.outs.length*1.25)));
     return st.gr.map(g=>grupKart(g,maxN)).join("")})()}</div>

  <div class="pan"><div class="ph"><h2>Turbaly suw geçirijileriň jemleýji tablisasy</h2></div>
    <div class="scroll"><table><thead><tr>
      <th>Turba / Nokat</th><th class="m">Häzirki m³/sag</th><th class="m">Şu gün</th><th class="m">Düýn</th>
      <th class="m">Şu aý</th><th class="m">Geçen aý</th><th class="m">Şu ýyl</th><th>Meýil 7g</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${[...outs,...sakalar].map(m=>{const p=per3([m]);
        return `<tr><td><b>${m.ad}</b> <span class="tg ${m.tip==="saka"?"tg-n":m.rol==="transfer"?"tg-tr":"tg-c"}">${m.tip==="saka"?"SAKA":m.rol==="transfer"?"TRANSFER":"ESASY TURBA"}</span></td>
        <td class="m">${nf(m.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.y)}</td>
        <td class="m">${nf(p.m)}</td><td class="m">${nf(p.pm)}</td><td class="m">${nf(p.yr)}</td>
        <td>${spark(Array.from({length:7},(_,i)=>m.d[LAST-6+i]))}</td>
        <td><span class="tg tg-ok">Işjeň</span></td></tr>`}).join("")}
      <tr class="tot"><td>JEMI</td><td class="m">${nf(q(outs),1)}</td><td class="m">${nf(per3(outs).d)}</td>
      <td class="m">${nf(per3(outs).y)}</td><td class="m">${nf(per3(outs).m)}</td>
      <td class="m">${nf(per3(outs).pm)}</td><td class="m">${nf(per3(outs).yr)}</td><td></td><td></td></tr>
    </tbody></table></div></div>`;
};

/* ---------- tek grup kartı: şema + altında yük dağılımı ---------- */
function grupKart(g,maxN){
  const sumQ=q(g.pumps), lineQ=q(g.outs), dev=lineQ?(sumQ-lineQ)/lineQ*100:0, ok=Math.abs(dev)<=3;
  const D=series(g.pumps,"d");
  const sets=g.pumps.map((p,i)=>({c:CLR[i%CLR.length],vals:series([p],"d").map(x=>x.v)}));
  const ay=g.pumps.map(p=>sumR([p],mS(0),LAST)), ayT=ay.reduce((a,b)=>a+b,0)||1;
  const yil=g.pumps.map(p=>sumR([p],yS(0),LAST)), yilT=yil.reduce((a,b)=>a+b,0)||1;
  const ideal=100/g.pumps.length;
  const sapma=Math.max(...yil.map(v=>Math.abs(v/yilT*100-ideal)));
  return `<div class="pan" style="margin:0">
    <div class="ph"><h2>${g.ad}</h2>
      <span class="crumb mono ${ok?"up":"wr"}">Σ nasos ${nf(sumQ,1)} · hat ${nf(lineQ,1)} · denge %${nf(dev,2)}</span></div>
    <div class="pb scroll" style="padding-bottom:6px">${schemaGrup(g,maxN)}</div>

    <div class="ph grpsep"><h2>Nasoslaryň ýük paýlanyşy</h2>
      <span class="crumb">hedef %${nf(ideal,1)} · ýyllyk iň uly gyşarma
        <b class="${sapma<=3?"up":sapma<=6?"wr":"dn"}">%${nf(sapma,1)}</b></span></div>
    <div class="pb grpbody">
      ${chLine(D,{h:170,multi:sets,area:false})}
      <div class="crumb" style="margin:6px 0 10px">Soňky 14 gün · her nasosyň günlük sarp edilişi (m³)</div>
      <table style="margin:0"><thead><tr><th>Nasos</th><th class="m">Häzirki</th><th class="m">Şu aý m³</th>
        <th class="m">Aýlyk paý</th><th class="m">Ýyllyk paý</th></tr></thead><tbody>
      ${g.pumps.map((p,i)=>{const pa=ay[i]/ayT*100, py=yil[i]/yilT*100;
        return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CLR[i%CLR.length]};margin-right:7px"></span>
          <b>${p.ad}</b> <span class="mono" style="font-size:10px;color:var(--tx3)">${p.fid}</span></td>
          <td class="m">${nf(p.q,1)}</td><td class="m">${nf(ay[i])}</td><td class="m">${nf(pa,1)}</td>
          <td class="m ${Math.abs(py-ideal)<=3?"up":Math.abs(py-ideal)<=6?"wr":"dn"}">${nf(py,1)}</td></tr>`}).join("")}
      <tr class="tot"><td>Maksat · deň ulanylyş</td><td class="m">${nf(sumQ,1)}</td><td class="m">${nf(ayT)}</td>
        <td class="m">100,0</td><td class="m">${nf(ideal,1)}</td></tr>
      </tbody></table>
      <div class="grpnote">Ýyllyk paý maksatdan hemişelik gyşarýan bolsa, nobat deň işlemeýär ýa-da şol nasos şol bir wagtda az suw berýär.</div>
    </div></div>`;
}

/* ---------- tek grup şeması (dar kolon) ---------- */
function schemaGrup(g,maxN){
  const W=620, ROW=58, TOP=16;
  const PX=32, PW=152, PH=40, CIR=234, COL=280, MX=316, MW=176, MH=48, END=W-16;
  const F=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"
    ${o.a?`text-anchor="${o.a}"`:""} ${o.w?`font-weight="${o.w}"`:""} ${o.m?'font-family="ui-monospace,Consolas,monospace"':""}>${t}</text>`;
  const L=(x1,y1,x2,y2,c,w,anim)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w||2.2}"${anim?' class="flowpipe"':""}/>`;
  const A=(x,y,c,s2)=>`<path d="M${x} ${y-(s2||4.5)} L${x+(s2||4.5)*1.7} ${y} L${x} ${y+(s2||4.5)} Z" fill="${c}"/>`;
  const box=(x,y,w,hh,id,ad,val,sub,c,on)=>`
    <rect x="${x}" y="${y-hh/2}" width="${w}" height="${hh}" rx="6" fill="${on?"#455D6F":"#3A4D5C"}" stroke="${c}" stroke-width="1.3"/>
    <circle cx="${x+14}" cy="${y}" r="6" fill="none" stroke="${c}" stroke-width="1.2"/>
    <line x1="${x+14}" y1="${y-6}" x2="${x+14}" y2="${y+6}" stroke="${c}" stroke-width="1.1"/>
    ${F(x+26,y-hh/2+15,ad,{s:9,f:"#9AABBC",m:1})}
    ${F(x+26,y-hh/2+32,val,{s:13.5,w:600,f:on?c:"#9AABBC",m:1})}
    ${sub?F(x+26,y-hh/2+45,sub,{s:8.5,f:"#9AABBC",m:1}):""}
    ${F(x+w-8,y-hh/2+15,id,{s:8.5,a:"end",f:"#7D93A8",m:1})}`;

  const n=g.pumps.length;
  const rows=Math.max(maxN||n, n, g.outs.length*1.25);     // tüm gruplarda ortak yükseklik
  const H=TOP+rows*ROW+26;
  const ys=g.pumps.map((_,i)=>TOP+ROW/2+i*ROW);
  const top=ys[0], bot=ys[n-1];
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:560px">`;
  g.pumps.forEach((p,i)=>{
    const y=ys[i], on=p.q>0.1, c=on?"#39B6EE":"#7D93A8";
    s+=A(12,y,on?"#829CB0":"#5C7C94",5)+L(24,y,PX,y,c,2.2,on);
    s+=box(PX,y,PW,PH,p.fid,p.ad,nf(p.q,1)+" m³/sag","",c,on);
    s+=L(PX+PW,y,CIR-14,y,c,2.2,on);
    s+=`<circle cx="${CIR}" cy="${y}" r="13" fill="#394D5C" stroke="${c}" stroke-width="1.8"/>`;
    s+=`<path d="M${CIR-5} ${y-6.5} L${CIR+7} ${y} L${CIR-5} ${y+6.5} Z" fill="${c}" opacity="${on?1:.45}"/>`;
    s+=L(CIR+13,y,COL,y,c,2.2,on);
    if(!on)s+=F(CIR,y+25,"akym ýok",{s:8,a:"middle",f:"#9AABBC",m:1});
  });
  s+=L(COL,top-5,COL,bot+5,"#39B6EE",8);
  s+=F(COL,bot+24,"Σ "+nf(q(g.pumps),1),{s:10,a:"middle",f:"#5FD0FF",m:1});
  g.outs.forEach((o,k)=>{
    const oy = g.outs.length===1 ? (top+bot)/2 : TOP+36+k*72;
    const tr=o.mt===2, c=tr?"#F0A03C":"#5CD07A";
    s+=L(COL,oy,MX,oy,c,5,1)+A(MX-13,oy,c,5);
    s+=box(MX,oy,MW,MH,o.fid,o.ad,nf(o.q,1)+" m³/sag","şu gün "+nf(o.d[LAST])+" m³",c,true);
    s+=L(MX+MW,oy,END-12,oy,c,5,1)+A(END-12,oy,c,6.5);
    s+=F(MX+MW+10,oy-14,tr?"→ havuz":"→ sarp edijä",{s:9,f:"#9AABBC"});
  });
  return s+"</svg>";
}

/* ---------- MT HATTI ---------- */
P.mt=(mt)=>{
  const L=byMT(mt), main=L.filter(m=>m.tip==="ana"&&m.saka===0), saz=L.filter(m=>m.tip==="sazlayjy");
  const sakalar=SAKAS.filter(s=>s.mt===mt), gat=L.filter(m=>m.tip==="gatla");
  const t=per3(main), dag=[...saz,...sakalar];
  const dif=q(main)-q(dag);
  const subs=[...new Set(L.filter(m=>m.sub>0&&m.tip!=="ana").map(m=>m.sub))].sort();
  return `
  <div class="h1row"><h1>MT-${mt} Ana Hat</h1><span class="crumb">Baş sahypa › Turbaly Suw Geçirijiler › <b>MT-${mt}</b></span></div>
  <div class="kpirow">
    ${kpi("≋","#39B6EE",`MT-${mt} ana hat (häzirki)`,nf(q(main),1),"m³/sag",`Günlük: ${nf(t.d)} m³`)}
    ${kpi("⑃","#5FD0FF","Sazlaýjylaryň jemi",nf(q(saz),1),"m³/sag",`${saz.length} regülatör`)}
    ${kpi("◍","#A78BFA","SAKA turbalaryna gidýän",nf(q(sakalar),1),"m³/sag",`${sakalar.length} kanal · jikme-jigi SAKA sahypasynda`)}
    ${kpi("⚖",Math.abs(pct(q(main),q(dag)))<5?"#5CD07A":"#F0A03C","Deňagramlylyk tapawudy",nf(dif,1),"m³/sag",`%${nf(pct(q(main),q(dag)),2)} · kabul <%5`)}
    ${kpi("▦","#F0A03C","Şu aýky sarp ediliş",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} ${arrow(pct(t.m,t.pm))}`)}
    ${kpi("⑂","#5CD07A","Kömekçi turba (Sub MT)",subs.length,"",`${saz.length} sazlaýjy noktası`)}
  </div>

  ${yokAd(L.filter(m=>m.tip!=="gatla"&&m.tip!=="pompa"))?`<div class="pan" style="border-color:#6B4A1F"><div class="pb" style="color:#F0C48A;font-size:12px">Maglumat ýok: <b>${yokAd(L.filter(m=>m.tip!=="gatla"&&m.tip!=="pompa"))}</b> — deňagramlylyk doly däl.</div></div>`:""}
  <div class="pan"><div class="ph"><h2>MT-${mt} turba shemasy</h2>
    <span class="crumb"><span style="color:#5FD0FF">■</span> kömekçi turba &nbsp;<span style="color:#5CD07A">■</span> sazlaýjy
      &nbsp;<span style="color:#A78BFA">■</span> SAKA (bas → kanal jikme-jigi)</span></div>
    <div class="pb scroll">${schemaMT(mt)}</div></div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Häzirki akymyň paýlanyşy</h2></div>
      <div class="pb" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        ${chDonut([{l:"Sazlaýjy",v:q(saz),c:CLR[0]},{l:"SAKA",v:q(sakalar),c:CLR[1]},{l:"Ýitgi",v:Math.max(0,dif),c:CLR[3]}],nf(q(main),1),"m³/sag")}
        <div class="lgd">
          <span><i style="background:${CLR[0]}"></i>Sazlaýjy <b class="mono">${nf(q(saz),1)}</b></span>
          <span><i style="background:${CLR[1]}"></i>SAKA <b class="mono">${nf(q(sakalar),1)}</b></span>
          <span><i style="background:${CLR[3]}"></i>Ýitgi <b class="mono">${nf(Math.max(0,dif),1)}</b></span>
        </div></div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Sarp ediliş grafigi (m³)</h2><span class="crumb" id="mtPer"></span></div>
      <div class="pb">${chLine(series(main),{h:180})}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Giriş / paýlanyş deňeşdirmesi</h2></div>
      <div class="pb">${chBar(series(main).map((x,i)=>({l:x.l,s:x.s,a:x.v,b:series(dag)[i].v})),{h:180,pairs:true})}
      <div class="crumb" style="margin-top:6px"><span style="color:#5CD07A">■</span> Giriş (Main) &nbsp;<span style="color:#7D93A8">■</span> Paýlanyş (Σ kömekçi hasaplaýjy)</div></div></div>
  </div>

  <div class="pan"><div class="ph"><h2>Kömekçi turbalar we sazlaýjy çykyşlary</h2>
    <span class="crumb">Kanal gatlalary SAKA sahypalarynda</span></div>
    <div class="scroll scrollY"><table><thead><tr>
      <th>Görnüş</th><th>ID</th><th>Hasaplaýjy</th><th class="m">Häzirki m³/sag</th><th class="m">Şu gün</th>
      <th class="m">Şu aý</th><th class="m">Şu ýyl</th><th class="m">% MT-${mt}</th><th>Meýil 7g</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${saz.map(m=>{const p=per3([m]);
        const flg=m.flags.slice();
        return `<tr><td><span class="tg ${m.tip==="saka"?"tg-n":m.tip==="gatla"?"tg-tr":"tg-c"}">${m.tip.toUpperCase()}</span></td>
        <td class="mono" style="color:var(--tx3)">${m.fid}</td><td><b>${m.ad}</b></td>
        <td class="m">${nf(m.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td><td class="m">${nf(p.yr)}</td>
        <td class="m">${nf(q(main)?m.q/q(main)*100:0,1)}</td>
        <td>${spark(Array.from({length:7},(_,i)=>m.d[LAST-6+i]),flg.length?"#F0A03C":"#5CD07A")}</td>
        <td>${flg.length?`<span class="tg tg-tr">${flg[0]==="veri"?"Maglumat ýok":flg[0]==="art"?"Duýdansyz artyş":"Otrisatel Δ"}</span>`:'<span class="tg tg-ok">Kadaly</span>'}</td></tr>`}).join("")}
      ${sakalar.map(sk=>{const p=per3([sk]);
        return `<tr><td><span class="tg tg-n">SAKA</span></td><td class="mono" style="color:var(--tx3)">${sk.fid}</td>
        <td><a href="#saka/SAKA-${sk.saka}" style="color:#C9BAFB"><b>${sk.ad}</b> ↗</a></td>
        <td class="m">${nf(sk.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td><td class="m">${nf(p.yr)}</td>
        <td class="m">${nf(q(main)?sk.q/q(main)*100:0,1)}</td>
        <td>${spark(Array.from({length:7},(_,i)=>sk.d[LAST-6+i]))}</td>
        <td><span class="tg tg-ok">Kadaly</span></td></tr>`}).join("")}
      <tr class="tot"><td colspan="3">JEMI PAÝLANYŞ</td><td class="m">${nf(q(dag),1)}</td>
        <td class="m">${nf(per3(dag).d)}</td><td class="m">${nf(per3(dag).m)}</td><td class="m">${nf(per3(dag).yr)}</td>
        <td class="m">${nf(q(main)?q(dag)/q(main)*100:0,1)}</td><td></td><td></td></tr>
    </tbody></table></div></div>`;
};
/* Hat üzerindeki fiziksel sıra. Excel satır sırası MT-1'de gerçek sırayı vermiyor
   (P&ID'de MT-1/1 kolu, MT-1 S-1 ve S-2'den önce geliyor). Burada düzeltiliyor.
   Anahtarlar: "sub:n" kömekçi turba, "saz:n" gövde sazlaýjy, "saka:n" SAKA. */
const HAT_SIRA=U.hat_sira||{};
function schemaMT(mt){
  const L=byMT(mt), main=L.filter(m=>m.tip==="ana"&&m.saka===0);
  /* çıkışlar: Excel sırası = hat üzerindeki fiziksel sıra (soldan sağa) */
  const cols=[], seen=new Set();
  const SW=152, IW=106, IB=94;
  const mk=k=>{
    const [t,n]=k.split(":"), i=+n;
    if(t==="saz"){const m=L.find(x=>x.tip==="sazlayjy"&&x.sub===0&&x.saz===i);return m&&{t:"saz",m,w:SW}}
    if(t==="saka"){const m=SAKAS.find(x=>x.mt===mt&&x.saka===i);return m&&{t:"saka",m,w:SW}}
    const items=L.filter(x=>x.sub===i&&x.tip!=="ana");
    return items.length&&{t:"sub",u:i,items,w:66+(items.length-1)*IW+IB/2+22};
  };
  const sira=HAT_SIRA[mt];
  if(sira){ sira.forEach(k=>{const c=mk(k); if(c)cols.push(c)}) }
  else L.forEach(m=>{
    if(m.tip==="sazlayjy"&&m.sub===0) cols.push({t:"saz",m,w:SW});
    else if(m.sub>0&&m.tip!=="ana"&&!seen.has(m.sub)){
      seen.add(m.sub);
      const items=L.filter(x=>x.sub===m.sub&&x.tip!=="ana");
      cols.push({t:"sub",u:m.sub,items,w:66+(items.length-1)*IW+IB/2+22});
    }
    else if(m.tip==="saka"&&m.sub===0) cols.push({t:"saka",m:SAKAS.find(s=>s.mt===mt&&s.saka===m.saka),w:SW});
  });

  const TY=54, X0=210, H=272;
  const W=X0+cols.reduce((a,c)=>a+c.w,0)+56;
  const T=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"
    ${o.a?`text-anchor="${o.a}"`:""} ${o.w?`font-weight="${o.w}"`:""} ${o.m?'font-family="ui-monospace,Consolas,monospace"':""}>${t}</text>`;
  const meter=(cx,cy,c)=>`<circle cx="${cx}" cy="${cy}" r="7.5" fill="#384B5A" stroke="${c}" stroke-width="1.5"/>
    <line x1="${cx}" y1="${cy-7.5}" x2="${cx}" y2="${cy+7.5}" stroke="${c}" stroke-width="1.2"/>`;

  /* gövdenin bittiği nokta = son çıkışın merkezi */
  let acc=X0, ends=[];
  cols.forEach(c=>{ends.push(c.t==="sub"?acc+66:acc+c.w/2); acc+=c.w});
  const END=ends[ends.length-1];

  let s=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,2600)}px">`;

  /* ana hat sayacı */
  s+=`<rect x="18" y="${TY-30}" width="174" height="60" rx="7" fill="#3D5262" stroke="#39B6EE" stroke-width="1.4"/>`;
  s+=T(30,TY-12,"MT-"+mt+" ESASY TURBA",{s:10});
  s+=T(30,TY+9,nf(q(main),1),{s:16,w:600,f:"#39B6EE",m:1});
  s+=T(30+String(nf(q(main),1)).length*9.6+6,TY+9,"m³/sag",{s:9,f:"#9AABBC"});
  s+=T(30,TY+24,"şu gün "+nf(sumR(main,LAST,LAST))+" m³",{s:8.5,f:"#9AABBC",m:1});
  s+=T(180,TY-12,main[0]?main[0].fid:"",{s:8.5,a:"end",f:"#7D93A8",m:1});

  /* yatay gövde — son çıkışta biter */
  s+=`<line x1="192" y1="${TY}" x2="${END}" y2="${TY}" stroke="#39B6EE" stroke-width="6"/>`;
  s+=`<line x1="${END}" y1="${TY-13}" x2="${END}" y2="${TY+13}" stroke="#39B6EE" stroke-width="4"/>`;
  s+=T(END+10,TY-16,"TURBANYŇ SOŇY",{s:9,f:"#7D93A8",m:1});

  let x=X0;
  cols.forEach(c=>{
    if(c.t==="sub"){
      const n=c.items.length, lx=x+10, cx=x+66, barY=150;
      s+=`<rect x="${x}" y="${TY+22}" width="${c.w-20}" height="${H-TY-38}" rx="8" fill="#3C505F" stroke="#526D82" stroke-dasharray="3 4"/>`;
      s+=`<line x1="${cx}" y1="${TY}" x2="${cx}" y2="${TY+34}" stroke="#5FD0FF" stroke-width="3"/>`;
      s+=`<rect x="${lx}" y="${TY+34}" width="112" height="38" rx="6" fill="#3D5262" stroke="#5FD0FF" stroke-width="1.3"/>`;
      s+=T(lx+10,TY+50,"MT-"+mt+"/"+c.u,{s:10});
      s+=T(lx+10,TY+66,nf(q(c.items),1)+" m³/sag",{s:11.5,w:600,f:"#5FD0FF",m:1});
      const ix0=cx;                     // ilk sazlaýjy doğrudan etiketin altında — boş kolektör yok
      s+=`<line x1="${cx}" y1="${TY+72}" x2="${cx}" y2="${barY}" stroke="#5FD0FF" stroke-width="3"/>`;
      if(n>1)s+=`<line x1="${cx}" y1="${barY}" x2="${ix0+(n-1)*IW}" y2="${barY}" stroke="#5FD0FF" stroke-width="3"/>`;
      c.items.forEach((it,j)=>{
        const ix=ix0+j*IW, sk=it.tip==="saka", col=sk?"#A78BFA":"#5CD07A";
        if(sk)s+=`<a href="#saka/SAKA-${it.saka}">`;
        s+=`<line x1="${ix}" y1="${barY}" x2="${ix}" y2="${barY+16}" stroke="#39B6EE" stroke-width="1.8"/>`;
        s+=meter(ix,barY+24,col);
        s+=`<rect x="${ix-IB/2}" y="${barY+38}" width="${IB}" height="36" rx="5" fill="${sk?"#150F2B":"#3D5262"}" stroke="${sk?"#A78BFA":"#6F8EA5"}"/>`;
        s+=T(ix,barY+52,it.ad+(sk?" ↗":""),{s:8.5,a:"middle",f:sk?"#C9BAFB":"#93AECB"});
        s+=T(ix,barY+66,nf(it.q,1)+" m³/sag",{s:10,a:"middle",w:600,f:"#E6EFF8",m:1});
        if(sk)s+=`</a>`;
      });
      x+=c.w; return;
    }
    const cx=x+c.w/2, sk=c.t==="saka", col=sk?"#A78BFA":"#5CD07A", BW=SW-16, by=140;
    if(sk)s+=`<a href="#saka/SAKA-${c.m.saka}">`;
    s+=`<line x1="${cx}" y1="${TY}" x2="${cx}" y2="${TY+52}" stroke="${sk?"#A78BFA":"#39B6EE"}" stroke-width="2.4"/>`;
    s+=meter(cx,TY+60,col);
    s+=`<line x1="${cx}" y1="${TY+68}" x2="${cx}" y2="${by}" stroke="${sk?"#A78BFA":"#39B6EE"}" stroke-width="2.4"/>`;
    s+=`<rect x="${cx-BW/2}" y="${by}" width="${BW}" height="${sk?60:50}" rx="6" fill="${sk?"#150F2B":"#3D5262"}" stroke="${sk?"#A78BFA":"#6F8EA5"}" stroke-width="1.2"/>`;
    s+=T(cx-BW/2+11,by+18,c.m.ad+(sk?" ↗":""),{s:10.5,f:sk?"#C9BAFB":"#93AECB"});
    s+=T(cx+BW/2-9,by+18,c.m.fid,{s:8,a:"end",f:"#7D93A8",m:1});
    s+=T(cx-BW/2+11,by+38,nf(c.m.q,1)+" m³/sag",{s:12,w:600,f:"#E6EFF8",m:1});
    if(sk)s+=T(cx+BW/2-9,by+53,c.m.gs.length+" gatla",{s:8.5,a:"end",f:"#9AABBC",m:1});
    if(sk)s+=`</a>`;
    x+=c.w;
  });
  return s+"</svg>";
}

/* ---------- SAKA ---------- */
P.saka=(key)=>{
  const sk=SAKAS.find(s=>"SAKA-"+s.saka===key)||SAKAS[0];
  const t=per3([sk]), gt=sk.gs, dif=sk.q-q(gt);
  return `
  <div class="h1row"><h1>SAKA-${sk.saka} Detay</h1>
    <span class="crumb">Baş sahypa › ${sk.mt<3?"PS-21":"PS-22"} › SAKA Beton Akaba › <b>SAKA-${sk.saka}</b></span></div>
  <div class="kpirow">
    ${kpi("◉","#39B6EE","SAKA häzirki akymy",nf(sk.q,1),"m³/sag","Turbalaryň jemi")}
    ${kpi("▤","#5CD07A","Günlük sarp ediliş",nf(t.d),"m³",`Düýn: ${nf(t.y)} ${arrow(pct(t.d,t.y))}`)}
    ${kpi("▦","#A78BFA","Şu aý",nf(t.m),"m³",`Geçen aý: ${nf(t.pm)} ${arrow(pct(t.m,t.pm))}`)}
    ${kpi("▨","#F0A03C","Şu ýyl",nf(t.yr),"m³",`Geçen ýyl: ${nf(t.py)}`)}
    ${kpi("⚖",Math.abs(dif)<=2?"#5CD07A":"#F0A03C","Deňagramlylyk tapawudy",nf(dif,1),"m³/sag",`Denge %: ${nf(pct(sk.q,q(gt)),2)}`)}
    ${kpi("⛭","#5CD07A","Açyk gatla",gt.filter(g=>g.d[LAST]>0).length+" / "+gt.length,"",`%${nf(gt.length?gt.filter(g=>g.d[LAST]>0).length/gt.length*100:0)} açyk`)}
  </div>

  ${yokAd([sk,...gt])?`<div class="pan" style="border-color:#6B4A1F"><div class="pb" style="color:#F0C48A;font-size:12px">Maglumat ýok: <b>${yokAd([sk,...gt])}</b> — deňagramlylyk doly däl.</div></div>`:""}
  <div class="gm" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>SAKA-${sk.saka} gidrawlik shema</h2>
      <span class="crumb">SAKA hasaplaýjysy → beton akabanyň gatlalary</span></div>
      <div class="pb scroll">${schemaSAKA(sk)}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Gysgaça beýan</h2></div><div class="pb">
      <div class="kv"><span>Ýokarky çeşme (MT-${sk.mt})</span><b>${nf(q(byMT(sk.mt).filter(m=>m.tip==="ana"&&m.saka===0)),1)} m³/sag</b></div>
      <div class="kv"><span>SAKA-${sk.saka} debisi</span><b>${nf(sk.q,1)} m³/sag</b></div>
      <div class="kv"><span>BA-${sk.saka} çykyş jemi</span><b>${nf(q(gt),1)} m³/sag</b></div>
      <div class="kv"><span>Deňagramlylyk tapawudy</span><b>${nf(dif,1)} m³/sag</b></div>
      <div class="kv"><span>Günlük sarp ediliş</span><b>${nf(t.d)} m³</b></div>
      <div class="kv"><span>Aýlyk sarp ediliş</span><b>${nf(t.m)} m³</b></div>
      <div class="kv"><span>Ýyllyk sarp ediliş</span><b>${nf(t.yr)} m³</b></div>
      <div class="kv" style="color:var(--cy2)"><span>Gatlanyň sany</span><b>${gt.length}</b></div>
    </div></div>
  </div>

  <div class="g3" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Günlük sarp ediliş grafigi (m³)</h2></div>
      <div class="pb">${chLine(series([sk],"d"),{h:180})}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>BA-${sk.saka} çykyş paýlanyşy</h2></div>
      <div class="pb" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        ${chDonut(gt.map((g,i)=>({l:g.ad,v:g.q,c:CLR[i%CLR.length]})),nf(q(gt),1),"m³/sag")}
        <div class="lgd" style="max-height:150px;overflow-y:auto">${gt.map((g,i)=>
          `<span><i style="background:${CLR[i%CLR.length]}"></i>${g.ad.split(" ").pop()} <b class="mono">${nf(q(gt)?g.q/q(gt)*100:0,1)}%</b></span>`).join("")}</div>
      </div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Aýlyk deňeşdirme (m³)</h2>
      <span class="crumb"><span style="color:#5CD07A">■</span>2026 <span style="color:#7D93A8">■</span>2025</span></div>
      <div class="pb">${chBar(yoy([sk]),{h:180,pairs:true})}</div></div>
  </div>

  <div class="pan"><div class="ph"><h2>BA-${sk.saka} gatla / çykyş jemi</h2></div>
    <div class="scroll"><table><thead><tr>
      <th>Turba / Çykyş</th><th>ID</th><th class="m">Häzirki m³/sag</th><th class="m">Şu gün</th><th class="m">Şu aý</th>
      <th class="m">Şu ýyl</th><th class="m">% paý</th><th>Meýil 7g</th><th>Ýagdaýy</th></tr></thead><tbody>
      ${gt.map(g=>{const p=per3([g]),fl=g.flags.slice();
        return `<tr><td><b>${g.ad}</b></td><td class="mono" style="color:var(--tx3)">${g.fid}</td>
        <td class="m">${nf(g.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td><td class="m">${nf(p.yr)}</td>
        <td class="m">${nf(q(gt)?g.q/q(gt)*100:0,1)}</td>
        <td>${spark(Array.from({length:7},(_,i)=>g.d[LAST-6+i]),fl.length?"#F0A03C":"#5CD07A")}</td>
        <td>${fl.length?`<span class="tg tg-tr">${fl[0]==="veri"?"Maglumat ýok":fl[0]==="art"?"Duýdansyz artyş":"Otrisatel Δ"}</span>`:'<span class="tg tg-ok">Kadaly</span>'}</td></tr>`}).join("")}
      <tr class="tot"><td colspan="2">JEMI</td><td class="m">${nf(q(gt),1)}</td><td class="m">${nf(per3(gt).d)}</td>
      <td class="m">${nf(per3(gt).m)}</td><td class="m">${nf(per3(gt).yr)}</td><td class="m">100,0</td><td></td><td></td></tr>
    </tbody></table></div></div>

  <div class="pan"><div class="ph"><h2>Maglumat we düşündiriş</h2></div><div class="pb" style="color:var(--tx2);line-height:1.9;font-size:12.5px">
    <b style="color:var(--cy2)">SAKA-${sk.saka} deňagramlylygy</b> = SAKA-${sk.saka} − Σ(BA-${sk.saka} G-1 … G-${gt.length})<br>
    Deňagramlylyk ölçegi: |Tapawut| ≤ %2 ýa-da ≤ ±2 m³/sag<br>
    Sarp ediliş bahalary totalizator tapawudyndan hasaplanýar; häzirki akym _Akym nokadyndan (ýok bolsa totalizatoryň soňky sagatdaky tapawudyndan).
  </div></div>`;
};
function schemaSAKA(sk){
  const gs=sk.gs, n=gs.length;
  const GW=104, X0=286, TOP=104, CH=54, H=270;
  const W=Math.max(760, X0+n*GW+70);
  const T=(x,y,t,o={})=>`<text x="${x}" y="${y}" fill="${o.f||"#93AECB"}" font-size="${o.s||10}"
    ${o.a?`text-anchor="${o.a}"`:""} ${o.w?`font-weight="${o.w}"`:""} ${o.m?'font-family="ui-monospace,Consolas,monospace"':""}>${t}</text>`;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,2400)}px">`;

  /* SAKA hasaplaýjysy */
  const cy=TOP+CH/2;
  s+=`<rect x="18" y="${cy-40}" width="212" height="80" rx="8" fill="#150F2B" stroke="#A78BFA" stroke-width="1.6"/>`;
  s+=`<circle cx="${18+24}" cy="${cy}" r="10" fill="none" stroke="#A78BFA" stroke-width="1.6"/>`;
  s+=`<line x1="${18+24}" y1="${cy-10}" x2="${18+24}" y2="${cy+10}" stroke="#A78BFA" stroke-width="1.3"/>`;
  s+=T(66,cy-15,sk.ad,{s:12,f:"#C9BAFB"});
  s+=T(226,cy-15,sk.fid,{s:8.5,a:"end",f:"#7D93A8",m:1});
  s+=T(66,cy+8,nf(sk.q,1)+" m³/sag",{s:15,w:600,f:"#E6EFF8",m:1});
  s+=T(66,cy+26,"şu gün "+nf(sk.d[LAST])+" m³",{s:9,f:"#9AABBC",m:1});
  s+=`<line x1="230" y1="${cy}" x2="${X0-24}" y2="${cy}" stroke="#5CD07A" stroke-width="3"/>`;
  s+=`<path d="M${X0-24} ${cy-5} L${X0-12} ${cy} L${X0-24} ${cy+5} Z" fill="#5CD07A"/>`;

  /* beton akaba — yatay kanal kesiti */
  const cx1=X0-12, cx2=X0+n*GW+26;
  s+=`<path d="M${cx1} ${TOP} H${cx2} L${cx2-22} ${TOP+CH} H${cx1} Z" fill="#3F5465" stroke="#6F8EA5" stroke-width="1.4"/>`;
  s+=`<path d="M${cx1+3} ${TOP+16} H${cx2-9} L${cx2-27} ${TOP+CH-3} H${cx1+3} Z" fill="#39B6EE" opacity=".16"/>`;
  s+=T(cx2-12,TOP-10,"BETON AKABA (BA-"+sk.saka+")",{s:9.5,a:"end",f:"#9AABBC"});

  /* gatlalar — kanaldan aşağı */
  gs.forEach((g,i)=>{
    const gx=X0+i*GW+GW/2, on=g.q>0.05, col=on?"#5CD07A":"#7D93A8";
    s+=`<rect x="${gx-9}" y="${TOP-26}" width="18" height="26" rx="2" fill="${on?"#5CD07A":"#526E83"}" opacity="${on?.9:.6}"/>`;
    s+=`<line x1="${gx}" y1="${TOP-40}" x2="${gx}" y2="${TOP-26}" stroke="${col}" stroke-width="2"/>`;
    s+=`<circle cx="${gx}" cy="${TOP+CH/2}" r="12" fill="#384B5A" stroke="${col}" stroke-width="1.8"/>`;
    s+=`<line x1="${gx}" y1="${TOP+CH/2-12}" x2="${gx}" y2="${TOP+CH/2+12}" stroke="${col}" stroke-width="1.4"/>`;
    s+=`<line x1="${gx}" y1="${TOP+CH}" x2="${gx}" y2="${TOP+CH+18}" stroke="${col}" stroke-width="2"/>`;
    s+=`<path d="M${gx-5} ${TOP+CH+18} L${gx+5} ${TOP+CH+18} L${gx} ${TOP+CH+27} Z" fill="${col}"/>`;
    s+=`<rect x="${gx-GW/2+6}" y="${TOP+CH+34}" width="${GW-12}" height="40" rx="5" fill="#3D5262" stroke="${on?"#6F8EA5":"#526E83"}"/>`;
    s+=T(gx,TOP+CH+50,g.ad,{s:10,a:"middle",f:"#93AECB"});
    s+=T(gx,TOP+CH+66,nf(g.q,1)+" m³/sag",{s:10.5,a:"middle",w:600,f:on?"#E6EFF8":"#9AABBC",m:1});
  });
  return s+"</svg>";
}

/* ---------- SAYAÇ LİSTESİ ---------- */
let LQ="",LT="*",LM="*";
P.liste=()=>{
  const var1=METERS.filter(m=>!m.yok).length;
  return `<div class="h1row"><h1>Hasaplaýjylaryň Sanawy</h1><span class="crumb">${METERS.length} akym ölçeýji · maglumat binýadyndan</span></div>
  <div class="kpirow" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
    ${kpi("⧉","#39B6EE","Hasaplaýjy",METERS.length,"","Nokat atlaryndan tapylan + garaşylýan")}
    ${kpi("✓","#5CD07A","Maglumatly",var1,"","Maglumat binýadynda bar")}
    ${kpi("✕",METERS.length-var1?"#F0A03C":"#5CD07A","Maglumat ýok",METERS.length-var1,"","ulgam.json-da garaşylýan")}
    ${kpi("?",tanalmadyk.length?"#F2635A":"#5CD07A","Tanalmadyk nokat",tanalmadyk.length,"","Ady düzgüne gabat gelmeýär")}
  </div>
  ${tanalmadyk.length?`<div class="pan" style="margin:0 0 14px;border-color:#8E3B36"><div class="pb" style="color:var(--tx2);font-size:12.5px;line-height:1.8">
    <b style="color:var(--rd)">Tanalmadyk hasaplaýjy nokatlary:</b> ${tanalmadyk.join(", ")}<br>
    Ady düzgüne laýyk bolmaly: MT1 · MT2_1 · MT1_S2 · MT1_1_S3 · Saka4 · BA4_G9 · PS21_T1_N1 (+ _Akym / _Toplam).</div></div>`:""}
  <div class="pan" style="margin-top:0"><div class="ph">
    <div style="display:flex;gap:9px;flex-wrap:wrap">
      <input type="search" id="lq" placeholder="Gözle: BA-4 G-7, MT-3, BA4_G7…" value="${LQ}">
      <select class="sel" id="lm"><option value="*">Ähli turbalar</option>${MTS.map(m=>`<option ${LM==m?"selected":""}>MT-${m}</option>`).join("")}</select>
      <select class="sel" id="lt"><option value="*">Ähli görnüşler</option>
        ${["ana","pompa","sazlayjy","saka","gatla"].map(t=>`<option value="${t}" ${LT===t?"selected":""}>${t}</option>`).join("")}</select>
    </div><span class="crumb" id="lcnt"></span></div>
    <div class="scroll scrollY" style="max-height:640px"><table id="ltbl"><thead><tr>
      <th>ADY</th><th class="m">Nokat</th><th>Görnüş</th><th>Wezipe</th><th class="m">Häzirki m³/sag</th>
      <th class="m">Şu gün</th><th class="m">Şu aý</th><th>Akym nokady</th><th>Jemi nokady</th><th>Soňky ýazgy</th><th>Ýagdaýy</th></tr></thead><tbody></tbody></table></div>
  </div>`;
};
function fillListe(){
  const L=METERS.filter(m=>(LM==="*"||("MT-"+m.mt)===LM)&&(LT==="*"||m.tip===LT)&&
    (!LQ||(m.ad+" "+m.fid).toLowerCase().includes(LQ.toLowerCase())));
  const c=document.getElementById("lcnt"); if(c)c.textContent=L.length+" / "+METERS.length+" hasaplaýjy";
  const tb=document.querySelector("#ltbl tbody"); if(!tb)return;
  tb.innerHTML=L.map(m=>{const p=per3([m]),fl=m.flags.slice();
    return `<tr><td><b>${m.ad}</b></td><td class="m" style="color:var(--tx3)">${m.fid}</td>
    <td><span class="tg ${m.tip==="ana"?"tg-c":m.tip==="gatla"?"tg-tr":"tg-n"}">${m.tip}</span></td>
    <td><span class="tg ${m.rol==="transfer"?"tg-tr":m.rol==="giris"?"tg-ok":"tg-n"}">${m.rol}</span></td>
    <td class="m">${nf(m.q,1)}</td><td class="m">${nf(p.d)}</td><td class="m">${nf(p.m)}</td>
    <td class="mono" style="color:var(--tx3)">${m.akym||"—"}</td><td class="mono" style="color:var(--tx3)">${m.toplam||"—"}</td>
    <td class="mono">${m.son?new Date(m.son).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</td>
    <td>${fl.length?`<span class="tg tg-tr">${fl[0]==="veri"?"Maglumat ýok":fl[0]==="art"?"Duýdansyz artyş":"Otrisatel Δ"}</span>`:'<span class="tg tg-ok">Kadaly</span>'}</td></tr>`}).join("");
}

/* ---------- RAPORLAR ---------- */
const totAt=(m,d)=>m.cum[Math.max(0,Math.min(DAYS,d))];

let R={fid:"", tip:"tuketim", from:"", to:"", per:"d", page:1, size:10, gen:false, all:false};
(function(){
  const a=dd(LAST-16), b=dd(LAST);
  R.from=isoD(a); R.to=isoD(b);
  const pref=METERS.find(m=>m.rol==="giris"&&!m.yok)||METERS.find(m=>!m.yok)||METERS[0];
  R.fid=pref.fid;
})();
const dIdx=s=>Math.max(0,Math.min(LAST,Math.round((new Date(s+"T00:00:00")-START)/86400000)));
const trDate=s=>{const p=s.split("-");return p[2]+"."+p[1]+"."+p[0]};

/* dönem satırları: totalizer başı/sonu + delta */
function repRows(){
  const m=METERS.find(x=>x.fid===R.fid); if(!m)return{m:null,rows:[]};
  const a=dIdx(R.from), b=dIdx(R.to), rows=[];
  const push=(lbl,si,ei)=>{
    const st=totAt(m,si), en=totAt(m,ei+1), tk=en-st;
    const hrs=(ei-si+1)*24;
    let mn=Infinity,mx=-Infinity;
    for(let d=si;d<=ei;d++){if(Number.isFinite(m.amn[d]))mn=Math.min(mn,m.amn[d]);if(Number.isFinite(m.amx[d]))mx=Math.max(mx,m.amx[d])}
    const h2=ei>=LAST?Math.max(1,(ei-si)*24+(Date.now()-TODAY.getTime())/3600000):hrs;   // bu gün: geçen sagatlar
    const ort=tk/h2;
    rows.push({lbl,si,ei,st,en,tk,ort,mn:Number.isFinite(mn)?mn:NaN,mx:Number.isFinite(mx)?mx:NaN,ok:tk>=0});
  };
  if(R.per==="d"){for(let d=a;d<=b;d++)push(trDate(isoD(dd(d))),d,d)}
  else if(R.per==="m"){
    let c=new Date(dd(a).getFullYear(),dd(a).getMonth(),1);
    while(c<=dd(b)){
      const si=Math.max(a,Math.round((c-START)/86400000));
      const e=new Date(c.getFullYear(),c.getMonth()+1,0);
      const ei=Math.min(b,Math.round((e-START)/86400000));
      if(ei>=si)push(MONS[c.getMonth()]+" "+c.getFullYear(),si,ei);
      c=new Date(c.getFullYear(),c.getMonth()+1,1);
    }
  } else {
    for(let y=dd(a).getFullYear();y<=dd(b).getFullYear();y++){
      const si=Math.max(a,Math.round((new Date(y,0,1)-START)/86400000));
      const ei=Math.min(b,Math.round((new Date(y,11,31)-START)/86400000));
      if(ei>=si)push(String(y),si,ei);
    }
  }
  return {m,rows};
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
  const {m,rows}=repRows();
  const tot=rows.reduce((a,b)=>a+b.tk,0);
  const ort=rows.length?rows.reduce((a,b)=>a+b.ort,0)/rows.length:0;
  const mx=rows.filter(r=>Number.isFinite(r.mx)).reduce((a,b)=>!(b.mx<=a.mx)?b:a,{mx:NaN,lbl:"—"});
  const mn=rows.filter(r=>Number.isFinite(r.mn)).reduce((a,b)=>!(b.mn>=a.mn)?b:a,{mn:NaN,lbl:"—"});
  const perAd={d:"Günlük",m:"Aýlyk",y:"Ýyllyk"}[R.per];
  const tipAd={tuketim:"Sarp ediliş hasabaty",debi:"Akym hasabaty",denge:"Deňagramlylyk hasabaty",toplam:"Totalizator hasabaty"}[R.tip];
  const pages=Math.max(1,Math.ceil(rows.length/R.size));
  if(R.page>pages)R.page=pages;
  const show=R.all?rows:rows.slice((R.page-1)*R.size,R.page*R.size);
  const opts=METERS.map(x=>`<option value="${x.fid}" ${x.fid===R.fid?"selected":""}>${x.fid} / ${x.ad}</option>`).join("");

  return `
  <div class="h1row noprint"><h1>Hasabat taýýarlamak</h1>
    <span class="crumb">Baş sahypa › Hasabatlar › <b>Hasaplaýjy hasabaty</b></span></div>

  <div class="pan noprint" style="margin-top:0"><div class="pb">
    <div class="rgrid">
      <label><span>Hasaplaýjy saýla</span><select class="sel" id="rFid">${opts}</select></label>
      <label><span>Hasabat görnüşi</span><select class="sel" id="rTip">
        <option value="tuketim" ${R.tip==="tuketim"?"selected":""}>Sarp ediliş hasabaty</option>
        <option value="debi" ${R.tip==="debi"?"selected":""}>Akym hasabaty</option>
        <option value="toplam" ${R.tip==="toplam"?"selected":""}>Totalizator hasabaty</option>
      </select></label>
      <label><span>Başlangyç</span><input class="sel" type="date" id="rFrom" value="${R.from}" min="${isoD(START)}" max="${isoD(dd(LAST))}"></label>
      <label><span>Ahyry</span><input class="sel" type="date" id="rTo" value="${R.to}" min="${isoD(START)}" max="${isoD(dd(LAST))}"></label>
      <label><span>Döwür</span><select class="sel" id="rPer">
        <option value="d" ${R.per==="d"?"selected":""}>Günlük</option>
        <option value="m" ${R.per==="m"?"selected":""}>Aýlyk</option>
        <option value="y" ${R.per==="y"?"selected":""}>Ýyllyk</option>
      </select></label>
      <div class="racts">
        <button class="btn pri" id="rGen">▶ Hasabaty döret</button>
        <button class="btn" id="rPdf" style="border-color:#8E3B36;color:#F2A9A3">⎙ PDF çykar</button>
        <button class="btn" id="rXls" style="border-color:#2E6B4E;color:#8FE0AC">⤓ Excel / CSV</button>
      </div>
    </div>
  </div></div>

  <div id="printArea">
  <div class="prthead">
    <div><b>SUW HASAPLAÝJY MAGLUMATLARY</b><div class="prtsub">${tipAd} · ${perAd}</div></div>
    <div class="prtsub">${m.fid} / ${m.ad}<br>${trDate(R.from)} – ${trDate(R.to)}</div>
  </div>

  <div class="kpirow" style="margin-top:14px">
    ${kpi("⊙","#39B6EE","Saýlanan hasaplaýjy",m.fid,"",m.ad)}
    ${kpi("◆","#5FD0FF","Jemi sarp ediliş",nf(tot),"m³","Saýlanan döwür")}
    ${kpi("≋","#5CD07A","Ortaça akym",nf(ort,1),"m³/sag","Saýlanan döwür")}
    ${kpi("↗","#A78BFA","Iň ýokary akym",nf(mx.mx,1),"m³/sag",mx.lbl)}
    ${kpi("↘","#F0A03C","Iň pes akym",nf(mn.mn,1),"m³/sag",mn.lbl)}
    ${kpi("▤","#93AECB","Ýazgy sany",rows.length,"","Jemi ýazgy")}
  </div>

  <div class="gm" style="margin-top:14px">
    <div class="pan" style="margin:0"><div class="ph"><h2>Döwürleýin sarp ediliş grafigi (m³)</h2>
      <span class="crumb"><span style="color:#5FD0FF">■</span> ${m.fid} / ${m.ad}</span></div>
      <div class="pb">${rows.length?chReport(rows):'<div class="ok-box">Saýlanan aralykda ýazgy ýok</div>'}</div></div>
    <div class="pan" style="margin:0"><div class="ph"><h2>Hasabatyň gysgaça beýany</h2></div><div class="pb">
      <div class="kv"><span>Hasaplaýjynyň ady</span><b>${m.ad}</b></div>
      <div class="kv"><span>Flowmeter ID</span><b>${m.fid}</b></div>
      <div class="kv"><span>Hat</span><b>MT-${m.mt} · ${m.tip}</b></div>
      <div class="kv"><span>Hasabat döwri</span><b>${trDate(R.from)} – ${trDate(R.to)}</b></div>
      <div class="kv"><span>Döwür</span><b>${perAd} (${rows.length} kayıt)</b></div>
      <div class="kv"><span>Başlangyç totalizator</span><b>${nf(rows.length?rows[0].st:0)} m³</b></div>
      <div class="kv"><span>Ahyrky totalizator</span><b>${nf(rows.length?rows[rows.length-1].en:0)} m³</b></div>
      <div class="kv" style="color:var(--cy2)"><span>Jemi sarp ediliş (delta)</span><b>${nf(tot)} m³</b></div>
      <div class="kv"><span>Jemi nokady</span><b>${m.toplam||"—"}</b></div>
      <div class="kv"><span>Akym nokady</span><b>${m.akym||"—"}</b></div>
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
        <td>${r.tk<0?'<span class="tg tg-tr">Otrisatel Δ</span>':r.tk===0?'<span class="tg tg-n">Maglumat ýok</span>':'<span class="tg tg-ok">✓ Tamamlandy</span>'}</td></tr>`).join("")}
      <tr class="tot"><td>JEMI</td><td class="m">${nf(rows.length?rows[0].st:0)}</td>
        <td class="m">${nf(rows.length?rows[rows.length-1].en:0)}</td><td class="m">${nf(tot)}</td>
        <td class="m">${nf(ort,1)}</td><td class="m">${nf(mn.mn,1)}</td><td class="m">${nf(mx.mx,1)}</td><td></td></tr>
    </tbody></table></div>
    <div class="pgbar noprint">
      <span class="crumb">Jemi ${rows.length} kayıt · sayfa ${R.page}/${pages}</span>
      <div style="display:flex;gap:5px;align-items:center;margin-left:auto">
        <button class="btn pgb" data-pg="${Math.max(1,R.page-1)}">‹</button>
        ${Array.from({length:Math.min(5,pages)},(_,i)=>{
          const st=Math.max(1,Math.min(R.page-2,pages-4)), n=st+i;
          return n<=pages?`<button class="btn pgb ${n===R.page?"pri":""}" data-pg="${n}">${n}</button>`:""}).join("")}
        <button class="btn pgb" data-pg="${Math.min(pages,R.page+1)}">›</button>
        <select class="sel" id="rSize" style="margin-left:6px">
          ${[10,25,50,100].map(n=>`<option ${R.size===n?"selected":""}>${n}</option>`).join("")}
        </select><span class="crumb">/ sahypa</span>
      </div>
    </div>
  </div>

  <div class="prtfoot">Çeşme: Tridium Niagara · maglumat binýady (TimescaleDB) · nokat ${m.toplam||"—"} · Sarp ediliş totalizator tapawudyndan hasaplanýar.</div>
  </div>

  <div class="pan noprint"><div class="ph"><h2>Çykyş</h2></div>
    <div class="pb" style="color:var(--tx2);line-height:1.9;font-size:12.5px">
      <b style="color:#F2A9A3">PDF çykar</b> → brauzeriň çap ediş penjiresini açýar; niýet hökmünde
      “PDF hökmünde ýatda sakla” saýlanda hasabat açyk reňkli, sahypa görnüşinde ýatda saklanýar.
      Tablisanyň hemmesi çap edilýär, sahypalara bölünmeýär.<br>
      <b style="color:#8FE0AC">Excel / CSV</b> → nokatly otur bilen bölünen, onluk otur bilen; Excel-de göni açylýar.
    </div>
    <div class="pb" id="csvWrap" style="display:none;padding-top:0">
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn" id="csvCopy">Panele göçür</button></div>
      <textarea id="csvTa" readonly></textarea></div>
  </div>`;
};

/* ================= NAV / ROUTER ================= */
const NAV=[
 {g:"",items:[["genel","⌂","Umumy Ulgam"]]},
 {g:"Suw Göteriji Beketler",items:STATIONS.map(s=>["ps/"+s.id,"▣",s.id])},
 {g:"Turbaly Suw Geçirijiler (MT)",items:MTS.filter(m=>m!==2).map(m=>["mt/"+m,"≋","MT-"+m])},   // MT-2 içki geçiriş → PS-21 sayfasında
 {g:"SAKA Beton Akaba",items:SAKAS.map(s=>["saka/SAKA-"+s.saka,"◍","SAKA-"+s.saka])},
].filter(s=>s.items.length).concat([
 {g:"",items:[["liste","☰","Hasaplaýjylaryň Sanawy"],["rapor","▤","Hasabatlar"]]}
]);
document.getElementById("navwrap").innerHTML=NAV.map(s=>
  (s.g?`<div class="navgrp">${s.g}</div>`:`<div style="height:9px"></div>`)+
  s.items.map(([h,ic,t])=>`<div class="nav" data-h="${h}"><span class="ic">${ic}</span>${t}</div>`).join("")).join("");

function route(){
  let h=(location.hash||"#genel").slice(1);
  if(h==="mt/2"){location.hash=STATIONS.length?"#ps/"+STATIONS[0].id:"#genel";return}
  if(/^ps\//.test(h)&&!STATIONS.find(s=>"ps/"+s.id===h)){location.hash="#genel";return}
  const [p,a]=h.split("/");
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("on",n.dataset.h===h));
  const v=document.getElementById("view");
  v.innerHTML = p==="ps"?P.ps(a) : p==="mt"?P.mt(+a) : p==="saka"?P.saka(a)
    : p==="liste"?P.liste() : p==="rapor"?P.rapor() : P.genel();
  document.getElementById("crumb").innerHTML = {genel:"Umumy Ulgam",ps:"Suw Göteriji Beketler › <b>"+a+"</b>",
    mt:"Turbaly Suw Geçirijiler › <b>MT-"+a+"</b>",saka:"SAKA Beton Akaba › <b>"+a+"</b>",
    liste:"<b>Hasaplaýjylaryň Sanawy</b>",rapor:"<b>Hasabatlar</b>"}[p]||"Umumy Ulgam";
  if(p==="liste")fillListe();
  document.getElementById("side").classList.remove("open");
  window.scrollTo({top:0});
}
addEventListener("hashchange",route);
document.getElementById("navwrap").addEventListener("click",e=>{
  const n=e.target.closest(".nav"); if(n)location.hash="#"+n.dataset.h});
document.getElementById("per").onchange=e=>{PER=e.target.value;route()};
document.getElementById("burger").onclick=()=>document.getElementById("side").classList.toggle("open");
document.addEventListener("input",e=>{
  if(e.target.id==="lq"){LQ=e.target.value;fillListe()}});
document.addEventListener("change",e=>{
  if(e.target.id==="lm"){LM=e.target.value;fillListe()}
  if(e.target.id==="lt"){LT=e.target.value;fillListe()}
  if(e.target.id==="rFid"){R.fid=e.target.value;R.page=1;route()}
  if(e.target.id==="rTip"){R.tip=e.target.value;route()}
  if(e.target.id==="rPer"){R.per=e.target.value;R.page=1;route()}
  if(e.target.id==="rSize"){R.size=+e.target.value;R.page=1;route()}
  if(e.target.id==="rFrom"){R.from=e.target.value;if(R.from>R.to)R.to=R.from;R.page=1;route()}
  if(e.target.id==="rTo"){R.to=e.target.value;if(R.to<R.from)R.from=R.to;R.page=1;route()}});
document.addEventListener("click",e=>{
  const pg=e.target.closest(".pgb");
  if(pg){R.page=+pg.dataset.pg;route();return}
  if(e.target.id==="rGen"){R.page=1;route();return}
  if(e.target.id==="rPdf"||(e.target.id==="exp"&&location.hash==="#rapor")){printReport();return}
  if(e.target.id==="exp"){location.hash="#rapor";return}
  if(e.target.id==="rXls"){
    const {m,rows}=repRows();
    const q2=v=>nf(v,2).replace(/\./g,"");
    const L=["Sayac;"+m.fid+" "+m.ad,"Donem;"+trDate(R.from)+" - "+trDate(R.to),"",
      "donem;baslangic_total;bitis_total;tuketim_m3;ort_debi;min_debi;maks_debi"];
    rows.forEach(r=>L.push([r.lbl,q2(r.st),q2(r.en),q2(r.tk),q2(r.ort),q2(r.mn),q2(r.mx)].join(";")));
    document.getElementById("csvWrap").style.display="";
    document.getElementById("csvTa").value=L.join("\n");
    document.getElementById("csvWrap").scrollIntoView({behavior:"smooth",block:"center"});
    return}
  if(e.target.id==="csvCopy"){const ta=document.getElementById("csvTa");ta.select();
    try{navigator.clipboard.writeText(ta.value)}catch(_){document.execCommand("copy")}
    e.target.textContent="Göçürildi";setTimeout(()=>e.target.textContent="Panele göçür",1500)}
});
function printReport(){
  const {m,rows}=repRows();
  const tot=rows.reduce((a,b)=>a+b.tk,0);
  const ort=rows.length?rows.reduce((a,b)=>a+b.ort,0)/rows.length:0;
  const perAd={d:"Günlük",m:"Aýlyk",y:"Ýyllyk"}[R.per];
  const tipAd={tuketim:"Sarp ediliş hasabaty",debi:"Akym hasabaty",denge:"Deňagramlylyk hasabaty",toplam:"Totalizator hasabaty"}[R.tip];
  const css=`
   @page{size:A4 landscape;margin:11mm}
   *{box-sizing:border-box}
   body{margin:0;font-family:Inter,Arial,sans-serif;color:#12212F;font-size:10.5px}
   .hd{display:flex;align-items:center;gap:14px;border-bottom:2.5px solid #0B4E6B;padding-bottom:9px}
   .hd img{width:62px;height:62px;object-fit:contain}
   .hd h1{margin:0;font-size:15px;letter-spacing:.04em;color:#0B4E6B}
   .hd .s{font-size:10px;color:#4A5F76;margin-top:3px;line-height:1.5}
   .hd .r{margin-left:auto;text-align:right;font-size:10px;color:#4A5F76;line-height:1.6}
   .kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:11px 0}
   .kpi div{border:1px solid #C7D2DD;border-radius:5px;padding:6px 8px}
   .kpi .l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#6B7F94}
   .kpi .v{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;margin-top:2px}
   .kpi .u{font-size:8.5px;color:#6B7F94;font-weight:400}
   table{width:100%;border-collapse:collapse;margin-top:4px}
   th,td{border-bottom:1px solid #DDE5EC;padding:4px 7px;font-size:9.5px;text-align:left}
   th{background:#EEF3F8;color:#4A5F76;font-size:8.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:600}
   td.m,th.m{text-align:right;font-family:"IBM Plex Mono",monospace}
   tr.tot td{border-top:1.4px solid #9AAABB;font-weight:700;color:#0B4E6B}
   .row2{display:grid;grid-template-columns:1.55fr 1fr;gap:8px;margin:9px 0 4px;break-inside:avoid}
   .bx{border:1px solid #C7D2DD;border-radius:5px;padding:7px 9px}
   .bt{font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin-bottom:5px}
   .bt2{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin:10px 0 2px}
   table.kv{margin:0}
   table.kv td{border-bottom:1px solid #E7EDF3;padding:3.2px 2px;font-size:9px}
   table.kv td.m{text-align:right;font-family:"IBM Plex Mono",monospace}
   thead{display:table-header-group}
   tr{break-inside:avoid}
   .ft{margin-top:9px;border-top:1px solid #C7D2DD;padding-top:5px;font-size:8px;color:#6B7F94}
   .ok{color:#25683F}.wr{color:#8A5116}`;
  const chart = rows.length ? chReport(rows)
      .replace(/#475F72/g,"#DCE6EE")
      .replace(/#9AABBC/g,"#5B7085")
      .replace(/#93AECB/g,"#33506B")
      .replace(/#5FD0FF/g,"#1478B0")
      .replace(/#39B6EE/g,"#3FA3DC")
      .replace(/#384B5A/g,"#FFFFFF")
    : '<div style="padding:24px;text-align:center;color:#6B7F94">Saýlanan aralykda ýazgy ýok</div>';
  const body=`
   <div class="hd"><img src="${LOGO}">
     <div><h1>SUW HASAPLAÝJY MAGLUMATLARY</h1>
       <div class="s">Türkmenistanyň Suw Hojalygy baradaky Döwlet Komiteti<br>${tipAd} · ${perAd}</div></div>
     <div class="r"><b>${m.ad}</b> · ${m.fid}<br>MT-${m.mt} · ${m.tip}<br>${trDate(R.from)} – ${trDate(R.to)}</div></div>
   <div class="kpi">
     <div><div class="l">Saýlanan hasaplaýjy</div><div class="v">${m.fid}</div></div>
     <div><div class="l">Jemi sarp ediliş</div><div class="v">${nf(tot)} <span class="u">m³</span></div></div>
     <div><div class="l">Ortaça akym</div><div class="v">${nf(ort,1)} <span class="u">m³/sag</span></div></div>
     <div><div class="l">Başlangyç totalizator</div><div class="v">${nf(rows.length?rows[0].st:0)}</div></div>
     <div><div class="l">Ahyrky totalizator</div><div class="v">${nf(rows.length?rows[rows.length-1].en:0)}</div></div>
     <div><div class="l">Ýazgy sany</div><div class="v">${rows.length}</div></div></div>
   <div class="row2">
     <div class="bx"><div class="bt">Döwürleýin sarp ediliş grafigi (m³)</div>${chart}</div>
     <div class="bx"><div class="bt">Hasabatyň gysgaça beýany</div>
       <table class="kv">
         <tr><td>Hasaplaýjynyň ady</td><td class="m">${m.ad}</td></tr>
         <tr><td>Flowmeter ID</td><td class="m">${m.fid}</td></tr>
         <tr><td>Turba / görnüş</td><td class="m">MT-${m.mt} · ${m.tip}</td></tr>
         <tr><td>Hasabat döwri</td><td class="m">${trDate(R.from)} – ${trDate(R.to)}</td></tr>
         <tr><td>Döwür</td><td class="m">${perAd} (${rows.length} ýazgy)</td></tr>
         <tr><td>Başlangyç totalizator</td><td class="m">${nf(rows.length?rows[0].st:0)} m³</td></tr>
         <tr><td>Ahyrky totalizator</td><td class="m">${nf(rows.length?rows[rows.length-1].en:0)} m³</td></tr>
         <tr><td><b>Jemi sarp ediliş (delta)</b></td><td class="m"><b>${nf(tot)} m³</b></td></tr>
         <tr><td>Jemi nokady</td><td class="m">${m.toplam||"—"}</td></tr>
         <tr><td>Akym nokady</td><td class="m">${m.akym||"—"}</td></tr>
       </table></div>
   </div>
   <div class="bt2">Jikme-jik hasabat tablisasy</div>
   <table><thead><tr><th>Döwür</th><th class="m">Başlangyç jemi (m³)</th><th class="m">Ahyrky jemi (m³)</th>
     <th class="m">Sarp ediliş (m³)</th><th class="m">Ortaça akym</th><th class="m">Iň pes</th><th class="m">Iň ýokary</th><th>Ýagdaýy</th></tr></thead><tbody>
     ${rows.map(r=>`<tr><td><b>${r.lbl}</b></td><td class="m">${nf(r.st)}</td><td class="m">${nf(r.en)}</td>
       <td class="m">${nf(r.tk)}</td><td class="m">${nf(r.ort,1)}</td><td class="m">${nf(r.mn,1)}</td><td class="m">${nf(r.mx,1)}</td>
       <td class="${r.tk>0?"ok":"wr"}">${r.tk<0?"Otrisatel Δ":r.tk===0?"Maglumat ýok":"Tamamlandy"}</td></tr>`).join("")}
     <tr class="tot"><td>JEMI</td><td class="m">${nf(rows.length?rows[0].st:0)}</td>
       <td class="m">${nf(rows.length?rows[rows.length-1].en:0)}</td><td class="m">${nf(tot)}</td>
       <td class="m">${nf(ort,1)}</td><td class="m"></td><td class="m"></td><td></td></tr></tbody></table>
   <div class="ft">Çeşme: Tridium Niagara · maglumat binýady (TimescaleDB) · nokat ${m.toplam||"—"} ·
     Sarp ediliş totalizator tapawudyndan hasaplanýar.<br>
     Hasabat senesi: ${new Date().toLocaleDateString("ru-RU")}</div>`;
  const doc=`<!DOCTYPE html><html lang="tk"><head><meta charset="utf-8">

    <title>${m.ad} · ${tipAd}</title><style>${css}</style></head><body>${body}</body></html>`;

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
function freshTick(){
  const d=new Date(), p=x=>String(x).padStart(2,"0");
  const s=VERI.son?Math.round((Date.now()-VERI.son)/60000):null;
  document.getElementById("clock").innerHTML=p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes())+
    ' <span style="color:var(--tx3)">· soňky maglumat '+(s==null?"ýok":s<90?s+" min öň":Math.round(s/60)+" sag öň")+'</span>';
}
freshTick(); setInterval(freshTick,20000);
const _bl=document.getElementById("brandLogo"); if(_bl)_bl.src=LOGO;   // yan menüde logo ýok (TV-niň öz sözbaşy bar); PDF-de bar
route();

}
})()
