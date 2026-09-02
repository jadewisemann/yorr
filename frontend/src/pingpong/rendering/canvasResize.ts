import type { PingPongScene } from './scene3d'

/** 화면 배율은 2까지만 따른다 — 그 위로는 픽셀 수만 늘고 눈에 보이는 차이가 없다. */
const MAX_PIXEL_RATIO = 2

/**
 * 캔버스의 크기를 무대에 물린다. 탁구의 세 훅(혼자 하기·파티 판정·서버 진행)이 같은
 * 배선을 쓰므로 한자리에 둔다. 돌려주는 함수를 effect 정리에서 부르면 관찰을 끊는다.
 */
export function followCanvasSize(canvas: HTMLCanvasElement, scene: PingPongScene): () => void {
  const resize = () => {
    const bounds = canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    scene.resize(bounds.width, bounds.height, ratio)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  return () => observer.disconnect()
}
