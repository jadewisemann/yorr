# 석양이 진다 (DUEL)

> 프레임워크 공통은 [game-modules.md](../game-modules.md). Java 원본:
> `game/duel/`. min 2 / max 2 / supportsBots **false**. 라운드 프레임워크
> (RoundState·RoundTimerService)를 쓰지 않고 자체 상태기계 + 버전 키 스케줄링을
> 쓴다.

## 구현 지도 (`src/game/duel/`)

| 파일 | 책임 |
|---|---|
| `duelState.ts` | 상태·라운드 타입(와이어 그대로) |
| `duelRules.ts` | **판정·파울·캡 — 순수 함수**. 전송·Redis를 모른다 |
| `duelStateStore.ts` | Redis 상태 저장(SETNX·락·TTL 복사·version 가드) |
| `duelScoreboard.ts` | 종료 시 점수(잔탄) 기록 |
| `duelGameService.ts` | 시각·난수 주입, 방송, 마감 예약, 종료 처리 |
| `duelGameModule.ts` | WS 표면(`draw` 라우팅·검증·오류 응답) |
| `duelPorts.ts` | 바깥 계층(ws·room·완료)의 **좁은 포트** |

바깥 의존은 2.5·2.7과 같이 포트로 역전한다(`duelPorts.ts`): 브로드캐스터·레지스트리
(phase 표시·소켓→멤버 조회)·실시간 스냅샷·마감 스케줄러·게임 종료·점수 기록.
실제 클래스가 구조적으로 그 포트를 만족하므로 어댑터가 없고,
`__tests__/duelPorts.contract.test.ts`가 그 대입 가능성을 고정한다.

## WS 메시지 (접두사 `game.duel.`)

- 인바운드는 **`draw` 하나뿐**: `{inputSeq:long, reactionMs:int}`.
  `payload==null || inputSeq<0` → `invalid_duel_draw`. ready 메시지는 없다 —
  게임 시작 즉시 듀얼이 시작된다.
- 아웃바운드: `game.duel.state`(payload가 **DuelState 그대로**, 래핑 없음),
  `game.duel.state.sync`(`{snapshot}` — snapshot.game에 DuelState; WAITING과
  종료 시에만 동봉), `game.duel.game.over` + `state.sync`(완료 서비스).
- reactionMs 센티널: `-1` = FOUL(신호 전 발사 자진 신고), `-2` = MISS(서버가
  미응답 채움). 센티널에 페널티를 더하면 안 된다.

## DuelState

```
version(모든 변이마다 +1), phase(WAITING|SIGNAL|RESULT|FINISHED),
playerOrder[2], hp{...}, fouls{...}, reactions{...}, lastInputSeq{...},
round, signalAt, nextActionAt,
lastRound{number, kind(SHOT|TIE|WARNING|SELF_SHOT|FORFEIT), shooterId, hitId,
          koId, foulId, over, at}
```

null 취급이 두 갈래인 것이 계약이다:
`lastRound`는 **필드 자체가 생략**되고(`@JsonInclude(NON_NULL)`은 DuelState에만
붙어 있다 → JS에서는 `undefined`), `lastRound` **안의**
shooterId·hitId·koId·foulId는 애노테이션 없는 중첩 레코드라 **`null`이 실린다**.
`playerOrder[0]`은 호스트다 — 화면 좌우 배치가 아니라 판정 순서의 기준이다.

## 규칙 상수와 흐름

- hp 3(총알), 파울 상한 2. 빨강→초록 대기 **1400~4600ms 서버 RNG**(매 라운드
  재추첨). 신호 후 아무도 안 쏘면 2600ms에 무효 라운드. 한 명이 쏘면 상대에게
  **700ms 유예**. 연출 홀드: TIE 1650 / RESULT 2150 / KO 2900ms.
- 흐름: `WAITING --(nextActionAt)--> SIGNAL --draw/만료--> RESULT --(홀드)-->
  다음 라운드 WAITING 또는 FINISHED`. 라운드 수 제한·선취점 없음 — hp 0 또는
  2번째 파울까지.
