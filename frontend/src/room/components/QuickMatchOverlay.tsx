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

/**
 * 빠른 대전 대기 백드롭. 상태 조회(polling)까지 여기서 맡는다.
 *
 * <b>라우터 루트에 한 번</b> 마운트하는 이유: 매칭이 잡히면 화면이 닉네임 → 대기실로 옮겨
 * 가는데, 그 뒤에도 `PLAYING`이 나올 때까지 조회를 이어가야 한다(이 요청이 두 사용자의
 * 소켓 연결을 확인하고 게임을 시작시킨다). 화면 안에 두면 이동하는 순간 조회가 끊긴다.
 *
 * 게임 화면으로의 이동은 여기서 하지 않는다 — 대기실이 WS phase를 보고 이미 옮긴다.
 */
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
    // 대기열은 회원 세션으로만 선다. 랜딩에서 미리 막지만, 세션이 그새 만료됐을 수도 있다.
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

      // 빠른 대전 백엔드가 이 사용자를 이미 방에 넣어 뒀다 — POST /rooms를 다시 부르면 안 된다.
      // 방 세션만 만들어 두면 대기실에서 기존 RealtimeSync가 room.join을 보낸다.
      if (result.status === 'MATCHED' && result.roomId && !roomSessionCreated) {
        roomSessionCreated = true
        useAppStore.getState().setRoomSession({
          ...(result.gameCode ? { gameCode: result.gameCode } : {}),
          gameId: null,
          roomId: result.roomId,
          roomCode: result.roomId,
          you: authSession.userId,
          nickname: request.nickname,
          // 실제 방장 여부는 서버 스냅샷의 hostId로 판단한다(isRoomHost) — 여기서는 참가자로 둔다.
          membershipRole: 'participant',
          sessionToken: authSession.sessionToken,
          snapshot: null,
        })
        void navigate({ to: '/rooms/$roomId/lobby', params: { roomId: result.roomId } })
      }

      // PLAYING = 게임이 시작됐다. NOT_QUEUED = 취소되거나 대기열에서 빠졌다. 둘 다 대기 끝.
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
    // 취소가 서버에서 실패해도 로컬 대기는 반드시 끝낸다 — 사용자를 백드롭에 가둘 이유가 없다.
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

  // 대기가 끝나면 <b>즉시</b> 트리에서 뺀다 — 퇴장 연출을 기다리게 두면 화면 전체를 덮는
  // 스크림이 opacity 0으로 남아 클릭을 먹는 순간이 생긴다(대기실이 그 아래에 있다).
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
        // 매칭이 잡힌 뒤에는 취소가 성립하지 않는다 — 그때는 이미 방 안이라 대기실의 나가기가 맡는다.
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
