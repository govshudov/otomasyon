import { useState } from 'react'
import { fmt, readTag, useTwin } from '../data/store'
import { Trend } from './Trend'
import { STATE_TK, stateClass } from './labels'
import type { EquipmentDef, SignalDef } from '../scene/types'
import { MODE_TK, OVERALL_TK, SEV_TK, fmtDuration, fmtN, levelSev, pumpView, type Sev } from '../data/pump'
import { Icon } from './icons'

/**
 * Seçili ekipmanın 3D'de ÜSTÜNDE duran bilgi kartı.
 *
 * Kartın ekran konumu React'te değil, sahnenin render döngüsünde güncellenir
 * (`TwinScene.setCard`): her karede ekipmanın 3D bağlantı noktası ekrana
 * izdüşürülüp `transform` yazılır. Böylece sahne döndürülürken kart pompanın
 * üstünde kalır ve Pi'de kare başına React uzlaştırması çalışmaz.
 *
 * Nasos için izleme panosundaki kartın özeti gösterilir (ýagdaýy, üç
 * duýduryş, 8 temperatura, basyş/Hz/tok/kuwwat, işlän wagty) ve
 * "Grafikler" 8 grafiği açar. Diğer ekipmanda twin-map'teki sinyal listesi.
 */

/** Durumu isteğe bağlı ekipman tipleri — durum gelmiyorsa kartta rozet gösterilmez. */
const STATELESS = new Set(['level_sensor'])

export function severity(v: number | boolean | null, sig: SignalDef): 'ok' | 'warn' | 'alarm' {
  if (v === null) return 'ok'
  let worst: 'ok' | 'warn' | 'alarm' = 'ok'
  for (const a of sig.alarms ?? []) {
    let hit = false
    if (typeof a.value === 'boolean') hit = v === a.value
    else if (typeof v === 'number') {
      hit = a.op === '>' ? v > a.value : a.op === '<' ? v < a.value
        : a.op === '>=' ? v >= a.value : a.op === '<=' ? v <= a.value : false
    }
    if (hit) worst = a.level === 'ALARM' ? 'alarm' : worst === 'alarm' ? 'alarm' : 'warn'
  }
  return worst
}

/** Ekipmanın tüm sinyalleri: önce ekipman seviyesi, sonra bileşenlerinkiler. */
export function allSignals(eq: EquipmentDef): SignalDef[] {
  const out = Object.values(eq.signals)
  for (const c of Object.values(eq.components)) out.push(...Object.values(c.signals))
  return out
}

const sevCls = (s: Sev) => (s === 'fault' ? 'bad' : s === 'warn' ? 'mid' : 'good')

function PumpSummary({ station, id, label }: { station: string; id: string; label: string }) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const status = useTwin((s) => s.status)
  const twin = useTwin((s) => s.twinMap)
  const p = pumpView(station, { id, label }, values, stale, twin, status[`${station}.${id}`]?.state,
    levelSev(station, values, stale, twin))
  return (
    <>
      <div className="miniMode">
        <span className={`mode ${p.mode}`}>{MODE_TK[p.mode]}</span>
        <span className="sub">{fmtDuration(p.hours.total)}</span>
      </div>
      <div className="miniWarn">
        {([['Temp.', p.warn.temp], ['Tok', p.warn.tok], ['Suw', p.warn.level]] as [string, Sev][]).map(([l, s]) => (
          <span key={l} className={`wr ${s}`} title={SEV_TK[s]}><i />{l}</span>
        ))}
      </div>
      <div className="miniTemps">
        {[...p.temps, ...p.bearings].map((r) => (
          <span key={r.key} className={sevCls(r.sev)}><em>{r.label}</em>{r.v === null ? '—' : r.v.toFixed(0)}</span>
        ))}
      </div>
      <div className="kv">
        <div className="row"><span>Basyş</span><span>{fmtN(p.press, 2)} bar</span></div>
        <div className="row"><span>Ýygylyk</span><span>{fmtN(p.hz, 1)} Hz{p.hzGrid ? ' (tor)' : ''}</span></div>
        <div className="row"><span>Tok</span><span className={sevCls(p.warn.tok) === 'good' ? '' : sevCls(p.warn.tok)}>{fmtN(p.amp, 1)} A</span></div>
        <div className="row"><span>Kuwwat</span><span>{fmtN(p.kw, 1)} kW</span></div>
        <div className="row"><span>Inwertor / Pano</span><span>{fmtN(p.hours.inv, 0)} / {fmtN(p.hours.pano, 0)} sag</span></div>
      </div>
      <span className={`miniOverall ${p.overall}`}>{OVERALL_TK[p.overall]}</span>
    </>
  )
}