- 이탈: `forfeit` — 이탈자 hp 0, 생존자가 shooterId, kind FORFEIT, 즉시 FINISHED.

### 판정 규칙표

두 반응값(ms 또는 센티널)만으로 결정된다. **한쪽이라도 FOUL이면 승부를 보지 않고
파울 처리**가 먼저다(playerOrder 앞쪽이 우선 검사되므로 양쪽 파울은 앞쪽이 책임진다).

| 두 반응 | kind | hp 변화 | over |
|---|---|---|---|
| 양쪽 유효, 값이 다르다 | `SHOT` | 느린 쪽 -1 | 맞은 쪽 hp 0이면 true |
| 양쪽 유효, **1ms까지 같다** | `TIE` | 없음 | false |
| 한쪽만 유효(상대 MISS) | `SHOT` | 얼어붙은 쪽 -1 | 맞은 쪽 hp 0이면 true |
| 양쪽 MISS | `TIE` | 없음 | false |
| 한쪽 FOUL, 통산 1회차 | `WARNING` | **없음**(상대 무피해) | false |
| 한쪽 FOUL, 통산 2회차 | `SELF_SHOT` | **본인** -1 | **true**(즉시 패배) |
| 이탈 | `FORFEIT` | 이탈자 hp = 0 | true |

- 경고(`fouls`)는 **매치 전체에 걸쳐 누적되고 리셋되지 않는다**. Java 주석은
  "한도에 닿아 소진되면 0으로 돌아간다"고 하지만 코드도 테스트도 누적을 고정한다
  — **테스트가 계약**이다.
- `SELF_SHOT`은 hp를 1만 깎으므로 총알 2개를 든 채로 질 수 있다. 총알로 환산하지
  않는 이유: 환산하면 "총알을 아끼는 대신 파울을 쓴다"는 계산이 생긴다. 대신 점수
  기록이 쓰러진 쪽을 0으로 눌러 순위 역전을 막는다(아래 「저장·스케줄링」).

### 상태 전이

| phase | 들어오는 사건 | 다음 phase | 비고 |
|---|---|---|---|
| (없음) | `start` | WAITING | `initialize` + `markPhase('playing')` + 첫 예약 |
| WAITING | `draw` | RESULT | **무조건 FOUL** — 신호가 빨강이면 payload를 믿지 않는다 |
| WAITING | 마감(`signal`) | SIGNAL | `signalAt = now`, `nextActionAt = now + 2600` |
| SIGNAL | 첫 `draw` | SIGNAL | `nextActionAt = min(기존, now + 700)` (유예) |
| SIGNAL | 둘째 `draw`·FOUL | RESULT | 판정 → `nextActionAt = now + hold(round)` |
| SIGNAL | 마감(`expire`) | RESULT | 미응답을 MISS로 채우고 판정 |
| RESULT | 마감, `over=false` | WAITING | `nextRound` — round+1, reactions 비움, 대기 재추첨 |
| RESULT | 마감, `over=true` | FINISHED | `finish` — KO 연출이 끝난 뒤 결과 화면 |
| 아무 phase | `removePlayer` | FINISHED | `forfeit`(이미 FINISHED면 무변화) |
| FINISHED | 모든 사건 | FINISHED | 마감은 무시, 예약도 걸지 않는다 |

## 반응 시간 검증 (안티치트)

- phase가 아직 WAITING이면 payload가 뭐라 하든 FOUL(신호 전 발사 — 판정 권위는
  서버). DESIGN.md 원칙 1의 사례다: **반응 시간 판정도 서버가 한다.**
- 수용값 = `max(0, min(신고값, 서버 경과시간 now-signalAt))` — 서버 시계보다
  빠르다고 주장할 수 없다. 느리게 신고하는 건 허용(업링크 지연을 플레이어
  불이익이 아니라 이점으로 두는 의도적 양보 — 과소 신고는 못 막는다고 코드에
  명시).
- `inputSeq <= lastInputSeq`는 무시(리플레이 방지). 판정과 무관한 draw도
  시퀀스는 저장한다. 이미 reactions에 있는 플레이어의 재발사는 무시.

## 저장·스케줄링

