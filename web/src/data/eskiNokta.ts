/**
 * Eski TV arayüzünün nasos noktaları (eski_noktalar.json): nasos popup'ı (nasos.html) Twin
 * noktalarını değil, eski Px sayfalarının okuduğu noktaları doğrudan okur. Böylece popup'ta
 * eski sayfalarda ne görünüyorsa o görünür ve hiçbir nokta elle bağlanmaz.
 */
import { asset, loadBaja } from './niagara'

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
    else if (v !== null && typeof v === 'object') v = typeof v.getTag === 'function' ? v.getTag() : String(v)
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

// ---- eski Px sayfalarındaki dönüşümler (aynı kodlar, aynı yazılar) -------------------------- //
// Niagara aralık eşlemesi "a:b": (a, b] — 0 = Durýar / Näsazlyk ýok, 1, 2 … sonraki aralıklar.
const idx = (v: number) => (v <= 0 ? 0 : Math.ceil(v))

export const YAGDAY = ['Durýar', 'Transformatorda', 'Inwertorda']
export const yagdayOf = (v: number | null) => (v === null ? null : idx(v) <= 2 ? YAGDAY[idx(v)] : 'Işleýär')

const NASAZ = ['Näsazlyk ýok', 'Suwyň derejesi pes', 'Nasos gyzgynlygy ýokary', 'Suw pes we gyzgynlyk',
  'Amper ýokary', 'Amper ýokary we suw pes', 'Amper ýokary we gyzgynlyk', 'Amper, gyzgynlyk we suw pes']
export const nasazOf = (v: number | null) => (v === null ? null : NASAZ[idx(v)] ?? 'Näsazlyk ýok')

/** VANALAR/StatusOfInPump: (0,1] ýapyk (kümüş), (1,2] açyk (ýaşyl), (2,6] näsaz (gyzyl) */
export const girisWana = (v: number | null) => (v === null ? null : idx(v) <= 1 ? 'ýapyk' : idx(v) === 2 ? 'açyk' : 'näsaz')
/** VANALAR/StatusOfOutPump: ≤0 açyk, (0,1] ýapyk, (1,2] açyk, (2,7] näsaz */
export const cykysWana = (v: number | null) => (v === null ? null : v <= 0 ? 'açyk' : idx(v) === 1 ? 'ýapyk' : idx(v) === 2 ? 'açyk' : 'näsaz')

export const num = (d?: EskiDeger) => (d && typeof d.v === 'number' ? d.v : d && typeof d.v === 'boolean' ? (d.v ? 1 : 0) : null)
