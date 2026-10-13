import { useEffect, useState, type ReactElement } from 'react'
import { useTwin } from '../data/store'
import { Icon, Logo } from './icons'
import { StationPicker, type StationInfo } from './StationPicker'

/**
 * Uygulama çerçevesi: üst başlık (beket adı · duýduryş sayısı · son duýduryş ·
 * sagat · ulanyjy · doly ekran) ve sol menü. "Karta" istasyondaki harita Px'ini
 * içerik alanında gösterir.
 *
 * Her ekrana TEK yol: soldaki menü. Başlıktaki duýduryş sayısı ve son duýduryş
 * yalnız göstergedir, tıklanmaz. Menü sırası operatörün iş akışı: genel bakış →
 * 3D → duýduryşlar → grafikler → hasabatlar → karta.
 */

export type Page = 'overview' | 'map' | 'alarms' | 'charts' | 'reports' | 'karta'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function Header({ sid, user, onMenu, onStation }: {
  sid: string; user: string; onMenu: () => void; onStation: (s: StationInfo) => void
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
      <div className="hdrStation">
        <Icon.pumps size={19} />
        <StationPicker current={sid} onSelect={onStation} />
        <span className={unack ? 'cnt bad' : 'cnt'} title="Tassyklanmadyk / ähli duýduryşlar">{unack}/{alarms.length}</span>
        <span className={`bell${unack ? ' ring' : ''}`}><Icon.bell size={17} /></span>
      </div>
      <div className="hdrMid">
        {top ? (
          <span className={`hdrAlarm ${top.level === 'ALARM' ? 'bad' : 'mid'}${top.state === 'UNACK_ALM' ? ' blink' : ''}`}>
            <Icon.bell size={15} /> {top.msg}
          </span>
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

export function Sidebar({ page, setPage, collapsed }: {
  page: Page; setPage: (p: Page) => void; collapsed: boolean
}) {
  const nAlarm = useTwin((s) => s.alarms.length)
  const item = (p: Page, icon: ReactElement, label: string, extra?: ReactElement) => (
    <button className={`navItem${page === p ? ' on' : ''}`} onClick={() => setPage(p)} title={label}>
      {icon}<span>{label}</span>{extra}
    </button>
  )
  return (
    <nav className={`side${collapsed ? ' mini' : ''}`}>
      {item('overview', <Icon.overview />, 'Umumy syn')}
      {item('map', <Icon.cube />, 'Sanly ekiz')}
      {item('alarms', <Icon.bell />, 'Duýduryşlar', nAlarm ? <b className="navBadge">{nAlarm}</b> : undefined)}
      {item('charts', <Icon.chart />, 'Grafikler')}
      {item('reports', <Icon.report />, 'Hasabatlar')}
      {item('karta', <Icon.map />, 'Karta')}
      <div className="sideFoot"><Logo size={collapsed ? 26 : 30} /><span><b>Suw göteriji</b>Sanly ekiz</span></div>
    </nav>
  )
}
