import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTwin, type Alarm } from '../data/store'
import { queryHistory, type Bucket } from '../data/history'
import { usePumpViews } from '../data/usePumps'
import { LEVEL_EQ, MODE_TK, OVERALL_TK, fmtN, numOf, sigDef, thresholds, type Group } from '../data/pump'
import { ChartBoard, type ChartSpec } from './ChartBoard'
import { PointExplorer } from './PointExplorer'
import { DbReportTables, dbReportCsvRows, useDbReport } from './DbReport'
import { PumpChartBoard, combine } from './PumpCharts'
import { fmtDateTime } from './Chart'
import { Icon } from './icons'

/** Duýduryşlar, Hasabatlar, Grafikler sayfaları. */

const ST_TK: Record<string, string> = {
  UNACK_ALM: 'Tassyklanmadyk', ACKED_ALM: 'Tassyklandy', RTN_UNACK: 'Kadalaşdy · tassyklanmadyk', NORM: 'Kadalaşdy',
}
const LVL_TK: Record<string, string> = { ALARM: 'Näsazlyk', WARN: 'Duýduryş' }
const tsS = (ms: number) => (ms ? fmtDateTime(ms / 1000) + ':' + String(new Date(ms).getSeconds()).padStart(2, '0') : '—')
const valS = (v: Alarm['value']) => (v === null || v === undefined ? '—' : typeof v === 'number' ? fmtN(v, 1) : v ? 'BAR' : 'ÝOK')

