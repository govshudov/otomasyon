import { useEffect, useMemo, useState } from 'react'
import { useTwin } from '../data/store'
import { usePumpViews, useRecent } from '../data/usePumps'
import { LEVEL_EQ, fmtN, levelIdOf, levelSev, numOf, sigDef, thresholds, type Group, type StationCfg } from '../data/pump'
import { gecmisNokatlar, isNokatlary, loadEgriler, modelOf, tapawut, tapawutSev, type EgriDoc, type NormPoint } from '../data/egri'
import { queryHistory } from '../data/history'
import { CurveModal, type CurveRow, type Dowur } from './HeadCurve'
import { PumpCard } from './PumpCard'
import { FlowCircle, LevelTank, PowerGauge } from './Gauges'

/**
 * Umumy syn: her toplum bir sıra nasos kartı, altta beketiň çubuğu (her toplumun
 * ayrı kutusu: kuwwat, her çıkış borusunun akymy, jemi göwrümi, basyşy + howuzyň
 * suw derejesi, girýän akymy, göwrümi). Toplumlar ayrı sayfa değil — hepsi burada.
 * Nasos kartına tıklanınca o nasosun H–Q egrisi ve häzirki iş nokady açılır.
 */

export function PumpBoard({ sid, groups, cfg }: {
  sid: string
  groups: Group[]
  cfg: StationCfg | null
}) {
  const views = usePumpViews(sid, groups)
  const [curve, setCurve] = useState<string | null>(null)
  const pressTags = useMemo(() => groups.flatMap((g) => g.pumps.map((p) => `${sid}.${p.id}.discharge_press_bar`)), [sid, groups])
  const recent = useRecent(pressTags)

  return (
    <div className="board">
      <div className="boardScroll"><div className="grpWrap">
        {groups.map((g) => {
          const v = g.pumps.map((p) => views[p.id]).filter(Boolean)
          const run = v.filter((x) => x.running).length
          return (
            <section key={g.id} className="grpRow">
              <div className="grpTitle">
                <b>{g.name}</b><span>{g.header}</span>
                <span className="grpRun">{run} / {g.pumps.length} işleýär</span>
              </div>
              {/* Kartlar dikey, sabit genişlik; satıra sığmayan alt satıra geçer */}
              <div className="cards">
                {g.pumps.map((p) => views[p.id] && (
                  <PumpCard key={p.id} p={views[p.id]} ratedA={p.ratedA} onOpen={() => setCurve(p.id)}
                            press={recent[`${sid}.${p.id}.discharge_press_bar`]} />
                ))}
              </div>
            </section>
          )
        })}
      </div></div>
      <StationBar sid={sid} groups={groups} />
      {curve && <PumpCurve sid={sid} groups={groups} cfg={cfg} pumpId={curve} onClose={() => setCurve(null)} />}
    </div>
  )
}

/** Konfigürasyondan sayı (stations/<id>.json) */
const numParam = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Bir nasosun H–Q penceresi. Q toplumun akym ölçeginden (aynı modelde işleýän nasoslar
 * eşit böler) ya da nasosun kuwwatından; H basyşdan ve emme suyunun derejesinden.
 */
