import * as THREE from 'three'
import { FACE_ORDER, HERO_PALETTE, matte, pipTexture } from './heroTextures'

/**
 * 히어로 장면의 **무대 만들기** — 렌더러·카메라·조명·바닥·주사위 재질.
 *
 * `heroScene.ts`에서 갈라 둔 이유: 이 값들은 랜딩의 톤(필름 노출·3점 조명·매트 재질)을
 * 한 곳에서 조정하기 위한 것이고, 장면 수명(루프·리사이즈·정리)과 섞이면 톤을 바꿀 때
 * 수명 코드를 지나쳐야 한다.
 */

/** 톤 매핑 노출. 어두운 카드와 밝은 카드 양쪽 실측으로 잡은 값이다. */
const TONE_EXPOSURE = 1.12

export interface HeroStageParts {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly stage: THREE.Group
  readonly diceMaterials: THREE.MeshStandardMaterial[]
  readonly accentDiceMaterials: THREE.MeshStandardMaterial[]
}

export const createHeroStage = (container: HTMLElement): HeroStageParts => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 200)
  const stage = new THREE.Group()
  const portrait = window.innerHeight > window.innerWidth

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !portrait })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  /* 하이라이트를 굴려 접는 필름 톤 — 매트 재질에서도 밝은 면이 종이처럼 하얗게
     타지 않게 한다. 노출은 어두운 카드(다크)와 밝은 카드(라이트) 양쪽 실측으로 잡았다. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = TONE_EXPOSURE
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  container.appendChild(canvas)

  camera.position.set(0, 0.4, 9)
  addLights(scene)
  addFloor(scene)
  scene.add(stage)

  /* 두 벌이 텍스처를 공유한다 — accent 벌은 같은 맵에 color 틴트만 곱해
     레드 바디·검은 눈이 된다(야추의 "킵 = 레드" 문법을 히어로에 재현). */
  const faceTextures = FACE_ORDER.map(pipTexture)
  const diceMaterials = faceTextures.map((map) => matte(0xffffff, { map, roughness: 0.42 }))
  const accentDiceMaterials = faceTextures.map((map) =>
    matte(HERO_PALETTE.accent, { map, roughness: 0.42 }),
  )

  return { renderer, scene, camera, stage, diceMaterials, accentDiceMaterials }
}

/**
 * 3점 조명 — 은은한 하늘빛(hemisphere) 위에 따뜻한 키, 차가운 필, 뒤에서 실루엣을
 * 따는 림. 림이 없으면 다크 카드에서 오브젝트의 어두운 면이 배경에 통째로 묻힌다.
 */
const addLights = (scene: THREE.Scene): void => {
  scene.add(new THREE.HemisphereLight(0xe6e5e1, 0x17181b, 1.35))
  const key = new THREE.DirectionalLight(0xfff2e0, 1.1)
  key.position.set(3.5, 5.5, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 30
  key.shadow.bias = -0.0004
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcc4d4, 0.35)
  fill.position.set(-6, -2, -4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 0.6)
  rim.position.set(-4, 4, -7)
  scene.add(rim)
}

/** 바닥 그림자만 받는 판 — 오브젝트를 띄워 보이게 하는 유일한 접지 단서다. */
const addFloor = (scene: THREE.Scene): void => {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.16 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -3.1
  floor.receiveShadow = true
  scene.add(floor)
}
