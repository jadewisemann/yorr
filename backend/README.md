# YORR Backend (Node.js)

YORR의 API 및 실시간 게임 서버다. 진행 중인 계약 변경과 하위 시스템 상태는
[PLANS.md](PLANS.md)에 있다.

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

Node.js ≥ 22.13 · TypeScript · Fastify · ws · zod · `node:sqlite` ·
Vitest · Biome (선정 근거: [ADR-0003](docs/adr/0003-node-fastify-stack.md),
저장소·DB를 프로세스 안에 둔 이유: [ADR-0007](docs/adr/0007-botkeep-single-process.md))

## 시작하기

```bash
cd backend
cp .env.example .env   # 필요한 값만 채우면 된다 — 외부 Redis·DB가 필요 없다
npm ci
npm run dev
```

- Health check: `http://localhost:8080/actuator/health`
- WebSocket: `ws://localhost:8080/ws/v1/game` (`sys.connected` → `sys.ping`/`sys.pong`)

## 검증

```bash
npm run check        # biome lint + format
npm run typecheck    # tsc
npm test             # vitest (통합 테스트 포함 — 건너뛰는 것이 없다)
npm run build        # 프로덕션 빌드 (dist/)
npm run build:botkeep  # Botkeep 배포 번들 (../deploy/botkeep/out/)
```

DB는 `data/yorr.db`(SQLite)에 생긴다. 방·세션·진행 중 게임은 프로세스 안에만 있어
재시작하면 사라진다([ADR-0007](docs/adr/0007-botkeep-single-process.md)).
