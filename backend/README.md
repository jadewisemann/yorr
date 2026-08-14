# YORR Backend (Node.js)

Spring Boot 백엔드(`../backend-java/`)를 Node.js + TypeScript로 마이그레이션하는
저장소다. 마이그레이션이 끝날 때까지 운영은 backend-java가 담당한다.

## 문서 지도

| 문서 | 내용 |
|---|---|
| [DESIGN.md](DESIGN.md) | 시스템 설계 정본 — 원칙·불변식·하위 시스템 인덱스 |
| [PLANS.md](PLANS.md) | 마이그레이션 단계·상태 표·워크플로우 |
| [AGENTS.md](AGENTS.md) | 에이전트·개발자 작업 프로토콜 (Understand → Implement → Reconcile) |
| [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) | 작업 중 발견 기록 (working memory) |
| `docs/design/` | 하위 시스템 설계 (realtime · rooms · game-modules · games/{yacht,duel,pingpong} · reconnect · auth · voice · persistence · operations) |
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
