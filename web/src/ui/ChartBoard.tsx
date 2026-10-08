import { useCallback, useEffect, useMemo, useState } from 'react'
import { queryHistory, sessionSince, type Bucket, type Source } from '../data/history'
import { Chart, fmtDateTime, fmtTime, type ChartProps, type Series } from './Chart'
import { Icon } from './icons'

/**
 * Grafik panosu: ortak zaman seçici + grafik ızgarası. Bir grafiğe dokununca
 * büyür (referans ekrandaki tek büyük grafik); "Ähli grafikler" ile geri.
 * Zaman aralığı TÜM grafikler için tektir.
 */

export interface ChartSpec extends Omit<ChartProps, 'from' | 'to' | 'series' | 'compact'> {
  key: string
  title: string
  series: Series[]
}

const PRESETS = [
  { s: 3600, t: '1 sag' },
  { s: 6 * 3600, t: '6 sag' },
  { s: 24 * 3600, t: '24 sag' },
  { s: 7 * 86400, t: '7 gün' },
]

interface Range { preset: number | null; from: number; to: number }

function initialRange(): Range {
  let preset = 3600
  try { preset = Number(localStorage.getItem('twin.range')) || 3600 } catch { /* depolama kapalı */ }
  const to = Date.now() / 1000
  return { preset, from: to - preset, to }
}

const toLocalInput = (s: number) => {
  const d = new Date(s * 1000 - new Date().getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => new Date(v).getTime() / 1000

const SRC_TK: Record<Source, string> = { api: 'serwer taryhy', timescale: 'maglumat binýady', niagara: 'Niagara taryhy', session: 'sahypa açylandan bäri' }

export function ChartBoard({ title, tags, build, onClose, buckets = 360, fileName, stack = false }: {
  title: string
  tags: string[]
  build: (data: Record<string, Bucket[]>) => ChartSpec[]
  onClose?: () => void
  buckets?: number
  fileName: string
  /** grafikler tek sütunda üst üste (ızgara yerine) */
  stack?: boolean
}) {
  const [range, setRange] = useState<Range>(initialRange)
  const [data, setData] = useState<Record<string, Bucket[]> | null>(null)
  const [sources, setSources] = useState<Set<Source>>(new Set())
  const [loading, setLoading] = useState(false)
  const [big, setBig] = useState<string | null>(null)
  const [custom, setCustom] = useState({ from: toLocalInput(range.from), to: toLocalInput(range.to) })
  const tagKey = tags.join('|')

  const load = useCallback(async (r: Range) => {
    setLoading(true)
    try {
      const res = await queryHistory(tags, r.from, r.to, buckets)
      setData(res.data); setSources(res.sources)
    } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagKey, buckets])

  useEffect(() => { load(range) }, [load, range])

  // Hazır aralıkta grafik "şimdiye kadar" kayar: 30 sn'de bir yenilenir
  useEffect(() => {
    if (range.preset === null) return
    const t = setInterval(() => {
      const to = Date.now() / 1000
      setRange((r) => (r.preset === null ? r : { ...r, from: to - r.preset, to }))
    }, 30_000)
    return () => clearInterval(t)
  }, [range.preset])

  const pick = (s: number) => {
    try { localStorage.setItem('twin.range', String(s)) } catch { /* depolama kapalı */ }
    const to = Date.now() / 1000
    const r = { preset: s, from: to - s, to }
    setRange(r); setCustom({ from: toLocalInput(r.from), to: toLocalInput(r.to) })
  }
  const applyCustom = () => {
    const f = fromLocalInput(custom.from), t = fromLocalInput(custom.to)
    if (Number.isFinite(f) && Number.isFinite(t) && t > f) setRange({ preset: null, from: f, to: t })
  }
  const refresh = () => {
    if (range.preset !== null) { const to = Date.now() / 1000; setRange({ ...range, from: to - range.preset, to }) }
    else load(range)
  }

  const charts = useMemo(() => (data ? build(data) : []), [data, build])

  const exportCsv = () => {
    const cols: { name: string; map: Map<number, number> }[] = []
    for (const c of charts) for (const s of c.series) {
      cols.push({ name: `${c.title} / ${s.label}${c.unit ? ` (${c.unit})` : ''}`,
                  map: new Map(s.data.map((b) => [Math.round(b[0]), b[1]])) })
    }
    const times = [...new Set(cols.flatMap((c) => [...c.map.keys()]))].sort((a, b) => a - b)
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [['Wagt', ...cols.map((c) => c.name)].map(q).join(';')]
    for (const t of times) {
      lines.push([fmtDateTime(t), ...cols.map((c) => {
        const v = c.map.get(t)
        return v === undefined ? '' : String(Math.round(v * 1000) / 1000)
      })].join(';'))
    }
    // data: adresi — JACE'in CSP'si blob: adreslerini kısıtlayabiliyor
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + lines.join('\r\n'))
    a.download = `${fileName}_${fmtDateTime(range.from).replace(/[/: ]/g, '')}.csv`
    document.body.appendChild(a); a.click(); a.remove()
  }

  const since = sessionSince()
  const srcNote = [...sources].map((s) => s === 'session' && since ? `${SRC_TK[s]} (${fmtTime(since, true)})` : SRC_TK[s]).join(' + ')
  const shown = big ? charts.filter((c) => c.key === big) : charts

  return (
    <div className="cboard">
      <div className="cbHead">
        {big ? (
          <button className="ghost" onClick={() => setBig(null)}><Icon.back size={16} /> Ähli grafikler</button>
        ) : <b className="cbTitle">{title}</b>}
        {big && <b className="cbTitle">{title} · {charts.find((c) => c.key === big)?.title}</b>}
        <span className="cbRange">{fmtDateTime(range.from)} → {fmtDateTime(range.to)}</span>
        <div className="spacer" />
        <div className="seg small">
          {PRESETS.map((p) => (
            <button key={p.s} className={range.preset === p.s ? 'on' : ''} onClick={() => pick(p.s)}>{p.t}</button>
          ))}
        </div>
        <div className="cbCustom">
          <input type="datetime-local" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span>→</span>
          <input type="datetime-local" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          <button onClick={applyCustom} className={range.preset === null ? 'on' : ''}>Görkez</button>
        </div>
        <button className="icon" title="Täzele" onClick={refresh}><Icon.refresh size={17} /></button>
        <button className="icon" title="CSV ýükle" onClick={exportCsv} disabled={!charts.length}><Icon.save size={17} /></button>
        {onClose && <button className="icon" title="Ýap" onClick={onClose}><Icon.close size={17} /></button>}
      </div>
      <div className={`cbGrid${big ? ' one' : stack ? ' stack' : ''}`}>
        {shown.map((c) => {
          const { key, title: ct, series, ...rest } = c
          return (
            <div key={key} className="cbCell" onClick={big ? undefined : () => setBig(key)}>
              <div className="cbCellHead">
                <b>{ct}</b>
                {c.unit && <span>{c.unit}</span>}
                {!big && <i className="cbZoom" title="Ulalt"><Icon.full size={13} /></i>}
              </div>
              <Chart series={series} from={range.from} to={range.to} compact={!big} {...rest} />
            </div>
          )
        })}
        {!charts.length && <div className="cbEmpty">{loading ? 'ýüklenýär…' : 'maglumat ýok'}</div>}
      </div>
      <div className="cbFoot">
        {loading ? 'ýüklenýär…' : srcNote ? `Çeşme: ${srcNote}` : 'Taryhy maglumat tapylmady'}
      </div>
    </div>
  )
}
