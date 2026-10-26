import RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import { disposeAppearance, syncAppearance } from './appearance'
import { createBowl, createKeepSlots, createTray } from './arena'
import { releaseDiceImpulses, spawnDiceForRoll } from './bowlMotion'
import { BowlRig } from './bowlRig'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDiceInstances } from './diceInstances'
import { pickDie } from './interaction'
import type { PhysicsDiceGeometries, PhysicsDiceMaterials } from './model'
import { createPhysicsDiceRandom, type PhysicsDiceRandom } from './random'
import { ResultLayout } from './resultLayout'
import type { DieEntry } from './runtimeTypes'
import { containDiceInBowl } from './safety'
import { createStage } from './stage'

import type {
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsDiceWorldOptions,
  PhysicsHeldDice,
} from './types'
import {
  applyHalfExtents,
  applyQualityPreset,
  cameraHalfExtents,
  ResizeScheduler,
} from './viewport'
import { RollReplay } from './worldReplay'
import { createLayoutStage, createReplayStage } from './worldStages'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
let rapierReady: Promise<typeof RAPIER> | undefined

export class PhysicsDiceWorld {
  private active = true
  private accumulator = 0
  private bowlBody!: RAPIER.RigidBody
  bowlRig!: BowlRig
  private bowlGroup!: THREE.Group
  private bowlInner!: THREE.Mesh
  private bowlInnerMaterial!: THREE.MeshStandardMaterial
  private bowlMaterials: THREE.Material[] = []
  callbacks: PhysicsDiceWorldCallbacks
  private camera!: THREE.OrthographicCamera
  private ambient!: THREE.HemisphereLight
  cameraHorizontal: number = SCENE.camera.resultHalfWidth
  committedDice: PhysicsDiceSet = INITIAL_DICE
  private container: HTMLElement
  entries: DieEntry[] = []
  private frameId: number | null = null
  private geometries!: PhysicsDiceGeometries
  held: PhysicsHeldDice = NO_HELD
  private keyLight!: THREE.DirectionalLight
  keepSlotMaterials: THREE.Material[] = []
  keepSlots: THREE.Group[] = []
  private lastTime = 0
  private materials!: PhysicsDiceMaterials
  phase: 'idle' | 'shaking' | 'pouring' | 'aligning' = 'idle'
  private pointerHandler = (event: PointerEvent) => this.pick(event)
  private quality: PhysicsDiceQuality
  private railLineMaterial!: THREE.MeshBasicMaterial
  private railMaterial!: THREE.MeshBasicMaterial
  private random: PhysicsDiceRandom = createPhysicsDiceRandom(0)
  private renderer!: THREE.WebGLRenderer
  private resizeObserver?: ResizeObserver
  private resizeScheduler = new ResizeScheduler({
    isActive: () => this.active,
    measure: () => ({
      height: Math.max(1, this.container.clientHeight),
      width: Math.max(1, this.container.clientWidth),
    }),
    resetClock: () => {
      this.lastTime = performance.now()
      this.accumulator = 0
    },
    resize: () => this.resize(),
    setBusy: (busy) => this.callbacks.onResizeChange(busy),
  })
  private scene!: THREE.Scene
  private themeObserver?: MutationObserver
  private trayMaterials: THREE.Material[] = []
  private world!: RAPIER.World
  private replay!: RollReplay
  private layout!: ResultLayout

  constructor({ callbacks, container, quality }: PhysicsDiceWorldOptions) {
    this.callbacks = callbacks
    this.container = container
    this.quality = quality
    // 배치·재생은 `init()` 전에도 호출된다(`syncCommittedDice`가 첫 프레임 전에 온다).
    // 그래서 생성자에서 만든다 — 스테이지는 접근자라 초기화 순서에 안전하다.
    // 배치·재생 절차는 월드를 `StageHost`로만 본다(그 인터페이스가 요구하는 필드만 공개).
    // 접근자 래퍼 대신 월드 자체를 넘겨 값 복사로 인한 낡은 배열 참조를 없앤다.
    this.layout = new ResultLayout(createLayoutStage(this))
    this.replay = new RollReplay(createReplayStage(this, this.layout))
  }

