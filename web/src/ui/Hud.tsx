import { useTwin } from '../data/store'
import { beketAdy } from './labels'

export function Hud({ onBench, benching, stationId }: {
  onBench: () => void
  benching: boolean
  stationId: string
}) {
  const connected = useTwin((s) => s.connected)
  const alive = useTwin((s) => s.sourceAlive)
  const pb = useTwin((s) => s.playback)
  const stale = useTwin((s) => s.dataStale)
  const dataTs = useTwin((s) => s.dataTs)
  const nAlarm = useTwin((s) => s.alarms.filter((a) => a.level === 'ALARM').length)

  // Oynatmada "canlı" yazmak yanıltıcı olurdu — ekrandaki veri geçmişe ait.
  // Bayat veride değerler ve pompa renkleri gösterilir ama burada tarihiyle uyarılır.
  const link = pb.active ? { t: 'TARYH', c: 'mid' }
    : !connected ? { t: 'ARAGATNAŞYK ÝOK', c: 'bad' }
    : !alive ? { t: 'MAGLUMAT ÝOK', c: 'bad' }
    : stale ? { t: `KÖNE${dataTs ? ' · ' + new Date(dataTs).toLocaleDateString('en-GB') : ''}`, c: 'mid' }
    : { t: 'janly', c: 'good' }

  return (
    <div className="hud">
      <h1>{beketAdy(stationId)} · Sanly ekiz</h1>
      <div className="kv">
        <span>aragatnaşyk</span><span className={link.c}>{link.t}</span>
        <span>{pb.active ? 'janly duýduryş' : 'işjeň duýduryş'}</span>
        <span className={nAlarm ? 'bad' : 'good'}>{nAlarm}</span>
      </div>
      <button className="wide" onClick={onBench} disabled={benching}>
        {benching ? 'ölçülýär…' : 'Öndürijiligi ölç'}
      </button>
    </div>
  )
}
