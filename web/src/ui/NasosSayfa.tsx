import { useEffect, useMemo, useState } from 'react'
import { abone, cykysWana, girisWana, loadEskiCfg, nasazOf, nasosOrds, num, yagdayOf, type EskiDeger } from '../data/eskiNokta'

/**
 * nasos.html#PMP-03 — eski TV Px sayfalarındaki nasos resmine tıklanınca açılan popup'ın içi.
 * Veriler eski Px sayfalarının okuduğu noktalardan (eski_noktalar.json), aynı yazılarla.
 * Popup çerçevesini Px sayfasının üstüne dugme.js kurar; × ve Esc o çerçeveyi kaldırır.
 * Deneme: nasos.html?demo#PMP-03 (Niagara'sız, örnek değerler).
 */
const KATMAN = 'twinNasosKatman'
const DEMO = new URLSearchParams(location.search).has('demo')

function yap() {
  try { window.parent.document.getElementById(KATMAN)?.remove(); return } catch { /* başka köken */ }
  window.parent.postMessage({ twin: 'nasos-yap' }, '*')
}

const demoDeger = (key: string): EskiDeger => {
  const d: Record<string, [number, string]> = {
    yagday: [2, ''], duydurys: [1, ''], nasazlyk: [0, ''], status: [4, ''], basys: [3.42, '3.42 bar'],
    akym: [812.5, '812.5 m³/h'], tizlik: [1.84, '1.84 m/s'], jemi: [1254870, '1254870 m³'], suw: [2.71, '2.71 m'],
    giris_wana: [2, ''], cykys_wana: [2, ''], inw_sag: [12840, ''], inw_min: [37, ''], trans_sag: [4410, ''], trans_min: [5, ''],
    U1: [68, '68.0 °C'], U2: [70, '70.0 °C'], V1: [67, '67.0 °C'], V2: [69, '69.0 °C'], W1: [71, '71.0 °C'], W2: [72, '72.0 °C'],
    On: [48, '48.0 °C'], Arka: [51, '51.0 °C'], IL1: [0, '0.0 A'], IL2: [0, '0.0 A'], IL3: [0, '0.0 A'],
    inw_tok: [212, '212.0 A'], inw_kuwwat: [1180, '1180.0 kW'], inw_tizlik: [1462, '1462 rpm'],
  }
  const [v, disp] = d[key] ?? [0, '']
  return { v, disp, ok: true }
}

export function NasosSayfa() {
  const id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  const n = Number(/(\d+)\s*$/.exec(id)?.[1] ?? NaN)
  const [vals, setVals] = useState<Record<string, EskiDeger>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let ok = true, stop = () => {}
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') yap() }
    window.addEventListener('keydown', esc)
    ;(async () => {
      if (!Number.isFinite(n)) throw new Error(`nasos belgisi ýok (${id || '?'})`)
      const cfg = await loadEskiCfg()
      const { ords } = nasosOrds(cfg, n)
      if (DEMO) { const all: Record<string, EskiDeger> = {}; for (const k of Object.keys(ords)) all[k] = demoDeger(k); setVals(all); setReady(true); return }
      const r = await abone(ords, (key, d) => { if (ok) setVals((s) => ({ ...s, [key]: d })) })
      stop = r.stop
      if (!ok) { stop(); return }
      setMissing(r.missing.map((m) => `${m.key}: ${m.ords.join(' | ')}`))
      setReady(true)
    })().catch((e) => ok && setErr(String(e?.message ?? e)))
    return () => { ok = false; stop(); window.removeEventListener('keydown', esc) }
  }, [id, n])

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
  const inw = yag !== null && yag > 1 && yag <= 2
  const cls = nas !== null && nas > 0 ? 'fault' : duy !== null && duy > 0 ? 'warn' : yag !== null && yag > 0 ? 'running' : yag !== null ? 'stopped' : ''
  const yagCls = yag === null ? 'unknown' : yag > 0 ? 'run' : 'stop'

  /** Niagara gösterimi (birimiyle); yoksa sayı; okunamadıysa — */
  const show = (k: string, digits = 1) => {
    const d = g(k)
    if (!d || d.v === null) return '—'
    if (d.disp) return d.disp
    return typeof d.v === 'number' ? d.v.toFixed(digits) : String(d.v)
  }
  const sagMin = (h: string, m: string) => {
    const hv = num(g(h)), mv = num(g(m))
    if (hv === null && mv === null) return '—'
    return `${hv === null ? '—' : Math.floor(hv).toLocaleString('en-US')} sag ${mv === null ? '—' : String(Math.floor(mv)).padStart(2, '0')} min`
  }
  const temps = useMemo(() => [['U1', 'U1'], ['U2', 'U2'], ['V1', 'V1'], ['V2', 'V2'], ['W1', 'W1'], ['W2', 'W2'], ['On', 'Öň'], ['Arka', 'Arka']], [])
  const sicak = (k: string) => { const v = num(g(k)); return v === null ? '—' : v.toFixed(0) }
  const wana = (txt: string | null) => <span className={txt === 'açyk' ? 'good' : txt === 'näsaz' ? 'bad' : ''}>{txt ?? '—'}</span>

  if (err || !Number.isFinite(n)) {
    return (
      <div className="nasosSayfa">
        <button className="nasosYap" onClick={yap} aria-label="ýap">×</button>
        <div className="loading bad">ýükleme ýalňyşlygy: {err ?? id}</div>
      </div>
    )
  }

  return (
    <div className="nasosSayfa">
      <div className={`card eskiKart ${cls}`}>
        <div className="cardHead">
          <div><b>N-{n}</b></div>
          <span className={`chip ${yagCls}`}>{yagdayOf(yag) ?? 'Maglumat ýok'}</span>
          <button className="x" onClick={yap} aria-label="ýap">×</button>
        </div>
        {!ready && <div className="empty">ýüklenýär…</div>}

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

        <div className="eskiBolum">{inw ? 'Inwertor' : 'Tok (transformator)'}</div>
        <div className="kv">
          {inw ? <>
            <div className="row"><span>Tok</span><span>{show('inw_tok')}</span></div>
            <div className="row"><span>Kuwwat</span><span>{show('inw_kuwwat')}</span></div>
            <div className="row"><span>Tizlik</span><span>{show('inw_tizlik', 0)}</span></div>
          </> : (
            <div className="row"><span>IL1 / IL2 / IL3</span><span>{show('IL1')} / {show('IL2')} / {show('IL3')}</span></div>
          )}
        </div>

        <div className="eskiBolum">Işlän wagty</div>
        <div className="kv">
          <div className="row"><span>Inwertorda</span><span>{sagMin('inw_sag', 'inw_min')}</span></div>
          <div className="row"><span>Transformatorda</span><span>{sagMin('trans_sag', 'trans_min')}</span></div>
        </div>

        {missing.length > 0 && (
          <div className="eskiEksik" title={missing.join('\n')}>{missing.length} nokat tapylmady (eski_noktalar.json)</div>
        )}
      </div>
    </div>
  )
}
