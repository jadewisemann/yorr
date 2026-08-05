import type { Game } from '@/games'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'

interface PlayModeDialogProps {
  game: Game
  onClose: () => void
  /** 탁구 전용 — 서버 없이 바로 붙는 로컬 AI 대전. */
  onAiMatch: () => void
  /** 초대 링크로 친구를 부르는 기존 경로(닉네임 화면 → 방 생성). */
  onCreateRoom: () => void
  /** 파티 모드 대시보드. 백엔드 모듈(gameCode)이 있는 게임만 열 수 있다. */
  onPartyMode: () => void
  /** 빠른 대전. 비로그인 상태에서는 로그인 화면으로 보낸다. */
  onQuickMatch: () => void
  onSignIn: () => void
  /** 연습 모드(야추 전용). 방을 만들지 않고 바로 들어간다. */
  onTutorial: () => void
  open: boolean
  signedIn: boolean
}

/** 플레이 뒤의 모드 선택. 기본 경로 하나를 크게 두고 나머지는 얇은 목록으로 내린 1A안. */
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
      <p className="-mt-2 mb-5 text-[13px] text-content-muted">
        {game.players} · {game.duration} · {game.control}
      </p>

      <section className="rounded-[1rem] border border-brand/30 bg-brand/8 p-5">
        <div className="mb-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[17px] font-bold text-content">방 만들기</h3>
            <span className="rounded-full border border-brand/40 px-2 py-0.5 text-[10.5px] font-bold tracking-[0.08em] text-brand">
              추천
            </span>
          </div>
          <p className="m-0 text-[13.5px]/[1.55] text-content-muted">
            초대 링크를 보내면 친구가 로그인 없이 바로 들어와요.
          </p>
        </div>
        <Button className="w-full rounded-full" onClick={onCreateRoom} size="lg">
          방 만들기
        </Button>
      </section>

      <div className="mt-5">
        <p className="mb-1 px-1 text-[11px] font-semibold tracking-[0.14em] text-content-muted">
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

function ModeRow({
  description,
  icon,
  onClick,
  tag,
  title,
}: {
  description: string
  icon: ModeIconKind
  onClick: () => void
  tag?: string | undefined
  title: string
}) {
  return (
    <button
      className="group flex min-h-16 w-full cursor-pointer items-center gap-3 border-0 border-b border-border bg-transparent px-3 py-3 text-left transition-colors duration-150 ease-out last:border-b-0 hover:bg-white/4 focus-ring"
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center text-content-muted"
      >
        <ModeIcon kind={icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14.5px] font-semibold text-content">{title}</span>
        <span className="text-[12.5px] text-content-muted">{description}</span>
      </span>
      {tag && (
        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-content-muted">
          {tag}
        </span>
      )}
      <span
        aria-hidden="true"
        className="text-lg text-content-muted transition-transform group-hover:translate-x-0.5"
      >
        ›
      </span>
    </button>
  )
}

type ModeIconKind = 'ai' | 'party' | 'quick' | 'tutorial'

function ModeIcon({ kind }: { kind: ModeIconKind }) {
  if (kind === 'quick') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'party') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'tutorial') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg
      aria-hidden="true"
      className="size-[18px]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.7-3 2.5-4.5 5.5-4.5S13.8 16 14.5 19M17 6v6m-3-3h6" strokeLinecap="round" />
    </svg>
  )
}
