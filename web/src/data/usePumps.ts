import { useEffect, useMemo, useState } from 'react'
import { useTwin } from './store'
import { levelSev, pumpView, type Group, type PumpView } from './pump'
import { queryHistory, type Bucket } from './history'

/** Görünen pompaların anlamlandırılmış durumu (canlı veya oynatılan an). */
export function usePumpViews(sid: string, groups: Group[]): Record<string, PumpView> {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const status = useTwin((s) => s.status)
  const twin = useTwin((s) => s.twinMap)
  return useMemo(() => {
    const lvl = levelSev(sid, values, stale, twin)
    const out: Record<string, PumpView> = {}
    for (const g of groups) for (const p of g.pumps) {
      out[p.id] = pumpView(sid, p, values, stale, twin, status[`${sid}.${p.id}`]?.state, lvl)
    }
    return out
  }, [sid, groups, values, stale, status, twin])
}

/** Son `minutes` dakikanın kovaları — kartlardaki küçük grafikler için, 30 sn'de bir. */
export function useRecent(tags: string[], minutes = 30, n = 60): Record<string, Bucket[]> {
  const [data, setData] = useState<Record<string, Bucket[]>>({})
  const key = tags.join('|')
  useEffect(() => {
    let ok = true
    const load = () => {
      const to = Date.now() / 1000
      queryHistory(tags, to - minutes * 60, to, n).then((r) => { if (ok) setData(r.data) }).catch(() => {})
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { ok = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, minutes, n])
  return data
}
