import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useLeaveSession } from '@/room/api/useRoomApi'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useAppStore } from '@/store'

interface RoomExitGuardProps {
  roomId: string
  open?: boolean
  onClose?: () => void
}

export function RoomExitGuard({ onClose, open = false, roomId }: RoomExitGuardProps) {
  const navigate = useNavigate()
  const { isLeaving, leave } = useLeaveSession()

  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => {
      const session = useAppStore.getState().roomSession
      if (!session || session.roomId !== roomId) return false
      return !next.pathname.startsWith(`/rooms/${roomId}/`)
    },
    enableBeforeUnload: false,
    withResolver: true,
  })

  const blocked = blocker.status === 'blocked'

  const stay = () => {
    if (blocked) blocker.reset()
    onClose?.()
  }

  const confirmLeave = async () => {
    await leave()
    onClose?.()
    if (blocked) blocker.proceed()
    else void navigate({ to: '/', replace: true })
  }

  return (
    <Modal onClose={stay} open={blocked || open} role="alertdialog" title="방에서 나갈까요?">
      <div className="grid gap-5">
        <p className="m-0 text-sm text-content-muted">
          나가면 이 방의 진행 상황에서 빠지고, 다시 들어오려면 초대 코드가 필요해요.
        </p>
        <div className="grid gap-2.5">
          <Button onClick={stay} type="button" variant="secondary">
            머무르기
          </Button>
          <Button loading={isLeaving} onClick={confirmLeave} type="button" variant="danger">
            나가기
          </Button>
        </div>
      </div>
    </Modal>
  )
}
