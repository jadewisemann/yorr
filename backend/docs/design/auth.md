# 인증·계정 (소셜 로그인·프로필)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `auth/`,
> `user/`(프로필). 세션 저장 모양·TTL·게스트는
> [rooms-and-sessions.md](rooms-and-sessions.md)의 세션 모델 참고 — 회원
> 세션도 같은 `user:{id}` 해시다(type=MEMBER, TTL 30일).

## 소셜 로그인 흐름 (kakao · google)

```text
프론트 로그인 버튼 (전체 페이지 이동, XHR 아님)
 → GET  /api/v1/auth/{provider}/authorize     state 발급, 302 → 제공자
 → 제공자 동의 화면
 → GET  /api/v1/auth/{provider}/callback      state 검증, code 교환, 가입/로그인,
                                              세션 개설 → 302 → 프론트 ?code=<1회용>
 → POST /api/v1/auth/session {code}           code를 세션 토큰으로 교환
```

- authorize 쿼리: kakao `?prompt=login`, google `?prompt=select_account`
  (문자열 일치 시에만 전달). 미설정 제공자(`NOT_CONFIGURED`)는 **503 빈 본문**
  — 브라우저가 직접 여는 URL이라 리다이렉트할 곳이 없다.
- authorize URL은 모든 쿼리 값을 form-urlencoded로 완전 인코딩해야 한다
  (redirect_uri의 `:`·`/` 포함 — Java가 UriComponentsBuilder를 피한 이유).
  google은 `scope=openid profile email` 추가.
- callback은 **항상 302로 응답한다**(JSON 없음 — 사람 브라우저가 도착하는
  곳). 실패는 `?error=<reason소문자>`: `canceled` / `invalid_state` /
  `not_configured` / `provider_error`. 이 네 문자열이 프론트가 아는 전부다.
  검증 순서: error 파라미터 → state 소비 → code 존재.
- 토큰 교환·프로필 조회(서버→제공자, **호출당 8초 예산**):
  - kakao: `POST kauth.kakao.com/oauth/token`(secret은 설정된 경우만) →
    `GET kapi.kakao.com/v2/user/me`. 닉네임은 `kakao_account.profile.nickname`
    → 레거시 `properties.nickname` → 플레이스홀더.
  - google: `POST oauth2.googleapis.com/token`(secret 필수) →
    `GET openidconnect.googleapis.com/v1/userinfo`. id는 `sub`, 닉네임은
    `name` → `email` → 플레이스홀더.
  - 제공자 오류 본문은 클라이언트로 전파하지 않는다(키 유출 방지) —
    `provider_error` 일반화. 액세스 토큰은 1회 사용 후 폐기(저장 금지).
  - 닉네임은 20자로 절단.
  - 타임아웃은 Java가 connect 3s + read 5s로 나눠 걸지만 Node `fetch`에는 그
    구분이 없다(AbortSignal 하나가 전체를 덮는다) — **Java의 최악값 8초를
    통짜 예산**으로 잡는다. 더 짧게 잡으면 Java에서 되던 느린 로그인이 여기서만
    실패하고, 안 걸면 로그인 요청이 영영 매달린다.
- 설정 판정: kakao는 clientId+redirectUri만 필수(secret 선택), google은 3개
  전부. 미설정이어도 부팅은 된다 — 호출 시점에 실패.
- quirk(Java와 동일): authorize는 **설정을 확인하기 전에 state를 먼저 발급**한다
  (Java의 인자 평가 순서). 미설정 제공자를 호출하면 쓰이지 않는 state 키가 하나
  남지만 5분 뒤 사라진다. 응답 계약(503)은 그대로다.

## state · 로그인 코드 (Redis, 1회용)

| 키 | 값 | TTL | 소비 |
|---|---|---|---|
| `auth:oauth-state:{state}` | "1" | 5분 | DEL 반환값으로 판정(동시 콜백에도 1회) — 로그인 CSRF 방어 |
| `auth:login-code:{code}` | 세션 토큰 | 60초 | GETDEL — 2번째 시도는 반드시 실패 |