function PumpCurve({ sid, groups, cfg, pumpId, onClose }: {
  sid: string; groups: Group[]; cfg: StationCfg | null; pumpId: string; onClose: () => void
}) {
  const [doc, setDoc] = useState<EgriDoc | null>(null)
  useEffect(() => { loadEgriler().then(setDoc) }, [])
  const views = usePumpViews(sid, groups)
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const g = groups.find((x) => x.pumps.some((p) => p.id === pumpId))
  const [dowur, setDowur] = useState<Dowur>(1)
  const [cloud, setCloud] = useState<NormPoint[]>([])
  const raw = cfg as unknown as { hydraulics?: { basin?: { invert_el?: number } } } | null
  const invert = numParam(raw?.hydraulics?.basin?.invert_el) ?? 0
  const eqOf = (id: string) => cfg?.equipment.find((e) => e.id === id)

  // Geçmiş: seçilen dönemin kovalarından 50 Hz'e indirgenmiş iş nokatları
  useEffect(() => {
    if (!doc || !g) return
    let ok = true
    const tg = (eq: string, k: string) => `${sid}.${eq}.${k}`
    const pumps = g.pumps.map((p) => {
      const lt = levelIdOf(p.id)
      return {
        id: p.id, model: modelOf(doc, sid, p.id), axis: numParam(eqOf(p.id)?.params?.centerline_el_m),
        lvlTag: lt ? tg(lt, 'level_m') : null,
        press: tg(p.id, 'discharge_press_bar'), kw: tg(p.id, 'power_kw'), amp: tg(p.id, 'current_a'), hz: tg(p.id, 'vfd_freq_hz'),
      }
    })
    const flowTags = g.headers.map((h) => tg(h.id, 'flow_m3h'))
    const basinTag = tg(LEVEL_EQ, 'level_m')
    const tags = [...pumps.flatMap((p) => [p.press, p.kw, p.amp, p.hz, ...(p.lvlTag ? [p.lvlTag] : [])]), ...flowTags, basinTag]
    const to = Date.now() / 1000
    const n = dowur === 1 ? 288 : dowur === 7 ? 336 : 360
    queryHistory(tags, to - dowur * 86400, to, n)
      .then((r) => { if (ok) setCloud(gecmisNokatlar(doc, pumps, flowTags, basinTag, invert, r.data, pumpId)) })
      .catch(() => { if (ok) setCloud([]) })
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, g, sid, pumpId, dowur, invert])

  const v = views[pumpId]
  if (!g || !v) return null

  const n = (eq: string, k: string) => numOf(values, stale, `${sid}.${eq}.${k}`)
  const basinLvl = n(LEVEL_EQ, 'level_m')

  const inputs = g.pumps.map((p) => {
    const pv = views[p.id]
    const axis = numParam(eqOf(p.id)?.params?.centerline_el_m)
    const lvl = pv?.level ?? basinLvl
    return {
      id: p.id, model: modelOf(doc, sid, p.id), running: !!pv?.running, inverter: pv?.mode === 'inv',
      press: pv?.press ?? null, kw: pv?.kw ?? null, amp: pv?.amp ?? null, hz: pv?.hz ?? null,
      dz: axis !== null && lvl !== null ? axis - (invert + lvl) : null,
    }
  })
  const flows = g.headers.map((h) => n(h.id, 'flow_m3h'))
  const flow = flows.some((f) => f !== null) ? flows.reduce<number>((a, f) => a + (f ?? 0), 0) : null
  const pts = doc ? isNokatlary(doc, inputs, flow) : {}
  const pt = pts[pumpId] ?? null
  const me = inputs.find((i) => i.id === pumpId)!
  const m = me.model
  const runN = inputs.filter((i) => i.running).length
  const mixed = new Set(inputs.filter((i) => i.running).map((i) => i.model)).size > 1

  const rows: CurveRow[] = [
    { label: 'Akym Q', value: pt?.q != null ? `${fmtN(pt.q * 3600, 0)} m³/sag` : '—' },
    { label: 'Basyş beýikligi H', value: pt?.h != null ? `${fmtN(pt.h, 1)} m` : '—' },
    { label: 'Basyş', value: `${fmtN(v.press, 2)} bar` },
    { label: 'Kuwwat · Tok', value: `${fmtN(v.kw, 0)} kW · ${fmtN(v.amp, 1)} A` },
    { label: 'Ýygylyk', value: `${fmtN(v.hz, 1)} Hz` },
    { label: 'Suw derejesi', value: `${fmtN(v.level ?? basinLvl, 2)} m` },
  ]
  if (m) rows.push({ label: 'Taslama', value: `${fmtN(m.taslama.q * 3600, 0)} m³/sag · ${fmtN(m.taslama.h, 0)} m · η ${fmtN(m.taslama.eta, 1)} %` })
  // Zawod egrisinden tapawut: seçilen dönemin noktalarından (50 Hz'e indirgenmiş)
  const dev = m ? tapawut(m, cloud) : null
  const sev = tapawutSev(dev)
  if (m) rows.push({
    label: `Egriden tapawut (${dowur} gün)`,
    value: dev === null ? 'nokat az' : `${dev > 0 ? '+' : ''}${fmtN(dev, 1)} % · ${sev === 'ok' ? 'kadaly' : sev === 'warn' ? 'duýduryş' : 'näsazlyk'}`,
    cls: sev === 'ok' ? 'good' : sev === 'warn' ? 'mid' : sev === 'fault' ? 'bad' : undefined,
  })

  const note = !v.running ? 'Nasos durýar: iş nokady ýok.'
    : pt?.q == null ? 'Akym hasaplanyp bilmedi (akym ölçegi we kuwwat ýok).'
    : pt.qUsul === 'akym' ? `Akym: ${g.header} akym ölçeginden${runN > 1
        ? (mixed ? `, ${runN} işleýän nasosa kuwwatlaryna görä bölündi (dürli görnüşli nasoslar)` : `, ${runN} işleýän nasosa deň bölündi`) : ''}.`
    : 'Akym: nasosyň kuwwatyndan, zawod egrisi boýunça (takmynan).'
  const lvlNote = (v.running && pt?.dz == null ? ' Suw derejesi ýa-da nasos okunyň beýikligi ýok: H diňe basyşdan.' : '')
    + (cloud.length ? ` Geçmiş: ${cloud.length} nokat${cloud.some((c) => c.inv) ? ', inwertordakylar 50 Hz-e getirildi' : ''}.` : '')

  return (
    <CurveModal title={v.label} sub={m ? `${m.ad} · ${m.motor_kw} kW · ${m.rpm} aýl/min` : 'Egri ýok'}
                m={m} pt={pt} cloud={cloud} dev={dev} dowur={dowur} setDowur={setDowur}
                rows={rows} note={note + lvlNote} onClose={onClose} />
  )
}

