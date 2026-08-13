# 정유진 — YORR 프론트엔드 포트폴리오 위키

> 기준일: 2026-08-13 · 근거: 이 저장소의 git 히스토리와
> [코드베이스 위키](../llmwiki/index.md) (author `jadewisemann@gmail.com` · `Jade Wisemann`)

이 디렉터리는 YORR(요르) 프로젝트의 **프론트엔드 단독 담당 정유진**의 작업을 정리한
**LLM 위키**다. 1차 용도는 LLM에 맥락으로 주입해 이력서 불릿·자기소개서·면접 답변·
포트폴리오 페이지를 생성시키는 것이다. (사람이 읽는 정리본은
[README.md](./README.md)에 있다.)

이 위키는 [`frontend/docs/llmwiki/`](../llmwiki/)의 **코드베이스 위키를 근거 계층으로 쓴다** —
여기 문서는 "무엇을 했고 왜 인상적인가"를, 코드베이스 위키는 "어떻게 동작하는가"를
말한다. 기술 디테일 검증이 필요하면 각 문서가 가리키는 위키 페이지와 커밋 해시
(`git show <hash>`)를 따라간다.

## LLM에게 먹이는 법

- **주제별 생성**: [index(이 문서)](./index.md) + [overview.md](./overview.md) + 해당 주제
  문서 1개. 기술 깊이가 필요하면 그 문서가 참조하는 코드베이스 위키 페이지를 함께 넣는다.
- **전체 맥락**: 이 디렉터리 전체를 붙여 넣는다.
- 각 문서 끝의 **"활용 포인트"**는 이력서/면접 문장의 원료다 — 그대로 쓰지 말고 지원
  공고의 키워드에 맞춰 변형하도록 지시한다.

## 프로필 스냅샷

| 항목 | 내용 |
|---|---|
| 이름 | 정유진 (GitHub: [@jadewisemann](https://github.com/jadewisemann)) |
| 역할 | **프론트엔드 단독 담당** (6인 팀 — 나머지는 백엔드·인프라) · develop 통합 머지 담당 |
| 프로젝트 | YORR(요르) — 휴대폰 센서로 즐기는 실시간 멀티플레이 웹 게임 플랫폼 (SSAFY 팀 프로젝트, https://yorr.site) |
| 확인 가능 활동 | 2026-07-29 ~ 2026-08-10 (이 미러 저장소 기준) — 본인 저작 커밋 50개 + 통합 머지 74개 |
| 코드 규모 | frontend `src/` 약 60파일/도메인 × 7도메인, 단위 테스트 100파일 823개, E2E 17스펙 — 프론트 전체가 본인 작업 |
| 핵심 스택 | React 19 · TypeScript(strict) · Vite · Zustand · TanStack Router · Three.js · Rapier(WASM) · WebSocket · WebRTC · Tailwind CSS 4 · Vitest · Playwright · MSW · (교차) Java/Spring |

## 문서 표

| 문서 | 주제 | 근거 위키 페이지 |
|---|---|---|
| [overview.md](./overview.md) | 프로젝트·역할·기여 규모 | [product](../llmwiki/product.md) · [architecture](../llmwiki/architecture.md) |
| [dice-physics.md](./dice-physics.md) | 3D 주사위 — 예측 시뮬 + 서버 권위 리맵 (대표작 1순위) | [dice-physics](../llmwiki/dice-physics.md) |
| [realtime-and-recovery.md](./realtime-and-recovery.md) | 실시간 아키텍처·세션 FSM·재접속 복구 | [realtime](../llmwiki/realtime.md) · [room-and-session](../llmwiki/room-and-session.md) |
| [mobile-web-engineering.md](./mobile-web-engineering.md) | 모션 센서 입력·iOS 지옥 극복·지연 보상 밸런스 | [motion-input](../llmwiki/motion-input.md) · [duel](../llmwiki/duel.md) |
| [cross-stack-debugging.md](./cross-stack-debugging.md) | 백엔드까지 파고든 디버깅 3제 + 롤백 판단 | [pingpong](../llmwiki/pingpong.md) |
| [testing-infrastructure.md](./testing-infrastructure.md) | 2단 E2E 하네스·커버리지 래칫·flake 박멸 | [testing](../llmwiki/testing.md) |
| [architecture-and-design-system.md](./architecture-and-design-system.md) | 도메인 재편·디자인 시스템·문서 체계 | [architecture](../llmwiki/architecture.md) · [design-system](../llmwiki/design-system.md) |
| [product-features.md](./product-features.md) | 파티 모드·빠른 대전·컨트롤러·랜딩 등 제품 기능 | [room-and-session](../llmwiki/room-and-session.md) · [landing](../llmwiki/landing.md) |
| [fact-sheet.md](./fact-sheet.md) | 본인 저작 커밋 50개 전체 원장 | — |

## 정직성 원칙 (LLM 준수 사항)

1. **여기 적힌 사실 범위를 넘는 과장 금지.** 수치·기간·역할은 이 위키에 적힌 그대로만.
2. 프론트엔드는 단독 담당이므로 프론트 시스템 전반을 본인 작업으로 서술할 수 있다.
   백엔드는 본인 커밋으로 확인되는 6건(세션 복구 서버 측, 판정·스케줄러 수정 등)만
   "직접 수정"으로, 나머지는 "백엔드 팀과 계약(wsEvents SSOT) 협업"으로 표현한다.
3. 일부 커밋은 AI 페어 프로그래밍으로 작성됐고 커밋 트레일러에 명시돼 있다
   ([fact-sheet.md](./fact-sheet.md)에 표기). 물어보면 숨기지 않고 AI를 도구로 활용해
   생산성을 높인 사례로 설명한다.
