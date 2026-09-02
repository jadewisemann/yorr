import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyScoreBoard,
  creatorPlayer,
  creatorSession,
  participantPlayer,
  serverMessage,
} from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { mountSync } from './realtimeSyncHarness'

describe('RealtimeSync — 스냅샷 반영', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
  })

  /** 1라운드를 열고 상대의 확정 점수 하나를 흘려보낸다. */
  function startRoundWithScore(client: ReturnType<typeof mountSync>) {
    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.score.update', {
        playerId: participantPlayer.playerId,
        scoreboard: { ...createEmptyScoreBoard(), total: 24 },
      }),
    )
  }

  /** 마지막 라운드를 열고 서버 순위와 함께 끝낸다. */
  function finishWithRankings(client: ReturnType<typeof mountSync>) {
    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.game.over', {
        rankings: [
          { rank: 1, playerId: participantPlayer.playerId, total: 205 },
          { rank: 2, playerId: creatorPlayer.playerId, total: 180 },
        ],
      }),
    )
  }

  /** 1라운드를 연다. 주사위 방송의 채택 조건을 보는 검사들이 여기서 출발한다. */
  function startFirstRound(client: ReturnType<typeof mountSync>) {
    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
  }

  /** 주사위 방송 하나. 채택되면 공유 스냅샷의 `rollCount`가 이 값으로 바뀐다. */
  function broadcastDice(
    client: ReturnType<typeof mountSync>,
    overrides: { playerId?: string; roundNumber?: number; rollCount: 1 | 2 | 3 },
    envelope?: { roomId: string },
  ) {
    client.emitMessage(
      serverMessage(
        'game.yacht_dice.dice.broadcast',
        {
          playerId: overrides.playerId ?? creatorPlayer.playerId,
          roundNumber: overrides.roundNumber ?? 1,
          rollCount: overrides.rollCount,
          dice: [6, 6, 6, 6, 6],
          held: [false, false, false, false, false],
        },
        envelope,
      ),
    )
  }

  it('updates presence and roster from realtime events', () => {
    const client = mountSync()

    client.emitMessage(
      serverMessage('presence.update', {
        playerId: creatorPlayer.playerId,
        status: 'away',
      }),
    )
    expect(useAppStore.getState().roomSnapshot?.players[0]?.status).toBe('away')

    client.emitMessage(serverMessage('room.player_left', { playerId: creatorPlayer.playerId }))
    expect(useAppStore.getState().roomSnapshot?.players).not.toContainEqual(creatorPlayer)
  })

  it('applies the active turn and broadcasts a confirmed score to the shared snapshot', () => {
    const client = mountSync()

    startRoundWithScore(client)

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({
      activePlayerId: creatorPlayer.playerId,
      roundDeadline: 2_000,
      roundNumber: 1,
      scores: {
        [participantPlayer.playerId]: { total: 24 },
      },
    })
  })

  it('keeps every player scoreboard when the server resends a snapshot without game state', () => {
    const client = mountSync()

    startRoundWithScore(client)
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'playing',
          players: [creatorPlayer, participantPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game?.scores).toMatchObject({
      [participantPlayer.playerId]: { total: 24 },
    })
  })

  it('switches the room to finished and stores server rankings on game.over', () => {
    const client = mountSync()

    finishWithRankings(client)

    const snapshot = useAppStore.getState().roomSnapshot
    expect(snapshot?.phase).toBe('finished')
    expect(snapshot?.game?.rankings).toEqual([
      { rank: 1, playerId: participantPlayer.playerId, total: 205 },
      { rank: 2, playerId: creatorPlayer.playerId, total: 180 },
    ])
  })

  it('keeps result nicknames when a player leaves after game over', () => {
    const client = mountSync()

    finishWithRankings(client)

    client.emitMessage(serverMessage('room.player_left', { playerId: participantPlayer.playerId }))
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'finished',
          players: [creatorPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.players).toContainEqual(participantPlayer)
  })

  it('drops game state when the room goes back to the lobby', () => {
    const client = mountSync()

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'waiting',
          players: [creatorPlayer, participantPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.phase).toBe('waiting')
    expect(useAppStore.getState().roomSnapshot?.game).toBeUndefined()
  })
  it('로컬 세션이 없는 상태로 도착한 room.joined는 스냅샷만 갈아끼운다', () => {
    const client = mountSync()
    useAppStore.setState({ roomSession: null })

    client.emitMessage(
      serverMessage('room.joined', {
        you: participantPlayer.playerId,
        sessionToken: 'late-token',
        snapshot: { roomId: creatorSession.roomId, phase: 'waiting', players: [creatorPlayer] },
      }),
    )

    expect(useAppStore.getState().roomSession).toBeNull()
    expect(useAppStore.getState().roomSnapshot).toMatchObject({ phase: 'waiting' })
  })

  it('진행 중인 턴과 같은 라운드의 주사위 결과만 공유 스냅샷에 반영한다', () => {
    const client = mountSync()

    startFirstRound(client)
    client.emitMessage(
      serverMessage('game.yacht_dice.dice.broadcast', {
        playerId: creatorPlayer.playerId,
        roundNumber: 1,
        rollCount: 2,
        dice: [1, 2, 3, 4, 5],
        held: [true, false, false, false, false],
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({
      rollCount: 2,
      dice: [1, 2, 3, 4, 5],
      held: [true, false, false, false, false],
    })

    // 아래 넷은 모두 물리쳐야 하는 방송이다 — 지난 라운드, 남의 차례, 이미 지나간
    // 굴림 번호, 다른 방. 채택되었다면 rollCount가 2에서 움직인다.
    broadcastDice(client, { roundNumber: 0, rollCount: 3 })
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    broadcastDice(client, { playerId: participantPlayer.playerId, rollCount: 3 })
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    broadcastDice(client, { rollCount: 1 })
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    broadcastDice(client, { rollCount: 3 }, { roomId: 'another-room' })
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })
  })
  it('알 수 없는 메시지 타입은 방 상태를 건드리지 않고 지나간다', () => {
    const client = mountSync()
    const before = useAppStore.getState().roomSnapshot

    client.emitMessage(
      serverMessage('game.yacht_dice.round.end', { roundNumber: 1, submitted: [] }),
    )
    client.emitMessage(serverMessage('sys.pong', { serverTs: 1 }))

    expect(useAppStore.getState().roomSnapshot).toBe(before)
  })

  it('새 참가자를 명단에 더하고 같은 참가자가 다시 와도 중복으로 쌓지 않는다', () => {
    const client = mountSync()

    client.emitMessage(serverMessage('room.player_joined', { player: participantPlayer }))
    client.emitMessage(serverMessage('room.player_joined', { player: participantPlayer }))

    const players = useAppStore.getState().roomSnapshot?.players ?? []
    expect(players.filter((player) => player.playerId === participantPlayer.playerId)).toHaveLength(
      1,
    )
    expect(players.at(-1)).toMatchObject({ playerId: participantPlayer.playerId })
  })
})
