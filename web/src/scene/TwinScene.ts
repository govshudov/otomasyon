import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { createControls } from './controls'
import { createComponentTextures, createTwinMaterial, type ComponentTextures } from './material'
import { mergeByMaterial, type ComponentInfo, type MergedScene } from './merge'
import { PALETTE, stateOverlay } from './palette'
import type { TwinMap } from './types'
import { WaterSurface } from './water'

export interface PerfStats {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  programs: number
  targetFps: number
  idle: boolean
}

export interface SceneEvents {
  onPick?: (info: ComponentInfo | null) => void
  onHover?: (info: ComponentInfo | null) => void
  onStats?: (s: PerfStats) => void
  onDoubleTap?: (info: ComponentInfo | null) => void
  onReady?: (m: MergedScene, t: TwinMap) => void
}

/**
 * Ana görünüm yönü (glTF, hedeften kameraya). Referans görselin eksen
 * izdüşümlerinden çıkarıldı: azimut −37° (memba tarafından, +X yanından),
 * yükseklik 36°.
 * Kanal sol altta, pompalar ve ana hatlar sağ üstte kalır.
 */
const HOME_DIR = new THREE.Vector3(0.646, 0.588, 0.487).normalize()
/** Ana görünüm uzaklığı: sınır küresini tam sığdıran mesafenin bu oranı. Tesis
 * uzun ve basık; küre köşegene göre hesaplandığı için 1,0 onu ekranda küçük bırakıyor. */
const HOME_FIT = 0.66

/** Kamera çerçevesi için tesisin sınır kutusu (bileşen sınır kürelerinden). */
function plantBox(merged: MergedScene): THREE.Box3 {
  const box = new THREE.Box3()
  for (const c of merged.components) {
    box.expandByPoint(c.center.clone().addScalar(-c.radius))
    box.expandByPoint(c.center.clone().addScalar(c.radius))
  }
  return box.isEmpty() ? new THREE.Box3().setFromObject(merged.group) : box
}

/** Ağaçtaki her mesh'in geometrisini ve malzemesini bırakır. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry?.dispose()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x?.dispose())
    else mat?.dispose()
  })
}

// Kare hızı sınırları.
//
// Sahne sürekli tam hızda render edilirse Pi 4 hiç boş kalmaz ve sıcaklık
// kısma eşiğine (80 °C) tırmanır. Bir SCADA ekranında buna gerek yok:
// hiçbir şey hareket etmiyorken saniyede 50 kare çizmek boşuna ısı üretir.
//
// İki kademe: etkileşim/veri değişimi varken AKTIF, sonra BOŞTA'ya düşer.
// Herhangi bir dokunma, kamera hareketi ya da durum değişimi anında uyandırır.
const FPS_ACTIVE = 30          // etkileşim, kamera hareketi, geçiş animasyonu
const FPS_ANIMATING = 12       // yalnız akış/su animasyonu sürüyorsa
const FPS_IDLE = 6             // ekranda hiçbir hareket yokken
const IDLE_AFTER_MS = 2500     // bu kadar sessizlikten sonra düşür

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/** Çalışma durumuna göre boyanan pompa parçaları (motor + pompa gövdesi). */
const STATUS_PARTS = new Set(['MOTOR', 'PUMP'])

const TAP_SLOP_PX = 7
const TAP_SLOP_TOUCH_PX = 14      // parmak fareden daha çok kayar
const FRAME_MS = 1000 / 60

