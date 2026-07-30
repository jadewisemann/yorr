import * as THREE from 'three'

export type DiceStage = ReturnType<typeof createStage>

export function createStage(container: HTMLElement) {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-4.5, 4.5, 3, -3, 0.1, 30)
  camera.position.set(0, 10, 0.001)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.className = 'h-full w-full touch-manipulation'
  container.appendChild(renderer.domElement)

  const ambient = new THREE.HemisphereLight(0xffffff, 0x1a1b1e, 1.65)
  scene.add(ambient)
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.4)
  keyLight.position.set(-4, 8, -3)
  keyLight.shadow.camera.left = -6
  keyLight.shadow.camera.right = 6
  keyLight.shadow.camera.top = 5
  keyLight.shadow.camera.bottom = -5
  scene.add(keyLight)

  return { ambient, camera, keyLight, renderer, scene }
}
