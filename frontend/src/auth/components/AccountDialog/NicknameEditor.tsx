import { useState } from 'react'
import { renameProfile } from '@/auth/api/authApi'
import type { AuthSession } from '@/auth/authSession'
import { getNicknameError, NICKNAME_MAX_LENGTH, normalizeNickname } from '@/auth/nickname'
import { cn } from '@/shared/cn'
import { useAppStore } from '@/store'
import { activeRow, row } from './rowStyles'

/**
 * 계정 껍데기. 로그인 전에는 <b>로그인 수단 고르기</b>, 로그인 후에는 <b>내 계정 메뉴</b>다.
 * <p>
 * 헤더에 제공자 버튼(카카오)을 바로 두지 않는 이유가 둘 있다. 하나는 곧 구글이 붙기 때문에
 * 자리를 제공자 하나에 내줄 수 없어서고, 다른 하나는 어두운 랜딩 위에 브랜드 노란색을
 * 그대로 얹으면 화면에서 그것만 튀기 때문이다. 브랜드 색은 <b>고르는 자리 안에서만</b> 쓴다.
 */
/**
 * 닉네임 인라인 편집. 별도 화면을 만들지 않은 이유는 지금 고칠 것이 이름 하나뿐이기
 * 때문이다 — 화면을 새로 파면 랜딩 디자인을 다시 맞춰야 하고, 그 값어치가 없다.
 *
 * 검증은 `getNicknameError`(길이·허용문자·욕설)를 그대로 쓴다. 예전에는 여기서만
 * `trim()`이 비었는지 보고 통과시켜, 방 입장 경로에서 막히는 이름이 프로필로는 그대로
 * 들어갔다(S15P11A406-182).
 */
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
      className="grid gap-2.5 rounded-card bg-surface px-4 py-3.5"
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
      {/* 지난 판의 이름까지 바뀌는 것으로 오해하지 않게 미리 알린다. */}
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