export function InfoCard({ station, id, eq, cardRef, onClose, onCharts }: {
  station: string
  id: string
  eq: EquipmentDef
  cardRef: (el: HTMLDivElement | null) => void
  onClose: () => void
  onCharts?: () => void
}) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const status = useTwin((s) => s.status)
  const health = useTwin((s) => s.health)
  const historyEnabled = useTwin((s) => s.historyEnabled)
  const [trend, setTrend] = useState<SignalDef | null>(null)

  const st = status[`${station}.${id}`]?.state ?? 'UNKNOWN'
  const h = health[`${station}.${id}`] ?? health[id]
  const isPump = eq.type === 'pump_hsc'
  const signals = isPump ? [] : allSignals(eq)

  return (
    // Konum ve görünürlük sahne tarafından yazılır (CSS'te gizli başlar)
    <div className={`card ${stateClass(st, h)}${isPump ? ' pump' : ''}`} ref={cardRef}>
      <div className="cardHead">
        <div>
          <b>{station} {eq.label}</b>
          <div className="sub">{id}</div>
        </div>
        {/* Datçikte durum isteğe bağlı: JACE'te LT-0x/state noktası değer
            taşıyorsa rozet görünür; boşsa rozet yerine yalnız değer satırı. */}
        {!isPump && !(STATELESS.has(eq.type) && st === 'UNKNOWN') &&
          <span className={`chip ${stateClass(st, h)}`}>{STATE_TK[st] ?? st}</span>}
        {isPump && onCharts && (
          <button className="x" onClick={onCharts} title="Grafikler" aria-label="grafikler"><Icon.chart size={15} /></button>
        )}
        <button className="x" onClick={onClose} aria-label="ýap">×</button>
      </div>
      {isPump ? <PumpSummary station={station} id={id} label={eq.label} /> : (
        <div className="kv">
          {signals.length === 0 && <div className="empty">Bu enjamda datçik ýok.</div>}
          {signals.map((sig) => {
            const raw = readTag(values, stale, sig.tag)
            const v = typeof raw === 'string' ? null : raw
            const sev = severity(v, sig)
            const digits = sig.type === 'int' ? 0 : sig.unit === 'bar' ? 2 : 1
            // Sayısal sinyale dokununca trend açılır; geçmiş kapalıysa tıklanmaz
            const clickable = sig.type !== 'bool' && historyEnabled
            return (
              <div key={sig.tag}
                   className={`row${clickable ? ' clickable' : ''}${trend?.tag === sig.tag ? ' active' : ''}`}
                   onClick={clickable ? () => setTrend(trend?.tag === sig.tag ? null : sig) : undefined}>
                <span>{sig.label}</span>
                <span className={sev === 'alarm' ? 'bad' : sev === 'warn' ? 'mid' : ''}>
                  {raw === null ? <em className="stale">maglumat ýok</em> : fmt(raw, sig.unit, digits)}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {isPump && onCharts && <button className="wide" onClick={onCharts}>8 grafigi aç</button>}
      {trend && <Trend sig={trend} onClose={() => setTrend(null)} />}
    </div>
  )
}