로그인 코드를 쓰는 이유: 세션 토큰을 리다이렉트 URL에 실으면 브라우저
히스토리·리퍼러·액세스 로그에 남는다.

## 세션 REST

| 요청 | 응답 / 오류 (오류 본문은 plain-text) |
|---|---|
| `POST /api/v1/auth/session` `{code}` | 200 `{userId, nickname, type:"MEMBER", sessionToken}` · 401 `invalid_login_code`(소비 실패) · 401 `session_expired`(교환된 토큰이 이미 죽음) |
| `GET /api/v1/auth/me` (Bearer) | 200 같은 모양에 `sessionToken:null` · 401 `session_expired`. 프론트는 **401만** 세션 사망으로 취급(다른 실패는 무시) |
| `DELETE /api/v1/auth/session` (Bearer) | **무조건 204** — 토큰 유효성 오라클로 못 쓰게 |

세션 개설(`openMemberSession`)은 기존 DB userId를 재사용하고 tokenHash를
덮어쓴다 → **계정당 라이브 세션 1개**(재로그인 = 이전 토큰 무효화).
게스트가 로그인해도 게스트 id가 회원 id로 승격되지는 않는다 — 별개 신원이다.

## 가입·연동 규칙 (MySQL)

- `social_accounts(provider, provider_user_id)` 유니크가 연동의 정본. 조회는
  user eager 로딩.
- 최초 로그인: User(UUID) + SocialAccount를 **한 트랜잭션**으로 생성 — 소셜
  연동 없는 유령 회원 금지. 동시 가입 경합은 유니크 위반을 잡아 재조회로
  승자를 반환한다(재조회도 비면 원래 예외 재던짐 — 진짜 제약 위반을 삼키지
  않는다). 이 재조회가 동작하려면 등록이 **별도 트랜잭션 경계**여야 한다
  (Java에서 registrar를 별도 빈으로 뺀 이유 — Node에서는 명시적 트랜잭션
  분리로 동일 효과를 낸다).
- 닉네임 채택: 플레이스홀더("플레이어")인 동안만 제공자 프로필을 받아들인다.
  사용자가 직접 정한 이름은 이후 로그인이 절대 덮어쓰지 않는다. 이번에 받은
  이름도 플레이스홀더면 채택할 것이 없으므로 쓰기를 하지 않는다.
- 한 사용자에 제공자 여러 개 연동 가능(1:N). email 컬럼 없음(kakao 심사 이슈).
- 제약 위반의 갈래는 **유니크만이 아니다.** Java가 `DataIntegrityViolationException`
  하나로 잡던 자리를 Node는 `DataIntegrityViolationError`로 옮겼고, MySQL errno
  (1062 유니크 · 1406 길이 · 1452 FK …)를 그 갈래로 승격한다. 승격 지점은
  저장소(`auth/socialAccountStore.ts`)이고 판정은 서비스에 있다 — 서비스는
  mysql2를 몰라야 인메모리 가짜로 경합 분기를 시험할 수 있다.

## 구현 위치 (Node)

| 파일 | 대응 Java |
|---|---|
| `auth/stateStore.ts` · `auth/loginCodeStore.ts` | `OAuthStateStore` · `LoginCodeStore` |
| `auth/kakaoClient.ts` · `auth/googleClient.ts` | `KakaoOAuthClient` · `GoogleOAuthClient` |
| `auth/oauthHttp.ts` | `AuthConfig.socialRestClient` + `URLEncoder`(form-urlencoded 인코딩) |
| `auth/config.ts` | `AuthProperties`(`configured()` 판정 포함) |
| `auth/socialLoginService.ts` | `SocialLoginService` |
| `auth/socialAccountStore.ts` | `SocialAccountRepository` + `SocialAccountRegistrar`(별도 트랜잭션 경계) |
| `auth/errors.ts` | `SocialLoginException` + `DataIntegrityViolationException` 자리 |
| `http/routes/auth.ts` | `AuthController` |

