import { DomainError } from '../errors.js'

/**
 * 세션 토큰이 없거나 만료·불일치일 때. **닉네임 규칙 위반과 구분하려고** 별도
 * 타입이다 — 둘이 같은 오류였을 때 토큰 만료가 "닉네임이 올바르지 않습니다"로
 * 응답돼 클라이언트의 재입장 복구 경로가 동작하지 않았다(Java 원본 주석).
 *
 * `DomainError`를 상속하는 것은 Java에서 `IllegalArgumentException`을 상속하던
 * 것과 같은 의도다: REST 컨트롤러의 일괄 401 처리를 그대로 두고 WebSocket 쪽만
 * 만료를 세분화한다.
 *
 * 본문 문자열은 API마다 다르다 — 방·봇은 이 `invalid_guest_session`,
 * 퀵매치는 `unauthorized`, 프로필·auth·랭킹은 `session_expired`.
 * 셋 다 계약이므로 통일하지 않는다(rooms-and-sessions.md).
 */
export class SessionAuthenticationError extends DomainError {
  constructor() {
    super('invalid_guest_session')
  }
}

/** 닉네임 정규화 실패. REST 본문은 plain-text `invalid_nickname`. */
export class InvalidNicknameError extends DomainError {
  constructor() {
    super('invalid_nickname')
  }
}
