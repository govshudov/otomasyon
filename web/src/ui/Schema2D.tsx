import { useEffect, useMemo, useState } from 'react'
import { fmt, readTag, useTwin, type Sample } from '../data/store'
import type { SignalDef, TwinMap } from '../scene/types'
import type { StationInfo } from './StationPicker'
import { severity } from './InfoCard'
import { fetchStationConfig } from '../data/niagara'
import { beketAdy, ordinal } from './labels'
import { MODE_TK, OVERALL_TK, levelSev, pumpView, toplumlarOf, type Overall, type PumpView } from '../data/pump'
import { queryHistory, type Bucket } from '../data/history'
import { Chart } from './Chart'

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

/** Pompa tablosunun sütunları. `get` verilmişse değer pompa görünümünden hesaplanır. */
const COLS: { key: string; head: string; unit: string; digits: number; get?: (p: PumpView) => number | null }[] = [
  { key: 'discharge_press_bar', head: 'Basyş', unit: 'bar', digits: 2 },
  { key: 'vfd_freq_hz', head: 'Ýygylyk', unit: 'Hz', digits: 1 },
  { key: 'current_a', head: 'Tok', unit: 'A', digits: 0 },
  { key: 'power_kw', head: 'Kuwwat', unit: 'kW', digits: 1 },
  { key: 'MOTOR.t1', head: 'Nasos t.', unit: '°C maks', digits: 1, get: (p) => maxOf(p.temps.map((r) => r.v)) },
  { key: 'PUMP.bearing1', head: 'Podş. t.', unit: '°C maks', digits: 1, get: (p) => maxOf(p.bearings.map((r) => r.v)) },
  { key: 'hours', head: 'Işlän', unit: 'sag', digits: 0, get: (p) => p.hours.total },
]

function maxOf(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? Math.max(...v) : null
}

