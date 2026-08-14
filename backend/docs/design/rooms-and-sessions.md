# 방·세션

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `room/`, `user/`.
> 아래는 backend-java 코드·테스트 전수 대조 결과다(2026-08-14).
> ⚠️ `POST /api/v1/users/guests`·`POST /rooms/{code}/players` 같은 엔드포인트는
> **존재하지 않는다**(낡은 GAME_SESSION_INTEGRATION.md의 잔재). 게스트 발급은
> `POST /rooms`에 통합되어 있다.

## 세션 모델 (게스트 = 회원, 같은 모양)

- Redis 해시 `user:{userId}`: `type`(GUEST|MEMBER), `nickname`, `tokenHash`
  (+ 방에 있는 동안 `roomId`·`roomCode`·`host`). 역인덱스
  `user:token:{base64(sha256(token))}` → userId.
- 토큰: SecureRandom 32바이트, base64url 무패딩. **원문은 저장하지 않고 SHA-256
  해시만** 저장. 비교는 상수 시간.
- TTL: 게스트 24시간, 회원 30일. **모든 인증 성공 시 두 키의 TTL이 함께
  슬라이딩**된다. 방 배정(`assignRoom`) 시에도 타입에 맞는 TTL을 다시 적용한다
  (회원이 방에 들어갔다고 24시간짜리로 강등되면 안 된다).
- 인증 경로 두 가지, 검증 코어는 하나:
  - REST: `X-User-Id` + `Authorization: Bearer <token>` → 해시 대조.
  - WS·프로필·auth: 토큰만 → 역인덱스로 userId 유도 후 같은 검증.
- 로그아웃은 역인덱스 **그리고** `tokenHash` 필드를 함께 지운다(하나만 지우면
  다른 인증 경로가 살아남는다 — 테스트로 고정됨). 재로그인은 tokenHash를
  덮어쓴다 → **계정당 라이브 세션은 항상 1개**.
- 실패는 `SessionAuthenticationException("invalid_guest_session")`이며
  `IllegalArgumentException`의 하위 타입이다(기존 컨트롤러의 catch → 401 유지 +
  WS에서 만료를 구분하기 위한 의도적 상속).
- 닉네임 정규화: trim 후 1~20자. 그 외 제약 없음(한글 허용).

## REST 계약

인증 필요 표기: 🔑 = `X-User-Id` + `Authorization: Bearer`. 오류 본문은 명시가
없으면 **plain-text 문자열 코드**다.

### 방 입장 (생성/참가/게스트 발급 통합)

`POST /api/v1/rooms?game_code=<GAME>&party=<bool>` — 인증 불필요.

```json
// 요청 — room_id가 없으면 생성, 있으면 참가. session_token이 유효하면 회원으로 입장
{ "nickname": "요르", "room_id": "ABC123", "session_token": "..." }
// 응답 200 — 이 API만 snake_case다
{ "id": "<userId>", "nickname": "요르", "token": "<sessionToken>",
  "room_id": "ABC123", "game_code": "YACHT_DICE" }
```

- `game_code` 기본값 `YACHT_DICE`. 생성 시 정원 = 해당 게임 모듈의 `maxPlayers`.
- `session_token`이 만료돼 있으면 조용히 **새 게스트 생성으로 폴백**한다.
  본문 nickname이 프로필 닉네임보다 우선한다(방 표시 이름).
- **파티 모드**(`party=true`, 생성일 때만): 생성자는 대시보드다 — roster에
  넣지 않고 host도 아니다. nickname이 비어 있으면 `"대시보드"`로 채워 게스트
  발급이 실패하지 않게 한다. 응답 nickname은 비어 있으면 안 된다(프론트
  RealtimeSync 게이트 조건).
- 오류: 400 `invalid_nickname`(공백/20자 초과) · 400 `invalid_game_code` ·
  404 `room_not_found` · 409 `game_started`(LOBBY 아님) · 409 `room_full`.
  그 외 `IllegalArgumentException`은 404로 떨어진다(quirk).

### 나머지 방 조작

