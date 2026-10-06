/**
 * Grafiklerin geçmiş verisi — üç kaynak, tek arayüz:
 *
 *   api      geliştirme/Pi: Python API'nin /api/history uç noktası
 *   niagara  JACE: noktanın history uzantısı varsa Niagara geçmişi (BajaScript)
 *   session  ikisi de yoksa: sayfa açıldığından beri tarayıcının biriktirdiği değerler
 *
 * Hepsi aynı biçime indirgenir: zaman ekseninde eşit genişlikte kovalar,
 * [epoch_sn, ortalama, min, maks]. Değer gelmeyen kovada son değer sürdürülür
 * (COV verisi: değişmeyen değer yeniden gönderilmez).
 */
import type { Sample } from './store'
import { NIAGARA, niagaraHistory, hasNiagaraHistory } from './niagara'

export type Bucket = [number, number, number, number]
export type Source = 'api' | 'niagara' | 'session'
export interface HistResult { data: Record<string, Bucket[]>; sources: Set<Source> }

// --------------------------------------------------------------------------- //
// Oturum tamponu
// --------------------------------------------------------------------------- //

const KEEP_S = 7 * 24 * 3600
const MIN_GAP_S = 5
const MAX_POINTS = 40_000                     // etiket başına üst sınır (bellek sabit kalsın)

interface Ring { t: number[]; v: number[] }
const ring = new Map<string, Ring>()

/** Canlı değerleri tampona yazar (depo her snapshot/delta'da çağırır). */
export function recordValues(values: Record<string, Sample | { v: unknown; ts?: number }>): void {
  const now = Date.now() / 1000
  for (const [tag, s] of Object.entries(values)) {
    const raw = s?.v
    const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : null
    if (v === null || !Number.isFinite(v)) continue
    const t = typeof s.ts === 'number' && s.ts > 1e12 ? Math.min(s.ts / 1000, now) : now
    let r = ring.get(tag)
    if (!r) { r = { t: [], v: [] }; ring.set(tag, r) }
    const n = r.t.length
    if (n) {
      const lastT = r.t[n - 1], lastV = r.v[n - 1]
      if (t < lastT) continue
      // 5 sn içindeki değişimler tek noktada birleşir (son değer kalır)
      if (t - lastT < MIN_GAP_S) { if (lastV !== v) r.v[n - 1] = v; continue }
    }
    r.t.push(t); r.v.push(v)
    if (r.t.length > MAX_POINTS || r.t[0] < now - KEEP_S) {
      let k = 0
      while (k < r.t.length && (r.t[k] < now - KEEP_S || r.t.length - k > MAX_POINTS)) k++
      r.t.splice(0, k); r.v.splice(0, k)
    }
  }
}

/** Oturum tamponunun en eski kaydı (grafik notu: "… bäri") */
export function sessionSince(): number | null {
  let lo: number | null = null
  for (const r of ring.values()) if (r.t.length && (lo === null || r.t[0] < lo)) lo = r.t[0]
  return lo
}

// --------------------------------------------------------------------------- //
// Kovalara indirgeme
// --------------------------------------------------------------------------- //

/** Sıralı [t, v] noktalarını n kovaya indirger; boş kovada son değer sürer. */
export function resample(t: ArrayLike<number>, v: ArrayLike<number>, from: number, to: number, n: number): Bucket[] {
  const w = (to - from) / n
  const out: Bucket[] = []
  let i = 0
  let last: number | null = null
  while (i < t.length && t[i] < from) { last = v[i]; i++ }
  const now = Date.now() / 1000
  for (let b = 0; b < n; b++) {
    const b0 = from + b * w, b1 = b0 + w
    if (b0 > now) break                                   // gelecek boş kalır
    let sum = 0, cnt = 0, mn = Infinity, mx = -Infinity
    while (i < t.length && t[i] < b1) {
      const x = v[i]; sum += x; cnt++; if (x < mn) mn = x; if (x > mx) mx = x; last = x; i++
    }
    if (cnt) out.push([b0 + w / 2, sum / cnt, mn, mx])
    else if (last !== null) out.push([b0 + w / 2, last, last, last])
  }
  return out
}

/** Sunucunun kovaları başka bir ızgaradaysa bizim ızgaraya taşır. */
function rebucket(src: Bucket[], from: number, to: number, n: number): Bucket[] {
  const t = src.map((b) => b[0]), v = src.map((b) => b[1])
  const out = resample(t, v, from, to, n)
  // min/maks bilgisi korunsun: kaynak kovanın min/maks'ını hedef kovaya taşı
  const w = (to - from) / n
  const ext = new Map<number, [number, number]>()
  for (const b of src) {
    const k = Math.floor((b[0] - from) / w)
    const e = ext.get(k)
    ext.set(k, e ? [Math.min(e[0], b[2]), Math.max(e[1], b[3])] : [b[2], b[3]])
  }
  return out.map((b) => {
    const e = ext.get(Math.floor((b[0] - from) / w))
    return e ? [b[0], b[1], Math.min(b[2], e[0]), Math.max(b[3], e[1])] : b
  })
}

// --------------------------------------------------------------------------- //
// Sorgu
// --------------------------------------------------------------------------- //

let apiOk: boolean | null = null

export async function queryHistory(tags: string[], from: number, to: number, n = 300): Promise<HistResult> {
  const data: Record<string, Bucket[]> = {}
  const sources = new Set<Source>()
  let rest = [...new Set(tags)]

  if (!NIAGARA && apiOk !== false) {
    try {
      const q = rest.map((t) => `tag=${encodeURIComponent(t)}`).join('&')
      const r = await fetch(`/api/history?${q}&start=${from}&end=${to}&buckets=${n}`)
      if (!r.ok) throw new Error(String(r.status))
      const j: Record<string, Bucket[]> = await r.json()
      apiOk = true
      for (const t of rest) if (j[t]?.length) { data[t] = rebucket(j[t], from, to, n); sources.add('api') }
      rest = rest.filter((t) => !data[t])
    } catch { apiOk = false }
  }

  if (NIAGARA) {
    const withHist = rest.filter(hasNiagaraHistory)
    const got = await Promise.all(withHist.map((t) => niagaraHistory(t, from, to).catch(() => null)))
    withHist.forEach((tag, i) => {
      const pts = got[i]
      if (!pts?.length) return
      data[tag] = resample(pts.map((p) => p[0]), pts.map((p) => p[1]), from, to, n)
      sources.add('niagara')
    })
    rest = rest.filter((t) => !data[t])
  }

  for (const tag of rest) {
    const r = ring.get(tag)
    if (!r?.t.length) continue
    data[tag] = resample(r.t, r.v, from, to, n)
    sources.add('session')
  }
  return { data, sources }
}

// --------------------------------------------------------------------------- //
// Türetilmiş seriler
// --------------------------------------------------------------------------- //

/** Aynı ızgaradaki serileri toplar (toplum kuwwaty = pompaların kW toplamı). */
export function sumSeries(list: (Bucket[] | undefined)[]): Bucket[] {
  const byT = new Map<number, Bucket>()
  for (const s of list) {
    for (const b of s ?? []) {
      const k = Math.round(b[0])
      const a = byT.get(k)
      byT.set(k, a ? [b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]] : [...b] as Bucket)
    }
  }
  return [...byT.values()].sort((a, b) => a[0] - b[0])
}

/** Her kovaya fonksiyon uygular (durum/uyarı seviyesi gibi). */
export function mapSeries(s: Bucket[] | undefined, f: (b: Bucket) => number): Bucket[] {
  return (s ?? []).map((b) => { const x = f(b); return [b[0], x, x, x] })
}
