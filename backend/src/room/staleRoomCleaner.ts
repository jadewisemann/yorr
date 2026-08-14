import type { RoomService } from './roomService.js'

/**
 * 재시작으로 **이어갈 수 없게 된 방만** 정리한다 — backend-java
 * `room/initializer/StaleRoomCleaner`.
 *
 * 라운드 상태 자체는 Redis에 있어 재시작을 견디지만 **마감 타이머는 인메모리**라
 * 프로세스와 함께 증발하고, 부팅 때 다시 걸어주는 경로가 없다. 방을 열어두면
 * 상태만 살아 있고 턴은 넘어가지 않는 멈춘 게임이 되고, JOIN도 `game_started`로
 * 막혀 TTL이 끝날 때까지 아무도 들어갈 수 없다. 그래서 정책은 **"새 버전이
 * 올라오면 진행 중이던 게임 세션은 종료된다"**다.
 *
 * LOBBY·FINISHED는 건드리지 않는다 — 예전 구현이 부팅마다 `room:*`를 전부
 * 지워 살아 있는 대기실까지 전멸시켰던 회귀의 재발 방지다.
 *
 * 타이머 복구가 생기면 이 함수는 삭제 대상이다(docs/design/rooms-and-sessions.md).
 *
 * @returns 닫은 방의 수.
 */
export const closeUnrecoverableGamesOnStartup = async (rooms: RoomService): Promise<number> => {
  let closed = 0
  for (const roomCode of await rooms.getAllRoomCodes()) {
    // 이미 만료돼 phase를 못 읽는 방은 닫을 것도 없다.
    if ((await rooms.getSnapshot(roomCode)).phase !== 'PLAYING') continue
    await rooms.close(roomCode)
    closed += 1
  }
  return closed
}
