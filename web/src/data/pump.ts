/**
 * Pompa izleme panosunun anlam katmanı.
 *
 * Ham sinyallerden operatörün baktığı şeyleri çıkarır: pompa nerede
 * çalışıyor (inverter / pano / duruyor), üç uyarı kategorisi (temperatura,
 * tok, suw derejesi — her biri kadaly / duýduryş / näsazlyk), çalışma
 * süreleri. Eşikler twin-map'teki alarm kurallarından okunur; burada sabit
 * sayı yok.
 */
import type { Sample } from './store'
import type { SignalDef, TwinMap } from '../scene/types'

export type Sev = 'ok' | 'warn' | 'fault'
export type Mode = 'inv' | 'pano' | 'run' | 'stop' | 'unknown'
export type Overall = 'run' | 'stop' | 'warn' | 'fault' | 'unknown'

export const TEMP_KEYS = ['MOTOR.t1', 'MOTOR.t2', 'MOTOR.t3', 'MOTOR.t4', 'MOTOR.t5', 'MOTOR.t6']
export const BEARING_KEYS = ['PUMP.bearing1', 'PUMP.bearing2']
export const LEVEL_EQ = 'BASIN-01'

export const MODE_TK: Record<Mode, string> = {
  inv: 'Inwertorda', pano: 'Panoda', run: 'Işleýär', stop: 'Durýar', unknown: 'Maglumat ýok',
}
export const SEV_TK: Record<Sev, string> = { ok: 'Kadaly', warn: 'Duýduryş', fault: 'Näsazlyk' }
export const OVERALL_TK: Record<Overall, string> = {
  run: 'IŞLEÝÄR', stop: 'DURÝAR', warn: 'DUÝDURYŞ', fault: 'NÄSAZLYK', unknown: 'MAGLUMAT ÝOK',
}

// --------------------------------------------------------------------------- //
// İstasyon yapısı: toplumlar (her biri bir çıkış borusuna basan pompalar)
// --------------------------------------------------------------------------- //

export interface EqCfg {
  id: string; type: string; label?: string; header?: string; source_pump?: string
  params?: Record<string, number | string | boolean | string[]>
}

/** Nasos → kendi emme hücresinin seviye datçiği (PMP-01 → LT-01); konfigürasyondan */
const pumpLevel = new Map<string, string>()
export const levelIdOf = (pumpId: string) => pumpLevel.get(pumpId)
export interface StationCfg { station_id: string; name: string; equipment: EqCfg[] }

export interface PumpRef { id: string; label: string; motorKw: number; ratedA: number; ratedQ: number }
export interface Group { id: string; no: number; name: string; header: string; pumps: PumpRef[] }

export function groupsOf(cfg: StationCfg | null): Group[] {
  if (!cfg) return []
  pumpLevel.clear()
  for (const e of cfg.equipment) if (e.type === 'level_sensor' && e.source_pump) pumpLevel.set(e.source_pump, e.id)
  const pumps = cfg.equipment.filter((e) => e.type === 'pump_hsc')
  return cfg.equipment.filter((e) => e.type === 'header').map((h, i) => ({
    id: h.id, no: i + 1, name: `Toplum ${i + 1}`, header: h.label ?? h.id,
    pumps: pumps.filter((p) => p.header === h.id).map((p) => ({
      id: p.id, label: p.label ?? p.id,
      motorKw: Number(p.params?.motor_kw ?? 160),
      ratedA: Number(p.params?.rated_current_a ?? 280),
      ratedQ: Number(p.params?.rated_flow_m3h ?? 900),
    })),
  }))
}

/** "T-1 N-3" → "N-3" (kısa ad; toplum zaten başlıkta yazıyor) */
export const shortLabel = (label: string) => label.split(' ').pop() ?? label

/** "T-1 N-3" → "NASOS 3" (nasos kartının başlığı) */
export function nasosLabel(label: string): string {
  const m = /N-?(\d+)\s*$/i.exec(label)
  return m ? `NASOS ${Number(m[1])}` : label.toUpperCase()
}

// --------------------------------------------------------------------------- //
// Eşikler ve şiddet
// --------------------------------------------------------------------------- //

export function sigDef(twin: TwinMap | null, eq: string, key: string): SignalDef | undefined {
  const e = twin?.equipment[eq]
  if (!e) return undefined
  if (!key.includes('.')) return e.signals[key]
  const [c, m] = key.split('.')
  return e.components[c]?.signals[m]
}

export function sevOf(v: number | boolean | null | undefined, def: SignalDef | undefined): Sev {
  if (v === null || v === undefined || !def) return 'ok'
  let out: Sev = 'ok'
  for (const a of def.alarms ?? []) {
    let hit = false
    if (typeof a.value === 'boolean') hit = v === a.value
    else if (typeof v === 'number') {
      hit = a.op === '>' ? v > a.value : a.op === '<' ? v < a.value
        : a.op === '>=' ? v >= a.value : a.op === '<=' ? v <= a.value : false
    }
    if (hit) out = a.level === 'ALARM' ? 'fault' : out === 'fault' ? 'fault' : 'warn'
  }
  return out
}

const RANK: Record<Sev, number> = { ok: 0, warn: 1, fault: 2 }
export const worst = (...s: Sev[]): Sev => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok' as Sev)
export const sevRank = (s: Sev) => RANK[s]

