# PLANS — 진행 중 변경의 계획서

> "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md)와 `docs/design/*.md`,
> "왜 이렇게 결정했는가"는 `docs/adr/*.md`를 본다. 이 문서는 **아직 끝나지 않은
> 변경**과 **하위 시스템의 현재 상태**만 담는다.
>
> 와이어 계약의 정본은 `frontend/src/realtime/wsEvents.ts` +
> `frontend/src/room/api/*.ts`다. 서버가 임의로 바꾸지 않으며, 바꾸는 변경은
> 아래에 절을 만들어 근거를 남긴다.

## 연습 방 시계 제거 — 계약 변경 1건 (2026-08-21, 완료)

> 이 저장소에서 **와이어 계약을 의도적으로 넓힌 첫 변경**이다. 원칙(「프론트엔드
> 무변경」)의 예외이므로 여기 남긴다. 프론트 쪽 계획·표기는
> [frontend/PLANS.md](../frontend/PLANS.md) 「요트 라이트 모드 · 연습 방 시계」 절.

- **무엇**: 봇을 뺀 사람이 하나 이하인 방(연습 방)에는 턴 제한 시간을 두지 않는다.
  `round.start.deadline`과 재접속 스냅샷의 `game.roundDeadline`이 `number | null`이
  됐고, null이면 프론트가 타이머를 그리지 않는다.
- **왜 계약을 넓혔나**: 제한 시간의 목적은 멈춘 한 사람 때문에 나머지가 기다리는 것을
  막는 것이다. 혼자 하는 방에는 그 목적이 없다. "아주 먼 마감"으로 우회하면 화면에
  59:59가 떠 있게 되므로(로컬 튜토리얼이 실제로 그랬다) 값 자체를 없앴다.
- **호환**: 넓히기만 했다. 숫자 마감을 보내는 서버(`deploy/rollback.sh`로 직전
  릴리스에 되돌린 경우 포함)에서도 프론트는 그대로 동작한다 — 기능이 없을 뿐이다.
- **구현**: `RoundTimerService.UNTIMED_HUMAN_LIMIT`. 판정은 방 스냅샷의 `kind`로 하고,
  스냅샷을 못 읽으면 기존 동작(시계 있음)으로 떨어진다. 연습 방의 **봇 턴에는 예약만**
  남긴다(방송은 null) — 봇 스텝 예외의 유일한 폴백이라서다. 설계는
  [game-modules.md](docs/design/game-modules.md) 「RoundTimerService」.

## 음성 채팅 → 텍스트 채팅 — 계약 변경 2건 (2026-08-27, 완료)

> 와이어 계약을 의도적으로 바꾼 **두 번째** 변경이고, 넓히기가 아니라 **교체**라는
> 점에서 첫 번째와 다르다. 프론트 쪽 계획·표기는
> [frontend/PLANS.md](../frontend/PLANS.md) 「음성 채팅 → 텍스트 채팅」 절.

- **무엇**: `voice.join`·`voice.leave`·`voice.signal`·`voice.peers`·`voice.signaled`와
  `GET /api/v1/voice/ice`를 **삭제**하고, `chat.send`(C→S)·`chat.message`(S→C) 두
  개로 대체했다. 서버 쪽 구현은 `ws/chat.ts`이고 계약 문서는
  [chat.md](docs/design/chat.md)다.
- **왜**: 사용자 요청이다(음성 채팅 기능을 텍스트 채팅으로 전환). 계약 동결의
  목적은 "마이그레이션이 프론트를 건드리지 않는 것"인데, 이 변경은 마이그레이션이
  아니라 **제품 결정**이라 동결의 대상이 아니다. 다만 프론트·서버를 같은 PR에서
  함께 바꿔야 하므로 여기 기록한다.
- **호환**: 넓히기가 아니므로 **`chat.send`를 모르는 서버로 되돌리면 채팅이
  동작하지 않는다**(프론트가 `voice.*`를 더 이상 보내지 않기 때문이다). 게임
  진행·방·인증 경로는 그대로라 롤백 자체는 여전히 가능하고, 잃는 것은 채팅 하나다.
