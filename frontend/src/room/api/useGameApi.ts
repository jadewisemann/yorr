import type { RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'
import { useAsyncQuery, useAsyncTask } from '@/shared/api/useAsyncTask'
import { useAppStore } from '@/store'
import type { GameStartResult } from './gameApi'
import { gameApiClient } from './gameApi'

export function useGame(gameId: string | null) {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncQuery<RoomSnapshot>(
    gameId ? `game:${gameId}` : null,
    (signal) => requireId(gameId, 'Game ID', (id) => gameApiClient.getGame(id, { signal })),
    {
      onSuccess: (snapshot) => {
        replaceRoomSnapshot(preserveRealtimeGame(snapshot))
      },
    },
  )
}

export function useStartGame() {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)
  const roomSession = useAppStore((state) => state.roomSession)
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[], GameStartResult>(
    (signal) =>
      roomSession
        ? gameApiClient.startGame(roomSession.roomCode, {
            signal,
            sessionToken: roomSession.sessionToken,
            userId: roomSession.you,
          })
        : Promise.reject(new Error('Room session is required')),
    {
      onSuccess: (result) => {
        if (!roomSession) return
        const snapshot = preserveRealtimeGame(result.snapshot)
        setRoomSession({
          ...roomSession,
          gameId: result.gameId,
          snapshot,
        })
        replaceRoomSnapshot(snapshot)
      },
    },
  )
}

/**
 * 대기실로 돌아가기. 화면 전환은 서버가 보내는 state.sync(phase=waiting)가 담당한다 —
 * 여기서 스냅샷을 직접 갈아끼우면 나만 먼저 옮겨가 다른 참가자와 상태가 갈린다.
 */
export function useReturnToLobby() {
  const roomSession = useAppStore((state) => state.roomSession)

  return useAsyncTask<[], void>((signal) =>
    roomSession
      ? gameApiClient.returnToLobby(roomSession.roomCode, {
          signal,
          sessionToken: roomSession.sessionToken,
          userId: roomSession.you,
        })
      : Promise.reject(new Error('Room session is required')),
  )
}

/** 방 단계의 진행 순서. 뒤로 가는 경우(대기실 복귀)는 REST가 아니라 state.sync가 알린다. */
const phaseOrder: Record<RoomPhase, number> = { waiting: 0, playing: 1, finished: 2 }

/**
 * REST 스냅샷을 실시간 상태와 합친다.
 * <p>
 * REST(`GET /games/:id`)는 새로고침·직접 진입에 대비한 <b>한 번짜리 백필</b>이고, 진행
 * 상태의 권위자는 WebSocket이다. 그래서 game뿐 아니라 <b>phase도 되돌리지 않는다</b> —
 * 응답이 날아오는 사이 `game.over`가 도착하면 이 응답이 finished를 playing으로 덮어
 * 결과 화면이 영영 뜨지 않는다. 라우트 분리로 GamePage가 한 청크 늦게 마운트되면서
 * 그 창이 넓어져 실제로 재현됐다(점수 2건 + game.over가 같은 틱에 오면 결과가 안 뜬다).
 * <p>
 * 종료 뒤의 players는 현재 접속 명단이 아니라 결과 화면의 참가자 이름 원본이므로,
 * finished를 지킬 때는 명단도 함께 지킨다(RealtimeSync의 keepGameState와 같은 규칙).
 */
function preserveRealtimeGame(snapshot: RoomSnapshot): RoomSnapshot {
  const current = useAppStore.getState().roomSnapshot
  const merged = current?.game ? { ...snapshot, game: current.game } : snapshot
  if (!current || phaseOrder[current.phase] <= phaseOrder[snapshot.phase]) return merged
  return current.phase === 'finished'
    ? { ...merged, phase: current.phase, players: current.players }
    : { ...merged, phase: current.phase }
}

function requireId<TData>(
  id: string | null,
  label: string,
  request: (id: string) => Promise<TData>,
): Promise<TData> {
  return id ? request(id) : Promise.reject(new Error(`${label} is required`))
}
