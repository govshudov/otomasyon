/**
 * Deneme modu (`?demo`): Niagara ve canlı veri olmadan sayfaların Chrome'da denenmesi.
 *
 *   istasyon   PS-04 (1 Maý): listesi ve konfigürasyonu geliştirmede API'den, yoksa stations.json'dan
 *   geçmiş     her etiket için ÜRETİLMİŞ, belirlenimci veri (aynı an hep aynı değer; yakınlaşınca
 *              aynı eğrinin incesi gelir): nasoslar inwertorda / transformatorda / durýar dönemleriyle,
 *              sagat sayaçları bu dönemlerle tutarlı; temperatura, basyş, tok, kuwwat; esasy turbalar;
 *              howuz derejesi; "db:<ad>" veritabanı noktaları (akym, jemi sayaçlar, nasos temperaturası)
 *   noktalar   tsQuery('op=points') → public/demo/noktalar.json
 *   canlı      depoya 5 sn'de bir "şu an"ın değerleri yazılır (Hasabatlar'ın canlı sütunları için)
 *
 * Bu dosya yalnız `?demo` iken (dinamik import) yüklenir; önümçilik yolları ona hiç girmez.
 */
import type { Bucket, HistResult, Source } from './history'
import { asset, type DbPoint } from './niagara'
import { toplumlarOf, type EqCfg, type StationCfg } from './pump'
import { loadTempPlan, parseTempName } from './nasosTemp'
import { unescapeName, type Sozluk } from './etiket'
import { useTwin, type Sample } from './store'

export const DEMO_SID = 'PS-04'

// --------------------------------------------------------------------------- //
// İstasyon listesi, konfigürasyon, nokta listesi
// --------------------------------------------------------------------------- //

/* eslint-disable @typescript-eslint/no-explicit-any */
let stP: Promise<any> | null = null

export function demoStations(): Promise<any> {
  stP ??= (async () => {
    let doc = await fetch('/api/stations').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!doc?.stations) doc = await fetch(asset('stations.json')).then((r) => r.json())
    const has = doc.stations.some((s: { id: string }) => s.id === DEMO_SID)
    return { ...doc, default: has ? DEMO_SID : doc.default }
  })()
  stP.catch(() => { stP = null })
  return stP
}

const cfgP = new Map<string, Promise<StationCfg>>()

export function demoStationConfig(sid: string): Promise<StationCfg> {
  let p = cfgP.get(sid)
  if (!p) {
    p = (async () => {
      const r = await fetch(`/api/station/${encodeURIComponent(sid)}`).catch(() => null)
      const j = r?.ok ? await r.json().catch(() => null) : null
      if (j?.equipment) return j as StationCfg
      const e = (await demoStations()).stations.find((s: { id: string }) => s.id === sid)
      if (!e?.config) throw new Error(`beket konfigurasiýasy ýok: ${sid}`)
      return fetch(asset(e.config)).then((x) => x.json())
    })()
    cfgP.set(sid, p)
    p.catch(() => cfgP.delete(sid))
  }
  return p
}

let ptsP: Promise<DbPoint[]> | null = null
const demoPoints = () => (ptsP ??= fetch(asset('demo/noktalar.json'), { cache: 'no-cache' })
  .then((r) => r.json()).then((j) => (j.points ?? []) as DbPoint[]))

/** TsOkuma servisinin karşılığı: op=points, op=hist */
export async function demoTs(req: string): Promise<any> {
  const q = new URLSearchParams(req)
  const op = q.get('op')
  if (op === 'points') return { station: 'DEMO', points: await demoPoints() }
  if (op === 'hist') {
    const names = (q.get('names') ?? '').split(',').filter(Boolean)
    const r = await demoHistory(names.map((x) => `db:${x}`), Number(q.get('from')) / 1000, Number(q.get('to')) / 1000, Number(q.get('n')) || 300)
    return { data: Object.fromEntries(names.map((x) => [x, r.data[`db:${x}`] ?? []])) }
  }
  return null
}

// --------------------------------------------------------------------------- //
// Belirlenimci rastgelelik
// --------------------------------------------------------------------------- //

const T0 = Date.UTC(2025, 0, 1) / 1000            // sayaçlar bu andan itibaren işler
const DAY = 86400

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
/** 0…1, (tohum, tamsayı) için hep aynı */
function rnd(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i | 0, 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
/** düzgün gürültü −1…1, `period` sn'lik dalgalanma */
function noise(seed: number, t: number, period: number): number {
  const x = t / period, i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f)
  return (rnd(seed, i) * (1 - u) + rnd(seed, i + 1) * u) * 2 - 1
}

