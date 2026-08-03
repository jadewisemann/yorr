import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { exchangeLoginCode, loginErrorMessage } from '@/auth/api/authApi'
import { useAppStore } from '@/store'

/**
 * 소셜 로그인이 끝난 사용자가 서버에서 되돌아오는 자리.
 *
 * 여기서 하는 일은 <b>일회용 코드를 세션으로 바꾸고 홈으로 보내는 것</b>뿐이다. 화면을
 * 오래 보여줄 이유가 없어 안내 한 줄만 두고, 성공·실패 결과는 홈의 알림 자리로 넘긴다.
 */
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
  // 코드는 1회용이다. StrictMode의 이펙트 두 번 실행이 두 번째 교환을 실패로 만들면
  // 방금 성공한 로그인이 실패로 덮인다.
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
      .then((session) => {
        signIn(session)
        setAppNotice(`${session.nickname}님, 반가워요!`)
      })
      .catch(() => {
        // 코드가 만료됐거나 이미 쓰였다. 사유를 더 좁힐 수 없으므로 다시 시도하도록 안내한다.
        setAppNotice('로그인을 마무리하지 못했어요. 다시 시도해 주세요.')
      })
      .finally(() => {
        void goHome()
      })
  }, [code, error, navigate, setAppNotice, signIn])

  return (
    <main className="flex h-svh w-full items-center justify-center [background:var(--ds-landing-bg)]">
      <p className="m-0 text-[15px] font-semibold text-landing-text-muted" role="status">
        로그인하는 중이에요…
      </p>
    </main>
  )
}