export function StationBar({ sid, groups }: { sid: string; groups: Group[] }) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const twin = useTwin((s) => s.twinMap)
  const n = (eq: string, k: string) => numOf(values, stale, `${sid}.${eq}.${k}`)
  const lvl = n(LEVEL_EQ, 'level_m')
  const lsev = levelSev(sid, values, stale, twin)
  const ldef = sigDef(twin, LEVEL_EQ, 'level_m')
  const lmax = ldef?.range?.[1] ?? 7

  return (
    <div className="sbar">
      {groups.map((g) => {
        const kw = g.pumps.reduce((a, p) => a + (n(p.id, 'power_kw') ?? 0), 0)
        const kwMax = g.pumps.reduce((a, p) => a + p.motorKw, 0)
        const qMax = g.pumps.reduce((a, p) => a + p.ratedQ, 0)
        return (
          <div key={g.id} className="sbGroup" style={g.headers.length > 1 ? { flex: g.headers.length } : undefined}>
            <div className="sbHead"><b>{g.name}</b><span>{g.header}</span></div>
            <div className={`sbBody${g.headers.length > 1 ? ' multi' : ''}`}>
              <div className="sbCell">
                <div className="sbLab">Kuwwat sarp edişi</div>
                <PowerGauge value={kw} max={kwMax} unit="kW" />
              </div>
              {/* Her çıkış borusu ayrı: ortak hatlı toplumda (1 Maý) birden çok */}
              {g.headers.map((h) => (
                <div key={h.id} className="sbPipe">
                  <div className="sbCell">
                    <FlowCircle id={h.id} value={n(h.id, 'flow_m3h')} max={qMax} unit="m³/sag"
                                label={g.headers.length > 1 ? h.label : 'Akym'} />
                  </div>
                  <div className="sbCell stack">
                    <div className="sbLab">Jemi göwrüm</div>
                    <div className="sbVal">{fmtN(n(h.id, 'total_m3'), 0)}<small>m³</small></div>
                    <div className="sbLab">Basyş</div>
                    <div className="sbVal">{fmtN(n(h.id, 'press_bar'), 2)}<small>bar</small></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className="sbGroup level">
        <div className="sbHead"><b>Suw derejesi</b><span>Sorujy howuz</span></div>
        <div className="sbBody">
          <LevelTank value={lvl} max={lmax} sev={lsev}
                     marks={thresholds(ldef).map((t) => ({ v: t.value, level: t.level }))} />
          <div className="sbCell stack">
            <div className={`sbVal ${lsev === 'fault' ? 'bad' : lsev === 'warn' ? 'mid' : ''}`}>{fmtN(lvl, 2)}<small>m</small></div>
            <div className={`lvlState ${lsev}`}>{lsev === 'fault' ? 'Näsazlyk' : lsev === 'warn' ? 'Duýduryş' : 'Kadaly'}</div>
          </div>
          <div className="sbCell stack">
            <div className="sbLab">Girýän akym</div>
            <div className="sbVal">{fmtN(n(LEVEL_EQ, 'inflow_m3h'), 1)}<small>m³/sag</small></div>
            <div className="sbLab">Göwrümi</div>
            <div className="sbVal">{fmtN(n(LEVEL_EQ, 'volume_m3'), 0)}<small>m³</small></div>
          </div>
        </div>
      </div>
    </div>
  )
}
