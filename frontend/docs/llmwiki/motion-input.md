# 모션 입력과 피드백

> SSOT: [`../../src/yacht/input/`](../../src/yacht/input/) (야추 흔들기/던지기),
> [`../../src/shared/useSwing.ts`](../../src/shared/useSwing.ts) (탁구·결투 공용 스윙),
> [`../../src/yacht/feedback/`](../../src/yacht/feedback/) (진동·효과음·보이스)

원시 센서값은 서버로 보내지 않는다 — 판정된 게임 이벤트만 나간다.

## 야추 입력 파이프라인

```text
DeviceMotionEvent
  → MotionSampleNormalizer   # 중력 고역통과 제거, 화면 회전 보정, 데드존 0.35
  → MotionGestureRecognizer  # 상태기계: calibrating → idle → shakeCandidate → shaking → thrown → cooldown
  → MotionInputController    # 가용성·권한·background 일시정지
  → useMotionRollInput       # React 훅, enabled=false면 센서를 시작조차 안 함
  → useGamePlayRoll          # shakeStarted/shakePulse/throwDetected → 게임 이벤트
```

- **캘리브레이션**: 첫 300ms 샘플로 기기 노이즈를 재서 임계값을 노이즈 배수로 올린다 —
  기기마다 센서 품질이 달라 고정 임계값은 오감지하거나 무반응한다.
- **흔들기 판정**: 히스테리시스(피크/해제 이중 임계) + 피크 간격 창(120~450ms) +
  부호 반전 3회 + 윈도 RMS. 수락된 피크마다 `shakePulse{direction, strength}`가 물리
  사발의 에너지원이 된다.
- **던지기 판정은 축 부호를 보지 않는다** — iOS Safari는 가속도 부호 규약이 Chrome과
  반대라, 양수 방향만 보던 예전 판정은 아이폰에서 아무리 세게 휘둘러도 통과할 수 없었다.
  던지기의 본질은 "앞으로"가 아니라 "한 축을 따라 날카롭게"이고, 흔들기와의 구분은 부호가
  아니라 축 우세 조건(0.6)이 맡는다.
- `enabled=false`(파티 대시보드 등 턴을 가질 수 없는 화면)면 센서 구독 자체가 없다 —
  패널만 숨기면 TV가 모션 권한을 묻는다.
- iOS 권한은 사용자 제스처 안에서만 (`requestPermission()`), 비보안 컨텍스트는 `insecure`,
  탭 전환 시 일시정지 + 제스처 리셋, 700ms 무샘플이면 `silent`.
- 센서 실패·거부 시 항상 탭 조작으로 완주 가능 (`inputMode: 'tap'`).

튜닝 도구: `/__dev/motion`(`MotionLab`) — 실기기 임계값 슬라이더 + 차트 + **녹화/재생**
(녹화한 센서 스트림을 다른 설정으로 결정론적으로 재판정). 배포 환경에도 열려 있다.

## 공용 스윙 훅 (`shared/useSwing`)

탁구 라켓 휘두르기와 결투 총 뽑기가 같은 신호를 쓴다 — 게임을 모르는 기기 입력이라
shared에 둔다. 쿨다운 220ms, 임계 14(결투는 15), 히스테리시스 0.45, 중력 저역통과 0.08 —
`accelerationIncludingGravity` 폴백 기기에서 중력을 빼지 않으면 임계값 14가 실질 4가 된다.

게임별 `enabled` 정책이 의도적으로 다르다: 탁구는 `canControl`로 걸고, 결투는 걸지 않는다
— 안드로이드는 권한 API가 없어 마운트 즉시 granted가 되는데, 게이트를 걸면 "휘두르기
켜기" 버튼이 뜨지 않아 게이트를 열 방법이 사라지는 회귀가 있었다.

## 피드백 (`yacht/feedback/`)

### 효과음·진동 (`createRollFeedback`)

- **오디오 요소는 앱이 뜰 때 모듈 레벨에서 만든다.** iOS는 `<audio>`마다 "사용자 제스처
  안에서 재생된 적 있는가"를 따로 기억한다 — 게임 화면에서 만들면 화면을 만진 적 없는
  관전자에게 1라운드 굴림 소리가 통째로 빠졌다.
- 흔들기 펄스가 240ms 끊기면 사발 소리를 멈춘다 — 손을 멈추면 사발 안 주사위도 멈추므로
  소리만 계속 나면 화면과 어긋난다. 탭 굴림은 펄스가 없으므로 이 타이머를 걸지 않는다.
- 볼륨 배율은 **재생 시점에** 읽는다. `audio.volume` 직접 대입은 iOS가 무시한다 —
  `shared/audio/elementVolume`(GainNode 경유)을 쓴다.
- 진동: armed 24ms · 펄스 10~18ms(80ms 제한) · 던지기 `[20,20,45]` · 내 턴 `[90,60,90]` ·
  오류 `[35,30,35]`. iOS는 `navigator.vibrate`가 없어 조용히 건너뛴다.

### 족보 보이스 (`handVoice`)

`<audio>`가 아니라 **Web Audio**(사전 디코딩된 AudioBuffer)로 재생한다 — iOS `<audio>`는
play()마다 미디어 파이프라인을 다시 세워 실기기에서 콜아웃보다 목소리가 0.6~0.8초 늦었다.
컨텍스트 잠금 해제는 `once` 없이 모든 제스처에서 — iOS는 전화·백그라운드 뒤 다시 재우고,
잠긴 상태를 `suspended`가 아니라 `interrupted`로도 두므로 `running`만 통과시킨다.

### 족보 감지 (`domain/specialHands`)

지금 주사위가 성립시키는 **아직 쓸 수 있는** 가장 높은 족보만 연출한다. 이미 채운 칸은
걸러 다음 순위로 내려간다 — 안 거르면 라지 스트레이트를 채운 뒤 또 라지가 나올 때 스몰이
살아 있는데도 연출이 통째로 사라진다(실측 버그).
