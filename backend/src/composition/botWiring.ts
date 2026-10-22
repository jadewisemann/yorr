import type { FastifyInstance } from 'fastify'
import type { GameCompletionService } from '../game/completion/index.js'
import type { RoundSynchronizationService } from '../game/round/index.js'
import type { ScoreConfirmationService } from '../game/score/index.js'
import {
  BotTurnOrchestrator,
  CooperativeYachtBotPolicy,
  ExpectimaxYachtBotPolicy,
  LocalYachtBotStrategy,
  logPolicyFallback,
  ScorecardValueEvaluator,
  type YachtBotPolicy,
  YachtBotTurnCoordinator,
  type YachtTurnActionService,
} from '../game/yacht/index.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomBroadcaster } from '../ws/broadcaster.js'

export interface BotWiringDeps {
  readonly app: FastifyInstance
  readonly broadcaster: RoomBroadcaster
  readonly completion: GameCompletionService
  readonly rooms: RoomService
  readonly roundSync: RoundSynchronizationService
  readonly scores: ScoreConfirmationService
  readonly yachtActions: YachtTurnActionService
}

export interface BotWiring {
  readonly botPolicy: YachtBotPolicy
  /** 라운드 타이머의 `onRoundStarted`가 부른다(늦은 바인딩). */
  readonly orchestrator: BotTurnOrchestrator
}

/**
 * 야추 봇(3.2)의 조립.
 *
 * 탐색은 프로세스 전체에서 하나씩, 사이마다 이벤트 루프에 양보한다 — 여러 방의 봇 턴이
 * 겹쳐도 다른 방의 메시지가 탐색 N개를 기다리지 않는다(cooperativeBotPolicy.ts).
 * 봇과 사람이 **같은** 행동 서비스를 지나야 방송·검증 경로가 갈라지지 않는다.
 */
export function assembleBotWiring({
  app,
  broadcaster,
  rooms,
  roundSync,
  scores,
  yachtActions,
}: BotWiringDeps): BotWiring {
  const botPolicy = new CooperativeYachtBotPolicy(
    new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator()),
  )
  const orchestrator = new BotTurnOrchestrator(
    {
      coordinator: new YachtBotTurnCoordinator(
        {
          rounds: roundSync,
          actions: yachtActions,
          policy: botPolicy,
          strategy: new LocalYachtBotStrategy(),
          rooms,
          scores,
        },
        {
          onPolicyFallback: (roomId, state, error) =>
            logPolicyFallback(
              app.log,
              { roomId, round: state.roundNumber, player: state.activePlayerId },
              error,
            ),
        },
      ),
      broadcaster,
    },
    {
      onError: (error, event) =>
        app.log.warn(
          { error, roomId: event.roomId, round: event.state.roundNumber },
          'AI 봇 행동 실패 — 라운드 타이머 폴백으로 진행',
        ),
    },
  )
  return { botPolicy, orchestrator }
}
