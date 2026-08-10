import { Button } from '@/shared/components/Button'

interface BotManagementPanelProps {
  visible: boolean
  playerCount: number
  capacity: number
  loading: boolean
  adding: boolean
  error: Error | null
  onAdd: () => void
}

export function BotManagementPanel({
  visible,
  playerCount,
  capacity,
  loading,
  adding,
  error,
  onAdd,
}: BotManagementPanelProps) {
  if (!visible) return null
  return (
    <section
      aria-label="AI 봇 관리"
      className="grid flex-none gap-2 rounded-panel border border-border bg-surface-raised p-3"
    >
      <p className="m-0 text-xs text-content-muted">
        점수판과 남은 기회를 계산하는 AI 봇을 추가합니다.
      </p>
      <Button
        disabled={loading || playerCount >= capacity}
        loading={adding}
        onClick={onAdd}
        type="button"
        variant="secondary"
      >
        봇 추가
      </Button>
      {error && (
        <p className="m-0 text-xs text-danger" role="alert">
          봇을 변경하지 못했어요: {error.message}
        </p>
      )}
    </section>
  )
}
