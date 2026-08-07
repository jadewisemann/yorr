import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  cancelQuickMatch,
  enterQuickMatch,
  getQuickMatch,
  QUICK_MATCH_POLL_INTERVAL_MS,
  type QuickMatch,
  type QuickMatchStatus,
} from '@/room/api/quickMatchApi'
import { toUserError } from '@/shared/api/userError'
import { Button } from '@/shared/components/Button'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useAppStore } from '@/store'

export function QuickMatchOverlay() {
  const navigate = useNavigate()
  const request = useAppStore((state) => state.quickMatch)
  const authSession = useAppStore((state) => state.authSession)
  const [status, setStatus] = useState<QuickMatchStatus>('NOT_QUEUED')
  const [error, setError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)

  useEffect(() => {
    if (!request) return
    setStatus('NOT_QUEUED')
    setError(null)
    if (!authSession) {
      setError('빠른 대전은 로그인이 필요해요.')
      return
    }

    const controller = new AbortController()
    const options = {
      signal: controller.signal,
      sessionToken: authSession.sessionToken,
      userId: authSession.userId,
    }
    let timer: number | undefined
    let roomSessionCreated = false

    const apply = (result: QuickMatch) => {
      setStatus(result.status)

      if (result.status === 'MATCHED' && result.roomId && !roomSessionCreated) {
        roomSessionCreated = true
        useAppStore.getState().setRoomSession({
          ...(result.gameCode ? { gameCode: result.gameCode } : {}),
          gameId: null,
          roomId: result.roomId,
          roomCode: result.roomId,
          you: authSession.userId,
          nickname: request.nickname,
          membershipRole: 'participant',
          sessionToken: authSession.sessionToken,
          snapshot: null,
        })
        void navigate({ to: '/rooms/$roomId/lobby', params: { roomId: result.roomId } })
      }

      if (result.status === 'PLAYING' || result.status === 'NOT_QUEUED') {
        useAppStore.getState().stopQuickMatch()
        return
      }
      timer = window.setTimeout(poll, QUICK_MATCH_POLL_INTERVAL_MS)
    }

    const fail = (cause: unknown) => {
      if (controller.signal.aborted) return
      setError(
        toUserError(cause instanceof Error ? cause : new Error('quick match failed')).message,
      )
    }

    const poll = () => void getQuickMatch(options).then(apply).catch(fail)

    void enterQuickMatch(request.gameCode, options).then(apply).catch(fail)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [authSession, navigate, request])

  const handleCancel = async () => {
    setCanceling(true)
    if (authSession) {
      await cancelQuickMatch({
        sessionToken: authSession.sessionToken,
        userId: authSession.userId,
      }).catch(() => {})
    }
    setCanceling(false)
    useAppStore.getState().stopQuickMatch()
  }

  const failed = error !== null
  const matched = status === 'MATCHED'

  if (!request) return null

  return (
    <LoadingOverlay
      busy={!failed}
      message={error ?? (matched ? '상대를 찾았어요 · 곧 시작해요' : '상대를 찾고 있어요')}
      open
    >
      {failed ? (
        <Button onClick={() => useAppStore.getState().stopQuickMatch()} variant="secondary">
          닫기
        </Button>
      ) : (
        !matched && (
          <Button
            loading={canceling}
            onClick={() => void handleCancel()}
            type="button"
            variant="ghost"
          >
            취소
          </Button>
        )
      )}
    </LoadingOverlay>
  )
}
