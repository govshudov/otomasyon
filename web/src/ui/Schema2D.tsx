import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, readTag, useTwin, type Sample } from '../data/store'
import type { SignalDef, TwinMap } from '../scene/types'
import type { StationInfo } from './StationPicker'
import { severity } from './InfoCard'
import { fetchStationConfig } from '../data/niagara'
import { STATE_TK, ordinal, stateClass } from './labels'

/**
 * 2D şema sayfası — hasaplaýjy panelinin (SUW HASAPLAÝJY MAGLUMATLARY)
 * tasarım diliyle: üstte KPI kartları, her pompa grubu için şema
 * (nasos → kollektör → esasy turba), altında ýük paýlanyşy grafiği ve
 * nasoslaryň jemleýji tablisasy.
 *
 * Veri 3D ile aynı depodan gelir; oynatma açıksa sayfa da o anı gösterir.
 * Grup üyeliği (hangi pompa hangi kolektöre basıyor) istasyon
 * konfigürasyonundan okunur — twin-map bunu taşımıyor.
 */

interface EqCfg { id: string; type: string; label?: string; header?: string }
interface StationCfg { station_id: string; name: string; equipment: EqCfg[] }

const SERIES = ['#3b82f6', '#22c55e', '#a78bfa', '#f59e0b', '#22d3ee', '#f472b6']

/** Pompa tablosunun sütunları — sıra ve birimler katalogdaki 8 sinyalle aynı. */
const COLS: { key: string; head: string; unit: string; digits: number }[] = [
  { key: 'flow_m3h', head: 'Akym', unit: 'm³/sag', digits: 1 },
  { key: 'discharge_press_bar', head: 'Basyş', unit: 'bar', digits: 2 },
  { key: 'vfd_freq_hz', head: 'Ýygylyk', unit: 'Hz', digits: 1 },
  { key: 'current_a', head: 'Tok', unit: 'A', digits: 0 },
  { key: 'power_kw', head: 'Kuwwat', unit: 'kW', digits: 1 },
  { key: 'MOTOR.temp', head: 'Temp.', unit: '°C', digits: 1 },
  { key: 'PUMP.vib', head: 'Wibr.', unit: 'mm/s', digits: 2 },
  { key: 'run_hours', head: 'Işlän', unit: 'sag', digits: 0 },
]

type Values = Record<string, Sample>

function num(values: Values, stale: Set<string>, tag: string): number | null {
  const v = readTag(values, stale, tag)
  return typeof v === 'number' ? v : null
}

/** Ekipmanın sinyal tanımı (alarm eşikleri renklendirme için). */
function sigDef(twin: TwinMap | null, eq: string, key: string): SignalDef | undefined {
  const e = twin?.equipment[eq]
  if (!e) return undefined
  if (!key.includes('.')) return e.signals[key]
  const [c, m] = key.split('.')
  return e.components[c]?.signals[m]
}

