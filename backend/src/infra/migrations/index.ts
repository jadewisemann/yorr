/**
 * 마이그레이션 러너의 공개 표면.
 *
 * - `verifyMigrations`: `main.ts`가 기동 시 읽기 전용 확인에 쓴다(ADR-0005).
 * - `runMigrations`: **소스에서 import하는 곳이 없어도 지우면 안 된다** —
 *   `deploy/compose.yaml`의 `migrate` 서비스가 빌드 산출물
 *   (`dist/infra/migrations/index.js`)을 동적 import로 부르는 외부 계약이다.
 */
export { runMigrations, verifyMigrations } from './runner.js'
