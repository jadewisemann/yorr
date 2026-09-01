<div align="center">
  <img src="frontend/public/mascot-favicon.svg" alt="YORR mascot" width="112" />

  # YORR (요르)

  **휴대폰을 흔들고, 휘두르고, 탭하며 함께 즐기는 실시간 웹 게임 플랫폼**

  [서비스 바로가기](https://yorr.site) · [프론트엔드 문서](frontend/README.md) · [백엔드 문서](backend/README.md) · [작업 지침](AGENTS.md)
</div>

## 소개

YORR는 별도 앱 설치 없이 모바일 브라우저에서 즐기는 멀티플레이 게임 서비스입니다.
방을 만들거나 빠른 대전으로 상대를 찾고, 초대 코드·링크·QR로 친구를 초대합니다.
휴대폰의 모션 센서가 게임 조작이 되고 — 주사위는 흔들어 굴리고, 탁구채는 폰을 휘둘러
칩니다 — 센서를 쓸 수 없는 환경에서도 화면 탭만으로 끝까지 플레이할 수 있습니다.

### 게임

| 게임 | 인원 | 조작 | 설명 |
|---|---:|---|---|
| 요트 다이스 | 1–6명 | 휴대폰 흔들기 · 화면 탭 | 최대 세 번 주사위를 굴리고 킵하며 12개 족보의 최고 점수를 완성합니다. |
| 탁구 | 1–2명 | 화면 탭 · 휴대폰 스윙 | 먼저 11점을 얻는 플레이어가 승리하는 빠른 랠리 게임입니다. |
| 석양이 진다 | 2명 | 화면 탭 · 휴대폰 휘두르기 | 신호에 맞춰 먼저 공격하는 반응 속도 대결입니다. |
| 다빈치 코드 | 2–4명 | 화면 탭 | 상대의 감춘 타일 숫자를 먼저 모두 맞히는 추리 게임입니다. |

라이어스 다이스와 낚시는 준비 중입니다.

### 주요 기능

- 게스트 입장 및 카카오·구글 소셜 로그인
- 방 생성, 초대 코드·링크·QR 참가, 빠른 대전 매칭
- WebSocket 기반 실시간 상태 동기화와 재접속 복구
- 모션 센서 조작과 화면 탭 대체 수단
- 큰 화면 + 휴대폰 컨트롤러를 연결하는 파티 모드
- 방 텍스트 채팅
- 큰 화면과 휴대폰 컨트롤러를 직접 잇는 WebRTC 링크 (서버 경유로 폴백)
- 주간 랭킹과 게임 결과 기록

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Router, Zustand |
| UI · 그래픽 | Tailwind CSS 4, Motion, Three.js, Rapier |
| Backend | Node.js 22, TypeScript, Fastify, ws |
| Data | MySQL 8, Redis 7 |
| Realtime | WebSocket, WebRTC |
| Test | Vitest, Testing Library, Playwright, MSW |
| Infra | Docker Compose, GitHub Actions, Vercel, Prometheus |

## 시스템 아키텍처

```text
Mobile / Desktop Browser
        │
        ├── REST API ───────────────┐
        ├── WebSocket ──────────────┤
        └── WebRTC DataChannel      │
             휴대폰 ↔ 큰 화면        ▼
             (파티 모드)   Node 백엔드
                             │              │
                             ▼              ▼
                          MySQL           Redis
                      계정·전적·랭킹   방·세션·게임 상태
```

서버가 방과 게임 상태의 최종 권위자이며, 클라이언트는 WebSocket 이벤트와 재접속
스냅샷으로 상태를 동기화합니다. WebRTC로 직접 주고받는 것은 **서버가 판정하지 않는
데이터뿐**입니다 — 파티 모드에서 휴대폰 컨트롤러가 큰 화면에 보내는 연출 신호(주사위
흔들기·던지기)가 그것이고, 연결이 이루어지지 않으면 그 신호도 WebSocket으로 돌아갑니다.
연결을 위한 시그널링은 기존 WebSocket을 함께 사용합니다.

프론트엔드 내부 구조는 [frontend/docs/architecture.md](frontend/docs/architecture.md)에서
자세히 설명합니다.

## 폴더 구조

```text
.
├── frontend/              # React 모바일 웹 클라이언트
│   ├── src/               # 도메인 중심 애플리케이션 코드
│   ├── e2e/               # Playwright 브라우저 테스트
│   ├── docs/              # 아키텍처 문서 · 레퍼런스 위키(llmwiki) · ADR
│   └── DESIGN.md          # 프론트엔드 설계 정본(source of truth)
├── backend/               # Node.js + TypeScript API 및 실시간 게임 서버
│   ├── src/               # 애플리케이션 코드
│   ├── db/                # DB 마이그레이션
│   ├── docs/              # 설계 문서(design) · 의사결정 기록(adr)
│   ├── DESIGN.md          # 시스템 설계 정본(source of truth)
│   └── PLANS.md           # 마이그레이션 단계·상태 표
├── deploy/                # 운영용 Docker Compose·Caddy 설정
└── AGENTS.md              # 에이전트 작업·Git 협업 규칙
```

## 시작하기

### 준비 사항

- Node.js 22.12 이상과 npm
- Docker 및 Docker Compose

### 1. 백엔드 실행

```bash
cd backend
cp .env.example .env   # 필요한 값만 채우면 됩니다 — 백본은 Redis·MySQL 없이도 뜹니다
npm ci
npm run dev
```

소셜 로그인 기능을 개발하지 않는 경우 OAuth 관련 값은 비워 두어도 됩니다. 자세한
내용은 [backend/README.md](backend/README.md)를 참고하세요.

- API: `http://localhost:8080/api/v1`
- WebSocket: `ws://localhost:8080/ws/v1/game`
- Health check: `http://localhost:8080/actuator/health`

### 2. 프론트엔드 실행

새 터미널에서 다음 명령을 실행합니다.

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

기본 개발 모드는 MSW로 API를 모의하므로 **백엔드 없이도 UI를 확인할 수 있습니다.**
`http://localhost:5173`에서 접속합니다. 로컬 백엔드와 연결하는 방법은
[frontend/README.md](frontend/README.md)를 참고하세요.

> Windows PowerShell에서는 `cp` 대신 `Copy-Item .env.example .env` 또는
> `Copy-Item .env.example .env.local`을 사용할 수 있습니다.

## 테스트와 품질 검사

### Frontend

```bash
cd frontend
npm run check        # lint + format
npm run typecheck    # 타입 검사
npm test             # 단위·컴포넌트 테스트
npm run build        # 프로덕션 빌드
npm run test:e2e     # E2E (mock 백엔드)
```

실제 백엔드와 연결하는 E2E는 백엔드를 먼저 실행한 뒤 `npm run test:e2e:real`로 수행합니다.

### Backend

```bash
cd backend
npm run check        # lint + format
npm run typecheck    # 타입 검사
npm test             # 단위·통합 테스트
npm run build        # 프로덕션 빌드
```

Redis 통합 테스트는 `redis-server` 바이너리가 있어야 실행되며, 없으면 해당
스위트만 건너뜁니다.

## 문서

- [프론트엔드 README](frontend/README.md) — 기술 스택·폴더 구조·시작하기
- [프론트엔드 아키텍처](frontend/docs/architecture.md) — 구조·의존 방향·상태 설계와 그 이유
- [프론트엔드 설계 정본](frontend/DESIGN.md) — 불변식·코드 구조·레퍼런스 위키(llmwiki) 문서 지도
- [백엔드 README](backend/README.md) — 기술 스택·시작하기·검증
- [백엔드 설계 정본](backend/DESIGN.md) — 원칙·불변식·하위 시스템 인덱스
- [백엔드 마이그레이션 계획](backend/PLANS.md) — 마이그레이션 단계·워크플로우
- [에이전트 작업 지침](AGENTS.md) — 작업 방식·Git 브랜치·커밋·PR 규칙

## 협업 규칙

Git 작업 규칙의 단일 기준은 [AGENTS.md](AGENTS.md)입니다. `main`에는 직접 커밋하지
않으며, 작업 브랜치에서 변경한 뒤 Pull Request를 생성합니다.

---

<div align="center">
  SSAFY 15기 공통 프로젝트
</div>
