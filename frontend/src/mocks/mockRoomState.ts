import type { RoomSnapshot } from '@/realtime/wsEvents'

/**
 * mock 서버가 기억하는 "현재 방 상태". 실서버는 재접속(room.join) 때 진짜 phase·점수를
 * 돌려주지만, 정적 픽스처만 쓰면 새로고침마다 대기 중 스냅샷으로 되돌아가 진행 상태가
 * 사라진다(QA 참고 항목). 새로고침을 넘어 살아남아야 하므로 모듈 변수 대신
 * sessionStorage에 둔다 — 앱 세션(`yorr.room-session`)과 같은 수명이다.
 */
const STORAGE_KEY = 'yorr.mock-room-state'

export function saveMockRoomSnapshot(snapshot: RoomSnapshot) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // storage가 없거나 가득 찬 환경이면 mock은 정적 픽스처로만 동작한다.
  }
}

export function loadMockRoomSnapshot(): RoomSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RoomSnapshot) : null
  } catch {
    return null
  }
}

export function clearMockRoomSnapshot() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 지울 것이 없으면 그만이다.
  }
}
