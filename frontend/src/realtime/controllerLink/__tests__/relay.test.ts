import { describe, expect, it } from 'vitest'
import { buildClientMessage } from '@/realtime/wsEvents'
import { isRelayable, parseFrame, relayedServerMessage } from '../relay'

const shake = buildClientMessage(
  'game.yacht_dice.dice.shake',
  { direction: 'left', roundNumber: 3, strength: 0.8 },
  { roomId: 'ROOM1' },
)

const throwMessage = buildClientMessage(
  'game.yacht_dice.dice.throw',
  { rollCount: 2, roundNumber: 3 },
  { roomId: 'ROOM1' },
)

describe('isRelayable', () => {
  it('연출 릴레이는 링크로 보낸다', () => {
    expect(isRelayable(shake)).toBe(true)
    expect(isRelayable(throwMessage)).toBe(true)
  })

  it('탁구 스윙도 링크로 보낸다 — 파티 모드에서는 큰 화면이 판정한다', () => {
    // 서버가 판정하지 않는 유일한 권위성 입력이다(ADR-0003).
    const swing = buildClientMessage('game.ping_pong.swing', { inputSeq: 1, clientTs: 0 })

    expect(isRelayable(swing)).toBe(true)
  })

  it('서버가 판정하는 권위 메시지는 거부한다', () => {
    const roll = buildClientMessage('game.yacht_dice.dice.roll', {
      roundNumber: 3,
      rollCount: 1,
      held: [false, false, false, false, false],
    })
    const draw = buildClientMessage('game.duel.draw', { inputSeq: 1, reactionMs: 220 })
    const hold = buildClientMessage('game.yacht_dice.dice.hold', {
      roundNumber: 3,
      held: [true, false, false, false, false],
    })

    expect(isRelayable(roll)).toBe(false)
    expect(isRelayable(draw)).toBe(false)
    expect(isRelayable(hold)).toBe(false)
  })
})

describe('parseFrame', () => {
  it('릴레이·ping·pong 프레임을 읽는다', () => {
    expect(parseFrame(JSON.stringify({ kind: 'relay', message: shake }))).toEqual({
      kind: 'relay',
      message: shake,
    })
    expect(parseFrame(JSON.stringify({ kind: 'ping', sentAt: 12 }))).toEqual({
      kind: 'ping',
      sentAt: 12,
    })
    expect(parseFrame(JSON.stringify({ kind: 'pong', sentAt: 12 }))).toEqual({
      kind: 'pong',
      sentAt: 12,
    })
  })

  it('모르는 모양은 던지지 않고 버린다', () => {
    // 낡은 배포본이 붙어 있을 수 있다. 던지면 채널이 닫혀 폴백 판정이 늦어진다.
    expect(parseFrame('not json')).toBeNull()
    expect(parseFrame(new ArrayBuffer(4))).toBeNull()
    expect(parseFrame(JSON.stringify({ kind: 'ping' }))).toBeNull()
    expect(parseFrame(JSON.stringify({ kind: 'relay' }))).toBeNull()
    expect(parseFrame(JSON.stringify({ kind: 'nope' }))).toBeNull()
  })

  it('링크로 올 수 없는 타입을 릴레이로 위장해도 버린다', () => {
    const roll = buildClientMessage('game.yacht_dice.dice.roll', {
      roundNumber: 1,
      rollCount: 1,
      held: [false, false, false, false, false],
    })

    expect(parseFrame(JSON.stringify({ kind: 'relay', message: roll }))).toBeNull()
  })
})

describe('relayedServerMessage', () => {
  it('서버가 뿌렸을 봉투와 같은 모양으로 바꾼다', () => {
    const message = relayedServerMessage({ kind: 'relay', message: shake }, 'peer-1', 'ROOM1')

    expect(message.type).toBe('game.yacht_dice.dice.shaken')
    expect(message.roomId).toBe('ROOM1')
    expect(message.payload).toEqual({
      playerId: 'peer-1',
      direction: 'left',
      roundNumber: 3,
      strength: 0.8,
    })
  })

  it('playerId는 서버가 찍어 준 from을 쓴다', () => {
    // 프레임 안의 주장을 믿으면 남을 사칭할 수 있다 — 음성 시그널링과 같은 규칙.
    const spoofed = { ...shake, payload: { ...shake.payload, playerId: 'victim' } }
    const message = relayedServerMessage(
      { kind: 'relay', message: spoofed as typeof shake },
      'peer-1',
      'ROOM1',
    )

    expect(message.payload).toMatchObject({ playerId: 'peer-1' })
  })

  it('던지기는 rollCount를 그대로 옮긴다', () => {
    const message = relayedServerMessage(
      { kind: 'relay', message: throwMessage },
      'peer-2',
      'ROOM1',
    )

    expect(message.type).toBe('game.yacht_dice.dice.thrown')
    expect(message.payload).toEqual({ playerId: 'peer-2', roundNumber: 3, rollCount: 2 })
  })
})
