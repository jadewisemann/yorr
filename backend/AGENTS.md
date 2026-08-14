# YORR Backend — 에이전트 작업 프로토콜

> 이 파일이 `backend/` 안에서 일하는 방식의 **정본(canonical policy)** 이다.
> Claude Code는 [`CLAUDE.md`](CLAUDE.md)를 통해 이 파일로 안내된다.
> Git 협업 규칙은 루트 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)를 그대로 따른다.

## 무엇이 진실인가 (source of truth)

| 대상 | 정본 | 비고 |
|---|---|---|
| 시스템 설계·불변식 | [`DESIGN.md`](DESIGN.md) | 코드에서 아키텍처를 역추론하지 않는다 |
| 하위 시스템 상세 | `docs/design/*.md` | DESIGN.md의 인덱스에서 필요한 것만 연다 |
| 결정의 이유 | `docs/adr/*.md` | "왜 이렇게 안 했는가"는 여기에 있다 |
| 진행 중 변경 계획 | [`PLANS.md`](PLANS.md) | 마이그레이션 단계와 완료 기준 |
| 작업 중 발견 | [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md) | 휘발성 working memory |
| WebSocket 와이어 계약 | `../frontend/src/realtime/wsEvents.ts` | **프론트가 정본이다.** 서버가 임의로 바꾸지 않는다 |
| 마이그레이션 대상 동작 | `../backend-java/` | 읽기 전용 참조 구현. 여기 코드는 수정하지 않는다 |

문서와 코드가 충돌하면 **조용히 코드를 따르지 않는다.** 구현이 틀렸는지, 설계가
바뀐 것인지 판정하고 — 의도가 바뀐 것이면 DESIGN.md를 고치고, 구현이 틀린 것이면
구현을 고친다. 판정 근거는 IMPLEMENTATION_NOTES.md에 남긴다.

## 작업 사이클: Understand → Implement → Reconcile

모든 작업(포팅 티켓 하나 포함)은 이 3단계를 거친다.

### 1. Understand — 코드보다 모델 먼저

1. `DESIGN.md`에서 관련 원칙·불변식을 읽는다.
2. 인덱스가 가리키는 `docs/design/*.md`에서 해당 하위 시스템만 읽는다.
3. `IMPLEMENTATION_NOTES.md`에서 관련 발견·제약을 확인한다.
4. 포팅 작업이면 `backend-java/`의 대응 구현과 **그 테스트**를 읽는다 —
   테스트가 곧 이식해야 할 동작 명세다.
5. 필요한 코드만 조사하고, 변경이 현재 설계에 어떻게 들어맞는지 설명할 수 있어야
   구현을 시작한다.

### 2. Implement — 모델 안에서 구현

6. 구현한다. 설계 위반이 필요해 보이면 구현을 멈추고 DESIGN.md/ADR 쪽 논의로 돌아간다.
7. 테스트를 작성·실행한다. 포팅이면 backend-java 테스트 케이스를 vitest로 옮긴다.
8. 작업 중 발견한 숨은 불변식, 성능 제약, edge case, 실패한 접근은 즉시
   `IMPLEMENTATION_NOTES.md`에 날짜와 함께 기록한다.

### 3. Reconcile — 모델을 현실에 맞춘다

9. `git diff`를 DESIGN.md와 대조한다 — 새 숨은 가정이 생기지 않았는가?
10. 정신 모델이 바뀌었으면 DESIGN.md(또는 해당 `docs/design/*.md`)를 갱신한다.
11. IMPLEMENTATION_NOTES.md의 발견 중 영구 지식은 DESIGN.md로 **승격**하고,
    notes에서는 지운다. 구조적 결정이 새로 내려졌으면 ADR을 추가한다.
12. PLANS.md의 해당 단계 체크리스트를 갱신한다.

강제되는 것은 "DESIGN.md 수정"이 아니라 **"DESIGN.md와의 일관성 검토"** 다.
단순 버그 수정에 의미 없는 문서 diff를 만들지 않는다.

## 마이그레이션 규칙

- **와이어 계약 동결.** REST 경로·응답 모양과 WebSocket 메시지는
  backend-java와 같아야 한다. 프론트엔드는 이 마이그레이션으로 한 줄도 바뀌지
  않는 것이 목표다 ([ADR-0002](docs/adr/0002-strangler-wire-contract.md)).
- **backend-java는 동결.** 참조로만 읽는다. 운영 hotfix는 별도 브랜치의 별도
  작업이며 이 마이그레이션과 섞지 않는다.
- **게임 하나 = 수직 슬라이스.** 레이어 전체를 한 번에 옮기지 않고, 게임(또는
  기능) 단위로 REST + WS + 상태 + 테스트를 끝까지 옮겨 프론트로 검증한다.
- 동작 차이를 발견하면(버그 포함) 그대로 이식할지 고칠지를 IMPLEMENTATION_NOTES.md에
  기록하고 결정한다. 조용히 "개선"하지 않는다.

## 검증 명령

```bash
npm run check        # biome lint + format
npm run typecheck    # tsc
npm test             # vitest
npm run build        # tsc 빌드
```

작업 범위에 필요한 검증만 실행한다. 게임 슬라이스가 끝나면 프론트의
`npm run test:e2e:real`(frontend/, 이 서버를 띄운 채)로 계약을 검증한다.

## 코드 배치

`src/` 구조와 경계는 [`DESIGN.md`](DESIGN.md)의 「코드 구조」를 따른다.
테스트는 소스와 같은 폴더의 `__tests__/`에 둔다(프론트와 같은 규칙).
