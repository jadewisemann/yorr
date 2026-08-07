interface RemoteRoll {
  requestId: string
  rollCount: number
  roundNumber: number
}

type ThrowMark = Omit<RemoteRoll, 'requestId'>

const sameRoll = (left: ThrowMark, right: ThrowMark) =>
  left.roundNumber === right.roundNumber && left.rollCount === right.rollCount

export function createRemoteReleaseGate() {
  let roll: RemoteRoll | null = null
  let waitingThrow: ThrowMark | null = null

  return {
    rollAccepted(next: RemoteRoll | null): string | null {
      roll = next
      if (!next || !waitingThrow || !sameRoll(waitingThrow, next)) return null
      waitingThrow = null
      return next.requestId
    },

    throwObserved(at: ThrowMark): string | null {
      if (roll && sameRoll(roll, at)) {
        const { requestId } = roll
        roll = null
        return requestId
      }
      waitingThrow = at
      return null
    },

    get rolling() {
      return roll !== null
    },

    reset() {
      roll = null
      waitingThrow = null
    },
  }
}

export type RemoteReleaseGate = ReturnType<typeof createRemoteReleaseGate>
