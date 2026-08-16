import { useState } from 'react'
import { renameProfile } from '@/auth/api/authApi'
import type { AuthSession } from '@/auth/authSession'
import { getNicknameError, NICKNAME_MAX_LENGTH, normalizeNickname } from '@/auth/nickname'
import { cn } from '@/shared/cn'
import { useAppStore } from '@/store'
import { activeRow, row } from './rowStyles'

export function NicknameEditor({ onDone, session }: { onDone: () => void; session: AuthSession }) {
  const signIn = useAppStore((state) => state.signIn)
  const [value, setValue] = useState(session.nickname)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const nickname = normalizeNickname(value)
    const validationError = getNicknameError(nickname)
    if (validationError) {
      setError(validationError)
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
      className="grid gap-2 rounded-card bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="grid gap-1.5 text-xs font-semibold text-content-muted">
        닉네임
        <input
          className="rounded-control border border-border bg-surface-raised px-3 py-2.5 text-sm font-semibold text-content focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-1"
          disabled={saving}
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          value={value}
        />
      </label>
      <p className="m-0 text-xs text-content-faint">지난 게임 기록에 남은 이름은 그대로예요.</p>
      {error && (
        <p className="m-0 text-xs font-semibold text-landing-accent-text" role="alert">
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
