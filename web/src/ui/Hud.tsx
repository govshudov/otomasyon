import type { PerfStats } from '../scene/TwinScene'
import { useTwin } from '../data/store'

export function Hud({ stats, meshInfo, onBench, benching, stationId }: {
  stats: PerfStats | null
  meshInfo: { source: number; merged: number; components: number } | null
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
      <h1>{stationId} · Sanly ekiz</h1>
      <div className="kv">
        <span>aragatnaşyk</span><span className={link.c}>{link.t}</span>
        <span>{pb.active ? 'janly duýduryş' : 'işjeň duýduryş'}</span>
        <span className={nAlarm ? 'bad' : 'good'}>{nAlarm}</span>
      </div>
      <div className="kv sep">
        <span>draw call</span><span>{stats?.drawCalls ?? '–'}</span>
        <span>üçburçluk</span><span>{stats ? stats.triangles.toLocaleString('en-US') : '–'}</span>
        {meshInfo && <><span>mesh</span><span>{meshInfo.source} → {meshInfo.merged}</span></>}
        {meshInfo && <><span>bölek</span><span>{meshInfo.components}</span></>}
      </div>
      <button className="wide" onClick={onBench} disabled={benching}>
        {benching ? 'ölçülýär…' : 'Öndürijiligi ölç'}
      </button>
    </div>
  )
}
