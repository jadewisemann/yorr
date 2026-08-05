import * as THREE from 'three'
import {
  BALL_R,
  ballY,
  FAR_Z,
  type Fault,
  flightProgress,
  IDEAL1,
  IDEAL2,
  NEAR_Z,
  NET_H,
  NET_OVERHANG,
  PERFECT_D,
  posToZ,
  TABLE_H,
  TABLE_LEN,
  TABLE_THICK,
  TABLE_W,
  viewerDepth,
  W1_HI,
  W1_LO,
  xToWorld,
} from './court'

/**
 * scene3d.ts — 탁구 3D 무대 (Three.js)
 * -------------------------------------------------------------
 * 게임 규칙은 하나도 모른다. 매 프레임 "지금 공/라켓이 어디 있나"만 받아
 * 3D 로 그린다. 덕분에 기존 게임 로직·온라인 프로토콜을 건드리지 않는다.
 *
 * 설계 메모
 *  - 외부 에셋 0: 테이블 라인·네트 그물·그림자는 전부 캔버스로 그려 텍스처로 쓴다.
 *  - 그림자는 셰도우맵 대신 "가짜 그림자"(그라디언트 판)를 쓴다.
 *    공 그림자는 3D 탁구에서 깊이를 읽는 유일한 단서라, 물리적 정확함보다
 *    항상 또렷하게 보이는 게 중요하다. 셰도우맵의 얼룩·바이어스 문제도 없다.
 *  - 2인 대결은 "월드를 뒤집는" 게 아니라 반대편에 카메라를 하나 더 둔다.
 *    테이블이 대칭이라 카메라만 바꾸면 각자의 1인칭이 된다.
 *  - 선수는 양쪽 다 서비스 마스코트(makeMascot). 자기 몸은 자기 시점에서 숨기므로
 *    화면에는 늘 "상대 마스코트"만 보인다. 애니메이션은 전부 프로시저럴이다.
 */

/* ── 연출 튜닝 값 (여기만 만지면 됨) ──
   카메라가 낮으면 라켓이 "테이블에 누운 것"처럼 보이고 먼 코트가 안 보인다.
   중계 카메라처럼 살짝 높이 올려 내려다보는 각(약 17°)이 가장 잘 읽힌다. */
const FOV = 46
const CAM_HEIGHT = TABLE_H + 1.04 // 눈높이
const CAM_BACK = 1.72 // 자기 코트 끝에서 뒤로 물러난 거리
const LOOK_HEIGHT = TABLE_H - 0.02
const LOOK_AHEAD = -0.3 // 시선이 향하는 z (자기 코트 기준 네트 너머)
const PADDLE_Y = TABLE_H + 0.15 // 라켓을 쥔 높이
const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)
const TRAIL = 5 // 스매시 잔상 개수

type Viewer = 1 | 2

/** 프레임마다 렌더러에 넘기는 게임 상태 (렌더러는 이것만 안다) */
export interface FrameState {
  /** 좌우 분할로 두 시점을 함께 그릴지 */
  split: boolean
  /** 단일 화면일 때 누구 시점인지 */
  viewer: Viewer
  playing: boolean
  ballPos: number
  ballDir: 1 | -1
  ballX: number
  ballSmash: boolean
  ballHit: boolean
  /** 아웃·네트로 죽은 공 (아무도 못 침) */
  ballFault: Fault
  /** 실패 궤적의 시작 prog */
  ballFaultFrom: number
  /** 실점 확정 후 떨어진 시간(초). 죽은 공을 바닥으로 내려앉힌다. */
  ballFall: number
  p1X: number
  p2X: number
  /** 0=평소, 1=방금 휘둘렀음 */
  p1Swing: number
  p2Swing: number
  /** 0=평온, 1=최대 흔들림 */
  shake: number
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 빠르게 시작해 부드럽게 멈추는 감쇠 */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/* ============================================================
   절차적 텍스처 — 외부 이미지 없이 캔버스로 직접 그린다
   ============================================================ */

function canvasTex(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')
  if (!c) throw new Error('Canvas 2D context is unavailable')
  draw(c)
  const t = new THREE.CanvasTexture(cv)
  t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 테이블 상판: 청색 + 흰 테두리 + 센터라인 (세로가 테이블 길이) */
function tableTopTexture() {
  const W = 560
  const H = Math.round(W * (TABLE_LEN / TABLE_W))
  return canvasTex(W, H, (c) => {
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#1262a0')
    g.addColorStop(0.5, '#1a7cc4')
    g.addColorStop(1, '#1262a0')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
    // 결(브러시) 느낌의 아주 미세한 세로 줄
    c.globalAlpha = 0.05
    c.fillStyle = '#ffffff'
    for (let x = 0; x < W; x += 7) c.fillRect(x, 0, 1, H)
    c.globalAlpha = 1
    // 흰 테두리
    const line = Math.max(3, Math.round(W * 0.016))
    c.strokeStyle = '#f4f8fb'
    c.lineWidth = line
    c.strokeRect(line / 2, line / 2, W - line, H - line)
    // 센터라인 (복식용) — 얇게
    c.fillStyle = 'rgba(244,248,251,0.9)'
    c.fillRect(W / 2 - line * 0.22, 0, line * 0.44, H)
    // 네트 자리 그림자 살짝
    c.fillStyle = 'rgba(0,0,0,0.16)'
    c.fillRect(0, H / 2 - 3, W, 6)
  })
}

/** 네트 그물: 투명 배경 + 흰 격자 + 위쪽 흰 테이프 */
function netTexture() {
  return canvasTex(512, 96, (c) => {
    c.clearRect(0, 0, 512, 96)
    c.strokeStyle = 'rgba(240,246,255,0.62)'
    c.lineWidth = 1.4
    for (let x = 0; x <= 512; x += 9) {
      c.beginPath()
      c.moveTo(x, 14)
      c.lineTo(x, 96)
      c.stroke()
    }
    for (let y = 14; y <= 96; y += 9) {
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(512, y)
      c.stroke()
    }
    // 상단 테이프 (불투명 흰 띠)
    c.fillStyle = '#f2f6fb'
    c.fillRect(0, 0, 512, 13)
  })
}

/** 가짜 그림자용 방사형 그라디언트 */
function blobTexture() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
  })
}