- **함께 사라진 것**: `RoomSessionRegistry`의 음성 명단
  (`joinVoice`/`leaveVoice`/`voiceMembersOf`), `ws/iceServers.ts`,
  `http/routes/voice.ts`, 환경변수 `YORR_VOICE_*` 네 개,
  `deploy/.env.example`의 같은 항목. 채팅에는 명단이 없다 — 방에 있으면 대화에 있는
  것이다.
- **새로 생긴 것**: `RATE_LIMITED`가 처음으로 실제 전송된다(채팅 도배 판정).
  그전까지 이 코드는 계약 목록에만 있었다.

## 컨트롤러 링크 시그널링 — 계약 변경 1건 (2026-08-27, 진행 중)

> 와이어 계약을 의도적으로 바꾼 **세 번째** 변경이고, 교체가 아니라 다시 **넓히기**다.
> 프론트 쪽 계획·판정표·불변식은 [frontend/PLANS.md](../frontend/PLANS.md)
> 「컨트롤러 링크」 절이 정본이다. 서버가 하는 일은 이 절이 전부다.

- **무엇**: `ctrl.signal`(C→S, `{to, data}`)과 `ctrl.signaled`(S→C, `{from, data}`)를
  추가한다. 서버는 `data`를 **파싱하지 않고** 같은 방의 지목된 상대에게만 유니캐스트한다.
  구현은 `ws/controllerSignal.ts`, 계약 문서는
  [controller-signal.md](docs/design/controller-signal.md).
- **왜**: 파티 모드에서 컨트롤러 폰과 큰 화면을 WebRTC DataChannel로 직접 이으려면
  SDP·ICE를 교환할 통로가 필요하다. 오디오·게임 상태가 서버를 지나지 않는다는 점에서
  삭제된 `voice.signal`과 성격이 같고, **서버 코드도 그 릴레이의 유니캐스트 부분과
  같다**(`git log -p -- backend/src/ws/voice.ts`).
- **왜 `chat.*`을 쓰지 않는가**: 채팅은 방 전체 **브로드캐스트**이고 글자 수 상한과
  도배 한도가 걸려 있다. 협상은 두 피어 사이의 일이라 남이 받으면 의미가 없고, ICE
  후보는 연결 수립 순간에 몰려서 채팅 한도에 걸린다.
- **호환**: 넓히기다. 기존 메시지는 하나도 바뀌지 않는다. `ctrl.signal`을 모르는
  서버(`deploy/rollback.sh`로 직전 릴리스에 되돌린 경우 포함)는 `INVALID_MESSAGE`로
  답하거나 무시하고, 그러면 링크가 안 열려 프론트가 WebSocket 폴백으로 돌아간다 —
  기능이 없을 뿐 화면은 그대로다.
- **되살리지 않는 것**: `GET /voice/ice`와 `YORR_VOICE_*` 환경변수. **TURN을 붙이지
  않기로 했다** — 링크가 TURN 릴레이를 타면 없애려던 서버 홉이 되살아나고, WebSocket
  폴백이 같은 홉 수로 이미 같은 일을 한다. STUN은 프론트 상수로 박는다(트래픽이
  지나가지 않아 비용이 없다). 인증 없는 TURN 자격 발급이 무단 사용 표면이었다는 점도
  되살리지 않는 이유에 든다.
- **레이트 리밋 주의**: ICE 후보는 다른 메시지보다 훨씬 잦다(연결 수립 순간에 몰린다).
  `ctrl.signal`에 채팅과 같은 기준을 걸면 링크가 안 붙는다 — 삭제된 `voice.signal`이
  같은 주의를 달고 있었다.
- **이식할 테스트**: 지워진 `ws/__tests__/voice.test.ts`의 릴레이 케이스
  (`from` 스푸핑 차단, 부재 상대 무음 드롭, 다른 방으로 전송 불가).

