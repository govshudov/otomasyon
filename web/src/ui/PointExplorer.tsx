import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bucket } from '../data/history'
import { loadDbTree, type DbEnjam, type DbGroup } from '../data/sozluk'
import { ChartBoard, type ChartSpec } from './ChartBoard'
import { Icon } from './icons'

/**
 * Ähli nokatlar: veritabanındaki enjamlar (Milesight dahil) gruplarıyla, adları sözlükten.
 * Grup açılınca enjamları (Gatla 1, Gatla 2…) listelenir; enjama tıklayınca ölçegleri
 * (Akym, Toplam) sağda üst üste grafik olarak açılır. Veri TimescaleDB'den.
 */

const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa']

export function PointExplorer({ sid }: { sid: string }) {
  const [groups, setGroups] = useState<DbGroup[] | null | undefined>(undefined)   // undefined: ýüklenýär, null: ýok
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(() => {
    try { return localStorage.getItem(`twin.enjam.${sid}`) } catch { return null }
  })

  useEffect(() => { loadDbTree().then(setGroups, () => setGroups(null)) }, [])
  useEffect(() => {
    try { if (sel) localStorage.setItem(`twin.enjam.${sid}`, sel) } catch { /* depolama kapalı */ }
  }, [sid, sel])

  const current = useMemo(() => {
    for (const g of groups ?? []) for (const e of g.enjamlar) if (e.key === sel) return { g, e }
    return null
  }, [groups, sel])

  // Seçili enjamın grubu açık gelsin
  useEffect(() => { if (current) setOpen((o) => (o.has(current.g.key) ? o : new Set(o).add(current.g.key))) }, [current])

  const shown = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tk')
    if (!s) return groups ?? []
    return (groups ?? []).map((g) => ({
      ...g,
      enjamlar: g.label.toLocaleLowerCase('tk').includes(s) ? g.enjamlar
        : g.enjamlar.filter((e) => `${e.full} ${e.key}`.toLocaleLowerCase('tk').includes(s)),
    })).filter((g) => g.enjamlar.length)
  }, [groups, q])

  const flip = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })

  return (
    <div className="ptx">
      <aside className="ptxList">
        <div className="ptxSearch">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gözle…" />
        </div>
        {groups === undefined && <div className="empty">ýüklenýär…</div>}
        {groups === null && <div className="empty">Maglumat binýady elýeterli däl (TsOkuma hyzmaty ýok)</div>}
        {shown.map((g) => {
          const isOpen = !!q.trim() || open.has(g.key)
          return (
            <div key={g.key} className="ptxGrp">
              <button className={`ptxGrpHead${isOpen ? ' open' : ''}${current?.g.key === g.key ? ' cur' : ''}`} onClick={() => flip(g.key)}>
                <Icon.chevron size={13} />
                <span>{g.label}</span>
                <i>{g.enjamlar.length}</i>
              </button>
              {isOpen && g.enjamlar.map((e) => (
                <button key={e.key} className={`ptxPt${e.key === sel ? ' on' : ''}`} onClick={() => setSel(e.key)} title={e.full}>
                  <span>{e.label}</span>
                </button>
              ))}
            </div>
          )
        })}
      </aside>
      <div className="ptxCharts">
        {current
          ? <EnjamCharts sid={sid} g={current.g} e={current.e} />
          : <div className="cbEmpty">Çepdäki sanawdan enjam saýlaň</div>}
      </div>
    </div>
  )
}

function EnjamCharts({ sid, g, e }: { sid: string; g: DbGroup; e: DbEnjam }) {
  const tags = useMemo(() => e.olcegler.map((o) => `db:${o.name}`), [e])
  const build = useCallback((d: Record<string, Bucket[]>): ChartSpec[] => e.olcegler.map((o, i) => ({
    key: o.name, title: o.label || e.label, unit: o.unit ?? undefined, digits: o.kind === 'sanag' ? 0 : 2,
    fill: o.kind !== 'sanag', stats: o.kind !== 'sanag',
    series: [{ label: o.label || e.label, color: COLORS[i % COLORS.length], data: d[`db:${o.name}`] ?? [] }],
  })), [e])
  const title = e.label === 'Umumy' || e.full === g.label ? g.label : e.full.startsWith(g.label) ? e.full : `${g.label} · ${e.label}`
  return <ChartBoard title={title} tags={tags} build={build} stack fileName={`${sid}_${e.key}`} />
}
