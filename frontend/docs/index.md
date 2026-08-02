# YORR 프론트엔드 문서

> 기준일: 2026-08-01

이 디렉터리는 프론트엔드가 실제로 어떻게 동작하는지 설명하는 **소수의 최신 문서**만 보관한다.
지난 스프린트 로그, 지나간 발표 자료, 이식이 끝난 프로토타입 복사본처럼 더 이상 참고할 필요가
없는 자료는 보관하지 않는다 — 필요하면 git 히스토리에서 찾는다.

**에이전트는 이 문서 하나만 인덱스로 삼는다.** 아래 표에서 필요한 파일만 골라 열고, 관련 없는
문서는 열지 않는다. 자세한 읽기 원칙은 [`../CLAUDE.md`](../CLAUDE.md)를 따른다.

## 가장 먼저 볼 문서

- [현재 적용 기준](./current-baseline.md) — 제품 범위, 방 역할, 계정/로그인, 실제 라우트,
  안전장치를 한 곳에 모은 요약. 대부분의 질문("지금 뭘 기준으로 만드나?")은 이 문서 하나로
  끝난다.

## 전체 문서 표

| 폴더 | 문서 | 이럴 때 읽는다 |
|---|---|---|
| `engineering/` | [architecture-and-stack.md](./engineering/architecture-and-stack.md) | `src/` 디렉터리 구조, 상태 설계, 확정 기술 스택, 의존 방향, 테스트 전략 |
| `engineering/` | [design-system.md](./engineering/design-system.md) | Tailwind semantic token 구조, 공통 컴포넌트 규칙 |
| `api/` | [realtime-and-api.md](./api/realtime-and-api.md) | WebSocket 이벤트·에러 코드, REST 엔드포인트 — 배경 설명용. 정확한 타입은 `../src/realtime/wsEvents.ts`가 SSOT |
| `product/` | [user-flow.md](./product/user-flow.md) | 진입~결과까지 실제 화면 흐름 (Mermaid) |
| `product/` | [yacht-rules.md](./product/yacht-rules.md) | 요트다이스 12개 카테고리와 점수 규칙 |

## 단일 기준 원칙

같은 주제의 문서 내용이 코드와 충돌하면 **항상 코드가 이긴다.** 특히 WebSocket 타입은
[`../src/realtime/wsEvents.ts`](../src/realtime/wsEvents.ts), Git 협업 규칙은 루트
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)가 SSOT다.

문서가 코드와 어긋난 걸 발견하면 그 문서를 고치거나 지운다 — 어긋난 채로 남겨두지 않는다.
이 디렉터리는 git으로 추적되므로 문서 변경도 코드 변경과 같은 브랜치·리뷰 절차를 따른다.

## 이 디렉터리에 새 문서를 추가할 때

- 작은 단위로 쪼갠다. 한 파일이 여러 주제를 다루게 하지 않는다.
- 이 표에 한 줄을 추가한다. 표에 없는 문서는 없는 것과 같다.
- "구현 전 검토안", "스프린트 로그", "발표 자료"처럼 유효기간이 있는 문서는 이 디렉터리에 두지
  않는다 — 완료 후에는 지운다.