## 파티 탁구 호스트 판정 — 계약 변경 1건 (2026-08-27, 진행 중)

> 넓히기다. 프론트 쪽 계획·불변식은 [frontend/PLANS.md](../frontend/PLANS.md)
> 「파티 탁구 호스트 판정」, 결정과 경계는
> [frontend ADR-0003](../frontend/docs/adr/0003-party-host-authority-pingpong.md)이 정본이다.
> **프론트 DESIGN 원칙 1(서버 권위)의 첫 예외**이므로 서버가 무엇을 놓는지 여기 명확히 적는다.

- **무엇**: 파티 방(`rooms.isPartyRoom`)에서 `PING_PONG`을 할 때 **서버가 PLAYING 국면의
  랠리를 시뮬레이션하지 않는다.** 대신 대시보드가 판정한 상태를 받아 방에 뿌리고, 링크가
  없는 폰의 스윙을 대시보드로 전달한다.
- **왜**: 탁구의 체감 지연은 공이 방향을 바꾸는 순간에 있고 그것은 판정이다. 큰 화면이
  판정과 렌더를 같은 기기에서 하면 그 지연이 0이 된다. 파티 모드는 한 방에 모인 사람들이라
  서버 판정이 지키던 신뢰가 필요 없다(빠른 대전은 그대로 서버 판정이다).
- **서버가 계속 소유하는 것**: 방 수명, 게임 시작, **초기 상태**(roster·`playerOrder`·
  serve), PREPARING 준비 게이트, 상태 방송, 종료 확정, 전적·랭킹. 넘기는 것은 PLAYING
  국면의 랠리뿐이다.
- **메시지 2개 추가**:
  - C→S `game.ping_pong.host_state` — 대시보드가 판정한 `PingPongState`. **발신자가
    대시보드인지 검증한다**(방 스냅샷 명단에 없는 방 멤버). 받으면 `game.ping_pong.state`로
    방송하고, `FINISHED`면 보고된 점수로 기존 완료 경로를 탄다.
  - S→C `game.ping_pong.swung` — 폴백으로 들어온 `game.ping_pong.swing`을 대시보드에게만
    전달한다. 이것이 있어야 **링크가 없어도 파티 탁구가 성립한다.**
- **⚠️ 마감 스케줄러를 걸지 않는 것이 핵심이다.** 걸어 두면 서버가 자기 시뮬레이션으로
  점수를 내고 `game.over`까지 만들어 **전적에 틀린 결과가 남는다.** 파티 방 판정은
  PLAYING 진입 시점에 한 번 하고 그 판 동안 유지한다.
- **호환**: 넓히기다. 파티 방이 아니면 두 메시지가 오가지 않고 동작이 그대로다.
  `deploy/rollback.sh`로 직전 릴리스에 되돌리면 파티 탁구도 서버 판정으로 돌아간다.
- **이식할 테스트**: 파티 방에서 스케줄러 미등록, `host_state` 발신자 검증(플레이어가
  보내면 거절), `swung` 전달 대상(대시보드에게만), 보고된 점수로 종료.

## 유저 전적·레이팅 (야추) — 계약 넓히기 (2026-08-31, 계획)

> 마이그레이션이 아니라 **제품 결정**이고, 이 절은 **착수 전 계획**이다 — 아직
> 코드도 계약도 바뀌지 않았다. 프론트 쪽 계획·계약 표기는
> [frontend/PLANS.md](../frontend/PLANS.md) 「유저 전적·레이팅 (야추)」 절과
> 짝이다. 구현이 끝나면 결과를 [persistence.md](docs/design/persistence.md)와
> 새 설계 문서(`docs/design/rating.md`)로 승격하고 이 절을 갱신한다.

