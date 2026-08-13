# YORR Frontend

React 기반의 YORR 모바일 웹 클라이언트입니다. 휴대폰을 흔들고, 휘두르고, 탭하며 즐기는
실시간 멀티플레이 게임을 앱 설치 없이 모바일 브라우저에서 바로 플레이할 수 있게 합니다.

- 구조와 설계가 궁금하면 → [`docs/architecture.md`](docs/architecture.md)
- 특정 기능의 동작 상세가 궁금하면 → [`docs/llmwiki/`](docs/llmwiki/index.md) (레퍼런스 위키)
- AI 에이전트로 작업한다면 → [`CLAUDE.md`](CLAUDE.md)

## 기술 스택

| 영역 | 기술 |
|---|---|
| 코어 | React 19, TypeScript (strict), Vite |
| 라우팅 · 상태 | TanStack Router, Zustand |
| 스타일 · 모션 | Tailwind CSS 4 (CSS-first `@theme`), Motion |
| 3D · 물리 | Three.js, Rapier (`@dimforge/rapier3d-compat`) |
| 실시간 | WebSocket (자체 wire contract), WebRTC 음성 채팅 |
| 테스트 | Vitest, Testing Library, Playwright, MSW |
| 품질 도구 | Biome, dpdm (순환 의존 검사) |

## 시작하기

```bash
npm install
cp .env.example .env.local
npm run dev
```

`http://localhost:5173`에서 확인할 수 있습니다. 기본 개발 모드는 MSW로 API를 모의하므로
**백엔드 없이도 전체 UI가 동작합니다.**

로컬 백엔드와 연결하려면 `.env.local`을 아래처럼 설정하고 실서버 모드로 실행합니다.

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_WS_URL=/ws/v1/game
VITE_ENABLE_MSW=false
VITE_BACKEND_ORIGIN=http://localhost:8080
```

```bash
npm run dev:real
```

## 검증 명령

```bash
npm run check        # Biome lint + format 검사
npm run typecheck    # TypeScript 타입 검사
npm test             # Vitest 단위·컴포넌트 테스트
npm run build        # 프로덕션 빌드
npm run test:e2e     # Playwright E2E (mock 백엔드)
```

Playwright 브라우저가 없다면 최초 한 번 `npx playwright install`을 실행합니다.
실제 센서 권한과 동작 품질은 갤럭시 Chrome 및 iPhone Safari 실기기에서 별도로 확인해야
합니다.

## 폴더 구조

`src/` 바로 아래는 **도메인**이고, 레이어(`screens` · `components` · `api` …)는 도메인
안에 둡니다.

```text
src/
├── app/        # 라우터, 전역 provider, 앱 부팅 (개발 전용 화면은 app/dev/)
├── landing/    # 랜딩 화면과 히어로 연출
├── auth/       # 카카오·구글 로그인과 세션
├── room/       # 방 생성·입장·로비, 게임을 띄우는 껍데기 (GamePage)
├── yacht/      # 요트 다이스 — 규칙·화면·3D 주사위 물리·모션 입력
├── pingpong/   # 탁구 — 실시간 랠리·폰 스윙 컨트롤러·AI 모드
├── duel/       # 석양이 진다 — 반응 속도 대결
├── shared/     # 프리미티브 UI, 공용 훅, REST client, cn()
├── realtime/   # WebSocket wire contract(wsEvents.ts)와 연결 client — FE/BE 공유 SSOT
├── mocks/      # MSW handler와 fixture
├── test/       # 단위 테스트 하네스
├── styles/     # 디자인 토큰 (2계층: 원시값 → semantic)
├── games.ts    # 게임 카탈로그 SSOT
└── store.ts    # Zustand 전역 store
```

- 테스트는 소스와 같은 폴더의 `__tests__/`에 둡니다.
- 도메인·레이어를 넘는 import만 `@/` alias를 씁니다 (`@/room/api/roomApi`). 같은 폴더
  안은 상대경로 — `@/`가 보이면 경계를 넘는다는 뜻입니다.

## 아키텍처 한눈에 보기

- **서버가 방·게임 상태의 최종 권위자**입니다. 클라이언트는 WebSocket 이벤트와 재접속
  스냅샷으로 상태를 동기화하고, 음성만 WebRTC P2P로 주고받습니다.
- 의존 방향은 사용자 흐름 순서로 **단방향**입니다: `app → landing → room → 게임`.
  `auth` · `shared` · `realtime` · `games.ts` · `store.ts`는 어디서나 참조하는 경계
  모듈입니다. 순환은 CI(`npm run check:cycles`)가 막습니다.
- 도메인 안은 `screens` / `components` / `domain`(순수 규칙) / `api` 는 공개,
  `model`(상태·훅) / `rendering`(three.js·rapier) 은 비공개 세그먼트로 나눕니다.
  비공개 세그먼트의 외부 import는 Biome이 막습니다.

왜 이렇게 생겼는지, 상태를 어떻게 나누는지는 [`docs/architecture.md`](docs/architecture.md)에서
이어서 읽을 수 있습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | 사람용 아키텍처 문서 — 구조·의존 방향·상태 설계와 그 이유 |
| [`docs/llmwiki/`](docs/llmwiki/index.md) | 레퍼런스 위키 — 도메인별 동작 상세. AI 에이전트 컨텍스트 겸용 |
| [`docs/portfolio/`](docs/portfolio/index.md) | 프론트엔드 담당자의 포트폴리오 자료 (코드베이스 문서 아님) |
| [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) | AI 에이전트 작업 지침 |

문서와 코드가 다르면 **항상 코드가 이깁니다.**
