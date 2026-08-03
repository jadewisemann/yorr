import { useEffect, useRef } from 'react'
import { verifySession } from '@/auth/api/authApi'
import { useAppStore } from '@/store'

/**
 * 앱이 뜰 때 저장된 로그인 세션이 서버에서도 살아 있는지 한 번 확인한다.
 * <p>
 * 로그인 상태는 로컬에 저장해 두고 복원하는데, 그 사이 서버 세션이 사라졌을 수 있다
 * (만료 · 다른 기기에서 로그아웃 · 서버 데이터 초기화). 그러면 <b>화면은 로그인인데 요청은
 * 401</b>인 상태가 되고, 사용자는 무엇이 잘못됐는지 알 방법이 없다.
 * <p>
 * 죽었으면 <b>조용히</b> 정리한다 — 사용자가 한 일이 없으므로 "로그아웃되었습니다" 같은
 * 안내는 오히려 놀라움을 만든다. 서버가 잠깐 안 뜬 경우(401이 아닌 실패)는 건드리지 않는다.
 */
export function useAuthSessionCheck() {
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current) return
    checked.current = true

    const { authSession, signIn, signOut } = useAppStore.getState()
    if (!authSession) return

    void verifySession(authSession.sessionToken)
      .then((nickname) => {
        if (nickname === null) {
          signOut()
          return
        }
        // 서버가 아는 닉네임이 최신이다(프로필을 다른 기기에서 바꿨을 수 있다).
        if (nickname !== authSession.nickname) signIn({ ...authSession, nickname })
      })
      .catch(() => {
        // 네트워크·서버 문제까지 로그아웃으로 취급하면 흔들릴 때마다 사용자가 튕긴다.
      })
  }, [])
}
