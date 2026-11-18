/**
 * Bir nasosun H–Q penceresinin içeriği: başlık, alt başlık, iş nokady, geçmiş bulutu,
 * zawod egrisinden tapawut, satırlar ve not. Tek hesap, iki yer:
 *   Umumy syn (PumpBoard) — Twin noktalarından, toplumun akym ölçegi işleýänlere bölünür
 *   eski TV nasos popup'ı (NasosEgri) — eski Px noktalarından (eski_noktalar.json)
 * Veri kaynağı ayrı, pencere aynı: girdiler EgriGiris'e çevrilir, gerisi burada.
 */
import { useEffect, useState } from 'react'
import { fmtN, LEVEL_EQ, levelIdOf, type Group, type StationCfg } from './pump'
import { gecmisNokatlar, modelOf, tapawut, tapawutSev, type EgriDoc, type EgriModel, type IsNokady, type NormPoint } from './egri'
import { queryHistory } from './history'

export interface CurveRow { label: string; value: string; cls?: string }

/** Konfigürasyondan sayı (stations/<id>.json) */
const numParam = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Howuzyň düýbüniň beýikligi (m): suw derejesi ondan ölçülýär */
export const invertOf = (cfg: StationCfg | null): number => {
  const raw = cfg as unknown as { hydraulics?: { basin?: { invert_el?: number } } } | null
  return numParam(raw?.hydraulics?.basin?.invert_el) ?? 0
}
/** Nasos okunyň beýikligi (m); konfigürasyonda yoksa null */
export const axisOf = (cfg: StationCfg | null, pumpId: string): number | null =>
  numParam(cfg?.equipment.find((e) => e.id === pumpId)?.params?.centerline_el_m)

export interface EgriGiris {
  /** pencere başlığı ("Nasos 3") */
  title: string
  m: EgriModel | null
  running: boolean
  /** isNokatlary sonucu; durýan nasosda q/h null */
  pt: IsNokady | null
  press: number | null; kw: number | null; amp: number | null; hz: number | null
  /** emme suyunun derejesi, m */
  level: number | null
  /** 50 Hz'e indirgenmiş geçmiş nokatlar */
  cloud: NormPoint[]
  /** akym kaynağı notta: "<akymOlcegi> akym ölçeginden" (Umumy syn: toplumun turbalary; popup: "nasosyň") */
  akymOlcegi: string
  /** toplumda işleýän nasos sany we görnüşleri dürli mi (akym nasıl bölündü) */
  runN: number; mixed: boolean
}

export interface EgriPencere {
  title: string; sub: string; m: EgriModel | null; pt: IsNokady | null
  cloud: NormPoint[]; dev: number | null; rows: CurveRow[]; note: string
}

/** Sayı birimiyle; değer yoksa yalnız "—" */
const bil = (v: number | null, d: number, u: string) => (v === null || !Number.isFinite(v) ? '—' : `${fmtN(v, d)} ${u}`)