/** 뒷벽: 위로 갈수록 어두워지는 체육관 벽 (허공처럼 비어 보이지 않게) */
function wallTexture() {
  return canvasTex(64, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#05080e')
    g.addColorStop(0.55, '#0b131f')
    g.addColorStop(0.86, '#16243a')
    g.addColorStop(1, '#1d2f49')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 256)
    // 바닥과 벽이 만나는 선 (걸레받이)
    c.fillStyle = 'rgba(120,160,210,0.16)'
    c.fillRect(0, 248, 64, 3)
  })
}

/** 바닥: 어두운 체육관 + 중앙 스포트라이트 */
function floorTexture() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#0a0f18'
    c.fillRect(0, 0, 512, 512)
    const g = c.createRadialGradient(256, 256, 20, 256, 256, 250)
    g.addColorStop(0, 'rgba(90,130,180,0.30)')
    g.addColorStop(0.55, 'rgba(50,80,120,0.12)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 512)
    // 바닥 널 (은은한 격자)
    c.strokeStyle = 'rgba(255,255,255,0.035)'
    c.lineWidth = 1
    for (let i = 0; i <= 512; i += 32) {
      c.beginPath()
      c.moveTo(i, 0)
      c.lineTo(i, 512)
      c.stroke()
      c.beginPath()
      c.moveTo(0, i)
      c.lineTo(512, i)
      c.stroke()
    }
  })
}

/* ============================================================
   라켓 (블레이드 + 손잡이) · 마스코트 피겨
   ============================================================ */

interface Paddle {
  group: THREE.Group
  /** 네트를 향하는 방향: P1 = -1(-z 로 친다) · P2 = +1 */
  facing: -1 | 1
  baseZ: number
}

/**
 * 1인칭으로 보이는 "내 라켓". 상대 라켓은 마스코트가 손에 들고 있으므로
 * prepare() 가 자기 시점에서만 켠다 (안 그러면 상대편에 라켓이 두 개 보인다).
 */
function makePaddle(color: number, facing: -1 | 1, baseZ: number, mats: MatBag): Paddle {
  const group = new THREE.Group()

  // 블레이드 — 얇은 원판. 기본 원기둥은 y축이라 X로 90° 눕혀 네트를 마주보게.
  const blade = new THREE.Mesh(
    mats.geo(new THREE.CylinderGeometry(0.077, 0.077, 0.009, 28)),
    mats.rubber(color),
  )
  blade.rotation.x = Math.PI / 2
  group.add(blade)

  // 테두리(스펀지 옆면)
  const rim = new THREE.Mesh(mats.geo(new THREE.TorusGeometry(0.077, 0.006, 8, 28)), mats.wood)
  group.add(rim)

  // 손잡이 — 블레이드 아래로
  const handle = new THREE.Mesh(mats.geo(new THREE.BoxGeometry(0.028, 0.1, 0.019)), mats.wood)
  handle.position.set(0, -0.12, 0)
  group.add(handle)

  group.position.set(0, PADDLE_Y, baseZ)
  return { group, facing, baseZ }
}

/** 라켓 자세: 좌우 추적 + 스윙(휘두른 뒤 따라나가며 준비자세로 복귀) */
function poseP(p: Paddle, xNorm: number, swing: number) {
  const g = p.group
  const f = p.facing
  // swing: 1=방금 침 → 0=평소.  t: 0=타구 순간 → 1=follow-through 끝
  const t = easeOut(1 - clamp(swing, 0, 1))
  const READY = 0.38 // 준비자세 (몸쪽으로 살짝 열어둠)
  const THRU = -0.55 // 휘둘러 지나간 각
  g.position.x = xToWorld(xNorm)
  // 스윙 중엔 네트 쪽으로 살짝 밀고 나간다 (0 → 최대 → 0)
  g.position.z = p.baseZ + f * -0.13 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.position.y = PADDLE_Y + 0.03 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.rotation.y = f * lerp(THRU, READY, t)
  g.rotation.z = f * lerp(-0.5, -0.15, t)
}

