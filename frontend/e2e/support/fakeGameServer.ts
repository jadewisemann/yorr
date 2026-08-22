import type { Page, WebSocketRoute } from '@playwright/test'
import type { DiceSet, HeldDice, RoomSnapshot, ScoreBoard } from './contract'
import { HOST, waitingSnapshot } from './contract'

export interface ClientEnvelope {
  type: string
  ts: number
  payload: Record<string, unknown>
  roomId?: string
  msgId?: string
}

export interface RoomJoinPayload {
  roomId: string
  nickname: string
  sessionToken: string
}

export interface FakeGameServerOptions {
  you?: string

  heartbeatIntervalMs?: number

  snapshot?: RoomSnapshot | ((join: RoomJoinPayload) => RoomSnapshot)

  autoJoin?: boolean
}

export interface FakeGameServer {
  readonly connections: number

  readonly joins: RoomJoinPayload[]
  waitForConnection(count?: number): Promise<void>
  waitForClientMessage(type: string, options?: { timeoutMs?: number }): Promise<ClientEnvelope>
  clientMessages(type?: string): ClientEnvelope[]
  send(
    type: string,
    payload: Record<string, unknown>,
    options?: { msgId?: string; roomId?: string },
  ): void

  setSnapshot(snapshot: RoomSnapshot): void
  currentSnapshot(): RoomSnapshot | null

  syncSnapshot(snapshot: RoomSnapshot): void

  answerRoll(
    dice: DiceSet,
    options?: { playerId?: string; auto?: boolean },
  ): Promise<{ roundNumber: number; rollCount: number; held: HeldDice }>

  answerSubmit(
    scoreboard: ScoreBoard,
    options?: { playerId?: string },
  ): Promise<{ roundNumber: number; category: string }>

  closeConnection(options?: { code?: number; reason?: string }): void
}

interface PendingWaiter {
  type: string
  resolve: (message: ClientEnvelope) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_WAIT_TIMEOUT_MS = 10_000

export async function startFakeGameServer(
  page: Page,
  options: FakeGameServerOptions = {},
): Promise<FakeGameServer> {
  const you = options.you ?? HOST.id
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000
  const autoJoin = options.autoJoin ?? true

  let socket: WebSocketRoute | null = null
  let connections = 0
  let snapshot: RoomSnapshot | null = typeof options.snapshot === 'object' ? options.snapshot : null
  let roomId: string | null = null

  const joins: RoomJoinPayload[] = []
  const received: ClientEnvelope[] = []
  const consumed = new Set<number>()
  const waiters: PendingWaiter[] = []
  const connectionWaiters: Array<{ count: number; resolve: () => void }> = []

  function envelope(
    type: string,
    payload: Record<string, unknown>,
    extra?: { msgId?: string; roomId?: string },
  ) {
    const target = extra?.roomId ?? roomId
    return JSON.stringify({
      type,
      ts: Date.now(),
      payload,
      ...(target ? { roomId: target } : {}),
      ...(extra?.msgId ? { msgId: extra.msgId } : {}),
    })
  }

  function send(
    type: string,
    payload: Record<string, unknown>,
    extra?: { msgId?: string; roomId?: string },
  ) {
    if (!socket) throw new Error(`No open WebSocket to send ${type} on`)
    socket.send(envelope(type, payload, extra))
  }

  function settleWaiters(message: ClientEnvelope, index: number) {
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type)
    if (waiterIndex === -1) return
    const [waiter] = waiters.splice(waiterIndex, 1)
    if (!waiter) return
    clearTimeout(waiter.timer)
    consumed.add(index)
    waiter.resolve(message)
  }

  function resolveSnapshot(join: RoomJoinPayload): RoomSnapshot {
    if (typeof options.snapshot === 'function') return options.snapshot(join)
    if (snapshot) return snapshot
    return waitingSnapshot(
      [{ playerId: you, nickname: join.nickname, status: 'online' }],
      join.roomId,
    )
  }

