import { useEffect } from 'react'
import { fmtN } from '../data/pump'
import { interp, type EgriModel, type IsNokady, type NormPoint } from '../data/egri'

/**
 * H–Q grafigi (KSB "Total developed head"): zawod egrisi, taslama nokady, Qmin
 * we nasosyň häzirki iş nokady. Debi m³/s (KSB PDF'indäki ýaly).
 * Inwertörde egri ýygylyga görä ölçeklenýär; nominal egri kesik çyzyk bolup galýar.
 */

const W = 640, H = 360, L = 54, R = 18, T = 18, B = 46

function niceStep(span: number, n: number): number {
  const raw = span / Math.max(n, 1)
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p
}

/** Noktalardan yumuşak çizgi (monoton kübik, Fritsch–Carlson): PDF'ten okunan noktalar köşe yapmasın, taşma olmasın */
function smooth(p: number[][]): string {
  const n = p.length
  if (n < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const d = p.slice(1).map((b, i) => (b[1] - p[i][1]) / (b[0] - p[i][0] || 1))
  const t = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / d[i], b = t[i + 1] / d[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i] }
  }
  let out = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3
    out += ` C${(p[i][0] + h).toFixed(1)},${(p[i][1] + t[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - t[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`
  }
  return out
}

export function HeadCurve({ m, pt, cloud = [], dev = null }: {
  m: EgriModel; pt: IsNokady | null
  /** geçmiş nokatlar, 50 Hz'e indirgenmiş */
  cloud?: NormPoint[]
  /** zawod egrisinden tapawut, % (häzirki egri = zawod egrisi × (1 + dev/100)) */
  dev?: number | null
}) {
  const r = pt?.r ?? 1
  const scaled = r < 0.995 || r > 1.005
  const qs = m.q
  const pq = pt?.q ?? null
  const ph = pt?.h ?? null

  const cq = cloud.map((c) => c.q)
  const xMax = Math.max(qs[qs.length - 1], pq ?? 0, ...cq) * 1.06
  let yLo = Math.min(...m.h) * (scaled ? r * r : 1), yHi = Math.max(...m.h)
  if (ph !== null) { yLo = Math.min(yLo, ph); yHi = Math.max(yHi, ph) }
  for (const c of cloud) { yLo = Math.min(yLo, c.h); yHi = Math.max(yHi, c.h) }
  if (dev !== null) yLo = Math.min(yLo, Math.min(...m.h) * (1 + dev / 100))
  const ys = niceStep(yHi - yLo + 10, 5)
  const y0 = Math.max(0, Math.floor((yLo - 5) / ys) * ys), y1 = Math.ceil((yHi + 3) / ys) * ys
  const xs = niceStep(xMax, 6)

  const X = (q: number) => L + (q / xMax) * (W - L - R)
  const Y = (h: number) => T + (1 - (h - y0) / (y1 - y0)) * (H - T - B)
  const path = (k: number, f = 1) => smooth(m.q.map((q, i) => [X(q * k), Y(m.h[i] * k * k * f)]))

  const xt: number[] = []; for (let v = 0; v <= xMax + 1e-6; v += xs) xt.push(v)
  const yt: number[] = []; for (let v = y0; v <= y1 + 1e-6; v += ys) yt.push(v)
  const tq = m.taslama.q * r, th = m.taslama.h * r * r
  const qmin = m.qmin * r
  const below = pq !== null && pq < qmin
  const xDig = xs < 0.1 ? 2 : 1
  // nokta egrinin altındaysa yazısı da aşağıda: egri çizgisinin üstüne binmesin
  const hc = pq !== null ? interp(m.q, m.h, pq / r) : null
  const under = ph !== null && hc !== null && ph < hc * r * r
  // egri sağa doğru iner: altındaki noktanın yazısı sol-altta, üstündekinin sağ-üstte egriden uzak durur
  const left = pq !== null && (under ? X(pq) > L + 190 : X(pq) > W - 190)

  return (
    <svg className="hq" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="H–Q egrisi">
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" />
          <text x={L - 8} y={Y(v) + 4} className="tick" textAnchor="end">{v}</text>
        </g>
      ))}
      {xt.map((v) => (
        <g key={`x${v}`}>
          <line x1={X(v)} x2={X(v)} y1={T} y2={H - B} className="grid" />
          <text x={X(v)} y={H - B + 17} className="tick" textAnchor="middle">{v.toFixed(xDig)}</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 8} className="axis" textAnchor="middle">Akym Q, m³/s</text>
      <text x={14} y={(T + H - B) / 2} className="axis" textAnchor="middle"
            transform={`rotate(-90 14 ${(T + H - B) / 2})`}>Basyş beýikligi H, m</text>

      {/* Qmin: bundan az akymda nasos uzak işlemeli däl */}
      <rect x={L} y={T} width={Math.max(0, X(qmin) - L)} height={H - T - B} className="lowZone" />
      <line x1={X(qmin)} x2={X(qmin)} y1={T} y2={H - B} className="qmin" />
      <text x={X(qmin) + 4} y={T + 13} className="lbl">Qmin</text>

      {cloud.map((c, i) => <circle key={i} cx={X(c.q)} cy={Y(c.h)} r={2.6} className={c.inv ? 'cl inv' : 'cl'} />)}
      {dev !== null && <path d={path(1, 1 + dev / 100)} className="curve now" />}
      {scaled && <path d={path(1)} className="curve nominal" />}
      <path d={path(r)} className="curve" />

      <g transform={`translate(${X(tq)},${Y(th)})`}>
        <path d="M-6,-6 L6,6 M-6,6 L6,-6" className="design" />
      </g>
      <text x={X(tq) - 9} y={Y(th) + 18} className="lbl" textAnchor="end">Taslama</text>

      {pq !== null && ph !== null && (
        <g className={`pt${below ? ' bad' : ''}`}>
          <circle cx={X(pq)} cy={Y(ph)} r={13} className="halo" />
          <circle cx={X(pq)} cy={Y(ph)} r={6.5} className="dot" />
          <text x={X(pq) + (left ? -16 : 16)} y={Y(ph) + (under ? 26 : -16)} className="ptLbl"
                textAnchor={left ? 'end' : 'start'}>
            {fmtN(pq, 3)} m³/s · {fmtN(ph, 1)} m
          </text>
        </g>
      )}
    </svg>
  )
}

