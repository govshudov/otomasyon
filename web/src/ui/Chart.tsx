import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Bucket } from '../data/history'

/**
 * Zaman serisi grafiği — canvas, harici kütüphane yok.
 *
 * Referans ekrandaki gibi: çizgi + altı dolgulu alan, MAX / AVG / MIN kesik
 * çizgileri, imleçte dikey çizgi ve değer kutusu. Çok serili grafikte
 * gösterge (legend) serileri açıp kapatır. Durum grafikleri (`enumLabels`)
 * basamaklı çizilir, y ekseninde sayı yerine metin yazar. `bars`: üst üste
 * sütunlar (her zaman kovası bir sütun, tepesinde toplamı).
 *
 * Çizim `drawChart`'ta, tuvalden bağımsız (Paint): ekranda canvas, PDF çıktısında
 * aynı kod SVG üretir (chartSvg.ts) — çıktıdaki grafik ekrandakinin aynısı.
 *
 * Yakınlaşma: grafiğin üstünde fareyle yatay sürüklenince seçilen aralık
 * `onZoom` ile bildirilir (ChartBoard ortak aralığı değiştirir); çift tıklama `onZoomOut`.
 */

export interface Series { label: string; color: string; data: Bucket[]; dashed?: boolean }
export interface Threshold { value: number; level: 'WARN' | 'ALARM'; label?: string }

export interface ChartProps {
  series: Series[]
  from: number; to: number                         // epoch sn
  unit?: string; digits?: number
  thresholds?: Threshold[]
  enumLabels?: string[]
  stats?: boolean
  fill?: boolean
  yMin?: number; yMax?: number
  compact?: boolean
  /** Üst üste sütunlar: sütun genişliği (sn). Serilerin kovaları aynı zamanlarda olmalı; ilk seri en altta. */
  bars?: number
  /** y ekseninin dik başlığı (°C, min, sag) */
  yTitle?: string
  /** sürüklenerek seçilen aralık (epoch sn) */
  onZoom?: (from: number, to: number) => void
  /** çift tıklama: önceki aralık */
  onZoomOut?: () => void
}

export interface Palette {
  grid: string; axis: string; text: string; base: string
  max: string; avg: string; min: string; warn: string; alarm: string
  cursor: string; total: string; barHover: string; font: string; barAlpha: number
}

/** Ekran (koyu zemin) */
export const SCREEN: Palette = {
  grid: '#4e687c', axis: '#8d949e', text: '#c9ced6', base: '#5f8098',
  max: '#ef4444', avg: '#9aa0a8', min: '#eab308', warn: '#f59e0b', alarm: '#ef4444',
  cursor: 'rgba(220,225,232,.55)', total: '#e8eaed', barHover: 'rgba(255,255,255,.08)',
  font: 'system-ui, "Segoe UI", sans-serif', barAlpha: 0.88,
}
/** Kâğıt (PDF): açık zemin, gecirijiler.js'in çıktısıyla aynı renkler */
export const PRINT: Palette = {
  grid: '#DCE6EE', axis: '#5B7085', text: '#33506B', base: '#9AAABB',
  max: '#C0392B', avg: '#6B7F94', min: '#B7791F', warn: '#D97706', alarm: '#C0392B',
  cursor: '#33506B', total: '#12212F', barHover: 'transparent',
  font: 'Inter, Arial, sans-serif', barAlpha: 1,
}

/** Canvas'ın kullanılan alt kümesi — CanvasRenderingContext2D ve SVG üreticisi (chartSvg.ts) */
export interface Paint {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  globalAlpha: number
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(s: string, x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  setLineDash(d: number[]): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(a: number): void
  measureText(s: string): { width: number }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient
}

export function niceStep(span: number, n: number): number {
  const raw = span / Math.max(n, 1)
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p
}

const TSTEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800]
const pad2 = (n: number) => String(n).padStart(2, '0')
export function fmtTime(s: number, withDate = false): string {
  const d = new Date(s * 1000)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return withDate ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${hm}` : hm
}
export function fmtDateTime(s: number): string {
  const d = new Date(s * 1000)
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const fmtDay = (s: number) => { const d = new Date(s * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}` }

