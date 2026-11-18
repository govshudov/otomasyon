/**
 * "Daşyna çykar": Arhiw'in açık sekmesinin içeriği PDF olarak (tarayıcının çap penceresi →
 * "PDF hökmünde ýatda sakla"). Görünüş SUW GEÇIRIJILER sayfasının çıktısıyla aynı
 * (public/gecirijiler.js printReport / showPrintFallback): logolu başlık, KPI kutuları,
 * çerçeveli bölümler, açık renkli tablolar, altta kaynak ve tarih.
 *
 * Sayfadaki bileşenler (ChartBoard, Hasabatlar, Sazlamalar) ne çıkarılacağını `useCikar` ile
 * bildirir; düğme en son bildireni çıkarır. Grafikler kâğıt renkleriyle SVG olarak çizilir
 * (chartSvg.ts — ekrandaki çizimin aynısı), tablolar tablo olarak.
 */
import { useEffect, useRef } from 'react'
import type { ChartSpec } from './ChartBoard'
import { chartSvg, inkColor } from './chartSvg'
import { fmtDateTime, fmtNum } from './Chart'
import { asset, DEMO } from '../data/niagara'

export interface CikarCol { t: string; sub?: string; num?: boolean }
export interface CikarRow { c: (string | number)[]; cls?: 'grp' | 'tot' | 'ind' }
export interface CikarTable { title: string; cols: CikarCol[]; rows: CikarRow[] }
export interface CikarKpi { l: string; v: string; u?: string }

export type CikarItem =
  | { kind: 'charts'; title: string; from: number; to: number; charts: ChartSpec[]; source?: string }
  | { kind: 'tables'; title: string; period?: string; kpi?: CikarKpi[]; tables: CikarTable[]; source?: string; note?: string }

export interface CikarCtx { page: string; station: string; sid: string }

// --------------------------------------------------------------------------- //
// Kayıt: sayfadaki bileşen ne çıkarılacağını bildirir
// --------------------------------------------------------------------------- //

type Maker = () => CikarItem | null
const makers: { current: Maker }[] = []

export function useCikar(make: Maker): void {
  const ref = useRef(make)
  ref.current = make
  useEffect(() => {
    makers.push(ref)
    return () => { const i = makers.indexOf(ref); if (i >= 0) makers.splice(i, 1) }
  }, [])
}

/** Şu an çıkarılacak içerik (yoksa null) */
export const cikarItem = (): CikarItem | null => makers[makers.length - 1]?.current() ?? null

// --------------------------------------------------------------------------- //
// Belge
// --------------------------------------------------------------------------- //

const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CSS = `
 @page{size:A4 landscape;margin:11mm}
 *{box-sizing:border-box}
 body{margin:0;font-family:Inter,Arial,sans-serif;color:#12212F;font-size:10.5px;background:#fff}
 .hd{display:flex;align-items:center;gap:14px;border-bottom:2.5px solid #0B4E6B;padding-bottom:9px}
 .hd img{width:62px;height:62px;object-fit:contain}
 .hd h1{margin:0;font-size:15px;letter-spacing:.04em;color:#0B4E6B}
 .hd .s{font-size:10px;color:#4A5F76;margin-top:3px;line-height:1.5}
 .hd .r{margin-left:auto;text-align:right;font-size:10px;color:#4A5F76;line-height:1.6}
 .kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:11px 0}
 .kpi>div{border:1px solid #C7D2DD;border-radius:5px;padding:6px 8px}
 .kpi .l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#6B7F94}
 .kpi .v{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .kpi .u{font-size:8.5px;color:#6B7F94;font-weight:400}
 table{width:100%;border-collapse:collapse;margin-top:4px}
 th,td{border-bottom:1px solid #DDE5EC;padding:4px 7px;font-size:9.5px;text-align:left}
 td{white-space:nowrap}
 th{background:#EEF3F8;color:#4A5F76;font-size:8.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:600;vertical-align:bottom}
 th small{display:block;text-transform:none;letter-spacing:0;font-weight:400;color:#6B7F94}
 td.m,th.m{text-align:right;font-family:"IBM Plex Mono",monospace}
 th.m{font-family:inherit}
 tr.tot td{border-top:1.4px solid #9AAABB;font-weight:700;color:#0B4E6B}
 tr.grp td{background:#F4F7FA;font-weight:700;color:#0B4E6B}
 tr.ind td:first-child{padding-left:18px;color:#33506B}
 .cg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}
 .cg.one{grid-template-columns:1fr}
 .bx{border:1px solid #C7D2DD;border-radius:5px;padding:7px 9px 5px;break-inside:avoid}
 .bt{font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin-bottom:3px;display:flex;gap:8px;align-items:baseline}
 .bt b{color:#0B4E6B;letter-spacing:.06em}
 .lg{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:8.5px;color:#33506B;margin-bottom:2px}
 .lg span{display:inline-flex;align-items:center;gap:5px}
 .lg i{display:inline-block;width:14px;height:0;border-top:2.4px solid}
 .lg i.d{border-top-style:dashed}
 .lg i.b{width:9px;height:9px;border:0}
 .bt2{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#4A5F76;margin:12px 0 2px;break-after:avoid}
 .sec{break-inside:auto}
 thead{display:table-header-group}
 tr{break-inside:avoid}
 .ft{margin-top:9px;border-top:1px solid #C7D2DD;padding-top:5px;font-size:8px;color:#6B7F94;line-height:1.5}
 .nt{font-size:8.5px;color:#6B7F94;margin-top:6px}`

