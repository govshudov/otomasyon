import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TwinScene } from './scene/TwinScene'
import type { ComponentInfo, MergedScene } from './scene/merge'
import type { TwinMap } from './scene/types'
import { useTwin } from './data/store'
import { InfoCard } from './ui/InfoCard'
import { Timeline } from './ui/Timeline'
import { StationPicker, type StationInfo } from './ui/StationPicker'
import { Schema2D } from './ui/Schema2D'
import { SensorLabels } from './ui/SensorLabels'
import { computeHealth } from './data/health'
import { fetchStationConfig, fetchStations, niagaraUser, NIAGARA } from './data/niagara'
import { groupsOf, levelSev, pumpView, runStateOf, type StationCfg } from './data/pump'
import { Header, Sidebar, type Page } from './ui/Shell'
import { PumpBoard } from './ui/PumpBoard'
import { PumpCharts } from './ui/PumpCharts'
import { AlarmsPage, ChartsPage, ReportsPage } from './ui/Pages'
import { KartaPage } from './ui/Karta'
import { beketAdy } from './ui/labels'

type View = '3d' | '2d'

/** Son açılan sayfa/görünüm hatırlanır (kiosk yeniden başlayınca aynı ekran gelsin). */
function saved<T extends string>(key: string, ok: (v: string) => boolean, def: T): T {
  try { const v = localStorage.getItem(key); return v && ok(v) ? v as T : def } catch { return def }
}
const store = (key: string, v: string) => { try { localStorage.setItem(key, v) } catch { /* depolama kapalı olabilir */ } }

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<TwinScene | null>(null)
  const mergedRef = useRef<MergedScene | null>(null)

  const [twin, setTwin] = useState<TwinMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<{ equipment: string | null; component: string | null }>({ equipment: null, component: null })
  const [explode, setExplode] = useState(0)
  const [view, setView] = useState<View>(() => saved('twin.view', (v) => v === '2d' || v === '3d', '3d'))
  const [page, setPageRaw] = useState<Page>(() => saved<Page>('twin.page', (v) => /^(map|overview|karta|alarms|reports|charts|group:.+)$/.test(v), 'overview'))
  const [mini, setMini] = useState(() => saved<string>('twin.side', (v) => v === 'mini' || v === 'full', 'full') === 'mini')
  const [cfg, setCfg] = useState<StationCfg | null>(null)
  const [user, setUser] = useState(NIAGARA ? '…' : 'ýerli ulanyjy')
  const [charts, setCharts] = useState<{ id: string; label: string } | null>(null)

  // Bina: 'kesik' = çatı ve kameraya bakan duvarlar gizli (pompalar görünür),
  // 'doly' = bina dışarıdan tam. Model yeniden yüklenince de uygulanır.
  const [hasBuilding, setHasBuilding] = useState(false)
  const [buildingFull, setBuildingFull] = useState(false)
  useEffect(() => {
    sceneRef.current?.setBuildingMode(buildingFull ? 'full' : 'cut')
  }, [buildingFull, twin])

  const setPage = useCallback((p: Page) => { setPageRaw(p); store('twin.page', p) }, [])
  useEffect(() => { store('twin.side', mini ? 'mini' : 'full') }, [mini])
  useEffect(() => { niagaraUser().then((u) => u && setUser(u)) }, [])

  const onMap = page === 'map'
  const is3d = onMap && view === '3d'

  // 3D yalnız "Sanly ekiz" sayfasında çizilir — diğer sayfalarda GPU boşta kalsın
  useEffect(() => {
    sceneRef.current?.setPaused(!is3d)
    store('twin.view', view)
  }, [is3d, view, twin])

  // Sol menü 3D'nin üstünde duruyor: sahnenin merkezi görünür alana kaysın
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('nav.side')
    // Üst: başlık + 3D araç çubuğu (CSS'teki --hdr + --subbar)
    const apply = () => sceneRef.current?.setViewInset(is3d && el ? el.getBoundingClientRect().right : 0, is3d ? 92 : 0)
    apply()
    if (!el || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [is3d, twin, mini])

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

  // İstasyon konfigürasyonu: toplumlar (hangi nasos hangi esasy turbaya basıyor)
  useEffect(() => {
    if (!station) return
    let ok = true
    setCfg(null)
    fetchStationConfig(station.id).then((c) => { if (ok) setCfg(c) }).catch(() => {})
    return () => { ok = false }
  }, [station])
  const groups = useMemo(() => groupsOf(cfg), [cfg])
  const sid = station?.id ?? ''

  // ---- sahne: BİR KEZ kurulur -------------------------------------------- //
  // İstasyon değişiminde TwinScene'i yeniden kurmak iki soruna yol açıyordu:
  // aynı tuval üzerinde ikinci bir WebGLRenderer ve eski modelin GPU belleğinin
  // hiç bırakılmaması. Artık renderer sabit; yalnız model değişiyor.
  useEffect(() => {
    if (!canvasRef.current) return
    const scene = new TwinScene(canvasRef.current, {
      // Ekipmana dokunmak onun bilgi kartını açar. Boşluğa dokunmak kartı
      // KAPATMAZ — kart × ile ya da başka ekipman seçilince kapanır.
      onPick: (info: ComponentInfo | null) => {
        if (!info?.equipment) return
        setSel({ equipment: info.equipment, component: null })
        setExplode(0)
      },
      onReady: (merged, tm) => {
        mergedRef.current = merged
        setTwin(tm); setTwinMap(tm)
        setHasBuilding(merged.components.some((c) => c.faceN !== null))
      },
    })
    sceneRef.current = scene
    ;(window as unknown as { __twin: TwinScene }).__twin = scene   // ölçüm/hata ayıklama
    return () => { scene.dispose(); sceneRef.current = null; mergedRef.current = null }
  }, [setTwinMap])

  // ---- istasyon değişince yalnız MODEL yeniden yüklenir ------------------ //
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !station) return
    setTwin(null); setSel({ equipment: null, component: null }); setExplode(0)
    mergedRef.current = null
    const v = `?v=${__BUILD_ID__}`
    scene.load(station.model + v, station.twin_map + v, station.model_parts?.map((p) => p + v))
      .catch((e) => setError(String(e?.message ?? e)))
  }, [station])

  // ---- canlı veriyi sahneye bağla ---------------------------------------- //
  const health = useTwin((s) => s.health)
  const compHealth = useTwin((s) => s.componentHealth)
  const status = useTwin((s) => s.status)
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const sourceAlive = useTwin((s) => s.sourceAlive)

  // Oynatmada sunucunun canlı alarm durumu geçersiz — o anın sağlığı istemcide hesaplanır
  const histHealth = useMemo(
    () => (playback.active && twin ? computeHealth(twin, values) : null),
    [playback.active, values, twin])

  useEffect(() => {
    const strip = (m: Record<string, string>) => {
      const out: Record<string, string> = {}
      const pre = sid + '.'
      for (const [k, v] of Object.entries(m)) out[k.startsWith(pre) ? k.slice(pre.length) : k] = v
      return out
    }
    if (histHealth) sceneRef.current?.setHealth(histHealth.equipment, histHealth.component)
    else sceneRef.current?.setHealth(strip(health), strip(compHealth))
  }, [health, compHealth, histHealth, sid])

  // Pompa rengi panodaki durumla aynı: inverter/pano çalışıyor → yeşil, duruyor → gri,
  // näsazlyk → kırmızı. Diğer ekipman eski durum noktasından.
  useEffect(() => {
    const map: Record<string, string> = {}
    for (const [k, v] of Object.entries(status)) map[k.split('.').slice(1).join('.')] = sourceAlive ? v.state : 'UNKNOWN'
    const lvl = levelSev(sid, values, stale, twin)
    for (const g of groups) for (const p of g.pumps) {
      map[p.id] = sourceAlive ? runStateOf(pumpView(sid, p, values, stale, twin, status[`${sid}.${p.id}`]?.state, lvl)) : 'UNKNOWN'
    }
    sceneRef.current?.setRunStates(map)
  }, [status, sourceAlive, values, stale, twin, groups, sid])

  // Boru hatlarındaki akış: v = Q / A. Nasos başına debimetre yok — esasy
  // turbanın debisi o toplumda çalışan nasoslara eşit bölünür.
  useEffect(() => {
    const m = mergedRef.current, sc = sceneRef.current
    if (!m || !sc || !twin) return
    const lvl = levelSev(sid, values, stale, twin)
    const q: Record<string, number> = {}
    for (const g of groups) {
      // Her borunun akımı kendi debimetresinden; toplumun toplamı çalışan nasoslara bölünür
      let total = 0, any = false
      for (const h of g.headers) {
        const hq = values[`${sid}.${h.id}.flow_m3h`]?.v
        if (typeof hq !== 'number') continue
        q[h.id] = hq; total += hq; any = true
      }
      if (!any) continue
      const run = g.pumps.filter((p) => pumpView(sid, p, values, stale, twin, status[`${sid}.${p.id}`]?.state, lvl).running)
      for (const p of g.pumps) q[p.id] = run.some((r) => r.id === p.id) ? total / run.length : 0
    }
    const vel: Record<string, number> = {}
    for (const c of m.components) {
      if (!c.flowArea || !c.equipment || q[c.equipment] === undefined) continue
      vel[c.node] = q[c.equipment] / 3600 / c.flowArea
    }
    sc.setFlow(vel)
  }, [values, stale, status, twin, groups, sid])

  // Hareketli parçalar (kapak kanadı): konum sinyalinden strok oranı
  useEffect(() => {
    const m = mergedRef.current, sc = sceneRef.current
    if (!m || !sc || !twin) return
    const strokes: Record<string, number> = {}
    for (const c of m.components) {
      if (!c.travel || !c.equipment) continue
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

  // Bileşen seviyesine inildiğinde: çevreyi söndür, üniteyi patlat ve seçimi sahneye bildir
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

  const crumbs = useMemo(() => {
    const out: { label: string; node: string | null }[] = [{ label: station ? beketAdy(station.id) : 'Beket', node: null }]
    if (sel.equipment && twin?.equipment[sel.equipment]) {
      out.push({ label: twin.equipment[sel.equipment].label, node: sel.equipment })
      if (sel.component) out.push({ label: sel.component.replace(/__/g, ' '), node: `${sel.equipment}__${sel.component}` })
    } else if (sel.equipment) {
      out.push({ label: sel.equipment.replace(/__/g, ' '), node: sel.equipment })
    }
    return out
  }, [sel, twin, station])

  // 2D şemadan / duýduryş sayfasından bir ekipmana: 3D'ye geç, kartını aç, ona uç.
  const open3D = useCallback((equipment: string) => {
    setPage('map'); setView('3d')
    setSel({ equipment, component: null }); setExplode(0)
    requestAnimationFrame(() => frame(equipment, 2.6))
  }, [frame, setPage])

  const openCharts = useCallback((id: string, label: string) => setCharts({ id, label }), [])
  const groupPage = page.startsWith('group:') ? groups.find((g) => `group:${g.id}` === page) : undefined

  return (
    <div className={`app${mini ? ' sideMini' : ''}`}>
      <canvas ref={canvasRef} />

      <Header sid={sid || '—'} user={user} onMenu={() => setMini((m) => !m)} onAlarms={() => setPage('alarms')} />
      <Sidebar page={page} setPage={setPage} groups={groups} collapsed={mini} />

      {onMap && (
        <>
          {is3d && !twin && !error && <div className="loading main">model ýüklenýär…</div>}
          {error && <div className="loading main bad">ýükleme ýalňyşlygy: {error}</div>}
          <div className="subbar">
            <div className="seg" role="tablist">
              <button className={is3d ? 'on' : ''} onClick={() => setView('3d')}>Sanly ekiz</button>
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
          </div>

          {is3d && <Timeline />}
          {is3d && twin && <SensorLabels twin={twin} register={registerLabels} />}

          {is3d && cardEq && twin && sel.equipment && (
            <InfoCard key={sel.equipment} station={twin.station} id={sel.equipment} eq={cardEq}
                      cardRef={cardRef} onClose={closeCard}
                      onCharts={() => openCharts(sel.equipment!, cardEq.label)} />
          )}

          {!is3d && station && <div className="mainArea"><Schema2D twin={twin} station={station} /></div>}
        </>
      )}

      {!onMap && (
        <main className="mainArea">
          {!cfg && page !== 'karta' && page !== 'alarms' && <div className="loading">beket maglumaty ýüklenýär…</div>}
          {cfg && page === 'overview' && <PumpBoard sid={sid} groups={groups} onOpen={openCharts} />}
          {cfg && groupPage && <PumpBoard sid={sid} groups={[groupPage]} onOpen={openCharts} />}
          {cfg && page.startsWith('group:') && !groupPage && <PumpBoard sid={sid} groups={groups} onOpen={openCharts} />}
          {page === 'karta' && <KartaPage />}
          {page === 'alarms' && <AlarmsPage onLocate={open3D} />}
          {cfg && page === 'reports' && <ReportsPage sid={sid} groups={groups} />}
          {cfg && page === 'charts' && <ChartsPage sid={sid} groups={groups} onPump={openCharts} />}
        </main>
      )}

      {charts && sid && <PumpCharts sid={sid} id={charts.id} label={charts.label} onClose={() => setCharts(null)} />}
    </div>
  )
}
