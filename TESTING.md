# 테스트 전략

[SQLite가 스스로를 시험하는 방식](https://www.sqlite.org/testing.html)에서 이 저장소에
맞는 것을 골라 옮겼다. 핵심은 세 가지다.

- **독립 하네스를 여럿 둔다.** 한 하네스의 맹점을 다른 하네스가 메운다.
- **출하하는 것을 시험한다**("test what you fly"). 소스가 아니라 실제로 배포되는 산출물에 같은
  테스트를 다시 돌린다.
- **테스트가 정말 잡는지 확인한다.** 버그를 일부러 심어 테스트가 빨개지는지 본다. 초록만으로는
  테스트가 아무것도 안 했을 가능성을 지울 수 없다.

## 하네스와 대응

| SQLite 기법 | 여기서는 | 위치 | 언제 |
|---|---|---|---|
| 독립 하네스 여럿 | 단위 · 블랙박스 프로토콜 · 브라우저 E2E | `backend/src/**/__tests__` · `backend/test/blackbox` · `frontend/e2e` | PR |
| 출하물 시험 | 블랙박스 스위트는 `E2E_BASE_URL`만 바꾸면 배포된 스택(실제 이미지·compose·프록시)에 그대로 돈다 | `backend/test/blackbox/target.ts` | 수동 — CI 배포 리허설 잡은 다음 단계 |
| 차등 테스트(SLT) | 야추 점수의 세 구현(서버·프론트·독립 오라클)을 7,776가지 주사위 × 12칸 **전수** 대조 | `backend/src/game/score/__tests__/scoringDifferential.test.ts` | PR |
| 이상 상황 테스트 | 여정 하나의 Redis 명령 중 **N번째 하나만** 실패시킨다. 모든 N에 대해, 쓰기 전 실패와 쓰기 후 응답 유실 둘 다 | `backend/test/blackbox/anomaly.e2e.test.ts` | PR(4칸 간격) · 야간(전수) |
| 퍼징 | 시드 하나에서 나오는 WS 프레임을 진행 중인 판에 쏟는다 | `backend/test/blackbox/robustness.e2e.test.ts` | PR 400프레임 · 야간 2만 |
| 경계값 | 상한·하한의 안쪽 한 칸과 바깥쪽 한 칸(닉네임 20/21, 정원 6/7, 채팅 200/201, 64KiB/+1 …) | `backend/test/blackbox/boundaries.e2e.test.ts` | PR |
| 자원 누수 검사 | 서버를 띄워 방 20개를 돌리고 닫으면 소켓·리스너·ref 타이머 수가 시작 전과 같다 | `backend/test/blackbox/leaks.e2e.test.ts` | PR |
| 회귀 테스트 | 버그 하나 = 먼저 실패하는 테스트 하나 | 예: `backend/src/ws/__tests__/gatewayFrameErrors.test.ts` | 항상 |
| 커버리지 | 측정하고 임계값을 래칫으로 고정한다. 백엔드는 CI가 강제한다. 프론트는 임계값만 있고 CI는 아직 `npm test`만 돈다 | 각 `vitest.config.ts` | PR(백엔드) |

## 블랙박스 스위트가 지키는 불변식

`backend/test/blackbox`는 서버 내부를 import하지 않는다. 진짜 HTTP(`fetch`)와 진짜
WebSocket만 쓴다. 그래서 같은 테스트가 in-process 서버와 배포된 컨테이너에 똑같이 돈다.

- **팬아웃:** 방송은 방의 모든 자리가 같은 순서·같은 내용으로 받는다.
- **서버 권위:** 주사위는 서버가 만든다. 지킨 자리는 이전 눈을 유지한다.
- **점수:** 모든 `score.update`의 점수판 전체(칸·소계·보너스·합계)가 독립 오라클과 같다. `game.over`
  순위와 결과 조회 REST도 같다.
- **봉투:** 서버가 보낸 프레임은 전부 `{type, ts, payload}` 모양이다. 오류 코드는 계약 목록
  안에 있다.
- **생존:** 어떤 프레임을 받아도 프로세스는 살아 있다. 연결을 끊는 경우는 하트비트·세션 교체·
  프레임 오류뿐이다.
- **새어 나온 예외 0건:** 게이트웨이는 핸들러 밖으로 나온 예외를 로그로만 남기고 소켓을 살려
  둔다. 그래서 in-process 모드는 로그를 모아 `WS 메시지 처리 실패`가 0건인지 확인한다.
  이것을 보지 않으면 버그가 초록 뒤에 숨는다.

## 돌리는 법

```bash
cd backend
npm test                 # 단위 (Redis 통합은 redis-server가 있어야 돈다)
npm run test:coverage    # 단위 + 커버리지 임계값
npm run test:e2e         # 블랙박스 — in-process 서버를 띄운다

# 퍼저 재현: 실패 메시지의 시드를 그대로 넣는다
FUZZ_SEED=123 FUZZ_ITERATIONS=3000 npm run test:e2e -- -t "프로토콜 퍼저"

# 장애 주입 전수(야간과 같다)
ANOMALY_STRIDE=1 npm run test:e2e -- anomaly

# 배포된 스택에 같은 스위트를 돌린다 — 루프백만 허용한다
E2E_BASE_URL=http://localhost npm run test:e2e
```

## 규칙

1. **버그를 고칠 때는 먼저 실패하는 테스트를 쓴다.** 그리고 수정을 되돌렸을 때 그 테스트가
   정말 빨개지는지 확인한다.
2. **퍼저가 실패하면 시드를 기록하고, 문제의 프레임을 경계값·회귀 테스트로 옮긴다.** 시드는
   생성기가 바뀌면 다른 프레임을 낸다. 영구 회귀 테스트는 프레임 자체여야 한다.
3. **`E2E_BASE_URL`에 운영 주소를 넣지 않는다.** 하네스는 루프백이 아닌 주소를 거절한다
   (`E2E_ALLOW_REMOTE=1`로만 풀린다). 퍼저와 장애 시나리오가 같은 스위트에 있기 때문이다.
4. **CI에서 조용히 건너뛰지 않는다.** `REDIS_TEST_REQUIRED=1`·`MYSQL_TEST_REQUIRED=1`이
   켜진 곳에서는 의존이 없으면 건너뛰지 않고 실패한다.
5. 새 계약 코드(오류 코드·메시지 타입)를 만들면 `backend/test/blackbox/contract.ts`의 사본도
   함께 고친다. 퍼저가 모르는 코드를 계약 위반으로 잡는다.

## 찾아낸 것

- **2026-09-30 — WS 프레임 하나로 프로세스가 죽었다.** 게이트웨이가 소켓 `error`를 구독하지
  않아 64KiB 초과나 깨진 UTF-8 한 프레임이 미처리 예외가 됐다. 인증 없이 누구나 보낼 수 있었다
  (#64). 경계값 스위트가 같은 공격을 배포된 스택에도 계속 보낸다.
