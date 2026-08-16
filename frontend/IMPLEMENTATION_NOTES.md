# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·실측값·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식은 성격에 따라 승격하고 여기서 지운다 —
> 설계·불변식은 [DESIGN.md](DESIGN.md), 동작 상세는 해당 llmwiki 페이지,
> 함정·실측값은 [code-rationale.md](docs/llmwiki/code-rationale.md).
> 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-16 - 문서·코드 불일치 감사와 판정

AGENTS.md의 판정 절차("조용히 코드를 따르지 않는다 — 의도가 바뀐 것이면 문서를,
구현이 틀린 것이면 구현을 고친다")를 문서 주장 전수에 적용했다. 판정 결과 7건.

**문서가 낡은 것 → 문서를 고쳤다 (3건)**

- `design-system.md` "레시피 5종" → 실제 7종. **개수를 지우고 recipes.css 참조로
  바꿨다.** 숫자는 코드가 자라면 반드시 어긋난다 — 이 감사의 진짜 교훈이다.
- `shared-ui.md` "Icon 고정 10종" → 실제 11개(`IconShake` 추가). 같은 처방.
- `CONTRIBUTING.md` "main은 Protected Branch로 잠가둔다" → **실제로는 안 켜져
  있다**(GitHub API `protected: false`). 문서를 믿고 `git push origin main`을 치면
  그대로 들어가므로 오기 중 가장 위험했다. 규칙("직접 push 금지")과 현재
  상태("강제 수단 없음")를 분리해 서술했다. 켜는 조건은 협업자 합류 시점 —
  리뷰어 필수 복구와 묶는다.

**구현이 틀린 것 → 문서는 그대로 두고 부채로 기록 (4건)**

규칙 자체는 옳으므로 문서를 완화하지 않는다. PLANS.md "남은 격차"에 있다.

| 규칙 | 위반 |
|---|---|
| `design-system.md` 규칙 1 "공통 Button 우선" | 생 `<button>` 93개 |
| 사다리 "눈대중 `white/NN` 금지" | 49곳(알파 7종) |
| 화면 프레임 "`h-svh` 껍데기 금지" | 10곳 (이번 세션에 22 → 10) |
| DESIGN.md 원칙 7 "200줄 기준선, 넘길 때 이유를 남긴다" | 10개 초과. `duel/components/Arena.tsx` 915줄(4.6배)·`app/RealtimeSync.tsx` 358줄·`yacht/screens/GamePlay.tsx` 334줄 — **셋 다 이유 주석이 없다** |

**공통 패턴 — 재발 방지책**

넷 다 "금지 규칙을 새로 적으면서 **기존 재고를 안 치우고** 넘어간" 것이다. 새
코드는 규칙을 따랐지만 재고가 남아 규칙이 무력화됐다. 이번 세션의 `card/panel`
규칙과 `gap` 6단은 재고까지 치우고 썼고, 그래서 지금 위반 0이다. **규칙을 적을
때 기존 위반 수를 세고, 치우거나 부채로 티켓을 남긴다.**

**확인했더니 문제 아니었던 것**

- `active:scale-*` 6곳 — 규칙이 예외 2종을 허용한다(24px 이하 글리프, 눌림 빼는
  자리). 개별 확인은 남았지만 즉시 위반은 아니다.
- `docs/llmwiki/index.md`가 DESIGN.md 지도에 없다 — DESIGN.md로 보내는 리다이렉트
  스텁이라 의도된 것이다.
- 배럴 `index.ts` 0개, Tailwind 기본 라운드(`rounded-2xl` 등) 0곳 — 완전 준수.
- DESIGN.md의 경계 예외 2건은 여전히 존재하지만 **문서가 이미 정직하게 기록**하고
  이관 티켓까지 달아 뒀다. 불일치가 아니다.

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
