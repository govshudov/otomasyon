/**
 * Nasos H–Q egrisi ve iş nokady.
 *
 * Egriler KSB PDF'lerinden (common/nasos_egrileri.json → paket/nasos_egrileri.json);
 * hangi nasosun hangi model olduğu aynı dosyanın `atama` bölümünde.
 *
 * İş nokady (canlı):
 *   H = çıkış basıncı × 1e5/(ρ·g)  +  (nasos ekseni − emme suyunun seviyesi)
 *   Q = toplumun akym ölçegi / işleýän nasos sany          (aynı modelde nasoslar eşit böler)
 *     ya da nasosun kuwwatı güç egrisinde aranır            (ölçek yoksa / modeller farklıysa)
 * Inwertörde egriler ýygylyk oranıyla ölçeklenir (Q·r, H·r², P·r³; r = Hz/50).
 */
import { asset } from './niagara'

export interface EgriModel {
  ad: string; pdf?: string; motor_kw: number; rpm: number
  taslama: { q: number; h: number; p: number; eta: number }
  qmin: number
  q: number[]; h: number[]; p: number[]
}
export interface EgriDoc {
  rho?: number; motor_verim?: number; cos_phi?: number; gerilim_v?: number
  modeller: Record<string, EgriModel>
  atama: Record<string, Record<string, string>>
}

let docP: Promise<EgriDoc | null> | null = null
export function loadEgriler(): Promise<EgriDoc | null> {
  docP ??= fetch(asset('nasos_egrileri.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return docP
}

export function modelOf(doc: EgriDoc | null, sid: string, pumpId: string): EgriModel | null {
  const k = doc?.atama?.[sid]?.[pumpId]
  return (k && doc?.modeller[k]) || null
}

/** Doğrusal ara değer; xs artan. Aralık dışında null. */
export function interp(xs: number[], ys: number[], x: number): number | null {
  if (!xs.length || x < xs[0] || x > xs[xs.length - 1]) return null
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1)
      return ys[i - 1] + t * (ys[i] - ys[i - 1])
    }
  }
  return ys[ys.length - 1]
}

/** Ýygylyk oranı: inwertörde Hz/50, şebekede (ya da bilinmiyorsa) 1 */
export function speedRatio(hz: number | null, inverter: boolean): number {
  return inverter && hz !== null && hz > 5 ? Math.min(hz / 50, 1.1) : 1
}

/** Basınçtan (bar) basma yüksekliği (m); dz = nasos ekseni − suw derejesi */
export function headOf(pressBar: number, rho: number, dz: number | null): number {
  return pressBar * 1e5 / (rho * 9.81) + (dz ?? 0)
}

/** Nasosun mil gücünden (kW) debi (m³/s), ölçekli egride */
export function qFromPower(m: EgriModel, shaftKw: number, r: number): number | null {
  const q0 = interp(m.p, m.q, shaftKw / r ** 3)
  return q0 === null ? null : q0 * r
}

/** Ölçülen elektrik gücü (kW) ya da toktan (A) nasos mil gücü */
export function shaftKw(doc: EgriDoc, kw: number | null, amp: number | null): number | null {
  const eta = doc.motor_verim ?? 0.965
  if (kw !== null && kw > 1) return kw * eta
  if (amp !== null && amp > 0.5) return Math.sqrt(3) * (doc.gerilim_v ?? 6000) * amp * (doc.cos_phi ?? 0.85) / 1000 * eta
  return null
}

// --------------------------------------------------------------------------- //
// Geçmiş: zawod egrisi bilen häzirki ýagdaýyň deňeşdirmesi
// --------------------------------------------------------------------------- //

/** 50 Hz'e indirgenmiş geçmiş nokta. inv: inwertorda ölçülen (ýygylyk < 49,5 Hz) */
export interface NormPoint { t: number; q: number; h: number; inv: boolean }

/**
 * Nasos inwertorda (ýygylyk r = Hz/50) ölçülen nokta benzerlik yasalarıyla 50 Hz'e
 * indirgenir: Q/r, H/r². Böylece inwertordaki ve transformatordaki noktalar aynı
 * zawod egrisiyle deňeşdirilir.
 */
export const to50 = (q: number, h: number, r: number) => ({ q: q / r, h: h / (r * r) })

/**
 * Zawod egrisinden tapawut (%): noktaların (H_ölçülen − H_egri(Q)) / H_egri(Q) medyanı.
 * Medyan: geçiş anlarındaki (işe başlama, duruş) tek tük sapmalar sonucu bozmasın.
 * En az 5 nokta egriniň aralygynda olmalı; yoksa null.
 */
export function tapawut(m: EgriModel, pts: { q: number; h: number }[]): number | null {
  const d: number[] = []
  for (const p of pts) {
    const he = interp(m.q, m.h, p.q)
    if (he !== null && he > 0) d.push((p.h - he) / he)
  }
  if (d.length < 5) return null
  d.sort((a, b) => a - b)
  const k = Math.floor(d.length / 2)
  return (d.length % 2 ? d[k] : (d[k - 1] + d[k]) / 2) * 100
}

/** Tapawut bahasy: ISO 9906 2B çydamlylygy ±5 % (H) */
export function tapawutSev(dev: number | null): 'ok' | 'warn' | 'fault' | null {
  if (dev === null) return null
  const a = Math.abs(dev)
  return a <= 5 ? 'ok' : a <= 10 ? 'warn' : 'fault'
}

