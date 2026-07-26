import { useAppStore } from '@/store'

export function GamePage() {
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)

  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center text-content">
      <section className="grid gap-2">
        <p className="font-bold text-brand-strong">ROUND {roomSnapshot?.game?.roundNumber ?? 1}</p>
        <h1 className="text-display font-bold">게임이 시작됐어요</h1>
        <p className="text-content-muted">주사위 게임 화면으로 이어집니다.</p>
      </section>
    </main>
  )
}