export function egriPenceresi(g: EgriGiris): EgriPencere {
  const { m, pt, cloud } = g
  const rows: CurveRow[] = [
    { label: 'Akym Q', value: pt?.q != null ? `${fmtN(pt.q, 3)} m³/s` : '—' },
    { label: 'Basyş beýikligi H', value: pt?.h != null ? `${fmtN(pt.h, 1)} m` : '—' },
    { label: 'Basyş', value: bil(g.press, 2, 'bar') },
    { label: 'Kuwwat · Tok', value: g.kw === null && g.amp === null ? '—' : `${fmtN(g.kw, 0)} kW · ${fmtN(g.amp, 1)} A` },
    { label: 'Ýygylyk', value: bil(g.hz, 1, 'Hz') },
    { label: 'Suw derejesi', value: bil(g.level, 2, 'm') },
  ]
  if (m) rows.push(
    { label: 'Taslama Q', value: `${fmtN(m.taslama.q, 3)} m³/s` },
    { label: 'Taslama H', value: `${fmtN(m.taslama.h, 1)} m` },
    { label: 'Taslama η (PÝK)', value: `${fmtN(m.taslama.eta, 1)} %` },
  )
  // Zawod egrisinden tapawut: seçilen dönemin noktalarından (50 Hz'e indirgenmiş)
  const dev = m ? tapawut(m, cloud) : null
  const sev = tapawutSev(dev)
  if (m) rows.push({
    label: 'Egriden tapawut (24 sag)',
    value: dev === null ? 'nokat az' : `${dev > 0 ? '+' : ''}${fmtN(dev, 1)} % · ${sev === 'ok' ? 'kadaly' : sev === 'warn' ? 'duýduryş' : 'näsazlyk'}`,
    cls: sev === 'ok' ? 'good' : sev === 'warn' ? 'mid' : sev === 'fault' ? 'bad' : undefined,
  })

  const note = !g.running ? 'Nasos durýar: iş nokady ýok.'
    : pt?.q == null ? 'Akym hasaplanyp bilmedi (akym ölçegi we kuwwat ýok).'
    : pt.qUsul === 'akym' ? `Akym: ${g.akymOlcegi} akym ölçeginden${g.runN > 1
        ? (g.mixed ? `, ${g.runN} işleýän nasosa kuwwatlaryna görä bölündi (dürli görnüşli nasoslar)` : `, ${g.runN} işleýän nasosa deň bölündi`) : ''}.`
    : 'Akym: nasosyň kuwwatyndan, zawod egrisi boýunça (takmynan).'
  const lvlNote = (g.running && pt?.dz == null ? ' Suw derejesi ýa-da nasos okunyň beýikligi ýok: H diňe basyşdan.' : '')
    + (cloud.length ? ` Geçmiş: ${cloud.length} nokat${cloud.some((c) => c.inv) ? ', inwertordakylar 50 Hz-e getirildi' : ''}.` : '')

  return {
    title: g.title, sub: m ? `${m.ad} · ${m.motor_kw} kW · ${m.rpm} aýl/min` : 'Egri ýok',
    m, pt, cloud, dev, rows, note: note + lvlNote,
  }
}

/**
 * Deňeşdirme: soňky 24 sagadyň (5 min kovalar) 50 Hz'e indirgenmiş iş nokatları, Twin
 * geçmişinden (toplumun bütün nasosları, akym ölçegleri, howuz). g yoksa boş.
 */
export function useGecmisBulut(doc: EgriDoc | null, sid: string, g: Group | undefined,
                               cfg: StationCfg | null, pumpId: string): NormPoint[] {
  const [cloud, setCloud] = useState<NormPoint[]>([])
  const invert = invertOf(cfg)
  useEffect(() => {
    if (!doc || !g) return
    let ok = true
    const tg = (eq: string, k: string) => `${sid}.${eq}.${k}`
    const pumps = g.pumps.map((p) => {
      const lt = levelIdOf(p.id)
      return {
        id: p.id, model: modelOf(doc, sid, p.id), axis: axisOf(cfg, p.id),
        lvlTag: lt ? tg(lt, 'level_m') : null,
        press: tg(p.id, 'discharge_press_bar'), kw: tg(p.id, 'power_kw'), amp: tg(p.id, 'current_a'), hz: tg(p.id, 'vfd_freq_hz'),
      }
    })
    const flowTags = g.headers.map((h) => tg(h.id, 'flow_m3h'))
    const basinTag = tg(LEVEL_EQ, 'level_m')
    const tags = [...pumps.flatMap((p) => [p.press, p.kw, p.amp, p.hz, ...(p.lvlTag ? [p.lvlTag] : [])]), ...flowTags, basinTag]
    const to = Date.now() / 1000
    queryHistory(tags, to - 86400, to, 288)
      .then((r) => { if (ok) setCloud(gecmisNokatlar(doc, pumps, flowTags, basinTag, invert, r.data, pumpId)) })
      .catch(() => { if (ok) setCloud([]) })
    return () => { ok = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, g, sid, pumpId, invert])
  return cloud
}