- **무엇**: 회원에게 게임별 전적(승·무·패·판수)과 Elo 레이팅을 준다. 레이팅은
  티어 6단(브론즈·실버·골드·플래티넘·다이아·마스터)으로 변환되어, 야추 방의 WS
  플레이어 객체에 `tier` optional 필드로 실리고 프로필 REST로 조회된다. 대상
  게임은 우선 `YACHT_DICE` 하나이며, 다빈치 코드가 다음 후보다.
- **왜**: 사용자 요청이다(유저별 전적과 레이팅, 멀티플레이 이름 옆 티어 휘장).
  주간 랭킹은 "이번 주 최고점" 하나라 누적 실력을 보여주지 못한다. 회원만
  집계하는 경계(`user_id IS NOT NULL`)를 그대로 쓰므로, 주간 랭킹과 같은
  이유("그 경계가 곧 로그인할 이유")가 하나 더 생긴다.
- **호환**: 넓히기만 한다. WS는 `Player.tier?`(optional) 추가, REST는 경로 2개
  신설이고 기존 응답 모양은 바뀌지 않는다. `tier`를 모르는 서버(`deploy/rollback.sh`로
  직전 릴리스에 되돌린 경우 포함)에서 프론트는 휘장 없이 그대로 동작한다.

### 레이팅 규칙 — 착수 시점의 초안 (수치는 운영하며 조정)

- **순위 기반 쌍별 Elo.** 종료 시점의 `rankings`에서 **회원끼리의 모든 쌍**을
  1대1 대결로 계산한다(낮은 rank가 승, 동순위는 0.5). 시작 1000점, K=32를
  `n-1`(n = 그 판의 회원 수)로 나눠 한 판의 총 변동 폭을 인원과 무관하게
  유지한다. 야추가 1~6인 순위전이라 이 형태가 자연스럽고, 입력이 순위
  (`ranking`)뿐이라 다빈치 코드에도 그대로 적용된다.
- **대상 게임은 허용 목록** `RATED_GAME_CODES = ['YACHT_DICE']` 하나로
  관리한다. 다빈치 코드를 붙일 때 바뀌는 것이 이 목록뿐이도록 스키마·계산기는
  처음부터 `game_code` 단위로 만든다.
- **게스트·봇이 낀 쌍은 건너뛴다**(`user_id NULL` — 봇전·연습 방이 자동으로
  빠진다). 회원이 본인 하나뿐인 판은 판수(`plays`)만 오르고 레이팅은 그대로다.
- **탁구 AI 결과 경로는 반영하지 않는다.** `archiveParticipants`는 클라이언트가
  보고한 결과라 서버 권위(DESIGN 원칙 1)와 맞지 않고, 애초에 탁구가 대상 게임이
  아니다.
- **티어 경계**: 브론즈 <1100 · 실버 <1300 · 골드 <1500 · 플래티넘 <1700 ·
  다이아 <1900 · 마스터 ≥1900. `rated_games < 5`(배치 미완)면 언랭크로 두고
  `tier`를 아예 싣지 않는다. 경계·K·시작점은 `game/rating/tier.ts` 상수 한 곳이
  유일한 출처다.

### 스키마 — 마이그레이션 V3

`db/migration/V3__create_rating_tables.sql`에 테이블 2개를 만든다. 이미 적용된
V1·V2는 손대지 않는다 — 운영 DB의 이력에 그 체크섬이 이미 적혀 있다
([persistence.md](docs/design/persistence.md) 「마이그레이션」).

**적용은 배포의 `migrate` 잡이 한다.** 기동 경로는 스키마를 바꾸지 않으므로,
V3를 담은 이미지를 올리기 전에 `docker compose run --rm migrate`를 먼저 돌려야
한다. 그러지 않으면 새 이미지가 `verifyMigrations`에서 죽는다.

- `user_game_stats` — 현재값 집계. `(user_id, game_code)` PK에
  `rating`·`rated_games`·`wins`·`losses`·`draws`·`plays`·`updated_at`.
  승패는 `ranking = 1`이면 승(공동 1위는 무), 나머지는 패로 센다.
