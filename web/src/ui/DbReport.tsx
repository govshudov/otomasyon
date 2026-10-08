import { Fragment, useEffect, useMemo, useState } from 'react'
import { queryHistory, type Bucket } from '../data/history'
import { loadDbTree, type DbEnjam, type DbGroup, type DbOlceg } from '../data/sozluk'
import { fmtN } from '../data/pump'
import { Icon } from './icons'

/**
 * Hasabat · ähli enjamlar: veritabanındaki enjamlar gruplarıyla (Beton akaba 1 → Gatla 1 …).
 *   akym   → döwürde ortaça / iň ýokary
 *   sanag  → soňky görkeziji / döwürde tapawut (başy bilen soňunyň tapawudy)
 *   ortaca → ortaça / iň pes / iň ýokary (aýratyn tablisa)
 */

interface Stat { avg: number; min: number; max: number; first: number; last: number }
export interface DbReportData { groups: DbGroup[] | null; stats: Map<string, Stat>; loading: boolean }

function stat(b: Bucket[] | undefined): Stat | undefined {
  if (!b?.length) return undefined
  let s = 0, mn = Infinity, mx = -Infinity
  for (const x of b) { s += x[1]; if (x[2] < mn) mn = x[2]; if (x[3] > mx) mx = x[3] }
  return { avg: s / b.length, min: mn, max: mx, first: b[0][1], last: b[b.length - 1][1] }
}

export function useDbReport(from: number, to: number): DbReportData {
  const [groups, setGroups] = useState<DbGroup[] | null>(null)
  const [stats, setStats] = useState<Map<string, Stat>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadDbTree().then(setGroups, () => setGroups(null)) }, [])

  useEffect(() => {
    if (!groups) { setLoading(false); return }
    let ok = true
    const names = groups.flatMap((g) => g.enjamlar.flatMap((e) => e.olcegler.map((o) => o.name)))
    setLoading(true)
    queryHistory(names.map((n) => `db:${n}`), from, to, 96)
      .then((r) => {
        if (!ok) return
        const m = new Map<string, Stat>()
        for (const n of names) { const s = stat(r.data[`db:${n}`]); if (s) m.set(n, s) }
        setStats(m)
      })
      .catch(() => {})
      .finally(() => { if (ok) setLoading(false) })
    return () => { ok = false }
  }, [groups, from, to])

  return { groups, stats, loading }
}

const of = (e: DbEnjam, kind: DbOlceg['kind']) => e.olcegler.find((o) => o.kind === kind)
const delta = (s?: Stat) => (s ? Math.max(0, s.last - s.first) : null)

/** Akym/sanag ölçegi olan enjamlar (ana tablo) ve diğer ölçegler (ikinci tablo). */
function split(groups: DbGroup[]) {
  const main = groups.map((g) => ({ g, rows: g.enjamlar.filter((e) => of(e, 'akym') || of(e, 'sanag')) })).filter((x) => x.rows.length)
  const other = groups.flatMap((g) => g.enjamlar.flatMap((e) => e.olcegler.filter((o) => o.kind === 'ortaca').map((o) => ({ g, e, o }))))
  return { main, other }
}

export function dbReportCsvRows({ groups, stats }: DbReportData): (string | number)[][] {
  if (!groups) return []
  const { main, other } = split(groups)
  const rows: (string | number)[][] = [[], ['Topar', 'Enjam', 'Akym ortaça', 'Akym iň ýokary', 'Sanag soňky', 'Döwürde (sanag tapawudy)']]
  for (const { g, rows: es } of main) for (const e of es) {
    const a = of(e, 'akym'), c = of(e, 'sanag')
    const sa = a && stats.get(a.name), sc = c && stats.get(c.name)
    rows.push([g.label, e.label, fmtN(sa?.avg ?? null, 2), fmtN(sa?.max ?? null, 2), fmtN(sc?.last ?? null, 0), fmtN(delta(sc), 0)])
  }
  if (other.length) {
    rows.push([], ['Topar', 'Enjam', 'Ölçeg', 'Ortaça', 'Iň pes', 'Iň ýokary'])
    for (const { g, e, o } of other) {
      const s = stats.get(o.name)
      rows.push([g.label, e.label, o.label || '—', fmtN(s?.avg ?? null, 2), fmtN(s?.min ?? null, 2), fmtN(s?.max ?? null, 2)])
    }
  }
  return rows
}

