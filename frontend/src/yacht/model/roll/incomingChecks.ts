import type { ServerMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'
import type { YachtGameState } from '@/yacht/domain/yachtGame'
import { createYachtGame, yachtGameReducer } from '@/yacht/domain/yachtGame'

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>
type DiceShakenMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.shaken' }>

/**
 * 들어오는 서버 메시지가 **이 화면·이 라운드의 것인지** 판정한다. 방송(broadcast)은
 * 게임 상태까지 보고, 나머지는 방·라운드·현재 플레이어만 본다.
 */
export const isForRoom = (message: { roomId?: string | undefined }, roomId: string) =>
  message.roomId === roomId

export const isForRound = (payload: { roundNumber: number }, roundNumber: number) =>
  payload.roundNumber === roundNumber

/** 상대의 흔들기 — 관전자에게만 의미가 있다(내 흔들기는 이미 로컬에서 그렸다). */
export function isRemoteShake(
  message: DiceShakenMessage,
  context: { roomId: string; roundNumber: number; activePlayerId: string | undefined; you: string },
  remoteRolling: boolean,
): boolean {
  return (
    isForRoom(message, context.roomId) &&
    isForRound(message.payload, context.roundNumber) &&
    message.payload.playerId === context.activePlayerId &&
    message.payload.playerId !== context.you &&
    remoteRolling
  )
}

/** 상대가 보낸 한 턴짜리 신호(던짐·KEEP 변경) — 이 화면의 현재 턴이고 내 것이 아닌가. */
function isRemoteTurnSignal(
  message: { roomId?: string | undefined; payload: { roundNumber: number; playerId: string } },
  context: { roomId: string; roundNumber: number; activePlayerId: string | undefined; you: string },
): boolean {
  return (
    isForRoom(message, context.roomId) &&
    isForRound(message.payload, context.roundNumber) &&
    message.payload.playerId === context.activePlayerId &&
    message.payload.playerId !== context.you
  )
}

export const isRemoteThrow = isRemoteTurnSignal
export const isRemoteHoldChange = isRemoteTurnSignal

/** 방송된 굴림을 로컬 판에 반영한다. 라운드가 바뀌었으면 판을 새로 연다. */
export function applyBroadcast(
  message: DiceBroadcastMessage,
  options: { seed: number; requestId: string; forced: boolean },
): (state: YachtGameState) => YachtGameState {
  const { seed, requestId, forced } = options
  const roll = message.payload
  return (state) =>
    yachtGameReducer(
      state.roundNumber === roll.roundNumber
        ? state
        : createYachtGame(state.seed, roll.roundNumber),
      {
        type: 'rollRequested',
        forced,
        held: roll.held as HeldDice,
        requestId,
        rollCount: roll.rollCount,
        seed,
        targetDice: roll.dice,
      },
    )
}
