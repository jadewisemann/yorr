import { describe, expect, it } from 'vitest'
import { FAR_Z, NEAR_Z, posToZ, TABLE_LEN } from '../court'

describe('ping pong court depth', () => {
  it('uses the extended table depth for both geometry endpoints and ball travel', () => {
    expect(TABLE_LEN).toBeCloseTo(3.5072)
    expect(posToZ(0)).toBe(FAR_Z)
    expect(posToZ(1)).toBe(NEAR_Z)
    expect(NEAR_Z - FAR_Z).toBeCloseTo(TABLE_LEN)
  })
})