- `match_ratings` — 판별 변동 이력. `(match_id, user_id)` UNIQUE에
  `rating_before`·`rating_after`. 전적 화면의 "이 판에 +18" 표시용이고, 집계가
  어긋났을 때 재구성하는 근거이기도 하다.

### 갱신 경로 — 보관과 같은 트랜잭션

- 진입점은 `MatchArchiveService.archive` **내부**다(게임 종료 순서 ⑤). 회원
  참가자를 골라 현재 레이팅을 읽고 계산해 두 테이블에 쓰되, `matches` INSERT와
  **같은 MySQL 트랜잭션**으로 묶는다 — `matches.game_id` UNIQUE에 걸려 보관이
  실패하면 레이팅도 함께 구르므로, 별도 멱등 장치 없이 이중 반영이 차단된다.
- 실패 정책은 보관과 동일하다: 예외는 `onArchiveFailure`로 흘리고 **게임 종료
  방송을 막지 않는다.**
- 새 모듈은 `src/game/rating/` — `eloCalculator.ts`(순수 함수, MySQL 없이 전부
  테스트), `tier.ts`(경계 상수), `ratingStore.ts`(포트 + MySQL 구현, 보관과
  트랜잭션 커넥션 공유), 공개 표면 `index.ts`. `game/ranking/`과 같은 3층
  관용이다.
- **주간 랭킹은 건드리지 않는다.** `WeeklyRankingService`의 `YACHT_DICE`
  하드코딩·캐시·REST 전부 그대로다 — 주간 최고점과 누적 레이팅은 별개 지표로
  공존한다.

### REST 2개 신설

| 요청 | 응답 |
|---|---|
| `GET /api/v1/users/me/stats` | 200 게임별 `{gameCode, rating, tier(언랭크는 null), ratedGames, wins, losses, draws, plays}` 배열. 401·403은 프로필 REST와 동일 |
| `GET /api/v1/users/me/matches?limit=` | 200 최근 경기 `{finishedAt, gameCode, rank, playerCount, totalScore, ratingBefore?, ratingAfter?}` 배열 |

`users.ts`·`ranking.ts`에 중복된 `authenticateMember`가 **세 번째 사용처**를
만나므로, 주석에 예정된 대로 `http/`로 승격하는 리팩터링을 이 작업에 포함한다.

### 티어를 방에 싣는 방법

야추 방 **입장 시점**(joinRoom)에 회원이면 티어를 한 번 조회해 새 해시
`room:{roomCode}:tiers`(playerId → tier)에 적고, 방 키 가족에 포함시켜 같은
순간에 만료시킨다. WS 스냅샷(`RealtimeRoomSnapshotService`)과
`room.player.joined`가 이 해시를 읽어 `tier`를 채운다. 대상 게임이 아닌
방·게스트·봇·언랭크는 필드를 생략한다. 게임 중에 레이팅이 변해도 그 판의 휘장은
입장 시점 값으로 고정한다 — 다시 조회하지 않는다.

### 진행 순서 (PR 4개, 각각 독립 배포 가능)

1. **백엔드 기반**: V3 + `game/rating/` + 보관 트랜잭션 훅. 화면 변화 없이
   데이터부터 쌓는다 — 다음 단계 전에 실데이터로 티어 경계를 점검할 수 있다.
2. **조회 REST + 내 전적 UI**: `/users/me/stats`·`/users/me/matches`와 계정
   다이얼로그의 「내 전적」 활성화.
3. **계약 넓히기 + 로비 휘장**: `wsEvents.ts`의 `Player.tier?`(프론트가 정본 —
   먼저 고치고 서버가 맞춘다) + `room:{code}:tiers` + 휘장 표시. 프론트·서버를
   같은 PR에서 바꾼다.
4. **(선택) 확장**: 게임 중·결과 화면 휘장, 랭킹 티커 휘장, 다빈치 코드 편입,
   시즌 리셋.

### 검증

