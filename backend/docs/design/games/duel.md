# 석양이 진다 (DUEL)

> 프레임워크 공통은 [game-modules.md](../game-modules.md). Java 원본:
> `game/duel/`. min 2 / max 2 / supportsBots **false**. 라운드 프레임워크
> (RoundState·RoundTimerService)를 쓰지 않고 자체 상태기계 + 버전 키 스케줄링을
> 쓴다.

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

## 규칙 상수와 흐름

- hp 3(총알), 파울 상한 2. 빨강→초록 대기 **1400~4600ms 서버 RNG**(매 라운드
  재추첨). 신호 후 아무도 안 쏘면 2600ms에 무효 라운드. 한 명이 쏘면 상대에게
  **700ms 유예**. 연출 홀드: TIE 1650 / RESULT 2150 / KO 2900ms.
- 흐름: `WAITING --(nextActionAt)--> SIGNAL --draw/만료--> RESULT --(홀드)-->
  다음 라운드 WAITING 또는 FINISHED`. 라운드 수 제한·선취점 없음 — hp 0 또는
  2번째 파울까지.
- 판정: 둘 다 유효하면 빠른 쪽 승, **ms까지 같으면 TIE**(총알 소모 없음), 한
  쪽만 유효하면 그쪽 승, 둘 다 무효면 TIE. 패자 hp-1, 0이면 KO.
- **파울**: 1회차 = WARNING(라운드 무효, 경고 적립 — 경고는 매치 전체에 걸쳐
  누적되고 리셋되지 않는다. Java 주석은 "리셋"이라고 하나 테스트가 누적을
  고정한다 — 테스트가 계약). 2회차 = SELF_SHOT: 남은 총알과 무관하게 즉시 패배
  (hp는 1만 깎여 2가 남을 수 있다 — 그대로가 계약).
- 이탈: `forfeit` — 이탈자 hp 0, 생존자가 shooterId, kind FORFEIT, 즉시 FINISHED.

## 반응 시간 검증 (안티치트)

- phase가 아직 WAITING이면 payload가 뭐라 하든 FOUL(신호 전 발사 — 판정 권위는
  서버).
- 수용값 = `max(0, min(신고값, 서버 경과시간 now-signalAt))` — 서버 시계보다
  빠르다고 주장할 수 없다. 느리게 신고하는 건 허용(업링크 지연을 플레이어
  불이익이 아니라 이점으로 두는 의도적 양보 — 과소 신고는 못 막는다고 코드에
  명시).
- `inputSeq <= lastInputSeq`는 무시(리플레이 방지). 판정과 무관한 draw도
  시퀀스는 저장한다. 이미 reactions에 있는 플레이어의 재발사는 무시.

## 저장·스케줄링

- `RedisDuelStateStore`: 야추 스토어와 동일 패턴(SETNX init
  `duel_already_initialized`, 5초 락, 방 TTL 복사) + **version이 안 오른 변이는
  버린다**(no-op 규칙 함수 = 무브로드캐스트).
- 스케줄러 키 = `state.version`, 발화 시 기대 버전 불일치·FINISHED면 무시.
  phase별 타임아웃: WAITING→signal, SIGNAL→expire(미응답 MISS 채움),
  RESULT→lastRound.over면 finish 아니면 nextRound, FINISHED→없음.
- 종료 시 점수 기록: **남은 총알 수**(쓰러진 쪽 강제 0 — 파울 패자가 총알 3개로
  1위가 되는 것 방지). roster에 남아 있는 플레이어만 기록. 완료는
  `finishIfComplete(force=true)`.
- `removePlayer`는 forfeit만 적용한다 — 레지스트리·roster 제거는 호출자(WS
  게이트웨이) 몫이다(야추·탁구와 다름, 주의).

## 이식할 대표 테스트 (DuelRulesTest — 순수 도메인)

빠른 쪽 승 / ms 동률 TIE / 1차 파울 경고(양쪽 hp 무손실) / 2차 파울 즉시 패배
(hp 2 잔존 + fouls 비리셋) / 경고의 라운드 간 누적 / WAITING 중 draw는 항상
파울 / 신고값의 서버 경과시간 캡 / 전원 미발사 무효 / 유예 만료 시 굳은 쪽
피격 / 3피격 KO 후 finish / 중복 inputSeq 무시 / 이탈 forfeit.
