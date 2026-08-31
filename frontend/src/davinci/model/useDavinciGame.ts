import { useCallback, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  type ClientMessage,
  type DavinciDecision,
  type DavinciView,
  type PlayerId,
} from '@/realtime/wsEvents'

interface UseDavinciGameOptions {
  roomId: string
  you: PlayerId
  state: DavinciView | undefined
}

/** 지금 고르고 있는 상대 타일. 서버가 아니라 이 화면만 아는 값이다. */
export interface TileSelection {
  playerId: PlayerId
  tileId: string
}

/**
 * 아직 보내지 않은 선택. `key`가 "이 선택이 어느 턴·단계의 것인가"를 들고 있어서
 * 새 시점이 오면 통째로 버릴 수 있다(DESIGN.md 원칙 3의 라운드 귀속 draft).
 */
interface Draft {
  key: string
  number: number | null
  selection: TileSelection | null
}

const SEND_ERROR = '연결을 확인한 뒤 다시 시도해 주세요.'

const draftKeyOf = (state: DavinciView | undefined): string =>
  `${state?.turn ?? 0}:${state?.phase ?? 'none'}`

const emptyDraft = (key: string): Draft => ({ key, number: null, selection: null })

/**
 * 다빈치 코드의 입력 계층.
 *
 * 서버가 판정하는 것은 셋뿐이라(`guess`·`decide`·`place`) 훅이 하는 일도 셋이다:
 * ① 아직 보내지 않은 선택(타일·숫자)을 들고 있기 ② 봉투를 만들어 보내기
 * ③ **턴이 바뀌면 선택을 버리기**.
 *
 * ③을 빠뜨리면 지난 턴에 고른 타일이 다음 턴에도 선택된 것처럼 보이고, 그 사이 그
 * 타일이 공개됐다면 서버가 조용히 무시하는 추측을 사람이 눈치채지 못한 채 보낸다.
 */
export function useDavinciGame({ roomId, state, you }: UseDavinciGameOptions) {
  const client = useRealtimeClient()
  const inputSeq = useRef(0)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(draftKeyOf(state)))
  const [sendError, setSendError] = useState<string | null>(null)

  // 렌더 중에 비교해 버린다 — `useEffect`로 한 프레임 늦게 지우면 그 프레임 동안
  // 지난 턴의 선택이 새 판 위에 선택된 것처럼 남는다(duel `useImpactDelay`와 같은 자리).
  const key = draftKeyOf(state)
  if (draft.key !== key) setDraft(emptyDraft(key))

  const send = useCallback(
    (message: ClientMessage) => {
      try {
        client.send(message)
        setSendError(null)
      } catch {
        setSendError(SEND_ERROR)
      }
    },
    [client],
  )

  const guess = useCallback(() => {
    const { number, selection } = draft
    if (selection === null || number === null) return
    send(
      buildClientMessage(
        'game.davinci_code.guess',
        {
          inputSeq: ++inputSeq.current,
          targetId: selection.playerId,
          tileId: selection.tileId,
          number,
        },
        { roomId },
      ),
    )
  }, [draft, roomId, send])

  const decide = useCallback(
    (decision: DavinciDecision) => {
      send(
        buildClientMessage(
          'game.davinci_code.decide',
          { inputSeq: ++inputSeq.current, decision },
          { roomId },
        ),
      )
    },
    [roomId, send],
  )

  const place = useCallback(
    (index: number) => {
      send(
        buildClientMessage(
          'game.davinci_code.place',
          { inputSeq: ++inputSeq.current, index },
          { roomId },
        ),
      )
    },
    [roomId, send],
  )

  const selectTile = useCallback(
    (playerId: PlayerId, tileId: string) => {
      if (state?.turnPlayerId !== you) return
      setDraft((current) => ({
        ...current,
        selection: current.selection?.tileId === tileId ? null : { playerId, tileId },
      }))
    },
    [state?.turnPlayerId, you],
  )

  const selectNumber = useCallback((value: number) => {
    setDraft((current) => ({ ...current, number: value }))
  }, [])

  return {
    decide,
    guess,
    number: draft.number,
    place,
    selectNumber,
    selectTile,
    selection: draft.selection,
    sendError,
  }
}