| 요청 | 응답 | 오류 |
|---|---|---|
| 🔑 `DELETE /rooms/{code}/players/me` | 204 | 401 `invalid_guest_session` · 404 `room_not_found`. 부수효과: `user:{id}`의 방 필드 정리, 이탈 전 phase가 PLAYING이면 게임 모듈 `removePlayer`까지 |
| 🔑 `POST /rooms/{code}/games` (시작) | 200 `{gameId, snapshot}` | 401 · 404 `room_not_found` · 403 `host_only` · 409 `game_not_ready`(모든 시작 실패가 이 코드 하나로 뭉개진다 — quirk) |
| 🔑 `POST /rooms/{code}/lobby` (로비 복귀) | 204 | 401 · 404 · 403 `host_only` · 409 `not_finished` |
| `GET /games/{gameId}` | 200 스냅샷 (**인증 없음**, 없으면 전 필드 null 스냅샷으로 200) | — |
| 🔑 `POST /rooms/{code}/bots` | 200 스냅샷 + `state.sync` 브로드캐스트 | 401 · 409 `bots_not_supported` · 403 `host_only` · 404 `room_not_found` · 409 `lobby_only` · 409 `room_full` · 409 `bot_operation_failed` |
| 🔑 `DELETE /rooms/{code}/bots/{botId}` | 200 스냅샷 + `state.sync` | 위와 동일 + 404 `bot_not_found` |
| 🔑 `POST /quick-matches?game_code=` | 200 `{status, roomId, gameCode}` | 401 `unauthorized`(주의: 문자열이 다르다) · 400 `invalid_game_code`/`quick_match_not_supported` · 409 `already_in_room` |
| 🔑 `GET /quick-matches` · `DELETE /quick-matches` | 200 동일 모양 | 401 `unauthorized` |

REST 스냅샷(`RoomSnapshot`) — WS 스냅샷과 **다른 모양**이다:

```json
{ "roomCode": "ABC123", "gameCode": "YACHT_DICE", "gameId": null, "hostId": "...",
  "phase": "LOBBY|PLAYING|FINISHED", "capacity": 6,
  "players": [ { "playerId": "...", "nickname": "...", "score": 0, "kind": "HUMAN|BOT" } ] }
```

phase가 **대문자**고, 키가 `roomCode`며, 플레이어에 `score`가 있고 `status`가
없다. 프론트가 두 모양을 각각 파싱한다 — 섞으면 안 된다.

- host 판정은 항상 두 조건이다: `hostId == userId` **그리고** roster에 존재.
  방을 떠난 전 host는 유효 토큰이 있어도 방을 조작할 수 없다.
- 401 본문이 API마다 다르다: 방·봇 `invalid_guest_session`, 퀵매치
  `unauthorized`, 프로필·auth·랭킹 `session_expired`. **셋 다 계약이다.**
  참고로 프론트 userError 매핑은 `SESSION_EXPIRED`만 세션을 지운다 —
  `invalid_guest_session`은 일반 오류 UX로 떨어진다(알려진 틈, 계약 동결).

## Redis 키 스킴

| 키 | 타입 | 내용 | TTL |
|---|---|---|---|
| `user:{userId}` | HASH | type, nickname, tokenHash (+roomId, roomCode, host) | 24h/30d 슬라이딩 |
| `user:token:{hash}` | STRING | → userId | 위와 동일 |
| `room:{code}` | HASH | capacity, members, phase, hostId, gameCode, mode(NORMAL\|PARTY), gameId(시작 후) | **40분 슬라이딩** (매 턴 시작마다 touch) |
| `room:{code}:players` | HASH | playerId → nickname | 방 키의 PTTL 미러 |
| `room:{code}:scores` | HASH | playerId → 누적 점수(문자열) | 미러 |
| `room:{code}:bots` | HASH | botId → "BOT" | 미러 |
| `room:{code}:quick-match` | STRING | "1" — 전원 접속 시 자동 시작 마커 | 40분 |
| `room:{code}:game:{CODE}:state` | STRING | 게임 상태 JSON | 방 키 PTTL 복사 |
| `room:{code}:game:{CODE}:state:lock` | STRING | 락 토큰 | 5초 |
| `game:{gameId}` | HASH | roomCode, gameCode | 미러 |
| `game:{gameId}:scoreboard:{playerId}` | HASH | 카테고리 → 점수, `_upperSubtotal`·`_upperBonus`·`_total` | 미러 |
| `game:{gameId}:score-submissions:{playerId}` | HASH | 라운드번호 → 요청 시그니처 | 미러 |
| `quick-match:queue:{gameCode}` | ZSET | userId, score=enqueue ms | **없음**(점수 윈도로 청소) |
| `quick-match:user:{userId}` | HASH | status, gameCode, roomId | 대기 5분 / 매칭 후 40분 |
| `quick-match:lock:{gameCode}` | STRING | 락 토큰 | 5초 |

- 방 코드: 대문자+숫자 36진 6자, SecureRandom, CREATE Lua의 EXISTS 경합으로
  충돌 시 재시도.
- 방 목록 열거는 `SCAN room:*`(KEYS 금지) 후 `:`가 붙은 자식 키를 걸러낸다.
- 점수판은 미제출 카테고리 필드를 저장하지 않는다 — 값 `0`(기록하고 버림)과
  "아직 안 냄"(null)을 구분하기 위해서다. `_` 접두사는 메타 필드 규약이며 게임
  종료 판정 Lua가 이 규약으로 기록 수를 센다.

## Lua 스크립트 (원자성 계약)

