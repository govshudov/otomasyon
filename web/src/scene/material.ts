import * as THREE from 'three'

/**
 * Bileşen kimliğine göre boyanabilen ve hareket ettirilebilen malzeme.
 *
 * Sorun: Pi 4'te 153 ayrı nesne çizmek pahalı. Ama her bileşeni tek tek
 * kırmızıya boyayabilmek de şart.
 *
 * Çözüm: tüm geometri malzemeye göre TEK mesh'te birleştirilir; her köşe
 * `aCompId` özniteliğinde ait olduğu bileşenin numarasını taşır. İki küçük
 * veri dokusu bileşen başına durum ve dönüşüm tutar:
 *
 *   uStateTex : rgb = kaplama rengi, a = kaplama gücü (0 = dokunma)
 *   uXformTex : rgb = patlatma ofseti, a < 0.5 ise bileşen gizlenir
 *
 * Sonuç: 6 draw call, ama 153 bileşen bağımsız boyanabilir, patlatılabilir
 * ve gizlenebilir. Durum değişince sadece doku güncellenir — geometri değil.
 */

const VERT_HEAD = /* glsl */ `
  attribute float aCompId;
  attribute float aFlowU;
  uniform sampler2D uStateTex;
  uniform sampler2D uXformTex;
  uniform sampler2D uFlowTex;
  uniform vec2 uTexSize;
  varying vec4 vState;
  varying float vDim;
  varying float vFlowU;
  varying vec2 vFlow;          // x = hız (m/s), y = genlik

  vec2 compUV(float id) {
    float x = mod(id, uTexSize.x);
    float y = floor(id / uTexSize.x);
    return (vec2(x, y) + 0.5) / uTexSize;
  }
`

const VERT_BODY = /* glsl */ `
  vec2 cuv = compUV(aCompId);
  vec4 xf = texture2D(uXformTex, cuv);
  vState = texture2D(uStateTex, cuv);
  vDim = xf.w;
  vec4 fl = texture2D(uFlowTex, cuv);
  vFlow = vec2((fl.x - 0.5) * 24.0, fl.y);   // hız [-12, +12] m/s, geri akış negatif
  vFlowU = aFlowU;
  transformed += (xf.xyz - 0.5) * 40.0;              // patlatma ofseti [-20, +20] m
  if (xf.w < 0.02) transformed = vec3(0.0);          // gizle: sıfır alanlı üçgen
`

const FRAG_HEAD = /* glsl */ `
  varying vec4 vState;
  varying float vDim;
  varying float vFlowU;
  varying vec2 vFlow;
  uniform float uTime;
`

const FRAG_BODY = /* glsl */ `
  diffuseColor.rgb = mix(diffuseColor.rgb, vState.rgb, vState.a);
  // Akış: boru ekseni boyunca yürüyen bant. Dalga boyu 2.2 m — gerçek bir
  // borudaki akışı okunur kılan ölçek. Genlik sıfırsa hesap etkisiz.
  if (vFlow.y > 0.002) {
    float band = sin((vFlowU - uTime * vFlow.x) * 2.856);   // 2*pi/2.2
    diffuseColor.rgb *= 1.0 + vFlow.y * band;
  }
  diffuseColor.rgb *= vDim;                          // odak dışı geometriyi söndür
`

export interface ComponentTextures {
  state: THREE.DataTexture
  xform: THREE.DataTexture
  flow: THREE.DataTexture
  size: THREE.Vector2
  count: number
  time: { value: number }
}

export function createComponentTextures(count: number): ComponentTextures {
  const w = Math.min(256, Math.max(1, count))
  const h = Math.ceil(count / w)
  const n = w * h

  const stateData = new Uint8Array(new ArrayBuffer(n * 4))   // hepsi 0 = kaplama yok
  const xformData = new Uint8Array(new ArrayBuffer(n * 4))
  const flowData = new Uint8Array(new ArrayBuffer(n * 4))    // hız 0, genlik 0
  for (let i = 0; i < n; i++) {
    xformData[i * 4 + 0] = 128                     // ofset 0 (0.5 merkezli)
    xformData[i * 4 + 1] = 128
    xformData[i * 4 + 2] = 128
    xformData[i * 4 + 3] = 255                     // görünür
  }

  const mk = (data: Uint8Array<ArrayBuffer>) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
    t.minFilter = THREE.NearestFilter                // mipmap YOK — vertex shader'da
    t.magFilter = THREE.NearestFilter                // örnekleme ancak böyle doğru
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }

  for (let i = 0; i < n; i++) flowData[i * 4] = 128          // hız = 0 (0.5 merkezli)
  return {
    state: mk(stateData), xform: mk(xformData), flow: mk(flowData),
    size: new THREE.Vector2(w, h), count, time: { value: 0 },
  }
}

export function createTwinMaterial(
  baseColor: number,
  tex: ComponentTextures,
  opts: { transparent?: boolean; opacity?: number } = {},
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: baseColor,
    vertexColors: true,                              // pişirilmiş AO burada çarpılır
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: !(opts.transparent ?? false),
    side: THREE.FrontSide,
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStateTex = { value: tex.state }
    shader.uniforms.uXformTex = { value: tex.xform }
    shader.uniforms.uFlowTex = { value: tex.flow }
    shader.uniforms.uTexSize = { value: tex.size }
    shader.uniforms.uTime = tex.time              // paylaşılan referans, her karede güncellenir

    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + VERT_BODY,
    )
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' + FRAG_BODY,
    )
  }
  // Shader varyantı önbelleğe alınırken bu malzeme ayrı derlensin
  mat.customProgramCacheKey = () => `twin-${baseColor}-${opts.transparent ? 't' : 'o'}`
  return mat
}
