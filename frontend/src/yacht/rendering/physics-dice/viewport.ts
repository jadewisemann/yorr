import type * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'

/**
 * 직교 카메라의 시야 계산과 품질 프리셋 적용.
 *
 * 왜 분리했나: 이 값들은 컨테이너 크기와 `cameraHorizontal`만으로 정해진다. World의 상태
 * 기계와 섞여 있으면 리사이즈 규칙을 바꿀 때마다 씬 전체를 읽어야 한다.
 */

const SCENE = PHYSICS_DICE_CONFIG.scene

export interface HalfExtents {
  horizontal: number
  vertical: number
}

/** 컨테이너 종횡비와 원하는 수평 반폭으로 카메라의 반폭·반높이를 정한다. */
export function cameraHalfExtents(aspect: number, cameraHorizontal: number): HalfExtents {
  let vertical = Math.max(
    SCENE.camera.minHalfHeight,
    Math.min(cameraHorizontal / aspect, SCENE.camera.maxHalfHeight),
  )
  let horizontal = vertical * aspect
  if (horizontal < SCENE.camera.minHalfWidth) {
    horizontal = SCENE.camera.minHalfWidth
    vertical = horizontal / aspect
  }
  return { horizontal, vertical }
}

/** 계산된 반폭·반높이를 직교 카메라에 적용한다. */
export function applyHalfExtents(camera: THREE.OrthographicCamera, extents: HalfExtents) {
  camera.left = -extents.horizontal
  camera.right = extents.horizontal
  camera.top = extents.vertical
  camera.bottom = -extents.vertical
  camera.updateProjectionMatrix()
}

/** 품질 프리셋(픽셀 비율·그림자)을 렌더러와 키 라이트에 적용한다. */
export function applyQualityPreset(
  quality: keyof typeof PHYSICS_DICE_CONFIG.quality,
  renderer: THREE.WebGLRenderer,
  keyLight: THREE.DirectionalLight,
) {
  const preset = PHYSICS_DICE_CONFIG.quality[quality]
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio))
  renderer.shadowMap.enabled = preset.shadows
  keyLight.castShadow = preset.shadows
  if (preset.shadowSize > 0) keyLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize)
  keyLight.shadow.map?.dispose()
}

/** 리사이즈가 잦은 구간(모바일 주소창·회전)에서 매 프레임 다시 그리지 않게 묶어 주는 장치. */
export interface ResizeSchedulerHost {
  /** 지금 크기(px). */
  measure(): { height: number; width: number }
  /** 아직 살아 있는가 — 해제 뒤 타이머가 깨어나도 아무것도 하지 않게. */
  isActive(): boolean
  /** 실제 리사이즈. */
  resize(): void
  /** 리사이즈가 끝난 뒤 시뮬레이션 시계를 다시 맞춘다. */
  resetClock(): void
  /** 큰 변화로 잠시 멈출 때 화면에 알린다. */
  setBusy(busy: boolean): void
}

/** 이 정도 이하의 변화는 기다리지 않고 바로 반영한다(스크롤바·1px 흔들림). */
const SETTLE_THRESHOLD_PX = 120
const SETTLE_DELAY_MS = 180

export class ResizeScheduler {
  private appliedHeight = 0
  private appliedWidth = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly host: ResizeSchedulerHost) {}

  /** 컨테이너 크기가 바뀌었다는 관측을 받는다. */
  observe(): void {
    if (!this.host.isActive()) return
    const { height, width } = this.host.measure()
    const delta = Math.max(
      Math.abs(width - this.appliedWidth),
      Math.abs(height - this.appliedHeight),
    )
    if (delta === 0) return
    if (delta <= SETTLE_THRESHOLD_PX && this.timer === null) {
      this.host.resize()
      return
    }
    this.host.setBusy(true)
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.host.isActive()) return
      this.timer = null
      this.host.resize()
      this.host.resetClock()
      this.host.setBusy(false)
    }, SETTLE_DELAY_MS)
  }

  /** 실제로 적용된 크기를 기록한다 — 다음 관측의 기준. */
  record(width: number, height: number): void {
    this.appliedWidth = width
    this.appliedHeight = height
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
