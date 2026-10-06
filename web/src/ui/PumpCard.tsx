import type { Bucket } from '../data/history'
import { fmtDuration, fmtN, MODE_TK, OVERALL_TK, SEV_TK, nasosLabel, type PumpView, type Reading, type Sev } from '../data/pump'
import { ArcGauge, Sparkline } from './Gauges'
import { Icon } from './icons'

/**
 * Bir nasosun izleme kartı — dikey (uzun) düzen, yukarıdan aşağı:
 * başlık (NASOS n + durum), ýagdaýy | işlän wagty, duýduryş (tam genişlik),
 * temperatura (6 nasos + 2 podşipnik, grafiksiz), basyş + küçük grafik
 * (tam genişlik), ýygylyk göstergesi | tok · kuwwat.
 * Karta dokununca 8 grafik açılır.
 */

const sevCls = (s: Sev) => (s === 'fault' ? 'bad' : s === 'warn' ? 'mid' : 'good')

function TempCell({ r }: { r: Reading }) {
  return (
    <div className={`tc ${sevCls(r.sev)}`}>
      <span>{r.label}</span><b>{r.v === null ? '—' : r.v.toFixed(1)}</b>
    </div>
  )
}

export function PumpCard({ p, press, ratedA, onOpen }: {
  p: PumpView; press?: Bucket[]; ratedA: number; onOpen: () => void
}) {
  const hzActive = p.mode === 'inv' || p.mode === 'run'
  const ampF = p.amp === null ? 0 : Math.max(0, Math.min(1, p.amp / (ratedA * 1.2)))
  return (
    <div className={`pcard ${p.overall}`} onClick={onOpen} role="button" tabIndex={0} title="Grafikler"
         onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="pcHead">
        <span className={`pcName ${p.overall}`}>{nasosLabel(p.label)}</span>
        <span className={`pcState ${p.overall}`}>{OVERALL_TK[p.overall]}</span>
      </div>

      <div className="pcRow2">
        <div className="tile inl">
          <Icon.cabinet size={15} />
          <div className={`tBig mode ${p.mode}`}>{MODE_TK[p.mode]}</div>
        </div>
        <div className="tile inl">
          <Icon.timer size={15} />
          <div className="hrsBox">
            <div className="tMid">{fmtDuration(p.hours.total)}</div>
            <div className="hrs">
              <span>Inwertor <b>{fmtN(p.hours.inv, 0)}</b></span>
              <span>Pano <b>{fmtN(p.hours.pano, 0)}</b></span>
            </div>
          </div>
        </div>
      </div>

      <div className="tile warnRows">
        {([['Temperatura', p.warn.temp], ['Tok', p.warn.tok],
           [`Suw derejesi${p.level !== null ? ` · ${p.level.toFixed(2)} m` : ''}`, p.warn.level]] as [string, Sev][]).map(([l, s]) => (
          <div key={l} className={`wr ${s}`}><i />{l}<b>{SEV_TK[s]}</b></div>
        ))}
      </div>

      <div className="tile temps">
        <div className="tTop"><Icon.thermo size={14} /><span className="tTitle">Temperatura · °C</span></div>
        <div className="tg"><em>Nasos</em>{p.temps.map((r) => <TempCell key={r.key} r={r} />)}</div>
        <div className="tg"><em>Podşipnik</em>{p.bearings.map((r) => <TempCell key={r.key} r={r} />)}</div>
      </div>

      <div className="tile press">
        <div className="pv">
          <span className="tTitle"><Icon.gauge size={14} /> Basyş</span>
          <div><b>{fmtN(p.press, 2)}</b><small>bar</small></div>
        </div>
        <Sparkline data={press} min={0} />
      </div>

      <div className="pcRow2">
        <div className="tile gauge">
          <ArcGauge value={p.hz} max={50} unit="Hz" label="Ýygylyk" active={hzActive || p.mode === 'pano'}
                    note={p.hzGrid ? 'tor' : undefined} />
        </div>
        <div className="tile cons">
          <div className="tTop"><span className="tTitle">Tok · Kuwwat</span><Icon.bolt size={14} /></div>
          <div className="consBody">
            <div className="bar"><i style={{ height: `${ampF * 100}%` }} className={p.warn.tok} /></div>
            <div>
              <div className={`amp ${sevCls(p.warn.tok)}`}><b>{fmtN(p.amp, 1)}</b><small>A</small></div>
              <div className="kw"><b>{fmtN(p.kw, 1)}</b><small>kW</small></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
