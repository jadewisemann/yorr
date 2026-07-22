# YORR Frontend

React, Vite, TypeScript 기반의 YORR 모바일 웹 클라이언트다. 구조와 기술 선택의 기준은
[`docs/frontend-architecture-and-stack.md`](docs/frontend-architecture-and-stack.md)를 따른다.

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

- `src/app`: 라우터, 전역 상태, 앱 부팅
- `src/features`: 화면 흐름별 기능
- `src/core`: API, 실시간 연결, 입력, 피드백, 세션
- `src/domain/yacht`: 네트워크와 분리된 순수 게임 규칙
- `src/shared`: 공통 UI, 유틸리티, 디자인 토큰
- `src/contracts`: 프론트엔드와 백엔드가 공유하는 wire contract의 TypeScript SSOT