- 환경변수는 `application.yaml`의 `yorr.auth.*`를 Spring이 읽는 이름 그대로
  쓴다: `AUTH_FRONTEND_REDIRECT_URI` · `KAKAO_CLIENT_ID` · `KAKAO_CLIENT_SECRET` ·
  `KAKAO_REDIRECT_URI` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` ·
  `GOOGLE_REDIRECT_URI`.
- authorize URL 인코딩은 `encodeURIComponent`가 아니라 Java `URLEncoder`와 같은
  규칙(`formUrlEncode`)이다 — 공백이 `+`여야 하고(`scope=openid+profile+email`)
  `!'()~`도 인코딩된다. 이 모양이 테스트로 고정돼 있다.

## 프로필 REST

인증은 **Bearer 토큰만**(X-User-Id 없음). 게스트 토큰은 인증은 되지만 DB
프로필이 없다 → **403 `member_only`**.

| 요청 | 응답 / 오류 |
|---|---|
| `GET /api/v1/users/me` | 200 `{userId, nickname, profileImageUrl}` · 401 `session_expired` · 403 `member_only` |
| `PATCH /api/v1/users/me` `{nickname}` | 200 같은 모양 · 400 `invalid_nickname`(trim 후 1~20자) · 404 `user_not_found` |

- 개명은 **DB와 Redis 세션을 함께** 갱신한다(dual-write). 세션이 죽어 있어도
  DB 개명은 성공한다(세션 갱신은 키 존재 시에만).
- 직접 개명하면 플레이스홀더 상태가 해제된다(위 채택 규칙과 맞물림).

## 주간 랭킹의 인증 (참고)

`GET /rankings/weekly`는 무인증 공개. `GET /rankings/weekly/me`는 Bearer —
401 `session_expired` / 403 `member_only`(게스트는 랭킹 대상이 아니므로 재시도
불가 구분) / 이번 주 기록 없음은 **204**(0점 꼴찌와 "안 했음"의 구분).
집계 자체는 [persistence.md](persistence.md).

## 이식된 테스트 (4.2)

- `auth/__tests__/socialLoginService.test.ts` — Java `SocialLoginServiceTest`
  전 케이스(로그인/가입 분기, 플레이스홀더 채택, 직접 정한 이름 보존,
  **경합 승자 재조회**, 재조회 실패 시 원래 예외 재던짐) + Node 추가:
  제약 위반이 아닌 오류는 재조회하지 않고 그대로 전파.
- `auth/__tests__/kakaoClient.test.ts` · `googleClient.test.ts` — Java의 두
  클라이언트 테스트(파라미터·인코딩·prompt·미설정 거절) + 이식하며 추가한 것:
  토큰 교환 폼 내용, secret 공백 시 미전송(kakao), 닉네임 폴백 3단, 20자 절단,
  id 부재, **제공자 오류 본문 비전파**, 타임아웃.
- `auth/__tests__/stores.test.ts` — state·로그인 코드의 1회용 시맨틱(동시 소비
  포함)과 TTL. 진짜 Redis.
- `auth/__tests__/socialAccountStore.test.ts` — MySQL 게이트(`MYSQL_TEST_URL`)
  안에서만 도는 통합: 한 트랜잭션 가입, 유니크 위반, 롤백으로 유령 회원 없음,
  제공자별 독립, 플레이스홀더일 때만 채택, UTC 벽시계.
- `http/routes/__tests__/auth.test.ts` — authorize 302/503, prompt 문자열 정확
  일치, 콜백 전 구간(성공·canceled·invalid_state·재사용·code 부재·제공자 실패),
  코드 1회 교환, 재로그인 시 이전 토큰 무효화, `/me`, 무조건 204 로그아웃.
- `config/__tests__/env.test.ts` — `DB_URL`(JDBC) 파싱과 우선순위, 소셜 로그인
  변수 이름·기본값.
