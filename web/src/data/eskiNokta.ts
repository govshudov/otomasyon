/**
 * Eski TV arayüzünün nasos noktaları (eski_noktalar.json): nasos popup'ı (nasos.html) Twin
 * noktalarını değil, eski Px sayfalarının okuduğu noktaları doğrudan okur. Böylece popup'ta
 * eski sayfalarda ne görünüyorsa o görünür ve hiçbir nokta elle bağlanmaz.
 */
import { useEffect, useState } from 'react'
import { asset, loadBaja } from './niagara'

/** Deneme: nasos.html?demo#PMP-03 — Niagara'sız, örnek değerler (eski_noktalar.json da okunmaz) */
export const DEMO = new URLSearchParams(location.search).has('demo')

export interface EskiCfg {
  kok: string
  toplumlar: { klasor: string; yaceyka?: string; nasoslar: number[] }[]
  noktalar: Record<string, string[]>
}

export interface EskiDeger {
  /** sayı / bool / metin; okunamadıysa null */
  v: number | boolean | string | null
  /** Niagara'nın gösterim metni (birim ve hassasiyet noktanın facets'inden), durum eki olmadan */
  disp: string
  ok: boolean
}

export const loadEskiCfg = (): Promise<EskiCfg> =>
  fetch(asset(`eski_noktalar.json?v=${Date.now()}`), { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('eski_noktalar.json ýok')
    return r.json()
  })

/** Nasos N için her anahtarın aday ORD'ları (şablon yer tutucuları doldurulmuş). */
export function nasosOrds(cfg: EskiCfg, n: number): { ords: Record<string, string[]>; toplum: string | null } {
  const tp = cfg.toplumlar.find((t) => t.nasoslar.includes(n))
  const k = tp ? tp.nasoslar.indexOf(n) + 1 : n
  const fill = (p: string) => p.replace(/\{n\}/g, String(n)).replace(/\{k\}/g, String(k))
    .replace(/\{t\}/g, tp?.klasor ?? '').replace(/\{y\}/g, tp?.yaceyka ?? '')
  const ords: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(cfg.noktalar)) {
    // Toplumu olmayan nasosta toplum klasörüne bağlı yollar atlanır
    const ok = list.filter((p) => tp || !/\{[ty]\}/.test(p))
    ords[key] = ok.map((p) => `${cfg.kok}/${fill(p).replace(/\/out$/, '')}`)
  }
  return { ords, toplum: tp?.klasor ?? null }
}

function oku(comp: any): EskiDeger {
  try {
    const sv = comp.get('out')
    if (!sv) return { v: null, disp: '', ok: false }
    let v = sv.getValue ? sv.getValue() : sv
    if (v instanceof Number || v instanceof Boolean || v instanceof String) v = v.valueOf()
    // Enum noktası (ör. PowerMode): eski Px'teki dönüşümler sıra numarasını (ordinal) kullanır
    else if (v !== null && typeof v === 'object') v = typeof v.getOrdinal === 'function' ? v.getOrdinal()
      : typeof v.getTag === 'function' ? v.getTag() : String(v)
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v)
    if (typeof v === 'number' && Number.isNaN(v)) v = null
    const st = sv.getStatus?.()
    const ok = st ? (typeof st.isValid === 'function' ? st.isValid()
      : !(st.isFault?.() || st.isDown?.() || st.isStale?.() || st.isDisabled?.() || st.isNull?.())) : true
    let disp = ''
    try { disp = String(comp.getDisplay('out') ?? '') } catch { /* gösterim yok */ }
    disp = disp.replace(/\s*\{[^}]*\}\s*$/, '').replace(/\s*@\s*\w+$/, '').trim()
    return { v, disp, ok }
  } catch {
    return { v: null, disp: '', ok: false }
  }
}

/**
 * Noktalara abone olur; her değişimde onChange(anahtar, değer). Bulunamayan anahtarlar `missing`te.
 * Dönen stop() aboneliği bırakır.
 */
export async function abone(ords: Record<string, string[]>, onChange: (key: string, d: EskiDeger) => void):
  Promise<{ stop: () => void; missing: { key: string; ords: string[] }[] }> {
  const baja: any = await loadBaja()
  const sub = new baja.Subscriber()
  const byHandle = new Map<string, string>()
  sub.attach('changed', function (this: any, prop: any) {
    if (prop.getName() !== 'out') return
    const key = byHandle.get(String(this.getHandle()))
    if (key) onChange(key, oku(this))
  })
  const missing: { key: string; ords: string[] }[] = []
  await Promise.all(Object.entries(ords).map(async ([key, list]) => {
    for (const ord of list) {
      try {
        const comp = await baja.Ord.make(ord).get({ subscriber: sub })
        if (!comp || typeof comp.get !== 'function' || !comp.getHandle) continue
        byHandle.set(String(comp.getHandle()), key)
        onChange(key, oku(comp))
        return
      } catch { /* sıradaki aday */ }
    }
    missing.push({ key, ords: list })
  }))
  if (missing.length) console.warn('[nasos] tapylmadyk nokatlar:', missing.map((m) => `${m.key}: ${m.ords.join(' | ')}`).join('\n'))
  return { stop: () => { try { sub.unsubscribeAll() } catch { /* */ } }, missing }
}

