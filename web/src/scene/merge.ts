import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Yüklenen glTF sahnesini malzemeye göre birleştirir.
 *
 * Girdi : 153 ayrı mesh (her biri bir bileşen)
 * Çıktı : 6 mesh (malzeme başına bir tane), her köşe `aCompId` taşır
 *
 * Bileşen kimliği kaybolmaz — sadece nesne sınırı kaybolur. Seçim, boyama,
 * gizleme ve patlatma hepsi kimlik üzerinden çalışmaya devam eder.
 */

export interface ComponentInfo {
  id: number
  node: string
  equipment: string | null
  component: string | null
  eqType: string | null
  isStatic: boolean
  center: THREE.Vector3
  radius: number
  /** Boru kesit alanı (m²). Varsa akış hızı v = Q/A ile hesaplanabilir. */
  flowArea: number | null
  /** Hareketli parça: eksen (glTF uzayında) ve tam strok (m). Kapak kanadı gibi. */
  travel: { axis: THREE.Vector3; range: number } | null
  /** Bina duvarı/çatısı: dış normal (glTF uzayında). Kameraya bakınca gizlenir. */
  faceN: THREE.Vector3 | null
  /** Ölçüm yazısının bağlandığı nokta (glTF uzayında) — seviye datçiği gibi. */
  labelAnchor: THREE.Vector3 | null
}

export interface MergedScene {
  group: THREE.Group
  meshes: THREE.Mesh[]
  components: ComponentInfo[]
  byNode: Map<string, number>
  byEquipment: Map<string, number[]>
  materialNames: string[]
  stats: { sourceMeshes: number; drawCalls: number; triangles: number; vertices: number }
}

const REQUIRED = ['position', 'normal', 'color'] as const

/**
 * Bileşenin baskın eksenini bulur ve her köşeye o eksen boyunca metre cinsinden
 * bir koordinat yazar. Akış animasyonu bu koordinat üzerinde yürüyen bir dalga.
 *
 * Neden doku değil: Pi 4'te doku belleği ve örnekleme maliyetinden kaçınıyoruz.
 * Tek bir float öznitelik + fragment'te bir sinüs, doku okumaktan ucuz.
 */
function flowAxis(geo: THREE.BufferGeometry): { origin: THREE.Vector3; dir: THREE.Vector3 } {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const size = bb.getSize(new THREE.Vector3())
  const dir = size.x >= size.y && size.x >= size.z ? new THREE.Vector3(1, 0, 0)
    : size.y >= size.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  return { origin: bb.min.clone(), dir }
}

function normalize(geo: THREE.BufferGeometry, compId: number): THREE.BufferGeometry {
  const g = geo.clone()
  // Doku koordinatı taşımıyoruz — bu modelde hiç doku yok, boşuna bellek.
  for (const name of Object.keys(g.attributes)) {
    if (!REQUIRED.includes(name as (typeof REQUIRED)[number])) g.deleteAttribute(name)
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  if (!g.getAttribute('color')) {
    const n = g.getAttribute('position').count
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  }

  // COLOR_0'ı 3 bileşenli ve 0..1 aralığında, düz (non-interleaved) bir
  // özniteliğe çevir. İki tuzak var, ikisi de ölçülerek bulundu:
  //
  //  1) getX/getY/getZ kullanılmalı, .array DEĞİL. three.js araya geçmiş
  //     (interleaved) tampon üretebilir; .array o zaman tüm özniteliklerin
  //     ortak tamponudur ve i*itemSize ile indekslemek POZİSYON verisini renk
  //     sanmaya yol açar (gözlemlenen "renk" aralığı 9–160'tı — metre cinsinden
  //     koordinatlar).
  //  2) Ölçek `normalized` bayrağına değil gerçek değere bakılarak seçilmeli.
  //     Draco ile sıkıştırılmış COLOR_0 çözüldüğünde bayrak taşınmıyor ve ham
  //     0..255 bayt geliyor; bayrağa güvenirsek sahne beyaza doyuyor.
  const col = g.getAttribute('color')
  let max = 0
  const step = Math.max(1, Math.floor(col.count / 512))
  for (let i = 0; i < col.count; i += step) {
    const v = col.getX(i)
    if (Number.isFinite(v)) max = Math.max(max, v)
  }
  const scale = max > 1.5 ? 1 / 255 : 1
  const out = new Float32Array(col.count * 3)
  const hasRGB = col.itemSize >= 3
  for (let i = 0; i < col.count; i++) {
    out[i * 3] = col.getX(i) * scale
    out[i * 3 + 1] = (hasRGB ? col.getY(i) : col.getX(i)) * scale
    out[i * 3 + 2] = (hasRGB ? col.getZ(i) : col.getX(i)) * scale
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3))

  const n = g.getAttribute('position').count
  g.setAttribute('aCompId', new THREE.BufferAttribute(new Float32Array(n).fill(compId), 1))
  return g
}

/**
 * Dünya uzayında akış koordinatı ekler (geometri zaten dönüştürülmüş olmalı).
 *
 * Üretici boru düğümüne `flow_w` (Blender ekseninde ağırlıklar) yazdıysa
 * u = w·p; bant +u yönünde, yani akış yönünde yürür. Yükseltici + yatay hatta
 * w = (0, 1, 1) ile u boru boyunca kesintisiz artar. `flow_join_x` varsa
 * u'dan |x − join_x| düşülür: kolektörde akış iki uçtan ana hatta toplanır.
 * Bilgi yoksa (eski model) sınır kutusunun baskın ekseni kullanılır.
 */
