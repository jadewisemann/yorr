# YORR Frontend — 에이전트 작업 프로토콜

> 이 파일이 `frontend/` 안에서 일하는 방식의 **정본(canonical policy)** 이다.
> Claude Code는 [`CLAUDE.md`](CLAUDE.md)를 통해 이 파일로 안내된다.
> Git 협업 규칙은 루트 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)를 그대로 따른다.

## 무엇이 진실인가 (source of truth)

| 대상 | 정본 | 비고 |
|---|---|---|
| 설계·불변식 | [`DESIGN.md`](DESIGN.md) | 코드에서 아키텍처를 역추론하지 않는다 |
| 하위 시스템 상세 | `docs/llmwiki/*.md` | DESIGN.md의 지도에서 필요한 것만 연다 |
| 실측값·실패한 대안·함정 | [`docs/llmwiki/code-rationale.md`](docs/llmwiki/code-rationale.md) | 값을 바꾸거나 "단순화"하기 전에 먼저 찾아본다 |
| 결정의 이유 | `docs/adr/*.md` | "왜 이렇게 안 했는가" |
| 진행 중 변경 계획 | [`PLANS.md`](PLANS.md) | 와이어 계약 동결·이관 티켓 · **디자인 시스템 진행 상태**(스타일 작업 전 필독) |
| 작업 중 발견 | [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md) | 휘발성 working memory |
| 와이어 계약·카탈로그·토큰 | 코드 (`wsEvents.ts` 등) | DESIGN.md의 「코드가 정본인 것들」 — 이 예외 목록만 코드가 이긴다 |

문서와 코드가 충돌하면 **조용히 코드를 따르지 않는다.** 구현이 틀렸는지 설계가
바뀐 것인지 판정한다 — 의도가 바뀐 것이면 DESIGN.md(또는 해당 llmwiki 페이지)를
고치고, 구현이 틀린 것이면 구현을 고친다. 판정 근거는 IMPLEMENTATION_NOTES.md에
남긴다. (사람용 문서 `README.md`·`docs/architecture.md`는 읽을 필요 없다.)

## 작업 사이클: Understand → Implement → Reconcile

### 1. Understand — 코드보다 모델 먼저

1. `DESIGN.md`에서 관련 원칙·불변식을 읽는다.
2. 지도가 가리키는 `docs/llmwiki/*.md`에서 해당 하위 시스템만 읽는다. 관련 없는
   문서는 열지 않는다.
3. `IMPLEMENTATION_NOTES.md`와 `code-rationale.md`에서 관련 발견·함정을 확인한다.
4. 필요한 코드만 조사하고, 변경이 설계에 어떻게 들어맞는지 설명할 수 있어야
   구현을 시작한다.

### 2. Implement — 모델 안에서 구현

5. 구현한다. 설계 위반이 필요해 보이면 멈추고 DESIGN.md/ADR 쪽 논의로 돌아간다.
6. 아래 「검증」·「테스트 최소화 원칙」에 따라 작업 범위만큼만 검증한다.
7. 발견한 숨은 불변식·실측값·edge case·실패한 접근은 날짜와 함께
   `IMPLEMENTATION_NOTES.md`에 기록한다.

### 3. Reconcile — 모델을 현실에 맞춘다

8. `git diff`를 DESIGN.md·관련 llmwiki 페이지와 대조한다 — 새 숨은 가정이
   생기지 않았는가? 문서가 서술하는 동작이 바뀌지 않았는가?
9. 바뀌었으면 문서를 갱신한다. 구조적 결정이 새로 내려졌으면 ADR을 추가한다.
10. IMPLEMENTATION_NOTES.md의 영구 지식은 성격에 따라 승격한다 — 설계·불변식은
    DESIGN.md, 동작 상세는 해당 llmwiki 페이지, 함정·실측값은 code-rationale.md.
    승격한 항목은 notes에서 지운다.

강제되는 것은 "문서 수정"이 아니라 **"문서와의 일관성 검토"** 다. 단순 스타일
변경에 의미 없는 문서 diff를 만들지 않는다.

> Claude Code에는 이 검토가 훅으로도 걸려 있다
> (`.claude/hooks/design-review-gate.mjs`): 아키텍처 민감 영역
> (`src/realtime/`, `src/games.ts`, `src/store.ts`, `src/*/domain/`)이 문서 변경
> 없이 커밋되려 하면 그 변경에 대해 **한 번** 멈추고 검토를 요구한다. 검토 후
> 문서 변경이 불필요하면 같은 커밋을 다시 실행하면 통과된다.

## 터미널 실행

- 모든 터미널 명령은 사용자 프로필을 로드하지 않는 non-login shell로 실행한다.

## 검증 명령

```bash
npm run check          # biome lint + format
npm run typecheck      # 타입 검사
npm test               # 단위·컴포넌트 테스트
npm run build          # 프로덕션 빌드
npm run check:cycles   # 순환 의존 검사
npm run test:e2e       # E2E (mock 백엔드)
```

작업을 마치기 전 **작업 범위에 필요한 검증만** 실행한다. 모든 명령을 관성적으로
실행하지 않는다.

## 테스트 최소화 원칙

- 테스트는 명확한 회귀 위험이나 완료 조건이 있을 때만 작성·실행한다.
- Tailwind 설정, 디자인 토큰, 정적 스타일, 단순 마크업 변경은 기본적으로
  `typecheck`와 `build`까지만 검증한다.
- React Testing Library는 사용자 interaction, 접근성 상태, 조건부 렌더링처럼
  컴포넌트 동작을 보장해야 할 때만 사용한다.
- Playwright E2E는 실제 사용자 흐름, 다중 사용자 상태, 브라우저 호환성이 해당
  티켓 범위에 명시된 경우에만 실행한다.
- 모바일 Chrome·Safari 테스트는 실기기·브라우저 검증 티켓 또는 사용자의 명시적
  요청이 없으면 실행하지 않는다.
- 미래 요구를 예상한 테스트, 구현과 같은 내용을 반복하는 테스트, 단순 렌더링
  확인용 테스트는 추가하지 않는다.
- 기존 테스트가 변경 범위와 직접 관련되면 해당 테스트만 우선 실행한다. 전체
  테스트는 통합·배포 단계에서 실행한다.
- UI 변경의 시각 검토도 해당 티켓의 완료 조건일 때만 수행한다.

검증 개수를 작업 품질로 간주하지 않는다. 작업 위험과 완료 조건에 비례해 검증한다.

## 코드 배치

`src/` 구조와 경계 규칙은 [`DESIGN.md`](DESIGN.md)의 「핵심 원칙」·「코드 구조」를
따른다. 디자인이 확정되지 않은 상태에서 pixel-perfect 작업을 임의로 확대하지
않는다.
