import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { GameKey } from '@/games'
import { buildDavinci, buildFishing, buildPingpong, materialsOf } from './heroObjects'
import { buildDuel, buildLiars, buildYacht } from './heroSceneObjects'
import { createHeroStage } from './heroStage'
import type { SpinBob } from './heroTextures'

export type { GameKey }

const MIN_FRAME_S = 1 / 30

export interface HeroSceneOptions {
  container: HTMLElement
  game: GameKey
  reducedMotion?: boolean
}

/**
 * 랜딩 히어로의 Three.js 장면 — **수명과 매 프레임 연출**.
 *
 * 무대(렌더러·조명·바닥·재질)는 `heroStage.ts`, 게임별 오브젝트는 `heroObjects.ts`가
 * 정본이다. 이 클래스는 루프·리사이즈·포커스(보일 때만 렌더)·정리와 입장/패럴랙스
 * 애니메이션만 갖는다.
 */
export class HeroScene {
  private readonly container: HTMLElement
  private readonly reducedMotion: boolean
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly stage: THREE.Group
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

    const parts = createHeroStage(container)
    this.renderer = parts.renderer
    this.scene = parts.scene
    this.camera = parts.camera
    this.stage = parts.stage
    this.diceMaterials = parts.diceMaterials
    this.accentDiceMaterials = parts.accentDiceMaterials

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

  /** 숨김·일시정지에는 루프를 완전히 멈춘다(배터리·GPU 점유). */
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

  private die = (size: number, tone: 'ivory' | 'accent' = 'ivory') => {
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
        return buildLiars(this.die)
      case 'duel':
        return buildDuel()
      case 'pingpong':
        return buildPingpong()
      case 'fishing':
        return buildFishing()
      case 'davinci':
        return buildDavinci()
      default:
        return buildYacht(this.die)
    }
  }
}
