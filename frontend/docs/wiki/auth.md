# 인증 — 소셜 로그인·세션·닉네임

> SSOT: [`../../src/auth/api/authApi.ts`](../../src/auth/api/authApi.ts),
> [`../../src/auth/authSession.ts`](../../src/auth/authSession.ts),
> [`../../src/auth/nickname.ts`](../../src/auth/nickname.ts)

## 제공자 — 카카오 + 구글

- 로그인 시작은 **전체 페이지 이동**이다 (`GET /auth/{kakao|google}/authorize`) — 서버가
  제공자로 302를 보내고 사용자가 직접 동의한다. XHR로 부르면 리다이렉트가 fetch 안에서
  소비돼 화면이 멈춘다.
- 콜백 `/auth/callback?code=` → `POST /auth/session`으로 1회용 code를 세션으로 교환.
  StrictMode의 이펙트 2회 실행이 두 번째 교환을 실패로 만들지 않도록 ref로 가드하고,
  성공/실패 무관 홈으로 `replace` 이동. 성공 토스트는 없다 — 헤더 아바타가 이미 말한다.
- 실패 사유(`canceled | invalid_state | not_configured | provider_error`)는 서버
  `SocialLoginException.Reason`과 짝인 문구 표로 안내한다.
- 헤더에 제공자 버튼을 바로 두지 않는다 — 제공자가 둘이라 자리를 내줄 수 없고, 어두운
  랜딩 위에 카카오 노란색을 얹으면 그것만 튄다. 브랜드 색은 고르는 자리 안에서만.

## 세션 저장 (`authSession.ts`)

- 키 `yorr.auth-session`, **30일 TTL**(서버 sliding TTL과 동일 — 더 길면 "로그인돼
  보이는데 요청은 401"만 만든다). 봉투 `{expiresAt, session}` + 형태 검증 + 자가 정리.
- **방 세션(`yorr.room-session`, 40분)과 일부러 분리한다** — 수명도 의미도 다르다. 같은
  자리에 두면 방을 나갈 때 로그인까지 풀린다. 반대로 로그아웃해도 방 세션은 건드리지
  않는다 — 진행 중인 게임에서 쫓아낼 이유가 없다.
- 부팅 시 1회 검증(`useAuthSessionCheck`): **401만** 세션 사망으로 본다 — 서버가 잠깐 안
  뜬 것까지 로그아웃 취급하면 네트워크가 흔들릴 때마다 튕긴다. 죽었으면 **조용히**
  정리한다(안내 토스트가 오히려 놀라움을 만든다). 닉네임이 다르면 서버 값으로 갱신.

## 게스트 정책

게스트 전용 로그인 엔드포인트는 없다 — **게스트 정체성은 방 입장(`POST /rooms`)이 발급**
한다. 로그인 상태면 `session_token`을 함께 보내 결과가 계정에 귀속되고, 없으면 서버가 새
게스트를 만든다. 이 구조 때문에 빠른 대전(대기열)은 현재 로그인 필수다.

## 닉네임 (`nickname.ts`)

- 닉네임은 식별자가 아니라 표시용 — 같은 방 중복 허용, 식별은 `playerId`/`sessionToken`.
- NFC 정규화 + 1~12자 문자·숫자·공백. **검증의 유일한 관문은 `getNicknameError`** —
  욕설 검사도 여기 선다. 화면마다 따로 붙이면 어느 경로는 막고 어느 경로는 안 막는다
  (실제로 프로필 변경 경로가 그랬다, S15P11A406-182).
- 로그인했다면 계정 닉네임에서 시작하되 이 판에서만 다르게 쓸 수 있다(프로필은 불변).
  추천 닉네임은 8형용사 × 8명사 생성, sessionStorage에 저장.
- 프로필 변경은 `PATCH /users/me` — 과거 기록은 당시 닉네임을 유지한다.
