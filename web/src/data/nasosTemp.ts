/**
 * Nasos temperaturası: veritabanındaki noktanın adı kendiliğinden tanınır.
 *
 *   Toplum_1_Temps_P3_U1   → Toplum 1'in 3. nasosu · U1 (MOTOR.t1)
 *   Toplum2_Temps_P1       → Toplum 2'nin 1. nasosu · Öň podşipnik (PUMP.bearing1) — son eki yok
 *   Toplum2_Temps_P1_Arka  → Toplum 2'nin 1. nasosu · Arka podşipnik (PUMP.bearing2)
 *
 * "k. nasos" konfigürasyondaki toplum sırasıyla (pump.ts toplumlarOf, ekrandaki Toplum 1, 2 …):
 * 1 Maý'da Toplum 1 = N-1…N-3, Toplum 2 = N-4…N-10.
 *
 * Tanınmayan ya da yanlış eşlenen nokta Arhiw → Sazlamalar'da elle seçilir. Seçim istasyonda
 * file:^twin/nasos_temperatura.json'a yazılır (Workbench: Files → twin) ve tanımanın üstündedir:
 *
 *   { "noktalar": { "PMP-01": { "MOTOR.t1": "Toplum_1_Temps_P1_U1", "PUMP.bearing2": null } } }
 *
 * (null: o hücrede veritabanı noktası yok — Twin noktasının kendi geçmişi okunur.)
 * Eski biçim de okunur: { "nasoslar": { "PMP-01": "Toplum_1_Temps_P1" }, "sonlar": { "MOTOR.t1": "_U1" } }.
 */
import { BEARING_KEYS, TEMP_KEYS, enjamAdy, toplumlarOf, type StationCfg } from './pump'
import { asset, DEMO, fetchStationConfig, loadDbPoints, type DbPoint } from './niagara'
import { unescapeName } from './etiket'

export const TEMP_RE = /^Toplum_?(\d+)_Temps_P(\d+)(?:_(U1|U2|V1|V2|W1|W2|Arka))?$/i
/** Adın son eki → Twin anahtarı; son eksiz ad Öň podşipnik */
const SON: Record<string, string> = {
  U1: 'MOTOR.t1', U2: 'MOTOR.t2', V1: 'MOTOR.t3', V2: 'MOTOR.t4', W1: 'MOTOR.t5', W2: 'MOTOR.t6',
  '': 'PUMP.bearing1', ARKA: 'PUMP.bearing2',
}
export const TEMP_ALL = [...TEMP_KEYS, ...BEARING_KEYS]
/** Twin anahtarı → ekrandaki ad (tablo ve grafik sırası) */
export const TEMP_OLCEG: Record<string, string> = {
  'MOTOR.t1': 'U1', 'MOTOR.t2': 'U2', 'MOTOR.t3': 'V1', 'MOTOR.t4': 'V2', 'MOTOR.t5': 'W1', 'MOTOR.t6': 'W2',
  'PUMP.bearing1': 'Öň podşipnik', 'PUMP.bearing2': 'Arka podşipnik',
}

export function parseTempName(name: string): { toplum: number; k: number; key: string } | null {
  const m = TEMP_RE.exec(unescapeName(name).trim())
  if (!m) return null
  return { toplum: Number(m[1]), k: Number(m[2]), key: SON[(m[3] ?? '').toUpperCase()] }
}

/** Temperatura gibi görünen ad (tanınsın tanınmasın Sazlamalar'da listelenir) */
export const isTempLike = (name: string, unit: string | null) =>
  unit === '°C' || /temp|_(U|V|W)[12]$|_Arka$|podsip|podşip/i.test(unescapeName(name))

// --------------------------------------------------------------------------- //
// İstasyonun nasosları (toplum sırasıyla)
// --------------------------------------------------------------------------- //

export interface PumpSlot { id: string; label: string; toplum: number; k: number }
const slots = new Map<string, PumpSlot[]>()
let lastSid = ''

function slotsOf(cfg: StationCfg): PumpSlot[] {
  return toplumlarOf(cfg.equipment).flatMap((t, i) =>
    t.pumps.map((p, j) => ({ id: p.id, label: enjamAdy(p.label ?? p.id), toplum: i + 1, k: j + 1 })))
}