- 단위: `eloCalculator`(쌍별 계산·동순위 0.5·회원 필터·K 분배·허용 목록 밖
  무시), `tier` 경계값, 보관 실패 시 레이팅 미반영(같은 트랜잭션).
- 통합: `MYSQL_TEST_REQUIRED=1`로 V3 적용과 집계 SQL을 검증한다 — 기존 전적
  통합 테스트와 같은 조건이라 CI(mysql:8.0 service)에서 돈다.
- 티어 해시: 입장 시 기록, 방 키 가족과 만료 동행, 비대상 게임에서 생략.

## 하위 시스템 상태

| 하위 시스템 | 설계 문서 | 상태 |
|---|---|---|
| WS 게이트웨이·envelope·하트비트 | realtime.md | ✅ 코어 + 게임 dispatch |
| 세션·게스트·회원 | rooms-and-sessions.md | ✅ 세션·인증 + 프로필 REST. 프로필의 MySQL 통합 6건은 `MYSQL_TEST_URL` 부재로 **미실행** |
| 방·Lua·파티·폐쇄 수명 | rooms-and-sessions.md | ✅ 키·Lua 9종·스냅샷·REST·폐쇄 스케줄러. 고아 방 청소는 부팅 재무장(`game/startupResume.ts`)이 대신한다 |
| 봇 참가자 | rooms-and-sessions.md | ✅ ADD/REMOVE Lua·REST·supportsBots 게이트·`state.sync` |
| 퀵매치 | rooms-and-sessions.md | ✅ 큐·락(토큰 CAS 해제 Lua)·최장 대기 host·롤백, WS 소켓 생존 조건 자동 시작, 티켓 소비·FINISHED 자기 치유, REST 3종 |
| 게임 모듈 프레임워크 | game-modules.md | ✅ 레지스트리 dispatch(접두사 검증·스트립·교차 네임스페이스 거부)·`GameLifecycleService`(start 실패 시 롤백). 정원·minPlayers·supportsBots는 카탈로그가 유일한 출처 |
| 라운드·타이머·타임아웃 | game-modules.md | ✅ 도메인·마감 스케줄러·스토어 포트 + 타이머·타임아웃 해소·동기화 서비스. 바깥 계층은 좁은 포트로 역전한다 |
| 점수 확정·조회 | game-modules.md | ✅ 점수 도메인·CONFIRM_SCORE Lua(반환 코드 10종)·확정 서비스·라운드 원자 결합 + 게임 종료·랭킹 + 조회 REST |
| 재접속 스냅샷·스위퍼 | reconnect.md | ✅ 재접속 스냅샷(rollCount·dice·held 동봉, scores는 Map→객체 정규화) + `OrphanedRoundStateSweeper`(5분, cancel→remove) |
| 야추 (+봇) | games/yacht.md | 🚧 모듈·`RedisYachtDiceStateStore`·`YachtTurnActionService`·dice 릴레이 비대칭·`markPhase('playing')` + 봇 스택(지연 4종·세대 가드·TurnVersion·Expectimax 예산 강제·Local 폴백·2봇 완주), 총 120건. **프론트 e2e:real 미검증** |
| 석양이 진다 | games/duel.md | 🚧 `DuelRules`(판정·파울·캡)·상태 스토어(version 비증가 무시)·version 키 스케줄링·forfeit·점수=잔탄. **프론트 e2e:real 미검증** |
| 다빈치 코드 | games/davinci.md | 🚧 규칙·상태·좌석별 유니캐스트·WS 모듈·점수 기록, 단위 62건(2026-08-29) |
| 탁구 (+AI 결과) | games/pingpong.md | 🚧 규칙(궤적·판정 창·judgedAt)·상태 스토어·서비스·모듈 + AI 결과 REST(게스트는 `user_id` NULL). **프론트 e2e:real 미검증** · 실 MySQL 3건 미실행. **파티 방에서는 랠리를 시뮬레이션하지 않는다**(아래 절) |
| 텍스트 채팅 | chat.md | ✅ `chat.send`/`chat.message` 중계. 음성 시그널링을 대체했다(아래 절) |
| 컨트롤러 링크 시그널링 | controller-signal.md | 🚧 `ctrl.signal`/`ctrl.signaled` 유니캐스트 릴레이 추가 중(아래 절). 서버는 `data`를 열지 않는다 |
| 소셜 로그인·프로필 | auth.md | ✅ authorize/callback/session/me/logout, state·로그인 코드 1회용, kakao·google, 가입 경합 재조회. MySQL 통합 6건은 `MYSQL_TEST_URL` 부재로 **미실행** |
| 전적·주간 랭킹 | persistence.md | ✅ MySQL 풀·Flyway 호환 러너 + 전적 보관(멱등·닉네임 우선순위·users로 회원 판정) + 주간 랭킹(KST 경계·집계·캐시·REST). **MySQL 집계·저장 통합 22건은 `MYSQL_TEST_URL`·docker 부재로 미실행 — SQL 문법조차 미검증** |
| 유저 전적·레이팅 (야추) | persistence.md(승격 예정) | 🆕 **계획만 수립, 구현 미착수** — 아래 절. 게임별 Elo·티어 6단·`Player.tier` 넓히기·REST 2개 |
| 모니터링·배포 | operations.md | 🚧 게이지 2종(`prom-client` 없이 텍스트 노출, 16건) + 배포 파이프라인(Dockerfile arm64 크로스 빌드·compose 전체 스택·GHA+GHCR, [ADR-0006](docs/adr/0006-github-actions-ghcr-arm64-single-host.md)). **이미지 실빌드·arm64 실기동·MySQL 통합 48건 미검증** |

