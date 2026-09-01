import RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import { disposeAppearance, syncAppearance } from './appearance'
import { createBowl, createKeepSlots, createTray } from './arena'
import {
  applyShakePulseImpulses,
  bowlExitFrame,
  pourBowlFrame,
  shakeBowlFrame,
  shakeIntensity,
} from './bowlMotion'
import { PHYSICS_DICE_CONFIG } from './config'
import { beginTrajectoryReplay, playTrajectoryFrame, releaseDiceFromBowl } from './diceFlight'
import { createDiceInstances } from './diceInstances'
import { orthographicFrustum, seatDiceForShake } from './diceSeating'
import { pickDie } from './interaction'
import {
  nextHeldOrder,
  occupiedKeepSlotCount,
  positionKeepSlots,
  resultCameraWidth,
} from './layout'
import type { PhysicsDiceGeometries, PhysicsDiceMaterials } from './model'
import { createPhysicsDiceRandom, type PhysicsDiceRandom } from './random'
import type { DiceTrajectoryPlan } from './remap'
import { ResizeSettler } from './resizeSettler'
import {
  beginLayoutTransition,
  beginResultAlignment,
  completeResultAlignment,
  placeDiceInResultRow,
  stepLayoutTransition,
  stepResultAlignment,
} from './resultAlignment'
import type { AlignmentEntry, DieEntry, LayoutEntry } from './runtimeTypes'
import { containDiceInBowl } from './safety'
import { createStage } from './stage'
import type {
  PhysicsDiceIndex,
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsDiceWorldOptions,
  PhysicsHeldDice,
} from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
let rapierReady: Promise<typeof RAPIER> | undefined

export class PhysicsDiceWorld {
  private active = true
  private alignmentEntries: AlignmentEntry[] = []
  private alignmentStartedAt = 0
  private accumulator = 0
  private bowlBody!: RAPIER.RigidBody
  private bowlExitStartedAt = 0
  private bowlGroup!: THREE.Group
  private bowlInner!: THREE.Mesh
  private bowlInnerMaterial!: THREE.MeshStandardMaterial
  private bowlMaterials: THREE.Material[] = []
  private callbacks: PhysicsDiceWorldCallbacks
  private camera!: THREE.OrthographicCamera
  private ambient!: THREE.HemisphereLight
  private cameraHorizontal: number = SCENE.camera.resultHalfWidth
  private committedDice: PhysicsDiceSet = INITIAL_DICE
  private container: HTMLElement
  private diceReleased = false
  private entries: DieEntry[] = []
  private fallingDice = [false, false, false, false, false]
  private frameId: number | null = null
  private geometries!: PhysicsDiceGeometries
  private held: PhysicsHeldDice = NO_HELD
  private heldOrder: PhysicsDiceIndex[] = []
  private keyLight!: THREE.DirectionalLight
  private keepSlotMaterials: THREE.Material[] = []
  private keepSlots: THREE.Group[] = []
  private lastImpactAt = [0, 0, 0, 0, 0]
  private lastPulseAt = 0
  private lastShakeKick = 0
  private lastTime = 0
  private layoutAnimating = false
  private layoutEntries: LayoutEntry[] = []
  private layoutStartedAt = 0
  private keepAll = false
  private materials!: PhysicsDiceMaterials
  private motionFollow = false
  private phase: 'idle' | 'shaking' | 'pouring' | 'aligning' = 'idle'
  private pointerHandler = (event: PointerEvent) => this.pick(event)
  private pourStartedAt = 0
  private quality: PhysicsDiceQuality
  private railLineMaterial!: THREE.MeshBasicMaterial
  private railMaterial!: THREE.MeshBasicMaterial
  private random: PhysicsDiceRandom = createPhysicsDiceRandom(0)
  private renderer!: THREE.WebGLRenderer
  private request: PhysicsDiceRollRequest | null = null
  private resizeObserver?: ResizeObserver
  private readonly resizeSettler: ResizeSettler
  private scene!: THREE.Scene
  private settledDice: PhysicsDiceSet | null = null
  private shakeEnergy = 0
  private shakeStartedAt = 0
  private themeObserver?: MutationObserver
  private trajectory: DiceTrajectoryPlan | null = null
  private trajectoryFrameIndex = 0
  private trajectoryStartedAt = 0
  private trayMaterials: THREE.Material[] = []
  private world!: RAPIER.World

