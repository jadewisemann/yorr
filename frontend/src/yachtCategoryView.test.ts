import { describe, expect, it } from 'vitest'
import { categoryRowState, isRecorded } from './yachtCategoryView'

describe('categoryRowState', () => {
  it('marks an unrecorded category as available or selected', () => {
    expect(categoryRowState(null, false)).toBe('available')
    expect(categoryRowState(undefined, false)).toBe('available')
    expect(categoryRowState(null, true)).toBe('selected')
  })

  it('separates a recorded zero from a recorded score', () => {
    expect(categoryRowState(12, false)).toBe('used')
    expect(categoryRowState(0, false)).toBe('zeroed')
  })

  it('keeps a recorded category recorded even if it is somehow selected', () => {
    expect(categoryRowState(12, true)).toBe('used')
    expect(categoryRowState(0, true)).toBe('zeroed')
  })
})

describe('isRecorded', () => {
  it('treats zero as recorded and null or undefined as blank', () => {
    expect(isRecorded(0)).toBe(true)
    expect(isRecorded(30)).toBe(true)
    expect(isRecorded(null)).toBe(false)
    expect(isRecorded(undefined)).toBe(false)
  })
})
