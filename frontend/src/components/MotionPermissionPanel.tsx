import { Button } from './Button'

type MotionPermissionPanelProps = {
  availability: 'permissionRequired' | 'requesting' | 'denied' | 'error' | 'insecure'
  onRequestPermission: () => Promise<void>
}

export function MotionPermissionPanel({
  availability,
  onRequestPermission,
}: MotionPermissionPanelProps) {
  if (availability === 'permissionRequired' || availability === 'requesting') {
    return (
      <section
        className="grid gap-3 rounded-card border border-brand/50 bg-surface-raised p-4"
        aria-labelledby="motion-permission-title"
      >
        <div className="grid gap-1">
          <h2 id="motion-permission-title" className="m-0 text-lg font-bold text-brand-strong">
            모션 센서를 사용해 볼까요?
          </h2>
          <p className="m-0 text-sm text-content-muted">
            아래 버튼을 누르면 모션 센서를 시작해요. 브라우저에 따라 시스템 권한 창이 표시될 수
            있어요. 센서값은 이 기기에서 동작을 판정할 때만 사용하며 서버로 보내지 않아요.
          </p>
        </div>
        <Button loading={availability === 'requesting'} onClick={() => void onRequestPermission()}>
          {availability === 'requesting' ? '권한 확인 중' : '센서 사용 시작하기'}
        </Button>
      </section>
    )
  }

  const message =
    availability === 'insecure'
      ? '모션 센서는 HTTPS로 접속했을 때만 사용할 수 있어요. 안전한 주소로 다시 접속하거나 버튼으로 진행해 주세요.'
      : availability === 'denied'
        ? '센서 권한이 거부됐어요. 브라우저의 사이트 설정에서 모션 센서를 허용한 뒤 페이지를 새로 열거나 버튼으로 진행해 주세요.'
        : '센서 권한을 시작하지 못했어요. 페이지를 새로 열어 다시 시도하거나 버튼으로 진행해 주세요.'

  return (
    <section
      className="rounded-card border border-border bg-surface-raised p-4"
      aria-label="센서 권한 안내"
    >
      <p className="m-0 text-sm text-content-muted">{message}</p>
    </section>
  )
}