function addFlowCoord(g: THREE.BufferGeometry, ud: Record<string, unknown>): void {
  const pos = g.getAttribute('position')
  const u = new Float32Array(pos.count)
  const w = ud.flow_w
  if (Array.isArray(w) && w.length === 3) {
    // Blender (x, y, z) -> glTF (x, z, -y): u = wx·gx + wz·gy − wy·gz
    const [wx, wy, wz] = w.map(Number)
    const jx = typeof ud.flow_join_x === 'number' ? ud.flow_join_x : null
    for (let i = 0; i < pos.count; i++) {
      u[i] = wx * pos.getX(i) + wz * pos.getY(i) - wy * pos.getZ(i)
        - (jx === null ? 0 : Math.abs(pos.getX(i) - jx))
    }
  } else {
    const { origin, dir } = flowAxis(g)
    for (let i = 0; i < pos.count; i++) {
      u[i] = (pos.getX(i) - origin.x) * dir.x
        + (pos.getY(i) - origin.y) * dir.y
        + (pos.getZ(i) - origin.z) * dir.z
    }
  }
  g.setAttribute('aFlowU', new THREE.BufferAttribute(u, 1))
}

/** Eski modellerdeki arazi katmanı — artık sahneye alınmıyor (düz arka plan). */
const SKIP_NODES = new Set(['STATIC__TERRAIN'])

export function mergeByMaterial(
  root: THREE.Object3D,
  makeMaterial: (name: string, baseColor: THREE.Color, transparent: boolean) => THREE.Material,
): MergedScene {
  root.updateMatrixWorld(true)

  const components: ComponentInfo[] = []
  const byNode = new Map<string, number>()
  const byEquipment = new Map<string, number[]>()
  const buckets = new Map<string, { geos: THREE.BufferGeometry[]; color: THREE.Color; transparent: boolean }>()
  let sourceMeshes = 0

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return
    const mesh = obj as THREE.Mesh
    if (SKIP_NODES.has(mesh.name)) return
    sourceMeshes++

    const ud = mesh.userData ?? {}
    const id = components.length
    const geo = normalize(mesh.geometry as THREE.BufferGeometry, id)
    geo.applyMatrix4(mesh.matrixWorld)
    addFlowCoord(geo, ud)
    geo.computeBoundingSphere()
    const bs = geo.boundingSphere!

    components.push({
      id,
      node: mesh.name,
      equipment: ud.equipment ?? null,
      component: ud.component ?? null,
      eqType: ud.eq_type ?? null,
      isStatic: ud.static === true,
      center: bs.center.clone(),
      radius: bs.radius,
      flowArea: typeof ud.flow_area_m2 === 'number' ? ud.flow_area_m2 : null,
      // Blender Z-yukarı -> glTF Y-yukarı. Üretici ekseni Blender uzayında yazıyor.
      travel: typeof ud.travel_range === 'number'
        ? {
            axis: ud.travel_axis === 'Z' ? new THREE.Vector3(0, 1, 0)
              : ud.travel_axis === 'Y' ? new THREE.Vector3(0, 0, -1)
              : new THREE.Vector3(1, 0, 0),
            range: ud.travel_range,
          }
        : null,
      faceN: Array.isArray(ud.face_n) && ud.face_n.length === 3
        ? new THREE.Vector3(Number(ud.face_n[0]), Number(ud.face_n[2]), -Number(ud.face_n[1]))
        : null,
      labelAnchor: Array.isArray(ud.label_anchor) && ud.label_anchor.length === 3
        ? new THREE.Vector3(Number(ud.label_anchor[0]), Number(ud.label_anchor[2]), -Number(ud.label_anchor[1]))
        : null,
    })
    byNode.set(mesh.name, id)
    if (ud.equipment) {
      const arr = byEquipment.get(ud.equipment) ?? []
      arr.push(id)
      byEquipment.set(ud.equipment, arr)
    }

    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const key = mat?.name || 'DEFAULT'
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        geos: [],
        color: mat?.color?.clone() ?? new THREE.Color(0xcccccc),
        transparent: (mat?.opacity ?? 1) < 0.99 || mat?.transparent === true,
      }
      buckets.set(key, bucket)
    }
    bucket.geos.push(geo)
  })

  const group = new THREE.Group()
  group.name = 'TWIN'
  const meshes: THREE.Mesh[] = []
  let triangles = 0
  let vertices = 0

  for (const [name, bucket] of buckets) {
    // mergeGeometries indeksli/indekssiz karışımı kabul etmez
    const anyNonIndexed = bucket.geos.some((g) => !g.index)
    const geos = anyNonIndexed ? bucket.geos.map((g) => (g.index ? g.toNonIndexed() : g)) : bucket.geos
    const merged = mergeGeometries(geos, false)
    if (!merged) {
      console.warn(`[merge] "${name}" birleştirilemedi, ${geos.length} parça atlandı`)
      continue
    }
    merged.computeBoundingSphere()
    merged.computeBoundingBox()
    const mesh = new THREE.Mesh(merged, makeMaterial(name, bucket.color, bucket.transparent))
    mesh.name = `MERGED__${name}`
    mesh.userData.materialName = name
    mesh.renderOrder = bucket.transparent ? 10 : 0
    group.add(mesh)
    meshes.push(mesh)

    const pos = merged.getAttribute('position').count
    vertices += pos
    triangles += (merged.index ? merged.index.count : pos) / 3
    for (const g of geos) g.dispose()
  }

  return {
    group, meshes, components, byNode, byEquipment,
    materialNames: [...buckets.keys()],
    stats: { sourceMeshes, drawCalls: meshes.length, triangles: Math.round(triangles), vertices },
  }
}
