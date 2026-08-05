import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useLeaveSession } from '@/room/api/useRoomApi'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { useAppStore } from '@/store'

interface RoomExitGuardProps {
  roomId: string
  /** 화면의 명시적 '나가기' 버튼이 확인 모달을 열 때 true. */
  open?: boolean
  onClose?: () => void
}

/**
 * 방 화면(대기실·게임) 이탈 가드. (S15P11A406-101 · FSM의 leave 전이 입구)
 *
 * 브라우저 뒤로가기 등으로 방 밖 URL로 나가려는 순간을 가로채 확인을 받고,
 * 확인하면 퇴장 처리(세션 정리) 후 원래 가려던 곳으로 보낸다. 같은 방 안의
 * 화면 전환(대기실 ⇄ 게임)과 세션이 이미 없는 상태의 이동은 막지 않는다.
 */
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
    // 뒤로가기를 막은 경우엔 원래 가려던 히스토리 위치로 마저 보낸다.
    if (blocked) blocker.proceed()
    else void navigate({ to: '/', replace: true })
  }

  return (
    <Modal onClose={stay} open={blocked || open} role="alertdialog" title="방에서 나갈까요?">
      <div className="grid gap-5">
        <p className="m-0 text-sm text-content-muted">
          나가면 이 방의 진행 상황에서 빠지고, 다시 들어오려면 초대 코드가 필요해요.
        </p>
        {/* 디자인 22 — 안전한 선택(머무르기)이 위, 파괴적 동작은 레드 틴트 아웃라인. */}
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
