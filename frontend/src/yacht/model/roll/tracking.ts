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

export function createRollTracking() {
  let pending: PendingRequest | null = null
  let queuedMotionRelease = false
  let acceptedTurn: AcceptedTurn | null = null
  const remote = createRemoteReleaseGate()

  return {
    remote,

    requested(request: PendingRequest) {
      pending = request
      queuedMotionRelease = false
    },

    settle(): PendingRequest | null {
      const settled = pending
      pending = null
      return settled
    },

    get pending() {
      return pending
    },

    queueMotionRelease() {
      if (pending?.inputMode === 'motion') queuedMotionRelease = true
    },

    takeQueuedMotionRelease() {
      if (!queuedMotionRelease) return false
      queuedMotionRelease = false
      return true
    },

    accept(turn: AcceptedTurn) {
      acceptedTurn = turn
    },

    takeAcceptedTurn(): AcceptedTurn | null {
      const accepted = acceptedTurn
      acceptedTurn = null
      return accepted
    },

    reset() {
      pending = null
      queuedMotionRelease = false
      acceptedTurn = null
      remote.reset()
    },
  }
}

export type RollTracking = ReturnType<typeof createRollTracking>
