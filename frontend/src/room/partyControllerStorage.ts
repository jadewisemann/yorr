/**
 * "이 방은 파티 모드다"를 폰이 기억하는 자리.
 *
 * 큰 화면이 게임판을 맡는 방에서는 폰이 화면이 아니라 <b>컨트롤러</b>다(S15P11A406-182).
 * 그런데 서버 스냅샷에는 방 모드가 없다 — `RoomSnapshot`에 `mode`도 없고, 대시보드는
 * 플레이어 명단에도 없어서 폰이 스스로 알아낼 근거가 하나도 없다. 그래서 대시보드가
 * 초대 URL에 `party=1`을 실어 보내고, 그 링크로 들어온 폰이 방 코드와 함께 여기 적어둔다.
 *
 * 방 코드로 묶어 두는 이유: 플래그만 남기면 다음에 코드로 들어간 <b>일반</b> 방까지
 * 컨트롤러로 뜬다. 코드가 다르면 무시하므로 지울 필요가 없다.
 *
 * ponytail: 서버가 스냅샷에 방 모드를 실어주면 이 파일과 URL 파라미터를 통째로 지우고
 * `snapshot.mode === 'party'`로 바꾼다. 지금 남는 구멍은 <b>초대 코드를 직접 입력해
 * 들어온 사람은 일반 화면으로 뜬다</b>는 것 하나다(같은 방에서 두 UI가 공존한다).
 */

const partyRoomStorageKey = 'yorr.party-room'

export function savePartyRoom(roomCode: string) {
  try {
    globalThis.localStorage?.setItem(partyRoomStorageKey, roomCode)
  } catch {
    // 시크릿 모드·웹뷰에서 막힐 수 있다. 그때는 일반 화면으로 뜬다 — 못 노는 것보다 낫다.
  }
}

export function isPartyRoom(roomCode: string | undefined) {
  if (!roomCode) return false
  try {
    return globalThis.localStorage?.getItem(partyRoomStorageKey) === roomCode
  } catch {
    return false
  }
}
