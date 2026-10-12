import { useCallback, useMemo } from 'react'
import { useTwin } from '../data/store'
import type { Bucket } from '../data/history'
import { BEARING_KEYS, LEVEL_EQ, TEMP_KEYS, levelIdOf, sevOf, sevRank, sigDef, thresholds } from '../data/pump'
import type { TwinMap } from '../scene/types'
import { ChartBoard, type ChartSpec } from './ChartBoard'

/**
 * Bir nasosun 8 grafiği (nasosa dokununca açılır):
 * temperatura · ýagdaýy · duýduryş · işlän wagty · basyş · ýygylyk · tok · kuwwat.
 * Hepsi aynı zaman aralığında; bir grafiğe dokununca büyür.
 */

export const TEMP_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#f87171', '#fb923c']
export const MODE_LABELS = ['Durýar', 'Inwertor', 'Transformator']
export const SEV_LABELS = ['Kadaly', 'Duýduryş', 'Näsazlyk']

/** Aynı ızgaradaki birkaç seriyi zamana göre hizalayıp tek değere indirger. */
export function combine(list: (Bucket[] | undefined)[], f: (rows: (Bucket | undefined)[]) => number | null): Bucket[] {
  const keys = new Map<number, number>()
  for (const s of list) for (const b of s ?? []) keys.set(Math.round(b[0]), b[0])
  const idx = list.map((s) => new Map((s ?? []).map((b) => [Math.round(b[0]), b])))
  const out: Bucket[] = []
  for (const [k, t] of [...keys.entries()].sort((a, b) => a[0] - b[0])) {
    const v = f(idx.map((m) => m.get(k)))
    if (v !== null) out.push([t, v, v, v])
  }
  return out
}

export function pumpTags(sid: string, id: string): string[] {
  const k = ['run_inv', 'run_pano', 'hours_inv', 'hours_pano', 'discharge_press_bar', 'vfd_freq_hz',
    'current_a', 'power_kw', ...TEMP_KEYS, ...BEARING_KEYS]
  return [...k.map((x) => `${sid}.${id}.${x}`), `${sid}.${levelIdOf(id) ?? LEVEL_EQ}.level_m`]
}

export function buildPumpCharts(sid: string, id: string, twin: TwinMap | null, d: Record<string, Bucket[]>): ChartSpec[] {
  const t = (k: string) => d[`${sid}.${id}.${k}`]
  const def = (k: string) => sigDef(twin, id, k)
  const line = (k: string, label: string, color: string, dashed = false) => ({ label, color, data: t(k) ?? [], dashed })

  const mode = combine([t('run_inv'), t('run_pano')], ([a, b]) =>
    !a && !b ? null : (a && a[1] >= 0.5) ? 1 : (b && b[1] >= 0.5) ? 2 : 0)

  // Uyarı seviyeleri kovanın en kötü değerinden: sıcaklıkta maks, seviyede min/maks
  const sevB = (b: Bucket | undefined, k: string, eq = id) =>
    b ? Math.max(sevRank(sevOf(b[3], sigDef(twin, eq, k))), sevRank(sevOf(b[2], sigDef(twin, eq, k)))) : 0
  const tempKeys = [...TEMP_KEYS, ...BEARING_KEYS]
  const wTemp = combine(tempKeys.map(t), (rows) => rows.every((r) => !r) ? null
    : Math.max(...rows.map((r, i) => sevB(r, tempKeys[i]))))
  const wTok = combine([t('current_a')], ([r]) => (r ? sevB(r, 'current_a') : null))
  // Suw derejesi: nasosun kendi hücre datçiği (yoksa howuz)
  const lvlEq = levelIdOf(id) ?? LEVEL_EQ
  const lvl = d[`${sid}.${lvlEq}.level_m`]
  const wLvl = combine([lvl], ([r]) => (r ? sevB(r, 'level_m', lvlEq) : null))

  const hTotal = combine([t('hours_inv'), t('hours_pano')], ([a, b]) => (!a && !b ? null : (a?.[1] ?? 0) + (b?.[1] ?? 0)))

  return [
    {
      key: 'temp', title: 'Temperatura', unit: '°C', digits: 1, fill: false,
      thresholds: thresholds(def('MOTOR.t1')),
      series: [...TEMP_KEYS.map((k, i) => line(k, `T${i + 1}`, TEMP_COLORS[i])),
               ...BEARING_KEYS.map((k, i) => line(k, `Podşipnik ${i + 1}`, TEMP_COLORS[6 + i], true))],
    },
    { key: 'mode', title: 'Ýagdaýy', enumLabels: MODE_LABELS, series: [{ label: 'Ýagdaýy', color: '#22c55e', data: mode }] },
    {
      key: 'warn', title: 'Duýduryş', enumLabels: SEV_LABELS,
      series: [{ label: 'Temperatura', color: '#f472b6', data: wTemp },
               { label: 'Tok', color: '#fbbf24', data: wTok },
               { label: 'Suw derejesi', color: '#38bdf8', data: wLvl }],
    },
    {
      key: 'hours', title: 'Işlän wagty', unit: 'sag', digits: 1, fill: false,
      series: [line('hours_inv', 'Inwertor', '#60a5fa'), line('hours_pano', 'Transformator', '#a78bfa'),
               { label: 'Jemi', color: '#e5e7eb', data: hTotal }],
    },
    { key: 'press', title: 'Basyş', unit: 'bar', digits: 2, stats: true, series: [line('discharge_press_bar', 'Basyş', '#38bdf8')] },
    { key: 'hz', title: 'Ýygylyk', unit: 'Hz', digits: 1, stats: true, series: [line('vfd_freq_hz', 'Ýygylyk', '#60a5fa')] },
    {
      key: 'amp', title: 'Tok', unit: 'A', digits: 1, stats: true, yMin: 0,
      thresholds: thresholds(def('current_a')), series: [line('current_a', 'Tok', '#22c55e')],
    },
    { key: 'kw', title: 'Kuwwat', unit: 'kW', digits: 1, stats: true, yMin: 0, series: [line('power_kw', 'Kuwwat', '#fbbf24')] },
  ]
}

export function PumpCharts({ sid, id, label, onClose }: { sid: string; id: string; label: string; onClose: () => void }) {
  const twin = useTwin((s) => s.twinMap)
  const tags = useMemo(() => pumpTags(sid, id), [sid, id])
  const build = useCallback((d: Record<string, Bucket[]>) => buildPumpCharts(sid, id, twin, d), [sid, id, twin])
  return (
    <div className="modal" onClick={onClose}>
      <div className="modalBox" onClick={(e) => e.stopPropagation()}>
        <ChartBoard title={`${label} · grafikler`} tags={tags} build={build} onClose={onClose}
                    fileName={`${sid}_${id}`} />
      </div>
    </div>
  )
}
