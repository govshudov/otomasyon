/**
 * Nokta adı → görünen ad, common/sozluk.json'a göre (bağımlılıksız: node ile de çalışır,
 * bkz. tools/sozluk-onizle.mjs).
 *
 *   BA4_G9_Toplam                         → Beton akaba 4 · Gatla 9 · jemi
 *   MT1_1_S1_Akym                         → Turbaly suw geçiriji 1-1 · Sazlaýjy 1 · akym
 *   N$2d10_Inverter                       → Nasos 10 · inwertor
 *   Awankamera$20M$2d1$20Suw$20Derejesi   → Awankamera M-1 Suw Derejesi
 */
export type OlcegTuru = 'akym' | 'sanag' | 'ortaca'

export interface Sozluk {
  kisaltmalar: Record<string, string>
  sozler: Record<string, string>
  /** adın içindeki tek başına sayının karşılığı (MT1_1_S1 → "Liniýa" 1) */
  sayi?: string
  /** adın sonu → ölçeg türü ("_aciklama" anahtarı yok sayılır) */
  olcegler?: Record<string, OlcegTuru | string>
  duzeltmeler: Record<string, string>
}

/** Niagara ad kaçışlarını çözer: "$20" → " ", "$2d" → "-", "$u00fd" → "ý". */
export function unescapeName(s: string): string {
  return s
    .replace(/\$u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\$([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

export function etiket(name: string, soz: Sozluk | null): string {
  if (soz?.duzeltmeler[name]) return soz.duzeltmeler[name]
  const plain = unescapeName(name)
  if (!soz) return plain
  const tok = plain.split('_')
  const out: string[] = []
  for (let i = 0; i < tok.length; i++) {
    // iki parçalı sözcükler önce (Suw_Tizligi, gpio_input)
    const two = i + 1 < tok.length ? `${tok[i]}_${tok[i + 1]}` : ''
    if (two && soz.sozler[two]) { out.push(soz.sozler[two]); i++; continue }
    const t = tok[i]
    const m = /^([A-Za-z]+)-?(\d+)$/.exec(t)
    if (m && soz.kisaltmalar[m[1]]) { out.push(`${soz.kisaltmalar[m[1]]} ${m[2]}`); continue }
    if (soz.kisaltmalar[t] && soz.kisaltmalar[t] !== t) { out.push(soz.kisaltmalar[t]); continue }   // sayısız: BG
    // yalnız sayı: sözlükteki "sayi" karşılığıyla (MT1_1 → MT 1 · Liniýa 1); yoksa öncekine bağlanır
    if (/^\d+$/.test(t) && out.length) {
      if (soz.sayi) out.push(`${soz.sayi} ${t}`)
      else out[out.length - 1] += `-${t}`
      continue
    }
    out.push(soz.sozler[t] ?? t)
  }
  const s = out.join(' · ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