// --------------------------------------------------------------------------- //
// Nasos: inwertor (1) / transformator (2) / durýar (0) dönemleri
// --------------------------------------------------------------------------- //

type Rejim = 0 | 1 | 2
const WIND_OFF = [0, 1.6, -1.2, 2.4, -0.6, 1.1]           // U1…W2 sargılarının farkı

class PumpSim {
  readonly seed: number
  readonly L: number                 // dönem uzunluğu, sn (45–105 dk)
  readonly off: number
  private s0: number
  private cum: [number[], number[]] = [[0], [0]]
  readonly baseInv: number; readonly basePano: number
  readonly ratedA: number; readonly motorKw: number; readonly q: number
  private po: number

  constructor(key: string, e: EqCfg) {
    this.seed = hash(key)
    this.L = Math.round(45 + rnd(this.seed, -1) * 60) * 60
    this.off = Math.floor(rnd(this.seed, -2) * this.L)
    this.s0 = this.slot(T0)
    this.baseInv = 2500 + Math.round(rnd(this.seed, -3) * 9000)
    this.basePano = 800 + Math.round(rnd(this.seed, -4) * 4000)
    this.ratedA = Number(e.params?.rated_current_a ?? 280)
    this.motorKw = Number(e.params?.motor_kw ?? 160)
    this.q = Number(e.params?.rated_flow_m3h ?? 900)
    this.po = rnd(this.seed, -5) * 3 - 1.5
  }

  slot(t: number): number { return Math.floor((t + this.off) / this.L) }
  start(j: number): number { return j * this.L - this.off }
  rejim(j: number): Rejim { const r = rnd(this.seed, j); return r < 0.42 ? 1 : r < 0.66 ? 2 : 0 }
  at(t: number): Rejim { return this.rejim(this.slot(t)) }

  /** T0'dan t'ye kadar `m` rejiminde geçen sn (sayaçlar bundan) */
  run(m: 1 | 2, t: number): number {
    if (t <= this.start(this.s0)) return 0
    const j = this.slot(t), idx = j - this.s0
    const a = this.cum[m - 1]
    while (this.cum[0].length <= idx) {
      const k = this.cum[0].length - 1, r = this.rejim(this.s0 + k)
      this.cum[0].push(this.cum[0][k] + (r === 1 ? this.L : 0))
      this.cum[1].push(this.cum[1][k] + (r === 2 ? this.L : 0))
    }
    return a[idx] + (this.rejim(j) === m ? t - this.start(j) : 0)
  }

  freq(t: number): number {
    const m = this.at(t)
    return m === 1 ? 45 + 5 * (0.5 + 0.5 * noise(this.seed + 11, t, 1500)) : m === 2 ? 50 : 0
  }

  /** sıcaklığın kararlı değeri (rejim, ölçeg) */
  private ss(m: Rejim, key: string): number {
    const on = m !== 0
    if (key === 'PUMP.bearing1') return on ? 50 : 43.5
    if (key === 'PUMP.bearing2') return on ? 47 : 42
    const w = WIND_OFF[Number(key.slice(-1)) - 1] ?? 0
    return on ? 73 + w + this.po : 57.5 + w * 0.2
  }
  private tau(m: Rejim): number { return m ? 1500 : 2400 }
  private startT(j: number, key: string, d: number): number {
    if (d <= 0) return this.ss(this.rejim(j - 1), key)
    const pj = j - 1, m = this.rejim(pj), s = this.ss(m, key)
    return s + (this.startT(pj, key, d - 1) - s) * Math.exp(-this.L / this.tau(m))
  }
  temp(t: number, key: string): number {
    const j = this.slot(t), m = this.rejim(j), s = this.ss(m, key)
    const k = TEMP_SEED[key] ?? 0
    const v = s + (this.startT(j, key, 2) - s) * Math.exp(-(t - this.start(j)) / this.tau(m))
    return v + (m ? 3 : 1) * noise(this.seed + 20 + k, t, 5400) + 0.4 * noise(this.seed + 40 + k, t, 90)
  }

