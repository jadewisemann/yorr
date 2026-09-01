import { describe, expect, it } from 'vitest'
import type { RoomService } from '../../../../room/roomService.js'
import { InMemoryRoundStateStore, RoundSynchronizationService } from '../../../round/index.js'
import type { ScoreConfirmationService } from '../../../score/index.js'
import type { YachtTurnActionService } from '../../yachtTurnActionService.js'
import type {
  YachtBotActions,
  YachtBotFallbackStrategy,
  YachtBotPolicy,
  YachtBotRoomService,
  YachtBotRoundLookup,
  YachtBotScoreLookup,
} from '../botPorts.js'
import { ExpectimaxYachtBotPolicy } from '../expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'

/**
 * 3.2의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다 — 3.1의
 * `yachtPorts.contract.test.ts`와 같은 이유이자 같은 형식이다: 어댑터가 없으므로
 * 시그니처가 어긋나면 **배선하는 순간(`server.ts`)에야** 터진다.
 *
 * Redis 의존이 있어 인스턴스를 만들 수 없는 것은 타입 수준(`extends`)으로만
 * 확인한다 — `npx tsc --noEmit`이 그 줄의 검증자다.
 */
describe('봇 포트 ↔ 실제 구현 호환', () => {
  it('RoundSynchronizationService가 YachtBotRoundLookup을 만족한다', async () => {
    const real = new RoundSynchronizationService(new InMemoryRoundStateStore())
    const port: YachtBotRoundLookup = real

    await real.initialize('room-a', 1, ['bot-a'])
    expect((await port.findByRoomId('room-a'))?.roundNumber).toBe(1)
    // 없는 방은 undefined다 — 코디네이터의 스테일 판정 입력.
    expect(await port.findByRoomId('room-z')).toBeUndefined()
  })

  it('ExpectimaxYachtBotPolicy가 YachtBotPolicy를 만족한다', () => {
    // 평가기도 구조적 스텁으로 대입된다 — 정책이 구체 평가기 클래스에 묶이지 않는다.
    const port: YachtBotPolicy = new ExpectimaxYachtBotPolicy({ categoryUtility: () => 0 })

    expect(typeof port.decide).toBe('function')
  })

  it('LocalYachtBotStrategy가 YachtBotFallbackStrategy를 만족한다', () => {
    const port: YachtBotFallbackStrategy = new LocalYachtBotStrategy()

    expect(port.chooseCategory([6, 6, 6, 6, 6], ['yacht'])).toBe('yacht')
  })

  /* --------------------------------- 인스턴스를 만들 수 없는 것은 타입 수준으로 */

  /**
   * 봇이 **사람과 같은 행동 경계**를 쓴다는 것의 컴파일 증거다. 3.1의 서비스
   * 시그니처가 바뀌면 여기서 먼저 깨진다.
   */
  it('YachtTurnActionService가 YachtBotActions를 만족한다(타입 수준)', () => {
    const satisfied: YachtTurnActionService extends YachtBotActions ? true : false = true
    expect(satisfied).toBe(true)
  })

  it('RoomService가 YachtBotRoomService를 만족한다(타입 수준)', () => {
    const satisfied: RoomService extends YachtBotRoomService ? true : false = true
    expect(satisfied).toBe(true)
  })

  it('ScoreConfirmationService가 YachtBotScoreLookup을 만족한다(타입 수준)', () => {
    const satisfied: ScoreConfirmationService extends YachtBotScoreLookup ? true : false = true
    expect(satisfied).toBe(true)
  })
})
