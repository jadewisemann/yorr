import { useEffect, useRef } from 'react'
import { verifySession } from '@/auth/api/authApi'
import { useAppStore } from '@/store'

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
        if (nickname !== authSession.nickname) signIn({ ...authSession, nickname })
      })
      .catch(() => {})
  }, [])
}
