import type { Game } from '@/games'
import { ModeRow } from '@/landing/components/PlayModeDialog/ModeRow'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'

interface PlayModeDialogProps {
  game: Game
  onClose: () => void
  onAiMatch: () => void
  onCreateRoom: () => void
  onPartyMode: () => void
  onQuickMatch: () => void
  onSignIn: () => void
  onTutorial: () => void
  open: boolean
  signedIn: boolean
}

export function PlayModeDialog({
  game,
  onClose,
  onAiMatch,
  onCreateRoom,
  onPartyMode,
  onQuickMatch,
  onSignIn,
  onTutorial,
  open,
  signedIn,
}: PlayModeDialogProps) {
  return (
    <Modal
      className="max-w-[41.25rem]"
      onClose={onClose}
      open={open}
      title={`${game.name} 시작하기`}
    >
      <p className="-mt-2 mb-5 text-xs text-content-muted">
        {game.players} · {game.duration} · {game.control}
      </p>

      <section className="rounded-card border border-brand/30 bg-brand/8 p-5">
        <div className="mb-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-base font-bold text-content">방 만들기</h3>
            <span className="rounded-full border border-brand/40 px-2 py-0.5 text-2xs font-bold tracking-[0.08em] text-brand">
              추천
            </span>
          </div>
          <p className="m-0 text-xs/[1.55] text-content-muted">
            초대 링크를 보내면 친구가 로그인 없이 바로 들어와요.
          </p>
        </div>
        <Button className="w-full rounded-full" onClick={onCreateRoom} size="lg">
          방 만들기
        </Button>
      </section>

      <div className="mt-5">
        <p className="mb-1 px-1 text-2xs font-semibold tracking-[0.14em] text-content-muted">
          다른 방식으로 시작
        </p>
        <ModeRow
          description="모르는 사람과 바로 매칭"
          icon="quick"
          onClick={signedIn ? onQuickMatch : onSignIn}
          tag={signedIn ? undefined : '로그인 필요'}
          title="온라인 대전"
        />
        {game.key === 'pingpong' && (
          <ModeRow
            description="기다릴 것 없이 바로 경기"
            icon="ai"
            onClick={onAiMatch}
            title="AI와 대전"
          />
        )}
        {game.key !== 'pingpong' && game.gameCode !== undefined && (
          <ModeRow
            description="이 화면이 게임판, 각자 폰이 컨트롤러"
            icon="party"
            onClick={onPartyMode}
            title="파티 모드"
          />
        )}
        {game.key === 'yacht' && (
          <ModeRow
            description="혼자 굴려보며 규칙 익히기 · 2분"
            icon="tutorial"
            onClick={onTutorial}
            title="튜토리얼"
          />
        )}
      </div>
    </Modal>
  )
}