/** Arayüz istasyon konfigürasyonunu yükleyince çağırır (nokta ağacındaki nasos adları için). */
export function setTempStation(sid: string, cfg: StationCfg | null): void {
  if (!cfg?.equipment) return
  slots.set(sid, slotsOf(cfg)); lastSid = sid
}

/** Toplum t'nin k. nasosunun ekrandaki adı ("Nasos 8"); konfigürasyon bilinmiyorsa null */
export const tempPumpLabel = (toplum: number, k: number) =>
  slots.get(lastSid)?.find((p) => p.toplum === toplum && p.k === k)?.label ?? null

async function slotsFor(sid: string): Promise<PumpSlot[]> {
  if (!slots.has(sid)) {
    const cfg = await fetchStationConfig(sid).catch(() => null)
    if (cfg?.equipment) slots.set(sid, slotsOf(cfg))
  }
  return slots.get(sid) ?? []
}

// --------------------------------------------------------------------------- //
// Eşleme: kendiliğinden + dosya + Sazlamalar
// --------------------------------------------------------------------------- //

/** nasos → Twin anahtarı → veritabanındaki ad (null: nokta yok) */
export type TempMap = Record<string, Record<string, string | null>>

interface TempFile {
  noktalar?: Record<string, Record<string, string | null>>
  nasoslar?: Record<string, string>
  sonlar?: Record<string, string>
}

function fromFile(d: TempFile): TempMap {
  const out: TempMap = {}
  for (const [pid, kok] of Object.entries(d.nasoslar ?? {})) {
    for (const [key, son] of Object.entries(d.sonlar ?? {})) if (kok && son != null) (out[pid] ??= {})[key] = kok + son
  }
  for (const [pid, m] of Object.entries(d.noktalar ?? {})) {
    for (const [key, v] of Object.entries(m ?? {})) (out[pid] ??= {})[key] = v || null
  }
  return out
}

export interface TempListed { name: string; unit: string | null; why: string }
export interface TempPlan {
  sid: string
  pumps: PumpSlot[]
  /** veritabanındaki noktalar; null: TsOkuma servisi yok */
  points: DbPoint[] | null
  auto: TempMap
  /** nasos_temperatura.json'daki seçim */
  file: TempMap
  /** Sazlamalar'da kaydedilen (bu tarayıcı / bu oturum); varsa dosyanın yerine geçer */
  saved: TempMap | null
  /** grafiklerin kullandığı: auto ⊕ (saved ?? file) */
  eff: TempMap
  /** temperatura gibi görünüp kullanılmayan noktalar (neden) */
  unused: TempListed[]
}

const LS = (sid: string) => `twin.nasosTemp.${sid}`
const session = new Map<string, TempMap>()

function savedFor(sid: string): TempMap | null {
  if (session.has(sid)) return session.get(sid)!
  if (!DEMO) return null
  try { const s = localStorage.getItem(LS(sid)); return s ? JSON.parse(s) as TempMap : null } catch { return null }
}

const planP = new Map<string, Promise<TempPlan>>()
const listeners = new Set<() => void>()

