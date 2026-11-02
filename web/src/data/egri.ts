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
  const sameModel = run.length > 0 && run.every((p) => p.model && p.model === run[0].model)
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
