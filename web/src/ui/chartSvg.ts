/**
 * Grafiğin SVG'si — PDF çıktısı için (cikar.ts). Çizim ekrandakiyle aynı kod (Chart.tsx drawChart);
 * burada yalnız canvas yerine SVG yazan küçük bir "tuval" var. SVG vektör: kâğıtta keskin, satır içi
 * olduğu için istasyonun CSP'si (img-src) engellemez.
 */
import { PRINT, chartGeometry, drawChart, type ChartProps, type Paint } from './Chart'

type M = [number, number, number, number, number, number]
const r2 = (v: number) => Math.round(v * 100) / 100
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Grad { id: string; x0: number; y0: number; x1: number; y1: number; stops: [number, string][]; addColorStop(o: number, c: string): void }

/** "rgba(r,g,b,a)" / "#rrggbb" → [renk, opaklık] */
function colorOf(c: string): [string, number] {
  const m = /^rgba?\(([^)]+)\)$/.exec(c.trim())
  if (!m) return [c, 1]
  const p = m[1].split(',').map((x) => x.trim())
  return [`rgb(${p[0]},${p[1]},${p[2]})`, p[3] !== undefined ? Number(p[3]) : 1]
}

class SvgPaint implements Paint {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = '10px sans-serif'
  textAlign: CanvasTextAlign = 'start'
  globalAlpha = 1
  private out: string[] = []
  private defs: string[] = []
  private d = ''
  private dash: number[] = []
  private m: M = [1, 0, 0, 1, 0, 0]
  private open = 0                       // son save()'den beri açılan <g> sayısı
  private stack: { m: M; dash: number[]; open: number; fillStyle: SvgPaint['fillStyle']; strokeStyle: SvgPaint['strokeStyle']; lineWidth: number; font: string; textAlign: CanvasTextAlign; globalAlpha: number }[] = []
  private seq = 0

  private tp(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m
    return [r2(a * x + c * y + e), r2(b * x + d * y + f)]
  }
  private mul(n: M): void {
    const [a, b, c, d, e, f] = this.m
    this.m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f]
  }
  private paint(kind: 'fill' | 'stroke', v: SvgPaint['fillStyle']): string {
    if (typeof v !== 'string') {
      const g = v as unknown as Grad
      if (g.id) {
        this.defs.push(`<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}">` +
          g.stops.map(([o, c]) => { const [col, a] = colorOf(c); return `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>` }).join('') + '</linearGradient>')
        return `${kind}="url(#${g.id})"`
      }
      return `${kind}="none"`
    }
    const [col, a] = colorOf(v)
    const op = r2(a * this.globalAlpha)
    return `${kind}="${col}"${op < 1 ? ` ${kind}-opacity="${op}"` : ''}`
  }

  beginPath(): void { this.d = '' }
  moveTo(x: number, y: number): void { const [X, Y] = this.tp(x, y); this.d += `M${X} ${Y}` }
  lineTo(x: number, y: number): void { const [X, Y] = this.tp(x, y); this.d += `L${X} ${Y}` }
  closePath(): void { this.d += 'Z' }
  rect(x: number, y: number, w: number, h: number): void { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath() }
  arc(x: number, y: number, r: number): void {
    const [X, Y] = this.tp(x, y)
    this.d += `M${r2(X - r)} ${Y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
  }
  stroke(): void {
    if (!this.d) return
    this.out.push(`<path d="${this.d}" fill="none" ${this.paint('stroke', this.strokeStyle)} stroke-width="${this.lineWidth}"` +
      `${this.dash.length ? ` stroke-dasharray="${this.dash.join(' ')}"` : ''} stroke-linejoin="round"/>`)
  }
  fill(): void { if (this.d) this.out.push(`<path d="${this.d}" ${this.paint('fill', this.fillStyle)}/>`) }
  fillRect(x: number, y: number, w: number, h: number): void {
    const keep = this.d
    this.d = ''; this.rect(x, y, w, h); this.fill()
    this.d = keep
  }
  fillText(s: string, x: number, y: number): void {
    const [a, b, c, d] = this.m
    const [X, Y] = this.tp(x, y)
    const anchor = this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : this.textAlign === 'center' ? 'middle' : 'start'
    const tr = a === 1 && b === 0 && c === 0 && d === 1 ? `x="${X}" y="${Y}"` : `transform="matrix(${r2(a)} ${r2(b)} ${r2(c)} ${r2(d)} ${X} ${Y})"`
    this.out.push(`<text ${tr} text-anchor="${anchor}" style="font:${esc(this.font)}" ${this.paint('fill', this.fillStyle)}>${esc(s)}</text>`)
  }
  measureText(s: string): { width: number } {
    const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10)
    return { width: s.length * px * (/bold/.test(this.font) ? 0.6 : 0.56) }
  }
  setLineDash(d: number[]): void { this.dash = d }
  save(): void {
    this.stack.push({ m: [...this.m] as M, dash: this.dash, open: this.open, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, globalAlpha: this.globalAlpha })
    this.open = 0
  }
  restore(): void {
    for (; this.open > 0; this.open--) this.out.push('</g>')
    const s = this.stack.pop()
    if (!s) return
    Object.assign(this, { m: s.m, dash: s.dash, open: s.open, fillStyle: s.fillStyle, strokeStyle: s.strokeStyle,
      lineWidth: s.lineWidth, font: s.font, textAlign: s.textAlign, globalAlpha: s.globalAlpha })
  }
  clip(): void {
    const id = `k${this.seq++}`
    this.defs.push(`<clipPath id="${id}"><path d="${this.d}"/></clipPath>`)
    this.out.push(`<g clip-path="url(#${id})">`)
    this.open++
  }
  translate(x: number, y: number): void { this.mul([1, 0, 0, 1, x, y]) }
  rotate(a: number): void { const c = Math.cos(a), s = Math.sin(a); this.mul([c, s, -s, c, 0, 0]) }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    const g: Grad = { id: `g${this.seq++}`, x0, y0, x1, y1, stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }
    return g as unknown as CanvasGradient
  }

  svg(W: number, H: number, uid: string): string {
    while (this.stack.length) this.restore()
    // id'ler belgede tekil olsun (birçok grafik aynı sayfada)
    const body = `<defs>${this.defs.join('')}</defs>${this.out.join('')}`.replace(/(id="|url\(#)([gk]\d+)/g, `$1${uid}$2`)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block">${body}</svg>`
  }
}

/** Ekran rengi → beyaz kâğıtta okunur koyu ton (açık renklerin parlaklığı düşürülür) */
export function inkColor(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const n = parseInt(m[1], 16)
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (l <= 0.46) return c
  const d = mx - mn
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60; if (h < 0) h += 360
  const L = 0.42, S = Math.min(1, s * 1.05)
  const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m0 = L - C / 2
  ;[r, g, b] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X]
  const hx = (v: number) => Math.round((v + m0) * 255).toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

let uidSeq = 0

/** Grafiğin kâğıt renkleriyle SVG'si (W×H birim; sayfada genişliğe yayılır) */
export function chartSvg(p: ChartProps, W = 560, H = 230): string {
  const series = p.series.map((s) => ({ ...s, color: inkColor(s.color) }))
  const props: ChartProps = { ...p, series }
  const geo = chartGeometry(props, series, W, H)
  const g = new SvgPaint()
  drawChart(g, geo, props, series, PRINT, null)
  return g.svg(W, H, `c${uidSeq++}_`)
}
