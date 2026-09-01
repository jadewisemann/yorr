/**
 * Flyway 호환 마이그레이션 러너 — [ADR-0005](../../../docs/adr/0005-flyway-compatible-migration-runner.md).
 *
 * **서버 기동 경로는 스키마를 바꾸지 않는다.** 기동이 쓰는 것은
 * `verifyMigrations`(읽기 전용 확인)이고, `runMigrations`는 배포의 migrate 잡과
 * 빈 개발 DB·통합 테스트가 쓴다. 적용과 기동을 갈라 두면 "부팅했더니 스키마가
 * 바뀌어 있었다"가 일어나지 않는다.
 */
export { runMigrations, verifyMigrations } from './runner.js'