export function Schema2D({ twin, station }: {
  twin: TwinMap | null
  station: StationInfo
}) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const status = useTwin((s) => s.status)
  const health = useTwin((s) => s.health)
  const alarms = useTwin((s) => s.alarms)
  const alive = useTwin((s) => s.sourceAlive)
  const pb = useTwin((s) => s.playback)
  const dataStale = useTwin((s) => s.dataStale)
  const dataTs = useTwin((s) => s.dataTs)
  const [cfg, setCfg] = useState<StationCfg | null>(null)
  const sid = station.id

  useEffect(() => {
    let ok = true
    setCfg(null)
    fetchStationConfig(sid)
      .then((c) => { if (ok) setCfg(c) }).catch(() => {})
    return () => { ok = false }
  }, [sid])

  const groups = useMemo(() => {
    if (!cfg) return []
    const pumps = cfg.equipment.filter((e) => e.type === 'pump_hsc')
    return cfg.equipment.filter((e) => e.type === 'header').map((h) => ({
      header: h, pumps: pumps.filter((p) => p.header === h.id),
    }))
  }, [cfg])

  const n = (eq: string, key: string) => num(values, stale, `${sid}.${eq}.${key}`)
  const st = (eq: string) => status[`${sid}.${eq}`]?.state ?? 'UNKNOWN'
  const hl = (eq: string) => health[`${sid}.${eq}`] ?? health[eq]

  const pumps = groups.flatMap((g) => g.pumps)
  const running = pumps.filter((p) => st(p.id) === 'RUNNING').length
  const sum = (key: string, ids: string[]) =>
    ids.reduce((a, id) => a + (n(id, key) ?? 0), 0)
  const outflow = sum('flow_m3h', groups.map((g) => g.header.id))
  const nAlarm = alarms.filter((a) => a.level === 'ALARM').length
  const nWarn = alarms.length - nAlarm

  const kpis = [
    { c: 'blue', icon: '◉', t: `${sid} häzirki debi`, v: fmt(outflow, null, 1), u: 'm³/sag', s: 'Bekediň jemi' },
    { c: 'green', icon: '↘', t: 'Girýän akym', v: fmt(n('BASIN-01', 'inflow_m3h'), null, 1), u: 'm³/sag', s: 'Howza girýän suw' },
    { c: 'teal', icon: '≋', t: 'Howuz derejesi', v: fmt(n('BASIN-01', 'level_m'), null, 2), u: 'm',
      s: `Göwrümi ${fmt(n('BASIN-01', 'volume_m3'), 'm³', 0)}` },
    { c: 'purple', icon: '▶', t: 'Işleýän nasoslar', v: `${running} / ${pumps.length}`, u: '', s: 'Häzirki ýagdaý' },
    { c: 'orange', icon: 'ϟ', t: 'Jemi kuwwat', v: fmt(sum('power_kw', pumps.map((p) => p.id)), null, 1), u: 'kW',
      s: 'Nasoslaryň sarp edýän kuwwaty' },
    { c: alarms.length ? 'red' : 'green', icon: '!', t: 'Işjeň duýduryşlar', v: String(alarms.length), u: '',
      s: `${nAlarm} kritiki · ${nWarn} duýduryş` },
  ]

  const pill = pb.active ? { c: 'warn', t: 'TARYH' }
    : !alive ? { c: 'bad', t: 'MAGLUMAT ÝOK' }
    : dataStale ? { c: 'warn', t: `KÖNE MAGLUMAT${dataTs ? ' · ' + new Date(dataTs).toLocaleDateString('en-GB') : ''}` }
    : { c: 'ok', t: 'IŞJEŇ' }

  return (
    <div className="page2d">
      <div className="pageHead">
        <div>
          <div className="eyebrow">Suw göteriji beketler / {sid}</div>
          <h1>{sid} {station.name}</h1>
        </div>
        <span className={`pill ${pill.c}`}>● {pill.t}</span>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.t} className={`kpi ${k.c}`}>
            <div className="kpiTop"><span>{k.t}</span><i>{k.icon}</i></div>
            <div className="kpiVal"><b>{k.v}</b>{k.u && <small>{k.u}</small>}</div>
            <div className="kpiSub">{k.s}</div>
          </div>
        ))}
      </div>

      {!cfg && <div className="panel2d empty">beket maglumaty ýüklenýär…</div>}
      <div className="groups">
        {groups.map((g, gi) => {
          const hid = g.header.id
          const hflow = n(hid, 'flow_m3h')
          const pflow = sum('flow_m3h', g.pumps.map((p) => p.id))
          // Liniya neredeyse boşken yüzde anlamsız (gürültünün oranı) — gösterme
          const bal = hflow !== null && hflow > 50 ? ((hflow - pflow) / hflow) * 100 : null
          return (
            <section key={hid} className="panel2d grp">
              <div className="grpHead">
                <div>
                  <b>{ordinal(gi + 1)} topar ({g.pumps.length} nasos)</b>
                  <div className="sub2">{g.header.label} · rotasiýaly iş tertibi</div>
                </div>
                <span className={`mono ${bal === null || Math.abs(bal) < 3 ? 'good' : 'mid'}`}>
                  Σ nasos {pflow.toFixed(1)} · liniýa {(hflow ?? 0).toFixed(1)} · balans {bal === null ? '—' : `%${bal.toFixed(2)}`}
                </span>
              </div>
              <GroupSchema sid={sid} pumps={g.pumps} header={g.header}
                           flow={(id) => n(id, 'flow_m3h')} press={n(hid, 'press_bar')}
                           state={st} health={hl} />
              <LoadChart sid={sid} pumps={g.pumps} />
              <div className="tblTitle">
                <b>Nasoslaryň jemleýji tablisasy</b>
                <span className="sub2">dokun → 3D-de görkez</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nasos</th><th>Ýagdaýy</th>
                    {COLS.map((c) => <th key={c.key} className="num">{c.head}<small>{c.unit}</small></th>)}
                  </tr>
                </thead>
                <tbody>
                  {g.pumps.map((p, i) => {
                    const s = st(p.id)
                    return (
                      <tr key={p.id}>
                        <td><i className="dot" style={{ background: SERIES[i % SERIES.length] }} />
                          <b>{sid} {p.label}</b><div className="sub2">{p.id}</div></td>
                        <td><span className={`chip ${stateClass(s, hl(p.id))}`}>{STATE_TK[s] ?? s}</span></td>
                        {COLS.map((c) => {
                          const v = n(p.id, c.key)
                          const def = sigDef(twin, p.id, c.key)
                          const sev = def ? severity(v, def) : 'ok'
                          return <td key={c.key} className={`num ${sev === 'alarm' ? 'bad' : sev === 'warn' ? 'mid' : ''}`}>
                            {v === null ? '—' : fmt(v, null, c.digits)}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Jemi · {g.header.label}</td>
                    {COLS.map((c) => (
                      <td key={c.key} className="num">
                        {c.key === 'flow_m3h' ? fmt(pflow, null, 1)
                          : c.key === 'power_kw' ? fmt(sum('power_kw', g.pumps.map((p) => p.id)), null, 1) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// Grup şeması: nasos kutuları → nasos sembolleri → kollektör → esasy turba
// --------------------------------------------------------------------------- //

const ROW = 58

function GroupSchema({ sid, pumps, header, flow, press, state, health }: {
  sid: string
  pumps: EqCfg[]
  header: EqCfg
  flow: (id: string) => number | null
  press: number | null
  state: (id: string) => string
  health: (id: string) => string | undefined
}) {
  const H = Math.max(pumps.length * ROW + 24, 150)
  const ys = pumps.map((_, i) => 12 + ROW / 2 + i * ROW + (H - 24 - pumps.length * ROW) / 2)
  const ym = (ys[0] + ys[ys.length - 1]) / 2
  const hq = flow(header.id) ?? 0
  const live = hq > 1
  const CX = 318                         // kollektör ekseni

  return (
    <svg className="schema" viewBox={`0 0 680 ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* userSpaceOnUse: ok ucu çizgi kalınlığıyla büyümesin */}
        <marker id="ah" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12"
                refX="9" refY="6" orient="auto">
          <path d="M0,1 L11,6 L0,11 z" fill="#5b6b82" />
        </marker>
        <marker id="ahB" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16"
                refX="12" refY="8" orient="auto">
          <path d="M0,1 L15,8 L0,15 z" fill="#3b9cf6" />
        </marker>
      </defs>
      {/* kollektör */}
      <line x1={CX} y1={ys[0]} x2={CX} y2={ys[ys.length - 1]} className={`collector ${live ? 'on' : ''}`} />
      {pumps.map((p, i) => {
        const y = ys[i]
        const s = state(p.id)
        const cls = stateClass(s, health(p.id))
        const q = flow(p.id)
        return (
          <g key={p.id} className={`pumpRow ${cls}`}>
            <line x1={14} y1={y} x2={52} y2={y} className="feed" markerEnd="url(#ah)" />
            <rect x={58} y={y - 21} width={206} height={42} rx={6} className="box" />
            <text x={68} y={y - 5} className="name">{sid} {p.label}</text>
            <text x={256} y={y - 5} className="pid" textAnchor="end">{p.id}</text>
            <text x={68} y={y + 13} className="val">{q === null ? '—' : q.toFixed(1)} m³/sag</text>
            <line x1={264} y1={y} x2={CX - 14} y2={y} className="feed" />
            <circle cx={CX} cy={y} r={13} className="sym" />
            <path d={`M${CX - 4},${y - 6} L${CX + 7},${y} L${CX - 4},${y + 6} z`} className="symTri" />
          </g>
        )
      })}
      {/* kollektörden esasy turba kutusuna */}
      <line x1={CX + 6} y1={ym} x2={376} y2={ym} className={`trunk ${live ? 'on' : ''}`}
            markerEnd={live ? 'url(#ahB)' : 'url(#ah)'} />
      <rect x={384} y={ym - 25} width={226} height={50} rx={7} className={`mainBox ${live ? 'on' : ''}`} />
      <text x={396} y={ym - 6} className="name">{header.label}</text>
      <text x={396} y={ym + 14} className={`val ${live ? 'on' : ''}`}>
        {hq.toFixed(1)} m³/sag · {press === null ? '—' : press.toFixed(2)} bar
      </text>
      <line x1={610} y1={ym} x2={652} y2={ym} className={`trunk thin ${live ? 'on' : ''}`}
            markerEnd={live ? 'url(#ahB)' : 'url(#ah)'} />
    </svg>
  )
}

// --------------------------------------------------------------------------- //
// Ýük paýlanyşy: grubun pompalarının debisi, son 2 saat (sunucu kovalara indirger)
// --------------------------------------------------------------------------- //

type Bucket = [number, number, number, number]

function LoadChart({ sid, pumps }: { sid: string; pumps: EqCfg[] }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const historyEnabled = useTwin((s) => s.historyEnabled)
  const [data, setData] = useState<Record<string, Bucket[]> | null>(null)
  const tags = useMemo(() => pumps.map((p) => `${sid}.${p.id}.flow_m3h`), [sid, pumps])

  useEffect(() => {
    if (!historyEnabled) return
    let ok = true
    const load = () => {
      const q = tags.map((t) => `tag=${encodeURIComponent(t)}`).join('&')
      fetch(`/api/history?${q}&minutes=120&buckets=120`).then((r) => r.json())
        .then((j) => { if (ok) setData(j) }).catch(() => {})
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { ok = false; clearInterval(t) }
  }, [tags, historyEnabled])

  useEffect(() => {
    const c = cv.current
    if (!c) return
    const W = c.clientWidth, H = c.clientHeight
    c.width = W; c.height = H                         // DPR 1 — Pi 4 dolgu bütçesi
    const g = c.getContext('2d')!
    g.clearRect(0, 0, W, H)
    const series = tags.map((t) => data?.[t] ?? [])
    const all = series.flat()
    g.font = '10px ui-monospace, monospace'
    if (!all.length) {
      g.fillStyle = '#667085'
      g.fillText(historyEnabled ? 'taryhy maglumat ýok' : 'taryh öçürilen', 10, H / 2)
      return
    }
    const P = { l: 46, r: 8, t: 8, b: 18 }
    const x0 = Math.min(...all.map((b) => b[0])), x1 = Math.max(...all.map((b) => b[0]))
    let hi = Math.max(1, ...all.map((b) => b[1]))
    hi = Math.ceil(hi / 200) * 200
    const px = (t: number) => P.l + ((t - x0) / Math.max(x1 - x0, 1)) * (W - P.l - P.r)
    const py = (v: number) => P.t + (1 - v / hi) * (H - P.t - P.b)
    g.strokeStyle = '#232a38'; g.fillStyle = '#667085'; g.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const v = (hi * i) / 4, y = Math.round(py(v)) + 0.5
      g.beginPath(); g.moveTo(P.l, y); g.lineTo(W - P.r, y); g.stroke()
      g.fillText(v.toFixed(0), 4, y + 3)
    }
    series.forEach((s, i) => {
      if (!s.length) return
      g.strokeStyle = SERIES[i % SERIES.length]; g.lineWidth = 1.6; g.beginPath()
      s.forEach(([t, v], k) => (k ? g.lineTo(px(t), py(v)) : g.moveTo(px(t), py(v))))
      g.stroke()
    })
    const tf = (s: number) => new Date(s * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    g.fillStyle = '#667085'
    g.fillText(tf(x0), P.l, H - 4)
    const last = tf(x1)
    g.fillText(last, W - P.r - g.measureText(last).width, H - 4)
  }, [data, tags, historyEnabled])

  // Geçmiş yoksa (JACE'te API yok) boş bir grafik kutusu göstermenin anlamı yok
  if (!historyEnabled) return null

  return (
    <div className="chartBox">
      <div className="tblTitle">
        <b>Nasoslaryň ýük paýlanyşy</b>
        <span className="sub2">Soňky 2 sagat · ortaça suw akymy (m³/sag)</span>
      </div>
      <div className="legend">
        {pumps.map((p, i) => (
          <span key={p.id}><i style={{ background: SERIES[i % SERIES.length] }} />{sid} {p.label}</span>
        ))}
      </div>
      <canvas ref={cv} className="chart2d" />
    </div>
  )
}
