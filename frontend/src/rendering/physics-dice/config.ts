export const PHYSICS_DICE_CONFIG = {
  defaults: {
    diceSize: 0.76,
    mass: 1.15,
    /* 실제 스케일(≈490)에는 한참 못 미치는 슬로모션 영역이지만, 18에서는 주사위가 떠 있는
       시간이 길어 "천천히 떨어진다"는 인상이 남았다(S15P11A406-94). 낙하를 체감할 만큼
       올리고, 대신 아래 spillLiftSpeed를 낮춰 궤적을 뜨는 대신 뻗는 쪽으로 바꾼다. */
    gravity: 30,
    friction: 0.74,
    restitution: 0.34,
    linearDamping: 0.16,
    angularDamping: 0.2,
    /* 쏟는 속도·측면 임펄스·토크에 함께 곱해지는 던지는 힘. 중력과 같이 올려야
       "강하게 던져서 빨리 떨어진다"가 되고, 한쪽만 올리면 굴러가거나 낙하만 빨라진다. */
    throwForce: 4.2,
    simulationHz: 60,
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
      shakeIntervalMs: 105,
      shakeOffsetX: 0.13,
      shakeOffsetZ: 0.11,
      shakeYaw: 0.075,
      shakeFollowStrength: 0.055,
      shakeCenterStrength: 0.025,
      shakeOrbitStrength: 0.075,
      /* 사발 안에서 주사위를 띄우는 힘 — 중력에 비례해 올린다. 중력만 올리면 주사위가
         바닥에 눌려 흔드는 동안 굴러다니지 않는다. */
      shakeLiftImpulse: 0.24,
      shakeRandomImpulse: 0.06,
      followDecayMs: 340,
      followMinIntensity: 0.04,
      followPulseFloor: 0.4,
      followPulseGain: 0.6,
      followPulseImpulse: 0.55,
      followPulseLift: 0.17,
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
      /* throwForce가 곱해지는 값이라 그대로 두면 던지는 힘을 올린 만큼 더 높이 뜬다.
         체공을 늘리지 않으려고 낮춘다 — 수평은 강해지고 궤적은 낮아진다. */
      spillLiftSpeed: 0.4,
      spillFanSpeed: 0.22,
      spillRandomZ: 0.25,
      spillTorque: 0.9,
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
      angularSpeed: 0.18,
      linearSpeed: 0.13,
      minRollDurationMs: 900,
      stableFrames: 14,
    },
    safety: { margin: 0.16, bounce: 0.52 },
  },
} as const

export type PhysicsDiceConfig = typeof PHYSICS_DICE_CONFIG