/* ── 마스코트 몸 색 (브랜드 고정 — 진영과 무관) ──
   두 선수 다 같은 마스코트라 P1/P2 구분은 accent(머리띠·손목밴드·라켓 고무)로만 한다. */
const FUR = 0xf4ce5e // 버터
const BELLY = 0xfbe7a8
const NOSE = 0x6b4a2b
const CHEEK = 0xf0a98c
const EYE = 0x241c14

/* ── 덩치 ──
   makeMascot 안의 치수는 "키 1.6m" 기준으로 짜여 있고, 여기서 한 번에 줄인다.
   머리가 커서 사람 선수와 키가 같아도 화면에선 훨씬 크게 읽히기 때문.
   0.80 = 키 1.28m, 화면 세로 31.5% · 가로 34.1% (1.0 일 때 39.9% · 49.4%).
   ★ 더 줄이려면 0.75 까지가 한계다. 그 아래로는 어깨가 상판(0.76m)까지 내려와
     라켓이 테이블 뒤로 잠긴다. 바꾸면 MASCOT_BACK 과 팔 각도도 같이 봐야 한다. */
const MASCOT_SCALE = 0.8
/** 코트 끝에서 얼마나 물러나 서는가 (작아진 만큼 살짝 뒤로 → 시선각이 낮아져 덜 가림) */
const MASCOT_BACK = 0.66

/* ── 오른팔 자세 (라디안) ──
   팔이 짧고 머리가 커서 각도를 아무렇게나 잡으면 라켓이 머리·몸통을 뚫거나
   상판에 가려 안 보인다. 아래 값은 "타구면이 네트를 보고, 스윙 내내 몸에서
   최소 0.2m 떨어져 있고, 카메라에서 상판 위로 보이는" 범위에서 고른 것이다.
     대기  → 라켓을 가슴 앞으로 (타구면 0° = 네트 정면)
     팔로스루 → 어깨 높이까지 쓸어올리며 면이 감김 (76°, 이동 0.27m) */
const WRIST_X = 1.0 // 손목 — 팔보다 라켓을 세워 쥔다
const ARM_REST_X = -1.0
const ARM_REST_Z = 0
const ARM_HIT_X = -2.1
const ARM_HIT_Y = 0.1
const ARM_HIT_Z = 0.85

interface Mascot {
  /** 씬에 붙는 루트 — 좌우 이동 + 어느 쪽을 보는지 */
  root: THREE.Group
  /** 보빙·젖힘이 걸리는 안쪽 그룹. 마스코트 로컬 프레임이라 facing 부호를 안 따져도 된다. */
  body: THREE.Group
  /** 라켓 든 오른팔 — 어깨가 피벗 */
  arm: THREE.Group
  /** 귀 피벗 ×2 (구를 제자리에서 돌리면 안 보이므로 머리 옆에 피벗을 따로 둔다) */
  ears: THREE.Group[]
  facing: -1 | 1
}

/**
 * 서비스 마스코트 — 라이언풍(갈기 없는 순한 사자), 버터색.
 * -------------------------------------------------------------
 * 외부 모델·이미지 없이 구·캡슐·토러스만으로 조립한다(CLAUDE.md 에셋 규칙).
 * 파츠: 큰 머리 · 동그란 귀 · 점 눈 · 갈색 코 · 발그레한 볼 · 짧고 뭉툭한 팔다리.
 *
 * 치수 메모: 아래 좌표는 전부 "키 1.6m" 기준이고, 최종 크기는 MASCOT_SCALE 로
 * 한 번에 줄인다. 시안(mascot-preview.jsx)은 자유롭게 선 포즈라 어깨가 키의
 * 0.41 배까지 내려와 있는데, 그대로 두면 어깨·손이 상판(y=0.76) 아래로 잠겨
 * 라켓이 테이블에 가려진다. 그래서 어깨만 몸통 위쪽(y=1.0)으로 올리고
 * 나머지 비율·색은 시안을 따랐다. 카메라에서 마스코트가 선 z 지점은 y≈0.6 아래가
 * 상판에 가리므로, 머리·상체·라켓이 모두 그 위에 오게 잡았다.
 */
