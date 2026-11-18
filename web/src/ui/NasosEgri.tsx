import { useEffect, useMemo, useState } from 'react'
import { DEMO, inwertorda, num, transformatorda, useEskiNokatlar, type EskiDeger } from '../data/eskiNokta'
import { interp, isNokatlary, loadEgriler, modelOf, type EgriDoc, type EgriModel, type NormPoint } from '../data/egri'
import { axisOf, egriPenceresi, invertOf, useGecmisBulut, type EgriPencere } from '../data/nasosEgri'
import { groupsOf, type StationCfg } from '../data/pump'
import { fetchStationConfig, fetchStations } from '../data/niagara'
import { CurveModal } from './HeadCurve'
import './NasosEgri.css'

/**
 * Eski TV nasos popup'ının "Grafigi aç" penceresi: Umumy syn'daki H–Q penceresinin aynısı
 * (hesap nasosEgri.ts'te), değerler eski Px noktalarından (eski_noktalar.json):
 *   basys (bar) → H, akym (m³/sag → m³/s) → Q, suw → emme suyunun derejesi,
 *   isteğe bağlı kuwwat (kW), tok (A), ygylyk (Hz); yoksa "—".
 * Popup küçük olduğu için pencere Px sayfasının ortasında büyük çerçevede açılır
 * (nasos.html?egri#PMP-03, dugme.js kurar); popup üst sayfasız açıldıysa kendi içinde.
 */

const EGRI = 'twinEgriKatman'
const pumpIdOf = (n: number) => `PMP-${String(n).padStart(2, '0')}`

/**
 * Popup'ın beketi: ?beket=PS-04, yoksa paketin (stations.json) varsayılanı. Deneme modunda o
 * beketde bu nasosa egri atanmamışsa atamadaki ilk uygun beket (geliştirmede varsayılan PS-01).
 */
async function beketOf(doc: EgriDoc | null, pumpId: string): Promise<string | null> {
  let sid = new URLSearchParams(location.search).get('beket')
  sid ??= await fetchStations().then((d) => d.default ?? d.stations?.[0]?.id ?? null).catch(() => null)
  if (DEMO && !modelOf(doc, sid ?? '', pumpId)) sid = Object.keys(doc?.atama ?? {}).find((s) => doc?.atama[s]?.[pumpId]) ?? sid
  return sid
}

/** Deneme geçmişi: egriden ≈ −2 % aşakda, birnäçe nokat inwertorda (50 Hz-e getirilen) */
function demoBulut(m: EgriModel, n: number): NormPoint[] {
  const rnd = (i: number) => { const x = Math.sin(n * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x) }
  const now = Date.now() / 1000
  const out: NormPoint[] = []
  for (let i = 0; i < 14; i++) {
    const q = m.taslama.q * (0.86 + 0.36 * rnd(i))
    const h = interp(m.q, m.h, q)
    if (h !== null) out.push({ t: now - (14 - i) * 5400, q, h: h * (0.98 + 0.024 * (rnd(i + 50) - 0.5)), inv: i % 4 === 1 })
  }
  return out
}

/** H–Q penceresinin içeriği eski noktalardan; beket/egri yüklenene kadar null */
function useNasosEgri(n: number, vals: Record<string, EskiDeger>): EgriPencere | null {
  const pumpId = pumpIdOf(n)
  const [ctx, setCtx] = useState<{ doc: EgriDoc | null; sid: string; cfg: StationCfg | null } | null>(null)
  useEffect(() => {
    let ok = true
    ;(async () => {
      const doc = await loadEgriler()
      const sid = await beketOf(doc, pumpId)
      const cfg: StationCfg | null = sid ? await fetchStationConfig(sid).catch(() => null) : null
      if (ok) setCtx({ doc, sid: sid ?? '', cfg })
    })()
    return () => { ok = false }
  }, [pumpId])
  const doc = ctx?.doc ?? null, sid = ctx?.sid ?? '', cfg = ctx?.cfg ?? null
  // Geçmiş Twin noktalarından (Umumy syn'daki gibi); denemede örnek nokatlar
  const g = useMemo(() => (DEMO ? undefined : groupsOf(cfg).find((x) => x.pumps.some((p) => p.id === pumpId))), [cfg, pumpId])
  const hist = useGecmisBulut(doc, sid, g, cfg, pumpId)
  const m = modelOf(doc, sid, pumpId)
  const cloud = useMemo(() => (DEMO && m ? demoBulut(m, n) : hist), [m, n, hist])
  if (!ctx) return null

  // Durumu bozuk (stale, fault…) nokta hesaba girmez — Umumy syn da eskimiş değeri kullanmaz
  const v = (k: string) => (vals[k]?.ok ? num(vals[k]) : null)
  const yag = v('yagday')
  const running = yag !== null && yag > 0
  // Transformatorda nasos şebeke ýygylygynda döner (inwertor 0 Hz okusa da)
  const hzN = v('ygylyk')
  const hz = transformatorda(yag) && (hzN === null || hzN < 1) ? 50 : hzN
  const press = v('basys'), flow = v('akym'), level = v('suw'), kw = v('kuwwat'), amp = v('tok')
  const axis = axisOf(cfg, pumpId)
  const dz = axis !== null && level !== null ? axis - (invertOf(cfg) + level) : null
  // Akym nasosyň öz ölçegi (m³/sag): toplumda bölmek gerekmez
  const pt = doc ? isNokatlary(doc, [{ id: pumpId, model: m, running, inverter: inwertorda(yag), press, kw, amp, hz, dz }], flow)[pumpId] ?? null : null
  const w = egriPenceresi({
    title: `Nasos ${n}`, m, running, pt, press, kw, amp, hz, level, cloud,
    akymOlcegi: 'nasosyň', runN: 1, mixed: false,
  })
  if (DEMO) w.note += ' Synag maglumaty (demo).'
  return w
}

/** H–Q penceresi (CurveModal): popup'ın içinde ya da büyük çerçevenin sayfasında */
export function NasosEgri({ n, vals, err, onClose }: {
  n: number; vals: Record<string, EskiDeger>; err?: string | null; onClose: () => void
}) {
  const w = useNasosEgri(n, vals)
  if (!w) {
    return (
      <div className="hqScrim" onClick={onClose}>
        <div className="hqPanel egriYuk"><div className="loading">ýüklenýär…</div></div>
      </div>
    )
  }
  return <CurveModal {...w} note={err ? `${w.note} Nokatlar okalmady: ${err}.` : w.note} onClose={onClose} />
}

/** Büyük çerçeveyi kapat: Px sayfasından kaldır (aynı köken; değilse mesajla). Üst sayfa yoksa popup'a dön. */
function egriYap() {
  if (window.parent === window) { location.href = `nasos.html${DEMO ? '?demo' : ''}${location.hash}`; return }
  try { const k = window.parent.document.getElementById(EGRI); if (k) { k.remove(); return } } catch { /* başka köken */ }
  window.parent.postMessage({ twin: 'egri-yap' }, '*')
}

/** nasos.html?egri#PMP-03 — dugme.js'in Px sayfasının ortasında açtığı büyük çerçevenin içi */
export function NasosEgriSayfa() {
  const id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  const n = Number(/(\d+)\s*$/.exec(id)?.[1] ?? NaN)
  const { vals, err } = useEskiNokatlar(n)
  return (
    <div className="egriSayfa">
      {Number.isFinite(n)
        ? <NasosEgri n={n} vals={vals} err={err} onClose={egriYap} />
        : <div className="loading bad">nasos belgisi ýok ({id || '?'})</div>}
    </div>
  )
}