  value(key: string, t: number): number | null {
    const m = this.at(t), on = m !== 0
    const f = this.freq(t), r = f / 50
    switch (key) {
      case 'run_inv': return m === 1 ? 1 : 0
      case 'run_pano': return m === 2 ? 1 : 0
      case 'hours_inv': return this.baseInv + this.run(1, t) / 3600
      case 'hours_pano': return this.basePano + this.run(2, t) / 3600
      case 'vfd_freq_hz': return m === 1 ? f : 0
      case 'current_a': return on ? this.ratedA * (0.62 + 0.28 * r ** 3) + 3 * noise(this.seed + 12, t, 300) : 0
      case 'power_kw': return on ? this.motorKw * (0.62 + 0.3 * r ** 3) + 2 * noise(this.seed + 13, t, 300) : 0
      case 'discharge_press_bar':
        return on ? 6.5 + (0.5 + 0.5 * noise(this.seed + 14, t, 2400)) * (0.85 + 0.15 * r) : 0.15 + 0.05 * noise(this.seed + 15, t, 600)
    }
    if (key in TEMP_SEED) return this.temp(t, key)
    return null
  }
}
const TEMP_SEED: Record<string, number> = {
  'MOTOR.t1': 1, 'MOTOR.t2': 2, 'MOTOR.t3': 3, 'MOTOR.t4': 4, 'MOTOR.t5': 5, 'MOTOR.t6': 6, 'PUMP.bearing1': 7, 'PUMP.bearing2': 8,
}

// --------------------------------------------------------------------------- //
// İstasyon: nasoslar, toplumların esasy turbaları, derejeler
// --------------------------------------------------------------------------- //

interface Toplum { headers: EqCfg[]; pumps: PumpSim[]; w: Map<string, number> }
interface StationSim { sid: string; cfg: StationCfg; pumps: Map<string, PumpSim>; toplumlar: Toplum[]; hdr: Map<string, Toplum> }

const simP = new Map<string, Promise<StationSim>>()

function simFor(sid: string): Promise<StationSim> {
  let p = simP.get(sid)
  if (!p) {
    p = demoStationConfig(sid).then((cfg) => {
      const pumps = new Map<string, PumpSim>()
      for (const e of cfg.equipment) if (e.type === 'pump_hsc') pumps.set(e.id, new PumpSim(`${sid}.${e.id}`, e))
      const hdr = new Map<string, Toplum>()
      const toplumlar = toplumlarOf(cfg.equipment).map((t) => {
        // akım borular arasında eşit bölünmez: her boruya kendi payı
        const raw = t.headers.map((h) => 1 + rnd(hash(h.id), 1))
        const sum = raw.reduce((a, b) => a + b, 0)
        const x: Toplum = { headers: t.headers, pumps: t.pumps.map((e) => pumps.get(e.id)!), w: new Map(t.headers.map((h, i) => [h.id, raw[i] / sum])) }
        for (const h of t.headers) hdr.set(h.id, x)
        return x
      })
      return { sid, cfg, pumps, toplumlar, hdr }
    })
    simP.set(sid, p)
    p.catch(() => simP.delete(sid))
  }
  return p
}

function headerValue(sim: StationSim, id: string, key: string, t: number): number | null {
  const tp = sim.hdr.get(id)
  if (!tp) return null
  const w = tp.w.get(id) ?? 1, sd = hash(`${sim.sid}.${id}`)
  if (key === 'flow_m3h') {
    let q = 0
    for (const p of tp.pumps) if (p.at(t)) q += p.q * (0.85 + 0.15 * p.freq(t) / 50)
    return q * w * (1 + 0.03 * noise(sd, t, 600))
  }
  if (key === 'total_m3') {
    let v = 0
    for (const p of tp.pumps) v += p.q * 0.95 * (p.run(1, t) + p.run(2, t)) / 3600
    return 200_000 + Math.round(rnd(sd, 2) * 800_000) + v * w
  }
  if (key === 'press_bar') {
    return tp.pumps.some((p) => p.at(t)) ? 6.3 + 0.35 * (1 + noise(sd + 1, t, 1800)) : 0.4 + 0.1 * noise(sd + 2, t, 900)
  }
  return null
}

const levelValue = (key: string, t: number) => {
  const sd = hash(key)
  return 2.8 + 0.5 * Math.sin(2 * Math.PI * (t - T0) / DAY + rnd(sd, 1) * 6) + 0.12 * noise(sd, t, 1800)
}

/** Twin etiketi (PS-04.PMP-03.current_a) → zamanın fonksiyonu */
async function tagFn(tag: string): Promise<((t: number) => number) | null> {
  const [sid, eq, ...rest] = tag.split('.')
  const key = rest.join('.')
  if (!sid || !eq || !key) return null
  const sim = await simFor(sid).catch(() => null)
  const pump = sim?.pumps.get(eq)
  if (pump) return pump.value(key, T0 + 1) === null ? null : (t) => pump.value(key, t) ?? 0
  if (sim?.hdr.has(eq)) return headerValue(sim, eq, key, T0 + 1) === null ? null : (t) => headerValue(sim, eq, key, t) ?? 0
  if (key === 'level_m') return (t) => levelValue(tag, t)
  const sd = hash(tag)
  return (t) => 20 + 5 * noise(sd, t, 900)
}

