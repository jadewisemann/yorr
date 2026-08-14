/**
 * 도메인 오류의 공통 뿌리.
 *
 * backend-java는 `IllegalArgumentException("room_full")`처럼 **메시지 자리에
 * 문자열 오류 코드**를 넣고, REST 계층이 그 문자열을 그대로 본문으로 내보낸다.
 * 이 모양이 프론트와의 계약이므로(DESIGN.md 「오류 계약」) 그대로 옮긴다 —
 * 여기서 코드 이름을 다듬거나 JSON 봉투로 감싸지 않는다.
 *
 * Java에서 컨트롤러들이 `catch (IllegalArgumentException)` 하나로 처리하던
 * 자리는 `instanceof DomainError`가 대신한다.
 */
export class DomainError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = new.target.name
    this.code = code
  }
}