function makeMascot(accentColor: number, z: number, facing: -1 | 1, mats: MatBag): Mascot {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const g = mats.geo
  const accent = mats.accent(accentColor)

  /* ── 몸통 · 배 ── */
  const torso = new THREE.Mesh(g(new THREE.SphereGeometry(0.35, 20, 14)), mats.fur)
  torso.scale.set(1.06, 0.96, 0.98)
  torso.position.y = 0.7
  body.add(torso)

  const belly = new THREE.Mesh(g(new THREE.SphereGeometry(0.225, 16, 10)), mats.belly)
  belly.scale.set(0.94, 1, 0.48)
  belly.position.set(0, 0.66, 0.235)
  body.add(belly)

  /* ── 다리 · 발 (짧고 뭉툭. 대부분 테이블에 가리지만 실루엣용으로 둔다) ── */
  const legGeo = g(new THREE.CapsuleGeometry(0.08, 0.16, 3, 8))
  const footGeo = g(new THREE.SphereGeometry(0.105, 10, 8))
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mats.fur)
    leg.position.set(s * 0.145, 0.22, 0)
    body.add(leg)
    const foot = new THREE.Mesh(footGeo, mats.fur)
    foot.scale.set(1.1, 0.62, 1.45)
    foot.position.set(s * 0.145, 0.065, 0.05)
    body.add(foot)
  }

  /* ── 머리 (귀여움의 핵심 — 크게) ── */
  const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.36, 24, 16)), mats.fur)
  head.scale.set(1.02, 0.97, 0.99)
  head.position.y = 1.25
  body.add(head)

  const muzzle = new THREE.Mesh(g(new THREE.SphereGeometry(0.17, 16, 10)), mats.belly)
  muzzle.scale.set(1.15, 0.82, 0.7)
  muzzle.position.set(0, 1.15, 0.25)
  body.add(muzzle)

  const nose = new THREE.Mesh(g(new THREE.SphereGeometry(0.05, 10, 8)), mats.nose)
  nose.scale.set(1.25, 0.85, 0.85)
  nose.position.set(0, 1.17, 0.385)
  body.add(nose)

  /* 점 눈 + 하이라이트 · 발그레한 볼 (좌우 같은 지오메트리 재사용) */
  const eyeGeo = g(new THREE.SphereGeometry(0.041, 10, 8))
  const glintGeo = g(new THREE.SphereGeometry(0.013, 6, 5))
  const cheekGeo = g(new THREE.SphereGeometry(0.085, 10, 8))
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, mats.eye)
    eye.position.set(s * 0.13, 1.27, 0.315)
    body.add(eye)
    const glint = new THREE.Mesh(glintGeo, mats.glint)
    glint.position.set(s * 0.12, 1.29, 0.35)
    body.add(glint)
    const cheek = new THREE.Mesh(cheekGeo, mats.cheek)
    cheek.scale.set(1, 0.85, 0.7)
    cheek.position.set(s * 0.22, 1.12, 0.255)
    body.add(cheek)
  }

  /* ── 귀 (동그랗고 작게, 갈기 없음) ── */
  const earGeo = g(new THREE.SphereGeometry(0.105, 12, 8))
  const earInGeo = g(new THREE.SphereGeometry(0.057, 8, 6))
  const ears: THREE.Group[] = []
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(s * 0.2, 1.36, -0.01)
    body.add(pivot)
    const ear = new THREE.Mesh(earGeo, mats.fur)
    ear.scale.set(1, 1, 0.6)
    ear.position.set(s * 0.045, 0.13, 0)
    pivot.add(ear)
    const inner = new THREE.Mesh(earInGeo, mats.cheek)
    inner.scale.set(1, 1, 0.5)
    inner.position.set(s * 0.045, 0.125, 0.048)
    pivot.add(inner)
    ears.push(pivot)
  }

  /* ── 머리띠 (진영색) — 토러스는 xy 평면이라 X로 눕혀 머리를 두른다 ── */
  const band = new THREE.Mesh(g(new THREE.TorusGeometry(0.325, 0.03, 6, 20)), accent)
  band.rotation.x = Math.PI / 2
  band.scale.set(1.02, 0.99, 1) // 회전 전 기준: y 가 앞뒤(깊이)
  band.position.y = 1.4
  body.add(band)

  /* ── 팔 (짧고 뭉툭) + 손목밴드(진영색). 좌우가 같은 부품이라 지오메트리 공유 ── */
  const upperGeo = g(new THREE.CapsuleGeometry(0.075, 0.22, 3, 8))
  const pawGeo = g(new THREE.SphereGeometry(0.085, 10, 8))
  const cuffGeo = g(new THREE.TorusGeometry(0.075, 0.022, 5, 12))
  /** 어깨에 매달린 팔 한 짝 (윗팔 + 손 + 손목밴드) */
  const mkArm = (side: -1 | 1) => {
    const a = new THREE.Group()
    a.position.set(side * 0.34, 1.0, 0.02)
    body.add(a)
    const upper = new THREE.Mesh(upperGeo, mats.fur)
    upper.position.y = -0.16
    a.add(upper)
    const paw = new THREE.Mesh(pawGeo, mats.fur)
    paw.position.y = -0.31
    a.add(paw)
    const cuff = new THREE.Mesh(cuffGeo, accent)
    cuff.rotation.x = Math.PI / 2
    cuff.position.y = -0.255
    a.add(cuff)
    return a
  }

  // 왼팔 — 고정(균형용), 바깥으로 살짝 벌림
  const leftArm = mkArm(-1)
  leftArm.rotation.set(-0.3, 0, -0.26)

  // 오른팔 — 스윙용. 라켓을 쥔다.
  const arm = mkArm(1)
  arm.rotation.set(ARM_REST_X, 0, ARM_REST_Z)

  /* 라켓 — 치수·재질을 makePaddle 과 맞춰 "같은 라켓"으로 보이게 한다.
     grip 원점 = 손. 라켓은 팔을 이어받아 -y(팔이 뻗은 쪽)로 더 나간다.
     grip.rotation 은 손목 각도라, 팔이 휘두르면 라켓이 통째로 따라 돈다. */
  const grip = new THREE.Group()
  grip.position.set(0, -0.31, 0.02)
  grip.rotation.set(WRIST_X, 0, 0)
  arm.add(grip)
  const handle = new THREE.Mesh(g(new THREE.BoxGeometry(0.026, 0.095, 0.018)), mats.wood)
  handle.position.y = 0.045 // 주먹 안
  grip.add(handle)
  // 블레이드 — makePaddle 과 같은 얇은 원판. X로 90° 눕혀 타구면이 네트를 보게.
  const blade = new THREE.Mesh(
    g(new THREE.CylinderGeometry(0.077, 0.077, 0.009, 20)),
    mats.rubber(accentColor),
  )
  blade.rotation.x = Math.PI / 2
  blade.position.y = 0.16
  grip.add(blade)
  const rim = new THREE.Mesh(g(new THREE.TorusGeometry(0.077, 0.0055, 5, 20)), mats.wood)
  rim.position.y = 0.16
  grip.add(rim)

  root.position.set(0, 0, z)
  root.rotation.y = facing < 0 ? Math.PI : 0 // 상대를 바라보게
  root.scale.setScalar(MASCOT_SCALE) // 덩치는 여기서 한 번에 (poseMascot 의 body.scale 과 안 겹친다)
  return { root, body, arm, ears, facing }
}

