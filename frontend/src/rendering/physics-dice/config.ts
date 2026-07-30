/**
 * 이 씬은 주사위 한 변 0.76유닛 = 실물 약 16mm이므로 축척이 실물의 약 47배다. 그래서 실제
 * 중력에 대응하는 값은 9.81 × 47.5 ≈ 466이고, 원래 튜닝(중력 30)은 움직임 자체는 자연스러웠지만
 * 1/15 슬로모션이었다 — 그게 "천천히 떨어진다"의 실체다.
 *
 * 여기서 중요한 건 **중력만 올리면 안 된다**는 점이다. 낙하를 빠르게 하는 올바른 방법은
 * 물리 닮음(dynamic similarity)을 지켜 "같은 움직임을 빠르게 재생"하는 것이다.
 * 중력을 GRAVITY_SCALE배 하면 SPEEDUP = √GRAVITY_SCALE 로:
 *
 * - 속도 · 각속도 · 임펄스        → × SPEEDUP
 * - 감쇠 계수(1/초) · 정착 임계 속도 → × SPEEDUP
 * - 시간 간격(임펄스 주입 주기 등)   → ÷ SPEEDUP
 * - 거리 · 마찰 · 반발 계수(무차원)  → 그대로
 *
 * 이 관계가 깨지면 궤적의 **모양**이 바뀐다. S15P11A406-129에서 중력만 12배 올리고 속도를
 * 1.7배만 올렸을 때, 비행 중 회전이 0.71 → 0.35바퀴로 반토막 나고 사발 안 회전 속도가
 * 3.5 → 0.5로 떨어져 "주사위가 안 구르고 그냥 처박힌다"가 됐다. 그래서 값을 하나씩 적지 않고
 * 아래처럼 **원래의 자연스러운 튜닝 × SPEEDUP** 으로 유도한다 — 반쪽만 바꾸는 실수를 막는다.
 */
const GRAVITY_SCALE = 12
const SPEEDUP = Math.sqrt(GRAVITY_SCALE)

export const PHYSICS_DICE_CONFIG = {
  defaults: {
    diceSize: 0.76,
    mass: 1.15,
    gravity: 30 * GRAVITY_SCALE,
    friction: 0.74,
    restitution: 0.34,
    /* 감쇠는 "초당" 비율이라 시간이 빨라진 만큼 함께 올려야 같은 거리에서 같이 잦아든다. */
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
    /* 사발에서 주사위를 꺼낼 때의 초기 속도·각속도(원래 3 · 2 · 19). World.startRoll이 쓴다 —
       하드코딩해 두면 SPEEDUP을 바꿀 때 같이 안 올라가서 회전이 모자라진다. */
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
      /* 임펄스를 주입하는 주기 — 눈에 보이는 연출이 아니라 물리 타이밍이라 ÷ SPEEDUP.
         사발 안 회전 속도를 좌우하는 건 임펄스의 크기보다 이 **주입 빈도**였다:
         105ms 그대로 두면 3.5 → 1.8로 죽고, ÷SPEEDUP(≈30ms)로 줄이면 3.0으로 돌아온다.
         반면 진폭·주파수를 2~3배 키워도 1.8 → 1.9밖에 안 올라간다. */
      shakeIntervalMs: 105 / SPEEDUP,
      /* 아래 진폭·주파수·yaw는 눈에 보이는 사발 연출이라 그대로 둔다 — 시간 축척을 여기까지
         적용하면 사발이 8Hz로 떨려 정신없어진다. */
      shakeOffsetX: 0.13,
      shakeOffsetZ: 0.11,
      shakeYaw: 0.075,
      /* 무차원 — (사발 속도 − 주사위 속도)에 곱하므로 속도가 커지면 임펄스도 자동으로 커진다. */
      shakeFollowStrength: 0.055,
      /* 거리에 곱해 임펄스를 만드는 계수라 × SPEEDUP. */
      shakeCenterStrength: 0.025 * SPEEDUP,
      shakeOrbitStrength: 0.075 * SPEEDUP,
      shakeLiftImpulse: 0.24 * SPEEDUP,
      shakeRandomImpulse: 0.06 * SPEEDUP,
      /* 흔드는 동안 주사위를 굴리는 토크 임펄스(원래 0.55, World.updateBowl이 쓴다). */
      shakeTorqueImpulse: 0.55 * SPEEDUP,
      followDecayMs: 340,
      followMinIntensity: 0.04,
      followPulseFloor: 0.4,
      followPulseGain: 0.6,
      followPulseImpulse: 0.55 * SPEEDUP,
      followPulseLift: 0.17 * SPEEDUP,
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
      containmentRadius: 1.5,
      spillDirectionX: -1,
      spillForceMultiplier: 1,
      spillMinimumSpeed: 2,
      spillRandomSpeed: 0.8,
      /* 아래 spill 값들은 throwForce(= 4.2 × SPEEDUP)가 곱해지므로 이미 속도 차원이 맞다.
         따로 만지면 궤적 모양이 어긋난다 — 원래 튜닝 값을 그대로 둔다. */
      spillLiftSpeed: 0.4,
      spillFanSpeed: 0.22,
      spillRandomZ: 0.25,
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
         실측 최악값은 쏟기 시작 후 약 1.15초(체공 740ms + 정착 400ms)라 여유를 크게 둔다.
         결과값은 targetDice로 이미 확정되어 있으므로 조기 마감이 점수를 바꾸지 않는다. */
      maxRollDurationMs: 2600,
    },
    safety: { margin: 0.16, bounce: 0.52 },
  },
} as const

export type PhysicsDiceConfig = typeof PHYSICS_DICE_CONFIG
