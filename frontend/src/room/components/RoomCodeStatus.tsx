import { connectionLabel } from '@/room/domain/lobbyLabels'
import { cn } from '@/shared/cn'
import type { useAppStore } from '@/store'

interface RoomCodeStatusProps {
  connectionStatus: ReturnType<typeof useAppStore.getState>['connectionStatus']
  roomCode: string
}

/** 방 머리 띠의 둘째 줄 — 방 코드와 실시간 연결 상태. 대기실과 파티 대시보드가 같이 쓴다. */
export function RoomCodeStatus({ connectionStatus, roomCode }: RoomCodeStatusProps) {
  return (
    <p className="m-0 flex items-center gap-2 text-xs text-content-muted">
      <span className="font-mono font-bold tracking-[0.12em] text-content">{roomCode}</span>
      <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
      <span className="inline-flex items-center gap-1.5" role="status">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            connectionStatus === 'connected' ? 'bg-positive' : 'bg-warning',
          )}
        />
        {connectionLabel(connectionStatus)}
      </span>
    </p>
  )
}