/**
 * 마스코트 자세 — 전부 프로시저럴(position/rotation 직접 보간).
 * AnimationMixer·스켈레탈 없음. FrameState 신호만 쓴다.
 *   xNorm 공의 좌우(0~1) · swing 1=방금 휘두름→0 · react 강타 반응 0~1 · t 초 시계
 */
function poseMascot(m: Mascot, xNorm: number, swing: number, react: number, t: number) {
  // 좌우 추적 — 공을 살짝만 따라간다 (기존 선수 피겨와 같은 감쇠 0.55)
  const x = xToWorld(lerp(0.5, xNorm, 0.55))
  m.root.position.x = x
  // 남은 거리만큼 몸을 튼다. body 는 로컬 프레임이라 facing 을 곱해 좌우를 맞춘다.
  m.body.rotation.y = clamp(m.facing * (xToWorld(xNorm) - x) * 0.5, -0.3, 0.3)

  // idle 보빙 + 강타 움찔 (뒤로 젖히며 살짝 움츠림)
  m.body.position.y = Math.sin(t * 2.1) * 0.018
  m.body.rotation.x = -0.16 * react
  m.body.scale.set(1 + 0.03 * react, 1 - 0.05 * react, 1 + 0.03 * react)

  // 귀 까딱 — 강타 땐 쫑긋
  const flick = Math.sin(t * 2.1 + 0.6) * 0.09 + react * 0.25
  const [leftEar, rightEar] = m.ears
  if (leftEar) leftEar.rotation.z = flick
  if (rightEar) rightEar.rotation.z = -flick

  // 스윙 — poseP 와 같은 곡선. st: 0=타격 순간 → 1=대기 복귀
  const st = easeOut(1 - clamp(swing, 0, 1))
  m.arm.rotation.x = lerp(ARM_HIT_X, ARM_REST_X, st)
  m.arm.rotation.y = lerp(ARM_HIT_Y, 0, st)
  m.arm.rotation.z = lerp(ARM_HIT_Z, ARM_REST_Z, st)

  // TODO(득점 세리머니): FrameState 에 득점 신호가 없어 이번 범위 밖.
  //   PingPong.tsx 가 celebrate(0→1) 같은 신호를 넘겨주면 여기서 점프·만세를
  //   같은 방식(프로시저럴)으로 붙인다.
}

/* ============================================================
   재질 묶음 — dispose 를 위해 만든 것을 모두 기억해 둔다
   ============================================================ */
interface MatBag {
  /** 색마다 새로 만든다 (라켓 고무 = 진영색) */
  rubber(color: number): THREE.Material
  /** 진영색 — 머리띠·손목밴드 */
  accent(color: number): THREE.Material
  wood: THREE.Material
  /* 마스코트 몸 색 (양쪽 공용) */
  fur: THREE.Material
  belly: THREE.Material
  nose: THREE.Material
  cheek: THREE.Material
  eye: THREE.Material
  glint: THREE.Material
  /** 지오메트리를 dispose 목록에 등록한다 (createScene 의 keepG) */
  geo<T extends THREE.BufferGeometry>(g: T): T
}

