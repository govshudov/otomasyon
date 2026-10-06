import { useTwin } from '../data/store'

const SPEEDS = [1, 8, 60, 300]

const fmt = (s: number) =>
  new Date(s * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

/**
 * Geçmiş oynatma çubuğu.
 *
 * Oynatma açıkken canlı akış arka planda devam eder ama ekranı ezmez —
 * "canlıya dön" ile tek tuşta güncel duruma dönülür. Operatör bir olayı
 * incelerken tesis kendi haline devam ediyor, ekran donmuyor.
 */
export function Timeline() {
  const pb = useTwin((s) => s.playback)
  const seek = useTwin((s) => s.seek)
  const setPlaying = useTwin((s) => s.setPlaying)
  const setSpeed = useTwin((s) => s.setSpeed)
  const exit = useTwin((s) => s.exitPlayback)
  const seeded = useTwin((s) => s.historySeeded)

  if (!pb.active) return null
  const span = Math.max(pb.to - pb.from, 1)
  const pct = ((pb.ts - pb.from) / span) * 100

  return (
    <div className="timeline">
      <button className={pb.playing ? 'on' : ''} onClick={() => setPlaying(!pb.playing)}>
        {pb.playing ? '❚❚' : '▶'}
      </button>
      <div className="track">
        <input type="range" min={pb.from} max={pb.to} step={1} value={pb.ts}
               onChange={(e) => seek(+e.target.value)} />
        <div className="ticks">
          <span>{fmt(pb.from)}</span>
          <span className="cursor">{fmt(pb.ts)}{pb.loading ? ' …' : ''}</span>
          <span>{fmt(pb.to)}</span>
        </div>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={pb.speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
      </div>
      {seeded && <span className="demoTag" title="Taryhy maglumat demo üçin döredildi, ölçeg däl">demo maglumaty</span>}
      <button onClick={exit}>Janly görnüşe dolan</button>
    </div>
  )
}
