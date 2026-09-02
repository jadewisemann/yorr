import { vi } from 'vitest'
import type {
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'

/**
 * 3D 월드의 대역과 그 적재 시점을 손에 쥐는 손잡이.
 *
 * jsdom에는 WebGL이 없고, 이 훅이 맡는 것은 주사위가 어떻게 굴러가는지가 아니라
 * **언제 무엇을 월드에 넘기고 언제 손을 떼는가**다. 특히 적재가 끝나기 전에 화면이
 * 사라지는 갈래는 promise를 직접 붙잡고 있어야 재현된다.
 */
export const worldControl = {
  /** 만들어진 월드들. 화면 하나당 하나다. */
  instances: [] as FakeWorld[],
  /** 적재를 실패시킬 사유. null이면 성공한다. */
  loadFailure: null as unknown,
  /** 손으로 풀어 주는 적재 관문. null이면 곧바로 끝난다. */
  gate: null as { resolve: () => void; promise: Promise<void> } | null,
  reset() {
    worldControl.instances.length = 0
    worldControl.loadFailure = null
    worldControl.gate = null
  },
  /** 적재를 붙잡아 둔다. 반환된 함수를 불러야 다음으로 넘어간다. */
  hold() {
    let release = () => {}
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    worldControl.gate = { promise, resolve: release }
    return release
  },
  last(): FakeWorld {
    const world = worldControl.instances.at(-1)
    if (!world) throw new Error('월드가 만들어지지 않았다')
    return world
  },
}

export class FakeWorld {
  readonly calls: string[] = []
  destroyed = false

  constructor(
    readonly options: {
      callbacks: PhysicsDiceWorldCallbacks
      container: HTMLElement
      quality: PhysicsDiceQuality
    },
  ) {
    worldControl.instances.push(this)
  }

  async init() {
    if (worldControl.gate) await worldControl.gate.promise
  }

  applyQuality(quality: PhysicsDiceQuality) {
    this.calls.push(`quality:${quality}`)
  }
  setMotionFollow(on: boolean) {
    this.calls.push(`follow:${on}`)
  }
  setKeepAll(on: boolean) {
    this.calls.push(`keepAll:${on}`)
  }
  syncCommittedDice(dice: PhysicsDiceSet | null, held: PhysicsHeldDice) {
    this.calls.push(`sync:${dice?.join('') ?? '-'}:${held.filter(Boolean).length}`)
  }
  startRoll(request: PhysicsDiceRollRequest) {
    this.calls.push(`start:${request.requestId}`)
  }
  pour() {
    this.calls.push('pour')
  }
  applyShakePulse(direction: 'left' | 'right', strength: number) {
    this.calls.push(`pulse:${direction}:${strength}`)
  }
  destroy() {
    this.destroyed = true
    this.calls.push('destroy')
  }
}

export const loadPhysicsDiceWorld = async () => {
  if (worldControl.loadFailure) throw worldControl.loadFailure
  return { PhysicsDiceWorld: FakeWorld }
}

export const prefetchPhysicsDiceWorld = vi.fn()
