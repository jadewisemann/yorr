import { useState } from 'react'
import { kakaoLoginUrl, renameProfile } from '@/api/authApi'
import type { AuthSession } from '@/authSession'
import { cn } from '@/cn'
import { NICKNAME_MAX_LENGTH } from '@/nickname'
import { useAppStore } from '@/store'
import { BottomSheet } from './BottomSheet'
import { LandingPopover } from './LandingPopover'

interface AccountDialogProps {
  layout: 'narrow' | 'wide'
  onClose: () => void
  onSignOut: () => void
  open: boolean
  session: AuthSession | null
}

/**
 * 계정 껍데기. 로그인 전에는 <b>로그인 수단 고르기</b>, 로그인 후에는 <b>내 계정 메뉴</b>다.
 * <p>
 * 헤더에 제공자 버튼(카카오)을 바로 두지 않는 이유가 둘 있다. 하나는 곧 구글이 붙기 때문에
 * 자리를 제공자 하나에 내줄 수 없어서고, 다른 하나는 어두운 랜딩 위에 브랜드 노란색을
 * 그대로 얹으면 화면에서 그것만 튀기 때문이다. 브랜드 색은 <b>고르는 자리 안에서만</b> 쓴다.
 */
export function AccountDialog({ layout, onClose, onSignOut, open, session }: AccountDialogProps) {
  const label = session ? '내 계정' : '로그인'
  const panel = session ? (
    <AccountMenu onSignOut={onSignOut} session={session} />
  ) : (
    <ProviderChoice />
  )

  if (layout === 'narrow') {
    return (
      <BottomSheet
        className="h-auto gap-4 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
        onClose={onClose}
        open={open}
        title={label}
      >
        {panel}
      </BottomSheet>
    )
  }

  return (
    <LandingPopover focusSelector="button" label={label} onClose={onClose} open={open}>
      <div className="grid gap-4">
        <h2 className="m-0 text-[17px]/none font-bold text-content">{label}</h2>
        {panel}
      </div>
    </LandingPopover>
  )
}

const row =
  'flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3.5 text-left text-[15px] font-semibold text-content transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2'
const activeRow = 'cursor-pointer hover:border-landing-hairline-strong hover:bg-surface-raised'
const lockedRow = 'cursor-not-allowed text-content-faint'

function ProviderChoice() {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-[13px]/[1.5] text-content-muted">
        로그인하면 전적과 프로필이 계정에 남아요. 로그인 없이도 바로 플레이할 수 있어요.
      </p>
      <button
        className={cn(row, activeRow)}
        // fetch가 아니라 전체 페이지 이동이어야 한다 — 서버가 카카오로 302를 보내고,
        // 사용자는 카카오 화면에서 직접 동의해야 한다.
        onClick={() => globalThis.location.assign(kakaoLoginUrl())}
        type="button"
      >
        <ProviderMark provider="kakao" />
        카카오로 계속하기
      </button>
      <button className={cn(row, lockedRow)} disabled type="button">
        <ProviderMark provider="google" />
        구글로 계속하기
        <ComingSoonPill />
      </button>
      {/*
        카카오 세션은 브라우저에 남아 있어, 우리 쪽에서 로그아웃해도 위 버튼은 동의 화면 없이
        바로 통과한다. 그게 보통은 편하지만 계정을 바꾸려는 사람에게는 길이 막힌 셈이라
        여기서만 재인증을 요청한다.
      */}
      <button
        className="min-h-tap cursor-pointer justify-self-center rounded-full border-0 bg-transparent px-3 py-1 text-[12.5px] font-semibold text-content-muted underline-offset-2 hover:text-content hover:underline focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
        onClick={() => globalThis.location.assign(kakaoLoginUrl({ forceLogin: true }))}
        type="button"
      >
        다른 계정으로 로그인
      </button>
    </div>
  )
}

function AccountMenu({ onSignOut, session }: { onSignOut: () => void; session: AuthSession }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="grid gap-2.5">
      {editing ? (
        <NicknameEditor onDone={() => setEditing(false)} session={session} />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3.5">
            <Avatar nickname={session.nickname} size="lg" />
            <span className="grid min-w-0 gap-0.5">
              <strong className="truncate text-[15px] font-bold text-content">
                {session.nickname}
              </strong>
              <span className="text-[12.5px] text-content-muted">로그인됨</span>
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

/**
 * 닉네임 인라인 편집. 별도 화면을 만들지 않은 이유는 지금 고칠 것이 이름 하나뿐이기
 * 때문이다 — 화면을 새로 파면 랜딩 디자인을 다시 맞춰야 하고, 그 값어치가 없다.
 */
function NicknameEditor({ onDone, session }: { onDone: () => void; session: AuthSession }) {
  const signIn = useAppStore((state) => state.signIn)
  const [value, setValue] = useState(session.nickname)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const nickname = value.trim()
    if (!nickname) {
      setError('닉네임을 입력해 주세요.')
      return
    }
    if (nickname === session.nickname) {
      onDone()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const profile = await renameProfile(session.sessionToken, nickname)
      // 서버가 다듬은 값을 그대로 받는다 — 클라이언트가 따로 계산하지 않는다.
      signIn({ ...session, nickname: profile.nickname })
      onDone()
    } catch {
      setError('이름을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="grid gap-2.5 rounded-[16px] bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="grid gap-1.5 text-[12.5px] font-semibold text-content-muted">
        닉네임
        <input
          className="rounded-[12px] border border-border bg-surface-raised px-3 py-2.5 text-[15px] font-semibold text-content focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-1"
          disabled={saving}
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          value={value}
        />
      </label>
      {/* 지난 판의 이름까지 바뀌는 것으로 오해하지 않게 미리 알린다. */}
      <p className="m-0 text-[12px] text-content-faint">지난 게임 기록에 남은 이름은 그대로예요.</p>
      {error && (
        <p className="m-0 text-[12.5px] font-semibold text-landing-accent-text" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          className={cn(row, activeRow, 'justify-center py-2.5')}
          disabled={saving}
          type="submit"
        >
          {saving ? '저장하는 중' : '저장'}
        </button>
        <button
          className={cn(row, activeRow, 'justify-center py-2.5')}
          disabled={saving}
          onClick={onDone}
          type="button"
        >
          취소
        </button>
      </div>
    </form>
  )
}

function ComingSoonPill() {
  return (
    <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-content-faint">
      준비 중
    </span>
  )
}

/** 닉네임 첫 글자를 딴 원형 아바타. 프로필 이미지가 붙기 전까지의 자리다. */
export function Avatar({ nickname, size }: { nickname: string; size: 'lg' | 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none items-center justify-center rounded-full bg-landing-accent-tint font-bold text-landing-accent-text',
        size === 'lg' ? 'size-9 text-[15px]' : 'size-6 text-[12px]',
      )}
    >
      {[...nickname][0] ?? '?'}
    </span>
  )
}

/**
 * 제공자 표시. 브랜드 색은 이 작은 칩 안에만 두어 어두운 화면에서 튀지 않게 한다.
 */
function ProviderMark({ provider }: { provider: 'google' | 'kakao' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 flex-none items-center justify-center rounded-[9px] text-[13px] font-bold',
        provider === 'kakao'
          ? 'bg-kakao text-kakao-ink'
          : 'border border-border text-content-faint',
      )}
    >
      {provider === 'kakao' ? (
        <span className="size-3 rounded-[50%_50%_50%_15%] border-[2px] border-current" />
      ) : (
        'G'
      )}
    </span>
  )
}
