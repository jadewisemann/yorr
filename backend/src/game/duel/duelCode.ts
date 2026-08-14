/**
 * 결투의 정규 게임 코드 — `GAME_CATALOG`의 `DUEL`과 같은 문자열이어야 한다
 * (레지스트리 등록이 카탈로그 조회로 검증하므로 어긋나면 기동이 실패한다).
 *
 * 카탈로그(`game/catalog.ts`)의 상수를 재수출하지 않고 별도 파일에 둔 이유는
 * Redis 키(`gameStateKey`)와 WS 네임스페이스(`game.duel.`)가 둘 다 이 값을 쓰는데,
 * 스토어가 카탈로그를 import하면 저장소가 방 정원 표에 묶이기 때문이다.
 */
export const DUEL_CODE = 'DUEL'
