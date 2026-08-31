/**
 * 도메인 오류. **메시지 자리에 문자열 오류 코드**가 들어간다.
 *
 * REST 계층이 이 문자열을 그대로 본문에 담는다. 프론트가 문자열 단위로
 * 매핑하므로 이 모양이 곧 계약이다(DESIGN.md 「오류 계약」) — 코드 이름을
 * 다듬거나 JSON 봉투로 감싸지 않는다.
 */
export class CodedError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = new.target.name
    this.code = code
  }
}

/**
 * Java `IllegalArgumentException` 자리. 컨트롤러들이 이 갈래를 한 번에 잡아
 * **400 또는 404**로 매핑한다(`invalid_nickname`·`invalid_game_code`만 400,
 * 나머지는 404 — RoomController의 quirk가 그대로 계약이다).
 */
export class DomainError extends CodedError {}

/**
 * Java `IllegalStateException` 자리. REST는 **409**로 매핑한다
 * (`game_started`·`room_full`·`game_not_ready`·`not_finished` …).
 *
 * `DomainError`를 상속하지 **않는다** — 상속시키면 404 갈래에 먹혀 상태 코드가
 * 조용히 바뀐다.
 */
export class ConflictError extends CodedError {}
