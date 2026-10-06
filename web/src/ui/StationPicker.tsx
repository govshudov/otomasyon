import { useEffect, useState } from 'react'
import { fetchStations } from '../data/niagara'

export interface StationInfo {
  id: string; name: string; description: string
  pumps: number; headers: number; cells: number; equipment: number
  model: string; twin_map: string
  /** Model parçalar hâlinde (JACE paketi): sırayla uç uca eklenir */
  model_parts?: string[]
  source_alive: boolean; alarms: number
}

/**
 * İstasyon seçici.
 *
 * Bir tesiste birden çok terfi merkezi olması kural. Liste sunucudan gelir —
 * `stations/` dizinine yeni bir JSON düşünce arayüzde kendiliğinden belirir,
 * frontend'de hiçbir şey değişmez.
 */
export function StationPicker({ current, onSelect }: {
  current: string
  onSelect: (s: StationInfo) => void
}) {
  const [list, setList] = useState<StationInfo[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const load = () => fetchStations()
      .then((d) => setList(d.stations ?? [])).catch(() => {})
    load()
    const t = setInterval(load, 15_000)     // alarm sayıları tazelensin
    return () => clearInterval(t)
  }, [])

  const cur = list.find((s) => s.id === current)
  if (!list.length) return null

  return (
    <div className="picker">
      <button className="trigger" onClick={() => setOpen((v) => !v)}>
        <b>{cur?.name ?? current}</b>
        <span className="meta">{cur ? `${cur.pumps} nasos` : ''}</span>
        <i>{open ? '▴' : '▾'}</i>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="menu">
            {list.map((s) => (
              <button key={s.id} className={s.id === current ? 'on' : ''}
                      onClick={() => { setOpen(false); if (s.id !== current) onSelect(s) }}>
                <div className="row1">
                  <b>{s.name}</b>
                  <span className={`dot ${s.source_alive ? 'live' : 'dead'}`} />
                </div>
                <div className="row2">
                  {s.id} · {s.pumps} nasos · {s.headers} kollektor · {s.cells} öýjük
                  {s.alarms > 0 && <em className="bad"> · {s.alarms} duýduryş</em>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
