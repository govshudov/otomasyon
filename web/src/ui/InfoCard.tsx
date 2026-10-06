import { useState } from 'react'
import { fmt, readTag, useTwin } from '../data/store'
import { Trend } from './Trend'
import { STATE_TK, stateClass } from './labels'
import type { EquipmentDef, SignalDef } from '../scene/types'

/**
 * Seçili ekipmanın 3D'de ÜSTÜNDE duran bilgi kartı.
 *
 * Kartın ekran konumu React'te değil, sahnenin render döngüsünde güncellenir
 * (`TwinScene.setCard`): her karede ekipmanın 3D bağlantı noktası ekrana
 * izdüşürülüp `transform` yazılır. Böylece sahne döndürülürken kart pompanın
 * üstünde kalır ve Pi'de kare başına React uzlaştırması çalışmaz.
 *
 * Hangi satırların gösterileceği `twin-map.json`'dan gelir — pompa için
 * katalogdaki 8 sinyal. Bileşen seviyesindeki sinyaller (motor sıcaklığı,
 * titreşim) de aynı listede.
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

export function InfoCard({ station, id, eq, cardRef, onClose }: {
  station: string
  id: string
  eq: EquipmentDef
  cardRef: (el: HTMLDivElement | null) => void
  onClose: () => void
}) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const status = useTwin((s) => s.status)
  const health = useTwin((s) => s.health)
  const historyEnabled = useTwin((s) => s.historyEnabled)
  const [trend, setTrend] = useState<SignalDef | null>(null)

  const st = status[`${station}.${id}`]?.state ?? 'UNKNOWN'
  const h = health[`${station}.${id}`] ?? health[id]
  const signals = allSignals(eq)

  return (
    // Konum ve görünürlük sahne tarafından yazılır (CSS'te gizli başlar)
    <div className={`card ${stateClass(st, h)}`} ref={cardRef}>
      <div className="cardHead">
        <div>
          <b>{station} {eq.label}</b>
          <div className="sub">{id}</div>
        </div>
        {/* Datçikte durum isteğe bağlı: JACE'te LT-0x/state noktası değer
            taşıyorsa rozet görünür; boşsa rozet yerine yalnız değer satırı. */}
        {!(STATELESS.has(eq.type) && st === 'UNKNOWN') &&
          <span className={`chip ${stateClass(st, h)}`}>{STATE_TK[st] ?? st}</span>}
        <button className="x" onClick={onClose} aria-label="ýap">×</button>
      </div>
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
      {trend && <Trend sig={trend} onClose={() => setTrend(null)} />}
    </div>
  )
}