  constructor({ callbacks, container, quality }: PhysicsDiceWorldOptions) {
    this.callbacks = callbacks
    this.container = container
    this.quality = quality
    this.resizeSettler = new ResizeSettler({
      container,
      isActive: () => this.active,
      apply: () => this.resize(),
      onPending: (pending) => this.callbacks.onResizeChange(pending),
      onSettled: () => {
        // 미뤄 둔 동안 흐른 시간을 물리에 한꺼번에 밀어 넣지 않는다.
        this.lastTime = performance.now()
        this.accumulator = 0
      },
    })
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
    this.syncTheme()
    this.applyQuality(this.quality)
    this.resizeObserver = new ResizeObserver(() => this.resizeSettler.queue())
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
    this.updateHeldOrder(held)
    this.held = [...held]
    if (!this.world || this.phase !== 'idle') return
    if (heldChanged) this.startLayoutTransition()
    else this.lineUpDice()
    this.invalidate()
  }

  startRoll(request: PhysicsDiceRollRequest) {
    if (!this.world || this.phase !== 'idle' || this.request?.requestId === request.requestId)
      return
    this.request = request
    this.settledDice = null
    this.trajectory = null
    this.trajectoryFrameIndex = 0
    this.layoutAnimating = false
    this.entries.forEach((entry) => {
      entry.visualOffset.identity()
    })
    this.random = createPhysicsDiceRandom(request.seed)
    this.heldOrder = nextHeldOrder(this.heldOrder, request.held)
    this.held = [...request.held]
    this.phase = 'shaking'
    this.callbacks.onPhaseChange('shaking')
    this.cameraHorizontal = SCENE.camera.simulationHalfWidth
    this.shakeStartedAt = performance.now()
    this.lastTime = this.shakeStartedAt
    this.lastShakeKick = 0
    this.shakeEnergy = this.motionFollow ? SCENE.bowl.followStartEnergy : 0
    this.lastPulseAt = this.shakeStartedAt
    this.accumulator = 0
    this.diceReleased = false
    this.fallingDice.fill(false)
    this.lastImpactAt.fill(0)
    this.bowlGroup.visible = true
    this.bowlGroup.position.set(SCENE.bowl.startX, SCENE.bowl.hoverY, SCENE.bowl.startZ)
    this.bowlGroup.rotation.set(0, 0, 0)
    this.bowlInner.visible = true
    this.bowlBody.setTranslation(
      { x: SCENE.bowl.startX, y: SCENE.bowl.hoverY, z: SCENE.bowl.startZ },
      true,
    )
    this.bowlBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)

