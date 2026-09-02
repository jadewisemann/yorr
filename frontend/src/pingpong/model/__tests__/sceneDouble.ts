import type { FrameState } from '@/pingpong/domain/frameState'
import type { PingPongScene } from '@/pingpong/rendering/scene3d'

/**
 * 3D 무대의 대역. 훅 검사는 무엇이 그려졌는지가 아니라 **훅이 언제 무엇을 넘기는지**를
 * 보므로, 실제 WebGL 대신 넘어온 프레임을 그대로 쌓아 둔다.
 */
export interface FakeScene {
  disposed: boolean
  frames: FrameState[]
  resizes: Array<{ dpr: number; height: number; width: number }>
}

export const sceneControl = {
  /** 켜 두면 다음 `createScene`이 WebGL을 못 얻은 것처럼 던진다. */
  failing: false,
  scenes: [] as FakeScene[],
  reset() {
    sceneControl.failing = false
    sceneControl.scenes = []
  },
  last(): FakeScene {
    const scene = sceneControl.scenes.at(-1)
    if (!scene) throw new Error('무대가 아직 만들어지지 않았다')
    return scene
  },
}

export function createScene(_canvas: HTMLCanvasElement): PingPongScene {
  if (sceneControl.failing) throw new Error('WebGL 컨텍스트를 얻지 못했다')
  const fake: FakeScene = { disposed: false, frames: [], resizes: [] }
  sceneControl.scenes.push(fake)
  return {
    dispose: () => {
      fake.disposed = true
    },
    render: (frame) => void fake.frames.push(frame),
    resize: (width, height, dpr) => void fake.resizes.push({ dpr, height, width }),
    update: () => {},
  }
}
