# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·실측값·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식은 성격에 따라 승격하고 여기서 지운다 —
> 설계·불변식은 [DESIGN.md](DESIGN.md), 동작 상세는 해당 llmwiki 페이지,
> 함정·실측값은 [code-rationale.md](docs/llmwiki/code-rationale.md).
> 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - 문서 체계 전환 (ADR-0001)

- 동기화 기준선: llmwiki는 2026-08-13 전면 개편본(코드에서 추출·작성)이고,
  전환 시점에 구조 주장을 코드와 대조해 확인했다 — `src/` 도메인 구성,
  biome `noRestrictedImports`(duel·landing·pingpong·yacht), `check:cycles`
  스크립트, `games.ts` 카탈로그, `wsEvents.ts` envelope 모양.
- `.dev.md`(git 미추적, 티켓 215 측정 근거)는 그대로 둔다. 앞으로의 작업 발견은
  이 파일(추적됨)에 적는다 — 세션이 끝나도 팀에 남게.
- 티켓 25: `sys.reconnect`는 서버에 라우팅이 없어 보내면 조용히 버려진다.
  재접속은 `room.join` 재전송으로 통일되어 있다(`app/RealtimeSync.tsx`).
  백엔드 마이그레이션 Phase 1·2에서 이 실제 동작이 계약이다 — 문서상 이벤트
  목록만 보고 sys.reconnect를 구현 대상으로 잡지 말 것.