// --------------------------------------------------------------------------- //
// Veritabanı noktaları ("db:<ad>")
// --------------------------------------------------------------------------- //

async function dbFn(name: string, units: Map<string, string | null>): Promise<(t: number) => number> {
  const plain = unescapeName(name)
  const sd = hash(name)
  // nasos temperaturası: adın gösterdiği nasosun (toplum sırasıyla) sıcaklığı
  const tp = parseTempName(name)
  if (tp) {
    const sim = await simFor(DEMO_SID).catch(() => null)
    const pump = sim?.toplumlar[tp.toplum - 1]?.pumps[tp.k - 1]
    if (pump) return (t) => pump.temp(t, tp.key)
  }
  if (units.get(name) === '°C') return (t) => 60 + 10 * noise(sd, t, 3600)
  const dev = plain.replace(/_(Akym|Toplam|Jemi|Suw_Tizligi|rssi|snr|Status)$/i, '')
  const flowName = [...units.keys()].find((n) => unescapeName(n) === `${dev}_Akym`)
  const flowUnit = (flowName && units.get(flowName)) || (/_S\d|^BA|^Saka/i.test(dev) ? 'L/s' : 'm³/hr')
  const ds = hash(dev)
  const A = flowUnit === 'L/s' ? 15 + rnd(ds, 1) * 90 : 300 + rnd(ds, 1) * 1800
  const om = 2 * Math.PI / DAY, ph = rnd(ds, 2) * 6
  if (/_Akym$/i.test(plain)) return (t) => Math.max(0, A * (1 + 0.25 * Math.sin(om * (t - T0) + ph)) + 0.05 * A * noise(ds + 1, t, 900))
  if (/_(Toplam|Jemi)$/i.test(plain)) {
    const a = flowUnit === 'L/s' ? A / 1000 : A / 3600                                    // m³/sn
    const base = 100_000 + Math.round(rnd(ds, 3) * 900_000)
    return (t) => base + a * ((t - T0) - (0.25 / om) * (Math.cos(om * (t - T0) + ph) - Math.cos(ph)))
  }
  if (/derejesi|dereje|level/i.test(plain)) return (t) => 2.2 + 0.6 * Math.sin(om * (t - T0) + ph) + 0.08 * noise(sd, t, 1200)
  if (/_Suw_Tizligi$/i.test(plain)) return (t) => 0.9 + 0.3 * noise(sd, t, 1800)
  if (/_rssi$/i.test(plain)) return (t) => -82 + 6 * noise(sd, t, 600)
  if (/_snr$/i.test(plain)) return (t) => 8 + 3 * noise(sd, t, 600)
  if (/_Status$/i.test(plain)) return () => 1
  return (t) => 10 + 3 * noise(sd, t, 900)
}

// --------------------------------------------------------------------------- //
// Kovalar
// --------------------------------------------------------------------------- //

/** [from, to] aralığını n kovaya böler; her kovada birkaç örnek → ortalama / min / maks. Gelecek boş. */
function gen(f: (t: number) => number, from: number, to: number, n: number): Bucket[] {
  const w = (to - from) / n, now = Date.now() / 1000, out: Bucket[] = []
  const k = Math.max(3, Math.min(9, Math.round(w / 45) + 2))
  for (let b = 0; b < n; b++) {
    const b0 = from + b * w
    if (b0 > now) break
    const b1 = Math.min(b0 + w, now)
    let s = 0, mn = Infinity, mx = -Infinity
    for (let i = 0; i < k; i++) {
      const v = f(b0 + (b1 - b0) * i / (k - 1))
      s += v; if (v < mn) mn = v; if (v > mx) mx = v
    }
    out.push([b0 + w / 2, s / k, mn, mx])
  }
  return out
}

const TEMP_TAG = /^(.+)\.(PMP-\d+)\.(MOTOR\.t[1-6]|PUMP\.bearing[12])$/

/** queryHistory'nin demo karşılığı */
export async function demoHistory(tags: string[], from: number, to: number, n: number): Promise<HistResult> {
  const pts = await demoPoints().catch(() => [] as DbPoint[])
  const units = new Map(pts.map((p) => [p[0], p[3]] as [string, string | null]))
  const data: Record<string, Bucket[]> = {}
  for (const tag of tags) {
    let f: ((t: number) => number) | null = null
    if (tag.startsWith('db:')) f = await dbFn(tag.slice(3), units)
    else {
      // nasos temperaturası: istasyondaki gibi veritabanı noktasından (Sazlamalar'daki seçim burada da geçerli)
      const m = TEMP_TAG.exec(tag)
      const row = m ? (await loadTempPlan(m[1]).catch(() => null))?.eff[m[2]] : undefined
      if (m && row && m[3] in row) { const nm = row[m[3]]; f = nm ? await dbFn(nm, units) : null }
      else f = await tagFn(tag)
    }
    if (f) data[tag] = gen(f, from, to, n)
  }
  return { data, sources: new Set<Source>(['demo']) }
}