export interface CurveRow { label: string; value: string; cls?: string }

export function CurveModal({ title, sub, m, pt, cloud, dev, rows, note, onClose }: {
  title: string; sub: string; m: EgriModel | null; pt: IsNokady | null
  cloud?: NormPoint[]; dev?: number | null
  rows: CurveRow[]; note?: string; onClose: () => void
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const nInv = cloud?.filter((c) => c.inv).length ?? 0
  return (
    <div className="hqScrim" onClick={onClose}>
      <div className="hqPanel" onClick={(e) => e.stopPropagation()}>
        <div className="hqHead">
          <div><b>{title}</b><span>{sub}</span></div>
          <button className="x" onClick={onClose} aria-label="ýap">×</button>
        </div>
        {m ? <HeadCurve m={m} pt={pt} cloud={cloud} dev={dev} /> : <div className="empty">Bu nasos üçin egri girizilmedik (common/nasos_egrileri.json → atama).</div>}
        {m && (
          <div className="hqLegend">
            <span><i className="lg zawod" />Zawod egrisi (PDF)</span>
            {dev != null && <span><i className="lg now" />Häzirki egri</span>}
            {!!cloud?.length && <span><i className="lg cl" />Transformatorda</span>}
            {nInv > 0 && <span><i className="lg cl inv" />Inwertorda (50 Hz-e getirildi)</span>}
            <span><i className="lg live" />Häzirki iş nokady</span>
          </div>
        )}
        <div className="hqRows">
          {rows.map((r) => <div key={r.label}><span>{r.label}</span><b className={r.cls}>{r.value}</b></div>)}
        </div>
        {note && <div className="hqNote">{note}</div>}
      </div>
    </div>
  )
}