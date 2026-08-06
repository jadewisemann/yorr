import type { Fault } from './court'

/**
 * 렌더러와의 계약 — 프레임마다 "지금 공/라켓이 어디 있나"만 담는다.
 *
 * 이 타입이 `rendering/`이 아니라 여기 있는 이유: 만드는 쪽이 domain(`localFrameState`)과
 * 화면(`createFrameState`)이고 `rendering/scene3d`는 받아서 그리기만 한다. 렌더러에 두면
 * domain -> rendering 방향 참조가 나서 "domain 은 렌더링을 모른다"가 성립하지 않는다.
 */
export type Viewer = 1 | 2

export interface FrameState {
  /** 좌우 분할로 두 시점을 함께 그릴지 */
  split: boolean
  /** 단일 화면일 때 누구 시점인지 */
  viewer: Viewer
  playing: boolean
  ballPos: number
  ballDir: 1 | -1
  ballX: number
  ballSmash: boolean
  ballHit: boolean
  /** 아웃·네트로 죽은 공 (아무도 못 침) */
  ballFault: Fault
  /** 실패 궤적의 시작 prog */
  ballFaultFrom: number
  /** 실점 확정 후 떨어진 시간(초). 죽은 공을 바닥으로 내려앉힌다. */
  ballFall: number
  p1X: number
  p2X: number
  /** 0=평소, 1=방금 휘둘렀음 */
  p1Swing: number
  p2Swing: number
  /** 0=평온, 1=최대 흔들림 */
  shake: number
}
