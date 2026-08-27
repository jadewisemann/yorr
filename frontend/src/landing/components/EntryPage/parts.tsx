import { useNavigate } from '@tanstack/react-router'
import type { RefObject } from 'react'
import type { AuthSession } from '@/auth/authSession'
import { Avatar } from '@/auth/components/AccountDialog/AccountMenu'
import { useLeaveSession } from '@/room/api/useRoomApi'
import { sessionScreenOf } from '@/room/domain/sessionFsm'
import { cn } from '@/shared/cn'
import { IconMoon, IconSound, IconSun } from '@/shared/components/Icon'
import { selectSessionPhase, useAppStore } from '@/store'

const codeEntry =
  'flex min-h-tap shrink-0 cursor-pointer items-center gap-2 rounded-full border-0 bg-landing-accent pr-3 pl-4 text-sm font-landing-bold text-landing-accent-ink outline-focus transition-colors duration-150 ease-out hover:bg-landing-accent/90 focus-visible:outline-3 focus-visible:outline-offset-2 pressable'

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
      <InputGlyph />
    </button>
  )
}

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

const roundIconButton =
  'grid size-tap flex-none cursor-pointer place-items-center rounded-full border border-landing-hairline-strong bg-landing-well text-landing-text-muted transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable'

export function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      aria-label={muted ? '소리 켜기' : '소리 끄기'}
      aria-pressed={!muted}
      className={roundIconButton}
      onClick={onToggle}
      type="button"
    >
      <IconSound className="size-4.5" muted={muted} />
    </button>
  )
}

/*
 * 화면 테마 토글. 계정 다이얼로그 안이 아니라 **랜딩 헤더**에 있는 이유 — 테마는 계정이
 * 아니라 기기 설정이라(localStorage 영속) 로그인 여부와 무관하고, 모달을 열어야 닿는
 * 자리에 두면 첫 화면이 눈부실 때 그것을 고칠 방법이 보이지 않는다.
 *
 * 라이트/다크 두 값만 오간다. 누르는 순간 사용자가 명시적으로 고른 것이므로 `system`으로는
 * 돌아가지 않는다 — 한 버튼으로 세 값을 돌리면 다음 상태를 예측할 수 없다.
 */
export function ThemeToggle() {
  const resolvedTheme = useAppStore((state) => state.resolvedTheme)
  const setThemePreference = useAppStore((state) => state.setThemePreference)
  const light = resolvedTheme === 'light'

  return (
    <button
      aria-label={light ? '다크 모드로 바꾸기' : '라이트 모드로 바꾸기'}
      className={roundIconButton}
      onClick={() => setThemePreference(light ? 'dark' : 'light')}
      type="button"
    >
      {light ? <IconSun className="size-4.5" /> : <IconMoon className="size-4.5" />}
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
      aria-label={session ? `내 계정, ${session.nickname}` : undefined}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        'flex max-w-44 min-h-tap cursor-pointer items-center rounded-full border font-semibold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
        open
          ? 'border-landing-accent/60 bg-landing-accent-tint text-landing-accent-text'
          : 'border-landing-hairline-strong bg-landing-well text-landing-text hover:border-landing-accent/70',
        session
          ? 'size-tap justify-center px-0'
          : wide
            ? 'gap-2 px-5 text-sm'
            : 'gap-2 px-3.5 text-xs',
      )}
      onClick={onOpen}
      type="button"
    >
      {session ? <Avatar nickname={session.nickname} size="lg" /> : '로그인'}
    </button>
  )
}

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
          className="min-h-tap cursor-pointer rounded-card border-0 bg-landing-accent px-4 py-2.5 text-sm font-landing-bold text-landing-accent-ink focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 pressable"
          onClick={handleReturn}
          type="button"
        >
          {needsResume ? returnLabel : '돌아가기'}
        </button>
        <button
          className="min-h-tap cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-2 text-xs font-landing-bold text-landing-text-muted underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:opacity-60 pressable"
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
