import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { GameKey } from '@/games'
import { buildDavinci, buildFishing, buildPingpong, materialsOf } from './heroObjects'
import { FACE_ORDER, HERO_PALETTE, matte, pipTexture, type SpinBob } from './heroTextures'

export type { GameKey }

const MIN_FRAME_S = 1 / 30

const SLATE = 0x24252a

export interface HeroSceneOptions {
  container: HTMLElement
  game: GameKey
  reducedMotion?: boolean
}

export class HeroScene {
  private readonly container: HTMLElement
  private readonly reducedMotion: boolean
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(20, 1, 0.1, 200)
  private readonly stage = new THREE.Group()
  private readonly clock = new THREE.Clock()
  private readonly diceMaterials: THREE.MeshStandardMaterial[]
  private readonly accentDiceMaterials: THREE.MeshStandardMaterial[]
  private readonly resizeObserver: ResizeObserver

  private object: THREE.Group | null = null
  private entrance = 0
  private parallaxX = 0
  private parallaxY = 0
  private targetX = 0
  private targetY = 0
  private destroyed = false
  private paused = false
  private sinceRender = 0
  private readonly dieGeometries = new Map<number, RoundedBoxGeometry>()

  constructor({ container, game, reducedMotion }: HeroSceneOptions) {
    this.container = container
    this.reducedMotion =
      reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const portrait = window.innerHeight > window.innerWidth
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !portrait })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    /* 하이라이트를 굴려 접는 필름 톤 — 매트 재질에서도 밝은 면이 종이처럼 하얗게
       타지 않게 한다. 노출은 어두운 카드(다크)와 밝은 카드(라이트) 양쪽 실측으로 잡았다. */
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    const canvas = this.renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    container.appendChild(canvas)

    this.camera.position.set(0, 0.4, 9)

    /* 3점 조명 — 은은한 하늘빛(hemisphere) 위에 따뜻한 키, 차가운 필, 뒤에서 실루엣을
       따는 림. 림이 없으면 다크 카드에서 오브젝트의 어두운 면이 배경에 통째로 묻힌다. */
    this.scene.add(new THREE.HemisphereLight(0xe6e5e1, 0x17181b, 1.35))
    const key = new THREE.DirectionalLight(0xfff2e0, 1.1)
    key.position.set(3.5, 5.5, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 30
    key.shadow.bias = -0.0004
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcc4d4, 0.35)
    fill.position.set(-6, -2, -4)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.6)
    rim.position.set(-4, 4, -7)
    this.scene.add(rim)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.16 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -3.1
    floor.receiveShadow = true
    this.scene.add(floor)
    this.scene.add(this.stage)

    /* 두 벌이 텍스처를 공유한다 — accent 벌은 같은 맵에 color 틴트만 곱해
       레드 바디·검은 눈이 된다(야추의 "킵 = 레드" 문법을 히어로에 재현). */
    const faceTextures = FACE_ORDER.map(pipTexture)
    this.diceMaterials = faceTextures.map((map) => matte(0xffffff, { map, roughness: 0.42 }))
    this.accentDiceMaterials = faceTextures.map((map) =>
      matte(HERO_PALETTE.accent, { map, roughness: 0.42 }),
    )

    this.setGame(game)

    if (!this.reducedMotion) {
      window.addEventListener('pointermove', this.handlePointerMove, { passive: true })
    }
    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(container)
    this.handleResize()

    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.startLoop()
  }

  setPaused(paused: boolean) {
    if (this.destroyed || this.reducedMotion || this.paused === paused) return
    this.paused = paused
    this.syncLoop()
  }

  setGame(game: GameKey) {
    if (this.destroyed) return
    this.disposeStageObject()
    this.object = this.build(game)
    this.object.scale.setScalar(0.001)
    this.stage.add(this.object)
    this.entrance = this.reducedMotion ? 1 : 0
    if (this.reducedMotion) {
      this.applyEntrance()
      this.renderFrame()
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    window.removeEventListener('pointermove', this.handlePointerMove)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)

    this.disposeStageObject()
    for (const geometry of this.dieGeometries.values()) geometry.dispose()
    this.dieGeometries.clear()
    for (const material of this.diceMaterials) {
      material.map?.dispose()
      material.dispose()
    }
    // accent 벌의 맵은 위와 같은 텍스처라 재질만 놓는다.
    for (const material of this.accentDiceMaterials) material.dispose()
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      for (const material of materialsOf(node)) material.dispose()
    })
    this.renderer.domElement.remove()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private startLoop() {
    if (this.reducedMotion) {
      this.renderFrame()
      return
    }
    this.renderer.setAnimationLoop(this.tick)
  }

  private readonly handleVisibilityChange = () => {
    if (this.reducedMotion) return
    this.syncLoop()
  }

  private syncLoop() {
    if (this.paused || document.hidden) {
      this.renderer.setAnimationLoop(null)
      return
    }
    this.clock.getDelta()
    this.sinceRender = 0
    this.renderer.setAnimationLoop(this.tick)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.targetX = (event.clientX / window.innerWidth - 0.5) * 0.5
    this.targetY = (event.clientY / window.innerHeight - 0.5) * 0.3
  }

  private readonly handleResize = () => {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    const portrait = height > width
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, portrait ? 1.5 : 2))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.position.z = portrait ? 30 : 22
    this.camera.updateProjectionMatrix()
    this.stage.position.set(portrait ? 0 : 0.9, portrait ? 1.9 : 1.5, 0)
    this.stage.scale.setScalar(portrait ? 0.82 : 1)
    if (this.reducedMotion) this.renderFrame()
  }

  private readonly tick = () => {
    this.sinceRender += this.clock.getDelta()
    if (this.sinceRender < MIN_FRAME_S) return
    const delta = Math.min(this.sinceRender, 0.05)
    this.sinceRender = 0
    const elapsed = this.clock.elapsedTime
    const object = this.object
    if (object) {
      this.entrance = Math.min(1, this.entrance + delta * 2.4)
      this.applyEntrance()
      object.rotation.y = Math.sin(elapsed * 0.2) * 0.2
      object.children.forEach((child, index) => {
        const { bob, spin } = child.userData as SpinBob
        if (spin) {
          child.rotation.x += delta * spin * 0.5
          child.rotation.y += delta * spin
        }
        if (bob) child.position.y += Math.sin(elapsed * 1.4 + index) * delta * bob * 0.6
      })
    }
    this.parallaxX += (this.targetX * 0.5 - this.parallaxX) * 0.05
    this.parallaxY += (this.targetY * 0.5 - this.parallaxY) * 0.05
    this.stage.rotation.y = this.parallaxX
    this.stage.rotation.x = this.parallaxY
    this.renderFrame()
  }

  private applyEntrance() {
    if (!this.object) return
    const eased = 1 - (1 - this.entrance) ** 3
    this.object.scale.setScalar(0.6 + 0.4 * eased)
    this.object.position.y = (1 - eased) * -1.2
  }

  private renderFrame() {
    this.renderer.render(this.scene, this.camera)
  }

  private disposeStageObject() {
    const object = this.object
    if (!object) return
    this.stage.remove(object)
    const shared = new Set<THREE.BufferGeometry>(this.dieGeometries.values())
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      if (!shared.has(node.geometry)) node.geometry.dispose()
      for (const material of materialsOf(node)) {
        const owned = material as THREE.MeshStandardMaterial
        if (!this.diceMaterials.includes(owned) && !this.accentDiceMaterials.includes(owned)) {
          material.dispose()
        }
      }
    })
    this.object = null
  }

  private die(size: number, tone: 'ivory' | 'accent' = 'ivory') {
    let geometry = this.dieGeometries.get(size)
    if (!geometry) {
      // 모서리 반경 8% — 실물 주사위의 라운드. 각진 Box는 콘크리트 블록으로 읽혔다.
      geometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.08)
      this.dieGeometries.set(size, geometry)
    }
    const mesh = new THREE.Mesh(
      geometry,
      tone === 'accent' ? this.accentDiceMaterials : this.diceMaterials,
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
    return mesh
  }

  private build(game: GameKey): THREE.Group {
    switch (game) {
      case 'liars':
        return this.buildLiars()
      case 'duel':
        return this.buildDuel()
      case 'pingpong':
        return buildPingpong()
      case 'fishing':
        return buildFishing()
      case 'davinci':
        return buildDavinci()
      default:
        return this.buildYacht()
    }
  }

  private buildYacht() {
    const group = new THREE.Group()
    const spots: [number, number, number][] = [
      [-2.1, 0.3, 0.4],
      [-0.7, -0.5, -0.6],
      [0.6, 0.55, 0.2],
      [1.9, -0.35, -0.3],
      [0.1, -1.35, 0.8],
    ]
    spots.forEach(([x, y, z], index) => {
      // 가운데 큰 주사위 하나만 레드 — 야추의 "킵한 주사위 = 레드" 문법이자 화면의 브랜드 점.
      const mesh = this.die(index === 2 ? 1.5 : 1.2, index === 2 ? 'accent' : 'ivory')
      mesh.position.set(x, y, z)
      mesh.userData = { spin: 0.12 + index * 0.05 } satisfies SpinBob
      group.add(mesh)
    })
    return group
  }

  private buildLiars() {
    const group = new THREE.Group()
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 0.85, 2.1, 48, 1, true),
      matte(SLATE, { side: THREE.DoubleSide }),
    )
    cup.position.set(1.5, 0.1, 0)
    cup.rotation.z = -0.28
    group.add(cup)
    const dice: [number, number, number, number][] = [
      [-1.6, -0.5, 0.3, 1.2],
      [-0.4, 0.4, -0.4, 1.05],
      [-1.1, 0.9, 0.6, 0.85],
    ]
    dice.forEach(([x, y, z, size], index) => {
      const mesh = this.die(size)
      mesh.position.set(x, y, z)
      mesh.userData = { spin: 0.1 + index * 0.06 } satisfies SpinBob
      group.add(mesh)
    })
    return group
  }

  private buildDuel() {
    const group = new THREE.Group()
    const drum = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.72, 48), matte(SLATE))
    body.castShadow = true
    body.receiveShadow = true
    drum.add(body)
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2
      const chamber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.78, 24),
        matte(0x0d0e10),
      )
      chamber.position.set(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72)
      drum.add(chamber)
      if (index < 2) {
        const round = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.84, 20),
          matte(HERO_PALETTE.accent),
        )
        round.position.copy(chamber.position)
        drum.add(round)
      }
    }
    drum.rotation.set(Math.PI / 2.35, 0, 0.2)
    drum.position.set(0.5, 0.15, 0)
    drum.userData = { spin: 0.42 } satisfies SpinBob
    group.add(drum)

    const cartridge = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.5, 8, 20),
      matte(HERO_PALETTE.accent),
    )
    cartridge.position.set(-1.9, -0.5, 0.6)
    cartridge.rotation.z = 1.1
    cartridge.castShadow = true
    cartridge.userData = { bob: 0.9 } satisfies SpinBob
    group.add(cartridge)
    return group
  }
}
