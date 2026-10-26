import { createScene, type PingPongScene } from './scene3d'

/** 돌고 있는 무대. `stop`은 루프·관찰자·WebGL 자원을 이 순서로 걷는다. */
export interface SceneLoop {
  scene: PingPongScene
  stop: () => void
}

/**
 * 캔버스에 3D 무대를 세우고 크기를 맞춘 뒤 매 프레임 `draw`를 부른다.
 *
 * 세 탁구 화면(서버 판정·로컬·파티 대시보드)이 같은 골격을 쓴다 — 무대를 만들고, 캔버스
 * 크기를 따라가고, rAF로 그린다. 무엇을 그릴지만 다르다. WebGL을 못 만들면 `createScene`이
 * 던진 것을 그대로 던진다(호출하는 쪽마다 대응이 다르다).
 */
export function mountSceneLoop(
  canvas: HTMLCanvasElement,
  draw: (scene: PingPongScene) => void,
): SceneLoop {
  const scene = createScene(canvas)
  const resize = () => {
    const bounds = canvas.getBoundingClientRect()
    scene.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, 2))
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  let raf = 0
  const frame = () => {
    draw(scene)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return {
    scene,
    stop: () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      scene.dispose()
    },
  }
}

/**
 * 시뮬레이션 시계. 부를 때마다 지금 시각과 지난 호출 뒤 흐른 초를 준다. 탭이 숨었다 돌아와
 * 한 프레임이 길어져도 공이 순간 이동하지 않게 dt를 50ms로 자른다.
 */
export function createFrameClock() {
  let last = performance.now()
  return () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1_000)
    last = now
    return { now, dt }
  }
}