반환 코드가 곧 계약이다. 이식 시 **스크립트 텍스트와 반환 코드 의미를 그대로**
옮기고 동시성 테스트를 함께 이식한다. 전체 텍스트는 backend-java
`RoomCreateService`·`RoomValidationService`·`BotParticipantService`·
`RedisScoreBoardStore`·`RedisGameCompletionStore` 참고. 요지:

| 스크립트 | 검증 → 변경 | 반환 |
|---|---|---|
| CREATE | 코드 미사용 확인 → 방 해시 생성+TTL | 0 충돌(재시도) / 1 생성 |
| JOIN | 존재 → LOBBY → **중복(먼저)** → 정원 → roster/scores 추가, members+1, host 승계(공석/roster 밖이면 참가자가 승계), 자식 키 TTL 정렬 | 0 없음 / 2 시작됨 / 3 정원 / 4 중복(Java는 **미처리** — 성공 취급, 단 TTL 갱신을 건너뜀) / 1 참가 |
| LEAVE | roster에서 제거 → members-1 → 0명이고 PARTY 아니면 방 전체 삭제 → host였으면 **botId가 아닌 것 중 사전순 최소**에게 승계(없으면 빈 문자열) | -1 방/좌석 없음(404) / 0 방 삭제됨 / 1 잔류 |
| CLOSE | gameId 있으면 플레이어별 scoreboard·submissions·game 키까지 삭제 → 방 키 4종 삭제 | 항상 1(멱등) |
| TOUCH | 방 TTL 40분 재설정 → 자식 키·game 키 전부 PTTL 정렬 | 0 방 없음 / 1 |
| START | 존재 → LOBBY → `HLEN players >= minPlayers`(봇 포함) → gameCode 존재 → phase=PLAYING, gameId 기록, `game:{id}` 생성 | 0(모든 실패) / 1 — 실패 사유 구분 불가가 계약(`game_not_ready`) |
| ROLLBACK_START | PLAYING이고 **gameId가 일치할 때만** LOBBY 복귀 + gameId 삭제 | 모듈 start 실패 시 자기 게임만 되돌린다 |
| CANCEL_ACTIVE_GAME | PLAYING이면 LOBBY 복귀, gameId 삭제 | 준비 단계 이탈용(gameId 인자 없음) |
| RETURN_TO_LOBBY | FINISHED일 때만 LOBBY 복귀 + gameId 삭제 + **`room:{code}:scores` 전원 0으로 리셋**(안 하면 다음 게임 랭킹이 이전 점수를 상속) | 0(409 `not_finished`) / 1. scoreboard는 남긴다(결과 조회용) |
| BOT ADD | 존재 → LOBBY → host(2중 검증) → 정원 → botId 미중복 → roster+scores+bots 동시 기록, members+1 | 0/2/3/4/5/1 → 404/`lobby_only`/`host_only`/`room_full`/`bot_operation_failed`/성공 |
| BOT REMOVE | **bots 해시에서 HDEL이 성공해야만** roster·scores 제거 — 사람을 이 API로 쫓아낼 수 없다 | 4 → `bot_not_found` |
| 락 해제(공용) | GET==token이면 DEL | 만료 후 재획득된 락을 이전 주인이 못 푼다 |

CLOSE·TOUCH·게임 종료 판정은 키 이름을 스크립트 안에서 문자열 조립한다 —
**단일 Redis 노드 전제**(클러스터 이전 시 애플리케이션 레벨로 끌어올려야 함).

## Phase 상태기계

```text
LOBBY --START(host, ≥minPlayers)--> PLAYING --FINISH_IF_COMPLETE--> FINISHED
  ^                                    |                                |
  |<---ROLLBACK_START(모듈 초기화 실패)--+                                |
  |<---CANCEL_ACTIVE_GAME(준비 중 이탈)--+                                |
  |<-------------------RETURN_TO_LOBBY(host)-----------------------------+
어느 phase든: CLOSE / 마지막 인원 LEAVE(비파티) / TTL 만료 → 소멸
```

WS 계층은 LOBBY를 `waiting`으로 매핑해 내보낸다.

## 파티 모드

- 대시보드(빅스크린)가 `party=true`로 방을 열고 QR을 띄우면 폰(컨트롤러)들이
  참가한다. 대시보드는 roster 밖·host 아님. **첫 컨트롤러가 host가 된다**
  (JOIN Lua의 host 승계 조항).
- LEAVE는 PARTY 방을 members 0이 되어도 삭제하지 않는다(대시보드는 members에
  안 세니까). 파티 방의 소멸 경로는 대시보드 소켓 종료 후 유예 close 또는 TTL.
- 사람이 다 나가 host가 빈 문자열이 되면 다음 참가자가 승계한다(봇은 승계
  대상에서 제외).