/** Pompa görünümü → eski şema sınıfları (yeşil/gri/sarı/kırmızı) */
const CLS: Record<Overall, string> = { run: 'running', stop: 'stopped', warn: 'warn', fault: 'alarm', unknown: 'unknown' }

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

  // Toplum = birbirine bağlı nasoslar + borular (pump.ts toplumlarOf). Ortak hatlı toplumda
  // (1 Maý: N-1…N-7 → T-1/T-2/T-3) şema tek boru çizer: adı boruların adları, akım toplamı.
  const groups = useMemo(() => {
    if (!cfg) return []
    return toplumlarOf(cfg.equipment).map((t) => ({
      headers: t.headers,
      // ortak boru kutusunda kısa ad: "T-1 · T-2 · T-3 esasy turba"
      header: t.headers.length > 1
        ? { ...t.headers[0], label: t.headers.map((h) => (h.label ?? h.id).split(' ')[0]).join(' · ') + ' esasy turba' }
        : t.headers[0],
      pumps: t.pumps,
    }))
  }, [cfg])

  const n = (eq: string, key: string) => num(values, stale, `${sid}.${eq}.${key}`)

  const pumps = groups.flatMap((g) => g.pumps)
  const lvl = levelSev(sid, values, stale, twin)
  const views: Record<string, PumpView> = {}
  for (const p of pumps) views[p.id] = pumpView(sid, { id: p.id, label: p.label ?? p.id }, values, stale, twin, status[`${sid}.${p.id}`]?.state, lvl)
  const cls = (id: string) => CLS[views[id]?.overall ?? 'unknown']
  const running = pumps.filter((p) => views[p.id]?.running).length
  const sum = (key: string, ids: string[]) =>
    ids.reduce((a, id) => a + (n(id, key) ?? 0), 0)
  const outflow = sum('flow_m3h', groups.flatMap((g) => g.headers.map((h) => h.id)))
  const nAlarm = alarms.filter((a) => a.level === 'ALARM').length
  const nWarn = alarms.length - nAlarm

  const kpis = [
    { c: 'blue', icon: '◉', t: 'Häzirki akym', v: fmt(outflow, null, 1), u: 'm³/sag', s: 'Bekediň jemi' },
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
          <div className="eyebrow">{beketAdy(sid)}</div>
          <h1>{station.name}</h1>
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
          const multi = g.headers.length > 1
          const hflow = multi ? sum('flow_m3h', g.headers.map((h) => h.id)) : n(hid, 'flow_m3h')
          const gkw = sum('power_kw', g.pumps.map((p) => p.id))
          return (
            <section key={hid} className="panel2d grp">
              <div className="grpHead">
                <div>
                  <b>{ordinal(gi + 1)} toplum ({g.pumps.length} nasos)</b>
                  <div className="sub2">{g.header.label} · {multi ? 'umumy kollektor' : 'rotasiýaly iş tertibi'}</div>
                  {multi && g.headers.map((h) => (
                    <div key={h.id} className="sub2 mono">
                      {h.label ?? h.id}: {fmt(n(h.id, 'flow_m3h'), null, 1)} m³/sag · {fmt(n(h.id, 'press_bar'), null, 2)} bar
                    </div>
                  ))}
                </div>
                <span className="mono good">
                  akym {fmt(hflow, null, 1)} m³/sag{multi ? '' : ` · ${fmt(n(hid, 'press_bar'), null, 2)} bar`} · {gkw.toFixed(1)} kW
                </span>
              </div>
              <GroupSchema pumps={g.pumps} header={g.header}
                           headerFlow={hflow} press={multi ? null : n(hid, 'press_bar')}
                           info={(id) => {
                             const v = views[id]
                             return v ? `${MODE_TK[v.mode]} · ${v.press === null ? '—' : v.press.toFixed(2)} bar` : '—'
                           }}
                           cls={cls} />
              <LoadChart sid={sid} pumps={g.pumps} />
              <div className="tblTitle">
                <b>Nasoslaryň jemleýji tablisasy</b>
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
                    const pv = views[p.id]
                    return (
                      <tr key={p.id}>
                        <td><i className="dot" style={{ background: SERIES[i % SERIES.length] }} />
                          <b>{p.label ?? p.id}</b><div className="sub2">{p.id}</div></td>
                        <td><span className={`chip ${cls(p.id)}`}>
                          {pv?.running ? MODE_TK[pv.mode] : OVERALL_TK[pv?.overall ?? 'unknown']}</span></td>
                        {COLS.map((c) => {
                          const v = c.get && pv ? c.get(pv) : n(p.id, c.key)
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
                        {c.key === 'power_kw' ? fmt(gkw, null, 1) : ''}
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

function GroupSchema({ pumps, header, headerFlow, press, info, cls: clsOf }: {
  pumps: EqCfg[]
  header: EqCfg
  headerFlow: number | null
  press: number | null
  info: (id: string) => string
  cls: (id: string) => string
}) {
  const H = Math.max(pumps.length * ROW + 24, 150)
  const ys = pumps.map((_, i) => 12 + ROW / 2 + i * ROW + (H - 24 - pumps.length * ROW) / 2)
  const ym = (ys[0] + ys[ys.length - 1]) / 2
  const hq = headerFlow ?? 0
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
        const cls = clsOf(p.id)
        return (
          <g key={p.id} className={`pumpRow ${cls}`}>
            <line x1={14} y1={y} x2={52} y2={y} className="feed" markerEnd="url(#ah)" />
            <rect x={58} y={y - 21} width={206} height={42} rx={6} className="box" />
            <text x={68} y={y - 5} className="name">{p.label ?? p.id}</text>
            <text x={256} y={y - 5} className="pid" textAnchor="end">{p.id}</text>
            <text x={68} y={y + 13} className="val">{info(p.id)}</text>
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
// Ýük paýlanyşy: toplumun nasoslarının kuwwaty, son 2 saat
// (geçmiş kaynağı ortak: API / Niagara taryhy / sahypa açylandan bäri)
// --------------------------------------------------------------------------- //

function LoadChart({ sid, pumps }: { sid: string; pumps: EqCfg[] }) {
  const [data, setData] = useState<Record<string, Bucket[]>>({})
  const [range, setRange] = useState(() => { const to = Date.now() / 1000; return { from: to - 7200, to } })
  const tags = useMemo(() => pumps.map((p) => `${sid}.${p.id}.power_kw`), [sid, pumps])

  useEffect(() => {
    let ok = true
    const load = () => {
      const to = Date.now() / 1000, from = to - 7200
      queryHistory(tags, from, to, 120).then((r) => { if (ok) { setData(r.data); setRange({ from, to }) } }).catch(() => {})
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { ok = false; clearInterval(t) }
  }, [tags])

  const series = pumps.map((p, i) => ({ label: p.label ?? p.id, color: SERIES[i % SERIES.length], data: data[tags[i]] ?? [] }))
  return (
    <div className="chartBox">
      <div className="tblTitle">
        <b>Nasoslaryň ýük paýlanyşy</b>
        <span className="sub2">Soňky 2 sagat · kuwwat (kW)</span>
      </div>
      <div className="chart2d"><Chart series={series} from={range.from} to={range.to} unit="kW" digits={1} yMin={0} compact /></div>
    </div>
  )
}