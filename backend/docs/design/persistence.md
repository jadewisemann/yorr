# 영속성

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `game/match/`,
> `game/ranking/`, `user/`, Flyway `db/migration/`.

## 저장소 분리

| 저장소 | 담는 것 | 특성 |
|---|---|---|
| Redis | 방, 게스트 세션, 진행 중 게임 상태, 점수판 | 휘발 허용, TTL, Lua 원자성 |
| MySQL | 계정(소셜 연동), 전적(match), 주간 랭킹 | 영속, 스키마 마이그레이션 |

경계 규칙: **게임이 진행되는 동안 MySQL을 만지지 않는다.** 게임 종료 시점에
전적을 MySQL로 보관(archive)하고, 랭킹 집계는 그 기록을 읽는다.

## 스키마

backend-java의 Flyway 마이그레이션을 그대로 이어받는다.

- `V1__create_user_tables.sql` — 계정·소셜 연동
- `V2__create_match_tables.sql` — match·참가자

같은 DB를 쓰는 기간(전환기)에는 **스키마 변경을 금지**한다. Node 쪽
마이그레이션 도구 선정은 Phase 4에서 ADR로 결정한다(후보: 기존 SQL을 그대로
실행하는 경량 러너 — Flyway 이력 테이블과의 호환이 판단 기준).

## 클라이언트

- Redis: `ioredis`, lazyConnect. Lua는 `defineCommand`로 등록해 스크립트 단위로
  테스트한다.
- MySQL: `mysql2/promise` 풀(`infra/mysql.ts`). ORM 미도입(ADR-0003) — 쿼리가
  늘어나면 재검토.
