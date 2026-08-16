import { useState } from 'react'
import type { AuthSession } from '@/auth/authSession'
import { cn } from '@/shared/cn'
import { NicknameEditor } from './NicknameEditor'
import { ComingSoonPill } from './ProviderChoice'
import { activeRow, lockedRow, row } from './rowStyles'

export function Avatar({ nickname, size }: { nickname: string; size: 'lg' | 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none items-center justify-center rounded-full bg-landing-accent-tint font-bold text-landing-accent-text',
        size === 'lg' ? 'size-9 text-sm' : 'size-6 text-xs',
      )}
    >
      {[...nickname][0] ?? '?'}
    </span>
  )
}

export function AccountMenu({
  onSignOut,
  session,
}: {
  onSignOut: () => void
  session: AuthSession
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="grid gap-2">
      {editing ? (
        <NicknameEditor onDone={() => setEditing(false)} session={session} />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-card bg-surface px-4 py-3.5">
            <Avatar nickname={session.nickname} size="lg" />
            <span className="grid min-w-0 gap-1">
              <strong className="truncate text-sm font-bold text-content">
                {session.nickname}
              </strong>
              <span className="text-xs text-content-muted">로그인됨</span>
            </span>
          </div>
          <button className={cn(row, activeRow)} onClick={() => setEditing(true)} type="button">
            프로필 관리
          </button>
        </>
      )}
      <button className={cn(row, lockedRow)} disabled type="button">
        내 전적
        <ComingSoonPill />
      </button>
      <button className={cn(row, activeRow)} onClick={onSignOut} type="button">
        로그아웃
      </button>
    </div>
  )
}
