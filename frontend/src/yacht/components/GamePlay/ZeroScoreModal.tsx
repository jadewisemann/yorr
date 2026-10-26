import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'

export function ZeroScoreModal({
  category,
  onCancel,
  onConfirm,
}: {
  category: YachtCategory | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      onClose={onCancel}
      open={category !== null}
      role="alertdialog"
      title={category ? `${categoryLabel[category]}를 0점으로 확정할까요?` : ''}
    >
      <p className="m-0 text-sm text-content-muted">이 족보는 다시 사용할 수 없습니다.</p>
      <div className="mt-5 grid gap-2">
        <Button onClick={onCancel} variant="secondary">
          취소
        </Button>
        <Button onClick={onConfirm} variant="danger">
          0점 확정
        </Button>
      </div>
    </Modal>
  )
}