✅ 구현·테스트 완료 · 🚧 진행 중 또는 미검증 항목 있음 · 🆕 계획만 있음

## 리스크

- **Lua 스크립트.** 원자성 시맨틱과 반환 코드가 계약이다 — 스크립트를 손볼 때는
  동시성 통합 테스트(동시 제출 16건·완료 8건·동일 변이 2건 등)를 함께 본다.
  키 이름을 스크립트 안에서 조립하는 부분은 **단일 Redis 노드 전제**다.
- **타이머·스케줄러.** 마감 슬롯 선등록 레이스(과거 실사고), 세대 가드, 25s+1s
  유예, 발화-취소 경합이 전부 테스트로 고정돼 있다. 프로세스 재시작 시 마감
  유실은 해결됐다 — 마감 시각이 Redis에 있고(`game/round/deadlineStore.ts`)
  부팅 재무장이 그 값으로 되살린다(`game/startupResume.ts`). 재무장은 방마다
  fail-closed이고 Yacht·Duel·PingPong 셋을 모두 검증한다
  ([`deploy/PLAN.md`](../deploy/PLAN.md) PR 6).
- **통합 테스트 인프라.** Redis 의존 계약(Lua·TTL·동시성)은 모킹으로 검증할 수
  없다. Redis는 로컬 `redis-server`를 띄우고([ADR-0004](docs/adr/0004-redis-integration-test-harness.md)),
  MySQL은 `MYSQL_TEST_URL`이 있을 때만 돈다([ADR-0005](docs/adr/0005-flyway-compatible-migration-runner.md)).
  **MySQL 통합 스위트가 실제로 돈 적이 거의 없다** — 위 상태 표의 미실행 항목들이
  그것이다.
- **단일 프로세스 제약.** WS 구독·타이머·폐쇄 예약·랭킹 캐시가 인메모리다.
  수평 확장은 범위 밖 — 필요해지면 별도 ADR.
- **오류 표면의 비일관성이 계약이다.** plain-text 코드 문자열, API마다 다른 401
  본문, START 실패 사유 뭉개짐 등을 "개선"하고 싶은 유혹을 참는다 — 프론트가
  문자열 단위로 매핑한다.
