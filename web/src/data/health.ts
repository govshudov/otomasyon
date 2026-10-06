import type { SignalDef, TwinMap } from '../scene/types'
import type { Sample } from './store'

/**
 * Alarm kurallarını bir değer görüntüsüne karşı değerlendirir.
 *
 * Canlı modda sağlık bilgisi sunucudaki alarm motorundan gelir. Oynatmada ise
 * geçmiş bir anın sağlığı gerekiyor — sunucunun o anki alarm durumu artık yok.
 * Kurallar zaten `twin-map.json` içinde olduğu için istemci aynı hesabı yapabilir.
 *
 * Not: burada ISA 18.2 durum makinesi YOK (onay/dönüş durumları). Oynatma
 * "o an eşik aşılmış mıydı" sorusunu yanıtlar, "operatör onaylamış mıydı"yı değil.
 */

function level(v: number | boolean, sig: SignalDef): 'WARN' | 'ALARM' | null {
  let worst: 'WARN' | 'ALARM' | null = null
  for (const a of sig.alarms ?? []) {
    let hit = false
    if (typeof a.value === 'boolean') hit = v === a.value
    else if (typeof v === 'number') {
      hit = a.op === '>' ? v > a.value : a.op === '<' ? v < a.value
        : a.op === '>=' ? v >= a.value : a.op === '<=' ? v <= a.value : false
    }
    if (hit) worst = a.level === 'ALARM' ? 'ALARM' : (worst ?? 'WARN')
  }
  return worst
}

export interface Violation {
  id: string
  tag: string
  equipment: string
  component: string | null
  level: 'WARN' | 'ALARM'
  msg: string
  value: number | boolean
  ts_raised: number
}

export function computeHealth(twin: TwinMap, values: Record<string, Sample>): {
  equipment: Record<string, string>
  component: Record<string, string>
  violations: Violation[]
} {
  const eq: Record<string, string> = {}
  const comp: Record<string, string> = {}
  const violations: Violation[] = []
  const worse = (a: string | undefined, b: string) => (a === 'ALARM' || b === 'ALARM' ? 'ALARM' : b)

  const record = (eqId: string, compKey: string | null, sig: SignalDef,
                  s: Sample, lvl: 'WARN' | 'ALARM') => {
    const rule = (sig.alarms ?? []).find((a) => a.level === lvl)
    violations.push({
      id: `${sig.tag}|${lvl}`, tag: sig.tag, equipment: eqId, component: compKey,
      level: lvl, msg: `${twin.equipment[eqId].label} — ${rule?.msg ?? sig.label}`,
      value: s.v as number | boolean, ts_raised: s.ts,
    })
  }

  for (const [eqId, def] of Object.entries(twin.equipment)) {
    for (const sig of Object.values(def.signals)) {
      const s = values[sig.tag]
      if (!s || typeof s.v === 'string') continue
      const l = level(s.v, sig)
      if (l) { eq[eqId] = worse(eq[eqId], l); record(eqId, null, sig, s, l) }
    }
    for (const [compKey, c] of Object.entries(def.components)) {
      for (const sig of Object.values(c.signals)) {
        const s = values[sig.tag]
        if (!s || typeof s.v === 'string') continue
        const l = level(s.v, sig)
        if (l) {
          const k = `${eqId}/${compKey}`
          comp[k] = worse(comp[k], l)
          eq[eqId] = worse(eq[eqId], l)
          record(eqId, compKey, sig, s, l)
        }
      }
    }
  }
  violations.sort((a, b) =>
    (a.level === 'ALARM' ? 0 : 1) - (b.level === 'ALARM' ? 0 : 1) || a.equipment.localeCompare(b.equipment))
  return { equipment: eq, component: comp, violations }
}
