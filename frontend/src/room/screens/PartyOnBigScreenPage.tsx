import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/shared/components/Button'
import { Screen } from '@/shared/components/Screen'
import type { PartyGameKey } from './PartyDashboardPage'

export function PartyOnBigScreenPage({ gameKey }: { gameKey: PartyGameKey }) {
  const navigate = useNavigate()

  return (
    <Screen className="max-w-lg gap-6 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="grid gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">
          파티 모드는 큰 화면에서 열어 주세요
        </h1>
        <p className="m-0 text-sm leading-[1.6] text-content-muted">
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
    </Screen>
  )
}
