import { KAKAO_SUPPORT_URL } from '@/landing/components/EntryPage/parts'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'

/*
 * 문의 버튼을 눌렀을 때 정말 카카오톡으로 나갈지 묻는 두 버튼 모달.
 *
 * 다른 다이얼로그와 같이 `<main>` 바깥에 렌더된다 — Modal의 useDialogBackground가
 * main에 inert를 걸어 뒤의 캐러셀·헤더·떠 있는 문의 버튼까지 한 번에 잠그기 때문이다.
 * 백드롭은 Modal의 전면 scrim 버튼이 받아서 뒤로 클릭·드래그가 새지 않고, 누르면 닫힌다.
 * 이동은 사용자 클릭 안에서 window.open — 팝업 차단으로 막히면 같은 탭으로 간다.
 */
export function SupportDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const go = () => {
    onClose()
    const opened = globalThis.open(KAKAO_SUPPORT_URL, '_blank', 'noopener,noreferrer')
    if (!opened) globalThis.location.assign(KAKAO_SUPPORT_URL)
  }

  return (
    <Modal className="max-w-sm" onClose={onClose} open={open} title="카카오톡으로 이동할까요?">
      <div className="grid gap-4">
        <p className="m-0 text-sm/[1.55] text-content-muted">
          Yorr 카카오톡 채널이 새 탭에서 열려요. 1:1 채팅으로 문의를 남길 수 있어요.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onClose} type="button" variant="secondary">
            취소
          </Button>
          <Button onClick={go} type="button">
            이동하기
          </Button>
        </div>
      </div>
    </Modal>
  )
}