const nowS = () => { const d = new Date(); return `${d.toLocaleDateString('ru-RU')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const rng = (a: number, b: number) => `${fmtDateTime(a)} – ${fmtDateTime(b)}`

function kpiHtml(k: CikarKpi[]): string {
  return `<div class="kpi">${k.slice(0, 6).map((x) => `<div><div class="l">${esc(x.l)}</div><div class="v">${esc(x.v)}${x.u ? ` <span class="u">${esc(x.u)}</span>` : ''}</div></div>`).join('')}</div>`
}

function tableHtml(t: CikarTable): string {
  const head = t.cols.map((c) => `<th${c.num ? ' class="m"' : ''}>${esc(c.t)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</th>`).join('')
  const rows = t.rows.map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ''}>${r.c.map((v, i) => `<td${t.cols[i]?.num ? ' class="m"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')
  return `<div class="sec"><div class="bt2">${esc(t.title)}</div><table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${t.cols.length}">Maglumat ýok</td></tr>`}</tbody></table></div>`
}

/** Grafiklerin özeti: her seri için iň pes / ortaça / iň ýokary / soňky (sütunluda jemi) */
function statsTable(charts: ChartSpec[]): CikarTable {
  const rows: CikarRow[] = []
  for (const c of charts) {
    if (c.enumLabels?.length) continue
    const dg = c.digits ?? 1
    const f = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : fmtNum(v, dg))
    c.series.forEach((s, i) => {
      const d = s.data
      const has = d.length > 0
      const sum = d.reduce((a, b) => a + b[1], 0)
      rows.push({ c: [i === 0 ? c.title : '', s.label,
        has ? f(Math.min(...d.map((b) => (c.bars ? b[1] : b[2])))) : '—',
        has ? f(sum / d.length) : '—',
        has ? f(Math.max(...d.map((b) => (c.bars ? b[1] : b[3])))) : '—',
        has && !c.bars ? f(d[d.length - 1][1]) : '—',
        has && c.bars ? f(sum) : '—',
        c.unit ?? ''] })
    })
  }
  return {
    title: 'Grafikleriň gysgaça beýany',
    cols: [{ t: 'Grafik' }, { t: 'Ölçeg' }, { t: 'Iň pes', num: true }, { t: 'Ortaça', num: true }, { t: 'Iň ýokary', num: true },
      { t: 'Soňky', num: true }, { t: 'Jemi', num: true }, { t: 'Birlik' }],
    rows,
  }
}

function chartBox(c: ChartSpec, from: number, to: number, wide: boolean): string {
  const { key: _k, title, series, ...rest } = c
  void _k
  const svg = chartSvg({ ...rest, series, from, to }, wide ? 1100 : 560, wide ? 300 : 230)
  const lg = series.length > 1 ? `<div class="lg">${series.map((s) => {
    const col = inkColor(s.color)
    return `<span><i class="${c.bars ? 'b' : s.dashed ? 'd' : ''}" style="${c.bars ? `background:${col}` : `border-top-color:${col}`}"></i>${esc(s.label)}</span>`
  }).join('')}</div>` : ''
  return `<div class="bx"><div class="bt"><b>${esc(title)}</b>${c.unit ? `<span>${esc(c.unit)}</span>` : ''}</div>${lg}${svg}</div>`
}

export function cikarDoc(item: CikarItem, ctx: CikarCtx): string {
  const logo = asset('gecirijiler-logo.png')
  const src = item.source ?? (DEMO ? 'synag maglumaty (demo, ölçeg däl)' : 'Tridium Niagara · maglumat binýady (TimescaleDB)')
  let right = '', body = ''
  if (item.kind === 'charts') {
    const nSer = item.charts.reduce((a, c) => a + c.series.length, 0)
    right = rng(item.from, item.to)
    body = kpiHtml([
      { l: 'Beket', v: ctx.sid },
      { l: 'Görnüş', v: item.title },
      { l: 'Döwrüň başy', v: fmtDateTime(item.from) },
      { l: 'Döwrüň soňy', v: fmtDateTime(item.to) },
      { l: 'Grafik sany', v: String(item.charts.length) },
      { l: 'Ölçeg sany', v: String(nSer) },
    ]) + `<div class="cg${item.charts.length === 1 ? ' one' : ''}">${item.charts.map((c) => chartBox(c, item.from, item.to, item.charts.length === 1)).join('')}</div>`
    const st = statsTable(item.charts)
    if (st.rows.length) body += tableHtml(st)
  } else {
    right = item.period ?? ''
    body = (item.kpi?.length ? kpiHtml(item.kpi) : '') + item.tables.map(tableHtml).join('') +
      (item.note ? `<div class="nt">${esc(item.note)}</div>` : '')
  }
  const head = `
   <div class="hd"><img src="${logo}" onerror="this.style.display='none'">
     <div><h1>ARHIW MAGLUMATLARY</h1>
       <div class="s">Türkmenistanyň Suw Hojalygy baradaky Döwlet Komiteti<br>${esc(ctx.page)} · ${esc(item.title)}</div></div>
     <div class="r"><b>${esc(ctx.station)}</b> · ${esc(ctx.sid)}<br>${esc(right)}${DEMO ? '<br><b>SYNAG MAGLUMATY</b>' : ''}</div></div>`
  const foot = `<div class="ft">Çeşme: ${esc(src)}.<br>Hasabat senesi: ${nowS()}</div>`
  return `<!DOCTYPE html><html lang="tk"><head><meta charset="utf-8">
    <title>${esc(ctx.station)} · ${esc(ctx.page)} · ${esc(item.title)}</title><style>${CSS}</style></head><body>${head}${body}${foot}</body></html>`
}

// --------------------------------------------------------------------------- //
// Çap (gecirijiler.js printReport / showPrintFallback ile aynı yol)
// --------------------------------------------------------------------------- //

export function printDoc(doc: string): void {
  document.getElementById('printFrame')?.remove()
  const f = document.createElement('iframe')
  f.id = 'printFrame'; f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0'
  document.body.appendChild(f)
  f.srcdoc = doc
  f.onload = () => {
    setTimeout(() => {
      try { f.contentWindow!.focus(); f.contentWindow!.print() } catch { showPrintFallback(doc) }
    }, 350)
  }
  setTimeout(() => { if (!f.contentWindow || !f.contentDocument || !f.contentDocument.body) showPrintFallback(doc) }, 2500)
}

export function showPrintFallback(doc: string): void {
  let ov = document.getElementById('prOv')
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'prOv'
    ov.style.cssText = 'position:fixed;inset:0;background:#384B5A;z-index:99;display:flex;flex-direction:column'
    ov.innerHTML = `<div style="display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #526D82">
        <span style="font-size:12px;color:#93AECB">Çap görnüşi — brauzerde <b>Ctrl+P</b> bilen PDF hökmünde ýatda sakla</span>
        <button id="prClose" style="margin-left:auto">Ýap</button></div>
      <iframe id="prFrame" style="flex:1;border:0;background:#fff"></iframe>`
    document.body.appendChild(ov)
    ov.querySelector<HTMLButtonElement>('#prClose')!.onclick = () => ov!.remove()
  }
  ov.querySelector<HTMLIFrameElement>('#prFrame')!.srcdoc = doc
}

/** Arhiw'in "Daşyna çykar" düğmesi */
export function cikar(ctx: CikarCtx): boolean {
  const item = cikarItem()
  if (!item) return false
  printDoc(cikarDoc(item, ctx))
  return true
}