  async init() {
    rapierReady ??= RAPIER.init().then(() => RAPIER)
    const Rapier = await rapierReady
    if (!this.active) return

    this.world = new Rapier.World({ x: 0, y: -CONFIG.defaults.gravity, z: 0 })
    this.world.timestep = 1 / CONFIG.defaults.simulationHz
    Object.assign(this, createStage(this.container))
    Object.assign(this, createTray(this.scene, this.world))
    Object.assign(this, createBowl(this.scene, this.world))
    Object.assign(this, createDiceInstances(this.scene, this.world))
    this.syncTheme()
    Object.assign(this, createKeepSlots(this.scene, this.geometries))
    this.bowlRig = new BowlRig({
      bowlBody: this.bowlBody,
      bowlGroup: this.bowlGroup,
      bowlInner: this.bowlInner,
      entries: this.entries,
      held: () => this.held,
      random: () => this.random,
    })
    this.syncTheme()
    this.applyQuality(this.quality)
    this.resizeObserver = new ResizeObserver(() => this.resizeScheduler.observe())
    this.resizeObserver.observe(this.container)
    this.themeObserver = new MutationObserver(() => {
      this.syncTheme()
      this.invalidate()
    })
    this.themeObserver.observe(document.documentElement, { attributes: true })
    this.renderer.domElement.addEventListener('pointerup', this.pointerHandler)
    this.resize()
    this.syncCommittedDice(this.committedDice, this.held)
    this.invalidate()
  }

  syncCommittedDice(dice: PhysicsDiceSet | null, held: PhysicsHeldDice) {
    const heldChanged = held.some((value, index) => value !== this.held[index])
    if (dice) this.committedDice = [...dice]
    this.layout.syncHeld(held)
    this.held = [...held]
    if (!this.world || this.phase !== 'idle') return
    if (heldChanged) this.layout.startTransition()
    else this.layout.lineUp()
    this.invalidate()
  }

  startRoll(request: PhysicsDiceRollRequest) {
    if (!this.world || this.phase !== 'idle') return
    this.replay.begin(request)
    this.entries.forEach((entry) => {
      entry.visualOffset.identity()
    })
    this.random = createPhysicsDiceRandom(request.seed)
    this.layout.syncHeld(request.held)
    this.held = [...request.held]
    this.phase = 'shaking'
    this.callbacks.onPhaseChange('shaking')
    this.cameraHorizontal = SCENE.camera.simulationHalfWidth
    const now = performance.now()
    this.lastTime = now
    this.accumulator = 0
    this.bowlRig.start(now)

    spawnDiceForRoll({
      committedDice: this.committedDice,
      entries: this.entries,
      held: request.held,
      heldOrder: this.layout.holdOrder,
      random: this.random,
    })
    this.resize()
    this.invalidate()
  }

  setKeepAll(enabled: boolean) {
    if (!this.layout.setKeepAll(enabled)) return
    if (!this.world || this.phase !== 'idle' || this.layout.running) return
    this.layout.lineUp()
    this.invalidate()
  }

  setMotionFollow(enabled: boolean) {
    this.bowlRig?.setMotionFollow(enabled)
  }

  applyShakePulse(direction: 'left' | 'right', strength: number) {
    if (!this.world || !this.bowlRig || this.phase !== 'shaking') return
    if (this.bowlRig.pulse(direction, strength, performance.now(), true)) this.invalidate()
  }

  pour() {
    if (!this.world || !this.bowlRig.pour(this.phase, performance.now())) return
    this.phase = 'pouring'
    this.callbacks.onPhaseChange('pouring')
    this.invalidate()
  }

