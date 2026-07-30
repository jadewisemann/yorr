# YORR Frontend

React, Vite, TypeScript 기반의 YORR 모바일 웹 클라이언트다. 구조와 기술 선택의 기준은
[`docs/engineering/architecture-and-stack.md`](docs/engineering/architecture-and-stack.md)를 따른다.
문서 전체 인덱스는 [`docs/README.md`](docs/README.md), 에이전트 작업 지침은 [`CLAUDE.md`](CLAUDE.md)를 참고한다.

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

- `src/app`: 라우터, 전역 provider, 앱 부팅, 개발 전용 화면
- `src/screens`: URL에 대응하는 화면
- `src/components`: 재사용 UI 컴포넌트
- `src/api`: REST client와 호출 훅
- `src/realtime`: WebSocket wire contract(`wsEvents.ts`)와 연결 client — FE/BE 공유 SSOT
- `src/mocks`: MSW handler와 fixture
- `src/store.ts` · `src/cn.ts` · `src/styles/`: 전역 상태, class 병합, 디자인 토큰

레이어를 넘는 import는 `@/` alias를 쓴다 (`@/api/gameApi`). 같은 폴더 안은 상대경로를 쓴다.
