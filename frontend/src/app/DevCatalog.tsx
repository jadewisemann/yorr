import { useState } from 'react'
import { Button } from '@/components/Button'
import { Dice } from '@/components/Dice'
import { Modal } from '@/components/Modal'
import { PlayerCard } from '@/components/PlayerCard'
import { ScoreRow } from '@/components/ScoreRow'
import { StatusPanel } from '@/components/StatusPanel'

const sectionClassName = 'grid gap-4 rounded-panel border border-border bg-surface p-5'

export function DevCatalog() {
  const [modalOpen, setModalOpen] = useState(false)

  if (!import.meta.env.DEV) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-content">
        개발 환경에서만 사용할 수 있습니다.
      </main>
    )
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-content gap-6 p-6 text-content">
      <header>
        <p className="text-sm font-bold tracking-widest text-brand-strong">YORR DESIGN SYSTEM</p>
        <h1 className="text-display font-bold">Component catalog</h1>
        <p className="text-content-muted">
          semantic token과 상태 variant를 독립 검증하는 개발 전용 화면
        </p>
      </header>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Button</h2>
        <div className="flex flex-wrap gap-3">
          <Button size="sm">Small</Button>
          <Button>Primary</Button>
          <Button size="lg">Large</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Dice</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Dice value={1} size="sm" />
          <Dice value={3} />
          <Dice value={5} held />
          <Dice value={6} rolling size="lg" />
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Player and score</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <PlayerCard name="유진" isHost active />
          <PlayerCard name="잠시 자리 비운 플레이어" score={64} status="away" />
          <PlayerCard name="요르" score={92} status="offline" />
        </div>
        <div className="grid gap-2">
          <ScoreRow label="Full House" score={28} selected onSelect={() => undefined} />
          <ScoreRow label="Yacht" score={50} onSelect={() => undefined} />
          <ScoreRow label="Choice" disabled onSelect={() => undefined} />
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Async states</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <StatusPanel variant="loading" />
          <StatusPanel variant="empty" />
          <StatusPanel variant="error" />
          <StatusPanel variant="reconnect" />
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Modal</h2>
        <Button onClick={() => setModalOpen(true)}>Modal 열기</Button>
        <Modal open={modalOpen} title="게임 나가기" onClose={() => setModalOpen(false)}>
          <p className="text-content-muted">현재 게임에서 나가시겠습니까?</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              취소
            </Button>
            <Button>나가기</Button>
          </div>
        </Modal>
      </section>
    </main>
  )
}
