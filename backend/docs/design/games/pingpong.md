# 탁구 (PING_PONG)

> 프레임워크 공통은 [game-modules.md](../game-modules.md). Java 원본:
> `game/pingpong/`. min 2 / max 2 / supportsBots **false**. duel과 같은
> 자체 상태기계 + 버전 키 스케줄링 패턴.

## WS 메시지 (접두사 `game.ping_pong.`)

- 인바운드: `swing {inputSeq:long, clientTs:long}`(위치·파워 없음 — 타이밍이
  전부다), `ready {}`(payload 파싱 안 함).
- 아웃바운드: `game.ping_pong.state`(payload가 **PingPongState 그대로**),
  `game.ping_pong.state.sync`(COUNTDOWN 진입·종료 시에만 snapshot 동봉),
  `game.ping_pong.game.over` + `state.sync`.
- 프론트 리듀서는 `snapshot.gameCode`가 일치할 때만 `game.ping_pong.state`를
  적용한다 — 스냅샷에 gameCode 필수.

## PingPongState

```
version, phase(PREPARING|COUNTDOWN|PLAYING|FINISHED), playerOrder[2],
scores{...}, lastInputSeq{...}, readyPlayerIds[],
ball{pos, direction(±1), speed, smash, fault(OUT|NET|null), faultFrom, x0, x1, launchedAt},
rally, serveReceiverId, nextActionAt,
lastEvent{id(=version), type, playerId, at}
이벤트 타입: READY PRACTICE PLAYER_READY SERVE TOO_EARLY TOO_LATE OK NICE SMASH
             OUT NET POINT GAME_OVER OPPONENT_LEFT
```

## 랠리 시뮬레이션 (1차원 해석적 궤적 — 틱 없음)

- `pos`는 0→1로 player 0 쪽을 향하고, `direction=+1`이 "player 0에게 오는 중".
  현재 위치 = `pos + direction × speed × 경과초`. 좌우(x)는 x0→x1 보간, x1은
  스윙/서브마다 서버 RNG(`0.15~0.85`).
- 판정 창(player 0 기준, player 1은 1-v 미러): 이상점 0.9, 유효 창
  [0.72, 1.06], 1.1 지나면 실점. 창 밖 스윙 = TOO_EARLY/TOO_LATE 이벤트만 내고
  **공은 그대로 날아간다**(헛스윙).
- 창 안: 이상점과의 거리 ≤0.06 → SMASH(속도 1.95), ≤0.1 → NICE(1.0), 그 외
  OK(0.82). 더 벗어나면 폴트 — 이르면 OUT, 늦으면 NET(둘 다 공은 되돌아가되
  마감 시 상대 득점). rally는 정상 리턴에만 +1.
- 네트 통과는 항상 궤적 진행률 0.5. 마감 시각은 궤적에서 역산(NET은 0.5
  지점에서 사망, OUT은 테이블 밖 ±0.5).

## 업링크 지연 보상

`판정시각 = max(now-120ms, min(now, clientTs))` — 이상점→네트 밴드 폭이
0.12(정상 속도 기준 120ms)라 업링크 지연이 완벽한 스윙을 네트로 만든다.
미래 timestamp는 now로, 과거는 120ms까지만 롤백(죽은 공을 쳤다고 주장 불가).
알려진 잔여 구멍(클라이언트 시계가 느리면 공짜 롤백)과 개선안(벽시계 대신
상태 기준 경과시간)은 Java 주석에 있다 — 계약 동결이므로 그대로 이식.

## 준비 게이트·서브·득점

- initial은 PREPARING, `nextActionAt=0`(타이머 없음). PREPARING 중 swing은
  PRACTICE 이벤트(연습 — inputSeq만 기록). **ready는 그 플레이어가 연습 스윙을
  한 뒤에만 유효**(`lastInputSeq>=0`) — "모션 입력이 동작한다"는 핸드셰이크다.
  둘 다 ready → COUNTDOWN(2600ms 후 서브).
- 서브 로테이션: 상태는 **리시버**를 저장. 2점마다 교대, 10:10부터 매 점 교대.
- 11점 선취 + 2점 차 승리(듀스). 만료 판정: 폴트 공은 친 쪽 상대 득점, 무폴트
  방치 공은 안 친 쪽 상대 득점. 득점 후 COUNTDOWN 재진입.
- 이탈: PREPARING 중이면 **게임 자체를 취소**(스케줄 취소, 상태 삭제,
  CANCEL_ACTIVE_GAME Lua, WAITING 마킹, `room.player_left` →
  `game.ping_pong.state.sync` 순서 — 시작도 안 한 매치를 이겼다고 주지 않는다).
  경기 중이면 forfeit(생존자 11점, OPPONENT_LEFT).
- 종료 시 점수 기록·완료는 duel과 동일(`finishIfComplete(force=true)`,
  roster 잔존자만).

## 저장·스케줄링

duel과 동일 패턴: `RedisPingPongStateStore` SETNX init
(`ping_pong_already_initialized`), 5초 락, 방 TTL 복사, version 비증가 변이는
무시. 스케줄러 키 = version; COUNTDOWN 타임아웃 → serve, 그 외 → expire.
**마감이 이미 지난 예약(delay 0)이 흔한 게임**이라 스케줄러의 슬롯 선등록
규칙이 특히 중요하다([game-modules.md](../game-modules.md)의 레이스 회귀).

## AI 결과 (REST — 멀티플레이 파이프라인과 무관)

로컬 싱글플레이(온디바이스 AI) 결과를 클라이언트가 직접 보고한다.

- `POST /api/v1/games/ping-pong/ai-results`
  본문 `{resultId(UUID), humanScore, aiScore}`. `Authorization` 선택 —
  없으면 게스트로 보관(임의 UUID, 닉네임 "게스트"), 있는데 형식이 틀리면 401
  `session_expired`.
- 검증: resultId는 UUID(`invalid_result_id`), 점수는 **11점·2점차 종료 조건
  재검증**(`invalid_final_score`) — 불가능한 스코어라인 차단.
- 성공 204(본문 없음). `MatchArchiveService.archive(gameId=resultId,
  gameCode=PING_PONG, roomCode="LOCAL_AI")`로 저장 — AI는
  `playerId="ping-pong-ai"`, 닉네임 "AI". gameId 유니크 제약이 중복 보고를
  막는다. **MySQL 의존이므로 Phase 4에서 이식**한다.

## 이식할 대표 테스트

judgedAt 3분기(과거 클램프·미래 클램프·120ms 캡) / 이상점 스매시 + 중복
inputSeq 무시 / 실점 시 상대 득점·서브 유지(2점 규칙) / 서브 로테이션 표
(0:0→10:10→듀스) / 듀스 2점차 종료 / 이탈 forfeit / **연습→ready 게이트**
(연습 전 ready는 동일 상태 반환) / PREPARING 이탈 시 취소 시퀀스(브로드캐스트
2건 순서까지) / AI 결과: 불가능 점수 거부·UUID 검증·게스트/회원/잘못된 헤더
분기.
