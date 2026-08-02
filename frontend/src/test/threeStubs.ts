import type * as THREE from 'three'
import { vi } from 'vitest'

/**
 * jsdom에는 WebGL 컨텍스트가 없어 `new THREE.WebGLRenderer()`가 만들어지지 않는다.
 * 이 대역은 렌더러가 "무엇을 요구받았는지"(픽셀 비율·크기·그림자·render 호출)만 기록해서
 * 장면 구성·카메라·물리 코드를 실제로 돌릴 수 있게 한다.
 */
export class FakeWebGLRenderer {
  static instances: FakeWebGLRenderer[] = []

  readonly domElement = document.createElement('canvas')
  readonly parameters: THREE.WebGLRendererParameters
  readonly renderLists = { dispose: vi.fn() }
  readonly renders: Array<{ camera: unknown; scene: unknown }> = []
  readonly shadowMap = { autoUpdate: true, enabled: false, type: 0 }

  animationLoop: (() => void) | null = null
  contextLossCount = 0
  disposeCount = 0
  height = 0
  outputColorSpace = ''
  pixelRatio = 1
  toneMapping = 0
  toneMappingExposure = 1
  width = 0

  constructor(parameters: THREE.WebGLRendererParameters = {}) {
    this.parameters = parameters
    FakeWebGLRenderer.instances.push(this)
    // pickDie가 포인터 좌표를 NDC로 바꿀 때 캔버스 사각형이 필요하다.
    this.domElement.getBoundingClientRect = () =>
      ({
        bottom: this.height,
        height: this.height,
        left: 0,
        right: this.width,
        top: 0,
        width: this.width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  }

  static reset() {
    FakeWebGLRenderer.instances = []
  }

  static get last() {
    return FakeWebGLRenderer.instances.at(-1)
  }

  setPixelRatio(value: number) {
    this.pixelRatio = value
  }

  getPixelRatio() {
    return this.pixelRatio
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  setAnimationLoop(loop: (() => void) | null) {
    this.animationLoop = loop
  }

  render(scene: unknown, camera: unknown) {
    // 실제 WebGLRenderer가 렌더 직전에 하는 일 — 이걸 빼면 레이캐스팅이 옛 행렬을 본다.
    asObject3D(camera)?.updateMatrixWorld(true)
    asObject3D(scene)?.updateMatrixWorld(true)
    this.renders.push({ camera, scene })
  }

  dispose() {
    this.disposeCount += 1
  }

  forceContextLoss() {
    this.contextLossCount += 1
  }
}

function asObject3D(value: unknown): { updateMatrixWorld: (force?: boolean) => void } | null {
  const candidate = value as { updateMatrixWorld?: (force?: boolean) => void } | null
  return typeof candidate?.updateMatrixWorld === 'function'
    ? (candidate as { updateMatrixWorld: (force?: boolean) => void })
    : null
}

/** `vi.mock('three', threeWithFakeRenderer)` 형태로 쓴다 — WebGLRenderer만 대역으로 바꾼다. */
export async function threeWithFakeRenderer(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof THREE
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
}

/** ResizeObserver 대역 — jsdom에 없고, 테스트가 리사이즈 순간을 직접 지정해야 한다. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  readonly targets: Element[] = []

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  static reset() {
    FakeResizeObserver.instances = []
  }

  /** 관찰 중인 모든 observer에 리사이즈 통지를 보낸다. */
  static emitAll() {
    for (const observer of FakeResizeObserver.instances) observer.callback()
  }

  observe(target: Element) {
    this.targets.push(target)
  }

  unobserve() {}

  disconnect() {
    this.targets.length = 0
  }
}

/** clientWidth/clientHeight를 실제로 보고하는 컨테이너 — jsdom 기본값은 항상 0이다. */
export function createSizedContainer(width: number, height: number) {
  const container = document.createElement('div')
  const size = { height, width }
  Object.defineProperty(container, 'clientWidth', { get: () => size.width })
  Object.defineProperty(container, 'clientHeight', { get: () => size.height })
  document.body.appendChild(container)
  return {
    container,
    resizeTo(nextWidth: number, nextHeight: number) {
      size.width = nextWidth
      size.height = nextHeight
    },
  }
}

/** CanvasRenderingContext2D 대역 — jsdom은 getContext('2d')로 null을 준다. */
export function stubCanvas2dContext() {
  const calls: string[] = []
  const context = {
    arc: (...args: number[]) => calls.push(`arc(${args.join(',')})`),
    beginPath: () => calls.push('beginPath'),
    fill: () => calls.push('fill'),
    fillRect: (...args: number[]) => calls.push(`fillRect(${args.join(',')})`),
    fillStyle: '',
  }
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return { calls, restore: () => spy.mockRestore() }
}
