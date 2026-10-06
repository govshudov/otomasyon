import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Kısıtlanmış yörünge kontrolü.
 *
 * Dokunmatik bir HMI'da kullanıcı sahneyi KAYBEDEMEMELİ. Bu yüzden:
 *  - kamera ufkun altına inemez (yapının içine düşme yok)
 *  - hedef nokta tesisin etrafındaki kutunun dışına çıkamaz
 *  - yakınlaşma/uzaklaşma sınırlı
 *  - sönümleme açık (parmak kalkınca yumuşak duruş)
 */
export function createControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  bounds: THREE.Box3,
): OrbitControls {
  const c = new OrbitControls(camera, dom)
  const size = bounds.getSize(new THREE.Vector3())
  const radius = size.length() / 2

  c.enableDamping = true
  c.dampingFactor = 0.085
  c.rotateSpeed = 0.55
  c.zoomSpeed = 0.85
  c.panSpeed = 0.7
  c.screenSpacePanning = false
  c.minPolarAngle = 0.12
  c.maxPolarAngle = Math.PI / 2 - 0.06        // ufkun altına inme
  c.minDistance = 2.5
  c.maxDistance = radius * 3.2
  c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
  c.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  }

  // Hedefi tesisin etrafındaki kutuda tut
  const limit = bounds.clone().expandByScalar(radius * 0.25)
  const clamp = () => {
    c.target.clamp(limit.min, limit.max)
  }
  c.addEventListener('change', clamp)
  return c
}
