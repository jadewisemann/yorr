import { Alert } from '@/shared/components/Alert'
import { IconCheck } from '@/shared/components/Icon'

/*
 * 주사위 트레이 자리를 그대로 채우는 한 줄 알림이라 Alert 기본형보다 크다 —
 * 높이 하한·가운데 정렬·라운드(card→panel)를 여기서 얹는다.
 */
const noticeClassName =
  'flex min-h-15 flex-1 items-center justify-center gap-2 rounded-panel px-4 text-center font-semibold'

export function WaitingNotice({
  activePlayerName,
  submitted,
}: {
  activePlayerName: string | undefined
  submitted: boolean
}) {
  if (submitted) {
    return (
      <Alert className={noticeClassName} tone="positive">
        <span
          aria-hidden="true"
          className="grid size-5 flex-none place-items-center rounded-chip bg-positive/20"
        >
          <IconCheck className="size-3" />
        </span>
        점수가 반영됐습니다. 다음 턴을 기다립니다.
      </Alert>
    )
  }

  /*
   * 대기 문구는 턴마다 바뀌지만 live region으로 만들지 않는다(neutral tone은 role이 없다) —
   * 매 턴 읽어 주면 정작 중요한 알림을 덮는다.
   */
  return (
    <Alert className={noticeClassName}>
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-xs bg-brand-strong motion-safe:animate-ring-pulse"
      />
      {activePlayerName ? `${activePlayerName}(이)가 굴리는 중` : '턴 동기화 중'}
    </Alert>
  )
}