- 스냅샷에 파티 여부 플래그는 없다 — 프론트는 초대 URL 파라미터와 로컬
  스토리지로 컨트롤러 모드를 기억한다(계약 동결: 서버가 노출하지 않는다).
- 대시보드도 일반적인 WS `room.join`을 보낸다(응답으로 받은 nickname 사용).

## 방 수명 관리

- **방 폐쇄 스케줄러**(인메모리, 단일 스레드): 방당 예약 1개, 재예약은 교체.
  마지막 소켓 이탈 시 `hasState ? 10분 : 30초` 유예 후 빈 방 재확인 → close.
  누군가 join하면 취소 + 라운드 타이머 resume. 발화 시점 재확인과 취소는
  의도적 이중 방어다.
- **StaleRoomCleaner**(부팅 시): SCAN으로 모든 방을 훑어 **PLAYING 방만**
  close한다. 라운드 상태는 Redis에 살아 있어도 마감 타이머가 인메모리라 부팅
  후 재무장 경로가 없기 때문 — 멈춘 게임 방은 JOIN도 `game_started`로 거부하는
  최악의 상태라서 지우는 편이 낫다. LOBBY·FINISHED는 건드리지 않는다(배포마다
  로비가 날아가던 회귀의 재발 방지). 타이머 복구가 생기면 이 컴포넌트는
  삭제한다.

## 퀵매치

- 매칭 인원 = `max(2, minPlayers)`(maxPlayers 초과면 `quick_match_not_supported`).
  현재 세 게임 모두 2인 매칭.
- enter: 멱등(티켓 있으면 현재 상태 반환), `user:{id}`에 roomId 있으면
  `already_in_room`. ZSET에 enqueue 후 매칭 시도.
- 매칭(게임코드별 5초 락): 5분 지난 대기자를 점수 윈도로 청소 → 가장 오래
  기다린 N명 선택 → 세션 만료자 발견 시 그 사람을 퇴출하고 **전체 중단** →
  최장 대기자를 host로 방 생성(capacity=N), 전원 join+assignRoom — 도중 예외면
  방을 close로 롤백 → 티켓을 MATCHED+roomId로 갱신(TTL 40분), 방에
  `room:{id}:quick-match="1"` 마커.
- **자동 시작은 폴링이 굴린다**: `GET /quick-matches`(프론트가 1초 폴링)마다
  마커가 있으면 — LOBBY이고 인원=정원이고 **전원의 WS 소켓이 살아 있을 때만**
  `games.start` 후 마커 삭제. 소켓 조건이 "매칭됐는데 아직 접속 안 한 사람이
  게임에 끌려 들어가는" 레이스를 막는다.
- status는 PLAYING을 한 번 보고하면 티켓을 지운다(다음 폴은 NOT_QUEUED).
  티켓의 방이 사라졌거나 FINISHED면 자동으로 leave+정리 후 NOT_QUEUED.
- 알려진 한계(코드에 명시): 매칭+방 생성이 한 Lua가 아니라 중간 크래시 시 방이
  고아가 될 수 있다.

## 봇 (roster 관점)

- `botId = "bot-" + UUID`, 닉네임 `"요르봇 " + <botId 끝 4자 대문자>`.
- 봇은 roster·scores의 정규 행이라 정원과 START의 minPlayers를 채운다.
  `room:{code}:bots` 해시가 "이 행은 봇" 마커이자 제거 권한의 근거다.
- LOBBY에서만, host만 추가/제거 가능. `supportsBots`가 false인 게임(DUEL,
  PING_PONG)은 Lua 진입 전에 409 `bots_not_supported`.
- host 승계에서 제외된다. WS 스냅샷에서 항상 `online`.
- quirk(계약): 존재하지 않는 방에 봇 추가 → 404가 아니라 **400
  `invalid_game_code`**(레지스트리 조회가 존재 확인보다 먼저 실행됨).

## 불변식

- **REST가 방 상태의 유일한 변경 경로다.** WS는 방 멤버십·phase를 바꾸지 않는다
  (예외: PLAYING 중 WS `room.leave`·오프라인 자동 퇴장은 게임 모듈 경로로
  `roomService.leave`를 부른다).
- **정원·중복 참가 판정은 Redis Lua에서 원자적으로.** 같은 게스트의 재참가는
  인원을 늘리지 않는다. 프론트의 사전 확인은 UX일 뿐이다.
- **오래된 게임 매핑으로 현재 방 점수를 바꿀 수 없다.** 점수 확정 Lua가
  game↔room 양방향 매핑·PLAYING·참가자 여부를 같은 스크립트에서 먼저 검증한다
  ([game-modules.md](game-modules.md)).
- 방 키 가족(방·players·scores·bots·game·scoreboard·submissions)은 **같은
  순간에 만료**되도록 TTL을 항상 함께 정렬한다 — 일부만 만료된 반쪽 방을
  만들지 않는다.
