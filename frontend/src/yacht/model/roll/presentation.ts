import type { RollAnimationMode, RollInputMode } from './animation'

/**
 * 굴림 <b>연출</b>의 상태. 서버가 정한 굴림 결과(local 게임 상태)와 달리, 이 화면이 지금
 * 무엇을 그리고 있는지만 담는다 — 요청을 기다리는 중인지, 어떤 입력으로 굴렸는지,
 * 주사위를 놓아도 되는지, 남의 흔들림을 따라 그리는 중인지.
 *
 * 넷을 한 값으로 묶은 이유: 항상 함께 바뀐다. useState 넷으로 두었을 때 여섯 자리에서
 * 2~4개를 짝지어 세팅하고 있었고, 그 조합이 맞는지는 호출부를 전부 읽어야 알 수 있었다.
 */
export interface RollPresentation {
  /** 굴림 애니메이션을 어떤 입력으로 그릴지. null이면 그리는 중이 아니다. */
  inputMode: RollAnimationMode | null
  /** 이 요청의 주사위를 트레이에 놓아도 된다는 신호. */
  releaseRequestId: string | null
  /** 남의 흔들기를 따라 그리는 중. */
  remoteShaking: boolean
  /** 서버 응답을 기다리는 중. */
  requesting: boolean
}

export type RollPresentationAction =
  /** 내가 굴림을 요청했다. */
  | { type: 'requested'; inputMode: RollInputMode }
  /** 요청이 전송·처리에 실패했다. 되돌린다. */
  | { type: 'requestFailed' }
  /** 서버가 이번 굴림을 확정해 방송했다. */
  | { type: 'broadcastAccepted'; mode: RollAnimationMode }
  /** 주사위를 놓는다(던짐 확정·탭 지연 만료·원격 따라잡기). */
  | { type: 'released'; requestId: string }
  /** 남이 흔들기 시작했다. */
  | { type: 'remoteShakeStarted' }
  /** 굴림 애니메이션이 끝났다. */
  | { type: 'completed' }
  /** 턴이 넘어갔다. 진행 중이던 연출을 전부 접는다. */
  | { type: 'turnReset' }

export const IDLE_ROLL_PRESENTATION: RollPresentation = {
  inputMode: null,
  releaseRequestId: null,
  remoteShaking: false,
  requesting: false,
}

export function rollPresentationReducer(
  state: RollPresentation,
  action: RollPresentationAction,
): RollPresentation {
  switch (action.type) {
    case 'requested':
      return { ...state, inputMode: action.inputMode, releaseRequestId: null, requesting: true }
    // 실패는 release를 건드리지 않는다 — 이미 놓기로 한 앞선 굴림까지 취소하면 그 주사위가
    // 트레이 위에 뜬 채로 멈춘다. 완료는 이번 굴림의 놓기 신호를 거둔다.
    case 'requestFailed':
      return { ...state, inputMode: null, requesting: false }
    case 'completed':
      return { ...state, inputMode: null, releaseRequestId: null, requesting: false }
    case 'broadcastAccepted':
      return {
        inputMode: action.mode,
        releaseRequestId: null,
        remoteShaking: false,
        requesting: false,
      }
    case 'released':
      return { ...state, releaseRequestId: action.requestId }
    case 'remoteShakeStarted':
      return { ...state, remoteShaking: true }
    case 'turnReset':
      return IDLE_ROLL_PRESENTATION
  }
}
