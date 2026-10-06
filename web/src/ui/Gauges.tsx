/**
 * Göstergeler — saf SVG: ark (Hz), kuwwat (ibreli yay), akym dairesi (su
 * dolgusu), seviye tankı, küçük çizgi grafik (sparkline).
 */
import { useEffect, useRef, useState } from 'react'
import type { Bucket } from '../data/history'

const rad = (d: number) => (d * Math.PI) / 180
const pt = (cx: number, cy: number, r: number, d: number) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))]
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1)
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** 270°'lik ark: ortada değer + birim (referanstaki "Speed" göstergesi). */
export function ArcGauge({ value, max, unit, label, active, digits = 1, note }: {
  value: number | null; max: number; unit: string; label: string; active: boolean; digits?: number; note?: string
}) {
  const A0 = 135, A1 = 405
  const f = value === null ? 0 : clamp01(value / max)
  const a = A0 + (A1 - A0) * f
  const [mx, my] = pt(60, 56, 44, a)
  return (
    <svg viewBox="0 0 120 112" className="arcGauge">
      <path d={arc(60, 56, 44, A0, A1)} className="track" />
      {f > 0.002 && <path d={arc(60, 56, 44, A0, a)} className={`val${active ? ' on' : ''}`} />}
      {f > 0.002 && <circle cx={mx} cy={my} r={3.4} className={`tip${active ? ' on' : ''}`} />}
      <text x={60} y={58} className="gv">{value === null ? '—' : value.toFixed(digits)}</text>
      <text x={60} y={74} className="gu">{unit}{note ? ` · ${note}` : ''}</text>
      <text x={60} y={106} className="gl">{label}</text>
    </svg>
  )
}

/** Kuwwat göstergesi: yeşil yay + ibre, altında değer. */
export function PowerGauge({ value, max, unit }: { value: number | null; max: number; unit: string }) {
  const A0 = 150, A1 = 390
  const f = value === null ? 0 : clamp01(value / max)
  const a = A0 + (A1 - A0) * f
  const [nx, ny] = pt(60, 58, 34, a)
  return (
    <svg viewBox="0 0 120 104" className="powerGauge">
      <path d={arc(60, 58, 46, A0, A1)} className="track" />
      {f > 0.002 && <path d={arc(60, 58, 46, A0, a)} className="val" />}
      <line x1={60} y1={58} x2={nx} y2={ny} className="needle" />
      <circle cx={60} cy={58} r={4} className="hub" />
      <text x={60} y={88} className="gv">{value === null ? '—' : value.toFixed(1)}</text>
      <text x={18} y={101} className="gs">0</text>
      <text x={60} y={101} className="gu">{unit}</text>
      <text x={102} y={101} className="gs">{Math.round(max)}</text>
    </svg>
  )
}

/** Akym dairesi: debinin tasarım debisine oranı kadar su dolgusu. */
export function FlowCircle({ value, max, unit, label, id }: { value: number | null; max: number; unit: string; label: string; id: string }) {
  const f = value === null ? 0 : clamp01(value / max)
  const y = 104 - 96 * Math.max(f, 0.04)
  const wave = `M4,${y} q 12,-5 24,0 t 24,0 t 24,0 t 24,0 t 24,0 V 112 H 4 Z`
  return (
    <svg viewBox="0 0 108 108" className="flowCircle">
      <defs><clipPath id={`fc-${id}`}><circle cx={54} cy={54} r={47} /></clipPath></defs>
      <circle cx={54} cy={54} r={51} className="ring" />
      <g clipPath={`url(#fc-${id})`}>
        <rect x={0} y={0} width={108} height={108} className="bg" />
        <path d={wave} className="water" />
      </g>
      <text x={54} y={52} className="gv">{value === null ? '—' : value.toFixed(0)}</text>
      <text x={54} y={67} className="gu">{unit}</text>
      <text x={54} y={81} className="gl">{label}</text>
    </svg>
  )
}

/** Seviye tankı: dolgu + eşik çizgileri. */
export function LevelTank({ value, max, marks, sev }: {
  value: number | null; max: number; marks: { v: number; level: 'WARN' | 'ALARM' }[]; sev: string
}) {
  const H = 92, Y0 = 6
  const y = (v: number) => Y0 + H * (1 - clamp01(v / max))
  return (
    <svg viewBox="0 0 44 104" className={`levelTank ${sev}`}>
      <rect x={6} y={Y0} width={30} height={H} rx={3} className="shell" />
      {value !== null && <rect x={7} y={y(value)} width={28} height={Y0 + H - y(value)} rx={2} className="fill" />}
      {marks.map((m, i) => (
        <line key={i} x1={3} x2={39} y1={y(m.v)} y2={y(m.v)} className={m.level === 'ALARM' ? 'mAlarm' : 'mWarn'} />
      ))}
    </svg>
  )
}

/** Küçük çizgi grafik (pompa kartındaki basyş). Genişliği kutusundan ölçülür. */
export function Sparkline({ data, color = '#4aa8ff', min }: { data: Bucket[] | undefined; color?: string; min?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sz, setSz] = useState({ W: 150, H: 46 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const upd = () => setSz({ W: Math.max(60, el.clientWidth), H: Math.max(30, el.clientHeight) })
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <div className="spark" ref={ref}><SparkSvg data={data} color={color} min={min} W={sz.W} H={sz.H} /></div>
}

function SparkSvg({ data, color, min, W, H }: { data: Bucket[] | undefined; color: string; min?: number; W: number; H: number }) {
  const P = { l: 24, r: 2, t: 4, b: 4 }
  if (!data || data.length < 2) {
    return <svg viewBox={`0 0 ${W} ${H}`}><text x={W / 2} y={H / 2 + 3} className="none">taryh ýok</text></svg>
  }
  let lo = Math.min(...data.map((b) => b[2])), hi = Math.max(...data.map((b) => b[3]))
  if (min !== undefined) lo = Math.min(lo, min)
  if (hi - lo < 0.2) { hi += 0.1; lo = Math.max(min ?? -Infinity, lo - 0.1) }
  const t0 = data[0][0], t1 = data[data.length - 1][0]
  const x = (t: number) => P.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - P.l - P.r)
  const yy = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  const d = data.map((b, i) => `${i ? 'L' : 'M'}${x(b[0]).toFixed(1)},${yy(b[1]).toFixed(1)}`).join(' ')
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={P.l - 3} x2={P.l} y1={yy(v)} y2={yy(v)} className="tick" />
          <text x={P.l - 5} y={yy(v) + 3} className="tl">{v.toFixed(hi - lo < 0.5 ? 2 : hi - lo < 3 ? 1 : 0)}</text>
        </g>
      ))}
      <line x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} className="tick" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}
