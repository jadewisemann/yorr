# 정유진 — YORR 프론트엔드 포트폴리오 위키

> 기준일: 2026-08-13 · 근거: 이 저장소의 git 히스토리 (author `jadewisemann@gmail.com` · `Jade Wisemann`)

이 디렉터리는 YORR(요르) 프로젝트에서 **정유진(프론트엔드 엔지니어)** 이 수행한 작업을
git 히스토리에서 추출해 정리한 **LLM 위키**다. 사람이 읽어도 되지만, 1차 용도는
LLM에게 맥락으로 주입해 이력서 불릿 · 자기소개서 · 면접 답변 · 포트폴리오 페이지를
생성시키는 것이다.

## LLM에게 먹이는 법

- **전체 맥락이 필요할 때**: 이 디렉터리의 모든 `.md`를 그대로 붙여 넣는다. 총량은 LLM
  컨텍스트에 충분히 들어가는 크기로 유지한다.
- **주제별 생성**: [index(이 문서)](./index.md) + [overview.md](./overview.md) + 해당 주제 문서 1개면 충분하다.
- **사실 검증**: 모든 주장에는 커밋 해시가 달려 있다. `git show <hash>`로 원문 확인이 가능하다.
- 각 문서 끝의 **"활용 포인트"** 절은 이력서/면접용 문장의 원료다. 그대로 쓰지 말고
  지원 공고의 키워드에 맞춰 변형하도록 LLM에 지시한다.

## 프로필 스냅샷

| 항목 | 내용 |
|---|---|
| 이름 | 정유진 (GitHub: [@jadewisemann](https://github.com/jadewisemann)) |
| 역할 | 프론트엔드 엔지니어 · develop 브랜치 통합(머지) 담당 |
| 프로젝트 | YORR(요르) — 휴대폰 센서로 즐기는 실시간 멀티플레이 웹 게임 플랫폼 (SSAFY 팀 프로젝트, 6인) |
| 확인 가능 활동 기간 | 2026-07-29 ~ 2026-08-10 (이 미러 저장소 기준) |
| 커밋 | 본인 저작 50개 + 통합 머지 74개 = 총 124개 |
| 코드 기여 | frontend 약 +54,700 / −11,100 라인 (lock·에셋 제외), backend +1,488 라인 |
| 핵심 스택 | React 19 · TypeScript · Vite · Zustand · TanStack Router · Three.js · Rapier(WASM) · WebSocket · Tailwind CSS 4 · Vitest · Playwright · (일부 Java/Spring) |

## 문서 표

| 문서 | 주제 | 이럴 때 쓴다 |
|---|---|---|
| [overview.md](./overview.md) | 프로젝트·역할·기여 규모 | 자기소개서 서두, "프로젝트 소개" 단락 |
| [dice-physics.md](./dice-physics.md) | 3D 주사위 물리 — 결정론적 예측 시뮬 + 서버 권위 동기화 | 기술 깊이를 보여줄 대표작 1순위 |
| [realtime-session-recovery.md](./realtime-session-recovery.md) | 실시간 세션 복구 — FSM · heartbeat · 재접속 | 상태 설계·실시간 시스템 역량 |
| [cross-stack-debugging.md](./cross-stack-debugging.md) | 백엔드까지 파고든 디버깅 — 지연 보상 · 스케줄러 레이스 · 배포 롤백 판단 | 문제 해결 스토리, 꼬리 질문 대비 |
| [testing-infrastructure.md](./testing-infrastructure.md) | 테스트 인프라 — 2단 E2E 하네스 · 커버리지 안전망 | 품질/생산성 역량 |
| [architecture-and-design-system.md](./architecture-and-design-system.md) | 도메인 우선 구조 재편 · 디자인 시스템 · 문서 체계 | 설계·리드 역량 |
| [product-features.md](./product-features.md) | 제품 기능 — 파티 모드 · 빠른 대전 · 컨트롤러 모드 · 랜딩 | 제품 감각, 기능 목록 |
| [fact-sheet.md](./fact-sheet.md) | 본인 저작 커밋 50개 전체 원장 | 근거 대조, 세부 사실 확인 |

## 정직성 원칙 (LLM 준수 사항)

이 위키로 글을 생성할 때 다음을 지킨다.

1. **여기 적힌 사실 범위를 넘는 과장 금지.** 수치·기간·역할은 이 위키에 적힌 그대로만 쓴다.
2. 팀 공동 산출물(예: `wsEvents.ts` 계약 파일 자체)은 "참여"로, 본인 커밋으로 확인되는
   것만 "주도/구현"으로 표현한다.
3. 일부 커밋은 AI 페어 프로그래밍으로 작성됐고 커밋에 `Co-Authored-By`로 명시돼 있다
   ([fact-sheet.md](./fact-sheet.md)에 표기). 물어보면 숨기지 않고, AI를 도구로 활용해
   생산성을 높인 사례로 설명한다.
