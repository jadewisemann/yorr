import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { disposeAppearance, syncAppearance } from './appearance'
import { createBowl, createKeepSlots, createTray } from './arena'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDiceInstances } from './diceInstances'
import { pickDie } from './interaction'
import {
  keepSlotPosition,
  keepSlotScale,
  lineUpDice as placeDice,
  positionKeepSlots,
  prepareAlignmentEntries,
  prepareLayoutEntries,
  resultCameraWidth,
  simulationDieScale,
  tiltedBowlPosition,
  updateAlignmentEntries,
  updateLayoutEntries,
} from './layout'
import type { PhysicsDiceGeometries, PhysicsDiceMaterials } from './model'
import { quaternionForTopValue } from './model'
import { createPhysicsDiceRandom, type PhysicsDiceRandom } from './random'
import {
  cubeAlignmentOffset,
  type DiceTrajectoryFrame,
  type DiceTrajectoryPlan,
  planDiceTrajectory,
} from './remap'
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
const UP = new THREE.Vector3(0, 1, 0)
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
let rapierReady: Promise<typeof RAPIER> | undefined

const RESIZE_SETTLE_THRESHOLD_PX = 120

export class PhysicsDiceWorld {
  private active = true
  private alignmentEntries: AlignmentEntry[] = []
  private alignmentStartedAt = 0
  private accumulator = 0
  private appliedHeight = 0
  private appliedWidth = 0
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
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
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
    this.resizeObserver = new ResizeObserver(() => this.queueSettledResize())
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