export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export const fmtNum = (v: number, digits: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Sütun ızgarası yerel saate hizalı (günlük sütun gece yarısından başlar) */
const tzOff = () => new Date().getTimezoneOffset() * 60

// --------------------------------------------------------------------------- //
// Ölçek
// --------------------------------------------------------------------------- //

export interface Geo {
  W: number; H: number
  PAD: { l: number; r: number; t: number; b: number }
  lo: number; hi: number; st: number
  /** x ekseninin uçları (sütunlu grafikte sütun ızgarasına genişler) */
  t0: number; t1: number
  px: (t: number) => number
  py: (v: number) => number
  tx: (x: number) => number
  has: boolean
  stats: { min: number; max: number; avg: number } | null
}

export function chartGeometry(p: ChartProps, visible: Series[], W: number, H: number): Geo {
  const isEnum = !!p.enumLabels?.length
  const digits = p.digits ?? 1
  const PAD = { l: 46, r: p.stats ? 40 : 12, t: p.bars ? 16 : 10, b: 22 }
  let lo = Infinity, hi = -Infinity
  for (const s of visible) for (const b of s.data) { if (b[2] < lo) lo = b[2]; if (b[3] > hi) hi = b[3] }
  const has = Number.isFinite(lo)
  let stats: Geo['stats'] = null
  if (p.stats && visible.length === 1 && visible[0].data.length) {
    const d = visible[0].data
    stats = { min: Math.min(...d.map((b) => b[2])), max: Math.max(...d.map((b) => b[3])),
              avg: d.reduce((a, b) => a + b[1], 0) / d.length }
  }
  if (isEnum) { lo = -0.25; hi = p.enumLabels!.length - 0.75 }
  else if (p.bars) {
    // üst üste sütun: 0'dan aynı zamandaki toplamın en büyüğüne; tepede toplamın yazısına yer
    const sum = new Map<number, number>()
    for (const s of visible) for (const b of s.data) sum.set(Math.round(b[0]), (sum.get(Math.round(b[0])) ?? 0) + b[1])
    lo = 0; hi = Math.max(0, ...sum.values())
    if (hi <= 0) hi = digits === 0 ? 5 : 1
    hi *= 1.18
  } else {
    if (!has) { lo = 0; hi = 1 }
    // Eşik veriye yakınsa görünür olsun; çok uzaktaysa veriyi ezmesin
    const span0 = Math.max(hi - lo, Math.abs(hi) * 0.05, 1e-3)
    for (const t of p.thresholds ?? []) if (t.value <= hi + span0 * 0.6 && t.value >= lo - span0 * 0.6) {
      lo = Math.min(lo, t.value); hi = Math.max(hi, t.value)
    }
    if (p.yMin !== undefined) lo = Math.min(lo, p.yMin)
    if (p.yMax !== undefined) hi = Math.max(hi, p.yMax)
    if (hi - lo < 1e-6) { hi += 1; lo -= 1 }
    const pad = (hi - lo) * 0.08
    hi += pad
    lo = p.yMin !== undefined && lo - pad < p.yMin ? p.yMin : lo - pad
  }
  // Tam sayılı grafik (temperatura, dakika) ekseninde kesir yazılmaz
  let st = niceStep(hi - lo, Math.max(2, Math.floor((H - PAD.t - PAD.b) / 26)))
  if (digits === 0 && !isEnum) st = Math.max(1, st)
  // Sol boşluk en uzun eksen etiketine göre (1,200,000 m³ kesilmesin)
  const longest = isEnum ? Math.max(...p.enumLabels!.map((s) => s.length))
    : Math.max(...[lo, hi].map((v) => Math.round(v).toLocaleString('en-US').length + (st < 1 ? 3 : 0)))
  PAD.l = Math.max(34, Math.round(longest * 6.3) + 14) + (p.yTitle ? 14 : 0)

  let t0 = p.from, t1 = p.to
  if (p.bars) {
    const tz = tzOff()
    t0 = Math.floor((p.from - tz) / p.bars) * p.bars + tz
    t1 = Math.max(t0 + p.bars, Math.ceil((p.to - tz) / p.bars) * p.bars + tz)
  }
  const pw = Math.max(W - PAD.l - PAD.r, 1)
  const px = (t: number) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * pw
  const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const tx = (x: number) => t0 + ((x - PAD.l) / pw) * (t1 - t0)
  return { W, H, PAD, lo, hi, st, t0, t1, px, py, tx, has, stats }
}

// --------------------------------------------------------------------------- //
// Çizim
// --------------------------------------------------------------------------- //

export interface HoverMark { t: number; rows: { s: Series; b: Bucket | null }[]; slot?: number }

export function drawChart(g: Paint, geo: Geo, p: ChartProps, visible: Series[], C: Palette, hover: HoverMark | null): void {
  const { W, H, PAD, lo, hi, st, px, py, has, stats, t0, t1 } = geo
  const isEnum = !!p.enumLabels?.length
  const digits = p.digits ?? 1
  const font = (px_: number, bold = false) => `${bold ? 'bold ' : ''}${px_}px ${C.font}`
  g.font = font(10.5)
  g.lineWidth = 1
  g.setLineDash([])

  // y ızgarası
  g.fillStyle = C.axis; g.strokeStyle = C.grid
  if (isEnum) {
    p.enumLabels!.forEach((lab, i) => {
      const y = Math.round(py(i)) + 0.5
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
      g.textAlign = 'right'; g.fillText(lab, PAD.l - 6, y + 3.5)
    })
  } else {
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
      const y = Math.round(py(v)) + 0.5
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
      g.textAlign = 'right'
      g.fillText((Math.abs(v) < st / 1e6 ? 0 : v).toLocaleString('en-US', { maximumFractionDigits: st < 1 ? 2 : 0 }), PAD.l - 6, y + 3.5)
    }
  }
  // y ekseninin başlığı (dik)
  if (p.yTitle) {
    g.save(); g.fillStyle = C.text; g.font = font(10.5, true); g.textAlign = 'center'
    g.translate(11, (PAD.t + H - PAD.b) / 2); g.rotate(-Math.PI / 2)
    g.fillText(p.yTitle, 0, 0)
    g.restore()
    g.font = font(10.5)
  }

  // x ekseni
  g.textAlign = 'center'; g.fillStyle = C.axis; g.strokeStyle = C.grid
  if (p.bars) {
    // Sütunlu: her sütunun altında başlangıç saati (sığmazsa atlayarak); günlükte tarih
    const bw = p.bars, slotPx = px(t0 + bw) - px(t0), day = bw >= 86400
    const lab = (s: number) => {
      if (day) return fmtDay(s)
      const d = new Date(s * 1000)
      return d.getHours() === 0 && d.getMinutes() === 0 && t1 - t0 > 20 * 3600 ? fmtDay(s) : fmtTime(s)
    }
    // Etiket aralığı yuvarlak bir süre (30 dk, 1 sa, 2 sa…) ve yerel saate hizalı: sütun dar olunca atlanır
    const need = (g.measureText('00:00').width + 10) / Math.max(slotPx, 1) * bw
    const every = [...TSTEPS, 604800].find((x) => x >= bw && x % bw === 0 && x >= need) ?? bw * Math.ceil(need / bw)
    const tz = tzOff()
    for (let s = t0; s < t1 - 1; s += bw) {
      if (Math.round(s - tz) % every) continue
      const x = Math.round(px(s + bw / 2)) + 0.5
      g.beginPath(); g.moveTo(x, H - PAD.b); g.lineTo(x, H - PAD.b + 4); g.stroke()
      g.fillText(lab(s), x, H - 6)
    }
  } else {
    const span = t1 - t0
    const tstep = TSTEPS.find((s) => (W - PAD.l - PAD.r) / (span / s) > 74) ?? 172800
    const withDate = span > 36 * 3600
    const tz = tzOff()
    for (let t = Math.ceil((t0 - tz) / tstep) * tstep + tz; t <= t1; t += tstep) {
      const x = Math.round(px(t)) + 0.5
      g.beginPath(); g.moveTo(x, H - PAD.b); g.lineTo(x, H - PAD.b + 4); g.stroke()
      g.fillText(fmtTime(t, withDate), x, H - 6)
    }
  }
  g.strokeStyle = C.base
  g.beginPath(); g.moveTo(PAD.l, H - PAD.b + 0.5); g.lineTo(W - PAD.r, H - PAD.b + 0.5); g.stroke()

  if (!has) {
    g.fillStyle = C.axis; g.textAlign = 'center'; g.font = font(12)
    g.fillText('maglumat ýok', (PAD.l + W - PAD.r) / 2, (PAD.t + H - PAD.b) / 2)
    return
  }

  // eşikler (adıyla: "Duýduryş 110")
  for (const t of p.thresholds ?? []) {
    if (t.value < lo || t.value > hi) continue
    const col = t.level === 'ALARM' ? C.alarm : C.warn
    g.strokeStyle = col
    g.globalAlpha = 0.75; g.setLineDash([6, 4])
    const y = Math.round(py(t.value)) + 0.5
    g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
    g.setLineDash([]); g.globalAlpha = 1
    if (!isEnum) {
      g.fillStyle = col; g.font = font(9.5); g.textAlign = 'right'
      g.fillText(`${t.label ?? (t.level === 'ALARM' ? 'Näsazlyk' : 'Duýduryş')} ${fmtNum(t.value, digits)}`, W - PAD.r - 3, y - 3)
      g.font = font(10.5)
    }
  }

  // üst üste sütunlar: her zamanda seriler sırayla birbirinin üstüne, tepede toplam
  if (p.bars) {
    const bw = p.bars
    g.save(); g.beginPath(); g.rect(PAD.l, 0, W - PAD.l - PAD.r, H - PAD.b); g.clip()
    if (hover?.slot !== undefined) {
      g.fillStyle = C.barHover
      g.fillRect(px(hover.slot), PAD.t, px(hover.slot + bw) - px(hover.slot), H - PAD.t - PAD.b)
    }
    const base = new Map<number, number>()
    const center = new Map<number, number>()
    for (const s of visible) {
      g.fillStyle = C.barAlpha < 1 ? rgba(s.color, C.barAlpha) : s.color
      for (const b of s.data) {
        if (!(b[1] > 0) || b[0] < t0 || b[0] > t1) continue
        const k = Math.round(b[0]), y0 = base.get(k) ?? 0
        const x0 = px(b[0] - bw / 2), x1 = px(b[0] + bw / 2)
        const gap = Math.min(4, (x1 - x0) * 0.16)
        g.fillRect(x0 + gap, py(y0 + b[1]), Math.max(1, x1 - x0 - 2 * gap), py(y0) - py(y0 + b[1]))
        base.set(k, y0 + b[1]); center.set(k, b[0])
      }
    }
    g.restore()
    // toplam: sığarsa yatay, dar sütunda dik (örnek ekrandaki gibi), çok darsa yazılmaz
    g.fillStyle = C.total; g.font = font(10, true)
    const slotPx = px(t0 + bw) - px(t0)
    for (const [k, tot] of base) {
      if (!(tot > 0)) continue
      const txt = fmtNum(tot, digits), w = g.measureText(txt).width
      const x = px(center.get(k)!), y = py(tot)
      if (w + 2 <= slotPx * 0.92) { g.textAlign = 'center'; g.fillText(txt, x, y - 4) }
      else if (slotPx >= 9) {
        g.save(); g.textAlign = 'left'; g.translate(x + 3.5, y - 3); g.rotate(-Math.PI / 2); g.fillText(txt, 0, 0); g.restore()
      }
    }
    g.font = font(10.5)
  }

  // seriler
  const step = isEnum
  if (!p.bars) visible.forEach((s, si) => {
    const d = s.data
    if (!d.length) return
    // Durum grafiğinde aynı seviyedeki seriler üst üste binmesin: hafif kaydır
    const off = step && visible.length > 1 ? (si - (visible.length - 1) / 2) * 3 : 0
    const path = () => {
      g.beginPath()
      d.forEach((b, i) => {
        const x = px(b[0]), y = py(b[1]) + off
        if (!i) g.moveTo(x, y)
        else if (step) { g.lineTo(x, py(d[i - 1][1]) + off); g.lineTo(x, y) }
        else g.lineTo(x, y)
      })
    }
    if ((p.fill ?? true) && si === 0 && visible.length === 1 && !isEnum) {
      path()
      g.lineTo(px(d[d.length - 1][0]), H - PAD.b); g.lineTo(px(d[0][0]), H - PAD.b); g.closePath()
      const grd = g.createLinearGradient(0, PAD.t, 0, H - PAD.b)
      grd.addColorStop(0, rgba(s.color, 0.32)); grd.addColorStop(1, rgba(s.color, 0.04))
      g.fillStyle = grd; g.fill()
    }
    path()
    g.strokeStyle = s.color; g.lineWidth = visible.length > 3 ? 1.4 : 1.8
    if (s.dashed) g.setLineDash([5, 3])
    g.stroke(); g.setLineDash([]); g.lineWidth = 1
  })

  // iň ýokary / ortaça / iň pes
  if (stats) {
    const lines: [number, string, string][] = [[stats.max, C.max, 'MAKS'], [stats.avg, C.avg, 'ORT'], [stats.min, C.min, 'MIN']]
    g.font = font(9.5, true); g.textAlign = 'left'
    // Etiketler birbirine yakınsa üst üste binmesin: en az 10 px aralık
    const ys = lines.map(([v]) => py(v))
    const ly = [...ys]
    for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < 10) ly[i] = ly[i - 1] + 10
    lines.forEach(([, col, lab], i) => {
      const y = Math.round(ys[i]) + 0.5
      g.strokeStyle = col; g.setLineDash([4, 4]); g.globalAlpha = 0.9
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
      g.setLineDash([]); g.globalAlpha = 1
      g.fillStyle = col === C.avg ? C.text : col
      g.fillText(lab, W - PAD.r + 4, ly[i] + 3.5)
    })
  }

  // imleç
  if (hover && !p.bars) {
    const x = Math.round(px(hover.t)) + 0.5
    if (x >= PAD.l && x <= W - PAD.r) {
      g.strokeStyle = C.cursor
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, H - PAD.b); g.stroke()
      for (const { s, b } of hover.rows) {
        if (!b) continue
        g.fillStyle = s.color
        g.beginPath(); g.arc(px(b[0]), py(b[1]), 3.2, 0, Math.PI * 2); g.fill()
      }
    }
  }
}

