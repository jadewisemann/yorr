<div align="center">
  <img src="frontend/public/mascot-favicon.svg" alt="YORR mascot" width="112" />

  # YORR (요르)

  **휴대폰을 흔들고, 휘두르고, 탭하며 함께 즐기는 실시간 웹 게임 플랫폼**

  [서비스 바로가기](https://yorr.site) · [프론트엔드 문서](frontend/docs/index.md) · [협업 가이드](CONTRIBUTING.md)
</div>

## 프로젝트 소개

YORR는 별도 앱 설치 없이 모바일 브라우저에서 즐길 수 있는 멀티플레이 게임 서비스입니다.
방을 만들거나 빠른 대전으로 상대를 찾고, 초대 코드·링크·QR로 친구를 초대할 수 있습니다.
휴대폰의 모션 센서를 게임 조작에 활용하며, 센서를 사용할 수 없는 환경에서도 화면 조작으로
끝까지 플레이할 수 있습니다.

### 플레이 가능한 게임

| 게임 | 인원 | 조작 | 설명 |
|---|---:|---|---|
| 요트 다이스 | 1–6명 | 휴대폰 흔들기 · 화면 탭 | 최대 세 번 주사위를 굴리고 킵하며 12개 족보의 최고 점수를 완성합니다. |
| 탁구 | 1–2명 | 화면 탭 · 휴대폰 스윙 | 먼저 11점을 얻는 플레이어가 승리하는 빠른 랠리 게임입니다. |
| 석양이 진다 | 2명 | 화면 탭 · 휴대폰 휘두르기 | 신호에 맞춰 먼저 공격하는 반응 속도 대결입니다. |

라이어스 다이스와 낚시는 현재 준비 중입니다.

## 주요 기능

- 게스트 입장 및 카카오·구글 소셜 로그인
- 방 생성, 초대 코드·링크·QR 참가, 빠른 대전
- WebSocket 기반 실시간 방·게임 상태 동기화와 재접속 복구
- 휴대폰 모션 센서 기반 조작과 탭 조작 대체 수단
- 큰 화면과 여러 휴대폰을 연결하는 파티 모드
- 탁구 전용 휴대폰 컨트롤러 페어링
- WebRTC 기반 방 음성 채팅
- 주간 랭킹과 게임 결과 기록

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Router, Zustand |
| UI · 그래픽 | Tailwind CSS 4, Motion, Three.js, Rapier |
| Backend | Java 21, Spring Boot 4, Spring MVC, Spring WebSocket |
| Data | MySQL 8, Redis 7, JPA, Flyway |
| Realtime | WebSocket, WebRTC |
| Test | Vitest, Testing Library, Playwright, JUnit, Testcontainers |
| Infra | Docker Compose, Jenkins, Vercel, Prometheus |

## 아키텍처

```text
Mobile / Desktop Browser
        │
        ├── REST API ───────────────┐
        ├── WebSocket ──────────────┤
        └── WebRTC voice (P2P)      │
                                    ▼
                         Spring Boot Backend
                           │              │
                           ▼              ▼
                        MySQL           Redis
                    계정·전적·랭킹   방·세션·게임 상태
```

서버가 방과 게임 상태의 최종 권위자이며, 클라이언트는 WebSocket 이벤트와 재접속 스냅샷으로
상태를 동기화합니다. 음성 데이터만 WebRTC로 참가자 사이에서 직접 전달하고, 연결을 위한
시그널링은 기존 WebSocket을 사용합니다.

## 로컬 실행

### 준비 사항

- Java 21
- Node.js 22.12 이상과 npm
- Docker 및 Docker Compose

### 1. 백엔드 실행

```bash
cd backend
cp .env.example .env
```

`.env`의 `DB_PASSWORD`에 로컬 개발용 비밀번호를 설정한 뒤 실행합니다. 소셜 로그인 기능을
개발하지 않는 경우 OAuth 관련 값은 비워 두어도 됩니다.

```bash
# macOS / Linux
./gradlew bootRun

# Windows
gradlew.bat bootRun
```

Spring Boot가 `compose.yaml`을 통해 MySQL과 Redis를 함께 시작합니다.

- API: `http://localhost:8080/api/v1`
- WebSocket: `ws://localhost:8080/ws/v1/game`
- Swagger UI: `http://localhost:8080/swagger-ui/index.html`
- Health check: `http://localhost:8080/actuator/health`

### 2. 프론트엔드 실행

새 터미널에서 다음 명령을 실행합니다.

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

기본 개발 모드는 MSW로 API를 모의하므로 백엔드 없이도 UI를 확인할 수 있습니다.
`http://localhost:5173`에서 접속할 수 있습니다.

로컬 백엔드와 연결하려면 `.env.local`에 아래 값을 설정하고 실서버 모드로 실행합니다.

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_WS_URL=/ws/v1/game
VITE_ENABLE_MSW=false
VITE_BACKEND_ORIGIN=http://localhost:8080
```

```bash
npm run dev:real
```

> Windows PowerShell에서는 `cp` 대신 `Copy-Item .env.example .env` 또는
> `Copy-Item .env.example .env.local`을 사용할 수 있습니다.

## 테스트와 품질 검사

### Frontend

```bash
cd frontend
npm run check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

실제 백엔드와 연결하는 E2E 테스트는 백엔드를 먼저 실행한 뒤 `npm run test:e2e:real`로 수행합니다.

### Backend

```bash
cd backend
./gradlew test
```

Windows에서는 `./gradlew` 대신 `gradlew.bat`을 사용합니다. 일부 통합 테스트는 Docker가
실행 중이어야 합니다.

## 디렉터리 구조

```text
.
├── frontend/              # React 기반 모바일 웹 클라이언트
│   ├── src/               # 도메인 중심 애플리케이션 코드
│   ├── e2e/               # Playwright 브라우저 테스트
│   └── docs/              # 제품·아키텍처·API 문서
├── backend/               # Spring Boot API 및 실시간 게임 서버
│   └── src/
│       ├── main/          # 애플리케이션 코드와 DB 마이그레이션
│       └── test/          # 단위·통합 테스트
├── deploy/                # 운영용 Docker Compose 설정
├── Jenkinsfile            # 검증 및 배포 파이프라인
└── CONTRIBUTING.md        # Git 브랜치·커밋·MR 규칙
```

## 문서

- [프론트엔드 문서 인덱스 (LLM 위키)](frontend/docs/index.md)
- [제품 기준·유저 플로우](frontend/docs/wiki/product.md)
- [아키텍처와 기술 스택](frontend/docs/wiki/architecture.md)
- [실시간 통신(WebSocket)](frontend/docs/wiki/realtime.md) · [REST API](frontend/docs/wiki/rest-api.md)
- [요트 다이스 도메인](frontend/docs/wiki/yacht.md)
- [백엔드 게임 세션 연동](backend/GAME_SESSION_INTEGRATION.md)

## 협업 규칙

Git 작업 규칙의 단일 기준은 [CONTRIBUTING.md](CONTRIBUTING.md)입니다. `main`과 `develop`에는
직접 커밋하지 않으며, Jira 이슈 단위의 작업 브랜치에서 변경한 뒤 리뷰를 거쳐 `develop`으로
Merge Request를 생성합니다.

---

<div align="center">
  SSAFY 15기 공통 프로젝트 · S15P11A406
</div>
