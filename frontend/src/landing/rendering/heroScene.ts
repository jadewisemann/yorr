import * as THREE from 'three'
import type { GameKey } from '@/games'
import { dsColorReader } from '@/styles/tokenFallbacks'

export type { GameKey }

const MIN_FRAME_S = 1 / 30

const IVORY = 0xf4f1e8
const INK = 0x0b0b0c
const ACCENT = 0xe53935
const SLATE = 0x24252a

type PipCount = 1 | 2 | 3 | 4 | 5 | 6

const PIP_LAYOUT: Record<PipCount, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.29, 0.29],
    [0.71, 0.29],
    [0.29, 0.71],
    [0.71, 0.71],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.29, 0.24],
    [0.71, 0.24],
    [0.29, 0.5],
    [0.71, 0.5],
    [0.29, 0.76],
    [0.71, 0.76],
  ],
}

const FACE_ORDER: PipCount[] = [1, 6, 2, 5, 3, 4]

interface SpinBob {
  bob?: number
  spin?: number
}

function pipTexture(pips: PipCount) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('주사위 텍스처를 그릴 수 없습니다.')
  const color = dsColorReader()
  context.fillStyle = color('--ds-color-physics-die')
  context.fillRect(0, 0, size, size)
  context.fillStyle = color('--ds-color-physics-pip')
  for (const [x, y] of PIP_LAYOUT[pips]) {
    context.beginPath()
    context.arc(x * size, y * size, size * 0.075, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function lambert(color: number, options: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, ...options })
}

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
  private readonly diceMaterials: THREE.MeshLambertMaterial[]
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
  private readonly dieGeometries = new Map<number, THREE.BoxGeometry>()

  constructor({ container, game, reducedMotion }: HeroSceneOptions) {
    this.container = container
    this.reducedMotion =
      reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const portrait = window.innerHeight > window.innerWidth
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !portrait })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    const canvas = this.renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    container.appendChild(canvas)

    this.camera.position.set(0, 0.4, 9)

    this.scene.add(new THREE.HemisphereLight(0xd9d9dd, 0x141517, 1.55))
    const key = new THREE.DirectionalLight(0xf5f5f2, 0.5)
    key.position.set(3.5, 5.5, 5)
    key.castShadow = true
    key.shadow.mapSize.set(512, 512)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 30
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xb9babf, 0.18)
    fill.position.set(-6, -2, -4)
    this.scene.add(fill)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -3.1
    floor.receiveShadow = true
    this.scene.add(floor)
    this.scene.add(this.stage)

    this.diceMaterials = FACE_ORDER.map(
      (pips) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: pipTexture(pips) }),
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
        if (!this.diceMaterials.includes(material as THREE.MeshLambertMaterial)) material.dispose()
      }
    })
    this.object = null
  }

  private die(size: number) {
    let geometry = this.dieGeometries.get(size)
    if (!geometry) {
      geometry = new THREE.BoxGeometry(size, size, size)
      this.dieGeometries.set(size, geometry)
    }
    const mesh = new THREE.Mesh(geometry, this.diceMaterials)
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
      const mesh = this.die(index === 2 ? 1.5 : 1.2)
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
      lambert(SLATE, { side: THREE.DoubleSide }),
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.72, 48), lambert(SLATE))
    body.castShadow = true
    body.receiveShadow = true
    drum.add(body)
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2
      const chamber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.78, 24),
        lambert(0x0d0e10),
      )
      chamber.position.set(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72)
      drum.add(chamber)
      if (index < 2) {
        const round = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.84, 20),
          lambert(ACCENT),
        )
        round.position.copy(chamber.position)
        drum.add(round)
      }
    }
    drum.rotation.set(Math.PI / 2.35, 0, 0.2)
    drum.position.set(0.5, 0.15, 0)
    drum.userData = { spin: 0.42 } satisfies SpinBob
    group.add(drum)

    const cartridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 8, 20), lambert(ACCENT))
    cartridge.position.set(-1.9, -0.5, 0.6)
    cartridge.rotation.z = 1.1
    cartridge.castShadow = true
    cartridge.userData = { bob: 0.9 } satisfies SpinBob
    group.add(cartridge)
    return group
  }
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function paddle(color: number) {
  const group = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.13, 48), lambert(color))
  blade.rotation.x = Math.PI / 2
  group.add(blade)
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 8, 16), lambert(0x202125))
  grip.position.y = -1.25
  group.add(grip)
  return group
}

function buildPingpong() {
  const group = new THREE.Group()
  const near = paddle(0xe53935)
  near.position.set(-1.5, 0.2, 0)
  near.rotation.set(0.2, 0.5, 0.25)
  group.add(near)
  const far = paddle(INK)
  far.position.set(1.6, -0.1, -0.6)
  far.rotation.set(-0.15, -0.6, -0.3)
  group.add(far)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), lambert(ACCENT))
  ball.position.set(0.1, 1.1, 0.7)
  ball.userData = { bob: 1 } satisfies SpinBob
  group.add(ball)
  return group
}

function buildFishing() {
  const group = new THREE.Group()
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 4.4, 20), lambert(IVORY))
  rod.position.set(-0.6, 0.4, 0)
  rod.rotation.z = 0.55
  group.add(rod)
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.08, 16, 48, Math.PI * 1.35),
    lambert(ACCENT),
  )
  hook.position.set(1.35, -1.1, 0)
  hook.rotation.z = -0.4
  hook.userData = { bob: 0.6 } satisfies SpinBob
  group.add(hook)
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), lambert(0x82838a))
  line.position.set(1.32, -0.2, 0)
  group.add(line)
  const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 32), lambert(0xe53935))
  bobber.position.set(-1.9, -1.5, 0.6)
  bobber.userData = { bob: 1.3 } satisfies SpinBob
  group.add(bobber)
  return group
}
