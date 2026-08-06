import type { PlayerId } from '@/realtime/wsEvents'
import type { RollInputMode } from './animation'
import { createRemoteReleaseGate } from './remoteReleaseGate'

interface PendingRequest {
  inputMode: RollInputMode
  msgId: string
  requestId: string
}

interface AcceptedTurn {
  playerId: PlayerId
  roundNumber: number
}

/**
 * 아직 답을 못 받은 것들 — 보낸 굴림 요청, 미리 눌린 던짐, 방금 받아들인 턴, 남의 굴림 짝맞춤.
 *
 * 전부 <b>렌더와 무관한 진행 상태</b>라 state가 아니다. 값이 바뀌었다고 다시 그릴 것이 없고,
 * 메시지 핸들러가 같은 틱에 읽어야 해서 다음 렌더를 기다릴 수도 없다.
 *
 * 한 객체로 묶은 이유: 이 넷은 <b>턴이 넘어가면 함께 버려진다</b>. ref 넷으로 흩어져 있을 때는
 * 그 사실이 리셋 코드 네 줄로만 표현됐고, 하나를 빠뜨려도 조용했다.
 */
export function createRollTracking() {
  let pending: PendingRequest | null = null
  let queuedMotionRelease = false
  let acceptedTurn: AcceptedTurn | null = null
  const remote = createRemoteReleaseGate()

  return {
    /** 남의 굴림을 언제 쏟을지 — 도착 순서와 무관한 짝맞춤. */
    remote,

    /** 굴림을 요청했다. 미리 눌린 던짐은 이 요청과 함께 새로 센다. */
    requested(request: PendingRequest) {
      pending = request
      queuedMotionRelease = false
    },

    /** 이 요청에 대한 답이 왔거나 실패했다. 들고 있던 요청을 돌려주고 비운다. */
    settle(): PendingRequest | null {
      const settled = pending
      pending = null
      return settled
    },

    /** 지금 답을 기다리는 요청. 읽기만 한다. */
    get pending() {
      return pending
    },

    /**
     * 주사위가 아직 없는데 던지는 동작이 먼저 들어왔다 — 굴림이 도착하면 곧바로 쏟도록 적어 둔다.
     * 흔들어 굴리면 던지는 동작이 굴림 요청보다 빠를 수 있다.
     */
    queueMotionRelease() {
      if (pending?.inputMode === 'motion') queuedMotionRelease = true
    },

    /** 적어 둔 던짐이 있으면 소비하고 true. */
    takeQueuedMotionRelease() {
      if (!queuedMotionRelease) return false
      queuedMotionRelease = false
      return true
    },

    /** 이 턴의 주사위 방송을 받아들였다 — 턴 교체가 그것을 지우지 않게 표시해 둔다. */
    accept(turn: AcceptedTurn) {
      acceptedTurn = turn
    },

    /** 받아들인 턴을 꺼내고 비운다. 턴 교체가 판을 비울지 판단할 때 쓴다. */
    takeAcceptedTurn(): AcceptedTurn | null {
      const accepted = acceptedTurn
      acceptedTurn = null
      return accepted
    },

    /** 턴이 넘어갔다. 기다리던 것을 전부 버린다. */
    reset() {
      pending = null
      queuedMotionRelease = false
      acceptedTurn = null
      remote.reset()
    },
  }
}

export type RollTracking = ReturnType<typeof createRollTracking>
