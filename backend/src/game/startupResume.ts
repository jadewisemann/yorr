/**
 * 부팅 재무장 — 프로세스가 죽었다 살아난 뒤 진행 중이던 판을 이어간다
 * (deploy/PLAN.md PR 6).
 *
 * **이 파일이 `room/staleRoomCleaner.ts`를 대체한다.** 예전 정책은 "새 버전이 올라오면
 * 진행 중이던 게임 세션은 종료된다"였고, 그 이유는 라운드 상태는 Redis에 있어 재시작을
 * 견디는데 **마감 타이머만 프로세스 인메모리**여서 되살릴 방법이 없었기 때문이다. 방을
 * 열어 두면 상태는 살아 있는데 턴이 넘어가지 않고 JOIN도 `game_started`로 막히는, 가장
 * 나쁜 상태가 된다. 마감 시각이 Redis로 나간 지금은 되살리는 쪽이 가능해졌다.
 *
 * ## 재무장은 fail-closed다
 *
 * 방마다 독립적으로 시도하고, 실패한 방만 닫는다. 한 방의 실패가 나머지 방의 복구를
 * 막지 않아야 하고(그러면 예전보다 나빠진다), 동시에 **되살리지 못한 방을 열어 둔 채
 * 넘어가서도 안 된다** — 그것이 정확히 위에서 말한 최악의 상태다. 그래서 이어갈 수
 * 없다고 판단한 방은 예전 정책 그대로 닫는다.
 *
 * ## 무엇을 순회하는가
 *
 * phase가 PLAYING인 방만이다. LOBBY·FINISHED는 건드리지 않는다 — 예전 구현이 부팅마다
 * `room:*`를 전부 지워 살아 있는 대기실까지 전멸시켰던 회귀의 재발 방지다.
 */

/** 재무장이 방에서 실제로 읽는 것만. `RoomSnapshot`이 그대로 만족한다. */
export interface StartupResumeRoomSnapshot {
  readonly gameCode: string | null
  readonly phase: string | null
}

/** `RoomService`의 부분집합. */
export interface StartupResumeRooms {
  getAllRoomCodes(): Promise<readonly string[]>
  getSnapshot(roomCode: string): Promise<StartupResumeRoomSnapshot>
  close(roomCode: string): Promise<unknown>
}

/** 재무장이 모듈에 요구하는 것 하나. `GameModuleRegistry`가 그대로 만족한다. */
export interface StartupResumeModules {
  byCode(
    code: string | null | undefined,
  ): { rehydrate(roomCode: string): Promise<void> } | undefined
}

export interface StartupResumeDeps {
  readonly rooms: StartupResumeRooms
  readonly games: StartupResumeModules
}

export interface StartupResumeOptions {
  /** 방 하나를 되살렸을 때. */
  readonly onResumed?: (roomCode: string, gameCode: string) => void
  /**
   * 이어갈 수 없어 닫았을 때. `reason`은 모듈이 던진 것 또는 "모듈이 없다"다.
   *
   * 로그를 방마다 남기는 이유: 배포 직후 이 줄이 몇 개인지가 곧 "이번 배포가 몇 판을
   * 끊었는가"다. 그 수가 0이 되는 것이 PR 7(게임 게이트 제거)의 전제다.
   */
  readonly onClosed?: (roomCode: string, reason: unknown) => void
}

export interface StartupResumeReport {
  /** 이어간 방 수. */
  readonly resumed: number
  /** 이어갈 수 없어 닫은 방 수. */
  readonly closed: number
}

const PLAYING_PHASE = 'PLAYING'

export const resumeGamesOnStartup = async (
  deps: StartupResumeDeps,
  options: StartupResumeOptions = {},
): Promise<StartupResumeReport> => {
  const onResumed = options.onResumed ?? ((): void => {})
  const onClosed = options.onClosed ?? ((): void => {})
  let resumed = 0
  let closed = 0

  for (const roomCode of await deps.rooms.getAllRoomCodes()) {
    const room = await deps.rooms.getSnapshot(roomCode)
    // 이미 만료돼 phase를 못 읽는 방은 이어갈 것도 닫을 것도 없다.
    if (room.phase !== PLAYING_PHASE) continue

    const module = deps.games.byCode(room.gameCode)
    if (module === undefined) {
      // 아직 이식되지 않은 게임이거나 코드가 손상된 방이다. 되살릴 주체가 없으므로
      // 예전 정책(닫는다)이 그대로 옳다.
      await closeRoom(deps, roomCode, new Error(`게임 모듈이 없습니다: ${room.gameCode}`), onClosed)
      closed += 1
      continue
    }

    try {
      await module.rehydrate(roomCode)
      resumed += 1
      onResumed(roomCode, room.gameCode ?? '')
    } catch (reason) {
      await closeRoom(deps, roomCode, reason, onClosed)
      closed += 1
    }
  }

  return { resumed, closed }
}

/**
 * 닫기 자체가 실패해도 순회를 멈추지 않는다. 여기서 던지면 **뒤에 남은 방들이 아예
 * 복구되지 않고** 기동만 실패하는데, 그것은 이 함수가 막으려는 상태보다 나쁘다.
 */
const closeRoom = async (
  deps: StartupResumeDeps,
  roomCode: string,
  reason: unknown,
  onClosed: (roomCode: string, reason: unknown) => void,
): Promise<void> => {
  try {
    await deps.rooms.close(roomCode)
  } catch (closeFailure) {
    onClosed(roomCode, closeFailure)
    return
  }
  onClosed(roomCode, reason)
}