export interface GecmisPump {
  id: string; model: EgriModel | null
  /** nasos okunyň beýikligi (m) */
  axis: number | null
  /** kendi emme hücresinin seviye etiketi (LT); yoksa havuzunki kullanılır */
  lvlTag: string | null
  press: string; kw: string; amp: string; hz: string
}

/**
 * Geçmiş kovalarından bir nasosun 50 Hz'e indirgenmiş iş nokatları. Her kovada
 * toplumun bütün nasosları değerlendirilir (akym ölçegi işleýänlere bölünür);
 * işleýär = kuwwat motoryň 5 %-inden köp (ýa-da kuwwat ýok, tok > 2 A).
 */
export function gecmisNokatlar(doc: EgriDoc, pumps: GecmisPump[], flowTags: string[], basinTag: string,
                               invert: number, data: Record<string, [number, number, number, number][]>,
                               target: string): NormPoint[] {
  const at = new Map<string, Map<number, number>>()
  const get = (tag: string | null, t: number): number | null => {
    if (!tag) return null
    let mp = at.get(tag)
    if (!mp) { mp = new Map((data[tag] ?? []).map((b) => [Math.round(b[0]), b[1]])); at.set(tag, mp) }
    const v = mp.get(t)
    return v === undefined || !Number.isFinite(v) ? null : v
  }
  const me = pumps.find((p) => p.id === target)
  if (!me) return []
  const out: NormPoint[] = []
  for (const b of data[me.press] ?? []) {
    const t = Math.round(b[0])
    const flows = flowTags.map((f) => get(f, t))
    const flow = flows.some((f) => f !== null) ? flows.reduce<number>((a, f) => a + (f ?? 0), 0) : null
    const basin = get(basinTag, t)
    const inputs: PumpInput[] = pumps.map((p) => {
      const kw = get(p.kw, t), amp = get(p.amp, t), hz = get(p.hz, t)
      const motor = p.model?.motor_kw ?? 100
      const running = kw !== null ? kw > motor * 0.05 : amp !== null && amp > 2
      const lvl = get(p.lvlTag, t) ?? basin
      return {
        id: p.id, model: p.model, running, inverter: hz !== null && hz > 5 && hz < 49.5,
        press: get(p.press, t), kw, amp, hz,
        dz: p.axis !== null && lvl !== null ? p.axis - (invert + lvl) : null,
      }
    })
    const pt = isNokatlary(doc, inputs, flow)[target]
    if (pt?.q == null || pt.h == null || pt.q <= 0) continue
    const n = to50(pt.q, pt.h, pt.r)
    out.push({ t: b[0], q: n.q, h: n.h, inv: pt.r < 0.99 })
  }
  return out
}

export interface PumpInput {
  id: string; model: EgriModel | null; running: boolean; inverter: boolean
  press: number | null; kw: number | null; amp: number | null; hz: number | null
  /** nasos ekseni − emme suyunun seviyesi (m); seviye yoksa null */
  dz: number | null
}
export interface IsNokady {
  q: number | null; h: number | null; r: number
  qUsul: 'akym' | 'kuwwat' | null
  dz: number | null
}

/**
 * Bir toplumun işleýän nasoslarının iş nokatları. flowM3h: toplumun bütün
 * çıkış borularının akymı toplamı (yoksa null).
 */
export function isNokatlary(doc: EgriDoc, pumps: PumpInput[], flowM3h: number | null): Record<string, IsNokady> {
  const rho = doc.rho ?? 992
  const out: Record<string, IsNokady> = {}
  const run = pumps.filter((p) => p.running)
  const est: Record<string, number | null> = {}
  for (const p of run) {
    const r = speedRatio(p.hz, p.inverter)
    const sk = shaftKw(doc, p.kw, p.amp)
    est[p.id] = p.model && sk !== null ? qFromPower(p.model, sk, r) : null
  }
  const total = flowM3h !== null && flowM3h > 0 ? flowM3h / 3600 : null
  // Eşit bölme yalnız aynı model VE aynı hızda (inwertorda yavaş dönen nasos o an az basar ya da hiç basmaz)
  const r0 = run.length ? speedRatio(run[0].hz, run[0].inverter) : 1
  const sameModel = run.length > 0 && run.every((p) => p.model && p.model === run[0].model
    && Math.abs(speedRatio(p.hz, p.inverter) - r0) < 0.01)
  const estSum = run.reduce((a, p) => a + (est[p.id] ?? NaN), 0)
  for (const p of pumps) {
    const r = speedRatio(p.hz, p.inverter)
    if (!p.running) { out[p.id] = { q: null, h: null, r, qUsul: null, dz: p.dz }; continue }
    let q: number | null = null
    let qUsul: IsNokady['qUsul'] = null
    if (total !== null && (sameModel || run.length === 1)) { q = total / run.length; qUsul = 'akym' }
    else if (total !== null && Number.isFinite(estSum) && estSum > 0) { q = (est[p.id] as number) * total / estSum; qUsul = 'akym' }
    else if (est[p.id] !== null) { q = est[p.id]; qUsul = 'kuwwat' }
    const h = p.press !== null ? headOf(p.press, rho, p.dz) : null
    out[p.id] = { q, h, r, qUsul, dz: p.dz }
  }
  return out
}