    const heldSlots = new Map(this.heldOrder.map((index, slot) => [index, slot]))
    this.entries.forEach((entry) => {
      const isHeld = request.held[entry.index]
      const halfSize = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
      entry.collider.setShape(new RAPIER.Cuboid(halfSize, halfSize, halfSize))
      if (isHeld) {
        const position = keepSlotPosition(heldSlots.get(entry.index) ?? 0)
        entry.mesh.visible = true
        entry.mesh.scale.setScalar(keepSlotScale())
        entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
        entry.body.setTranslation(position, true)
        entry.body.setRotation(quaternionForTopValue(this.committedDice[entry.index]), true)
        entry.outline.position.set(position.x, 0.04, position.z)
        entry.outline.scale.set(keepSlotScale(), keepSlotScale(), 1)
        entry.outline.visible = true
        entry.outline.material.opacity = 0.92
        return
      }

      const angle = (entry.index / this.entries.length) * Math.PI * 2 - Math.PI / 2
      const radius = SCENE.bowl.spawnRadius + (this.random.next() - 0.5) * SCENE.bowl.spawnJitter
      entry.outline.visible = false
      entry.mesh.visible = true
      entry.mesh.scale.setScalar(simulationDieScale())
      entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      entry.body.setLinearDamping(CONFIG.defaults.linearDamping)
      entry.body.setAngularDamping(CONFIG.defaults.angularDamping)
      entry.body.setTranslation(
        {
          x: SCENE.bowl.startX + Math.cos(angle) * radius,
          y:
            SCENE.bowl.hoverY + SCENE.bowl.spawnBaseY + this.random.next() * SCENE.bowl.spawnRangeY,
          z: SCENE.bowl.startZ + Math.sin(angle) * radius,
        },
        true,
      )
      entry.body.setRotation(this.randomQuaternion(), true)
      entry.body.setLinvel(
        {
          x: (this.random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
          y: this.random.next() * CONFIG.defaults.spawnLiftSpeed,
          z: (this.random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
        },
        true,
      )
      entry.body.setAngvel(
        {
          x: (this.random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
          y: (this.random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
          z: (this.random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
        },
        true,
      )
      entry.body.wakeUp()
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
    const sign = direction === 'left' ? -1 : 1
    const mass = CONFIG.defaults.mass
    const strengthMultiplier = SCENE.bowl.shakeStrength
    const active = this.entries.filter((entry) => !this.held[entry.index])
    const kickSlot = Math.floor(this.random.next() * active.length)
    active.forEach((entry, slot) => {
      const liftSpeed = Math.sqrt(
        2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.25 + 0.75 * clamped),
      )
      entry.body.applyImpulse(
        {
          x: sign * SCENE.bowl.followPulseImpulse * (0.5 + clamped) * mass * strengthMultiplier,
          y: slot === kickSlot ? liftSpeed * mass * strengthMultiplier : 0,
          z: (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse * strengthMultiplier,
        },
        true,
      )
      entry.body.wakeUp()
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
    const aspect = width / height
    let vertical = Math.max(
      SCENE.camera.minHalfHeight,
      Math.min(this.cameraHorizontal / aspect, SCENE.camera.maxHalfHeight),
    )
    let horizontal = vertical * aspect
    if (horizontal < SCENE.camera.minHalfWidth) {
      horizontal = SCENE.camera.minHalfWidth
      vertical = horizontal / aspect
    }
    this.camera.left = -horizontal
    this.camera.right = horizontal
    this.camera.top = vertical
    this.camera.bottom = -vertical
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.appliedWidth = width
    this.appliedHeight = height
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
    this.invalidate()
  }

  destroy() {
    this.active = false
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
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
    this.bowlGroup.visible = false
    this.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)
    placeDice(this.entries, this.held, this.heldOrder, this.committedDice, this.keepAll)
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
      const intensity = this.currentShakeIntensity(time) * SCENE.bowl.shakeStrength
      const elapsed = (time - this.shakeStartedAt) / 1000
      const x = SCENE.bowl.startX + Math.sin(elapsed * 15) * SCENE.bowl.shakeOffsetX * intensity
      const z =
        SCENE.bowl.startZ + Math.sin(elapsed * 19 + 0.8) * SCENE.bowl.shakeOffsetZ * intensity
      const bowlVelocityX = Math.cos(elapsed * 15) * 15 * SCENE.bowl.shakeOffsetX * intensity
      const bowlVelocityZ = Math.cos(elapsed * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ * intensity
      const yaw = Math.sin(elapsed * 12) * SCENE.bowl.shakeYaw * intensity
      const lift = Math.abs(Math.sin(elapsed * 11)) * 0.025 * intensity
      const rotation = new THREE.Quaternion().setFromAxisAngle(UP, yaw)
      this.bowlBody.setNextKinematicTranslation({ x, y: SCENE.bowl.hoverY + lift, z })
      this.bowlBody.setNextKinematicRotation(rotation)
      this.bowlGroup.position.set(x, SCENE.bowl.hoverY + lift, z)
      this.bowlGroup.rotation.y = yaw
      if (intensity > 0 && time - this.lastShakeKick >= SCENE.bowl.shakeIntervalMs) {
        this.lastShakeKick = time
        const active = this.entries.filter((entry) => !this.held[entry.index])
        const kickSlot = Math.floor(this.random.next() * active.length)
        active.forEach((entry, slot) => {
          const position = entry.body.translation()
          const velocity = entry.body.linvel()
          const centerX = x - position.x
          const centerZ = z - position.z
          const mass = CONFIG.defaults.mass
          const kickRandom = this.random.next()
          const altitude = position.y - SCENE.bowl.hoverY
          const kickSpeed =
            slot === kickSlot && altitude < SCENE.bowl.shakeKickAltitude
              ? Math.sqrt(
                  2 *
                    CONFIG.defaults.gravity *
                    SCENE.bowl.shakeKickHeight *
                    (0.3 + 0.7 * kickRandom),
                )
              : 0
          entry.body.applyImpulse(
            {
              x:
                (bowlVelocityX - velocity.x) * SCENE.bowl.shakeFollowStrength * mass +
                (centerX * SCENE.bowl.shakeCenterStrength -
                  centerZ * SCENE.bowl.shakeOrbitStrength +
                  (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse) *
                  intensity,
              y: kickSpeed * mass * intensity,
              z:
                (bowlVelocityZ - velocity.z) * SCENE.bowl.shakeFollowStrength * mass +
                (centerZ * SCENE.bowl.shakeCenterStrength +
                  centerX * SCENE.bowl.shakeOrbitStrength +
                  (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse) *
                  intensity,
            },
            true,
          )
          const torque = SCENE.bowl.shakeTorqueImpulse * intensity
          entry.body.applyTorqueImpulse(
            {
              x: (this.random.next() - 0.5) * torque,
              y: (this.random.next() - 0.5) * torque,
              z: (this.random.next() - 0.5) * torque,
            },
            true,
          )
        })
      }
      return
    }
    if (this.phase !== 'pouring') return
    const elapsed = time - this.pourStartedAt
    const progress = Math.min(1, elapsed / SCENE.bowl.tiltDurationMs)
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
    const angle =
      THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection * eased
    const position = tiltedBowlPosition(eased, angle)
    this.bowlGroup.position.set(position.x, position.y, position.z)
    this.bowlGroup.rotation.set(0, 0, angle)
    if (progress >= 1) this.updateBowlExit(time)
    if (this.diceReleased) return
    if (progress >= SCENE.bowl.releaseTiltProgress) {
      this.releaseFromBowl()
      return
    }
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    this.bowlBody.setNextKinematicTranslation(position)
    this.bowlBody.setNextKinematicRotation(rotation)
  }

  private detectTrajectoryImpacts(
    from: DiceTrajectoryFrame,
    to: DiceTrajectoryFrame,
    time: number,
  ) {
    const span = to.atSeconds - from.atSeconds
    if (span <= 0) return
    this.entries.forEach((entry, index) => {
      if (this.held[entry.index]) return
      const fromPose = from.poses[index]
      const toPose = to.poses[index]
      if (!fromPose || !toPose) return
      const verticalSpeed = (toPose.position.y - fromPose.position.y) / span
      if (verticalSpeed < -0.8) this.fallingDice[entry.index] = true
      if (
        this.fallingDice[entry.index] &&
        verticalSpeed > 0.45 &&
        time - (this.lastImpactAt[entry.index] ?? 0) >= 80
      ) {
        this.lastImpactAt[entry.index] = time
        this.fallingDice[entry.index] = false
        this.callbacks.onDiceImpact?.(entry.index, Math.min(1, verticalSpeed / 4))
      }
    })
  }

  private currentShakeIntensity(time: number) {
    if (!this.motionFollow) return 1
    if (this.shakeEnergy <= 0) return 0
    const decayed =
      this.shakeEnergy * Math.exp(-(time - this.lastPulseAt) / SCENE.bowl.followDecayMs)
    return decayed < SCENE.bowl.followMinIntensity ? 0 : decayed
  }

  private startLayoutTransition() {
    this.layoutAnimating = true
    this.layoutStartedAt = performance.now()
    this.cameraHorizontal = resultCameraWidth()
    this.bowlGroup.visible = false
    this.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)
    this.layoutEntries = prepareLayoutEntries(
      this.entries,
      this.held,
      this.heldOrder,
      this.committedDice,
      this.keepAll,
    )
    this.resize()
    this.invalidate()
  }

  private updateLayoutTransition(time: number) {
    const progress = Math.min(1, (time - this.layoutStartedAt) / SCENE.keepSlots.moveDurationMs)
    updateLayoutEntries(this.layoutEntries, progress)
    if (progress >= 1) this.layoutAnimating = false
  }

  private releaseFromBowl() {
    if (this.diceReleased) return
    this.diceReleased = true
    this.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
    const active = this.entries.filter((entry) => !this.held[entry.index])
    active.forEach((entry, index) => {
      entry.enteredTray = false
      const fan = index - (active.length - 1) / 2
      const force = CONFIG.defaults.throwForce
      const velocity = entry.body.linvel()
      const targetX =
        (SCENE.bowl.spillMinimumSpeed + this.random.next() * SCENE.bowl.spillRandomSpeed) *
        force *
        SCENE.bowl.spillForceMultiplier *
        SCENE.bowl.spillDirectionX
      entry.body.setLinvel(
        {
          x: targetX,
          y: Math.max(velocity.y * 0.2, SCENE.bowl.spillLiftSpeed * force),
          z:
            fan * SCENE.bowl.spillFanSpeed * force +
            (this.random.next() - 0.5) * SCENE.bowl.spillRandomZ,
        },
        true,
      )
      const angular = entry.body.angvel()
      entry.body.setAngvel(
        {
          x: angular.x * 0.4,
          y: angular.y * 0.4,
          z: angular.z * 0.4,
        },
        true,
      )
    })
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
    this.entries.forEach((entry) => {
      if (this.held[entry.index]) return
      entry.visualOffset.copy(
        cubeAlignmentOffset(request.targetDice[entry.index], trajectory.naturalDice[entry.index]),
      )
      entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    })
  }

  private updateTrajectory(time: number) {
    const trajectory = this.trajectory
    if (!trajectory) return
    const elapsed = Math.min(
      trajectory.durationSeconds,
      Math.max(0, (time - this.trajectoryStartedAt) / 1000),
    )
    while (this.trajectoryFrameIndex + 1 < trajectory.frames.length) {
      const next = trajectory.frames[this.trajectoryFrameIndex + 1]
      if (!next || next.atSeconds > elapsed) break
      this.trajectoryFrameIndex += 1
    }
    const from = trajectory.frames[this.trajectoryFrameIndex]
    const to =
      trajectory.frames[Math.min(this.trajectoryFrameIndex + 1, trajectory.frames.length - 1)]
    if (!from || !to) return
    const span = to.atSeconds - from.atSeconds
    const progress = span > 0 ? (elapsed - from.atSeconds) / span : 0
    this.detectTrajectoryImpacts(from, to, time)
    this.entries.forEach((entry, index) => {
      if (this.held[entry.index]) return
      const fromPose = from.poses[index]
      const toPose = to.poses[index]
      if (!fromPose || !toPose) return
      entry.mesh.position.set(
        THREE.MathUtils.lerp(fromPose.position.x, toPose.position.x, progress),
        THREE.MathUtils.lerp(fromPose.position.y, toPose.position.y, progress),
        THREE.MathUtils.lerp(fromPose.position.z, toPose.position.z, progress),
      )
      entry.mesh.quaternion
        .set(fromPose.rotation.x, fromPose.rotation.y, fromPose.rotation.z, fromPose.rotation.w)
        .slerp(
          new THREE.Quaternion(
            toPose.rotation.x,
            toPose.rotation.y,
            toPose.rotation.z,
            toPose.rotation.w,
          ),
          progress,
        )
        .multiply(entry.visualOffset)
    })
    if (elapsed < trajectory.durationSeconds) return
    this.entries.forEach((entry) => {
      if (this.held[entry.index]) return
      entry.body.setTranslation(entry.mesh.position, true)
      entry.body.setRotation(entry.mesh.quaternion, true)
      entry.visualOffset.identity()
    })
    this.trajectory = null
    this.startResultAlignment(time)
  }

  private startResultAlignment(time: number) {
    if (!this.request) return
    this.phase = 'aligning'
    this.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    this.settledDice = [...this.request.targetDice]
    this.alignmentEntries = prepareAlignmentEntries(
      this.entries,
      this.held,
      this.heldOrder,
      this.settledDice,
      this.keepAll,
    )
    positionKeepSlots(
      this.keepSlots,
      Math.min(this.heldOrder.length, this.occupiedKeepSlots()),
      this.keepSlotMaterials,
    )
  }

  private updateResultAlignment(time: number) {
    const progress = Math.min(1, (time - this.alignmentStartedAt) / SCENE.alignment.durationMs)
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
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
    if (!this.bowlGroup.visible) return
    const progress = Math.min(1, (time - this.bowlExitStartedAt) / SCENE.bowl.exitDurationMs)
    const eased = 1 - (1 - progress) ** 3
    const angle = THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection
    const tipped = tiltedBowlPosition(1, angle)
    this.bowlGroup.position.set(
      tipped.x + SCENE.bowl.spillPushTravelX + eased * SCENE.bowl.exitTravelX,
      tipped.y + eased * SCENE.bowl.exitLiftY,
      tipped.z,
    )
    if (progress >= 1) this.bowlGroup.visible = false
  }

  private pick(event: PointerEvent) {
    if (this.phase !== 'idle') return
    const index = pickDie(event, this.renderer, this.camera, this.entries)
    if (index !== null) this.callbacks.onHeldToggle(index)
  }

  private queueSettledResize() {
    if (!this.active) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const delta = Math.max(
      Math.abs(width - this.appliedWidth),
      Math.abs(height - this.appliedHeight),
    )
    if (delta === 0) return
    if (delta <= RESIZE_SETTLE_THRESHOLD_PX && this.resizeTimer === null) {
      this.resize()
      return
    }
    this.callbacks.onResizeChange(true)
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      if (!this.active) return
      this.resizeTimer = null
      this.resize()
      this.lastTime = performance.now()
      this.accumulator = 0
      this.callbacks.onResizeChange(false)
    }, 180)
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

  private randomQuaternion() {
    const theta1 = 2 * Math.PI * this.random.next()
    const theta2 = 2 * Math.PI * this.random.next()
    const x0 = this.random.next()
    const r1 = Math.sqrt(1 - x0)
    const r2 = Math.sqrt(x0)
    return new THREE.Quaternion(
      r1 * Math.sin(theta1),
      r1 * Math.cos(theta1),
      r2 * Math.sin(theta2),
      r2 * Math.cos(theta2),
    )
  }
}
