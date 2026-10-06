import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TwinScene, type PerfStats } from './scene/TwinScene'
import type { ComponentInfo, MergedScene } from './scene/merge'
import type { TwinMap } from './scene/types'
import { useTwin } from './data/store'
import { Hud } from './ui/Hud'
import { InfoCard } from './ui/InfoCard'
import { Alarms } from './ui/Alarms'
import { Timeline } from './ui/Timeline'
import { StationPicker, type StationInfo } from './ui/StationPicker'
import { Schema2D } from './ui/Schema2D'
import { SensorLabels } from './ui/SensorLabels'
import { computeHealth } from './data/health'
import { fetchStations } from './data/niagara'

type View = '3d' | '2d'

/** Son açılan görünüm hatırlanır (kiosk yeniden başlayınca aynı ekran gelsin). */
function savedView(): View {
  try { return localStorage.getItem('twin.view') === '2d' ? '2d' : '3d' } catch { return '3d' }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<TwinScene | null>(null)
  const mergedRef = useRef<MergedScene | null>(null)

  const [stats, setStats] = useState<PerfStats | null>(null)
  const [meshInfo, setMeshInfo] = useState<{ source: number; merged: number; components: number } | null>(null)
  const [twin, setTwin] = useState<TwinMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<{ equipment: string | null; component: string | null }>({ equipment: null, component: null })
  const [explode, setExplode] = useState(0)
  const [bench, setBench] = useState<string | null>(null)
  const [benching, setBenching] = useState(false)
  const [showAlarms, setShowAlarms] = useState(true)
  const [view, setView] = useState<View>(savedView)
  // Bina: 'kesik' = çatı ve kameraya bakan duvarlar gizli (pompalar görünür),
  // 'doly' = bina dışarıdan tam. Model yeniden yüklenince de uygulanır.
  const [hasBuilding, setHasBuilding] = useState(false)
  const [buildingFull, setBuildingFull] = useState(false)
  useEffect(() => {
    sceneRef.current?.setBuildingMode(buildingFull ? 'full' : 'cut')
  }, [buildingFull, twin])

  // 2D açıkken 3D render döngüsü durur — Pi'nin GPU'su boşuna çalışmasın.
  // `twin` bağımlılığı: model yüklenince döngü yeniden başlıyor; 2D'deysek
  // hemen tekrar durdurulsun.
  useEffect(() => {
    sceneRef.current?.setPaused(view === '2d')
    try { localStorage.setItem('twin.view', view) } catch { /* depolama kapalı olabilir */ }
  }, [view, twin])

  // Sol sütun 3D'nin üstünde duruyor: sahnenin merkezi görünür alana kaysın
  const leftRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = leftRef.current
    const apply = () => sceneRef.current?.setViewInset(view === '3d' && el ? el.getBoundingClientRect().right : 0)
    apply()
    if (!el || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view, twin])

  const [station, setStation] = useState<StationInfo | null>(null)
  const playback = useTwin((s) => s.playback)
  const historyEnabled = useTwin((s) => s.historyEnabled)
  const switchStation = useTwin((s) => s.switchStation)
  const enterPlayback = useTwin((s) => s.enterPlayback)
  const connect = useTwin((s) => s.connect)
  const disconnect = useTwin((s) => s.disconnect)
  const setTwinMap = useTwin((s) => s.setTwinMap)

  // ---- istasyon listesi ve varsayılan seçim ------------------------------ //
  useEffect(() => {
    fetchStations().then((d) => {
      const list: StationInfo[] = d.stations ?? []
      const first = list.find((x) => x.id === d.default) ?? list[0]
      if (first) { setStation(first); connect(first.id) }
    }).catch((e) => setError(String(e)))
    return () => disconnect()
  }, [connect, disconnect])

  // ---- sahne: BİR KEZ kurulur -------------------------------------------- //
  // İstasyon değişiminde TwinScene'i yeniden kurmak iki soruna yol açıyordu:
  // aynı tuval üzerinde ikinci bir WebGLRenderer (WebGL bağlamı paylaşılıyor)
  // ve eski modelin GPU belleğinin hiç bırakılmaması. Pi'de CMA havuzu 2-3
  // istasyon sonra doluyor, ekran donuyordu. Artık renderer sabit; yalnız
  // model değişiyor — scene.load() kendi içinde unload() ediyor.
  useEffect(() => {
    if (!canvasRef.current) return
    const scene = new TwinScene(canvasRef.current, {
      onStats: setStats,
      // Ekipmana dokunmak onun bilgi kartını açar. Boşluğa ya da beton yapıya
      // dokunmak açık kartı KAPATMAZ — kart × ile ya da başka ekipman
      // seçilince kapanır (sahne döndürülürken de yerinde kalsın diye).
      onPick: (info: ComponentInfo | null) => {
        if (!info?.equipment) return
        setSel({ equipment: info.equipment, component: null })
        setExplode(0)
      },
      onReady: (merged, tm) => {
        mergedRef.current = merged
        setTwin(tm); setTwinMap(tm)
        setMeshInfo({ source: merged.stats.sourceMeshes, merged: merged.stats.drawCalls, components: merged.components.length })
        setHasBuilding(merged.components.some((c) => c.faceN !== null))
      },
    })
    sceneRef.current = scene
    ;(window as unknown as { __twin: TwinScene }).__twin = scene   // ölçüm/hata ayıklama
    return () => { scene.dispose(); sceneRef.current = null; mergedRef.current = null }
  }, [setTwinMap])

  // ---- istasyon değişince yalnız MODEL yeniden yüklenir ------------------ //
  // WebSocket bu efektin dışında yönetilir: bağlantı kopmaz, abonelik değişir.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !station) return
    setTwin(null); setSel({ equipment: null, component: null }); setExplode(0)
    mergedRef.current = null
    // Model yolları sunucunun istasyon listesinden gelir — sabit kod yok.
    // Model adları hash'siz; derleme damgası eklenmezse tarayıcı önbellekten
    // eski modeli veriyor (bkz. vite.config.ts).
    const v = `?v=${__BUILD_ID__}`
    scene.load(station.model + v, station.twin_map + v, station.model_parts?.map((p) => p + v))
      .catch((e) => setError(String(e?.message ?? e)))
  }, [station])

  // ---- canlı veriyi sahneye bağla ---------------------------------------- //
  const health = useTwin((s) => s.health)
  const compHealth = useTwin((s) => s.componentHealth)
  const status = useTwin((s) => s.status)
  const values = useTwin((s) => s.values)
  const sourceAlive = useTwin((s) => s.sourceAlive)

  // Oynatmada sunucunun canlı alarm durumu geçersiz — o anın sağlığı
  // twin-map'teki eşiklerden istemcide hesaplanır.
  const histHealth = useMemo(
    () => (playback.active && twin ? computeHealth(twin, values) : null),
    [playback.active, values, twin])

  useEffect(() => {
    // Sunucu `PS-01.PMP-01` biçiminde gönderir (ekipman kimlikleri istasyonlar
    // arasında tekrarlanıyor). Sahne ise modeldeki çıplak adı bilir.
    const strip = (m: Record<string, string>) => {
      const out: Record<string, string> = {}
      const pre = (station?.id ?? '') + '.'
      for (const [k, v] of Object.entries(m)) out[k.startsWith(pre) ? k.slice(pre.length) : k] = v
      return out
    }
    if (histHealth) sceneRef.current?.setHealth(histHealth.equipment, histHealth.component)
    else sceneRef.current?.setHealth(strip(health), strip(compHealth))
  }, [health, compHealth, histHealth, station])

  useEffect(() => {
    // "PS-01.PMP-01" -> "PMP-01"; kaynak ölüyse hepsi bilinmiyor
    const map: Record<string, string> = {}
    for (const [k, v] of Object.entries(status)) {
      map[k.split('.').slice(1).join('.')] = sourceAlive ? v.state : 'UNKNOWN'
    }
    sceneRef.current?.setRunStates(map)
  }, [status, sourceAlive])

  // Boru hatlarındaki akış: v = Q / A. Kesit alanı modelin içinden geliyor,
  // debi canlı veriden. Pompa durunca o branşın bandı durur, kolektörünki devam eder.
  useEffect(() => {
    const m = mergedRef.current, sc = sceneRef.current
    if (!m || !sc || !twin) return
    const vel: Record<string, number> = {}
    for (const c of m.components) {
      if (!c.flowArea || !c.equipment) continue
      const q = values[`${twin.station}.${c.equipment}.flow_m3h`]?.v
      if (typeof q === 'number') vel[c.node] = q / 3600 / c.flowArea
    }
    sc.setFlow(vel)
  }, [values, twin])

  // Hareketli parçalar (kapak kanadı): konum sinyalinden strok oranı
  useEffect(() => {
    const m = mergedRef.current, sc = sceneRef.current
    if (!m || !sc || !twin) return
    const strokes: Record<string, number> = {}
    for (const c of m.components) {
      if (!c.travel || !c.equipment) continue
      // Önce bileşene özel konum sinyali (RACK__CLEANER.position_pct gibi),
      // yoksa ekipman seviyesindeki (GATE-01.position_pct)
      const p = (c.component
        ? values[`${twin.station}.${c.equipment}.${c.component}.position_pct`]?.v
        : undefined) ?? values[`${twin.station}.${c.equipment}.position_pct`]?.v
      if (typeof p === 'number') strokes[c.node] = Math.max(0, Math.min(1, p / 100))
    }
    sc.setMotion(strokes)
  }, [values, twin])

  const level = station ? values[`${station.id}.BASIN-01.level_m`]?.v : undefined
  useEffect(() => {
    if (typeof level === 'number') sceneRef.current?.setWaterLevel(level)
  }, [level])

  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    if (!sel.equipment || explode <= 0.001) s.clearExplode()
    else s.setExplode(sel.equipment, explode)
  }, [explode, sel.equipment])

  // Bileşen seviyesine inildiğinde: çevreyi söndür, üniteyi patlat ve
  // SEÇİMİ SAHNEYE BİLDİR.
  //
  // Bu son adım eksikti: panelden bileşen seçmek yalnız React durumunu
  // değiştiriyor, 3D sahnenin hangi parçanın seçili olduğundan haberi olmuyordu.
  // Sonuç: parçaya yaklaşıyordun ama hangisi olduğunu ayırt edemiyordun.
  useEffect(() => {
    const s = sceneRef.current
    const m = mergedRef.current
    if (!s) return
    s.setSelectedEquipment(sel.equipment)
    if (sel.component && sel.equipment) {
      const node = `${sel.equipment}__${sel.component}`
      s.setFocus(sel.equipment, node)
      s.setSelected(m?.byNode.get(node) ?? null)
      setExplode((v) => (v > 0.001 ? v : 0.45))
    } else {
      s.setFocus(null)
      // Bileşen seçimi kalkınca 3D'deki vurgu da kalkmalı. Aksi halde
      // kullanıcı bileşenden çıktığı halde parça vurgulu kalıyor.
      s.setSelected(null)
    }
  }, [sel.component, sel.equipment, twin])

  // Bilgi kartının DOM düğümü sahneye verilir; konumunu sahne her karede yazar.
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    sceneRef.current?.setCard(el, el ? sel.equipment : null)
  }, [sel.equipment])
  // Datçiklerin yanındaki ölçüm yazıları — konum ve ölçeği sahne yazar
  const registerLabels = useCallback((items: { el: HTMLElement; equipment: string }[]) => {
    sceneRef.current?.setLabels(items)
  }, [])
  const closeCard = useCallback(() => {
    setSel({ equipment: null, component: null }); setExplode(0)
  }, [])
  const cardEq = sel.equipment && twin ? twin.equipment[sel.equipment] : undefined

  // ---- eylemler ---------------------------------------------------------- //
  const frame = useCallback((node: string, margin = 2.4) => sceneRef.current?.frameNode(node, margin), [])

  const selectFromAlarm = useCallback((equipment: string, component: string | null) => {
    setSel({ equipment, component })
    setExplode(component ? 0.45 : 0)
    // Bileşen seçilse bile EKİPMANI çerçevele. Küçük bir parçayı "doğru"
    // mesafeden çerçevelemek kamerayı gövdenin içine sokuyor; ünitenin
    // tamamını patlatılmış görmek hem bağlam veriyor hem parçayı gösteriyor.
    frame(equipment, component ? 3.1 : 2.4)
  }, [frame])

  const runBench = useCallback(async () => {
    const s = sceneRef.current
    if (!s) return
    setBenching(true); setBench(null)
    try {
      const r = await s.benchmark({ frames: 150, width: 1280, height: 720 })
      setBench(`1280×720 · ${r.avgMs} ms/kadr · p95 ${r.p95Ms} ms · ${r.fps} fps · ${r.drawCalls} draw call`)
    } finally { setBenching(false) }
  }, [])

  const crumbs = useMemo(() => {
    const out: { label: string; node: string | null }[] = [{ label: station?.id ?? 'Beket', node: null }]
    if (sel.equipment && twin?.equipment[sel.equipment]) {
      out.push({ label: twin.equipment[sel.equipment].label, node: sel.equipment })
      if (sel.component) out.push({ label: sel.component.replace(/__/g, ' '), node: `${sel.equipment}__${sel.component}` })
    } else if (sel.equipment) {
      out.push({ label: sel.equipment.replace(/__/g, ' '), node: sel.equipment })
    }
    return out
  }, [sel, twin, station])

  const is3d = view === '3d'

  return (
    <div className="app">
      <canvas ref={canvasRef} />

      {is3d && !twin && !error && <div className="loading">model ýüklenýär…</div>}
      {error && <div className="loading bad">ýükleme ýalňyşlygy: {error}</div>}

      <div className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="15" />
            <path d="M16 6c4 5.2 6.5 8.7 6.5 11.6A6.5 6.5 0 0 1 9.5 17.6C9.5 14.7 12 11.2 16 6z" />
          </svg>
          <div><b>Suw göteriji bekedi</b><span>Sanly ekiz</span></div>
        </div>
        <div className="seg" role="tablist">
          <button className={is3d ? 'on' : ''} onClick={() => setView('3d')}>3D ekiz</button>
          <button className={!is3d ? 'on' : ''} onClick={() => setView('2d')}>2D shema</button>
        </div>
        {station && (
          <StationPicker current={station.id}
                         onSelect={(s) => { switchStation(s.id); setStation(s) }} />
        )}
        {is3d && (
          <nav className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <i>›</i>}
                <button className={i === crumbs.length - 1 ? 'on' : ''}
                        onClick={() => {
                          if (!c.node) { setSel({ equipment: null, component: null }); setExplode(0); sceneRef.current?.frameAll() }
                          else { setSel((s) => i === 1 ? { equipment: s.equipment, component: null } : s); frame(c.node) }
                        }}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {is3d && bench && <span className="bench">{bench}</span>}
        {is3d && historyEnabled && !playback.active && (
          <button onClick={() => enterPlayback()}>Taryhy oýnat</button>
        )}
        {is3d && hasBuilding && (
          <button className={buildingFull ? 'on' : ''} onClick={() => {
            // Bina kapanınca pompa görünmez; kartı açık kalırsa görünmeyen
            // pompanın bilgisi ortada asılı kalıyordu.
            if (!buildingFull) closeCard()
            setBuildingFull(!buildingFull)
          }}>
            {buildingFull ? 'Bina: doly' : 'Bina: kesik'}
          </button>
        )}
        {is3d && (
          <button onClick={() => setShowAlarms((v) => !v)}>{showAlarms ? 'Duýduryşlary gizle' : 'Duýduryşlar'}</button>
        )}
        {is3d && (
          <button onClick={() => { setSel({ equipment: null, component: null }); setExplode(0); sceneRef.current?.frameAll() }}>
            Esasy görnüş
          </button>
        )}
      </div>

      {is3d && (
        <div className="leftcol" ref={leftRef}>
          <Hud stats={stats} meshInfo={meshInfo} onBench={runBench} benching={benching}
               stationId={station?.id ?? '—'} />
          {showAlarms && (
            <div className="left">
              <Alarms onSelect={selectFromAlarm} historical={histHealth?.violations} />
            </div>
          )}
        </div>
      )}
      {is3d && <Timeline />}
      {is3d && twin && <SensorLabels twin={twin} register={registerLabels} />}

      {is3d && cardEq && twin && sel.equipment && (
        <InfoCard key={sel.equipment} station={twin.station} id={sel.equipment} eq={cardEq}
                  cardRef={cardRef} onClose={closeCard} />
      )}

      {!is3d && station && <Schema2D twin={twin} station={station} />}
    </div>
  )
}