/** Eşikleri sayısal liste olarak (grafikteki kesik çizgiler için) */
export function thresholds(def: SignalDef | undefined): { value: number; level: 'WARN' | 'ALARM' }[] {
  return (def?.alarms ?? []).filter((a) => typeof a.value === 'number')
    .map((a) => ({ value: a.value as number, level: a.level }))
}

// --------------------------------------------------------------------------- //
// Pompa görünümü
// --------------------------------------------------------------------------- //

export interface Reading { key: string; label: string; v: number | null; sev: Sev }

export interface PumpView {
  id: string; label: string
  mode: Mode; running: boolean; overall: Overall
  temps: Reading[]; bearings: Reading[]
  warn: { temp: Sev; tok: Sev; level: Sev }
  /** Nasosyň öz öýjügindäki suw derejesi (LT datçigi bar bolsa), m */
  level: number | null
  hours: { inv: number | null; pano: number | null; total: number | null }
  press: number | null; hz: number | null; hzGrid: boolean
  amp: number | null; kw: number | null
}

type Values = Record<string, Sample>

export function numOf(values: Values, stale: Set<string>, tag: string): number | null {
  if (stale.has(tag)) return null
  const v = values[tag]?.v
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null
}
function boolOf(values: Values, stale: Set<string>, tag: string): boolean | null {
  if (stale.has(tag)) return null
  const v = values[tag]?.v
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0.5 : null
}

/** İstasyonun su seviyesi şiddeti — tüm pompaların "suw derejesi" uyarısı bundan. */
export function levelSev(sid: string, values: Values, stale: Set<string>, twin: TwinMap | null): Sev {
  const tag = `${sid}.${LEVEL_EQ}.level_m`
  return sevOf(numOf(values, stale, tag), sigDef(twin, LEVEL_EQ, 'level_m'))
}

export function pumpView(sid: string, pump: { id: string; label: string }, values: Values, stale: Set<string>,
                         twin: TwinMap | null, state: string | undefined, lvl: Sev): PumpView {
  const t = (k: string) => `${sid}.${pump.id}.${k}`
  const n = (k: string) => numOf(values, stale, t(k))
  const read = (k: string, label: string): Reading => {
    const v = n(k)
    return { key: k, label, v, sev: sevOf(v, sigDef(twin, pump.id, k)) }
  }

  const inv = boolOf(values, stale, t('run_inv'))
  const pano = boolOf(values, stale, t('run_pano'))
  // Çalışma yeri sinyali yoksa (eski nokta yapısı) ekipman durumuna düş
  const mode: Mode = inv ? 'inv' : pano ? 'pano'
    : inv === false || pano === false ? 'stop'
    : state === 'RUNNING' || state === 'STARTING' ? 'run'
    : state === 'STOPPED' || state === 'STOPPING' || state === 'FAULT' ? 'stop' : 'unknown'
  const running = mode === 'inv' || mode === 'pano' || mode === 'run'

  const temps = TEMP_KEYS.map((k, i) => read(k, `T${i + 1}`))
  const bearings = BEARING_KEYS.map((k, i) => read(k, `P${i + 1}`))
  const amp = n('current_a')
  // Suw derejesi: nasosun kendi emme hücresindeki datçik; yoksa howuzun seviyesi (lvl)
  const lt = pumpLevel.get(pump.id)
  const ltV = lt ? numOf(values, stale, `${sid}.${lt}.level_m`) : null
  const warn = {
    temp: worst(...temps.map((r) => r.sev), ...bearings.map((r) => r.sev)),
    tok: sevOf(amp, sigDef(twin, pump.id, 'current_a')),
    level: lt && ltV !== null ? sevOf(ltV, sigDef(twin, lt, 'level_m')) : lvl,
  }
  const any = worst(warn.temp, warn.tok, warn.level)
  const overall: Overall = state === 'FAULT' || any === 'fault' ? 'fault'
    : any === 'warn' ? 'warn'
    : running ? 'run' : mode === 'stop' ? 'stop' : 'unknown'

  const hInv = n('hours_inv'), hPano = n('hours_pano')
  const hz = n('vfd_freq_hz')
  // Panodan (bypass) çalışırken inverter 0 Hz okur; motor şebeke frekansında döner
  const hzGrid = mode === 'pano' && (hz === null || hz < 1)
  return {
    id: pump.id, label: pump.label, mode, running, overall, temps, bearings, warn, level: ltV,
    hours: { inv: hInv, pano: hPano, total: hInv === null && hPano === null ? null : (hInv ?? 0) + (hPano ?? 0) },
    press: n('discharge_press_bar'), hz: hzGrid ? 50 : hz, hzGrid, amp, kw: n('power_kw'),
  }
}

/** 3D sahnenin pompa rengi için: işleýär yeşil, durdy gri, näsaz kırmızı. */
export function runStateOf(p: PumpView): string {
  return p.overall === 'fault' ? 'FAULT' : p.running ? 'RUNNING' : p.mode === 'stop' ? 'STOPPED' : 'UNKNOWN'
}

// --------------------------------------------------------------------------- //
// Biçim
// --------------------------------------------------------------------------- //

/** 5715.4 sag → "238 gün 3 sag" */
export function fmtDuration(h: number | null): string {
  if (h === null) return '—'
  const d = Math.floor(h / 24)
  const r = Math.floor(h - d * 24)
  return d > 0 ? `${d.toLocaleString('en-US')} gün ${r} sag` : `${r} sag`
}

export function fmtN(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
