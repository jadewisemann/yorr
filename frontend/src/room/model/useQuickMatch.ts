import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { AuthSession } from '@/auth/authSession'
import {
  cancelQuickMatch,
  enterQuickMatch,
  getQuickMatch,
  QUICK_MATCH_POLL_INTERVAL_MS,
  type QuickMatch,
  type QuickMatchStatus,
} from '@/room/api/quickMatchApi'
import { toUserError } from '@/shared/api/userError'
import { type QuickMatchRequest, useAppStore } from '@/store'

interface PollContext {
  authSession: AuthSession
  navigate: ReturnType<typeof useNavigate>
  request: QuickMatchRequest
}

/**
 * 빠른 대전 폴링. 등록 → 주기 조회 → MATCHED에서 방 세션을 만들고 대기실로,
 * PLAYING·NOT_QUEUED에서 큐를 닫는다. 언마운트·요청 변경 시 폴링을 끊는다.
 */
export function useQuickMatchPolling() {
  const navigate = useNavigate()
  const request = useAppStore((state) => state.quickMatch)
  const authSession = useAppStore((state) => state.authSession)
  const [status, setStatus] = useState<QuickMatchStatus>('NOT_QUEUED')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStatus('NOT_QUEUED')
    setError(null)
    if (!request) return
    if (!authSession) {
      setError('빠른 대전은 로그인이 필요해요.')
      return
    }
    return runPolling({ authSession, navigate, request }, { setError, setStatus })
  }, [authSession, navigate, request])

  return { error, request, status }
}

function runPolling(
  context: PollContext,
  setters: { setError: (error: string | null) => void; setStatus: (s: QuickMatchStatus) => void },
) {
  const { authSession } = context
  const options = { sessionToken: authSession.sessionToken, userId: authSession.userId }
  const controller = new AbortController()
  // 방 세션은 한 번만 만든다 — MATCHED가 반복돼도 navigate가 겹치지 않게.
  const joined = { done: false }
  const fail = (cause: unknown) => {
    if (controller.signal.aborted) return
    const message = toUserError(cause instanceof Error ? cause : new Error('quick match failed'))
    setters.setError(message.message)
  }

  const poll = () => void getQuickMatch(options).then(applyPoll).catch(fail)
  function applyPoll(result: QuickMatch) {
    setters.setStatus(result.status)
    if (result.status === 'MATCHED' && result.roomId && !joined.done) {
      joined.done = true
      enterMatchedRoom({ ...result, roomId: result.roomId }, context)
    }
    if (result.status === 'PLAYING' || result.status === 'NOT_QUEUED') {
      useAppStore.getState().stopQuickMatch()
      return
    }
    timer = window.setTimeout(poll, QUICK_MATCH_POLL_INTERVAL_MS)
  }

  let timer: number | undefined
  void enterQuickMatch(context.request.gameCode, options).then(applyPoll).catch(fail)

  return () => {
    controller.abort()
    window.clearTimeout(timer)
  }
}

/** 매칭 성공 — 방 세션을 만들고 대기실로. 대시보드 없이 참가자 역할로 들어간다. */
function enterMatchedRoom(result: QuickMatch & { roomId: string }, context: PollContext) {
  const { authSession, navigate, request } = context
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

/** 취소 버튼 — 서버 큐를 닫고(실패는 무시) 로컬 상태를 정리한다. */
export function useQuickMatchCancel() {
  const authSession = useAppStore((state) => state.authSession)
  const [canceling, setCanceling] = useState(false)

  const cancel = async () => {
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

  return { cancel, canceling }
}
