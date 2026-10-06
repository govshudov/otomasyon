import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bucket } from '../data/history'

/**
 * Zaman serisi grafiği — canvas, harici kütüphane yok.
 *
 * Referans ekrandaki gibi: çizgi + altı dolgulu alan, MAX / AVG / MIN kesik
 * çizgileri, imleçte dikey çizgi ve değer kutusu. Çok serili grafikte
 * gösterge (legend) serileri açıp kapatır. Durum grafikleri (`enumLabels`)
 * basamaklı çizilir, y ekseninde sayı yerine metin yazar.
 */

export interface Series { label: string; color: string; data: Bucket[]; dashed?: boolean }

export interface ChartProps {
  series: Series[]
  from: number; to: number                         // epoch sn
  unit?: string; digits?: number
  thresholds?: { value: number; level: 'WARN' | 'ALARM' }[]
  enumLabels?: string[]
  stats?: boolean
  fill?: boolean
  yMin?: number; yMax?: number
  compact?: boolean
}

const C = {
  grid: '#343a43', axis: '#8d949e', text: '#c9ced6',
  max: '#ef4444', avg: '#9aa0a8', min: '#eab308', warn: '#f59e0b', alarm: '#ef4444',
}

function niceStep(span: number, n: number): number {
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

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function Chart(p: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<number | null>(null)     // imlecin x'i (css px)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const isEnum = !!p.enumLabels?.length
  const digits = p.digits ?? 1

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
  const geo = useMemo(() => {
    const { w: W, h: H } = size
    const PAD = { l: 46, r: p.stats ? 40 : 12, t: 10, b: 22 }
    let lo = Infinity, hi = -Infinity
    for (const s of visible) for (const b of s.data) { if (b[2] < lo) lo = b[2]; if (b[3] > hi) hi = b[3] }
    const has = Number.isFinite(lo)
    let stats: { min: number; max: number; avg: number } | null = null
    if (p.stats && visible.length === 1 && visible[0].data.length) {
      const d = visible[0].data
      stats = { min: Math.min(...d.map((b) => b[2])), max: Math.max(...d.map((b) => b[3])),
                avg: d.reduce((a, b) => a + b[1], 0) / d.length }
    }
    if (isEnum) { lo = -0.25; hi = p.enumLabels!.length - 0.75 }
    else {
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
    // Sol boşluk en uzun eksen etiketine göre (1,200,000 m³ kesilmesin)
    const longest = isEnum ? Math.max(...p.enumLabels!.map((s) => s.length))
      : Math.max(...[lo, hi].map((v) => Math.round(v).toLocaleString('en-US').length + (hi - lo < 10 ? 2 : 0)))
    PAD.l = Math.max(34, Math.round(longest * 6.3) + 14)
    const px =(t: number) => PAD.l + ((t - p.from) / Math.max(p.to - p.from, 1)) * (W - PAD.l - PAD.r)
    const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
    return { W, H, PAD, lo, hi, px, py, has, stats }
  }, [size, visible, p.from, p.to, p.thresholds, p.stats, p.enumLabels, isEnum, p.yMin, p.yMax])

  // İmleçteki kova (her seri için en yakın)
  const hoverT = hover === null || !geo.W ? null
    : p.from + ((hover - geo.PAD.l) / Math.max(geo.W - geo.PAD.l - geo.PAD.r, 1)) * (p.to - p.from)
  const hoverRows = useMemo(() => {
    if (hoverT === null) return null
    return visible.map((s) => {
      let best: Bucket | null = null
      for (const b of s.data) if (!best || Math.abs(b[0] - hoverT) < Math.abs(best[0] - hoverT)) best = b
      return { s, b: best }
    })
  }, [hoverT, visible])

  useEffect(() => {
    const c = cv.current
    const { W, H, PAD, lo, hi, px, py, has, stats } = geo
    if (!c || !W || !H) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    g.font = '10.5px system-ui, "Segoe UI", sans-serif'
    g.lineWidth = 1

    // y ızgarası
    g.fillStyle = C.axis; g.strokeStyle = C.grid
    if (isEnum) {
      p.enumLabels!.forEach((lab, i) => {
        const y = Math.round(py(i)) + 0.5
        g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
        g.textAlign = 'right'; g.fillText(lab, PAD.l - 6, y + 3.5)
      })
    } else {
      const st = niceStep(hi - lo, Math.max(2, Math.floor((H - PAD.t - PAD.b) / 26)))
      for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
        const y = Math.round(py(v)) + 0.5
        g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
        g.textAlign = 'right'
        g.fillText(v.toLocaleString('en-US', { maximumFractionDigits: st < 1 ? 2 : 0 }), PAD.l - 6, y + 3.5)
      }
    }

    // x ekseni
    const span = p.to - p.from
    const tstep = TSTEPS.find((s) => (W - PAD.l - PAD.r) / (span / s) > 74) ?? 172800
    const withDate = span > 36 * 3600
    g.textAlign = 'center'; g.fillStyle = C.axis
    const tz = new Date().getTimezoneOffset() * 60
    for (let t = Math.ceil((p.from - tz) / tstep) * tstep + tz; t <= p.to; t += tstep) {
      const x = Math.round(px(t)) + 0.5
      g.strokeStyle = C.grid
      g.beginPath(); g.moveTo(x, H - PAD.b); g.lineTo(x, H - PAD.b + 4); g.stroke()
      g.fillText(fmtTime(t, withDate), x, H - 6)
    }
    g.strokeStyle = '#4a515b'
    g.beginPath(); g.moveTo(PAD.l, H - PAD.b + 0.5); g.lineTo(W - PAD.r, H - PAD.b + 0.5); g.stroke()

    if (!has) {
      g.fillStyle = C.axis; g.textAlign = 'center'; g.font = '12px system-ui, sans-serif'
      g.fillText('maglumat ýok', (PAD.l + W - PAD.r) / 2, (PAD.t + H - PAD.b) / 2)
      return
    }

    // eşikler
    for (const t of p.thresholds ?? []) {
      if (t.value < lo || t.value > hi) continue
      g.strokeStyle = t.level === 'ALARM' ? C.alarm : C.warn
      g.globalAlpha = 0.75; g.setLineDash([6, 4])
      const y = Math.round(py(t.value)) + 0.5
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
      g.setLineDash([]); g.globalAlpha = 1
    }

    // seriler
    const step = isEnum
    visible.forEach((s, si) => {
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

    // MAX / AVG / MIN
    if (stats) {
      const lines: [number, string, string][] = [[stats.max, C.max, 'MAX'], [stats.avg, C.avg, 'AVG'], [stats.min, C.min, 'MIN']]
      g.font = 'bold 9.5px system-ui, sans-serif'; g.textAlign = 'left'
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
    if (hoverRows && hoverT !== null) {
      const x = Math.round(px(hoverT)) + 0.5
      if (x >= PAD.l && x <= W - PAD.r) {
        g.strokeStyle = 'rgba(220,225,232,.55)'
        g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, H - PAD.b); g.stroke()
        for (const { s, b } of hoverRows) {
          if (!b) continue
          g.fillStyle = s.color
          g.beginPath(); g.arc(px(b[0]), py(b[1]), 3.2, 0, Math.PI * 2); g.fill()
        }
      }
    }
  }, [geo, visible, hoverRows, hoverT, p.thresholds, p.enumLabels, p.fill, isEnum, p.from, p.to])

  const fmtV = (v: number) => isEnum ? (p.enumLabels![Math.round(v)] ?? String(v))
    : `${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${p.unit ? ' ' + p.unit : ''}`

  const tipLeft = hover !== null && hover > geo.W * 0.6
  return (
    <div className={`chartWrap${p.compact ? ' compact' : ''}`}>
      {p.series.length > 1 && (
        <div className="chartLegend">
          {p.series.map((s) => (
            <button key={s.label} className={hidden.has(s.label) ? 'off' : ''}
                    onClick={(e) => {
                      e.stopPropagation()
                      setHidden((h) => { const n = new Set(h); if (n.has(s.label)) n.delete(s.label); else n.add(s.label); return n })
                    }}>
              <i style={{ background: s.color }} />{s.label}
            </button>
          ))}
        </div>
      )}
      <div className="chartArea" ref={wrap}
           onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
           onMouseLeave={() => setHover(null)}>
        <canvas ref={cv} />
        {hoverRows && hoverT !== null && hoverRows.some((r) => r.b) && (
          <div className="chartTip" style={tipLeft ? { right: geo.W - (hover ?? 0) + 12 } : { left: (hover ?? 0) + 12 }}>
            <div className="tipT">{fmtDateTime(hoverRows.find((r) => r.b)!.b![0])}</div>
            {hoverRows.map(({ s, b }) => b && (
              <div key={s.label}><i style={{ background: s.color }} />{s.label}: <b>{fmtV(b[1])}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
