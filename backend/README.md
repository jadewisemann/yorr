# YORR Backend (Node.js)

YORR의 API 및 실시간 게임 서버다. 기존 Spring Boot 구현을 Node.js + TypeScript로
이식해 왔으며, 원본 `backend-java/`는 제거되었다 — 이제 이 디렉터리가 유일한
백엔드다. 이식 경과는 [PLANS.md](PLANS.md)에 남아 있다.

## 문서 지도

| 문서 | 내용 |
|---|---|
| [DESIGN.md](DESIGN.md) | 시스템 설계 정본 — 원칙·불변식·하위 시스템 인덱스 |
| [PLANS.md](PLANS.md) | 마이그레이션 단계·상태 표·워크플로우 |
| [AGENTS.md](AGENTS.md) | 에이전트·개발자 작업 프로토콜 (Understand → Implement → Reconcile) |
| [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) | 작업 중 발견 기록 (working memory) |
| `docs/design/` | 하위 시스템 설계 (realtime · rooms · game-modules · games/{yacht,duel,pingpong} · reconnect · auth · chat · persistence · operations) |
| `docs/adr/` | 아키텍처 결정 기록 (왜 이렇게 했는가) |

## 기술 스택

Node.js ≥ 22.12 · TypeScript · Fastify · ws · ioredis · mysql2 · zod ·
Vitest · Biome (선정 근거: [ADR-0003](docs/adr/0003-node-fastify-stack.md))

## 시작하기

```bash
cd backend
cp .env.example .env   # 필요한 값만 채우면 된다 — 백본은 Redis·MySQL 없이도 뜬다
npm ci
npm run dev
```

- Health check: `http://localhost:8080/actuator/health`
- WebSocket: `ws://localhost:8080/ws/v1/game` (`sys.connected` → `sys.ping`/`sys.pong`)

## 검증

```bash
npm run check        # biome lint + format
npm run typecheck    # tsc
npm test             # vitest
npm run build        # 프로덕션 빌드 (dist/)
```

Redis 통합 테스트는 `redis-server` 바이너리를 찾아 테스트 파일마다 하나씩
띄운다([ADR-0004](docs/adr/0004-redis-integration-test-harness.md)). 바이너리가
없으면 해당 스위트만 건너뛴다 — 이미 띄워 둔 Redis를 쓰려면 `REDIS_TEST_URL`,
건너뛰기를 실패로 만들려면 `REDIS_TEST_REQUIRED=1`.
