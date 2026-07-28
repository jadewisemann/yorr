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
import { cubeAlignmentOffset, predictNaturalDice } from './remap'
import type { AlignmentEntry, DieEntry, LayoutEntry } from './runtimeTypes'
import { containDiceInBowl, containDiceInTray } from './safety'
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
  private floorMaterial!: THREE.MeshStandardMaterial
  private frameId: number | null = null
  private geometries!: PhysicsDiceGeometries
  private held: PhysicsHeldDice = NO_HELD
  private heldOrder: PhysicsDiceIndex[] = []
  private keyLight!: THREE.DirectionalLight
  private keepSlotMaterials: THREE.Material[] = []
  private keepSlots: THREE.Group[] = []
  private lastShakeKick = 0
  private lastTime = 0
  private layoutAnimating = false
  private layoutEntries: LayoutEntry[] = []
  private layoutStartedAt = 0
  private materials!: PhysicsDiceMaterials
  private phase: 'idle' | 'shaking' | 'pouring' | 'aligning' = 'idle'
  private playFieldMaterial!: THREE.MeshStandardMaterial
  private pointerHandler = (event: PointerEvent) => this.pick(event)
  private pourStartedAt = 0
  private quality: PhysicsDiceQuality
  private random: PhysicsDiceRandom = createPhysicsDiceRandom(0)
  private renderer!: THREE.WebGLRenderer
  private request: PhysicsDiceRollRequest | null = null
  private resizeObserver?: ResizeObserver
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private rollStartedAt = 0
  private scene!: THREE.Scene
  private settledDice: PhysicsDiceSet | null = null
  private shakeStartedAt = 0
  private stableFrames = 0
  private themeObserver?: MutationObserver
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
    this.accumulator = 0
    this.stableFrames = 0
    this.diceReleased = false
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
          x: (this.random.next() - 0.5) * 3,
          y: this.random.next() * 2,
          z: (this.random.next() - 0.5) * 3,
        },
        true,
      )
      entry.body.setAngvel(
        {
          x: (this.random.next() - 0.5) * 19,
          y: (this.random.next() - 0.5) * 19,
          z: (this.random.next() - 0.5) * 19,
        },
        true,
      )
      entry.body.wakeUp()
    })
    this.resize()
    this.invalidate()
  }

  pour() {
    if (this.phase !== 'shaking') return
    this.phase = 'pouring'
    this.pourStartedAt = performance.now()
    this.rollStartedAt = this.pourStartedAt
    this.stableFrames = 0
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
    const vertical = Math.max(this.cameraHorizontal / aspect, SCENE.camera.minHalfHeight)
    const horizontal = vertical * aspect
    this.camera.left = -horizontal
    this.camera.right = horizontal
    this.camera.top = vertical
    this.camera.bottom = -vertical
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    positionKeepSlots(this.keepSlots)
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
    placeDice(this.entries, this.held, this.heldOrder, this.committedDice)
    positionKeepSlots(this.keepSlots)
    this.resize()
  }

  private frame = (time: number) => {
    this.frameId = null
    if (!this.active) return
    const elapsed = Math.min(0.08, Math.max(0, (time - this.lastTime) / 1000))
    this.lastTime = time
    const simulating = this.phase === 'shaking' || this.phase === 'pouring'
    if (simulating) this.accumulator += elapsed
    this.updateBowl(time)
    const rollingEntries = this.entries.filter((entry) => !this.held[entry.index])
    while (simulating && this.accumulator >= this.world.timestep) {
      this.world.step()
      if (this.phase === 'shaking') containDiceInBowl(this.entries, this.held, this.bowlBody)
      if (this.phase === 'pouring' && this.diceReleased) containDiceInTray(rollingEntries)
      this.accumulator -= this.world.timestep
    }
    if (this.phase === 'aligning') this.updateResultAlignment(time)
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
    this.checkSettled(time)
    this.renderer.render(this.scene, this.camera)
    if (this.phase !== 'idle' || this.layoutAnimating) this.invalidate()
  }

  private updateBowl(time: number) {
    if (this.phase === 'shaking') {
      const elapsed = (time - this.shakeStartedAt) / 1000
      const x = SCENE.bowl.startX + Math.sin(elapsed * 15) * SCENE.bowl.shakeOffsetX
      const z = SCENE.bowl.startZ + Math.sin(elapsed * 19 + 0.8) * SCENE.bowl.shakeOffsetZ
      const bowlVelocityX = Math.cos(elapsed * 15) * 15 * SCENE.bowl.shakeOffsetX
      const bowlVelocityZ = Math.cos(elapsed * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ
      const yaw = Math.sin(elapsed * 12) * SCENE.bowl.shakeYaw
      const lift = Math.abs(Math.sin(elapsed * 11)) * 0.025
      const rotation = new THREE.Quaternion().setFromAxisAngle(UP, yaw)
      this.bowlBody.setNextKinematicTranslation({ x, y: SCENE.bowl.hoverY + lift, z })
      this.bowlBody.setNextKinematicRotation(rotation)
      this.bowlGroup.position.set(x, SCENE.bowl.hoverY + lift, z)
      this.bowlGroup.rotation.y = yaw
      if (time - this.lastShakeKick >= SCENE.bowl.shakeIntervalMs) {
        this.lastShakeKick = time
        this.entries.forEach((entry) => {
          if (this.held[entry.index]) return
          const position = entry.body.translation()
          const velocity = entry.body.linvel()
          const centerX = x - position.x
          const centerZ = z - position.z
          const mass = CONFIG.defaults.mass
          entry.body.applyImpulse(
            {
              x:
                (bowlVelocityX - velocity.x) * SCENE.bowl.shakeFollowStrength * mass +
                centerX * SCENE.bowl.shakeCenterStrength -
                centerZ * SCENE.bowl.shakeOrbitStrength +
                (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse,
              y: SCENE.bowl.shakeLiftImpulse + this.random.next() * SCENE.bowl.shakeRandomImpulse,
              z:
                (bowlVelocityZ - velocity.z) * SCENE.bowl.shakeFollowStrength * mass +
                centerZ * SCENE.bowl.shakeCenterStrength +
                centerX * SCENE.bowl.shakeOrbitStrength +
                (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse,
            },
            true,
          )
          entry.body.applyTorqueImpulse(
            {
              x: (this.random.next() - 0.5) * 0.55,
              y: (this.random.next() - 0.5) * 0.55,
              z: (this.random.next() - 0.5) * 0.55,
            },
            true,
          )
        })
      }
      return
    }
    if (this.phase !== 'pouring') return
    // 쏟은 뒤에는 그릇 바디를 더 움직이지 않는다 — 예측 복제 시뮬과 실제 진행이 같은
    // 월드 상태를 보게 하기 위한 결정론 조건 (그릇은 이미 기울인 마지막 포즈로 고정).
    if (this.diceReleased) return
    const elapsed = time - this.pourStartedAt
    const progress = Math.min(1, elapsed / SCENE.bowl.tiltDurationMs)
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
    const angle =
      THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection * eased
    const position = tiltedBowlPosition(eased, angle)
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    this.bowlBody.setNextKinematicTranslation(position)
    this.bowlBody.setNextKinematicRotation(rotation)
    this.bowlGroup.position.set(position.x, position.y, position.z)
    this.bowlGroup.rotation.set(0, 0, angle)
    if (progress >= 1 && elapsed >= SCENE.bowl.tiltDurationMs + SCENE.bowl.spillPushDurationMs) {
      this.releaseFromBowl()
    }
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
      const inheritedX = velocity.x * 0.7
      entry.body.setLinvel(
        {
          x:
            SCENE.bowl.spillDirectionX < 0
              ? Math.min(inheritedX, targetX)
              : Math.max(inheritedX, targetX),
          y: Math.max(velocity.y * 0.7, SCENE.bowl.spillLiftSpeed * force),
          z:
            velocity.z * 0.65 +
            fan * SCENE.bowl.spillFanSpeed * force +
            (this.random.next() - 0.5) * SCENE.bowl.spillRandomZ,
        },
        true,
      )
      const impulse =
        (SCENE.bowl.spillSideImpulse +
          (this.random.next() - 0.5) * SCENE.bowl.spillSideImpulseVariance) *
        CONFIG.defaults.mass *
        force
      entry.body.applyImpulse({ x: impulse * SCENE.bowl.spillDirectionX, y: 0, z: 0 }, true)
      entry.body.applyTorqueImpulse(
        {
          x: (this.random.next() - 0.5) * SCENE.bowl.spillTorque,
          y: (this.random.next() - 0.5) * SCENE.bowl.spillTorque,
          z: (this.random.next() - 0.5) * SCENE.bowl.spillTorque,
        },
        true,
      )
    })
    this.planVisualRemap()
  }

  /**
   * 쏟아짐 직후 복제 시뮬로 자연 결과를 예측하고, 주사위가 공중에서 빠르게 회전하는
   * 지금 시점에 표시 면을 목표값으로 바꿔 끼운다. 예측이 실패해도 정렬 단계가
   * targetDice로 수렴하므로 연출 품질만 떨어질 뿐 결과는 항상 정확하다.
   */
  private planVisualRemap() {
    const request = this.request
    if (!request) return
    const natural = predictNaturalDice(this.world, this.entries, this.held)
    if (!natural) return
    this.entries.forEach((entry) => {
      if (this.held[entry.index]) return
      entry.visualOffset.copy(
        cubeAlignmentOffset(request.targetDice[entry.index], natural[entry.index]),
      )
    })
  }

  private checkSettled(time: number) {
    if (
      this.phase !== 'pouring' ||
      !this.diceReleased ||
      time - this.rollStartedAt < SCENE.settlement.minRollDurationMs
    ) {
      return
    }
    const active = this.entries.filter((entry) => !this.held[entry.index])
    const physicallySettled = active.every((entry) => {
      const linear = entry.body.linvel()
      const angular = entry.body.angvel()
      return (
        entry.body.isSleeping() ||
        (Math.hypot(linear.x, linear.y, linear.z) < SCENE.settlement.linearSpeed &&
          Math.hypot(angular.x, angular.y, angular.z) < SCENE.settlement.angularSpeed)
      )
    })
    this.stableFrames = physicallySettled ? this.stableFrames + 1 : 0
    if (this.stableFrames < SCENE.settlement.stableFrames) return
    this.startResultAlignment(time)
  }

  private startResultAlignment(time: number) {
    if (!this.request) return
    this.phase = 'aligning'
    this.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    this.bowlExitStartedAt = time
    this.settledDice = this.request.targetDice
    this.alignmentEntries = prepareAlignmentEntries(
      this.entries,
      this.held,
      this.heldOrder,
      this.settledDice,
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
    // 오프셋 베이크: 정렬이 body를 목표값의 canonical 회전으로 고정했으므로
    // 이후 idle 동기화(body × offset)가 어긋나지 않게 오프셋을 소거한다.
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
    this.callbacks.onResizeChange(true)
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      if (!this.active) return
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
      floorMaterial: this.floorMaterial,
      geometries: this.geometries,
      keepSlotMaterials: this.keepSlotMaterials,
      materials: this.materials,
      playFieldMaterial: this.playFieldMaterial,
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
