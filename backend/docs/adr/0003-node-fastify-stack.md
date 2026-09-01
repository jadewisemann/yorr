# ADR-0003: Node 22 + Fastify + ws + ioredis + mysql2 스택

- 상태: accepted
- 날짜: 2026-08-14

## 맥락

백엔드를 Node.js + TypeScript로 쓰기로 하면서 런타임·프레임워크·라이브러리를 정해야 한다.
요구사항: REST(`/api/v1`), WebSocket(`/ws/v1/game`), Redis(Lua 스크립트 포함),
MySQL, 팀 도구 체인(TS·Biome·Vitest)과의 정합.

## 결정

| 역할 | 선택 |
|---|---|
| 런타임 | Node.js ≥ 22.12 (프로젝트 요구 버전과 동일) |
| 언어 | TypeScript (strict, ESM, NodeNext) |
| HTTP | Fastify + `@fastify/cors` |
| WebSocket | `ws` (HTTP 서버에 직접 부착) |
| Redis | `ioredis` (Lua `defineCommand` 지원) |
| MySQL | `mysql2/promise` |
| 검증 | `zod` (envelope·env·요청 payload) |
| 테스트 | Vitest |
| 린트·포맷 | Biome (프론트와 동일 설정 기조) |
| 실행 | `tsx`(dev) / `tsc` 빌드 후 `node`(prod) |

WebSocket은 Fastify 플러그인(`@fastify/websocket`) 대신 `ws`를 HTTP 서버에 직접
붙인다 — 연결 수명·구독 관리가 HTTP 프레임워크 수명과 분리되는 편이
게이트웨이를 프레임워크
없이 단위 테스트할 수 있다.

## 검토한 대안

- **NestJS**: 구조가 잡혀 있지만 DI 컨테이너·데코레이터
  레이어가 이 규모(단일 서비스, 도메인 몇 개)에는 과하고 팀의 프론트 코드
  스타일(함수·모듈 중심)과 이질적이다.
- **Express**: 생태계는 크지만 타입·검증·성능 모두 Fastify가 낫다.
- **Hono**: 엣지 지향. 장시간 WS 연결 중심 서버에는 이점이 없다.
- **Bun / Deno**: 런타임 성숙도·운영 경험 부족이 리스크. Node는 이미 프로젝트
  요구사항(≥22.12)에 있다.
- **ORM(Prisma·Drizzle)**: 스키마는 이미 Flyway SQL로 존재하고 쿼리 수가 적다.
  일단 `mysql2` 직접 사용으로 시작하고, 쿼리가 늘어나면 별도 ADR로 재검토한다.

## 결과

- Lua 스크립트는 `ioredis`의 `defineCommand`로 이식한다 — 원자성 시맨틱 유지가
  계약이다(PLANS.md 리스크 참고).
- `tsx`는 개발 전용이다. 프로덕션은 반드시 `npm run build` 산출물(`dist/`)을 실행한다.