export interface PingPongScene {
  update(s: FrameState): void
  render(s: FrameState): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

/**
 * 캔버스 배경색. `styles/tokens.css`의 `--ds-pingpong-canvas`와 **같은 값을 양쪽에 적어둔
 * 것**이다(WebGL은 CSS 변수를 읽지 못한다). 한쪽만 고치면 캔버스 경계에 이음선이 보인다.
 */
const CANVAS_COLOR = 0x070b12

export function createScene(canvas: HTMLCanvasElement): PingPongScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(CANVAS_COLOR, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(CANVAS_COLOR, 0.085)

  /* 정리 대상 추적 */
  const geos: THREE.BufferGeometry[] = []
  const matsList: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  const keepG = <T extends THREE.BufferGeometry>(g: T) => {
    geos.push(g)
    return g
  }
  const keepM = <T extends THREE.Material>(m: T) => {
    matsList.push(m)
    return m
  }
  const keepT = <T extends THREE.Texture>(t: T) => {
    texs.push(t)
    return t
  }

  const texTable = keepT(tableTopTexture())
  const texNet = keepT(netTexture())
  const texBlob = keepT(blobTexture())
  const texFloor = keepT(floorTexture())
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping
  texFloor.repeat.set(3, 3)

  // 전부 MeshStandardMaterial — 기존 조명(Hemisphere + key + rim)에 그대로 물린다
  const mats: MatBag = {
    rubber: (color) =>
      keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })),
    accent: (color) => keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.6 })),
    wood: keepM(new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.68 })),
    fur: keepM(new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.78 })),
    belly: keepM(new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.82 })),
    nose: keepM(new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.5 })),
    cheek: keepM(new THREE.MeshStandardMaterial({ color: CHEEK, roughness: 0.85 })),
    eye: keepM(new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35 })),
    glint: keepM(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.4 })),
    geo: keepG,
  }

  /* ── 조명 ── */
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0d141f, 0.62))
  const key = new THREE.DirectionalLight(0xffffff, 1.85)
  key.position.set(1.1, 3.4, 1.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.42)
  rim.position.set(-1.6, 1.4, -2.4)
  scene.add(rim)

  /* ── 바닥 ── */
  const floor = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(26, 26)),
    keepM(new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94 })),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  /* ── 뒷벽 (양 끝) — 두 카메라가 서로 반대를 보므로 양쪽에 하나씩 ── */
  const texWall = keepT(wallTexture())
  const wallGeo = keepG(new THREE.PlaneGeometry(18, 7))
  const wallMat = keepM(new THREE.MeshBasicMaterial({ map: texWall, fog: true }))
  for (const sz of [-1, 1] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(0, 3.5, sz * 7)
    if (sz > 0) wall.rotation.y = Math.PI // 안쪽을 보게
    scene.add(wall)
  }

  /* ── 테이블 ── */
  const topSide = keepM(new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.6 }))
  const topFace = keepM(
    new THREE.MeshStandardMaterial({ map: texTable, roughness: 0.34, metalness: 0.04 }),
  )
  // BoxGeometry 재질 순서: +x, -x, +y, -y, +z, -z → 위(+y)만 라인 텍스처
  const tableTop = new THREE.Mesh(keepG(new THREE.BoxGeometry(TABLE_W, TABLE_THICK, TABLE_LEN)), [
    topSide,
    topSide,
    topFace,
    topSide,
    topSide,
    topSide,
  ])
  tableTop.position.y = TABLE_H - TABLE_THICK / 2
  scene.add(tableTop)

  // 다리 + 가로대
  const legMat = keepM(
    new THREE.MeshStandardMaterial({ color: 0x161c27, roughness: 0.7, metalness: 0.25 }),
  )
  const legGeo = keepG(new THREE.BoxGeometry(0.06, TABLE_H - TABLE_THICK, 0.06))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(
        sx * (TABLE_W / 2 - 0.13),
        (TABLE_H - TABLE_THICK) / 2,
        sz * (TABLE_LEN / 2 - 0.2),
      )
      scene.add(leg)
    }
  const beamGeo = keepG(new THREE.BoxGeometry(TABLE_W - 0.3, 0.04, 0.04))
  for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, legMat)
    beam.position.set(0, 0.36, sz * (TABLE_LEN / 2 - 0.2))
    scene.add(beam)
  }

  /* ── 네트 ── */
  const netW = TABLE_W + NET_OVERHANG * 2
  const net = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(netW, NET_H)),
    keepM(
      new THREE.MeshBasicMaterial({
        map: texNet,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  net.position.set(0, TABLE_H + NET_H / 2, 0)
  scene.add(net)
  const postGeo = keepG(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 10))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat)
    post.position.set((sx * netW) / 2, TABLE_H + (NET_H + 0.03) / 2, 0)
    scene.add(post)
  }

  /* ── 선수(마스코트) · 라켓 ──
     양쪽 다 같은 마스코트라 몸 색으로는 진영을 못 가린다.
     기존 P1 파랑 / P2 빨강을 accent(머리띠·손목밴드·라켓 고무)로 재사용한다. */
  const P1_COLOR = 0x2b8fe0 // 가까운쪽(P1) 파랑 — 기존 2D 색 유지
  const P2_COLOR = 0xe2513c // 먼쪽(P2) 빨강
  const p1Paddle = makePaddle(P1_COLOR, -1, posToZ(IDEAL1), mats)
  const p2Paddle = makePaddle(P2_COLOR, 1, posToZ(IDEAL2), mats)
  scene.add(p1Paddle.group, p2Paddle.group)
  const p1Mascot = makeMascot(P1_COLOR, NEAR_Z + MASCOT_BACK, -1, mats)
  const p2Mascot = makeMascot(P2_COLOR, FAR_Z - MASCOT_BACK, 1, mats)
  scene.add(p1Mascot.root, p2Mascot.root)

  /* ── 가짜 그림자 (바닥/테이블에 눕힌 그라디언트 판) ── */
  const blobGeo = keepG(new THREE.PlaneGeometry(1, 1))
  const mkBlob = (opacity: number) => {
    const m = new THREE.Mesh(
      blobGeo,
      keepM(
        new THREE.MeshBasicMaterial({
          map: texBlob,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    )
    m.rotation.x = -Math.PI / 2
    scene.add(m)
    return m
  }
  const ballShadow = mkBlob(0.85)
  const p1Shadow = mkBlob(0.5)
  const p2Shadow = mkBlob(0.5)
  // 마스코트 발밑 그림자 — 덩치·위치를 따라간다
  const mascotBlob = 0.9 * MASCOT_SCALE
  p1Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p1Shadow.position.set(0, 0.004, NEAR_Z + MASCOT_BACK)
  p2Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p2Shadow.position.set(0, 0.004, FAR_Z - MASCOT_BACK)

  /* ── 공 + 스매시 잔상 ── */
  const ballGeo = keepG(new THREE.SphereGeometry(BALL_R, 22, 16))
  const ball = new THREE.Mesh(
    ballGeo,
    keepM(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.42, emissive: 0x2a2a22 })),
  )
  scene.add(ball)
  const trail: THREE.Mesh[] = []
  for (let i = 0; i < TRAIL; i++) {
    const m = new THREE.Mesh(
      ballGeo,
      keepM(
        new THREE.MeshBasicMaterial({
          color: 0xff8a5c,
          transparent: true,
          opacity: 0.3 * (1 - i / TRAIL),
          depthWrite: false,
        }),
      ),
    )
    m.visible = false
    m.scale.setScalar(1 - i * 0.13)
    scene.add(m)
    trail.push(m)
  }
  const history: THREE.Vector3[] = Array.from({ length: TRAIL }, () => new THREE.Vector3())

  /* ── 타이밍 링 (공을 감싸는 고리, 카메라를 향해 세운다) ── */
  const ringMat = keepM(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const ring = new THREE.Mesh(
    keepG(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.5, 32)),
    ringMat,
  )
  ring.visible = false
  scene.add(ring)

  /* ── 카메라 (양 끝에 하나씩) ── */
  const mkCam = (viewer: Viewer) => {
    const c = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60)
    const sign = viewer === 1 ? 1 : -1
    c.position.set(0, CAM_HEIGHT, sign * (TABLE_LEN / 2 + CAM_BACK))
    c.lookAt(0, LOOK_HEIGHT, sign * LOOK_AHEAD)
    return c
  }
  const cams: Record<Viewer, THREE.PerspectiveCamera> = { 1: mkCam(1), 2: mkCam(2) }
  const camHome: Record<Viewer, THREE.Vector3> = {
    1: cams[1].position.clone(),
    2: cams[2].position.clone(),
  }

  let vw = 1
  let vh = 1

  /* ============================================================
     프레임 갱신
     ============================================================ */
  function update(s: FrameState) {
    const position = updateBall(s)
    updateBallShadow(position)
    updatePlayers(s)
    updateTrail(position, s)
    updateCameras(s.shake)
  }

  function updateBall(s: FrameState) {
    const prog = flightProgress(s.ballPos, s.ballDir, s.ballFault)
    const bx = xToWorld(s.ballX)
    const bz = posToZ(s.ballPos)
    // 죽은 공은 그 자리에서 자유낙하 (테이블 위면 상판에, 밖이면 바닥에 얹힌다)
    const overTop = Math.abs(bz) <= TABLE_LEN / 2 && Math.abs(bx) <= TABLE_W / 2
    const restY = (overTop ? TABLE_H : 0) + BALL_R
    const by = Math.max(
      restY,
      ballY(prog, s.ballSmash, s.ballFault, s.ballFaultFrom) - 4.9 * s.ballFall * s.ballFall,
    )
    ball.position.set(bx, by, bz)
    // 굴러가는 느낌 (진행 방향으로 회전)
    ball.rotation.x += s.ballDir * 0.42
    ball.rotation.y += 0.12

    return { bx, by, bz, overTop }
  }

  function updateBallShadow({
    bx,
    by,
    bz,
    overTop,
  }: {
    bx: number
    by: number
    bz: number
    overTop: boolean
  }) {
    // 공 그림자 — 테이블 위면 상판에, 코트를 벗어나면 바닥에 떨어진다.
    const groundY = overTop ? TABLE_H + 0.003 : 0.006
    const height = Math.max(0, by - groundY)
    ballShadow.position.set(bx, groundY, bz)
    // 높이 오를수록 크고 옅게 → 공중에 떠 있음이 읽힌다
    const spread = 0.13 + height * 0.42
    ballShadow.scale.set(spread, spread, 1)
    const sm = ballShadow.material as THREE.MeshBasicMaterial
    sm.opacity = clamp(0.9 - height * 0.75, 0.14, 0.9)
  }

  function updatePlayers(s: FrameState) {
    // 라켓 (1인칭으로 보이는 내 라켓)
    poseP(p1Paddle, s.p1X, s.p1Swing)
    poseP(p2Paddle, s.p2X, s.p2Swing)

    // 마스코트 — 좌우 추적 · 스윙 · 보빙 · 강타 반응
    const t = performance.now() / 1000
    const react = clamp(s.shake * (s.ballSmash ? 1 : 0.55), 0, 1)
    poseMascot(p1Mascot, s.p1X, s.p1Swing, react, t)
    poseMascot(p2Mascot, s.p2X, s.p2Swing, react, t)
    p1Shadow.position.x = p1Mascot.root.position.x
    p2Shadow.position.x = p2Mascot.root.position.x
  }

  function updateTrail({ bx, by, bz }: { bx: number; by: number; bz: number }, s: FrameState) {
    shiftTrailHistory()
    history[0]?.set(bx, by, bz)
    renderTrail(s.ballSmash && s.playing)
  }

  function shiftTrailHistory() {
    for (let i = history.length - 1; i > 0; i--) {
      const current = history[i]
      const previous = history[i - 1]
      if (current && previous) current.copy(previous)
    }
  }

  function renderTrail(showTrail: boolean) {
    for (let i = 0; i < trail.length; i++) {
      const dot = trail[i]
      const point = history[i]
      if (!dot) continue
      dot.visible = showTrail
      if (showTrail && point) dot.position.copy(point)
    }
  }

  function updateCameras(shake: number) {
    // 화면 흔들림 — 카메라를 살짝 튕긴다
    for (const v of [1, 2] as Viewer[]) {
      const home = camHome[v]
      if (shake > 0) {
        cams[v].position.set(
          home.x + (Math.random() - 0.5) * SHAKE_AMP * shake,
          home.y + (Math.random() - 0.5) * SHAKE_AMP * shake,
          home.z,
        )
      } else if (!cams[v].position.equals(home)) {
        cams[v].position.copy(home)
      }
    }
  }

  /**
   * 이 시점에서만 달라지는 것들을 세팅.
   *  - 내 몸은 숨긴다 (카메라가 어깨 뒤라 몸통이 화면을 가림) → 화면엔 늘 상대 마스코트만
   *  - 라켓은 내 것만 그린다 (상대 라켓은 상대 마스코트가 손에 들고 있다)
   *  - 타이밍 링은 "지금 받는 사람" 화면에만 띄운다
   */
  function prepare(viewer: Viewer, s: FrameState) {
    prepareViewer(viewer)
    prepareTimingRing(viewer, s)
  }

  function prepareViewer(viewer: Viewer) {
    p1Mascot.root.visible = viewer !== 1
    p2Mascot.root.visible = viewer !== 2
    p1Shadow.visible = viewer !== 1
    p2Shadow.visible = viewer !== 2
    p1Paddle.group.visible = viewer === 1
    p2Paddle.group.visible = viewer === 2
  }

  function prepareTimingRing(viewer: Viewer, s: FrameState) {
    const dv = viewerDepth(s.ballPos, viewer)
    const incoming = viewer === 1 ? s.ballDir > 0 : s.ballDir < 0
    // 죽은 공엔 링을 띄우지 않는다 — 칠 수 없는 공에 타이밍을 재게 하면 안 된다
    const show = s.playing && incoming && !s.ballHit && !s.ballFault && dv > W1_LO - 0.14
    ring.visible = show
    if (!show) return

    const { color, opacity, scale } = timingRingStyle(dv)
    ringMat.color.setHex(color)
    ringMat.opacity = opacity
    ring.position.copy(ball.position)
    ring.quaternion.copy(cams[viewer].quaternion) // 카메라를 정면으로 바라보게
    ring.scale.setScalar(scale)
  }

  function timingRingStyle(depth: number) {
    const distance = Math.abs(depth - IDEAL1)
    if (distance <= PERFECT_D) return { color: 0xffd24a, opacity: 1, scale: 1.35 }
    if (depth >= W1_LO && depth <= W1_HI) return { color: 0x49e08a, opacity: 0.9, scale: 1 }
    return { color: 0xdfe6ec, opacity: 0.42, scale: 1 }
  }

  function render(s: FrameState) {
    if (s.split) {
      // 좌우 분할 — 기존 2D 와 같은 배치 (왼쪽 = P1 시점, 오른쪽 = P2 시점)
      const halfW = Math.floor(vw / 2)
      renderer.setScissorTest(true)
      const passes: Array<[Viewer, number, number]> = [
        [1, 0, halfW],
        [2, halfW, vw - halfW],
      ]
      for (const [viewer, x, w] of passes) {
        const cam = cams[viewer]
        cam.aspect = w / vh
        cam.updateProjectionMatrix()
        renderer.setViewport(x, 0, w, vh)
        renderer.setScissor(x, 0, w, vh)
        prepare(viewer, s)
        renderer.render(scene, cam)
      }
      renderer.setScissorTest(false)
    } else {
      const cam = cams[s.viewer]
      cam.aspect = vw / vh
      cam.updateProjectionMatrix()
      renderer.setViewport(0, 0, vw, vh)
      prepare(s.viewer, s)
      renderer.render(scene, cam)
    }
  }

  function resize(w: number, h: number, dpr: number) {
    vw = Math.max(1, Math.round(w))
    vh = Math.max(1, Math.round(h))
    renderer.setPixelRatio(dpr)
    renderer.setSize(vw, vh, false)
  }

  function dispose() {
    geos.forEach((g) => {
      g.dispose()
    })
    matsList.forEach((m) => {
      m.dispose()
    })
    texs.forEach((t) => {
      t.dispose()
    })
    renderer.dispose()
  }

  return { update, render, resize, dispose }
}
