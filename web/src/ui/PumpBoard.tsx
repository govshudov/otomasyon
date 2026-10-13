import { useMemo } from 'react'
import { useTwin } from '../data/store'
import { usePumpViews, useRecent } from '../data/usePumps'
import { LEVEL_EQ, fmtN, levelSev, numOf, sigDef, thresholds, type Group } from '../data/pump'
import { PumpCard } from './PumpCard'
import { FlowCircle, LevelTank, PowerGauge } from './Gauges'

/**
 * Umumy syn: her toplum bir sıra nasos kartı, altta beketiň çubuğu (her toplumun
 * ayrı kutusu: kuwwat, her çıkış borusunun akymy, jemi göwrümi, basyşy + howuzyň
 * suw derejesi, girýän akymy, göwrümi). Toplumlar ayrı sayfa değil — hepsi burada.
 */

export function PumpBoard({ sid, groups }: {
  sid: string
  groups: Group[]
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
              {/* Kartlar dikey, sabit genişlik; satıra sığmayan alt satıra geçer */}
              <div className="cards">
                {g.pumps.map((p) => views[p.id] && (
                  <PumpCard key={p.id} p={views[p.id]} ratedA={p.ratedA}
                            press={recent[`${sid}.${p.id}.discharge_press_bar`]} />
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
