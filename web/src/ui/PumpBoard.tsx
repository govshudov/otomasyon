import { useMemo } from 'react'
import { useTwin } from '../data/store'
import { usePumpViews, useRecent } from '../data/usePumps'
import { LEVEL_EQ, fmtN, levelSev, numOf, sigDef, thresholds, type Group } from '../data/pump'
import { PumpCard } from './PumpCard'
import { FlowCircle, LevelTank, PowerGauge } from './Gauges'

/**
 * Umumy syn / Toplum sayfası: her toplum bir sıra nasos kartı, altta
 * beketiň çubuğu (her çıkış borusunun kuwwaty, akymy, jemi göwrümi,
 * basyşy + howuzyň suw derejesi).
 */

export function PumpBoard({ sid, groups, onOpen }: {
  sid: string
  groups: Group[]
  onOpen: (pumpId: string, label: string) => void
}) {
  const views = usePumpViews(sid, groups)
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
              {/* Kartlar dikey: genişlik sınırlı, boy içeriğe göre uzar */}
              <div className="cards" style={{ gridTemplateColumns: `repeat(${Math.max(g.pumps.length, 1)}, minmax(220px, 360px))` }}>
                {g.pumps.map((p) => views[p.id] && (
                  <PumpCard key={p.id} p={views[p.id]} ratedA={p.ratedA}
                            press={recent[`${sid}.${p.id}.discharge_press_bar`]}
                            onOpen={() => onOpen(p.id, p.label)} />
                ))}
              </div>
            </section>
          )
        })}
      </div></div>
      <StationBar sid={sid} groups={groups} />
    </div>
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
          <div key={g.id} className="sbGroup">
            <div className="sbHead"><b>{g.name}</b><span>{g.header}</span></div>
            <div className="sbBody">
              <div className="sbCell">
                <div className="sbLab">Kuwwat sarp edişi</div>
                <PowerGauge value={kw} max={kwMax} unit="kW" />
              </div>
              <div className="sbCell">
                <FlowCircle id={g.id} value={n(g.id, 'flow_m3h')} max={qMax} unit="m³/sag" label="Akym" />
              </div>
              <div className="sbCell stack">
                <div className="sbLab">Jemi göwrüm</div>
                <div className="sbVal">{fmtN(n(g.id, 'total_m3'), 0)}<small>m³</small></div>
                <div className="sbLab">Basyş</div>
                <div className="sbVal">{fmtN(n(g.id, 'press_bar'), 2)}<small>bar</small></div>
              </div>
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
        </div>
      </div>
    </div>
  )
}