export class TwinScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private controls!: OrbitControls
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private tex!: ComponentTextures
  private merged?: MergedScene
  private twin?: TwinMap
  private water?: WaterSurface
  private events: SceneEvents
  private raf = 0
  private disposed = false
  private paused = false       // 2D sayfa açıkken 3D hiç çizilmez
  private loadToken = 0        // eşzamanlı load() çağrılarında son kazanır

  private selected: number | null = null
  private selectedEq: string | null = null       // bilgi kartı açık olan ekipman
  private hovered: number | null = null
  private card: { el: HTMLElement; anchor: THREE.Vector3 } | null = null
  private cardPos = new THREE.Vector3()
  private health = new Map<string, string>()      // "PMP-01" veya "PMP-01/COMP" -> WARN|ALARM
  private runState = new Map<string, string>()    // "PMP-01" -> RUNNING|FAULT...
  private explodeAmount = new Map<string, number>()
  private focus: string | null = null          // odaklanılan ekipman; gerisi söner
  private focusNode: string | null = null      // odaklanılan BİLEŞEN; kardeşleri de söner
  private flow = new Map<string, number>()     // düğüm adı -> akış hızı (m/s)
  private dirtyFlow = true
  private motion = new Map<string, number>()   // düğüm adı -> strok oranı 0..1
  private dirtyState = true
  private dirtyXform = true

  // Kamera geçişi
  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number } | null = null

  private frames = 0
  private lastStats = 0
  private lastFrame = 0
  private frameAcc = 0

  // Kare hızı yönetimi
  private lastDraw = 0
  private lastActivity = 0
  private idle = false
  private targetFps = FPS_ACTIVE
  private animating = false      // akış/su gibi süregelen animasyon var mı

  constructor(private canvas: HTMLCanvasElement, events: SceneEvents = {}) {
    this.events = events
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,            // VideoCore tile-based: MSAA burada ucuz
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    })
    // Pi 4 dolgu hızı kısıtlı — piksel oranı 1'e sabitlenir, retina'da da öyle
    this.renderer.setPixelRatio(1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(PALETTE.bg, 1)
    this.renderer.info.autoReset = false

    // Düz arka plan — arazi/gökyüzü yok. Renk temizleme rengiyle aynı;
    // ayrı bir arka plan geçişi çizilmiyor.
    this.scene.background = new THREE.Color(PALETTE.bg)
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 600)

    this.onResize()
    window.addEventListener('resize', this.onResize)
    // clientWidth yerleşim tamamlanmadan 0 dönebilir; ResizeObserver güvenilir
    if ('ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver(() => this.onResize())
      this.resizeObs.observe(canvas)
    }
  }

  // ------------------------------------------------------------------ //

  /**
   * `parts` verilirse model tek dosya değil parçalardır: hepsi indirilip
   * uç uca eklenir ve tek GLB olarak çözülür. JACE'e dosyalar istasyon
   * üzerinden yazılıyor ve tek seferde ~1 MB'tan büyük yazma isteği takılıyor;
   * büyük model bu yüzden parça parça yüklenir.
   */
  async load(glbUrl: string, twinMapUrl: string, parts?: string[]): Promise<void> {
    // Aynı sahneye ikinci kez yüklenebilir (istasyon değişimi). Eskisi
    // bırakılmazsa GPU belleği birikir; Pi'de CMA havuzu 2-3 istasyonda
    // doluyor ve ekran donuyordu.
    const token = ++this.loadToken
    this.unload()
    const draco = new DRACOLoader()
    // Yerel çözücü — Pi sahada internetsiz çalışacak, CDN'e bağımlılık olamaz
    // Sayfanın yanındaki draco/ klasörü: kökte (/draco/gltf/) ya da JACE'te
    // /file/twin/draco/gltf/ — ikisi de aynı göreli yoldan bulunur.
    draco.setDecoderPath(new URL('draco/gltf/', document.baseURI).href)
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)

    const loadModel = async () => {
      if (!parts?.length) return loader.loadAsync(glbUrl)
      const bufs = await Promise.all(parts.map((u) => fetch(u).then((r) => {
        if (!r.ok) throw new Error(`model parçası alınamadı: ${u} (${r.status})`)
        return r.arrayBuffer()
      })))
      const all = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0))
      let off = 0
      for (const b of bufs) { all.set(new Uint8Array(b), off); off += b.byteLength }
      return loader.parseAsync(all.buffer, new URL('.', new URL(parts[0], document.baseURI)).href)
    }
    const [gltf, twin] = await Promise.all([
      loadModel(),
      fetch(twinMapUrl).then((r) => r.json() as Promise<TwinMap>),
    ])
    // Draco kendi Web Worker havuzunu açar. Kapatılmazsa her yüklemede yeni
    // bir havuz kalıyor — her worker birkaç MB WASM yığını tutuyor.
    draco.dispose()

    // Hızlı istasyon değişiminde ikinci yükleme birincisini geçebilir.
    // Eskimiş sonucu sahneye ekleme; kaynaklarını da bırak.
    if (token !== this.loadToken || this.disposed) {
      disposeObject(gltf.scene)
      return
    }
    this.twin = twin

    // Su yüzeyi birleştirmeye girmez — seviyeye göre CPU'da yeniden kuruluyor
    const waterMeshes: THREE.Mesh[] = []
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
      if (mat?.name === 'WATER') waterMeshes.push(m)
    })
    let waterColor = new THREE.Color(0x4f7f8c)
    for (const m of waterMeshes) {
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
      if (mat?.color) waterColor = mat.color.clone()
      m.removeFromParent()
    }

    const count = this.countMeshes(gltf.scene)
    this.tex = createComponentTextures(count + 1)

    this.merged = mergeByMaterial(gltf.scene, (_name, color, transparent) =>
      createTwinMaterial(color.getHex(), this.tex, { transparent, opacity: transparent ? 0.6 : 1 }),
    )
    this.scene.add(this.merged.group)

    // mergeByMaterial geometrileri KLONLAYIP birleştiriyor; klonları kendi
    // bırakıyor ama kaynak glTF'in geometrileri elde kalıyor. Birleştirme
    // bittiğine göre artık gerek yok.
    disposeObject(gltf.scene)

    this.water = new WaterSurface(twin.geometry.water, waterColor)
    this.scene.add(this.water.mesh)

    const box = plantBox(this.merged)
    this.controls = createControls(this.camera, this.canvas, box)
    this.resetView(box)

    this.dirtyState = this.dirtyXform = this.dirtyFlow = true
    this.wake()
    this.events.onReady?.(this.merged, twin)
    this.attachPointer()
    this.start()
  }

  /**
   * Modele ait GPU kaynaklarını bırakır; renderer ve tuval ayakta kalır.
   *
   * renderer.dispose() geometri/malzeme/doku BIRAKMAZ — yalnız three.js'in
   * kendi defterini temizler. İstasyon değişiminde buradaki her satır
   * atlanırsa o istasyonun belleği kalıcı olarak sızar.
   */
  unload(): void {
    // Render döngüsünü durdur. apply* metotları this.tex'e koşulsuz yazıyor;
    // model yokken bir kare bile dönerse null referans hatası verir.
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.merged) {
      this.scene.remove(this.merged.group)
      disposeObject(this.merged.group)
      this.merged = undefined
    }
    if (this.water) {
      this.scene.remove(this.water.mesh)
      this.water.dispose()
      this.water = undefined
    }
    if (this.tex) {
      this.tex.state.dispose()
      this.tex.xform.dispose()
      this.tex.flow.dispose()
      this.tex = undefined as unknown as ComponentTextures
    }
    // controls referansı BIRAKILMAZ: render döngüsü ve kamera yardımcıları
    // onu sekiz yerde koşulsuz kullanıyor. dispose() dinleyicileri kaldırır,
    // load() birazdan yenisiyle değiştirir.
    this.controls?.dispose()
    this.twin = undefined
    // Seçim/durum kaydı da eski modele ait — taşınırsa yanlış bileşen boyanır
    this.selected = this.hovered = null
    this.selectedEq = null
    this.card = null
    this.focus = this.focusNode = null
    this.health.clear(); this.runState.clear()
    this.explodeAmount.clear(); this.flow.clear(); this.motion.clear()
  }

  private countMeshes(root: THREE.Object3D): number {
    let n = 0
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
    return n
  }

  private resetView(box: THREE.Box3): void {
    const c = box.getCenter(new THREE.Vector3())
    const r = box.getSize(new THREE.Vector3()).length() / 2
    const d = r / Math.tan((this.camera.fov * Math.PI) / 360) * HOME_FIT
    this.camera.position.copy(c).addScaledVector(HOME_DIR, d)
    this.controls.target.copy(c)
    this.controls.update()
  }

  // ------------------------------------------------------------------ //
  // Seçim ve işaretleme
  // ------------------------------------------------------------------ //

  private attachPointer(): void {
    let downX = 0, downY = 0, downT = 0, active = 0
    let lastTapT = 0, lastTapX = 0, lastTapY = 0

    this.canvas.addEventListener('pointerdown', (e) => {
      this.wake()
      active++
      downX = e.clientX; downY = e.clientY; downT = performance.now()
    })
    this.canvas.addEventListener('pointercancel', () => { active = Math.max(0, active - 1) })

    this.canvas.addEventListener('pointerup', (e) => {
      const multi = active > 1
      active = Math.max(0, active - 1)
      // İki parmak varken seçim yapma — yakınlaştırma/kaydırma jesti bu
      if (multi) return

      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      const held = performance.now() - downT
      // Dokunmatikte parmak biraz kayar; kalem/fareye göre daha geniş tolerans
      const slop = e.pointerType === 'touch' ? TAP_SLOP_TOUCH_PX : TAP_SLOP_PX
      if (moved > slop || held > 700) return

      const info = this.pickAt(e.clientX, e.clientY)
      const now = performance.now()
      const isDouble = now - lastTapT < 320 &&
        Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 28
      lastTapT = now; lastTapX = e.clientX; lastTapY = e.clientY

      // Seçimi uygulama yönetir (setSelectedEquipment / setSelected): boşluğa
      // ya da betona dokunmak açık bilgi kartını kapatmamalı.
      this.events.onPick?.(info)
      // Çift dokunma = çerçevele. Dokunmatikte "yakınlaş" için ayrı butona
      // uzanmak yerine en doğal jest bu.
      if (isDouble) {
        if (info) this.frameNode(info.equipment ?? info.node, info.equipment ? 2.6 : 2.2)
        else this.frameAll()
        this.events.onDoubleTap?.(info)
      }
    })
    // Üzerine gelme vurgusu YALNIZ fare içindir.
    //
    // `matchMedia('(hover: hover)')` dokunmatik Pi'de de true dönüyor (Chromium
    // sistemde fare olabileceğini varsayıyor). Ona güvenince her parmak
    // hareketinde ışın izleme çalışıyordu — 26 bin üçgene karşı, her karede,
    // hiçbir işe yaramadan. Doğru kontrol olayın kendi türüne bakmaktır.
    {
      let pending = 0
      this.canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return
        if (pending) return
        pending = requestAnimationFrame(() => {
          pending = 0
          const info = this.pickAt(e.clientX, e.clientY)
          const id = info ? info.id : null
          if (id !== this.hovered) {
            this.hovered = id
            this.dirtyState = true
            this.wake()
            this.events.onHover?.(info)
          }
        })
      })
    }
  }

  pickAt(clientX: number, clientY: number): ComponentInfo | null {
    if (!this.merged) return null
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.merged.meshes, false)
    for (const h of hits) {
      const geo = (h.object as THREE.Mesh).geometry as THREE.BufferGeometry
      const attr = geo.getAttribute('aCompId')
      if (!attr || !h.face) continue
      const id = Math.round(attr.getX(h.face.a))
      const info = this.merged.components[id]
      if (info) return info
    }
    return null
  }

  setSelected(id: number | null): void {
    if (this.selected === id) return
    this.selected = id
    this.dirtyState = true
    this.wake()
  }

  get selectedId(): number | null { return this.selected }

  /** Bilgi kartı açık ekipman — gövdesi (borular hariç) seçim rengiyle işaretlenir. */
  setSelectedEquipment(eq: string | null): void {
    if (this.selectedEq === eq) return
    this.selectedEq = eq
    this.dirtyState = true
    this.wake()
  }

  /**
   * Bilgi kartını bir ekipmanın üstüne bağlar. Kartın konumu her çizilen
   * karede yazılır: sahne dönerken/yakınlaşırken kart ekipmanla birlikte gider.
   */
  setCard(el: HTMLElement | null, equipment: string | null): void {
    const anchor = el && equipment ? this.anchorOf(equipment) : null
    this.card = el && anchor ? { el, anchor } : null
    this.placeCard()
    this.wake()
  }

  /**
   * Kartın bağlanacağı nokta: ekipmanın gövde parçalarının (borular hariç —
   * uzun hatlar merkezi kaydırır) sınır kutusunun üst-orta noktası.
   */
  private anchorOf(equipment: string): THREE.Vector3 | null {
    const ids = this.merged?.byEquipment.get(equipment) ?? []
    const box = new THREE.Box3()
    const add = (c: ComponentInfo) => {
      box.expandByPoint(c.center.clone().addScalar(-c.radius))
      box.expandByPoint(c.center.clone().addScalar(c.radius))
    }
    for (const id of ids) {
      const c = this.merged!.components[id]
      if (!c.node.includes('__PIPE__')) add(c)
    }
    if (box.isEmpty()) for (const id of ids) add(this.merged!.components[id])
    if (!box.isEmpty()) {
      const p = box.getCenter(new THREE.Vector3())
      p.y = box.max.y + 0.3
      return p
    }
    const cam = this.twin?.equipment[equipment]?.camera
    return cam ? new THREE.Vector3(cam.target[0], cam.target[1] + cam.radius * 0.6, cam.target[2]) : null
  }

  private placeCard(): void {
    const card = this.card
    if (!card) return
    const p = this.cardPos.copy(card.anchor).project(this.camera)
    // Kameranın arkasında ya da ekranın çok dışında: gizle
    if (p.z > 1 || Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.3) {
      card.el.style.visibility = 'hidden'
      return
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    const x = Math.round((p.x * 0.5 + 0.5) * w)
    // Kart üst çubukların arkasına taşmasın: tepesi görünür alanda kalsın
    const y = Math.max(Math.round((-p.y * 0.5 + 0.5) * h), this.insetTop + card.el.offsetHeight + 16)
    card.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
    card.el.style.visibility = 'visible'
  }

  // ------------------------------------------------------------------ //
  // Durum uygulaması
  // ------------------------------------------------------------------ //

  /** health: {"PMP-01": "WARN"}, componentHealth: {"PMP-01/MOTOR__BEARING-DE": "ALARM"} */
  /**
   * Sağlık haritasını günceller. GERÇEKTEN değiştiyse işaretler.
   *
   * Veri 5 Hz akıyor ve bu her akışta çağrılıyor. Koşulsuz "değişti" demek
   * sahnenin boşta moduna hiç geçememesi ve Pi'nin sürekli tam yükte
   * kalması demekti — ısınmanın sebeplerinden biri buydu.
   */
  setHealth(equipment: Record<string, string>, component: Record<string, string>): void {
    const next = new Map<string, string>()
    for (const [k, v] of Object.entries(equipment)) next.set(k, v)
    for (const [k, v] of Object.entries(component)) next.set(k, v)
    if (sameMap(this.health, next)) return
    this.health = next
    this.dirtyState = true
  }

  setRunStates(states: Record<string, string>): void {
    const next = new Map<string, string>()
    for (const [k, v] of Object.entries(states)) next.set(k, v)
    if (sameMap(this.runState, next)) return
    this.runState = next
    this.dirtyState = true
  }

  setWaterLevel(level: number): void { this.water?.setLevel(level) }

  /**
   * Hareketli parçaların konumunu sürer (kapak kanadı gibi).
   *
   * Anahtar düğüm adı, değer 0..1 strok oranı. Eksen ve tam strok modelin
   * glTF extras'ından geliyor — frontend hangi parçanın nasıl hareket
   * ettiğini bilmek zorunda değil.
   */
  setMotion(strokes: Record<string, number>): void {
    let changed = false
    for (const [k, v] of Object.entries(strokes)) {
      if (Math.abs((this.motion.get(k) ?? -1) - v) > 0.002) { this.motion.set(k, v); changed = true }
    }
    if (changed) this.dirtyXform = true
  }

  /**
   * Boru hatlarındaki akışı sürer. Anahtar düğüm adı, değer m/s.
   *
   * Hız gerçek: v = Q/A, kesit alanı modelin glTF extras'ından geliyor.
   * Negatif değer geri akışı (çekvalf çarpması öncesi) gösterir.
   */
  setFlow(velocities: Record<string, number>): void {
    let changed = false
    const seen = new Set<string>()
    for (const [k, v] of Object.entries(velocities)) {
      seen.add(k)
      // 0,05 m/s altındaki oynamalar gözle görülmez; doku yazmaya değmez
      if (Math.abs((this.flow.get(k) ?? -999) - v) > 0.05) { this.flow.set(k, v); changed = true }
    }
    for (const k of [...this.flow.keys()]) if (!seen.has(k)) { this.flow.delete(k); changed = true }
    if (!changed) return
    this.dirtyFlow = true
  }

  private applyFlow(): void {
    if (!this.tex || !this.merged) return
    if (!this.merged) return
    const data = this.tex.flow.image.data as Uint8Array
    this.animating = false
    for (const c of this.merged.components) {
      const v = this.flow.get(c.node) ?? 0
      const i = c.id * 4
      // Hız [-12, +12] m/s aralığına kodlanır (0.5 merkezli)
      data[i] = Math.max(0, Math.min(255, Math.round((v / 24 + 0.5) * 255)))
      // Genlik hızla artar ama doyar — duran boruda hiç bant olmasın
      const amp = c.flowArea == null ? 0 : Math.min(0.26, Math.abs(v) * 0.09)
      if (amp > 0.01) this.animating = true
      data[i + 1] = Math.round(amp * 255)
      data[i + 2] = 0
      data[i + 3] = 255
    }
    this.tex.flow.needsUpdate = true
    this.dirtyFlow = false
  }

  /** Bir ekipmanın bileşenlerini dışa doğru iter — patlatılmış görünüm. */
  setExplode(equipmentId: string, amount: number): void {
    if (amount <= 0.001) this.explodeAmount.delete(equipmentId)
    else this.explodeAmount.set(equipmentId, amount)
    this.dirtyXform = true
    this.wake()
  }

  clearExplode(): void {
    if (this.explodeAmount.size) { this.explodeAmount.clear(); this.dirtyXform = true; this.wake() }
  }

  /**
   * Bir ekipmana odaklan: gerisi söner.
   *
   * Küçük bir bileşene yaklaşınca çevredeki geometri görüşü kapatıyor. Onları
   * gizlemek yerine söndürüyoruz — bağlam kaybolmasın ama göz odaktaki parçaya
   * gitsin. Kullanıcının istediği "büyüyüp orayı tam gösterme" davranışı bu.
   */
  setFocus(equipmentId: string | null, componentNode: string | null = null): void {
    if (this.focus === equipmentId && this.focusNode === componentNode) return
    this.focus = equipmentId
    this.focusNode = componentNode
    this.dirtyXform = true
    this.wake()
  }

  private applyState(): void {
    if (!this.tex || !this.merged) return
    if (!this.merged) return
    const data = this.tex.state.image.data as Uint8Array
    const col = new THREE.Color()

    for (const c of this.merged.components) {
      let color = 0x000000
      let strength = 0

      if (!c.isStatic && c.equipment) {
        const compKey = c.component ? `${c.equipment}/${c.component}` : null
        const compH = compKey ? this.health.get(compKey) : undefined
        const eqH = this.health.get(c.equipment)

        if (compH) {
          // Arıza TAM OLARAK bu parçada: tam güçle boya.
          const o = stateOverlay(compH, undefined)
          color = o.color; strength = o.strength
        } else if (eqH) {
          // Ekipmanda arıza var ama başka parçada. Bu parçayı hafifçe tonla —
          // uzaktan hangi ünitenin etkilendiği görünsün, ama arızalı parça
          // yanında sönük kalsın. ISA-101: göz tek bir yere gitmeli.
          const o = stateOverlay(eqH, undefined)
          color = o.color
          strength = o.strength * 0.18
        } else if (c.component && STATUS_PARTS.has(c.component)) {
          // Çalışma durumu yalnız motor ve pompa gövdesinde: işleýär yeşil,
          // durdy renksiz, näsaz kırmızı. Borular kendi renginde kalır.
          const o = stateOverlay(undefined, this.runState.get(c.equipment))
          color = o.color; strength = o.strength
        }
      }
      // Seçim vurgusu HER ZAMAN AYNI RENK.
      //
      // Önceden alarmlı parça seçilince kırmızı kalıyordu; kullanıcı "seçili olan
      // hangisi" sorusunu renkten okuyamıyordu. Seçim bir DURUM değil, bir
      // ETKİLEŞİM göstergesidir — tek renk olmalı ki her koşulda tanınsın.
      // Alarm bilgisi kaybolmuyor: panelde, çip renginde ve alarm listesinde duruyor,
      // seçim kalkar kalkmaz da kırmızı geri geliyor.
      //
      // Güç bilerek düşük (0.55): daha yükseğinde parça DÜZ tek renge boyanıyor,
      // pişirilmiş gölgeleme siliniyor ve parçanın ne olduğu anlaşılmaz hale
      // geliyor. 0.55'te renk tartışmasız ama şekil hâlâ okunuyor.
      // Kartı açık ekipman: gövde parçaları hafif seçim tonunda (borular
      // hariç — hat boyunca uzanan vurgu hangi ünitenin seçili olduğunu
      // bulandırır). Durum/alarm rengi taşıyan parça (yeşil motor, ısınan
      // motor) kendi renginde KALIR — seçim onu örtmesin.
      if (this.selectedEq && c.equipment === this.selectedEq && strength === 0 && !c.node.includes('__PIPE__')) {
        color = PALETTE.select
        strength = 0.34
      }
      if (this.hovered === c.id) {
        color = PALETTE.hover
        strength = 0.38
      }
      if (this.selected === c.id) {
        color = PALETTE.select
        strength = 0.55
      }

      col.setHex(color)
      const i = c.id * 4
      data[i] = (col.r * 255) | 0
      data[i + 1] = (col.g * 255) | 0
      data[i + 2] = (col.b * 255) | 0
      data[i + 3] = (strength * 255) | 0
    }
    this.tex.state.needsUpdate = true
    this.dirtyState = false
  }

  private applyXform(): void {
    if (!this.tex || !this.merged) return
    if (!this.merged) return
    const data = this.tex.xform.image.data as Uint8Array
    const enc = (v: number) => Math.max(0, Math.min(255, Math.round((v / 40 + 0.5) * 255)))

    // Seçili parça bir kabuğun İÇİNDEyse (sargı motor gövdesinin içinde gibi),
    // sönükleştirmek işe yaramaz — kabuk onu fiziksel olarak kapatır.
    // Kapatan parçayı geometrik olarak bul ve gizle: kardeş parçanın sınır
    // küresi seçili parçanın merkezini içeriyorsa ve ondan büyükse, kabuktur.
    let shell: { center: THREE.Vector3; radius: number } | null = null
    if (this.focusNode) {
      const sid = this.merged.byNode.get(this.focusNode)
      if (sid != null) shell = this.merged.components[sid]
    }

    for (const c of this.merged.components) {
      const i = c.id * 4
      let ox = 0, oy = 0, oz = 0

      // Hareketli parça: strok oranı × tam strok, kendi ekseninde
      if (c.travel) {
        const t = this.motion.get(c.node) ?? 0
        ox += c.travel.axis.x * c.travel.range * t
        oy += c.travel.axis.y * c.travel.range * t
        oz += c.travel.axis.z * c.travel.range * t
      }

      const amt = c.equipment ? this.explodeAmount.get(c.equipment) : undefined
      if (amt && c.component) {
        // Ekipman merkezinden dışa doğru it — parçalar birbirinden ayrılsın
        const ids = this.merged.byEquipment.get(c.equipment!) ?? []
        const center = new THREE.Vector3()
        for (const id of ids) center.add(this.merged.components[id].center)
        center.divideScalar(Math.max(ids.length, 1))
        const dir = c.center.clone().sub(center)
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0)
        dir.normalize().multiplyScalar(amt)
        ox += dir.x; oy += dir.y; oz += dir.z     // patlatma hareketin ÜSTÜNE eklenir
      }
      data[i] = enc(ox); data[i + 1] = enc(oy); data[i + 2] = enc(oz)
      // Alfa = sönüklük. Üç kademe:
      //   seçili parça          -> tam parlak
      //   aynı ünitenin diğer parçaları -> yarı sönük (bağlam korunur)
      //   diğer ekipman/yapı    -> sönük
      // Renk tek başına yetmiyor: parça zaten alarmdaysa seçim rengini üstüne
      // koyamayız (alarmı gizler). Kontrast bu yüzden sönüklükle veriliyor.
      let dim = 1
      if (this.focus) {
        if (c.equipment !== this.focus) dim = 0.28
        else if (this.focusNode && c.node !== this.focusNode) {
          dim = 0.5
          // Gerçek bir kabuk üç koşulu birden sağlar:
          //   1) seçili parçadan büyük ama AŞIRI büyük değil (en fazla 4 katı) —
          //      kaide ve boru hattı gibi kocaman parçalar sınır küresiyle
          //      sargıyı kapsıyor ama önünü kapatmıyor, onları gizlemek bağlamı
          //      gereksiz yere siliyordu
          //   2) merkezi seçili parçanın merkezine yakın (kabuk onu sarar)
          //   3) sınır küresi seçili parçanın merkezini içerir
          if (shell &&
              c.radius > shell.radius && c.radius < shell.radius * 4 &&
              c.center.distanceTo(shell.center) < c.radius * 0.6) {
            dim = 0     // bu parça seçili olanı kapatıyor — gizle
          }
        }
      }
      data[i + 3] = Math.round(dim * 255)
    }
    this.tex.xform.needsUpdate = true
    this.dirtyXform = false
  }

  // ------------------------------------------------------------------ //
  // Kamera çerçeveleme
  // ------------------------------------------------------------------ //

  frameNode(node: string, margin = 2.4, duration = 620): void {
    const eqFrames = this.twin?.equipment
    let frame: { target: [number, number, number]; radius: number } | undefined
    if (eqFrames) {
      for (const eq of Object.values(eqFrames)) {
        if (eq.node === node && eq.camera) { frame = eq.camera; break }
        for (const c of Object.values(eq.components)) {
          if (c.node === node && c.camera) { frame = c.camera; break }
        }
        if (frame) break
      }
    }
    if (!frame) {
      const id = this.merged?.byNode.get(node)
      if (id == null) return
      const c = this.merged!.components[id]
      frame = { target: [c.center.x, c.center.y, c.center.z], radius: c.radius }
    }
    const target = new THREE.Vector3(...frame.target)
    // Küçük bir bileşeni "doğru" mesafeden çerçevelemek kamerayı pompa
    // gövdesinin İÇİNE sokuyor. Alt sınır koy — parça küçükse geri çekil.
    const ideal = (frame.radius * margin) / Math.tan((this.camera.fov * Math.PI) / 360)
    const dist = Math.max(ideal, 3.4)
    // Mevcut bakış yönünü koru — kamera "zıplamasın", sadece yaklaşsın
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.tween = {
      from: this.camera.position.clone(), to: target.clone().add(dir.multiplyScalar(dist)),
      fromT: this.controls.target.clone(), toT: target, t: 0, dur: duration,
    }
  }

  frameAll(): void {
    if (!this.merged) return
    const box = plantBox(this.merged)
    const c = box.getCenter(new THREE.Vector3())
    const r = box.getSize(new THREE.Vector3()).length() / 2
    const d = (r / Math.tan((this.camera.fov * Math.PI) / 360)) * HOME_FIT
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    if (dir.y < 0.25) dir.copy(HOME_DIR)
    this.tween = {
      from: this.camera.position.clone(), to: c.clone().add(dir.multiplyScalar(d)),
      fromT: this.controls.target.clone(), toT: c, t: 0, dur: 700,
    }
  }

  /**
   * KULLANICI etkileşimi oldu — tam hıza dön.
   *
   * Veri değişimleri bunu ÇAĞIRMAZ. Bir tag değiştiğinde tek bir yeniden çizim
   * yeterlidir; 30 fps'e çıkmak gerekmez. Akış hızları sürekli oynadığı için
   * veri değişimini de "etkileşim" saymak sahneyi hiç yavaşlatmıyordu.
   */
  private wake(): void {
    this.lastActivity = performance.now()
    if (this.targetFps !== FPS_ACTIVE) { this.idle = false; this.targetFps = FPS_ACTIVE }
  }

  private stepTween(dt: number): void {
    if (!this.tween) return
    const tw = this.tween
    tw.t = Math.min(1, tw.t + dt / tw.dur)
    const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2   // easeInOutCubic
    this.camera.position.lerpVectors(tw.from, tw.to, e)
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e)
    if (tw.t >= 1) this.tween = null
  }

  // ------------------------------------------------------------------ //

  private resizeObs?: ResizeObserver

  private insetLeft = 0
  private insetTop = 0

  /**
   * Tuvalin solunda paneller (menü + HUD + duýduryşlar), üstünde başlık
   * çubukları duruyorsa görüş merkezini kalan alanın ortasına kaydırır.
   * Kamera değil izdüşüm kayar: seçim ışını ve kart konumu aynı matristen
   * hesaplandığı için tutarlı kalır. Bilgi kartı da üst çubuğun altına itilir.
   */
  setViewInset(leftPx: number, topPx = this.insetTop): void {
    const v = Math.max(0, Math.round(leftPx)), t = Math.max(0, Math.round(topPx))
    if (v === this.insetLeft && t === this.insetTop) return
    this.insetLeft = v; this.insetTop = t
    this.onResize()
    this.wake()
  }

  private onResize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth || 1280
    const h = this.canvas.clientHeight || window.innerHeight || 720
    if (w < 2 || h < 2) return                    // yerleşim henüz yok, atla
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    if (this.insetLeft > 0 || this.insetTop > 0) this.camera.setViewOffset(w, h, -this.insetLeft / 2, -this.insetTop / 2, w, h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
    this.placeCard()
  }

  /**
   * 3D görünüm ekranda değilken render döngüsünü tamamen durdurur.
   * 2D şema açıkken Pi'nin GPU'su boşuna ısınmasın; durum/akış kayıtları
   * işlemeye devam eder, geri dönünce tek karede güncellenir.
   */
  setPaused(p: boolean): void {
    if (this.paused === p) return
    this.paused = p
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (!p && this.merged) {
      this.onResize()
      this.wake()
      this.start()
    }
  }

  private start(): void {
    if (this.paused || this.raf) return
    this.lastFrame = performance.now()
    this.lastStats = this.lastFrame
    const loop = (now: number) => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)

      // Üç kademe. Akış animasyonu tek başına 30 fps'i hak etmiyor: bantlar
      // 12 fps'te de akıcı görünüyor ve GPU yükü %60 düşüyor. Pompalar hep
      // çalıştığı için akış hep var; buna tam hız vermek Pi'yi 7/24 tam yükte
      // tutuyordu — ısınmanın sebeplerinden biri buydu.
      if (!this.tween && now - this.lastActivity > IDLE_AFTER_MS) {
        const want = this.animating ? FPS_ANIMATING : FPS_IDLE
        if (this.targetFps !== want) { this.targetFps = want; this.idle = true }
      }
      // Hedef kare hızına göre atla — rAF 60 Hz gelse de biz daha az çiziyoruz
      const minGap = 1000 / this.targetFps - 1.5
      if (now - this.lastDraw < minGap) return
      const dt = now - this.lastFrame
      this.lastFrame = now
      this.lastDraw = now

      this.stepTween(dt)
      const moved = this.controls.update()
      if (moved) this.wake()
      if (this.dirtyState) this.applyState()
      if (this.dirtyXform) this.applyXform()
      if (this.dirtyFlow) this.applyFlow()
      // Akış bandı hareket ediyorsa boşta moduna düşme; ama düşük hızda da
      // akmaya devam etsin diye zamanı gerçek geçen süreye göre ilerlet.
      if (this.animating) this.tex.time.value += Math.min(dt, 200) / 1000

      this.renderer.info.reset()
      this.renderer.render(this.scene, this.camera)
      this.placeCard()

      this.frames++
      this.frameAcc += Math.min(dt, 200)
      if (now - this.lastStats >= 500) {
        const info = this.renderer.info
        this.events.onStats?.({
          fps: Math.round((this.frames * 1000) / (now - this.lastStats)),
          frameMs: +(this.frameAcc / Math.max(this.frames, 1)).toFixed(2),
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          programs: info.programs?.length ?? 0,
          targetFps: this.targetFps,
          idle: this.idle,
        })
        this.frames = 0; this.frameAcc = 0; this.lastStats = now
      }
    }
    this.raf = requestAnimationFrame(loop)
  }

  /**
   * Gerçek render maliyetini ölçer.
   *
   * requestAnimationFrame tarayıcı tarafından kısıtlanabilir (arka plan sekmesi,
   * güç tasarrufu, gömülü görüntüleyici). Bu yüzden FPS göstergesi ölçüm aracı
   * değildir. Burada sıkı bir döngüde N kare çizilir ve `gl.finish()` ile GPU'nun
   * gerçekten bitirmesi beklenir — Pi 4'te anlamlı olan sayı budur.
   */
  async benchmark(opts: { frames?: number; width?: number; height?: number; orbit?: boolean } = {}): Promise<{
    avgMs: number; p95Ms: number; fps: number; drawCalls: number
    triangles: number; resolution: string; frames: number
  }> {
    const frames = opts.frames ?? 300
    const orbit = opts.orbit ?? true
    // Pi 4 hedefi 1280x720. Ölçümü pencere boyutundan bağımsız yap ki
    // masaüstü ile Pi sonuçları doğrudan karşılaştırılabilsin.
    const W = opts.width ?? 1280
    const H = opts.height ?? 720
    // Doğrudan canvas'a çizmek yerine kendi render hedefimize çiziyoruz.
    // Sebep: pencere gizli/kompoze edilmiyorsa tarayıcı çizim tamponunu 1x1'e
    // kırpar ve ölçüm sahte çıkar. Render hedefi yerleşimden bağımsızdır —
    // gerçekten W×H piksel rasterleştirilir.
    const rt = new THREE.WebGLRenderTarget(W, H, {
      samples: 4,                                  // MSAA — Pi'de de açık olacak
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    })
    const prevAspect = this.camera.aspect
    this.camera.aspect = W / H
    this.camera.updateProjectionMatrix()
    this.renderer.setRenderTarget(rt)
    const target = this.controls.target.clone()
    const start = this.camera.position.clone()
    const radius = start.distanceTo(target)
    const baseAngle = Math.atan2(start.z - target.z, start.x - target.x)
    const height = start.y - target.y

    // gl.finish() ANGLE/Metal üzerinde gerçekten senkronize ETMİYOR (ölçüldü:
    // çözünürlük artınca süre düşüyordu — imkânsız). Tek güvenilir yol tek
    // pikseli geri okumak: readPixels tüm boru hattının bitmesini zorlar.
    const px = new Uint8Array(4)
    const sync = () => this.renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px)

    const place = (i: number, n: number) => {
      if (!orbit) return
      const a = baseAngle + (i / n) * Math.PI * 2
      const rr = Math.sqrt(Math.max(radius * radius - height * height, 1))
      this.camera.position.set(target.x + Math.cos(a) * rr, target.y + height,
                               target.z + Math.sin(a) * rr)
      this.camera.lookAt(target)
    }

    for (let i = 0; i < 20; i++) { place(i, 20); this.renderer.render(this.scene, this.camera) }
    sync()

    // 1) Verim ölçümü: N kare çiz, sonunda bir kez senkronize et
    this.renderer.info.reset()
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) {
      place(i, frames)
      this.renderer.render(this.scene, this.camera)
    }
    sync()
    const total = performance.now() - t0
    const calls = this.renderer.info.render.calls / frames
    const tris = this.renderer.info.render.triangles / frames

    // 2) Kare başına dağılım: her karede senkronize et (yavaş ama p95 verir)
    const samples: number[] = []
    const nSamples = Math.min(60, frames)
    for (let i = 0; i < nSamples; i++) {
      place(i, nSamples)
      const s0 = performance.now()
      this.renderer.render(this.scene, this.camera)
      sync()
      samples.push(performance.now() - s0)
    }
    samples.sort((a, b) => a - b)

    this.renderer.setRenderTarget(null)
    rt.dispose()
    this.camera.aspect = prevAspect
    this.camera.updateProjectionMatrix()
    this.controls.update()

    return {
      avgMs: +(total / frames).toFixed(3),
      p95Ms: +samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))].toFixed(3),
      fps: Math.round(1000 / (total / frames)),
      drawCalls: Math.round(calls),
      triangles: Math.round(tris),
      resolution: `${W}x${H}`,
      frames,
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.resizeObs?.disconnect()
    this.unload()
    this.renderer.dispose()
  }

  get info() { return { merged: this.merged, twin: this.twin, frameBudgetMs: FRAME_MS } }
}
