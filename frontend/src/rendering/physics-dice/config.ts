/**
 * 이 씬은 주사위 한 변 0.76유닛 = 실물 약 16mm이므로 축척이 실물의 약 47배다. 그래서 실제
 * 중력에 대응하는 값은 9.81 × 47.5 ≈ 466이고, 원래 튜닝(중력 30)은 움직임 자체는 자연스러웠지만
 * 1/15 슬로모션이었다 — 그게 "천천히 떨어진다"의 실체다.
 *
 * ## 낙하(비행)는 물리 닮음으로 빠르게
 *
 * 중력만 올리면 안 된다. 낙하를 빠르게 하는 올바른 방법은 물리 닮음(dynamic similarity)을
 * 지켜 "같은 움직임을 √k배 빠르게 재생"하는 것이다. 중력을 GRAVITY_SCALE배 하면
 * SPEEDUP = √GRAVITY_SCALE 로:
 *
 * - 속도 · 각속도 · 임펄스        → × SPEEDUP
 * - 감쇠 계수(1/초) · 정착 임계 속도 → × SPEEDUP
 * - 시간 간격                    → ÷ SPEEDUP
 * - 거리 · 마찰 · 반발 계수(무차원)  → 그대로
 *
 * 이 관계가 깨지면 궤적의 **모양**이 바뀐다. 중력만 12배 올리고 속도를 1.7배만 올렸을 때
 * 비행 중 회전이 0.71 → 0.35바퀴로 반토막 나 "주사위가 안 구르고 처박힌다"가 됐다.
 *
 * ## 굴림은 3단계 — 뚜껑 덮인 사발 → 뒤집는 순간 던지기 → 자유 비행
 *
 * 1. **흔들기**: 사발 콜라이더 위를 보이지 않는 뚜껑(lid)으로 막는다. 뚜껑이 있으니 흔들림
 *    임펄스를 닮음 기준(×SPEEDUP)의 몇 배로 줘도 주사위가 튀어나오지 않고, 사발 안에서
 *    격렬하게 튄다. 뚜껑 없이는 임펄스를 약하게 줄 수밖에 없어 주사위가 바닥에 붙어 보였다.
 * 2. **뒤집는 순간(releaseTiltProgress)**: 사발 물리 바디를 치운다 — 이후 사발은 순수 비주얼
 *    애니메이션이고 주사위와 물리적으로 상호작용하지 않는다. 동시에 주사위에 측면으로
 *    던지는 속도·토크를 준다(사발을 뚫고 터져 나오는 그림).
 * 3. **비행·착지**: 풀 중력 낙하. 반발 결합을 Max로 두고 restitution을 올려 바닥·서로에게
 *    튕기고, fan·randomZ로 퍼진다.
 */
/* 재생 속도는 √GRAVITY_SCALE 배 — QA에서 12(3.5배)·6(2.4배)은 "배속 같다", 1도 급해 보여
   0.8배(0.8² = 0.64)로 확정. 빨라진 체감은 뚜껑 사발의 격렬한 흔들림·높은 반발 튕김이
   이미 만들어 준다. 느리다/빠르다 조정은 이 숫자 하나만 만진다. 나머지는 전부 유도된다. */
const GRAVITY_SCALE = 0.64
const SPEEDUP = Math.sqrt(GRAVITY_SCALE)

