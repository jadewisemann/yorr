import { Button } from '@/shared/components/Button'

export function PartyOpeningNotice({ error, onHome }: { error: Error | null; onHome: () => void }) {
  return (
    <main className="mx-auto flex h-svh w-full max-w-lg flex-col items-center justify-center gap-4 px-gutter text-center text-content">
      {error ? (
        <>
          <p className="m-0 text-base font-bold" role="alert">
            파티 방을 열지 못했어요
          </p>
          <p className="m-0 text-sm text-content-muted">{error.message}</p>
          <Button onClick={onHome} variant="secondary">
            홈으로
          </Button>
        </>
      ) : (
        <p className="m-0 text-sm text-content-muted" role="status">
          파티 방을 열고 있어요.
        </p>
      )}
    </main>
  )
}
