import type * as THREE from 'three'
import { vi } from 'vitest'

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

export async function threeWithFakeRenderer(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof THREE
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  readonly targets: Element[] = []

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  static reset() {
    FakeResizeObserver.instances = []
  }

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

export function stubCanvas2dContext() {
  const calls: string[] = []
  const gradient = () => ({ addColorStop: () => {} })
  const context = {
    arc: (...args: number[]) => calls.push(`arc(${args.join(',')})`),
    beginPath: () => calls.push('beginPath'),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    fill: () => calls.push('fill'),
    fillRect: (...args: number[]) => calls.push(`fillRect(${args.join(',')})`),
    fillStyle: '' as unknown,
  }
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return { calls, restore: () => spy.mockRestore() }
}
