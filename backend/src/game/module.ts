import type { WebSocket } from 'ws'
import type { InboundEnvelope } from '../ws/envelope.js'

// backend-java의 com.ssafy.yorr.game.module.GameModule과 1:1 대응 —
// 마이그레이션 중에는 두 인터페이스의 모양을 함께 바꾸지 않는 한 임의로 넓히지 않는다.
export interface GameModule {
  readonly code: string
  readonly name: string
  readonly minPlayers: number
  readonly maxPlayers: number
  readonly supportsBots: boolean

  start(roomId: string): Promise<void>
  reset(roomId: string): Promise<void>
  resume(roomId: string): Promise<void>
  pause(roomId: string): Promise<void>
  removePlayer(roomId: string, playerId: string): Promise<void>
  close(roomId: string): Promise<void>
  hasState(roomId: string): Promise<boolean>
  // 반환 모양(RoomSnapshot)은 Phase 2에서 와이어 계약 타입과 함께 이식한다
  reconnect(roomId: string, playerId: string): Promise<unknown>

  handles(messageType: string): boolean
  handle(socket: WebSocket, message: InboundEnvelope): Promise<void>
}

export class GameModuleRegistry {
  private readonly modules = new Map<string, GameModule>()

  register(module: GameModule): void {
    if (this.modules.has(module.code)) {
      throw new Error(`이미 등록된 게임 모듈: ${module.code}`)
    }
    this.modules.set(module.code, module)
  }

  byCode(code: string): GameModule | undefined {
    return this.modules.get(code)
  }

  byMessageType(messageType: string): GameModule | undefined {
    for (const module of this.modules.values()) {
      if (module.handles(messageType)) return module
    }
    return undefined
  }

  all(): GameModule[] {
    return [...this.modules.values()]
  }
}
