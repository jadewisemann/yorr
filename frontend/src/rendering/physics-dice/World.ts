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
import { quaternionForTopValue, topFaceFromQuaternion } from './model'
import { createPhysicsDiceRandom, type PhysicsDiceRandom } from './random'
import { cubeAlignmentOffset, isBodySettled, predictNaturalDice } from './remap'
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
/** 보정 없음. 예측 실패 시 지난 굴림의 오프셋을 지우는 데 쓴다. */
const IDENTITY_OFFSET = new THREE.Quaternion()
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
let rapierReady: Promise<typeof RAPIER> | undefined

/** 이 폭 이하의 컨테이너 크기 변화는 "3D 조정 중" 멈춤 없이 즉시 반영한다.
 *  배너·힌트 같은 UI 등장이 만드는 수십 px 변화까지 매번 멈추면 게임이 자꾸 끊긴다. */
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
  private frameId: number | null = null
  private geometries!: PhysicsDiceGeometries
  private held: PhysicsHeldDice = NO_HELD
  private heldOrder: PhysicsDiceIndex[] = []
  private keyLight!: THREE.DirectionalLight
  private keepSlotMaterials: THREE.Material[] = []
  private keepSlots: THREE.Group[] = []
  private lastPulseAt = 0
  private lastShakeKick = 0
  private lastTime = 0
  private layoutAnimating = false
  private layoutEntries: LayoutEntry[] = []
  private layoutStartedAt = 0
  private lineUpAll = false
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
  private rollStartedAt = 0
  private scene!: THREE.Scene
  private settledDice: PhysicsDiceSet | null = null
  private shakeEnergy = 0
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
    this.shakeEnergy = this.motionFollow ? SCENE.bowl.followStartEnergy : 0
    this.lastPulseAt = this.shakeStartedAt
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

  /**
   * 킵된 주사위까지 결과 줄에 함께 눕힐지. 마지막 굴림이 시작되는 순간 켜고, 그 굴림의 정렬과
   * 이후 idle 배치가 같은 규칙을 쓰게 한다 — 정렬 직후 킵 주사위가 레일로 되돌아가면 안 된다.
   * 굴리는 중(idle이 아닐 때)에는 값만 갈아두고, 진행 중인 애니메이션은 건드리지 않는다.
   */
  setLineUpAll(enabled: boolean) {
    if (this.lineUpAll === enabled) return
    this.lineUpAll = enabled
    if (!this.world || this.phase !== 'idle' || this.layoutAnimating) return
    this.lineUpDice()
    this.invalidate()
  }

  setMotionFollow(enabled: boolean) {
    this.motionFollow = enabled
  }

  /**
   * 실제 기기 흔들림 펄스 주입 — follow 모드에서 사발 진동 세기의 유일한 에너지원.
   * 펄스가 끊기면 세기가 지수 감쇠해 사발과 주사위가 저절로 잦아든다.
   */
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
    this.entries.forEach((entry) => {
      if (this.held[entry.index]) return
      // 세게 흔들수록 높이 튀긴다 — 목표 높이에서 역산해 중력과 무관하게 같은 그림을 만든다.
      const liftSpeed = Math.sqrt(
        2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.25 + 0.75 * clamped),
      )
      entry.body.applyImpulse(
        {
          x: sign * SCENE.bowl.followPulseImpulse * (0.5 + clamped) * mass,
          y: liftSpeed * mass,
          z: (this.random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse,
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
    this.rollStartedAt = this.pourStartedAt
    // 기울이기가 끝나면 곧바로 퇴장한다 — 던져진 주사위 위에 사발이 머물러
    // 시각적으로 겹치지 않게, 정렬 단계를 기다리지 않는다.
    this.bowlExitStartedAt = this.pourStartedAt + SCENE.bowl.tiltDurationMs
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
    // 가로를 다 담되 세로는 maxHalfHeight에서 멈춘다 — 세로로 긴 화면(모바일)에서
    // 빈 바닥을 늘리는 대신 좌우 가장자리(그릇 진입로)를 잘라 주사위를 크게 보여준다.
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
    placeDice(this.entries, this.held, this.heldOrder, this.committedDice, this.lineUpAll)
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
    this.resize()
  }

  /** 레일 바를 악센트로 칠할 슬롯 수. 다섯 개를 한 줄로 눕히면 레일은 비어 있다. */
  private occupiedKeepSlots() {
    return this.lineUpAll ? 0 : this.heldOrder.length
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
      // follow 모드는 기기 흔들림 펄스에서 감쇠 중인 세기(0~1)를 쓰고, tap 모드는 항상 1.
      const intensity = this.currentShakeIntensity(time)
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
        this.entries.forEach((entry) => {
          if (this.held[entry.index]) return
          const position = entry.body.translation()
          const velocity = entry.body.linvel()
          const centerX = x - position.x
          const centerZ = z - position.z
          const mass = CONFIG.defaults.mass
          // 바닥 근처 주사위만 목표 높이 √(2gh)로 튀긴다 — 임펄스 상수는 중력을 올리면
          // 홉이 죽지만, 높이로 지정하면 중력과 무관하게 같은 그림이 나온다.
          const kickRandom = this.random.next()
          const altitude = position.y - SCENE.bowl.hoverY
          const kickSpeed =
            altitude < SCENE.bowl.shakeKickAltitude
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
    // 기울이는 동안 사발이 start→pour로 미끄러진다(tiltedBowlPosition이 보간) —
    // 쏟으면서 오른쪽으로 빠져나가는 한 동작이고, 퇴장 애니메이션이 그대로 이어받는다.
    const elapsed = time - this.pourStartedAt
    const progress = Math.min(1, elapsed / SCENE.bowl.tiltDurationMs)
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
    const angle =
      THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection * eased
    const position = tiltedBowlPosition(eased, angle)
    // 비주얼은 던진 뒤에도 기울이기를 끝까지 이어간다 — 사발이 뒤집히는 그림 위로
    // 주사위가 터져 나온다. 기울이기가 끝나면 곧바로 퇴장 애니메이션이 이어받는다.
    this.bowlGroup.position.set(position.x, position.y, position.z)
    this.bowlGroup.rotation.set(0, 0, angle)
    if (progress >= 1) this.updateBowlExit(time)
    if (this.diceReleased) return
    // 뒤집어지는 순간(releaseTiltProgress)에 주사위를 던지고 사발 바디를 치운다 —
    // 이후 사발은 순수 비주얼이고 주사위와 물리적으로 상호작용하지 않는다.
    // (릴리스 뒤 바디를 움직이지 않는 것은 예측 복제 시뮬과의 결정론 조건이기도 하다.)
    if (progress >= SCENE.bowl.releaseTiltProgress) {
      this.releaseFromBowl()
      return
    }
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    this.bowlBody.setNextKinematicTranslation(position)
    this.bowlBody.setNextKinematicRotation(rotation)
  }

  /** follow 모드에서 마지막 펄스 이후 지수 감쇠한 흔들림 세기(0~1). tap 모드는 항상 1. */
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
      this.lineUpAll,
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
    this.entries.forEach((entry) => {
      if (this.held[entry.index]) return
      // 예측이 실패하면 오프셋을 비운다. 그대로 두면 지난 굴림의 보정이 남아 엉뚱한 면이 보인다.
      entry.visualOffset.copy(
        natural
          ? cubeAlignmentOffset(request.targetDice[entry.index], natural[entry.index])
          : IDENTITY_OFFSET,
      )
    })
  }

  /**
   * 멈춘 주사위의 표시 면을 목표값으로 다시 맞춘다.
   * <p>
   * {@link planVisualRemap}의 예측은 월드를 스냅샷 복제해 미리 굴려 본 결과이고, 그 재시뮬레이션은
   * 실제 진행과 완전히 같지 않다. 주사위 튐은 카오스적이어서 아주 작은 차이도 다른 면으로 갈리므로,
   * 예측이 어긋난 주사위는 바닥에 멈춘 뒤에도 잘못된 눈을 보여줬다(결과 정렬 단계에서야 목표값으로
   * 바뀌어 "눈금이 갑자기 바뀌는" 것으로 보였다).
   * <p>
   * 그래서 멈춘 주사위는 예측을 믿지 않고 <b>실제 자세에서</b> 오프셋을 다시 구한다. body 자세만 보고
   * 유도하므로 매 프레임 호출해도 결과가 같다(멱등). 아직 구르는 주사위는 건드리지 않는다 —
   * 매 프레임 다시 맞추면 회전이 어색해진다.
   */
  private correctSettledVisuals() {
    const request = this.request
    if (!request) return
    this.entries.forEach((entry) => {
      if (this.held[entry.index] || !isBodySettled(entry.body)) return
      entry.visualOffset.copy(
        cubeAlignmentOffset(
          request.targetDice[entry.index],
          topFaceFromQuaternion(entry.body.rotation()),
        ),
      )
    })
  }

  private checkSettled(time: number) {
    if (this.phase !== 'pouring' || !this.diceReleased) return
    // 멈춘 주사위는 최소 굴림 시간과 무관하게 곧바로 표시 면을 맞춘다 —
    // 멈춘 채 잘못된 눈을 보여주는 구간이 곧 이 버그였다.
    this.correctSettledVisuals()
    const elapsed = time - this.rollStartedAt
    if (elapsed < SCENE.settlement.minRollDurationMs) return
    const active = this.entries.filter((entry) => !this.held[entry.index])
    const physicallySettled = active.every((entry) => isBodySettled(entry.body))
    this.stableFrames = physicallySettled ? this.stableFrames + 1 : 0
    // 상한을 넘으면 아직 튀고 있어도 정렬로 넘어간다 — 안 그러면 굴림이 영원히 끝나지 않는다.
    const timedOut = elapsed >= SCENE.settlement.maxRollDurationMs
    if (this.stableFrames < SCENE.settlement.stableFrames && !timedOut) return
    this.startResultAlignment(time)
  }

  private startResultAlignment(time: number) {
    if (!this.request) return
    this.phase = 'aligning'
    this.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    // bowlExitStartedAt은 pour()가 이미 잡았다 — 퇴장은 기울이기 직후 시작해서
    // 대개 정렬 전에 끝나 있고, updateResultAlignment의 updateBowlExit은 no-op이 된다.
    this.settledDice = [...this.request.targetDice]
    this.alignmentEntries = prepareAlignmentEntries(
      this.entries,
      this.held,
      this.heldOrder,
      this.settledDice,
      this.lineUpAll,
    )
    // 레일이 비는 순간을 정렬 시작과 맞춘다 — 주사위가 줄로 떠난 뒤 악센트 바만 남으면 안 된다.
    positionKeepSlots(this.keepSlots, this.occupiedKeepSlots(), this.keepSlotMaterials)
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
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const delta = Math.max(
      Math.abs(width - this.appliedWidth),
      Math.abs(height - this.appliedHeight),
    )
    if (delta === 0) return
    // 소폭 변화는 즉시 카메라만 다시 맞춘다 — 오버레이·클록 리셋 없이 이어서 재생.
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