// --------------------------------------------------------------------------- //
// Canlı değerler (depoya)
// --------------------------------------------------------------------------- //

const PUMP_KEYS = ['run_inv', 'run_pano', 'hours_inv', 'hours_pano', 'discharge_press_bar', 'vfd_freq_hz', 'current_a', 'power_kw',
  'MOTOR.t1', 'MOTOR.t2', 'MOTOR.t3', 'MOTOR.t4', 'MOTOR.t5', 'MOTOR.t6', 'PUMP.bearing1', 'PUMP.bearing2']

/** "Şu an"ın değerlerini 5 sn'de bir depoya yazar; durdurma fonksiyonu döner. */
export function startDemoLive(sid: string): () => void {
  let stop = false
  const tick = async () => {
    const sim = await simFor(sid).catch(() => null)
    if (stop || !sim) return
    const t = Date.now() / 1000, ts = Date.now()
    const values: Record<string, Sample> = {}
    const status: Record<string, { state: string; mode: string; ts: number }> = {}
    for (const [id, p] of sim.pumps) {
      for (const k of PUMP_KEYS) {
        const v = p.value(k, t)
        if (v !== null) values[`${sid}.${id}.${k}`] = { v: k.startsWith('run_') ? v > 0.5 : Math.round(v * 100) / 100, ts }
      }
      status[`${sid}.${id}`] = { state: p.at(t) ? 'RUNNING' : 'STOPPED', mode: 'AUTO', ts }
    }
    for (const id of sim.hdr.keys()) {
      for (const k of ['flow_m3h', 'press_bar', 'total_m3']) {
        const v = headerValue(sim, id, k, t)
        if (v !== null) values[`${sid}.${id}.${k}`] = { v: Math.round(v * 100) / 100, ts }
      }
    }
    for (const e of sim.cfg.equipment) {
      if (e.type === 'level_sensor' || e.type === 'basin') values[`${sid}.${e.id}.level_m`] = { v: Math.round(levelValue(`${sid}.${e.id}.level_m`, t) * 100) / 100, ts }
    }
    useTwin.setState({
      connected: true, sourceAlive: true, dataStale: false, dataTs: ts, stationId: sid, lastMessageAt: ts,
      values, status, live: { values, status }, stale: new Set(),
    })
  }
  tick()
  const timer = window.setInterval(tick, 5000)
  return () => { stop = true; clearInterval(timer) }
}

// --------------------------------------------------------------------------- //
// Sözlük: geliştirme sunucusu common/sozluk.json'u sunmuyor — demoda bu kopya (aynı içerik)
// --------------------------------------------------------------------------- //

export const DEMO_SOZLUK: Sozluk = {
  kisaltmalar: { BA: 'Beton akaba', MT: 'MT', Saka: 'Saka', G: 'Gatla', B: 'Böwetleýji gatla', BG: 'Esasy böwetleýji gatla', S: 'Sazlaýjy', N: 'Nasos', Toplum: 'Toplum', P: 'Nasos' },
  sayi: 'Liniýa',
  sozler: {
    Toplam: 'jemi', Jemi: 'jemi', Akym: 'akym', CMD: 'buýruk', Status: 'ýagdaýy', Suw_Tizligi: 'suwuň tizligi', Tizlik: 'tizlik',
    new: 'täze', Inverter: 'inwertor', Line: 'liniýa', rssi: 'signal güýji (RSSI)', snr: 'signal/şowhun (SNR)', gpio_input: 'giriş',
    Temps: 'temperatura', Arka: 'arka', Toplum_1: 'Toplum 1', Toplum_2: 'Toplum 2', Toplum_3: 'Toplum 3', Toplum_4: 'Toplum 4',
  },
  olcegler: {
    Akym: 'akym', Toplam: 'sanag', Jemi: 'sanag', Suw_Tizligi: 'ortaca',
    U1: 'ortaca', U2: 'ortaca', V1: 'ortaca', V2: 'ortaca', W1: 'ortaca', W2: 'ortaca', Arka: 'ortaca',
  },
  duzeltmeler: {},
}
