import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { disposeAppearance, syncAppearance } from './appearance'
import { createBowl, createKeepSlots, createTray } from './arena'
import { easedTilt, releaseDiceImpulses, spawnDiceForRoll } from './bowlMotion'
import { BowlRig } from './bowlRig'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDiceInstances } from './diceInstances'
import { pickDie } from './interaction'
import {
  lineUpDice as placeDice,
  positionKeepSlots,
  prepareAlignmentEntries,
  prepareLayoutEntries,
  resultCameraWidth,
  updateAlignmentEntries,
  updateLayoutEntries,
} from './layout'
import type { PhysicsDiceGeometries, PhysicsDiceMaterials } from './model'
import { createPhysicsDiceRandom, type PhysicsDiceRandom } from './random'
import { type DiceTrajectoryPlan, planDiceTrajectory } from './remap'
import type { AlignmentEntry, DieEntry, LayoutEntry } from './runtimeTypes'
import { containDiceInBowl } from './safety'
import { createStage } from './stage'
import {
  applyTrajectoryOffset,
  applyTrajectoryPose,
  commitTrajectoryPose,
  detectTrajectoryImpacts,
  trajectoryStep,
} from './trajectory'
import type {
  PhysicsDiceIndex,
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
  private bowlRig!: BowlRig
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
  private lastTime = 0
  private layoutAnimating = false
  private layoutEntries: LayoutEntry[] = []
  private layoutStartedAt = 0
  private keepAll = false
  private materials!: PhysicsDiceMaterials
  private phase: 'idle' | 'shaking' | 'pouring' | 'aligning' = 'idle'
  private pointerHandler = (event: PointerEvent) => this.pick(event)
  private quality: PhysicsDiceQuality
  private railLineMaterial!: THREE.MeshBasicMaterial
  private railMaterial!: THREE.MeshBasicMaterial
  private random: PhysicsDiceRandom = createPhysicsDiceRandom(0)
  private renderer!: THREE.WebGLRenderer
  private request: PhysicsDiceRollRequest | null = null
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
  private settledDice: PhysicsDiceSet | null = null
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
    this.updateHeldOrder(request.held)
    this.held = [...request.held]
    this.phase = 'shaking'
    this.callbacks.onPhaseChange('shaking')
    this.cameraHorizontal = SCENE.camera.simulationHalfWidth
    const now = performance.now()
    this.lastTime = now
    this.accumulator = 0
    this.fallingDice.fill(false)
    this.lastImpactAt.fill(0)
    this.bowlRig.start(now)

    spawnDiceForRoll({
      committedDice: this.committedDice,
      entries: this.entries,
      held: request.held,
      heldOrder: this.heldOrder,
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
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
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

  private layoutInput() {
    return {
      entries: this.entries,
      held: this.held,
      heldOrder: this.heldOrder,
      keepAll: this.keepAll,
    }
  }

  private lineUpDice() {
    this.layoutAnimating = false
    this.cameraHorizontal = resultCameraWidth()
    this.bowlRig.hide()
    placeDice(this.layoutInput(), this.committedDice)
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
    this.resize()
  }

  private occupiedKeepSlots() {
    return this.keepAll ? this.keepSlots.length : this.heldOrder.length
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
    if (this.bowlRig.update(time, this.phase)) this.releaseFromBowl()
  }

  private startLayoutTransition() {
    this.layoutAnimating = true
    this.layoutStartedAt = performance.now()
    this.cameraHorizontal = resultCameraWidth()
    this.bowlRig.hide()
    this.layoutEntries = prepareLayoutEntries(this.layoutInput(), this.committedDice)
    this.resize()
    this.invalidate()
  }

  private updateLayoutTransition(time: number) {
    const progress = Math.min(1, (time - this.layoutStartedAt) / SCENE.keepSlots.moveDurationMs)
    updateLayoutEntries(this.layoutEntries, progress)
    if (progress >= 1) this.layoutAnimating = false
  }

  private releaseFromBowl() {
    releaseDiceImpulses({ entries: this.entries, held: this.held, random: this.random })
    this.startTrajectoryReplay()
  }

  private startTrajectoryReplay() {
    const request = this.request
    if (!request) return
    const trajectory = planDiceTrajectory(this.world, this.entries, this.held, request.seed)
    if (!trajectory) {
      this.callbacks.onError(new Error('주사위 궤적을 계산하지 못했습니다.'))
      return
    }
    this.trajectory = trajectory
    this.trajectoryFrameIndex = 0
    this.trajectoryStartedAt = performance.now()
    applyTrajectoryOffset(this.entries, this.held, request.targetDice, trajectory.naturalDice)
    for (const entry of this.entries) {
      if (this.held[entry.index]) continue
      entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    }
  }

  private updateTrajectory(time: number) {
    const trajectory = this.trajectory
    if (!trajectory) return
    const step = trajectoryStep(
      trajectory,
      this.trajectoryStartedAt,
      this.trajectoryFrameIndex,
      time,
    )
    this.trajectoryFrameIndex = step.frameIndex
    const impacts = detectTrajectoryImpacts({
      entries: this.entries,
      falling: this.fallingDice,
      held: this.held,
      lastImpactAt: this.lastImpactAt,
      step,
      time,
    })
    for (const impact of impacts) this.callbacks.onDiceImpact?.(impact.index, impact.strength)
    applyTrajectoryPose(step, this.entries, this.held)
    if (step.elapsed < trajectory.durationSeconds) return
    commitTrajectoryPose(this.entries, this.held)
    this.trajectory = null
    this.startResultAlignment(time)
  }

  private startResultAlignment(time: number) {
    if (!this.request) return
    this.phase = 'aligning'
    this.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    this.settledDice = [...this.request.targetDice]
    this.alignmentEntries = prepareAlignmentEntries(this.layoutInput(), this.settledDice)
    positionKeepSlots(
      this.keepSlots,
      Math.min(this.heldOrder.length, this.occupiedKeepSlots()),
      this.keepSlotMaterials,
    )
  }

  private updateResultAlignment(time: number) {
    const progress = Math.min(1, (time - this.alignmentStartedAt) / SCENE.alignment.durationMs)
    const eased = easedTilt(progress)
    this.cameraHorizontal = THREE.MathUtils.lerp(
      SCENE.camera.simulationHalfWidth,
      resultCameraWidth(),
      eased,
    )
    this.resize()
    updateAlignmentEntries(this.alignmentEntries, progress)
    this.updateBowlExit(time)
    if (progress < 1 || !this.request || !this.settledDice) return
    const completed = this.request
    const completedDice = this.settledDice
    this.committedDice = [...completedDice]
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
    this.entries.forEach((entry) => {
      entry.visualOffset.identity()
    })
    this.request = null
    this.phase = 'idle'
    this.callbacks.onPhaseChange('idle')
    this.callbacks.onRollComplete(completed.requestId, completedDice)
  }

  private updateBowlExit(time: number) {
    this.bowlRig.updateExit(time)
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