  function handleClientMessage(raw: string) {
    let message: ClientEnvelope
    try {
      message = JSON.parse(raw) as ClientEnvelope
    } catch {
      return
    }

    const index = received.push(message) - 1

    if (message.type === 'sys.ping') {
      send('sys.pong', { serverTs: Date.now() })
    }

    if (message.type === 'room.join') {
      const join = message.payload as unknown as RoomJoinPayload
      joins.push(join)
      roomId = join.roomId
      if (autoJoin) {
        snapshot = resolveSnapshot(join)
        send('room.joined', {
          you,
          sessionToken: join.sessionToken,
          snapshot,
        })
      }
    }

    settleWaiters(message, index)
  }

  await page.routeWebSocket(/\/ws\/v1\/game/, (ws) => {
    socket = ws
    connections += 1

    ws.onMessage((raw) => {
      handleClientMessage(typeof raw === 'string' ? raw : raw.toString('utf8'))
    })

    ws.onClose(() => {
      if (socket === ws) socket = null
    })

    ws.send(
      envelope('sys.connected', {
        serverTs: Date.now(),
        protocolVersion: 1,
        heartbeatIntervalMs,
      }),
    )

    for (const waiter of connectionWaiters.splice(0)) {
      if (connections >= waiter.count) waiter.resolve()
      else connectionWaiters.push(waiter)
    }
  })

  function waitForClientMessage(type: string, waitOptions?: { timeoutMs?: number }) {
    const buffered = received.findIndex(
      (message, index) => message.type === type && !consumed.has(index),
    )
    if (buffered !== -1) {
      consumed.add(buffered)
      const message = received[buffered]
      if (message) return Promise.resolve(message)
    }

    return new Promise<ClientEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer)
        if (waiterIndex !== -1) waiters.splice(waiterIndex, 1)
        reject(new Error(`Timed out waiting for client message ${type}`))
      }, waitOptions?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
      waiters.push({ type, resolve, reject, timer })
    })
  }

  return {
    get connections() {
      return connections
    },
    get joins() {
      return joins
    },
    waitForConnection(count = 1) {
      if (connections >= count) return Promise.resolve()
      return new Promise<void>((resolve) => {
        connectionWaiters.push({ count, resolve })
      })
    },
    waitForClientMessage,
    clientMessages(type) {
      return type ? received.filter((message) => message.type === type) : [...received]
    },
    send,
    setSnapshot(next) {
      snapshot = next
      roomId = next.roomId
    },
    currentSnapshot() {
      return snapshot
    },
    syncSnapshot(next) {
      snapshot = next
      roomId = next.roomId
      send('state.sync', { snapshot: next })
    },
    async answerRoll(dice, rollOptions) {
      const message = await waitForClientMessage('game.yacht_dice.dice.roll')
      const payload = message.payload as {
        roundNumber: number
        rollCount: number
        held: HeldDice
      }
      send(
        'game.yacht_dice.dice.broadcast',
        {
          playerId: rollOptions?.playerId ?? you,
          roundNumber: payload.roundNumber,
          rollCount: payload.rollCount,
          dice,
          held: payload.held,
          ...(rollOptions?.auto ? { auto: true } : {}),
        },
        {
          ...(message.msgId ? { msgId: message.msgId } : {}),
          ...(message.roomId ? { roomId: message.roomId } : {}),
        },
      )
      return payload
    },
    async answerSubmit(scoreboard, submitOptions) {
      const message = await waitForClientMessage('game.yacht_dice.round.submit')
      const payload = message.payload as { roundNumber: number; category: string }
      const playerId = submitOptions?.playerId ?? you
      if (snapshot?.game) {
        snapshot = {
          ...snapshot,
          game: { ...snapshot.game, scores: { ...snapshot.game.scores, [playerId]: scoreboard } },
        }
      }
      send(
        'game.yacht_dice.score.update',
        { playerId, scoreboard },
        {
          ...(message.msgId ? { msgId: message.msgId } : {}),
          ...(message.roomId ? { roomId: message.roomId } : {}),
        },
      )
      return payload
    },
    closeConnection(closeOptions) {
      if (!socket) throw new Error('No open WebSocket to close')
      socket.close({
        code: closeOptions?.code ?? 1001,
        reason: closeOptions?.reason ?? 'server closed the connection',
      })
      socket = null
    },
  }
}
