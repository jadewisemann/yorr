# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - Phase 0 백본

- 프론트 envelope은 `{type, ts, payload, roomId?, msgId?}`이고 `ts`·`payload`가
  필수다(`wsEvents.ts`의 `WsEnvelope`). 서버 파서도 필수로 검증하게 했다 —
  Java 쪽이 실제로 어디까지 관용적으로 받는지는 Phase 1에서 `handler/` 이식 시 확인 필요.
- `wsEvents.ts`는 야추 도메인 타입(`YachtCategory` 등)을 직접 import한다 —
  프론트 CLAUDE.md에 "알려진 경계 예외"로 기록된 상태. 게임 무관 envelope +
  게임별 payload로 가르는 일은 프론트 티켓이므로 서버는 현 계약을 그대로 구현한다.
- `.env` 로딩은 dotenv 대신 Node 22 내장 `process.loadEnvFile()` 사용. 파일이
  없으면 던지므로 `existsSync` 가드를 둔다.
- 헬스체크 경로를 `/actuator/health`로 유지했다. 배포 검증(Jenkinsfile Verify
  Backend)과 모니터링이 경로를 알고 있기 때문 — 경로 변경은 Phase 5에서 파이프라인과
  함께서만.
- Jenkinsfile의 `docker compose ... up backend`의 `backend`는 **compose 서비스
  이름**이지 폴더 경로가 아니다. 폴더 rename에서 바꾸면 안 된다(안 바꿨음).
- biome은 프론트 설정을 따르되 `lineEnding`만 `lf`로 했다(서버는 Linux 컨테이너
  전제). 프론트는 `crlf`를 쓴다.
