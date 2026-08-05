# 라이어스 다이스 규칙과 완성 상태

> Jira: S15P11A406-210 · 게임 코드 `LIARS` · 2~6인 온라인 멀티

티켓 본문에는 "범위 확정 필요"가 남아 있다. **확정된 범위는 온라인 멀티 풀코스**이고, 이 문서가
그 결정과 구현된 규칙을 기록한다. 규칙의 SSOT는 서버
[`LiarsRules.java`](../../../backend/src/main/java/com/ssafy/yorr/game/liars/LiarsRules.java)다 —
이 문서와 코드가 어긋나면 코드가 이긴다.

## 규칙

각자 주사위 5개(`DICE_PER_PLAYER`)를 숨긴 채 시작한다. 눈은 1~6(`FACES`).

1. **선언(bid)** — 차례인 사람이 "눈 X가 판에 Y개 이상 있다"를 부른다. 직전 선언보다 반드시
   높아야 한다: **수량이 오르거나, 같은 수량에서 눈이 커야 한다**(`raises`). 수량 상한은 판에
   남은 주사위 총합이다.
2. **챌린지** — 차례인 사람은 선언 대신 직전 선언을 의심할 수 있다. 선언이 없는 라운드 첫
   순번은 챌린지할 수 없다(`no_bid_to_challenge`).
3. **판정** — 전원의 손패에서 그 눈의 개수를 센다(1은 만능이 아니다 — 기본 룰).
   - 실제 개수 ≥ 선언 수량 → **선언이 참**, 의심한 사람이 주사위 1개를 잃는다
   - 실제 개수 < 선언 수량 → **선언이 거짓**, 선언한 사람이 주사위 1개를 잃는다
4. **공개(REVEAL)** — 판정 결과와 전원의 손패를 4.5초(`REVEAL_MILLIS`) 동안 공개한다. 그 뒤
   자동으로 다음 라운드로 넘어간다.
5. **다음 라운드의 선은 직전에 진 사람**이다(탈락했으면 그 다음 생존자). 살아 있는 사람이 남은
   개수만큼 다시 굴린다.
6. 주사위가 0개가 되면 탈락. **마지막 1인이 승리**한다. 점수는 남은 주사위 개수다.

## 숨긴 정보를 지키는 경계

이 게임의 유일한 보안 지점이다. **`LiarsState.view()`가 손패를 떼는 단 하나의 관문**이다.

- 방 전체 → `game.liars.state`에 `view()` (손패 없음, 남은 개수만)
- 각자에게 따로 → `game.liars.hand`에 **자기 손패만** (개인 소켓 전송)
- 남의 눈이 방송에 실리는 건 챌린지로 공개되는 `lastReveal.hands` 하나뿐

프론트에서 가리는 방식은 쓰지 않는다 — 개발자 도구로 다 보인다. 서버가 애초에 보내지 않는다.
`LiarsGameService`에서 방송에 `state`를 그대로 넘기면 전원 손패가 나간다.

## 진입 경로

**랜딩 카드는 `live: false`로 '준비 중' 상태를 유지한다**(제품 결정). `games.ts`의 `liars`에
`gameCode: 'LIARS'`만 부여했고, 진입은 `/join?game=liars` 직접 URL로만 열려 있다. QA가 끝나면
`live: true` 한 줄로 랜딩에 노출된다 — 코드는 이미 준비되어 있다.

부수효과: `isPartyGameKey`가 `gameCode !== undefined`로 판정하므로 `/party?game=liars`도 이제
야추로 폴백하지 않고 해석된다. 랜딩에 노출되지 않으니 직접 URL로만 닿는다.

---

## ⚠️ 추가로 필요한 작업

### 1. 백엔드 컴파일·테스트 검증 (최우선 · 병합 전 필수)

**`game/liars/**` 의 Java 8파일(~1000줄)은 한 번도 컴파일된 적이 없다.** 작업 환경에 JDK가
없었다(`java`/`javac` 부재, `JAVA_HOME` 미설정). 코드는 `duel`·`pingpong` 모듈을 1:1로 따르고
API 시그니처를 원본과 대조했지만, **컴파일이 되는지조차 보증할 수 없다.**

