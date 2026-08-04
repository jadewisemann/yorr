import type { Game } from '@/games'
import { Modal } from '@/shared/components/Modal'

interface PlayModeDialogProps {
  game: Game
  onClose: () => void
  /** 초대 링크로 친구를 부르는 기존 경로(닉네임 화면 → 방 생성). */
  onCreateRoom: () => void
  /** 빠른 대전. 비로그인 상태에서는 그리지 않고 `onSignIn`으로 보낸다. */
  onQuickMatch: () => void
  onSignIn: () => void
  open: boolean
  signedIn: boolean
}

/**
 * 플레이를 누르면 서는 모드 선택. 히어로 카드에 버튼을 하나 더 세우지 않는 이유는 둘이다 —
 * narrow에서 카드 하단 띠에 CTA 세 개가 들어가지 않고(그리고 카드 CTA는 두 상태의 높이가
 * 같아야 캐러셀이 흔들리지 않는다), 처음 온 사람에게 "빠른 대전"은 라벨만으로 읽히지 않아
 * 설명 한 줄이 붙을 자리가 필요하다.
 */
export function PlayModeDialog({
  game,
  onClose,
  onCreateRoom,
  onQuickMatch,
  onSignIn,
  open,
  signedIn,
}: PlayModeDialogProps) {
  return (
    <Modal className="max-w-md" onClose={onClose} open={open} title={`${game.name} 시작하기`}>
      <div className="grid gap-2.5">
        <ModeOption
          description="초대 링크를 보내 친구와 같이 해요"
          onClick={onCreateRoom}
          title="방 만들기"
        />
        <ModeOption
          description={
            signedIn
              ? '지금 기다리는 다른 사람과 바로 이어드려요'
              : '로그인하면 모르는 사람과 바로 겨룰 수 있어요'
          }
          onClick={signedIn ? onQuickMatch : onSignIn}
          tag={signedIn ? undefined : '로그인 필요'}
          title="온라인 대전"
        />
      </div>
    </Modal>
  )
}

function ModeOption({
  description,
  onClick,
  tag,
  title,
}: {
  description: string
  onClick: () => void
  tag?: string | undefined
  title: string
}) {
  return (
    <button
      className="grid w-full cursor-pointer gap-1 rounded-card border border-border bg-surface px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-surface-raised focus-ring"
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-2 text-[16px] font-bold text-content">
        {title}
        {tag && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-content-muted">
            {tag}
          </span>
        )}
      </span>
      <span className="text-[13px] text-content-muted">{description}</span>
    </button>
  )
}
