import { useNavigate } from '@tanstack/react-router'
import type { RefObject } from 'react'
import type { AuthSession } from '@/auth/authSession'
import { Avatar } from '@/auth/components/AccountDialog/AccountMenu'
import { useLeaveSession } from '@/room/api/useRoomApi'
import { sessionScreenOf } from '@/room/domain/sessionFsm'
import { cn } from '@/shared/cn'
import { IconSound } from '@/shared/components/Icon'
import { selectSessionPhase, useAppStore } from '@/store'

const codeEntry =
  'flex min-h-tap shrink-0 cursor-pointer items-center gap-2 rounded-full border-0 bg-landing-accent pr-3 pl-4 text-sm font-landing-bold text-landing-accent-ink outline-white transition-colors duration-150 ease-out hover:bg-landing-accent/90 focus-visible:outline-3 focus-visible:outline-offset-2'

export function CodeEntryRow({
  anchorRef,
  onOpen,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>
  onOpen: () => void
}) {
  return (
    <button
      ref={anchorRef}
      aria-label="초대 코드로 참가"
      className={codeEntry}
      onClick={onOpen}
      type="button"
    >
      초대 코드
      {/* 글자 뒤에 입력 필드를 줄여 그린다 — 코드 칸 세 개를 그린 아이콘은 "무엇을
          누르는가"를 말하지 못했다. 커서가 깜빡이는 빈 칸은 "여기에 쳐 넣는다"로 읽힌다. */}
      <InputGlyph />
    </button>
  )
}

/** 커서가 선 입력 칸. 누르면 코드를 타이핑하는 화면이 뜬다는 예고다. */
export function InputGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-7 flex-none items-center justify-center rounded-chip border border-current/45 bg-current/12"
    >
      <span className="h-3 w-px bg-current motion-safe:animate-caret-blink" />
    </span>
  )
}

/**
 * 랜딩 BGM 음소거. 게임 화면 헤더의 소리 버튼과 같은 저장 설정(soundPreference)을 쓴다 —
 * 조용한 곳에서 한 번 끈 사람은 방을 옮겨도 계속 조용해야 한다.
 */
export function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      aria-label={muted ? '소리 켜기' : '소리 끄기'}
      aria-pressed={!muted}
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-full border border-landing-hairline-strong bg-landing-well text-landing-text-muted transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
      onClick={onToggle}
      type="button"
    >
      <IconSound className="size-4.5" muted={muted} />
    </button>
  )
}

export function AccountControl({
  layout,
  onOpen,
  open,
  session,
}: {
  layout: 'narrow' | 'wide'
  onOpen: () => void
  open: boolean
  session: AuthSession | null
}) {
  const wide = layout === 'wide'

  return (
    <button
      // 로그인 상태에서는 닉네임을 그리지 않으므로 버튼에 보이는 글자가 없다 —
      // 누구의 계정인지는 접근 가능한 이름이 대신 말한다.
      aria-label={session ? `내 계정, ${session.nickname}` : undefined}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        'flex max-w-44 min-h-tap cursor-pointer items-center rounded-full border font-semibold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        open
          ? 'border-landing-accent/60 bg-landing-accent-tint text-landing-accent-text'
          : 'border-landing-hairline-strong bg-landing-well text-landing-text hover:border-landing-accent/70',
        // 아바타 하나뿐이면 가로 여백이 필요 없다 — 탭 타깃 크기의 원형으로 세운다.
        session
          ? 'size-tap justify-center px-0'
          : wide
            ? 'gap-2.5 px-5 text-sm'
            : 'gap-2 px-3.5 text-xs',
      )}
      onClick={onOpen}
      type="button"
    >
      {session ? <Avatar nickname={session.nickname} size="lg" /> : '로그인'}
    </button>
  )
}

/**
 * 참여 중인 방이 있을 때만 뜨는 복귀 배너. (S15P11A406-101)
 * 예전처럼 홈에서 방으로 강제 리다이렉트하면 세션이 있는 한 홈으로 돌아올 수도,
 * 세션을 정리할 수도 없다 — 돌아갈지 나갈지는 사용자가 고른다.
 */
export function ActiveRoomBanner() {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const resumeRoomSession = useAppStore((state) => state.resumeRoomSession)
  const sessionPhase = useAppStore(selectSessionPhase)
  const { isLeaving, leave } = useLeaveSession()

  if (!roomSession) return null

  const handleReturn = () => {
    resumeRoomSession()
    void navigate({
      to: sessionScreenOf(sessionPhase) === 'game' ? '/rooms/$roomId/game' : '/rooms/$roomId/lobby',
      params: { roomId: roomSession.roomId },
    })
  }

  const needsResume = roomResumeReason !== null
  const returnLabel = roomResumeReason === 'disconnected' ? '다시 연결' : '이어서 하기'

  return (
    <section
      aria-label="진행 중인 방"
      className={cn(
        'flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-panel border px-4 py-3 shadow-landing-panel',
        needsResume
          ? 'border-landing-accent/45 bg-landing-accent-tint'
          : 'border-transparent bg-landing-well',
      )}
    >
      <p className="m-0 flex min-w-0 items-center gap-3 text-xs/[1.4] font-landing-medium text-landing-text-strong">
        {needsResume && (
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full bg-landing-accent-text shadow-[0_0_12px_currentColor] motion-safe:animate-ring-pulse"
          />
        )}
        <span className="min-w-0">
          <strong className="block font-landing-bold">
            {needsResume ? '진행 중인 게임이 있어요' : `${roomSession.roomCode} 방에 참여 중이에요`}
          </strong>
          {needsResume && (
            <span className="text-landing-text-muted">
              {roomSession.roomCode} · {roomSession.nickname}
            </span>
          )}
        </span>
      </p>
      <div className="flex flex-none items-center gap-2">
        <button
          className="min-h-tap cursor-pointer rounded-card border-0 bg-landing-accent px-4 py-2.5 text-sm font-landing-bold text-landing-accent-ink focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
          onClick={handleReturn}
          type="button"
        >
          {needsResume ? returnLabel : '돌아가기'}
        </button>
        <button
          className="min-h-tap cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-2 text-xs font-landing-bold text-landing-text-muted underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2 disabled:opacity-60"
          disabled={isLeaving}
          onClick={() => void leave()}
          type="button"
        >
          나가기
        </button>
      </div>
    </section>
  )
}
