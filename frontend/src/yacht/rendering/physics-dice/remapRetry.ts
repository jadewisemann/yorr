import type RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS_DICE_CONFIG } from './config'
import { createPhysicsDiceRandom } from './random'
import type { PredictableDie } from './remapScore'
import type { PhysicsDiceIndex } from './types'

/**
 * 예측 시뮬레이션의 **재시도 보정** — 시도마다 주사위를 흩뿌리고, 벽에 걸린 주사위를
 * 눌러 내린다.
 *
 * `remap.ts`에서 갈라 둔 이유: 이 조작들은 "한 번의 시뮬레이션을 어떻게 돌리는가"와
 * 성격이 다르다 — 실패한 배치를 **고치는** 단계이고, 시드·시도 번호만 알면 된다.
 *
 * 같은 시드·같은 시도에서 같은 결과가 나와야 하므로 난수는 `random.ts`를 거쳐 쓰고,
 * 시드 혼합은 이 파일 안에서만 한다.
 */

/** 재시도마다 조금씩 더 흩뿌린다 — 같은 배치에 갇히지 않게. */
const RETRY_FAN_SPEED_STEP = 0.3
const RETRY_RANDOM_SPEED = 0.1
/** 재시도에서 회전도 조금 흩뿌린다 — 같은 면으로 굳는 것을 피한다. */
const RETRY_ANGULAR_SPEED = 0.8
/** 같은 시도에서 눌러 내리기를 여러 번 할 때, 시드를 조금씩 비튼다. */
const ASSIST_SEED_STEP = 11

/** 시드·시도·주사위 인덱스를 하나의 32비트 정수로 섞는다(재현 가능). */
export function retrySeed(seed: number, attempt: number, index: PhysicsDiceIndex): number {
  let mixed =
    (Math.trunc(seed) ^ Math.imul(attempt, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

export interface SpreadInput {
  readonly entries: readonly PredictableDie[]
  readonly held: readonly boolean[]
  readonly seed: number
  readonly attempt: number
}

/**
 * 두 번째 시도부터 초기 속도를 흩뿌린다. 첫 시도는 자연스러운 결과를 그대로 쓴다.
 * `rank`를 이용해 좌우로 부채꼴로 벌린다 — 가운데로 몰리면 다시 겹친다.
 */
export function spreadOnRetry(
  bodies: Array<RAPIER.RigidBody | undefined>,
  { entries, held, seed, attempt }: SpreadInput,
): void {
  if (attempt === 0) return
  const rollingSlots = entries
    .map((entry, slot) => ({ entry, slot }))
    .filter(({ entry }) => !held[entry.index])
  rollingSlots.forEach(({ entry, slot }, rank) => {
    const body = bodies[slot]
    if (!body) return
    const random = createPhysicsDiceRandom(retrySeed(seed, attempt, entry.index))
    const velocity = body.linvel()
    const fan =
      (rank - (rollingSlots.length - 1) / 2) / Math.max(0.5, (rollingSlots.length - 1) / 2)
    body.setLinvel(
      {
        x:
          velocity.x +
          (random.next() - 0.5) *
            RETRY_RANDOM_SPEED *
            PHYSICS_DICE_CONFIG.defaults.throwForce *
            attempt,
        y: velocity.y,
        z:
          velocity.z +
          (fan * RETRY_FAN_SPEED_STEP + (random.next() - 0.5) * RETRY_RANDOM_SPEED) *
            PHYSICS_DICE_CONFIG.defaults.throwForce *
            attempt,
      },
      true,
    )
    const angular = body.angvel()
    body.setAngvel(
      {
        x: angular.x + (random.next() - 0.5) * 2 * RETRY_ANGULAR_SPEED * attempt,
        y: angular.y,
        z: angular.z + (random.next() - 0.5) * 2 * RETRY_ANGULAR_SPEED * attempt,
      },
      true,
    )
    body.wakeUp()
  })
}

export interface AssistInput {
  readonly entries: readonly PredictableDie[]
  readonly held: readonly boolean[]
  readonly seed: number
  readonly attempt: number
}

/**
 * 바닥보다 높이 떠 **다른 주사위에 걸친** 주사위를 아래로 눌러 내린다.
 *
 * 정상적으로 다른 주사위 위에 쌓인 경우(`supportedByDie`)는 건드리지 않는다 —
 * "걸친" 자세와 "쌓인" 자세를 가르는 것이 이 함수의 전부다.
 *
 * @returns 하나라도 눌렀으면 true(호출자가 안정 카운터를 다시 센다).
 */
export function pressStandingDice(
  bodies: Array<RAPIER.RigidBody | undefined>,
  { entries, held, seed, attempt }: AssistInput,
  assist: number,
): boolean {
  const width = PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.bowlDiceScale
  const active = entries
    .map((entry, slot) => ({ body: bodies[slot], entry }))
    .filter(
      (item): item is { body: RAPIER.RigidBody; entry: PredictableDie } =>
        Boolean(item.body) && !held[item.entry.index],
    )
  let pressed = false
  active.forEach(({ body, entry }) => {
    const position = body.translation()
    if (position.y <= width / 2 + width * 0.18) return
    const supportedByDie = active.some(({ body: other }) => {
      if (other.handle === body.handle) return false
      const otherPosition = other.translation()
      return (
        otherPosition.y < position.y - width * 0.35 &&
        Math.hypot(otherPosition.x - position.x, otherPosition.z - position.z) < width * 0.82
      )
    })
    if (supportedByDie) return
    const random = createPhysicsDiceRandom(
      retrySeed(seed, attempt + assist + ASSIST_SEED_STEP, entry.index),
    )
    const angle = random.next() * Math.PI * 2
    body.applyImpulseAtPoint(
      { x: 0, y: -PHYSICS_DICE_CONFIG.defaults.mass, z: 0 },
      {
        x: position.x + Math.cos(angle) * width * 0.35,
        y: position.y,
        z: position.z + Math.sin(angle) * width * 0.35,
      },
      true,
    )
    pressed = true
  })
  return pressed
}
