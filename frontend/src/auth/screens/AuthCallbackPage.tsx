import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { exchangeLoginCode, loginErrorMessage } from '@/auth/api/authApi'
import { useAppStore } from '@/store'

export function AuthCallbackPage({
  code,
  error,
}: {
  code: string | undefined
  error: string | undefined
}) {
  const navigate = useNavigate()
  const signIn = useAppStore((state) => state.signIn)
  const setAppNotice = useAppStore((state) => state.setAppNotice)
  const exchanged = useRef(false)

  useEffect(() => {
    if (exchanged.current) return
    exchanged.current = true

    const goHome = () => navigate({ to: '/', replace: true })

    if (error || !code) {
      setAppNotice(loginErrorMessage(error))
      void goHome()
      return
    }

    void exchangeLoginCode(code)
      .then(signIn)
      .catch(() => {
        setAppNotice('로그인을 마무리하지 못했어요. 다시 시도해 주세요.')
      })
      .finally(() => {
        void goHome()
      })
  }, [code, error, navigate, setAppNotice, signIn])

  return (
    <main className="flex h-svh w-full items-center justify-center [background:var(--ds-landing-bg)]">
      <p className="m-0 text-sm font-semibold text-landing-text-muted" role="status">
        로그인하는 중이에요…
      </p>
    </main>
  )
}
