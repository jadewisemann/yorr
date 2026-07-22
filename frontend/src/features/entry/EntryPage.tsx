import { Button } from '../../shared/ui/Button'

export function EntryPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-4 text-center">
        <p className="m-0 text-xs font-bold tracking-[0.16em] text-brand-strong">
          REAL-TIME YACHT DICE
        </p>
        <h1 className="m-0 text-[clamp(4rem,24vw,8rem)] leading-[0.9] font-bold tracking-[-0.08em] text-brand">
          YORR
        </h1>
        <p className="m-0 text-content-muted">흔들거나 탭해서 함께 즐기는 모바일 요트다이스</p>
        <Button className="mt-4 w-full rounded-full" size="lg">
          게임 시작
        </Button>
      </section>
    </main>
  )
}