  applyQuality(quality: PhysicsDiceQuality) {
    this.quality = quality
    if (!this.renderer) return
    applyQualityPreset(quality, this.renderer, this.keyLight)
    this.resize()
  }

  resize() {
    if (!this.renderer) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    applyHalfExtents(this.camera, cameraHalfExtents(width / height, this.cameraHorizontal))
    this.renderer.setSize(width, height, false)
    this.resizeScheduler.record(width, height)
    this.layout.placeSlots(this.layout.occupiedSlots())
    this.invalidate()
  }

  destroy() {
    this.active = false
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.resizeScheduler.dispose()
    this.callbacks.onResizeChange(false)
    this.resizeObserver?.disconnect()
    this.themeObserver?.disconnect()
    this.renderer?.domElement.removeEventListener('pointerup', this.pointerHandler)
    if (this.geometries && this.materials) {
      disposeAppearance(this.appearanceResources(), this.scene, this.renderer)
    }
    this.world?.free()
    this.container.replaceChildren()
  }

  private frame = (time: number) => {
    this.frameId = null
    if (!this.active) return
    const elapsed = Math.min(0.08, Math.max(0, (time - this.lastTime) / 1000))
    this.lastTime = time
    const simulating =
      this.phase === 'shaking' || (this.phase === 'pouring' && !this.bowlRig.isReleased)
    if (simulating) this.accumulator += elapsed
    this.updateBowl(time)
    while (simulating && !this.bowlRig.isReleased && this.accumulator >= this.world.timestep) {
      this.world.step()
      if (this.phase === 'shaking') containDiceInBowl(this.entries, this.held, this.bowlBody)
      this.accumulator -= this.world.timestep
    }
    if (this.phase === 'aligning') this.replay.updateAlignment(time)
    else if (this.phase === 'pouring' && this.replay.replaying) this.replay.updateTrajectory(time)
    else if (this.layout.running) this.layout.advance(time)
    else {
      this.entries.forEach((entry) => {
        const position = entry.body.translation()
        const rotation = entry.body.rotation()
        entry.mesh.position.set(position.x, position.y, position.z)
        entry.mesh.quaternion
          .set(rotation.x, rotation.y, rotation.z, rotation.w)
          .multiply(entry.visualOffset)
      })
    }
    this.renderer.render(this.scene, this.camera)
    if (this.phase !== 'idle' || this.layout.running) this.invalidate()
  }

  private updateBowl(time: number) {
    if (this.bowlRig.update(time, this.phase)) this.releaseFromBowl()
  }

  private releaseFromBowl() {
    releaseDiceImpulses({ entries: this.entries, held: this.held, random: this.random })
    this.replay.start(this.world)
  }

  /** 배치 절차가 요구하는 이름 — 사발 숨기기는 리그의 몫이라 위임만 한다. */
  hideBowl() {
    this.bowlRig.hide()
  }

  private pick(event: PointerEvent) {
    if (this.phase !== 'idle') return
    const index = pickDie(event, this.renderer, this.camera, this.entries)
    if (index !== null) this.callbacks.onHeldToggle(index)
  }

  /** 다음 프레임을 예약한다 — 배치·재생 절차도 부른다. */
  invalidate() {
    if (!this.active || !this.renderer || this.frameId !== null) return
    this.frameId = requestAnimationFrame(this.frame)
  }

  private syncTheme() {
    if (!this.materials) return
    syncAppearance(this.appearanceResources())
  }

  private appearanceResources() {
    return {
      ambient: this.ambient,
      bowlInnerMaterial: this.bowlInnerMaterial,
      bowlMaterials: this.bowlMaterials,
      entries: this.entries,
      geometries: this.geometries,
      keepSlotMaterials: this.keepSlotMaterials,
      materials: this.materials,
      railLineMaterial: this.railLineMaterial,
      railMaterial: this.railMaterial,
      trayMaterials: this.trayMaterials,
    }
  }
}
