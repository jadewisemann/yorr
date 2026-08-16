/**
 * 마이그레이션 오류. `errors.ts`의 `DomainError`/`ConflictError`와 **일부러
 * 다른 갈래**다 — 그쪽은 REST 상태 코드로 매핑되는 사용자 오류이고, 이것은
 * 기동·운영 오류다(부팅을 멈춰야 하는 종류). REST 계층이 잡을 일이 없다.
 */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}