export const PHYSICS_DICE_CONFIG = {
  defaults: {
    diceSize: 0.76,
    /* 질량 — 낙하 속도는 안 바꾸지만(중력 가속은 질량 무관) 고정 크기 토크 임펄스
       (spillTorque·shakeTorque)의 효과가 1/관성으로 줄어 회전이 차분해진다.
       1.15에서는 "너무 튀어다닌다"는 QA — 1.7로 올려 무게감을 준다. 질량을 곱하는
       임펄스(흔들기 킥·측면 던지기)는 자동으로 따라오므로 세기가 유지된다. */
    mass: 1.7,
    gravity: 30 * GRAVITY_SCALE,
    friction: 0.74,
    /* 반발 — 주사위 콜라이더는 결합 규칙이 Max라 이 값이 그대로 트레이 바닥(0.24)과의
       반발이 된다(평균으로 깎이지 않는다). 0.34에서는 착지가 미끄러짐으로만 끝났고
       0.55는 "너무 튀어다닌다" — 0.45로 무게감 있는 튕김을 잡는다. */
    restitution: 0.45,
    /* 감쇠는 "초당" 비율이라 시간이 빨라진 만큼 함께 올려야 같은 거리에서 잦아든다. */
    linearDamping: 0.16 * SPEEDUP,
    angularDamping: 0.2 * SPEEDUP,
    /* 쏟는 속도 · 측면 임펄스에 곱해지는 던지는 힘 — 속도 차원이라 × SPEEDUP. */
    throwForce: 4.2 * SPEEDUP,
    /* 물리 스텝 주기. 한 스텝에 주사위가 자기 몸통의 몇 할을 지나가는지가 관통 깊이를 정한다.
       60Hz · 중력 30에서는 몸통의 53%를 한 스텝에 지나가 주사위끼리 몸통 폭의 57%(0.284)까지
       파고들었다("겹침"). 속도가 SPEEDUP배 빨라졌으므로 주기도 그만큼 이상 올려야 한다 —
       480Hz에서 23% · 0.073으로 줄었다. 60fps 프레임당 8 서브스텝. */
    simulationHz: 480,
    /* Rapier soft CCD — 빠르고 작은 물체의 관통을 예측으로 막는다(문서 권장). 0.15면 포화하고
       그 이상 올려도 관통이 더 줄지 않는다. 스텝만 올려서는 0.136이 하한인데 이걸 켜면 0.073. */
    softCcdPrediction: 0.15,
    /* 사발에 주사위를 넣을 때의 초기 속도·각속도(원래 3 · 2 · 19에 닮음 스케일). */
    spawnLinearSpeed: 3 * SPEEDUP,
    spawnLiftSpeed: 2 * SPEEDUP,
    spawnAngularSpeed: 19 * SPEEDUP,
  },
  quality: {
    eco: { pixelRatio: 1, shadows: false, shadowSize: 0 },
    balanced: { pixelRatio: 1.5, shadows: true, shadowSize: 512 },
    high: { pixelRatio: 2, shadows: true, shadowSize: 1024 },
  },
  scene: {
    baseDiceSize: 0.76,
    colliderHalfRatio: 0.487,
    bowlDiceScale: 0.72,
    resultDiceScale: 1.35,
    resultGap: 0.12,
    selectionBorder: { offsetRatio: 0.045, widthRatio: 0.018, cornerRadiusRatio: 0.151 },
    /* maxHalfHeight·minHalfWidth — 세로로 긴 화면에서 빈 바닥 대신 좌우를 잘라낸다.
       minHalfWidth는 킵 슬롯 5개(±3.14)가 항상 보이는 하한이다. */
    camera: {
      simulationHalfWidth: 4.25,
      resultHalfWidth: 4.25,
      minHalfHeight: 3.35,
      maxHalfHeight: 4.6,
      minHalfWidth: 3.3,
    },
    /* 디자인 Yacht Play 3D — 롤링 존이 위, 킵 레일이 아래(+z, 화면 아래쪽). */
    tray: {
      halfSize: 2.9,
      rollingHalfWidth: 2.5,
      rollingMinZ: -2.5,
      rollingMaxZ: 1.35,
      entryApronMaxX: 5.5,
      resultRowZ: -0.6,
      slotZ: 2.28,
      separatorZ: 1.5,
    },
    keepSlots: {
      /* 킵해도 주사위가 작아지지 않는다 — 결과 줄(resultDiceScale)과 같은 크기로 레일에 앉는다. */
      diceScale: 1.35,
      gapRatio: 0.12,
      borderOffsetRatio: 0.065,
      borderWidthRatio: 0.016,
      /* 슬롯 바 — 카드 프레임 대신 주사위 아래 깔리는 평면 막대(디자인의 rail bar).
         그룹 스케일(diceScale)이 곱해지므로 로컬 값은 그만큼 얇게 잡는다. */
      barDepth: 0.05,
      barGap: 0.09,
      moveDurationMs: 380,
    },
    bowl: {
      autoTiltMs: 2400,
      /* 사발은 롤링 존 가운데(start)에서 흔들리다가, 기울이는 동안 쏟는 위치(pour)까지
         미끄러지며 쏟고 그대로 오른쪽으로 퇴장한다 — 좁은 화면에서도 흔드는 동안은 잘리지 않는다. */
      startX: 0,
      startZ: -0.6,
      pourX: 2.9,
      pourZ: -0.6,
      hoverY: 0.28,
      tiltDurationMs: 520,
      rotationPivotY: 0.72,
      tiltTravelX: 0.48,
      tiltTravelZ: 0,
      tiltLiftY: 0.05,
      spillPushDurationMs: 220,
      spillPushTravelX: 0,
      exitDurationMs: 520,
      exitTravelX: 3.2,
      exitLiftY: 0.62,
      tiltDegrees: 104,
      visualTiltDegrees: 104,
      tiltDirection: 1,
      /* 임펄스 주입 주기 — 물리 타이밍이라 ÷ SPEEDUP (연출 주기가 아니다). */
      shakeIntervalMs: 105 / SPEEDUP,
      /* 진폭·주파수·yaw는 눈에 보이는 사발 연출이라 그대로 둔다. */
      shakeOffsetX: 0.13,
      shakeOffsetZ: 0.11,
      shakeYaw: 0.075,
      /* 무차원 — (사발 속도 − 주사위 속도)에 곱하므로 알아서 커진다. */
      shakeFollowStrength: 0.055,
      shakeCenterStrength: 0.025 * SPEEDUP,
      shakeOrbitStrength: 0.075 * SPEEDUP,
      /* 사발 바닥 근처의 주사위를 위로 튀기는 킥 — 임펄스가 아니라 **목표 높이**로 지정하고
         World가 √(2·g·h)로 역산한다. 임펄스 배수 방식은 중력을 올리면 홉 높이가 1/12로
         죽어서 주사위가 바닥에 붙어 떠는 것처럼 보였다. 뚜껑(colliderLidY 1.82)이 있으니
         세게 튀겨도 사발 밖으로 나가지 않는다. */
      shakeKickHeight: 1.25,
      /* 이 높이(사발 바닥 기준)보다 낮게 있는 주사위만 킥한다 — 공중의 주사위까지 계속
         밀어 올리면 뚜껑에 눌러붙는다. */
      shakeKickAltitude: 0.55,
      shakeRandomImpulse: 0.06 * SPEEDUP,
      /* 흔드는 동안 주사위를 굴리는 토크 임펄스(World.updateBowl이 쓴다). */
      shakeTorqueImpulse: 0.55 * SPEEDUP,
      followDecayMs: 340,
      followMinIntensity: 0.04,
      followPulseFloor: 0.4,
      followPulseGain: 0.6,
      followPulseImpulse: 0.55 * SPEEDUP,
      followStartEnergy: 0.75,
      spawnBaseY: 0.58,
      spawnRangeY: 0.08,
      spawnRadius: 0.68,
      spawnJitter: 0.06,
      colliderBottomHalfHeight: 0.09,
      colliderBottomY: 0.11,
      colliderBottomRadius: 1.5,
      colliderWallHalfWidth: 0.41,
      colliderWallHalfDepth: 0.12,
      colliderWallHalfHeight: 0.9,
      colliderWallY: 1,
      colliderWallRadius: 1.63,
      /* 보이지 않는 뚜껑 — 벽 상단(1.9)과 시각적 rim(1.9) 바로 아래를 막는다. 이 덕분에
         흔들림 임펄스를 rattle 배수로 키워도 주사위가 사발 위로 튀어나오지 않는다. */
      colliderLidY: 1.82,
      colliderLidHalfHeight: 0.08,
      colliderLidRadius: 1.7,
      /* 사발이 이 비율만큼 기울었을 때 주사위를 던진다(뒤집어지는 순간). 이 시점에 사발
         물리 바디를 치우므로 이후 사발은 순수 비주얼이고 주사위와 상호작용하지 않는다. */
      releaseTiltProgress: 0.55,
      containmentRadius: 1.5,
      spillDirectionX: -1,
      spillForceMultiplier: 1,
      spillMinimumSpeed: 2,
      spillRandomSpeed: 0.8,
      /* 아래 spill 값들은 throwForce(= 4.2 × SPEEDUP)가 곱해지므로 이미 속도 차원이 맞다.
         lift 0.4는 궤적이 낮아 던져진 뒤 미끄러지기만 했다 — 0.9로 올려 포물선을 그리고,
         fan·randomZ를 키워 다섯 개가 뭉치지 않고 퍼지게 한다(24시드: 퍼짐 1.38 → 1.60). */
      spillLiftSpeed: 0.9,
      spillFanSpeed: 0.3,
      spillRandomZ: 0.6,
      /* throwForce가 곱해지지 않는 토크라 여기서 직접 × SPEEDUP 해야 한다.
         이걸 빼먹으면 주사위가 비행 중 덜 회전해 미끄러지듯 처박힌다. */
      spillTorque: 0.9 * SPEEDUP,
      spillSideImpulse: 1.15,
      spillSideImpulseVariance: 0.12,
      visual: {
        outerBottomY: 0.03,
        outerBottomRadius: 1.56,
        innerBottomY: 0.2,
        innerBottomRadius: 1.44,
        innerRimRadius: 1.63,
        outerRimRadius: 1.87,
        rimRadius: 1.75,
        rimTube: 0.12,
        rimY: 1.9,
        segments: 48,
      },
    },
    alignment: {
      durationMs: 900,
      lineUpEnd: 0.68,
      lift: 0.52,
    },
    settlement: {
      /* 정착 판정 임계 **속도**라 × SPEEDUP. 안 올리면 세상이 빨라진 만큼 기준만 엄격해져서
         주사위가 멈춘 뒤에도 한참 정착으로 안 넘어간다. */
      angularSpeed: 0.18 * SPEEDUP,
      linearSpeed: 0.13 * SPEEDUP,
      /* 시간이라 ÷ SPEEDUP. */
      minRollDurationMs: 900 / SPEEDUP,
      /* 렌더 프레임 수(≈60fps)로 세므로 시간 축척을 따라 줄인다 — 14프레임(233ms)을 그대로 두면
         이미 멈춘 주사위를 233ms 더 쳐다보는 지연이 붙는다. */
      stableFrames: 5,
      /* 정착을 못 해도 굴림을 끝내는 상한(쏟기 시작 기준). 이게 없으면 주사위가 계속 튀는
         동안 checkSettled가 영원히 정렬로 넘어가지 못해 게임이 굴림 중에 멈춘다 —
         닮음을 깨고 gravity만 올린 조합에서 실제로 12.6초까지 나왔다.
         고정분 900ms(기울이기 520 + 밀기 220 + 여유)에 비행 여유 2900ms을 재생 속도로 나눠
         더한다 — 느리게 재생할수록 정상 굴림도 오래 걸리므로 상한도 함께 늘어야 정상 굴림을
         자르지 않는다(0.8배 실측 최악 3407ms < 4525ms). 결과값은 targetDice로 확정되어
         있어 조기 마감이 점수를 바꾸지 않는다. */
      maxRollDurationMs: 900 + 2900 / SPEEDUP,
    },
    safety: { margin: 0.16, bounce: 0.52 },
  },
} as const

export type PhysicsDiceConfig = typeof PHYSICS_DICE_CONFIG