export function DbReportTables({ data }: { data: DbReportData }) {
  const { groups, stats, loading } = data
  const parts = useMemo(() => (groups ? split(groups) : null), [groups])
  // Gruplar kapalı gelir (Grafikler sayfasındaki gibi); başlığa tıklayınca açılır/kapanır
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (!parts) return null
  const st = (o?: DbOlceg) => (o ? stats.get(o.name) : undefined)
  const flip = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const allKeys = [...new Set([...parts.main.map((x) => x.g.key), ...parts.other.map((x) => `o:${x.g.key}`)])]
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k))
  const head = (key: string, label: string) => (
    <td><button className={`grpTgl${open.has(key) ? ' open' : ''}`} onClick={() => flip(key)}><Icon.chevron size={13} /><b>{label}</b></button></td>
  )
  const otherGroups = [...new Map(parts.other.map((x) => [x.g.key, x.g])).values()]

  return (
    <>
      <h3 className="rptH">
        Ähli enjamlar {loading && <small>ýüklenýär…</small>}
        <button className="ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}>{allOpen ? 'Ählisini ýap' : 'Ählisini aç'}</button>
      </h3>
      <table className="dtbl">
        <thead>
          <tr><th>Enjam</th>
            <th className="num">Akym<small>ortaça</small></th><th className="num">Akym<small>iň ýokary</small></th>
            <th className="num">Sanag<small>soňky</small></th><th className="num">Döwürde<small>sanag tapawudy</small></th></tr>
        </thead>
        <tbody>
          {parts.main.map(({ g, rows }) => {
            const sum = rows.reduce<number | null>((acc, e) => { const d = delta(st(of(e, 'sanag'))); return d === null ? acc : (acc ?? 0) + d }, null)
            return (
              <Fragment key={g.key}>
                <tr className="grpRow" onClick={() => flip(g.key)}>
                  {head(g.key, g.label)}<td className="num sub">{rows.length} enjam</td><td /><td /><td className="num"><b>{fmtN(sum, 0)}</b></td>
                </tr>
                {open.has(g.key) && rows.map((e) => {
                  const a = st(of(e, 'akym')), c = st(of(e, 'sanag'))
                  return (
                    <tr key={e.key}>
                      <td className="ind">{e.label}</td>
                      <td className="num">{fmtN(a?.avg ?? null, 2)}</td><td className="num">{fmtN(a?.max ?? null, 2)}</td>
                      <td className="num">{fmtN(c?.last ?? null, 0)}</td><td className="num"><b>{fmtN(delta(c), 0)}</b></td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {parts.other.length > 0 && (
        <table className="dtbl">
          <thead>
            <tr><th>Enjam</th><th>Ölçeg</th>
              <th className="num">Ortaça</th><th className="num">Iň pes</th><th className="num">Iň ýokary</th></tr>
          </thead>
          <tbody>
            {otherGroups.map((g) => {
              const rows = parts.other.filter((x) => x.g.key === g.key)
              return (
                <Fragment key={g.key}>
                  <tr className="grpRow" onClick={() => flip(`o:${g.key}`)}>
                    {head(`o:${g.key}`, g.label)}<td className="sub">{rows.length} ölçeg</td><td /><td /><td />
                  </tr>
                  {open.has(`o:${g.key}`) && rows.map(({ e, o }) => {
                    const s = st(o)
                    return (
                      <tr key={o.name}>
                        <td className="ind">{e.label}</td><td>{o.label || '—'}</td>
                        <td className="num">{fmtN(s?.avg ?? null, 2)}</td><td className="num">{fmtN(s?.min ?? null, 2)}</td><td className="num">{fmtN(s?.max ?? null, 2)}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
