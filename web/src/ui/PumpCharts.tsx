import { useCallback, useMemo } from 'react'
import { useTwin } from '../data/store'
import type { Bucket } from '../data/history'
import { BEARING_KEYS, BEARING_LABELS, LEVEL_EQ, TEMP_KEYS, TEMP_LABELS, levelIdOf, sevOf, sevRank, sigDef, thresholds } from '../data/pump'
import type { TwinMap } from '../scene/types'
import { ChartBoard, type ChartSpec } from './ChartBoard'

/**
 * Bir nasosun 8 grafiği (Grafikler sayfasında nasos seçilince):
 * temperatura · ýagdaýy · duýduryş · işlän wagty · basyş · ýygylyk · tok · kuwwat.
 * Hepsi aynı zaman aralığında; bir grafiğe dokununca büyür.
 */

export const TEMP_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#f87171', '#fb923c']
/** Işlän wagty sütunları: nasos kartındaki rejim renkleri (inwertor yaşyl, transformator gök) */
export const INV_COLOR = '#4ade80'
export const PANO_COLOR = '#60a5fa'
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

/** Çubuk genişliği aralığa göre: ≤ 2 sa → 5 dk, ≤ 8 sa → 30 dk, ≤ 2 gün → 1 sa, üstü → 1 gün */
function barWidth(span: number): number {
  return span <= 2 * 3600 ? 300 : span <= 8 * 3600 ? 1800 : span <= 2 * 86400 ? 3600 : 86400
}

/**
 * Sayaç (sagat) → her sütunda işlenen süre: sütunun sonundaki sayaç − başındaki.
 * Sayacın sınırdaki değeri kovalar arasında doğrusal (kova ortası = ortalama, ilk kovanın başı = min,
 * son kovanın sonu = maks): sınırı aşan kova bir sütuna yazılıp 60 dk'lık sütunda 61 dk çıkmasın.
 * Süre sütunun uzunluğunu aşamaz. Sütunlar yerel saate hizalı (günlük sütun gece yarısından başlar).
 * `scale` sagat → gösterilen birim.
 */
function barDeltas(s: Bucket[] | undefined, w: number, scale: number): Bucket[] {
  if (!s?.length) return []
  const tz = new Date().getTimezoneOffset() * 60
  const half = s.length > 1 ? (s[1][0] - s[0][0]) / 2 : 0
  const pts: [number, number][] = [[s[0][0] - half, s[0][2]], ...s.map((b) => [b[0], b[1]] as [number, number]),
    [s[s.length - 1][0] + half, s[s.length - 1][3]]]
  const at = (t: number) => {
    let lo = 0, hi = pts.length - 1
    if (t <= pts[0][0]) return pts[0][1]
    if (t >= pts[hi][0]) return pts[hi][1]
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m }
    const [t0, v0] = pts[lo], [t1, v1] = pts[hi]
    return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1
  }
  const first = pts[0][0], last = pts[pts.length - 1][0]
  const out: Bucket[] = []
  for (let k = Math.floor((first - tz) / w); k * w + tz < last; k++) {
    const a = Math.max(k * w + tz, first), b = Math.min((k + 1) * w + tz, last)
    if (b <= a) continue
    const v = Math.min(Math.max(0, at(b) - at(a)), (b - a) / 3600) * scale
    out.push([k * w + tz + w / 2, v, v, v])
  }
  return out
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

  // Işlän wagty: çubuk başına inwertorda / transformatorda işlenen süre, üst üste
  const all = [t('hours_inv'), t('hours_pano')].flatMap((s) => s ?? [])
  const span = all.length ? Math.max(...all.map((b) => b[0])) - Math.min(...all.map((b) => b[0])) : 0
  const bw = barWidth(span), minutes = bw <= 3600
  const hInv = barDeltas(t('hours_inv'), bw, minutes ? 60 : 1)
  const hPano = barDeltas(t('hours_pano'), bw, minutes ? 60 : 1)

  // Eşikler adıyla: sargı (U1…W2) ve podşipnik ayrı; veriden uzaksa grafik onları göstermez
  const lim = (k: string, ad: string) => thresholds(def(k)).map((x) => ({ ...x, label: `${ad} ${x.level === 'ALARM' ? 'näsazlyk' : 'duýduryş'}` }))

  return [
    {
      // Motor sargıları (U1…W2) düz, podşipnikler kesik çizgi; bütün değerler tam sayı
      key: 'temp', title: 'Temperatura', unit: '°C', digits: 0, fill: false, yTitle: '°C',
      thresholds: [...lim('MOTOR.t1', 'Sargy'), ...lim('PUMP.bearing1', 'Podşipnik')],
      series: [...TEMP_KEYS.map((k, i) => line(k, TEMP_LABELS[i], TEMP_COLORS[i])),
               ...BEARING_KEYS.map((k, i) => line(k, BEARING_LABELS[i], TEMP_COLORS[6 + i], true))],
    },
    { key: 'mode', title: 'Ýagdaýy', enumLabels: MODE_LABELS, series: [{ label: 'Ýagdaýy', color: '#22c55e', data: mode }] },
    {
      key: 'warn', title: 'Duýduryş', enumLabels: SEV_LABELS,
      series: [{ label: 'Temperatura', color: '#f472b6', data: wTemp },
               { label: 'Tok', color: '#fbbf24', data: wTok },
               { label: 'Suw derejesi', color: '#38bdf8', data: wLvl }],
    },
    {
      // Her sütun bir zaman dilimi (5 dk / 30 dk / 1 sa / 1 gün): inwertorda + transformatorda işlenen süre üst üste
      key: 'hours', title: 'Işlän wagty', unit: minutes ? 'min' : 'sag', digits: minutes ? 0 : 1, fill: false, bars: bw,
      yTitle: minutes ? 'min' : 'sag',
      series: [{ label: 'Inwertorda', color: INV_COLOR, data: hInv }, { label: 'Transformatorda (tokda)', color: PANO_COLOR, data: hPano }],
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

export function PumpChartBoard({ sid, id, label }: { sid: string; id: string; label: string }) {
  const twin = useTwin((s) => s.twinMap)
  const tags = useMemo(() => pumpTags(sid, id), [sid, id])
  const build = useCallback((d: Record<string, Bucket[]>) => buildPumpCharts(sid, id, twin, d), [sid, id, twin])
  return <ChartBoard title={label} tags={tags} build={build} fileName={`${sid}_${id}`} />
}
