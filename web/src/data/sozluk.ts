/**
 * Sözlük ve veritabanındaki noktaların ağacı (istasyonda): grup → enjam → ölçeg.
 *
 *   BA1_G9_Toplam  →  Beton akaba 1  →  Gatla 9  →  Toplam (sanag)
 *   MT1_Jemi       →  Turbaly suw geçiriji 1  →  Umumy  →  Jemi (sanag)
 *   Awankamera M-1 Suw Derejesi  →  Awankamera  →  Awankamera M-1 Suw Derejesi  →  (tek ölçeg)
 *
 * Yalnız sözlükteki "olcegler" sonlarıyla biten noktalar alınır (Status, CMD, rssi… yok).
 * sozluk.json pakette durur (common/sozluk.json → file:^twin/sozluk.json); her açılışta
 * önbelleğe bakılmadan okunur. Nokta listesi TsOkuma servisinden gelir.
 */
import { asset, tsQuery } from './niagara'
import { etiket, unescapeName, type OlcegTuru, type Sozluk } from './etiket'

let sozP: Promise<Sozluk | null> | null = null

export function loadSozluk(): Promise<Sozluk | null> {
  sozP ??= fetch(asset('sozluk.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return sozP
}

export interface DbOlceg { key: string; label: string; kind: OlcegTuru; name: string; unit: string | null }
export interface DbEnjam { key: string; label: string; full: string; olcegler: DbOlceg[] }
export interface DbGroup { key: string; label: string; enjamlar: DbEnjam[] }

const HIDDEN = /^(TWIN_|AuditHistory$|LogHistory$|SecurityHistory$)/
const KINDS: OlcegTuru[] = ['akym', 'sanag', 'ortaca']
const cmp = (a: string, b: string) => a.localeCompare(b, 'tk', { numeric: true })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

let treeP: Promise<DbGroup[] | null> | null = null

/** Ağaç bir kez kurulur (sayfa yenilenene kadar); servis yoksa null. */
export function loadDbTree(): Promise<DbGroup[] | null> {
  treeP ??= build().catch(() => null)
  treeP.then((t) => { if (!t) treeP = null })        // servis sonradan kurulursa yeniden denensin
  return treeP
}

async function build(): Promise<DbGroup[] | null> {
  const [soz, res] = await Promise.all([loadSozluk(), tsQuery('op=points')])
  if (!res?.points) return null
  const olc = Object.entries(soz?.olcegler ?? { Akym: 'akym', Toplam: 'sanag' })
    .filter(([k, v]) => !k.startsWith('_') && KINDS.includes(v as OlcegTuru)) as [string, OlcegTuru][]
  const order = olc.map(([k]) => k)

  const groups = new Map<string, DbGroup>()
  for (const [name, , , unit] of res.points as [string, string, string, string | null, string][]) {
    if (HIDDEN.test(name)) continue
    const plain = unescapeName(name)
    let gKey: string, eKey: string, oKey: string, kind: OlcegTuru
    if (!plain.includes('_')) {
      gKey = plain.split(' ')[0]; eKey = plain; oKey = ''; kind = 'ortaca'
      if (gKey === plain) continue                  // tek sözcük (Akym, CMD…): hangi enjamın olduğu belli değil
    } else {
      const hit = olc.find(([k]) => plain.endsWith('_' + k))
      if (!hit) continue
      oKey = hit[0]; kind = hit[1]
      eKey = plain.slice(0, -(oKey.length + 1))
      gKey = eKey.split('_')[0]
    }
    let g = groups.get(gKey)
    if (!g) { g = { key: gKey, label: etiket(gKey, soz), enjamlar: [] }; groups.set(gKey, g) }
    let e = g.enjamlar.find((x) => x.key === eKey)
    if (!e) {
      const full = eKey === plain ? plain : etiket(eKey, soz)
      const short = full === g.label ? 'Umumy' : full.startsWith(g.label + ' · ') ? full.slice(g.label.length + 3) : full
      e = { key: eKey, label: cap(short), full, olcegler: [] }
      g.enjamlar.push(e)
    }
    // tek ölçegli adda (Awankamera M-1 Suw Derejesi) ölçeg adı boş: adın kendisi enjam adında
    e.olcegler.push({ key: oKey, label: oKey ? cap(soz?.sozler[oKey] ?? oKey) : '', kind, name, unit })
  }
  const out = [...groups.values()].sort((a, b) => cmp(a.label, b.label))
  for (const g of out) {
    // "Umumy" başta, sonra doğal sıra (Gatla 2 < Gatla 10)
    g.enjamlar.sort((a, b) => (a.label === 'Umumy' ? -1 : b.label === 'Umumy' ? 1 : cmp(a.label, b.label)))
    for (const e of g.enjamlar) e.olcegler.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return out
}