    seatDiceForShake({
      entries: this.entries,
      held: request.held,
      heldOrder: this.heldOrder,
      committedDice: this.committedDice,
      random: this.random,
    })
    this.resize()
    this.invalidate()
  }

  setKeepAll(enabled: boolean) {
    if (this.keepAll === enabled) return
    this.keepAll = enabled
    if (!this.world || this.phase !== 'idle' || this.layoutAnimating) return
    this.lineUpDice()
    this.invalidate()
  }

  setMotionFollow(enabled: boolean) {
    this.motionFollow = enabled
  }

  applyShakePulse(direction: 'left' | 'right', strength: number) {
    if (!this.motionFollow || !this.world || this.phase !== 'shaking') return
    const now = performance.now()
    const clamped = Math.min(1, Math.max(0, strength))
    this.shakeEnergy = Math.min(
      1,
      Math.max(
        this.currentShakeIntensity(now),
        SCENE.bowl.followPulseFloor + clamped * SCENE.bowl.followPulseGain,
      ),
    )
    this.lastPulseAt = now
    applyShakePulseImpulses({
      direction,
      clamped,
      entries: this.entries,
      held: this.held,
      random: this.random,
    })
    this.invalidate()
  }

  pour() {
    if (this.phase !== 'shaking') return
    this.phase = 'pouring'
    this.pourStartedAt = performance.now()
    this.bowlExitStartedAt = this.pourStartedAt + SCENE.bowl.tiltDurationMs
    this.callbacks.onPhaseChange('pouring')
    this.invalidate()
  }

  applyQuality(quality: PhysicsDiceQuality) {
    this.quality = quality
    if (!this.renderer) return
    const preset = CONFIG.quality[quality]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio))
    this.renderer.shadowMap.enabled = preset.shadows
    this.keyLight.castShadow = preset.shadows
    if (preset.shadowSize > 0)
      this.keyLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize)
    this.keyLight.shadow.map?.dispose()
    this.resize()
  }

  resize() {
    if (!this.renderer) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const { horizontal, vertical } = orthographicFrustum({
      width,
      height,
      cameraHorizontal: this.cameraHorizontal,
    })
    this.camera.left = -horizontal
    this.camera.right = horizontal
    this.camera.top = vertical
    this.camera.bottom = -vertical
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.resizeSettler.markApplied(width, height)
    positionKeepSlots(
      this.keepSlots,
      occupiedKeepSlotCount(this.keepAll, this.keepSlots.length, this.heldOrder.length),
      this.keepSlotMaterials,
    )
    this.invalidate()
  }

  destroy() {
    this.active = false
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.resizeSettler.cancel()
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

  private lineUpDice() {
    this.layoutAnimating = false
    this.cameraHorizontal = resultCameraWidth()
    placeDiceInResultRow(this.alignmentScene)
    this.resize()
  }

  private frame = (time: number) => {
    this.frameId = null
    if (!this.active) return
    const elapsed = Math.min(0.08, Math.max(0, (time - this.lastTime) / 1000))
    this.lastTime = time
    const simulating = this.phase === 'shaking' || (this.phase === 'pouring' && !this.diceReleased)
    if (simulating) this.accumulator += elapsed
    this.updateBowl(time)
    while (simulating && !this.diceReleased && this.accumulator >= this.world.timestep) {
      this.world.step()
      if (this.phase === 'shaking') containDiceInBowl(this.entries, this.held, this.bowlBody)
      this.accumulator -= this.world.timestep
    }
    if (this.phase === 'aligning') this.updateResultAlignment(time)
    else if (this.phase === 'pouring' && this.trajectory) this.updateTrajectory(time)
    else if (this.layoutAnimating) this.updateLayoutTransition(time)
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
    if (this.phase !== 'idle' || this.layoutAnimating) this.invalidate()
  }

  private updateBowl(time: number) {
    if (this.phase === 'shaking') {
      this.lastShakeKick = shakeBowlFrame({
        time,
        shakeStartedAt: this.shakeStartedAt,
        lastShakeKick: this.lastShakeKick,
        motionFollow: this.motionFollow,
        shakeEnergy: this.shakeEnergy,
        lastPulseAt: this.lastPulseAt,
        bowlBody: this.bowlBody,
        bowlGroup: this.bowlGroup,
        entries: this.entries,
        held: this.held,
        random: this.random,
      })
      return
    }
    if (this.phase !== 'pouring') return
    const { releaseDue, exitDue } = pourBowlFrame({
      time,
      pourStartedAt: this.pourStartedAt,
      bowlBody: this.bowlBody,
      bowlGroup: this.bowlGroup,
      diceReleased: this.diceReleased,
    })
    if (exitDue) this.updateBowlExit(time)
    if (releaseDue) this.releaseFromBowl()
  }

  private currentShakeIntensity(time: number) {
    return shakeIntensity({
      motionFollow: this.motionFollow,
      shakeEnergy: this.shakeEnergy,
      lastPulseAt: this.lastPulseAt,
      time,
    })
  }

  private startLayoutTransition() {
    this.layoutAnimating = true
    this.layoutStartedAt = performance.now()
    this.cameraHorizontal = resultCameraWidth()
    this.layoutEntries = beginLayoutTransition(this.alignmentScene)
    this.resize()
    this.invalidate()
  }

  private updateLayoutTransition(time: number) {
    this.layoutAnimating = stepLayoutTransition({
      layoutEntries: this.layoutEntries,
      time,
      startedAt: this.layoutStartedAt,
    })
  }

  private releaseFromBowl() {
    if (this.diceReleased) return
    this.diceReleased = true
    releaseDiceFromBowl({
      bowlBody: this.bowlBody,
      entries: this.entries,
      held: this.held,
      random: this.random,
    })
    this.startTrajectoryReplay()
  }

  private startTrajectoryReplay() {
    const request = this.request
    if (!request) return
    const trajectory = beginTrajectoryReplay({
      world: this.world,
      entries: this.entries,
      held: this.held,
      request,
      onError: (error) => this.callbacks.onError(error),
    })
    if (!trajectory) return
    this.trajectory = trajectory
    this.trajectoryFrameIndex = 0
    this.trajectoryStartedAt = performance.now()
  }

  private updateTrajectory(time: number) {
    const trajectory = this.trajectory
    if (!trajectory) return
    const { frameIndex, finished } = playTrajectoryFrame({
      trajectory,
      trajectoryStartedAt: this.trajectoryStartedAt,
      trajectoryFrameIndex: this.trajectoryFrameIndex,
      time,
      entries: this.entries,
      held: this.held,
      fallingDice: this.fallingDice,
      lastImpactAt: this.lastImpactAt,
      onDiceImpact: this.callbacks.onDiceImpact,
    })
    this.trajectoryFrameIndex = frameIndex
    if (!finished) return
    this.trajectory = null
    this.startResultAlignment(time)
  }

  /** 정렬·자리 이동이 만지는 것만 모은 얼굴. 월드의 나머지 상태는 넘기지 않는다. */
  private get alignmentScene() {
    return {
      entries: this.entries,
      held: this.held,
      heldOrder: this.heldOrder,
      keepAll: this.keepAll,
      keepSlots: this.keepSlots,
      keepSlotMaterials: this.keepSlotMaterials,
      committedDice: this.committedDice,
      bowlGroup: this.bowlGroup,
      bowlBody: this.bowlBody,
    }
  }

  private startResultAlignment(time: number) {
    if (!this.request) return
    this.phase = 'aligning'
    this.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    this.settledDice = [...this.request.targetDice]
    this.alignmentEntries = beginResultAlignment(this.alignmentScene, this.settledDice)
  }

  private updateResultAlignment(time: number) {
    const { progress, cameraHorizontal } = stepResultAlignment({
      alignmentEntries: this.alignmentEntries,
      time,
      startedAt: this.alignmentStartedAt,
    })
    this.cameraHorizontal = cameraHorizontal
    this.resize()
    this.updateBowlExit(time)
    if (progress < 1 || !this.request || !this.settledDice) return
    const completed = this.request
    const completedDice = this.settledDice
    this.committedDice = [...completedDice]
    completeResultAlignment(this.alignmentScene)
    this.request = null
    this.phase = 'idle'
    this.callbacks.onPhaseChange('idle')
    this.callbacks.onRollComplete(completed.requestId, completedDice)
  }

  private updateBowlExit(time: number) {
    bowlExitFrame({
      bowlGroup: this.bowlGroup,
      time,
      bowlExitStartedAt: this.bowlExitStartedAt,
    })
  }

  private pick(event: PointerEvent) {
    if (this.phase !== 'idle') return
    const index = pickDie(event, this.renderer, this.camera, this.entries)
    if (index !== null) this.callbacks.onHeldToggle(index)
  }

  private invalidate() {
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

  private updateHeldOrder(held: PhysicsHeldDice) {
    this.heldOrder = this.heldOrder.filter((index) => held[index])
    held.forEach((isHeld, index) => {
      const dieIndex = index as PhysicsDiceIndex
      if (isHeld && !this.heldOrder.includes(dieIndex)) this.heldOrder.push(dieIndex)
    })
  }
}
