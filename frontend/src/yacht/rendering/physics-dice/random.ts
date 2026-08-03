export interface PhysicsDiceRandom {
  next(): number
}

export function createPhysicsDiceRandom(seed: number): PhysicsDiceRandom {
  let state = normalizeSeed(seed)

  return {
    next() {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 2 ** 32
    },
  }
}

function normalizeSeed(seed: number) {
  if (!Number.isFinite(seed)) throw new RangeError('Seed must be a finite number')
  return Math.trunc(seed) >>> 0
}
