import { useEffect, useState } from 'react'
import { useTwin } from '../data/store'
import { asset, fetchStations } from '../data/niagara'
import { enjamAdy } from '../data/pump'
import type { TwinMap } from '../scene/types'
import { InfoCard } from './InfoCard'

/**
 * nasos.html#PMP-03 — eski TV Px sayfalarındaki nasos resmine tıklanınca açılan popup'ın içi.
 * 3D ikizde nasosa tıklayınca çıkan kartın aynısı (InfoCard), sahne ve model yüklenmeden.
 * Popup çerçevesini Px sayfasının üstüne dugme.js kurar; × o çerçeveyi kaldırır.
 */
const KATMAN = 'twinNasosKatman'

function yap() {
  try { window.parent.document.getElementById(KATMAN)?.remove(); return } catch { /* başka köken */ }
  window.parent.postMessage({ twin: 'nasos-yap' }, '*')
}

export function NasosSayfa() {
  const id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  const connect = useTwin((s) => s.connect)
  const disconnect = useTwin((s) => s.disconnect)
  const setTwinMap = useTwin((s) => s.setTwinMap)
  const [twin, setTwin] = useState<TwinMap | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let ok = true
    fetchStations().then(async (d) => {
      const st = d.stations.find((x) => x.id === d.default) ?? d.stations[0]
      if (!st) throw new Error('beket ýok')
      connect(st.id)
      const tm: TwinMap = await fetch(asset(`${st.twin_map}?v=${__BUILD_ID__}`)).then((r) => r.json())
      for (const e of Object.values(tm.equipment)) e.label = enjamAdy(e.label)
      if (ok) { setTwin(tm); setTwinMap(tm) }
    }).catch((e) => ok && setErr(String(e?.message ?? e)))
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') yap() }
    window.addEventListener('keydown', esc)
    return () => { ok = false; window.removeEventListener('keydown', esc); disconnect() }
  }, [connect, disconnect, setTwinMap])

  // Popup çerçevesinin yüksekliği kartın boyuna uysun
  useEffect(() => {
    const fr = (() => { try { return window.frameElement as HTMLElement | null } catch { return null } })()
    if (!fr || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(() => { fr.style.height = Math.ceil(document.documentElement.scrollHeight) + 'px' })
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [twin])

  const eq = twin?.equipment[id]
  return (
    <div className="nasosSayfa">
      {!(twin && eq) && <button className="nasosYap" onClick={yap} aria-label="ýap">×</button>}
      {err && <div className="loading bad">ýükleme ýalňyşlygy: {err}</div>}
      {!err && !twin && <div className="loading">ýüklenýär…</div>}
      {twin && !eq && <div className="loading bad">{id || '?'} enjamy tapylmady</div>}
      {twin && eq && <InfoCard station={twin.station} id={id} eq={eq} cardRef={() => {}} onClose={yap} />}
    </div>
  )
}
