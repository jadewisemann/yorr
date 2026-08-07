import { beforeEach, describe, expect, it } from 'vitest'
import { createInviteUrl } from '@/room/components/InvitePopover'
import { isPartyRoom, savePartyRoom } from '@/room/partyControllerStorage'

describe('파티 컨트롤러 판별', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('대시보드 QR에만 party 파라미터가 붙는다', () => {
    expect(createInviteUrl('A4F2')).not.toContain('party')
    expect(createInviteUrl('A4F2', { party: true })).toContain('&party=1')
  })

  it('기억한 방과 코드가 같을 때만 컨트롤러다', () => {
    expect(isPartyRoom('A4F2')).toBe(false)
    savePartyRoom('A4F2')
    expect(isPartyRoom('A4F2')).toBe(true)
    expect(isPartyRoom('B7K1')).toBe(false)
    expect(isPartyRoom(undefined)).toBe(false)
  })
})