function csvDownload(name: string, rows: (string | number)[][]) {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`
  const a = document.createElement('a')
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n'))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}

// --------------------------------------------------------------------------- //

export function AlarmsPage() {
  const alarms = useTwin((s) => s.alarms)
  const log = useTwin((s) => s.alarmLog)
  const twin = useTwin((s) => s.twinMap)
  const ack = useTwin((s) => s.ack)
  const ackAll = useTwin((s) => s.ackAll)
  const unack = alarms.filter((a) => a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK').length
  const eqName = (id: string) => twin?.equipment[id]?.label ?? id

  return (
    <div className="page">
      <div className="pageBar">
        <h2>Işjeň duýduryşlar <b className={alarms.length ? 'bad' : ''}>{alarms.length}</b></h2>
        <div className="spacer" />
        <button disabled={!unack} onClick={ackAll}>Hemmesini tassykla ({unack})</button>
      </div>
      <table className="dtbl">
        <thead><tr><th>Dereje</th><th>Enjam</th><th>Habar</th><th className="num">Bahasy</th><th>Döredi</th><th>Ýagdaýy</th><th /></tr></thead>
        <tbody>
          {alarms.length === 0 && <tr><td colSpan={7} className="emptyRow">Işjeň duýduryş ýok.</td></tr>}
          {alarms.map((a) => (
            <tr key={a.id} className={`${a.level.toLowerCase()}${a.state === 'UNACK_ALM' ? ' unack' : ''}`}>
              <td><span className={`lvl ${a.level.toLowerCase()}`}>{LVL_TK[a.level]}</span></td>
              <td><b>{eqName(a.equipment)}</b></td>
              <td>{a.msg}</td>
              <td className="num">{valS(a.value)}</td>
              <td className="mono">{tsS(a.ts_raised)}</td>
              <td>{ST_TK[a.state] ?? a.state}</td>
              <td>{(a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK') &&
                <button className="small" onClick={() => ack(a.id)}>Tassykla</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pageBar"><h2>Žurnal <small>bu sessiýada</small></h2></div>
      <table className="dtbl">
        <thead><tr><th>Wagt</th><th>Dereje</th><th>Enjam</th><th>Habar</th><th>Ýagdaýy</th></tr></thead>
        <tbody>
          {log.length === 0 && <tr><td colSpan={5} className="emptyRow">Ýazgy ýok.</td></tr>}
          {log.slice(0, 120).map((a, i) => (
            <tr key={i}>
              <td className="mono">{tsS(a.ts)}</td>
              <td><span className={`lvl ${a.level.toLowerCase()}`}>{LVL_TK[a.level]}</span></td>
              <td>{eqName(a.equipment)}</td>
              <td>{a.msg}</td>
              <td>{ST_TK[a.state] ?? a.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --------------------------------------------------------------------------- //

const PERIODS = [
  { k: 'today', t: 'Şu gün' },
  { k: 'd1', t: 'Soňky 24 sag', s: 86400 },
  { k: 'd7', t: 'Soňky 7 gün', s: 7 * 86400 },
  { k: 'd30', t: 'Soňky 30 gün', s: 30 * 86400 },
]

function periodFrom(k: string): number {
  if (k === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000 }
  return Date.now() / 1000 - (PERIODS.find((p) => p.k === k)?.s ?? 86400)
}

/** Sayacın dönemdeki artışı: ilk ve son kovanın farkı (veri yoksa null). */
function delta(b: Bucket[] | undefined): number | null {
  if (!b || b.length < 2) return null
  return Math.max(0, b[b.length - 1][1] - b[0][1])
}

export function ReportsPage({ sid, groups }: { sid: string; groups: Group[] }) {
  const views = usePumpViews(sid, groups)
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const [period, setPeriod] = useState('today')
  const [hist, setHist] = useState<Record<string, Bucket[]>>({})
  const n = (eq: string, k: string) => numOf(values, stale, `${sid}.${eq}.${k}`)

  const tags = useMemo(() => [
    ...groups.flatMap((g) => g.pumps.flatMap((p) => [`${sid}.${p.id}.hours_inv`, `${sid}.${p.id}.hours_pano`])),
    ...groups.flatMap((g) => g.headers.map((h) => `${sid}.${h.id}.total_m3`)),
  ], [sid, groups])

  useEffect(() => {
    let ok = true
    const from = periodFrom(period), to = Date.now() / 1000
    queryHistory(tags, from, to, 96).then((r) => { if (ok) setHist(r.data) }).catch(() => {})
    return () => { ok = false }
  }, [tags, period])

  // Ähli enjamlar (veritabanından, gruplu): dönem değişince yeniden hesaplanır
  const range = useMemo(() => ({ from: periodFrom(period), to: Date.now() / 1000 }), [period])
  const db = useDbReport(range.from, range.to)

  const d = (eq: string, k: string) => delta(hist[`${sid}.${eq}.${k}`])
  const exportCsv = () => {
    const rows: (string | number)[][] = [['Toplum', 'Nasos', 'Ýagdaýy', 'Inwertor sag', 'Transformator sag', 'Jemi sag',
      'Inwertorda döwürde sag', 'Transformatorda döwürde sag', 'Tok A', 'Kuwwat kW', 'Basyş bar']]
    for (const g of groups) for (const p of g.pumps) {
      const v = views[p.id]
      if (!v) continue
      rows.push([g.name, p.label, MODE_TK[v.mode], fmtN(v.hours.inv, 1), fmtN(v.hours.pano, 1), fmtN(v.hours.total, 1),
        fmtN(d(p.id, 'hours_inv'), 2), fmtN(d(p.id, 'hours_pano'), 2), fmtN(v.amp, 1), fmtN(v.kw, 1), fmtN(v.press, 2)])
    }
    rows.push([])
    rows.push(['Toplum', 'Esasy turba', 'Akym m³/sag', 'Jemi göwrüm m³', 'Döwürde geçen suw m³', 'Kuwwat kW'])
    // Her çıkış borusu bir satır; kuwwat toplumun (nasoslar ortak) — yalnız ilk satırda
    for (const g of groups) g.headers.forEach((h, i) => {
      rows.push([g.name, h.label, fmtN(n(h.id, 'flow_m3h'), 1), fmtN(n(h.id, 'total_m3'), 0), fmtN(d(h.id, 'total_m3'), 0),
        i === 0 ? fmtN(g.pumps.reduce((a, p) => a + (views[p.id]?.kw ?? 0), 0), 1) : ''])
    })
    rows.push(...dbReportCsvRows(db))
    csvDownload(`${sid}_hasabat_${fmtDateTime(Date.now() / 1000).replace(/[/: ]/g, '')}.csv`, rows)
  }

  return (
    <div className="page">
      <div className="pageBar">
        <h2>Hasabat</h2>
        <div className="seg small">
          {PERIODS.map((p) => <button key={p.k} className={period === p.k ? 'on' : ''} onClick={() => setPeriod(p.k)}>{p.t}</button>)}
        </div>
        <span className="sub">{fmtDateTime(periodFrom(period))} → häzir</span>
        <div className="spacer" />
        <button onClick={exportCsv}><Icon.save size={15} /> CSV ýükle</button>
      </div>

      <table className="dtbl">
        <thead>
          <tr><th>Toplum</th><th>Nasos</th><th>Ýagdaýy</th>
            <th className="num">Inwertor<small>jemi sag</small></th><th className="num">Transformator<small>jemi sag</small></th>
            <th className="num">Jemi<small>sag</small></th>
            <th className="num">Inwertorda<small>döwürde sag</small></th><th className="num">Transformatorda<small>döwürde sag</small></th>
            <th className="num">Tok<small>A</small></th><th className="num">Kuwwat<small>kW</small></th><th className="num">Basyş<small>bar</small></th></tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => g.pumps.map((p) => {
            const v = views[p.id]
            if (!v) return null
            return (
              <tr key={p.id}>
                <td>{g.name}</td><td><b>{p.label}</b></td>
                <td><span className={`chip ${v.overall}`}>{v.running ? MODE_TK[v.mode] : OVERALL_TK[v.overall]}</span></td>
                <td className="num">{fmtN(v.hours.inv, 1)}</td><td className="num">{fmtN(v.hours.pano, 1)}</td>
                <td className="num"><b>{fmtN(v.hours.total, 1)}</b></td>
                <td className="num">{fmtN(d(p.id, 'hours_inv'), 2)}</td><td className="num">{fmtN(d(p.id, 'hours_pano'), 2)}</td>
                <td className="num">{fmtN(v.amp, 1)}</td><td className="num">{fmtN(v.kw, 1)}</td><td className="num">{fmtN(v.press, 2)}</td>
              </tr>
            )
          }))}
        </tbody>
      </table>

      <table className="dtbl">
        <thead>
          <tr><th>Toplum</th><th>Esasy turba</th><th className="num">Akym<small>m³/sag</small></th>
            <th className="num">Jemi göwrüm<small>m³ (sanag)</small></th><th className="num">Döwürde geçen suw<small>m³</small></th>
            <th className="num">Kuwwat<small>kW</small></th><th className="num">Basyş<small>bar</small></th></tr>
        </thead>
        <tbody>
          {/* Her çıkış borusu bir satır; ortak hatlı toplumda kuwwat (nasoslar ortak) ilk satırda */}
          {groups.flatMap((g) => g.headers.map((h, i) => (
            <tr key={h.id}>
              <td>{i === 0 && <b>{g.name}</b>}</td><td>{h.label}</td>
              <td className="num">{fmtN(n(h.id, 'flow_m3h'), 1)}</td>
              <td className="num">{fmtN(n(h.id, 'total_m3'), 0)}</td>
              <td className="num"><b>{fmtN(d(h.id, 'total_m3'), 0)}</b></td>
              <td className="num">{i === 0 ? fmtN(g.pumps.reduce((a, p) => a + (views[p.id]?.kw ?? 0), 0), 1) : ''}</td>
              <td className="num">{fmtN(n(h.id, 'press_bar'), 2)}</td>
            </tr>
          )))}
        </tbody>
      </table>
      <DbReportTables data={db} />

      <p className="note">“Döwürde” sütunlary taryhy maglumatdan hasaplanýar (sanagyň döwrüň başy bilen soňunyň tapawudy).
        Taryh ýok bolsa “—” görkezilýär.</p>
    </div>
  )
}

// --------------------------------------------------------------------------- //

const GROUP_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#22d3ee', '#a3e635']

export function ChartsPage({ sid, groups }: { sid: string; groups: Group[] }) {
  const twin = useTwin((s) => s.twinMap)
  const tags = useMemo(() => [
    ...groups.flatMap((g) => [
      ...g.headers.flatMap((h) => [`${sid}.${h.id}.flow_m3h`, `${sid}.${h.id}.press_bar`, `${sid}.${h.id}.total_m3`]),
      ...g.pumps.map((p) => `${sid}.${p.id}.power_kw`)]),
    `${sid}.${LEVEL_EQ}.level_m`,
  ], [sid, groups])

  const build = useCallback((d: Record<string, Bucket[]>): ChartSpec[] => {
    // Boru başına bir çizgi; tek borulu toplumda adı toplumun adı (eskisi gibi)
    const pipes = groups.flatMap((g) => g.headers.map((h) => ({ h, label: g.headers.length > 1 ? `${g.name} · ${h.label}` : g.name })))
    const per = (k: string) => pipes.map((x, i) => ({ label: x.label, color: GROUP_COLORS[i % GROUP_COLORS.length], data: d[`${sid}.${x.h.id}.${k}`] ?? [] }))
    const power = groups.map((g, i) => ({
      label: g.name, color: GROUP_COLORS[i % GROUP_COLORS.length],
      data: combine(g.pumps.map((p) => d[`${sid}.${p.id}.power_kw`]),
        (rows) => rows.every((r) => !r) ? null : rows.reduce((a, r) => a + (r?.[1] ?? 0), 0)),
    }))
    return [
      { key: 'flow', title: 'Akym', unit: 'm³/sag', digits: 1, yMin: 0, series: per('flow_m3h') },
      { key: 'power', title: 'Kuwwat sarp edişi', unit: 'kW', digits: 1, yMin: 0, series: power },
      { key: 'total', title: 'Jemi göwrüm (sanag)', unit: 'm³', digits: 0, fill: false, series: per('total_m3') },
      { key: 'press', title: 'Esasy turbanyň basyşy', unit: 'bar', digits: 2, yMin: 0, series: per('press_bar') },
      {
        key: 'level', title: 'Suw derejesi', unit: 'm', digits: 2, stats: true,
        thresholds: thresholds(sigDef(twin, LEVEL_EQ, 'level_m')),
        series: [{ label: 'Suw derejesi', color: '#38bdf8', data: d[`${sid}.${LEVEL_EQ}.level_m`] ?? [] }],
      },
    ]
  }, [sid, groups, twin])

  // Görünüm: beket, bir nasos (id) ya da ähli nokatlar. Nasosyň 8 grafigine yalnız buradan gidilir.
  const pumps = useMemo(() => groups.flatMap((g) => g.pumps), [groups])
  const [mode, setModeRaw] = useState<string>(() => {
    try { return localStorage.getItem('twin.charts.mode') ?? 'beket' } catch { return 'beket' }
  })
  const setMode = (m: string) => {
    setModeRaw(m)
    try { localStorage.setItem('twin.charts.mode', m) } catch { /* depolama kapalı */ }
  }
  const pump = pumps.find((p) => p.id === mode)
  const shown = mode === 'nokat' || pump ? mode : 'beket'     // saklanan nasos bu istasyonda yoksa beket

  return (
    <div className="page full">
      <div className="pumpPick">
        <div className="seg">
          <button className={shown === 'beket' ? 'on' : ''} onClick={() => setMode('beket')}>Beket</button>
          {pumps.map((p) => (
            <button key={p.id} className={shown === p.id ? 'on' : ''} onClick={() => setMode(p.id)}>{p.label}</button>
          ))}
          <button className={shown === 'nokat' ? 'on' : ''} onClick={() => setMode('nokat')}>Ähli nokatlar</button>
        </div>
      </div>
      {shown === 'beket' && <ChartBoard title="Beket" tags={tags} build={build} fileName={`${sid}_beket`} />}
      {pump && <PumpChartBoard key={pump.id} sid={sid} id={pump.id} label={pump.label} />}
      {shown === 'nokat' && <PointExplorer sid={sid} />}
    </div>
  )
}
