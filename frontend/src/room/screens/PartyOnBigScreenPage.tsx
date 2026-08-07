import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/shared/components/Button'
import type { PartyGameKey } from './PartyDashboardPage'

/**
 * 좁은 화면으로 `/party`에 들어왔을 때. 랜딩에는 이 진입점이 아예 없으므로 여기 오는 경우는
 * 링크·북마크·기기 회전뿐이다.
 *
 * 대시보드를 폰에 억지로 그리지 않는다 — 폰의 대시보드는 덜 좋은 경험이 아니라 <b>틀린</b>
 * 경험이다(자기 화면을 자기가 들고 있으면 남이 볼 게임판이 아니다). 그래서 랜딩에도 비활성
 * 버튼조차 두지 않고, 여기서는 무엇을 하면 되는지만 알려준 뒤 정상 경로로 돌려보낸다.
 */
export function PartyOnBigScreenPage({ gameKey }: { gameKey: PartyGameKey }) {
  const navigate = useNavigate()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-gutter pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <div className="grid gap-3">
        <h1 className="m-0 text-[27px] font-bold tracking-[-0.02em]">
          파티 모드는 큰 화면에서 열어 주세요
        </h1>
        <p className="m-0 text-[15px] leading-[1.6] text-content-muted">
          이 화면이 게임판이 되고, 다른 사람들은 QR을 찍어 폰으로 참여해요. TV·모니터·노트북에서
          요르를 열면 바로 시작할 수 있어요.
        </p>
      </div>

      <div className="mt-auto grid gap-2.5">
        <Button
          className="min-h-[3.625rem] w-full rounded-panel text-lg"
          onClick={() => void navigate({ to: '/join', search: { code: undefined, game: gameKey } })}
          size="lg"
        >
          폰으로 그냥 플레이하기
        </Button>
        <Button
          className="text-content-muted hover:text-content"
          onClick={() => void navigate({ to: '/' })}
          variant="ghost"
        >
          홈으로
        </Button>
      </div>
    </main>
  )
}