/** Nasos N'in eski noktaları (canlı abonelik; deneme modunda örnek değerler). */
export function useEskiNokatlar(n: number): { vals: Record<string, EskiDeger>; missing: string[]; err: string | null } {
  const [vals, setVals] = useState<Record<string, EskiDeger>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!Number.isFinite(n)) return
    let ok = true, stop = () => {}
    ;(async () => {
      if (DEMO) { setVals(demoDegerler(n)); return }
      const cfg = await loadEskiCfg()
      const { ords } = nasosOrds(cfg, n)
      const r = await abone(ords, (key, d) => { if (ok) setVals((s) => ({ ...s, [key]: d })) })
      stop = r.stop
      if (!ok) { stop(); return }
      setMissing(r.missing.map((m) => `${m.key}: ${m.ords.join(' | ')}`))
    })().catch((e) => ok && setErr(String(e?.message ?? e)))
    return () => { ok = false; stop() }
  }, [n])
  return { vals, missing, err }
}

/**
 * Deneme değerleri. Nasoslar biraz farklı (Px deneme sayfasında ayırt edilsin): tek numaralılar
 * transformatorda, çift numaralılar inwertorda (46 Hz). Basyş/akym/kuwwat RDLO 400-705 egrisine
 * yakın (≈ −2 %), H–Q penceresinde iş nokady egriniň ýanynda dursun.
 */
function demoDegerler(n: number): Record<string, EskiDeger> {
  const inv = n % 2 === 0
  const [basys, akym, suw, kuwwat, tok] = inv ? [6.19, 1400, 3.05, 313, 35.4] : n === 1 ? [7.39, 1490, 3.15, 396, 44.9] : [7.27, 1580, 3.2, 411, 46.5]
  const d: Record<string, [number, number?, string?]> = {
    yagday: [inv ? 2 : 1], duydurys: [n === 3 ? 1 : 0], nasazlyk: [0], status: [4],
    basys: [basys, 2, 'bar'], akym: [akym, 1, 'm³/h'], tizlik: [akym / 3600 / 0.19635, 2, 'm/s'], jemi: [1254870 + n * 73415, 0, 'm³'],
    suw: [suw, 2, 'm'], kuwwat: [kuwwat, 0, 'kW'], tok: [tok, 1, 'A'], ...(inv ? { ygylyk: [46, 1, 'Hz'] } : {}),
    giris_wana: [2], cykys_wana: [2],
    U1: [68, 1, '°C'], U2: [70, 1, '°C'], V1: [67, 1, '°C'], V2: [69, 1, '°C'], W1: [71, 1, '°C'], W2: [72, 1, '°C'],
    On: [48, 1, '°C'], Arka: [51, 1, '°C'],
  }
  const out: Record<string, EskiDeger> = {}
  for (const [k, [v, dig, u]] of Object.entries(d)) out[k] = { v, disp: u ? `${v.toFixed(dig)} ${u}` : '', ok: true }
  return out
}

// ---- eski Px sayfalarındaki dönüşümler (aynı kodlar, aynı yazılar) -------------------------- //
// Niagara aralık eşlemesi "a:b": (a, b] — 0 = Durýar / Näsazlyk ýok, 1, 2 … sonraki aralıklar.
const idx = (v: number) => (v <= 0 ? 0 : Math.ceil(v))

export const YAGDAY = ['Durýar', 'Transformatorda', 'Inwertorda']
export const yagdayOf = (v: number | null) => (v === null ? null : idx(v) <= 2 ? YAGDAY[idx(v)] : 'Işleýär')
/** PowerMode 1: transformatordan (şebeke, 50 Hz); 2: inwertordan */
export const transformatorda = (v: number | null) => v !== null && idx(v) === 1
export const inwertorda = (v: number | null) => v !== null && idx(v) === 2

const NASAZ = ['Näsazlyk ýok', 'Suwyň derejesi pes', 'Nasos gyzgynlygy ýokary', 'Suw pes we gyzgynlyk',
  'Amper ýokary', 'Amper ýokary we suw pes', 'Amper ýokary we gyzgynlyk', 'Amper, gyzgynlyk we suw pes']
export const nasazOf = (v: number | null) => (v === null ? null : NASAZ[idx(v)] ?? 'Näsazlyk ýok')

/** VANALAR/StatusOfInPump: (0,1] ýapyk (kümüş), (1,2] açyk (ýaşyl), (2,6] näsaz (gyzyl) */
export const girisWana = (v: number | null) => (v === null ? null : idx(v) <= 1 ? 'ýapyk' : idx(v) === 2 ? 'açyk' : 'näsaz')
/** VANALAR/StatusOfOutPump: ≤0 açyk, (0,1] ýapyk, (1,2] açyk, (2,7] näsaz */
export const cykysWana = (v: number | null) => (v === null ? null : v <= 0 ? 'açyk' : idx(v) === 1 ? 'ýapyk' : idx(v) === 2 ? 'açyk' : 'näsaz')

export const num = (d?: EskiDeger) => (d && typeof d.v === 'number' ? d.v : d && typeof d.v === 'boolean' ? (d.v ? 1 : 0) : null)