```bash
cd backend && ./gradlew test --tests '*Liars*'
```

`LiarsRulesTest`(13케이스)가 승자까지 완주하는 것을 덮는다. 이걸 통과시키는 것이 병합의 최소
조건이다. 실제 2인 이상 온라인 완주도 아직 검증되지 않았다(Redis·서버 미기동).

### 2. 턴 마감 타이머 없음

지금 타이머는 **공개 판정(REVEAL) → 다음 라운드 하나뿐**이다. 연결은 살아 있는데 아무 조작도
하지 않는 사람이 있으면 **그 방은 그 턴에서 영구히 멈춘다**(연결이 끊기면 `removePlayer`가
이탈로 처리한다).

인프라는 이미 있다 — `LiarsGameService`가 `RoundDeadlineScheduler`를 주입받고 있고,
`schedule()`이 이미 `state.nextActionAt()` 시각에 `state.version()`을 키로 타이머를 건다.
BIDDING 상태의 `nextActionAt`이 0이라 걸러지는 것뿐이다(`REVEAL_MILLIS`는 챌린지에서만 채운다).

최소 해법 (~40줄, 새 파일 0개):

1. `LiarsRules`에서 BIDDING 상태를 만들 때 `nextActionAt = now + TURN_MILLIS`를 채운다
   (`initial`·`bid`·`nextRound` 3곳). 이것만으로 `schedule()`이 자동으로 타이머를 건다.
2. `LiarsRules`에 순수 함수 `timeoutAction(state, random, now)` 추가 — 테이블에 선언이 있으면
   자동 챌린지, 없으면(라운드 첫 순번) 최소 인상 자동 입찰. **첫 순번 예외를 빼먹으면
   `no_bid_to_challenge`로 터진다.**
3. `LiarsGameService.timeout()`을 phase로 분기 — `REVEAL`은 지금처럼 `resolveReveal`,
   `BIDDING`은 `timeoutAction`.

경합은 이미 막혀 있다. `timeout()`의 `if (current.version() != expectedVersion) return null;`
가드와 선언마다 오르는 version 덕에, 마감 직전에 사람이 입찰하면 낡은 타이머는 스스로
무효화된다. 야추가 `EXPIRY_GRACE`로 푸는 문제를 여기선 버전 가드가 이미 푼다.

**⚠️ 자동 챌린지만으로는 방이 끝나지 않는다.** 자동 챌린지에서 선언이 거짓이면 주사위를 잃는
쪽은 **입찰자(정상 플레이어)**다. AFK인 사람이 계속 자동 챌린지만 해도 자기 주사위는 줄지 않아
방이 영원히 안 끝날 수 있다. 종료를 보장하려면 `RoundTimerService`의 정책을 복제해야 한다 —
`offlineMisses` 맵으로 연속 마감 N회 → **이미 있는 `LiarsRules.forfeit`** 호출(~10줄).

프론트는 `nextActionAt`을 **이미 `LiarsView`로 받고 있다**. 렌더만 안 하고 있을 뿐이다.

### 3. 카탈로그에서 파생시킨 게임 코드 검증

`isGameCode`가 `roomApi.ts`·`quickMatchApi.ts` 두 곳에 3개 코드로 하드코딩되어 있어 `LIARS`가
`undefined`로 떨어졌다(방은 열리는데 진행 화면이 야추로 뜬다). `games.ts`에서 파생시키는
쪽으로 고쳤으니 다음 게임은 카탈로그 한 줄이면 된다. **`GameCode` 유니온 자체의 정리는 후속
과제**다.

### 4. 1을 만능 눈으로 쓰는 변형

넣지 않았다(기본 룰). 원하면 `LiarsRules.count`만 고치면 되지만, `liarsBid.ts`의 거울 검사도
같이 맞춰야 한다.
