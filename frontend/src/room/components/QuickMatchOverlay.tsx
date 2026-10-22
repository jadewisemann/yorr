import { useQuickMatchCancel, useQuickMatchPolling } from '@/room/model/useQuickMatch'
import { Button } from '@/shared/components/Button'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useAppStore } from '@/store'

/** 빠른 대전 대기 오버레이 — 폴링·취소는 `useQuickMatch*`가 맡는다. */
export function QuickMatchOverlay() {
  const { error, request, status } = useQuickMatchPolling()
  const { cancel, canceling } = useQuickMatchCancel()

  if (!request) return null

  const failed = error !== null
  const matched = status === 'MATCHED'
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
          <Button loading={canceling} onClick={() => void cancel()} type="button" variant="ghost">
            취소
          </Button>
        )
      )}
    </LoadingOverlay>
  )
}