export function onTempPlan(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

export function loadTempPlan(sid: string): Promise<TempPlan> {
  let p = planP.get(sid)
  if (!p) {
    p = build(sid)
    planP.set(sid, p)
    p.then((x) => { if (!x.points) planP.delete(sid) }, () => planP.delete(sid))   // servis sonradan gelirse
  }
  return p
}

async function build(sid: string): Promise<TempPlan> {
  const [pumps, points, fileDoc] = await Promise.all([
    slotsFor(sid),
    loadDbPoints(),
    fetch(asset('nasos_temperatura.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<TempFile> : {})).catch(() => ({} as TempFile)),
  ])
  const auto: TempMap = {}
  for (const [name] of points ?? []) {
    const tp = parseTempName(name)
    const slot = tp && pumps.find((p) => p.toplum === tp.toplum && p.k === tp.k)
    if (!tp || !slot) continue
    const row = (auto[slot.id] ??= {})
    if (!row[tp.key]) row[tp.key] = name
  }
  const file = fromFile(fileDoc ?? {})
  const saved = savedFor(sid)
  const eff = merge(auto, saved ?? file)
  return { sid, pumps, points, auto, file, saved, eff, unused: unusedTemps(pumps, points, eff) }
}

/** Temperatura gibi görünüp eşlemede kullanılmayan noktalar ve nedeni */
export function unusedTemps(pumps: PumpSlot[], points: DbPoint[] | null, sel: TempMap): TempListed[] {
  const used = new Set(Object.values(sel).flatMap((r) => Object.values(r)).filter((x): x is string => !!x))
  const out: TempListed[] = []
  for (const [name, , , unit] of points ?? []) {
    if (used.has(name) || !isTempLike(name, unit)) continue
    const tp = parseTempName(name)
    const slot = tp && pumps.find((p) => p.toplum === tp.toplum && p.k === tp.k)
    const why = !tp ? 'ady tanalmady'
      : !slot ? `Toplum ${tp.toplum}-de ${tp.k}-nji nasos ýok`
      : sel[slot.id]?.[tp.key] ? `${slot.label} · ${TEMP_OLCEG[tp.key]}: başga nokat saýlanan`
      : `${slot.label} · ${TEMP_OLCEG[tp.key]}: “ýok” saýlanan`
    out.push({ name, unit, why })
  }
  return out
}

export function merge(base: TempMap, over: TempMap): TempMap {
  const out: TempMap = {}
  for (const [pid, r] of Object.entries(base)) out[pid] = { ...r }
  for (const [pid, r] of Object.entries(over)) out[pid] = { ...(out[pid] ?? {}), ...r }
  return out
}

/** Tanınandan farklı hücreler (kaydedilecek olan): bu yeterli, gerisi her açılışta yeniden tanınır. */
export function diffFromAuto(auto: TempMap, sel: TempMap): TempMap {
  const out: TempMap = {}
  for (const [pid, r] of Object.entries(sel)) {
    for (const [key, v] of Object.entries(r)) {
      if ((auto[pid]?.[key] ?? null) !== (v ?? null)) (out[pid] ??= {})[key] = v ?? null
    }
  }
  return out
}

/** nasos_temperatura.json'un metni (Niagara'da Workbench ile yazılır) */
export function tempFileText(over: TempMap): string {
  const noktalar: TempMap = {}
  for (const pid of Object.keys(over).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    noktalar[pid] = Object.fromEntries(TEMP_ALL.filter((k) => k in over[pid]).map((k) => [k, over[pid][k]]))
  }
  return JSON.stringify({
    _aciklama: 'Nasos temperaturasy: Twin açary (MOTOR.t1…t6 = U1…W2, PUMP.bearing1 = Öň, PUMP.bearing2 = Arka) → maglumat binýadyndaky nokat. Diňe awtomatik tanalandan tapawutly öýjükler; null = nokat ýok.',
    noktalar,
  }, null, 2) + '\n'
}

/**
 * Sazlamalary ýatda sakla — TEK yer: ileride Niagara'ya doğrudan yazılacaksa yalnız bu değişir.
 *   demo     → bu tarayıcıda (localStorage); grafikler hemen kullanır
 *   Niagara  → dosyanın metni döner (Workbench: Files → twin → nasos_temperatura.json);
 *              bu oturumda grafikler yeni eşlemeyi hemen kullanır
 */
export async function saveTempOverrides(sid: string, over: TempMap): Promise<{ stored: boolean; text: string }> {
  const text = tempFileText(over)
  session.set(sid, over)
  let stored = false
  if (DEMO) {
    try { localStorage.setItem(LS(sid), JSON.stringify(over)); stored = true } catch { /* depolama kapalı */ }
  }
  planP.delete(sid)
  listeners.forEach((f) => f())
  return { stored, text }
}

const TAG_RE = /^(.+)\.(PMP-\d+)\.(MOTOR\.t[1-6]|PUMP\.bearing[12])$/

/** Twin etiketi (PS-04.PMP-03.MOTOR.t1) → veritabanındaki ad; nasos temperaturası değilse ya da yoksa null */
export async function tempDbName(tag: string): Promise<string | null> {
  const m = TAG_RE.exec(tag)
  if (!m) return null
  const plan = await loadTempPlan(m[1])
  return plan.eff[m[2]]?.[m[3]] ?? null
}
