import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyScoreBoard, creatorSession, serverMessage } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ClientMessage, ScoreBoard } from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import { useGamePlaySubmission } from '@/yacht/model/useGamePlaySubmission'

const ME = creatorSession.you
const ROOM = creatorSession.roomId
const DICE: DiceSet = [1, 1, 1, 2, 3]

/** `ones` 세 개를 기록한 점수판. 자동 기록 안내가 무엇을 읽는지 본다. */
const boardWithOnes = (): ScoreBoard => {
  const board = createEmptyScoreBoard()
  return { ...board, categories: { ...board.categories, ones: 3 }, total: 3 }
}

function renderSubmission(options: { dice?: DiceSet | null; myBoard?: ScoreBoard } = {}) {
  const client = new FakeRealtimeClient()
  const dispatch = vi.fn()
  const onSucceeded = vi.fn()
  const showToast = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  )
  const view = renderHook(
    ({ myBoard }: { myBoard: ScoreBoard | undefined }) =>
      useGamePlaySubmission({
        activePlayerId: ME,
        dice: options.dice === undefined ? DICE : options.dice,
        dispatch,
        myBoard,
        onSucceeded,
        roomId: ROOM,
        roundNumber: 1,
        showToast,
        you: ME,
      }),
    { initialProps: { myBoard: options.myBoard ?? createEmptyScoreBoard() }, wrapper },
  )
  return {
    ...view,
    client,
    dispatch,
    onSucceeded,
    sent: () => client.sentMessages as ClientMessage[],
    showToast,
  }
}

describe('useGamePlaySubmission', () => {
  it('주사위를 굴리기 전에는 기록을 보낼 수 없다', () => {
    const view = renderSubmission({ dice: null })

    act(() => view.result.current.submitCategory('ones'))

    expect(view.sent()).toHaveLength(0)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('보낸 요청의 답이 오면 성공으로 마무리한다', () => {
    const view = renderSubmission()

    act(() => view.result.current.submitCategory('ones'))
    const msgId = view.sent()[0]?.msgId

    act(() =>
      view.client.emitMessage(
        serverMessage(
          'game.yacht_dice.score.update',
          { playerId: ME, scoreboard: boardWithOnes() },
          { msgId },
        ),
      ),
    )

    expect(view.dispatch).toHaveBeenCalledWith({ type: 'submissionSucceeded' })
    expect(view.onSucceeded).toHaveBeenCalledOnce()
  })

  it('전송이 실패하면 되돌리고 다시 하라고 알린다', () => {
    const view = renderSubmission()
    vi.spyOn(view.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })

    act(() => view.result.current.submitCategory('ones'))

    expect(view.dispatch).toHaveBeenCalledWith({ type: 'submissionFailed' })
    expect(view.showToast).toHaveBeenCalledWith('점수를 기록하지 못했어요. 다시 시도해 주세요.')
  })

  it('내가 보내지 않았는데 점수판이 채워졌으면 자동 기록으로 알린다', () => {
    const view = renderSubmission()

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.score.update', {
          playerId: ME,
          scoreboard: boardWithOnes(),
        }),
      ),
    )

    expect(view.showToast).toHaveBeenCalledWith(
      expect.stringContaining('시간이 지나 에이스 3점으로 자동 기록됐어요.'),
    )
  })

  it('남의 점수판과 바뀐 것이 없는 갱신에는 아무 말도 하지 않는다', () => {
    const view = renderSubmission()

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.score.update', {
          playerId: 'player-2',
          scoreboard: boardWithOnes(),
        }),
      ),
    )
    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.score.update', {
          playerId: ME,
          scoreboard: createEmptyScoreBoard(),
        }),
      ),
    )

    expect(view.showToast).not.toHaveBeenCalled()
  })
})
