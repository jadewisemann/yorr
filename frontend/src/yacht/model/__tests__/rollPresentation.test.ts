import { describe, expect, it } from 'vitest'
import {
  IDLE_ROLL_PRESENTATION,
  type RollPresentation,
  rollPresentationReducer as reduce,
} from '@/yacht/model/gamePlayModel'

/**
 * 굴림 연출 상태. 예전엔 useState 넷이었고 여섯 자리에서 2~4개를 짝지어 세팅했다 —
 * 어떤 조합이 유효한지가 호출부에 흩어져 있어서, 여기서 전이 자체를 못 박는다.
 */
describe('rollPresentationReducer', () => {
  const rolling: RollPresentation = {
    inputMode: 'motion',
    releaseRequestId: 'r1',
    remoteShaking: true,
    requesting: true,
  }

  it('요청하면 기다리는 중이 되고 앞선 놓기 신호를 거둔다', () => {
    expect(reduce(rolling, { type: 'requested', inputMode: 'tap' })).toMatchObject({
      inputMode: 'tap',
      releaseRequestId: null,
      requesting: true,
    })
  })

  it('방송이 확정되면 기다림이 끝나고 남의 흔들림도 멈춘다', () => {
    expect(reduce(rolling, { type: 'broadcastAccepted', mode: 'remote' })).toEqual({
      inputMode: 'remote',
      releaseRequestId: null,
      remoteShaking: false,
      requesting: false,
    })
  })

  /** 실패가 앞선 굴림의 놓기까지 취소하면 그 주사위가 트레이 위에 뜬 채로 멈춘다. */
  it('실패는 놓기 신호를 건드리지 않는다 — 완료는 거둔다', () => {
    expect(reduce(rolling, { type: 'requestFailed' })).toMatchObject({
      inputMode: null,
      releaseRequestId: 'r1',
      requesting: false,
    })
    expect(reduce(rolling, { type: 'completed' })).toMatchObject({
      inputMode: null,
      releaseRequestId: null,
      requesting: false,
    })
  })

  it('놓기는 그리는 방식을 바꾸지 않는다 — 같은 굴림의 다음 단계다', () => {
    expect(reduce(rolling, { type: 'released', requestId: 'r2' })).toMatchObject({
      inputMode: 'motion',
      releaseRequestId: 'r2',
    })
  })

  it('턴이 넘어가면 전부 접는다', () => {
    expect(reduce(rolling, { type: 'turnReset' })).toEqual(IDLE_ROLL_PRESENTATION)
  })

  it('남의 흔들기는 그리던 것을 유지한 채 표시만 켠다', () => {
    expect(reduce(IDLE_ROLL_PRESENTATION, { type: 'remoteShakeStarted' })).toEqual({
      ...IDLE_ROLL_PRESENTATION,
      remoteShaking: true,
    })
  })
})