- `RedisDuelStateStore`: 야추 스토어와 동일 패턴(SETNX init
  `duel_already_initialized`, 5초 락 + 토큰 비교 해제 Lua, 방 TTL 복사) +
  **version이 안 오른 변이는 버린다**(no-op 규칙 함수 = 무브로드캐스트).
  JS 판은 Java의 `==` 비교를 `<=`로 좁혔다 — 오래된 스냅샷이 새 판정을 덮는
  경로를 구조적으로 막는다.
- 스케줄러 키 = `state.version`(라운드 번호가 아니다), 발화 시 기대 버전
  불일치·FINISHED면 무시. phase별 타임아웃: WAITING→signal,
  SIGNAL→expire(미응답 MISS 채움), RESULT→lastRound.over면 finish 아니면
  nextRound, FINISHED→없음.
- 종료 시 점수 기록: **남은 총알 수**(쓰러진 쪽 = `lastRound.koId`는 강제 0 —
  파울 패자가 총알 2개로 1위가 되는 것 방지). roster(`room:{code}:players`)에
  남아 있는 플레이어만 기록하고, 쓰는 곳은 야추와 같은 `room:{code}:scores`
  해시라 종료 판정·조회 REST가 그대로 읽는다. 완료는
  `finishIfComplete(force=true)` — 결투에 "점수판 12칸 완료"는 성립하지 않는다.
- `removePlayer`는 forfeit만 적용한다 — 레지스트리·roster 제거는 호출자(WS
  게이트웨이) 몫이다(야추·탁구와 다름, 주의).
- `start`는 `markPhase('playing')`을, `reset`은 `markPhase('waiting')`을 부른다.
  전자를 빼면 진행 중 방의 레지스트리 phase가 waiting에 머물러 **끊긴 플레이어가
  offline 전이가 아니라 `room.player_left`가 된다**(IMPLEMENTATION_NOTES 2.1의
  「registry phase 구멍」이 여기서 닫힌다).

## 오류 매핑

| 상황 | 도메인 | WS 응답 |
|---|---|---|
| 소켓이 방에 없다 / 봉투 roomId ≠ 현재 방 | — | `NOT_IN_ROOM` "current room membership is required" |
| payload 형식 위반(정수 아님·필드 없음) | — | `INVALID_MESSAGE` "invalid draw payload" |
| `inputSeq < 0`·비정상 수치 | `DomainError('invalid_duel_draw')` | `INVALID_MESSAGE` "invalid_duel_draw" |
| 상태 락 경합 | `ConflictError('game_state_busy')` | `INVALID_MESSAGE` "invalid draw payload" |
| 저장된 상태가 깨졌다 | `ConflictError('invalid_duel_state')` | 같음(뭉개진다) |
| 시작 인원이 2명이 아니다 | `ConflictError('duel_requires_two_players')` | (WS 아님 — REST 시작이 롤백된다) |
| 상태가 이미 있다 | `ConflictError('duel_already_initialized')` | 같음 |

도메인 오류 코드 문자열은 그대로 나가고 그 밖의 실패는 Java와 같이
`invalid draw payload`로 뭉갠다 — 오류 표면을 넓히지 않는 쪽이 계약 동결에 맞다.

## 이식할 대표 테스트 (DuelRulesTest — 순수 도메인)

빠른 쪽 승 / ms 동률 TIE / 1차 파울 경고(양쪽 hp 무손실) / 2차 파울 즉시 패배
(hp 2 잔존 + fouls 비리셋) / 경고의 라운드 간 누적 / WAITING 중 draw는 항상
파울 / 신고값의 서버 경과시간 캡 / 전원 미발사 무효 / 유예 만료 시 굳은 쪽
피격 / 3피격 KO 후 finish / 중복 inputSeq 무시 / 이탈 forfeit.

이식 위치는 `src/game/duel/__tests__/duelRules.test.ts`(12종 + `compareDraw`
비교표). 그 밖에 스토어(version 비증가·TTL·락 해제), 서비스(예약 키·점수=잔탄·
forfeit·phase 표시), 모듈(라우팅·오류 매핑), 포트 계약 스위트가 같은 폴더에 있다.
