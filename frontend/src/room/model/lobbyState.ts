import type { RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { isDuoGame } from '@/room/domain/lobbyLabels'
import { isPartyRoom } from '@/room/partyControllerStorage'
import type { ActiveRoomSession, ConnectionStatus } from '@/store'

interface LobbyStateInput {
  roomId: string
  roomSession: ActiveRoomSession | null
  snapshot: RoomSnapshot | null
  roomResumeReason: unknown
  connectionStatus: ConnectionStatus
}

/**
 * 대기실이 화면에 보여 줄 값. 세션·스냅샷에서 파생되는 것만 모아 두면
 * 훅 본문은 이동과 프리페치(부수 효과)에 집중할 수 있다.
 */
export function lobbyStateOf(input: LobbyStateInput) {
  const { roomId, roomSession, snapshot, roomResumeReason, connectionStatus } = input
  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom === true && isRoomHost(snapshot, roomSession.you)
  const capacity = snapshot?.capacity ?? 6
  const duoGame =
    isDuoGame(snapshot?.gameCode) || (matchingRoom === true && isDuoGame(roomSession.gameCode))
  const minPlayers = duoGame ? 2 : 1
  const controller = matchingRoom === true && isPartyRoom(roomSession.roomCode)
  const inWaitingRoom = snapshot?.phase === 'waiting'

  return {
    canStart:
      isHost &&
      connectionStatus === 'connected' &&
      inWaitingRoom &&
      snapshot.players.length >= minPlayers,
    capacity,
    connectionStatus,
    controller,
    duoGame,
    gameCode: snapshot?.gameCode ?? roomSession?.gameCode ?? 'YACHT_DICE',
    inWaitingRoom,
    isHost,
    matchingRoom,
    minPlayers,
    session: matchingRoom && !roomResumeReason ? roomSession : null,
    snapshot,
  }
}
