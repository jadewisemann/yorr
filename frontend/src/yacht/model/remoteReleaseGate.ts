interface RemoteRoll {
  requestId: string
  rollCount: number
  roundNumber: number
}

type ThrowMark = Omit<RemoteRoll, 'requestId'>

const sameRoll = (left: ThrowMark, right: ThrowMark) =>
  left.roundNumber === right.roundNumber && left.rollCount === right.rollCount

/**
 * 남의 굴림을 따라 그릴 때, <b>주사위를 언제 쏟을지</b>를 정한다.
 *
 * 두 신호가 필요하다 — 서버의 굴림 확정(`dice.broadcast`)과 그 사람이 실제로 던진 순간
 * (`dice.thrown`). **둘의 도착 순서는 정해져 있지 않다.** 던짐이 먼저 오면 굴림이 올 때까지
 * 적어 두고, 굴림이 먼저 오면 던짐을 기다린다. 어느 쪽이 나중에 오든 짝이 맞는 순간
 * requestId를 돌려주고, 그게 "지금 쏟아라"는 뜻이다.
 *
 * 짝을 맞추는 기준은 라운드 번호와 굴림 횟수다. 예전에는 이 판단이 두 핸들러에 각각 적혀
 * 있었다 — 한쪽만 고치면 한 방향에서만 쏟아지고, 그건 「상대 주사위가 공중에 멈춘」 화면이 된다.
 */
export function createRemoteReleaseGate() {
  let roll: RemoteRoll | null = null
  let waitingThrow: ThrowMark | null = null

  return {
    /**
     * 서버가 굴림을 확정했다. 남의 굴림이 아니면 `null`을 넘겨 진행 중인 것을 지운다.
     * 던짐이 이미 와 있었으면 그 requestId를 돌려준다.
     */
    rollAccepted(next: RemoteRoll | null): string | null {
      roll = next
      if (!next || !waitingThrow || !sameRoll(waitingThrow, next)) return null
      waitingThrow = null
      return next.requestId
    },

    /** 남이 던졌다. 굴림이 이미 와 있으면 그 requestId를 돌려주고, 아니면 적어 둔다. */
    throwObserved(at: ThrowMark): string | null {
      if (roll && sameRoll(roll, at)) {
        const { requestId } = roll
        roll = null
        return requestId
      }
      waitingThrow = at
      return null
    },

    /** 남의 굴림이 진행 중인가 — 그 사람의 흔들림을 따라 그릴지 판단한다. */
    get rolling() {
      return roll !== null
    },

    /** 턴이 넘어갔다. 기다리던 짝을 버린다. */
    reset() {
      roll = null
      waitingThrow = null
    },
  }
}

export type RemoteReleaseGate = ReturnType<typeof createRemoteReleaseGate>