// --------------------------------------------------------------------------- //
// Bileşen
// --------------------------------------------------------------------------- //

export function Chart(p: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<number | null>(null)     // imlecin x'i (css px)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null)
  const dragRef = useRef<number | null>(null)                  // sürükleme başlangıcı (css px)
  const isEnum = !!p.enumLabels?.length
  const digits = p.digits ?? 1
  const zoomable = !!p.onZoom

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(() => p.series.filter((s) => !hidden.has(s.label)), [p.series, hidden])

  // Ölçek ve istatistik
  const geo = useMemo(() => chartGeometry(p, visible, size.w, size.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, visible, p.from, p.to, p.thresholds, p.stats, p.enumLabels, p.yMin, p.yMax, p.bars, p.digits, p.yTitle])

  // İmleçteki kova (her seri için en yakın; sütunluda imlecin üstündeki sütun)
  const hoverT = hover === null || !geo.W || drag ? null : geo.tx(hover)
  const hoverMark = useMemo<HoverMark | null>(() => {
    if (hoverT === null) return null
    if (p.bars) {
      const bw = p.bars, slot = geo.t0 + Math.floor((hoverT - geo.t0) / bw) * bw, c = slot + bw / 2
      if (slot < geo.t0 || slot >= geo.t1) return null
      return { t: hoverT, slot, rows: visible.map((s) => ({ s, b: s.data.find((b) => Math.abs(b[0] - c) < bw / 2) ?? null })) }
    }
    return {
      t: hoverT,
      rows: visible.map((s) => {
        let best: Bucket | null = null
        for (const b of s.data) if (!best || Math.abs(b[0] - hoverT) < Math.abs(best[0] - hoverT)) best = b
        return { s, b: best }
      }),
    }
  }, [hoverT, visible, p.bars, geo.t0, geo.t1])

  useEffect(() => {
    const c = cv.current
    const { W, H } = geo
    if (!c || !W || !H) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    drawChart(g, geo, p, visible, SCREEN, hoverMark)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, visible, hoverMark, p.thresholds, p.enumLabels, p.fill, p.bars, p.yTitle])

  const fmtV = (v: number) => isEnum ? (p.enumLabels![Math.round(v)] ?? String(v))
    : `${fmtNum(v, digits)}${p.unit ? ' ' + p.unit : ''}`

  const xOf = (e: { clientX: number; currentTarget: HTMLElement }) => e.clientX - e.currentTarget.getBoundingClientRect().left
  const clampX = (x: number) => Math.max(geo.PAD.l, Math.min(geo.W - geo.PAD.r, x))

  const rows = hoverMark?.rows.filter((r) => r.b) ?? []
  const tipLeft = hover !== null && hover > geo.W * 0.5
  const bw = p.bars
  const tipHead = !hoverMark || !rows.length ? ''
    : bw && hoverMark.slot !== undefined ? `${fmtDateTime(hoverMark.slot)} – ${fmtTime(hoverMark.slot + bw)}`
    : fmtDateTime(rows[0].b![0])
  const band = drag && Math.abs(drag.x1 - drag.x0) >= 2
    ? { l: Math.min(drag.x0, drag.x1), w: Math.abs(drag.x1 - drag.x0) } : null

  return (
    <div className={`chartWrap${p.compact ? ' compact' : ''}`}>
      {p.series.length > 1 && (
        <div className="chartLegend">
          {p.series.map((s) => (
            <button key={s.label} className={`${hidden.has(s.label) ? 'off' : ''}${s.dashed ? ' dashed' : ''}${bw ? ' box' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setHidden((h) => { const n = new Set(h); if (n.has(s.label)) n.delete(s.label); else n.add(s.label); return n })
                    }}>
              <i style={{ '--c': s.color } as CSSProperties} />{s.label}
            </button>
          ))}
        </div>
      )}
      <div className={`chartArea${zoomable ? ' zoomable' : ''}`} ref={wrap}
           onPointerDown={(e) => {
             if (!zoomable || e.button !== 0) return
             const x = xOf(e)
             if (x < geo.PAD.l - 4 || x > geo.W - geo.PAD.r + 4) return
             e.currentTarget.setPointerCapture(e.pointerId)
             if (e.pointerType === 'mouse') e.preventDefault()          // metin seçilmesin
             dragRef.current = clampX(x)
             setDrag({ x0: clampX(x), x1: clampX(x) })
           }}
           onPointerMove={(e) => {
             const x = xOf(e)
             setHover(x)
             if (dragRef.current !== null) setDrag({ x0: dragRef.current, x1: clampX(x) })
           }}
           onPointerUp={(e) => {
             const x0 = dragRef.current
             dragRef.current = null
             setDrag(null)
             if (x0 === null) return
             const x1 = clampX(xOf(e))
             // kısa hareket tıklamadır (dokunmatikte değer kutusu açılır)
             if (Math.abs(x1 - x0) >= 6) p.onZoom?.(geo.tx(Math.min(x0, x1)), geo.tx(Math.max(x0, x1)))
           }}
           onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
           onMouseLeave={() => { if (dragRef.current === null) setHover(null) }}
           onDoubleClick={() => p.onZoomOut?.()}>
        <canvas ref={cv} />
        {band && (
          <div className="chartBand" style={{ left: band.l, width: band.w, top: geo.PAD.t, bottom: geo.PAD.b }}>
            {band.w > 70 && <span>{fmtTime(geo.tx(band.l), geo.t1 - geo.t0 > 36 * 3600)} → {fmtTime(geo.tx(band.l + band.w), geo.t1 - geo.t0 > 36 * 3600)}</span>}
          </div>
        )}
        {rows.length > 0 && (
          <div className="chartTip" style={tipLeft ? { right: geo.W - (hover ?? 0) + 12 } : { left: (hover ?? 0) + 12 }}>
            <div className="tipT">{tipHead}</div>
            {rows.map(({ s, b }) => (
              <div key={s.label}><i style={{ background: s.color }} />{s.label}: <b>{fmtV(b![1])}</b></div>
            ))}
            {bw && rows.length > 1 && <div className="tipSum">Jemi: <b>{fmtV(rows.reduce((a, r) => a + r.b![1], 0))}</b></div>}
          </div>
        )}
      </div>
    </div>
  )
}
