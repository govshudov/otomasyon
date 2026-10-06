import * as THREE from 'three'
import type { TwinMap } from './types'

type WaterParams = TwinMap['geometry']['water']

/**
 * Su yüzeyi — seviyeye göre yeniden hesaplanır.
 *
 * Kanalın yan duvarları şevli olduğu için su seviyesi yükseldikçe yüzey de
 * genişler. Sadece düzlemi yukarı taşımak yanlış görünür (alçak seviyede
 * duvarların içinden geçer). Model üreticisi kanal planını (`plan`:
 * [y, taban, üst] istasyonları) `twin-map.json` içine yazdı; burada birebir
 * uygulanıyor.
 *
 * Kanalın memba ucu açık kesit. Orada suyun dikey kesit yüzü de çiziliyor —
 * referans görseldeki "su hacmi" görünümü bu yüzden. Toplam birkaç düzine
 * köşe, maliyeti yok.
 */
export class WaterSurface {
  readonly mesh: THREE.Mesh
  private geo: THREE.BufferGeometry
  private plan: [number, number, number][]
  private invert: number
  private deck: number
  private level = Number.NaN

  constructor(params: WaterParams, color: THREE.Color) {
    this.plan = planOf(params)
    this.invert = params.invert_el
    this.deck = params.deck_el
    const n = this.plan.length

    // Köşeler: [0, 2n) üst yüzey (her istasyonda sol/sağ), [2n, 2n+4) memba kesit yüzü
    this.geo = new THREE.BufferGeometry()
    const idx: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3
      idx.push(a, c, d, a, d, b)
    }
    const f = 2 * n                               // kesit: sol-alt, sağ-alt, sağ-üst, sol-üst
    idx.push(f, f + 1, f + 2, f, f + 2, f + 3)
    const count = 2 * n + 4
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    // Kesit yüzü biraz koyu: derinlik hissi (üst yüzey 0.86, kesit 0.62)
    const col = new Float32Array(count * 3).fill(0.86)
    col.fill(0.62, f * 3)
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.geo.setIndex(idx)

    const mat = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity: 0.62,
      depthWrite: false, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geo, mat)
    this.mesh.name = 'WATER__SURFACE'
    this.mesh.renderOrder = 12
    this.setLevel((params.invert_el + params.deck_el) / 2)
  }

  /** Bir plan istasyonunda yarı genişlik — üreticinin formülünün birebir karşılığı. */
  private halfWidth(wb: number, wt: number, level: number): number {
    const t = Math.max(0, Math.min(1, (level - this.invert) / (this.deck - this.invert)))
    return (wb + (wt - wb) * t) / 2
  }

  setLevel(level: number): void {
    if (Math.abs(level - this.level) < 1e-3) return
    this.level = level
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute
    // Blender (x, y, z) -> glTF (x, z, -y)
    this.plan.forEach(([y, wb, wt], i) => {
      const hw = this.halfWidth(wb, wt, level)
      pos.setXYZ(i * 2, -hw, level, -y)
      pos.setXYZ(i * 2 + 1, hw, level, -y)
    })
    const [y0, wb0, wt0] = this.plan[0]
    const f = 2 * this.plan.length
    const hw = this.halfWidth(wb0, wt0, level)
    pos.setXYZ(f, -wb0 / 2, this.invert, -y0)
    pos.setXYZ(f + 1, wb0 / 2, this.invert, -y0)
    pos.setXYZ(f + 2, hw, level, -y0)
    pos.setXYZ(f + 3, -hw, level, -y0)
    pos.needsUpdate = true
    this.geo.computeBoundingSphere()
  }

  get currentLevel(): number { return this.level }

  /** GPU tamponlarını bırakır. İstasyon değişiminde çağrılmazsa sızıntı olur. */
  dispose(): void {
    this.geo.dispose()
    const m = this.mesh.material
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m.dispose()
  }
}

/**
 * Plan istasyonları. Eski twin-map'lerde yalnız tek trapez + doğrusal daralma
 * (`inlet_scale`) vardı — o biçim de aynı istasyon listesine çevrilir.
 */
function planOf(p: WaterParams): [number, number, number][] {
  if (p.plan?.length) return p.plan
  const n = p.sections ?? 6
  const L = (p.y_to ?? 0) - (p.y_from ?? 0)
  const out: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const y = (p.y_from ?? 0) + (L * i) / (n - 1)
    const s = (p.inlet_scale ?? 1) + (1 - (p.inlet_scale ?? 1)) * (i / (n - 1))
    out.push([y, (p.width_bottom ?? 0) * s, (p.width_top ?? 0) * s])
  }
  return out
}
