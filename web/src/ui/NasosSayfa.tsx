import { useEffect, useMemo, useState } from 'react'
import { cykysWana, DEMO, girisWana, nasazOf, num, useEskiNokatlar, yagdayOf } from '../data/eskiNokta'
import { Icon } from './icons'
import { NasosEgri } from './NasosEgri'

/**
 * nasos.html#PMP-03 — eski TV Px sayfalarındaki nasos resmine tıklanınca açılan popup'ın içi.
 * Veriler eski Px sayfalarının okuduğu noktalardan (eski_noktalar.json), aynı yazılarla.
 * Popup çerçevesini Px sayfasının üstüne dugme.js kurar; × ve Esc o çerçeveyi kaldırır.
 * "Grafigi aç": nasosun H–Q penceresi (NasosEgri) — Px sayfasının ortasında büyük çerçevede.
 * Deneme: nasos.html?demo#PMP-03 (Niagara'sız, örnek değerler).
 */
const KATMAN = 'twinNasosKatman'

function yap() {
  try { window.parent.document.getElementById(KATMAN)?.remove(); return } catch { /* başka köken */ }
  window.parent.postMessage({ twin: 'nasos-yap' }, '*')
}

export function NasosSayfa() {
  const id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  const n = Number(/(\d+)\s*$/.exec(id)?.[1] ?? NaN)
  const { vals, missing, err } = useEskiNokatlar(n)
  /** popup'ın kendi içindeki H–Q penceresi (üst sayfa yoksa ya da üst sayfa büyük çerçeveyi açamadıysa) */
  const [egri, setEgri] = useState(false)

  // Esc popup'ı kapatır; içerideki H–Q penceresi açıksa yalnız onu (CurveModal kendisi kapatır)
  useEffect(() => {
    if (egri) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') yap() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [egri])

  /** Px sayfasından (dugme.js) büyük çerçeveyi iste; üst sayfa yoksa ya da yanıt gelmezse popup'ın içinde aç */
  const grafigiAc = () => {
    if (window.parent === window) { setEgri(true); return }
    let acyk = false
    // yanıtı dugme.js'in çerçevesi gönderir (Px sayfasının kendisi değil): aynı köken yeter
    const yanit = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.twin === 'egri-acyk') acyk = true }
    window.addEventListener('message', yanit)
    window.parent.postMessage({ twin: 'egri-ac', id, demo: DEMO }, '*')
    setTimeout(() => { window.removeEventListener('message', yanit); if (!acyk) setEgri(true) }, 700)
  }

  // Popup çerçevesinin yüksekliği kartın boyuna uysun
  useEffect(() => {
    const fr = (() => { try { return window.frameElement as HTMLElement | null } catch { return null } })()
    if (!fr || !('ResizeObserver' in window)) return
    // body'nin kendi yüksekliği (scrollHeight çerçeveden küçük olamaz; içerik kısalınca çerçeve küçülmezdi)
    const ro = new ResizeObserver(() => { fr.style.height = Math.ceil(document.body.getBoundingClientRect().height) + 'px' })
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  const g = (k: string) => vals[k]
  const yag = num(g('yagday')), duy = num(g('duydurys')), nas = num(g('nasazlyk'))
  const cls = nas !== null && nas > 0 ? 'fault' : duy !== null && duy > 0 ? 'warn' : yag !== null && yag > 0 ? 'running' : yag !== null ? 'stopped' : ''
  const yagCls = yag === null ? 'unknown' : yag > 0 ? 'run' : 'stop'

  /** Niagara gösterimi (birimiyle); yoksa sayı; okunamadıysa — */
  const show = (k: string, digits = 1) => {
    const d = g(k)
    if (!d || d.v === null) return '—'
    if (d.disp) return d.disp
    return typeof d.v === 'number' ? d.v.toFixed(digits) : String(d.v)
  }
  const temps = useMemo(() => [['U1', 'U1'], ['U2', 'U2'], ['V1', 'V1'], ['V2', 'V2'], ['W1', 'W1'], ['W2', 'W2'], ['On', 'Öň'], ['Arka', 'Arka']], [])
  const sicak = (k: string) => { const v = num(g(k)); return v === null ? '—' : v.toFixed(0) }
  const wana = (txt: string | null) => <span className={txt === 'açyk' ? 'good' : txt === 'näsaz' ? 'bad' : ''}>{txt ?? '—'}</span>

  if (err || !Number.isFinite(n)) {
    return (
      <div className="nasosSayfa">
        <button className="nasosYap" onClick={yap} aria-label="ýap">×</button>
        <div className="loading bad">ýükleme ýalňyşlygy: {err ?? `nasos belgisi ýok (${id || '?'})`}</div>
      </div>
    )
  }

  return (
    <>
      <div className="nasosSayfa">
        <div className={`card eskiKart ${cls}`}>
          <div className="cardHead">
            <div><b>N-{n}</b></div>
            <span className={`chip ${yagCls}`}>{yagdayOf(yag) ?? 'Maglumat ýok'}</span>
            <button className="x" onClick={yap} aria-label="ýap">×</button>
          </div>

          <div className={`eskiDurum ${duy !== null && duy > 0 ? 'warn' : ''}`}><em>Duýduryş</em>{nasazOf(duy) ?? '—'}</div>
          <div className={`eskiDurum ${nas !== null && nas > 0 ? 'fault' : ''}`}><em>Näsazlyk</em>{nasazOf(nas) ?? '—'}</div>

          <div className="kv">
            <div className="row"><span>Basyş</span><span>{show('basys', 2)}</span></div>
            <div className="row"><span>Akym</span><span>{show('akym')}</span></div>
            <div className="row"><span>Tizlik</span><span>{show('tizlik', 2)}</span></div>
            <div className="row"><span>Jemi</span><span>{show('jemi', 0)}</span></div>
            <div className="row"><span>Suwuň derejesi</span><span>{show('suw', 2)}</span></div>
            <div className="row"><span>Giriş / çykyş wana</span><span>{wana(girisWana(num(g('giris_wana'))))} / {wana(cykysWana(num(g('cykys_wana'))))}</span></div>
          </div>

          <div className="eskiBolum">Temperatura, °C</div>
          <div className="miniTemps">
            {temps.map(([k, l]) => <span key={k}><em>{l}</em>{sicak(k)}</span>)}
          </div>

          <button className="wide egriAc" onClick={grafigiAc}><Icon.chart size={16} />Grafigi aç</button>

          {missing.length > 0 && (
            <div className="eskiEksik" title={missing.join('\n')}>{missing.length} nokat tapylmady (eski_noktalar.json)</div>
          )}
        </div>
      </div>
      {/* .nasosSayfa'nın zoom'u pencereye geçmesin: dışında */}
      {egri && <NasosEgri n={n} vals={vals} onClose={() => setEgri(false)} />}
    </>
  )
}
