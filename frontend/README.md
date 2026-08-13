# YORR Frontend

React, Vite, TypeScript 기반의 YORR 모바일 웹 클라이언트다. 구조와 기술 선택의 기준은
[`docs/wiki/architecture.md`](docs/wiki/architecture.md)를 따른다.
문서 전체 인덱스는 [`docs/index.md`](docs/index.md), 에이전트 작업 지침은 [`CLAUDE.md`](CLAUDE.md)를 참고한다.

## 시작하기

```bash
npm install
cp .env.example .env.local
npm run dev
```

기본 개발 서버는 `http://localhost:5173`에서 실행된다.

## 검증 명령

```bash
npm run check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright 브라우저가 없다면 최초 한 번 `npx playwright install`을 실행한다. 실제 센서 권한과
동작 품질은 갤럭시 Chrome 및 iPhone Safari 실기기에서 별도로 확인해야 한다.

## 디렉터리

`src/` 바로 아래는 도메인이고, 레이어(`screens` · `components` · `api` …)는 도메인 안에 둔다.

- `src/app`: 라우터, 전역 provider, 앱 부팅. 개발 전용 화면은 `app/dev/`
- `src/landing`: 랜딩 화면과 히어로 연출
- `src/auth`: 소셜 로그인·세션
- `src/room`: 방 생성·입장·로비, 게임을 띄우는 껍데기
- `src/yacht`: 야추 구현 — 규칙·화면·게임판·주사위 물리·센서 입력
- `src/shared`: 프리미티브 UI, 공용 훅, REST client, `cn`
- `src/realtime`: WebSocket wire contract(`wsEvents.ts`)와 연결 client — FE/BE 공유 SSOT
- `src/mocks`: MSW handler와 fixture
- `src/games.ts` · `src/store.ts` · `src/styles/`: 게임 카탈로그, 전역 상태, 디자인 토큰

테스트는 소스와 같은 폴더의 `__tests__/`에 둔다.

레이어를 넘는 import는 `@/` alias를 쓴다 (`@/room/api/roomApi`). 같은 폴더 안은 상대경로를 쓴다.
