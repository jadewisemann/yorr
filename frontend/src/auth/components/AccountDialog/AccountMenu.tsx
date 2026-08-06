import { useState } from 'react'
import type { AuthSession } from '@/auth/authSession'
import { cn } from '@/shared/cn'
import { NicknameEditor } from './NicknameEditor'
import { ComingSoonPill } from './ProviderChoice'
import { activeRow, lockedRow, row } from './rowStyles'

/**
 * 계정 껍데기. 로그인 전에는 <b>로그인 수단 고르기</b>, 로그인 후에는 <b>내 계정 메뉴</b>다.
 * <p>
 * 헤더에 제공자 버튼(카카오)을 바로 두지 않는 이유가 둘 있다. 하나는 곧 구글이 붙기 때문에
 * 자리를 제공자 하나에 내줄 수 없어서고, 다른 하나는 어두운 랜딩 위에 브랜드 노란색을
 * 그대로 얹으면 화면에서 그것만 튀기 때문이다. 브랜드 색은 <b>고르는 자리 안에서만</b> 쓴다.
 */
/** 닉네임 첫 글자를 딴 원형 아바타. 프로필 이미지가 붙기 전까지의 자리다. */
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
    <div className="grid gap-2.5">
      {editing ? (
        <NicknameEditor onDone={() => setEditing(false)} session={session} />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-card bg-surface px-4 py-3.5">
            <Avatar nickname={session.nickname} size="lg" />
            <span className="grid min-w-0 gap-0.5">
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
      {/* 전적 화면이 붙을 자리. 지금은 무엇이 올지 보이는 것만으로 충분하다. */}
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
