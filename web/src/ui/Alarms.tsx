import { useTwin } from '../data/store'

const AGE = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return `${s | 0} sek`
  if (s < 3600) return `${(s / 60) | 0} min`
  return `${(s / 3600) | 0} sag`
}

export function Alarms({ onSelect, historical }: {
  onSelect: (equipment: string, component: string | null) => void
  /** Oynatmada: o ana ait eşik ihlalleri. Verilirse canlı liste yerine bu gösterilir. */
  historical?: { id: string; tag: string; equipment: string; component: string | null
                 level: 'WARN' | 'ALARM'; msg: string; value: number | boolean; ts_raised: number }[]
}) {
  const live = useTwin((s) => s.alarms)
  const ack = useTwin((s) => s.ack)
  const ackAll = useTwin((s) => s.ackAll)
  const isHist = historical !== undefined
  const alarms = (isHist
    ? historical!.map((v) => ({ ...v, state: 'UNACK_ALM' as const, ts_acked: 0, ts_cleared: 0 }))
    : live)
  const unack = alarms.filter((a) => a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK').length

  return (
    <div className="alarms">
      <div className="secTitle spread">
        <span>{isHist ? 'Çäk bozulmalary' : 'Duýduryşlar'} <b className={alarms.length ? 'bad' : ''}>{alarms.length}</b></span>
        {isHist
          ? <span className="sub">şol pursatdaky ýagdaý</span>
          : <button disabled={!unack} onClick={ackAll}>Hemmesini tassykla ({unack})</button>}
      </div>
      <div className="list">
        {alarms.length === 0 && <div className="empty">Işjeň duýduryş ýok.</div>}
        {alarms.map((a) => (
          <div key={a.id} className={`alarm ${a.level.toLowerCase()} ${a.state === 'RTN_UNACK' ? 'returned' : ''}`}
               onClick={() => onSelect(a.equipment, a.component)}>
            <div className="line1">
              <b>{a.equipment}</b>
              <span className="age">
                {isHist ? new Date(a.ts_raised).toLocaleTimeString('en-GB')
                  : a.state === 'RTN_UNACK' ? 'kadalaşdy' : AGE(a.ts_raised)}
              </span>
            </div>
            <div className="msg">{a.msg}</div>
            <div className="line2">
              <span className="sub">{a.component?.replace(/__/g, ' ') ?? 'enjam'}</span>
              {!isHist && (a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK') && (
                <button onClick={(e) => { e.stopPropagation(); ack(a.id) }}>Tassykla</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
