import { useEffect, useRef, useState } from 'react'
import type { SignalDef } from '../scene/types'
import { useTwin } from '../data/store'

/**
 * Trend grafiği — canvas, harici kütüphane yok.
 *
 * uPlot gibi bir kütüphane de iyi olurdu ama burada ihtiyaç dar: tek seri,
 * min/max bandı ve alarm eşikleri. 120 satır kod, sıfır bağımlılık, Pi 4'te
 * ölçülebilir maliyet. Sunucu veriyi zaman kovalarına indirgeyerek gönderiyor
 * (600 nokta), yani ekrana 100 bin nokta çizme durumu hiç oluşmuyor.
 */

type Bucket = [number, number, number, number]   // [epoch_s, ort, min, max]

const RANGES = [
  { label: '15 min', minutes: 15 },
  { label: '1 sag', minutes: 60 },
  { label: '6 sag', minutes: 360 },
  { label: '24 sag', minutes: 1440 },
]

export function Trend({ sig, onClose }: { sig: SignalDef; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const seeded = useTwin((s) => s.historySeeded)
  const [minutes, setMinutes] = useState(60)
  const [data, setData] = useState<Bucket[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`/api/history?tag=${encodeURIComponent(sig.tag)}&minutes=${minutes}&buckets=320`)
        const j = await r.json()
        if (alive) { setData(j[sig.tag] ?? []); setErr(null) }
      } catch (e) { if (alive) setErr(String(e)) }
    }
    load()
    const t = setInterval(load, 10_000)
    return () => { alive = false; clearInterval(t) }
  }, [sig.tag, minutes])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !data) return
    const W = cv.clientWidth, H = cv.clientHeight
    cv.width = W; cv.height = H                     // DPR 1 — Pi 4 dolgu bütçesi
    const g = cv.getContext('2d')!
    const css = getComputedStyle(document.documentElement)
    const C = (n: string) => css.getPropertyValue(n).trim()
    g.clearRect(0, 0, W, H)

    if (!data.length) {
      g.fillStyle = C('--dimmer'); g.font = '12px system-ui'
      g.fillText('taryhy maglumat ýok', 8, H / 2)
      return
    }

    const PAD = { l: 44, r: 6, t: 8, b: 18 }
    const x0 = data[0][0], x1 = data[data.length - 1][0]
    let lo = Infinity, hi = -Infinity
    for (const [, , mn, mx] of data) { lo = Math.min(lo, mn); hi = Math.max(hi, mx) }
    // Alarm eşikleri de görünür olsun — trend eşiğe ne kadar yaklaştı, bu önemli
    for (const a of sig.alarms ?? []) {
      if (typeof a.value === 'number') { lo = Math.min(lo, a.value); hi = Math.max(hi, a.value) }
    }
    if (hi - lo < 1e-6) { hi = lo + 1; lo -= 1 }
    const pad = (hi - lo) * 0.08
    lo -= pad; hi += pad

    const px = (t: number) => PAD.l + ((t - x0) / Math.max(x1 - x0, 1)) * (W - PAD.l - PAD.r)
    const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)

    // ızgara + y ekseni
    g.strokeStyle = C('--line-soft'); g.fillStyle = C('--dimmer')
    g.font = '10px ui-monospace, monospace'; g.lineWidth = 1
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3
      const y = Math.round(py(v)) + 0.5
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke()
      g.fillText(v.toFixed(Math.abs(hi - lo) < 5 ? 2 : 0), 4, y + 3)
    }

    // alarm eşikleri
    for (const a of sig.alarms ?? []) {
      if (typeof a.value !== 'number') continue
      g.strokeStyle = a.level === 'ALARM' ? C('--alarm') : C('--warn')
      g.setLineDash([4, 3]); g.beginPath()
      const y = Math.round(py(a.value)) + 0.5
      g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke(); g.setLineDash([])
    }

    // min/max bandı
    g.fillStyle = 'rgba(59,130,246,0.18)'
    g.beginPath()
    data.forEach(([t, , , mx], i) => (i ? g.lineTo(px(t), py(mx)) : g.moveTo(px(t), py(mx))))
    for (let i = data.length - 1; i >= 0; i--) g.lineTo(px(data[i][0]), py(data[i][2]))
    g.closePath(); g.fill()

    // ortalama çizgisi
    g.strokeStyle = C('--accent'); g.lineWidth = 1.6; g.beginPath()
    data.forEach(([t, avg], i) => (i ? g.lineTo(px(t), py(avg)) : g.moveTo(px(t), py(avg))))
    g.stroke()

    // zaman etiketleri
    g.fillStyle = C('--dimmer'); g.font = '10px ui-monospace, monospace'
    const fmtT = (s: number) => new Date(s * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    g.fillText(fmtT(x0), PAD.l, H - 5)
    const last = fmtT(x1)
    g.fillText(last, W - PAD.r - g.measureText(last).width, H - 5)
  }, [data, sig])

  const last = data?.length ? data[data.length - 1][1] : null

  return (
    <div className="trend">
      <div className="secTitle spread">
        <span>{sig.label}{sig.unit ? ` (${sig.unit})` : ''}</span>
        <button onClick={onClose}>ýap</button>
      </div>
      <div className="ranges">
        {RANGES.map((r) => (
          <button key={r.label} className={minutes === r.minutes ? 'on' : ''}
                  onClick={() => setMinutes(r.minutes)}>{r.label}</button>
        ))}
        {seeded && <span className="demoTag" title="Bu grafikdäki köne maglumat demo üçin döredildi, ölçeg däl">demo maglumaty</span>}
        {last !== null && <span className="lastv">{last.toFixed(1)}{sig.unit ? ` ${sig.unit}` : ''}</span>}
      </div>
      <canvas ref={canvasRef} className="chart" />
      {err && <div className="empty">taryh alynmady: {err}</div>}
    </div>
  )
}
