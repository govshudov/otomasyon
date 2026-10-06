import { useEffect, useState, type ReactElement } from 'react'
import { useTwin } from '../data/store'
import type { Group } from '../data/pump'
import { Icon, Logo } from './icons'

/**
 * Uygulama çerçevesi: üst başlık (beket · duýduryş sayısı · son duýduryş ·
 * sagat · ulanyjy · doly ekran) ve sol menü (referans panonun menüsü;
 * Network / Systems / Message Panel / Security çıkarıldı, Pump Stations →
 * Toplumlar). "Karta" istasyondaki harita Px'ini içerik alanında gösterir.
 */

export type Page = 'map' | 'overview' | `group:${string}` | 'karta' | 'alarms' | 'reports' | 'charts'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function Header({ sid, user, onMenu, onAlarms }: {
  sid: string; user: string; onMenu: () => void; onAlarms: () => void
}) {
  const alarms = useTwin((s) => s.alarms)
  const connected = useTwin((s) => s.connected)
  const alive = useTwin((s) => s.sourceAlive)
  const dataStale = useTwin((s) => s.dataStale)
  const dataTs = useTwin((s) => s.dataTs)
  const pb = useTwin((s) => s.playback)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const unack = alarms.filter((a) => a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK').length
  const top = alarms.find((a) => a.state === 'UNACK_ALM' || a.state === 'ACKED_ALM') ?? alarms[0]
  const link = pb.active ? { c: 'warn', t: 'TARYH' }
    : !connected ? { c: 'bad', t: 'ARAGATNAŞYK ÝOK' }
    : !alive ? { c: 'bad', t: 'MAGLUMAT ÝOK' }
    : dataStale ? { c: 'warn', t: `KÖNE MAGLUMAT${dataTs ? ' · ' + new Date(dataTs).toLocaleDateString('en-GB') : ''}` }
    : null

  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <header className="hdr">
      <button className="icon flat" onClick={onMenu} title="Menýu"><Icon.menu size={20} /></button>
      <button className="hdrStation flat" onClick={onAlarms} title="Duýduryşlar">
        <Icon.pumps size={19} />
        <b>{sid}</b>
        <span className={unack ? 'cnt bad' : 'cnt'}>{unack}/{alarms.length}</span>
        <span className={`bell${unack ? ' ring' : ''}`}><Icon.bell size={17} /></span>
      </button>
      <div className="hdrMid">
        {top ? (
          <button className={`hdrAlarm flat ${top.level === 'ALARM' ? 'bad' : 'mid'}${top.state === 'UNACK_ALM' ? ' blink' : ''}`}
                  onClick={onAlarms}>
            <Icon.bell size={15} /> {sid} / {top.msg}
          </button>
        ) : <span className="hdrQuiet">Işjeň duýduryş ýok</span>}
      </div>
      {link && <span className={`pill ${link.c}`}>● {link.t}</span>}
      <div className="hdrClock">
        <span>{now.getFullYear()}/{pad2(now.getMonth() + 1)}/{pad2(now.getDate())}</span>
        <b>{pad2(now.getHours())}:{pad2(now.getMinutes())}:{pad2(now.getSeconds())}</b>
      </div>
      <span className="hdrUser"><Icon.user size={19} />{user}</span>
      <button className="icon flat" onClick={full} title="Doly ekran"><Icon.full size={18} /></button>
    </header>
  )
}

export function Sidebar({ page, setPage, groups, collapsed }: {
  page: Page; setPage: (p: Page) => void; groups: Group[]; collapsed: boolean
}) {
  const nAlarm = useTwin((s) => s.alarms.length)
  const [open, setOpen] = useState(true)
  const item = (p: Page, icon: ReactElement, label: string, extra?: ReactElement) => (
    <button className={`navItem${page === p ? ' on' : ''}`} onClick={() => setPage(p)} title={label}>
      {icon}<span>{label}</span>{extra}
    </button>
  )
  const inGroup = page.startsWith('group:')
  return (
    <nav className={`side${collapsed ? ' mini' : ''}`}>
      {item('map', <Icon.cube />, '3D ekiz')}
      {item('overview', <Icon.overview />, 'Umumy syn')}
      <button className={`navItem${inGroup ? ' on' : ''}`} title="Toplumlar"
              onClick={() => (collapsed ? setPage(`group:${groups[0]?.id ?? ''}`) : setOpen((o) => !o))}>
        <Icon.pumps /><span>Toplumlar</span>
        <i className={`chev${open ? ' open' : ''}`}><Icon.chevron size={15} /></i>
      </button>
      {open && !collapsed && groups.map((g) => (
        <button key={g.id} className={`navSub${page === `group:${g.id}` ? ' on' : ''}`} onClick={() => setPage(`group:${g.id}`)}>
          {g.name}<small>{g.pumps.length} nasos</small>
        </button>
      ))}
      {item('karta', <Icon.map />, 'Karta')}
      {item('alarms', <Icon.bell />, 'Duýduryşlar', nAlarm ? <b className="navBadge">{nAlarm}</b> : undefined)}
      {item('reports', <Icon.report />, 'Hasabatlar')}
      {item('charts', <Icon.chart />, 'Grafikler')}
      <div className="sideFoot"><Logo size={collapsed ? 26 : 30} /><span><b>Suw göteriji</b>Sanly ekiz</span></div>
    </nav>
  )
}
