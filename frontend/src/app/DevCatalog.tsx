import { useState } from 'react'
import { Button } from '@/components/Button'
import { Dice } from '@/components/Dice'
import { GameHelpModal } from '@/components/GameHelpModal'
import { Modal } from '@/components/Modal'
import { PlayerCard } from '@/components/PlayerCard'
import { ScoreRow } from '@/components/ScoreRow'
import { StatusPanel } from '@/components/StatusPanel'
import { TextField } from '@/components/TextField'
import { Tooltip } from '@/components/Tooltip'
import { TutorialGuide } from '@/components/TutorialGuide'
import { PhysicsDiceDemo } from './PhysicsDiceDemo'

const sectionClassName = 'grid gap-4 rounded-panel border border-border bg-surface p-5'

export function DevCatalog() {
  const [modalOpen, setModalOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // 마스코트 가이드는 실제 게임 신호(굴림·킵·기록)로 넘어간다 — 여기선 버튼으로 흉내 낸다.
  const [guideVisible, setGuideVisible] = useState(true)
  const [guideRun, setGuideRun] = useState(0)
  const [guideSignals, setGuideSignals] = useState({
    isMyTurn: true,
    kept: false,
    rolled: false,
    submitted: false,
  })

  const resetGuide = () => {
    setGuideSignals({ isMyTurn: true, kept: false, rolled: false, submitted: false })
    setGuideRun((run) => run + 1)
    setGuideVisible(true)
  }

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
        <h2 className="text-xl font-bold">Physics dice renderer</h2>
        <p className="text-sm text-content-muted">
          결과 입력형 Three.js·Rapier 렌더러의 굴림, KEEP, 품질 preset을 검증합니다.
        </p>
        <PhysicsDiceDemo />
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Text field</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="닉네임"
            placeholder="느긋한 주사위"
            helpText="비워두면 추천 이름을 사용해요."
          />
          <TextField
            label="초대 코드"
            defaultValue="YORR!"
            errorMessage="특수문자는 사용할 수 없어요."
          />
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Player and score</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <PlayerCard name="유진" active />
          <PlayerCard name="잠시 자리 비운 플레이어" score={64} status="away" />
          <PlayerCard name="요르" score={92} status="offline" />
        </div>
        <div className="grid gap-2">
          <ScoreRow label="Full House" score={28} state="selected" onSelect={() => undefined} />
          <ScoreRow label="Yacht" score={50} onSelect={() => undefined} />
          <ScoreRow label="Choice" score={17} state="used" onSelect={() => undefined} />
          <ScoreRow label="4 of a Kind" score={0} state="zeroed" onSelect={() => undefined} />
          <ScoreRow label="S. Straight" score={15} size="sm" onSelect={() => undefined} />
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className="text-xl font-bold">Tutorial and tooltip</h2>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-sm text-content-muted">
            툴팁 트리거
            <Tooltip
              content="탭·호버·포커스로 열리고 Escape·바깥 탭으로 닫혀요."
              label="툴팁 예시"
            />
          </span>
          <Button variant="secondary" onClick={() => setHelpOpen(true)}>
            게임 도움말 열기
          </Button>
        </div>
        <p className="m-0 text-sm text-content-muted">
          마스코트 가이드는 실제 플레이(굴림 → 킵 → 기록)에 반응해 넘어간다. 아래 버튼으로 게임
          신호를 흉내 내며 시퀀스를 확인한다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGuideSignals((signals) => ({ ...signals, rolled: true }))}
          >
            굴림 완료 신호
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGuideSignals((signals) => ({ ...signals, kept: true }))}
          >
            킵 신호
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGuideSignals((signals) => ({ ...signals, submitted: true }))}
          >
            기록 완료 신호
          </Button>
          <Button size="sm" variant="ghost" onClick={resetGuide}>
            리셋
          </Button>
        </div>
        <div className="relative h-80 overflow-hidden rounded-[1.375rem] border border-white/8 [background:var(--ds-physics-tray)]">
          {guideVisible && (
            <TutorialGuide
              key={guideRun}
              isMyTurn={guideSignals.isMyTurn && !guideSignals.submitted}
              kept={guideSignals.kept}
              onFinish={() => setGuideVisible(false)}
              onNeverShowAgain={() => setGuideVisible(false)}
              onSkip={() => setGuideVisible(false)}
              rolled={guideSignals.rolled}
              submitted={guideSignals.submitted}
            />
          )}
        </div>
        <GameHelpModal onClose={() => setHelpOpen(false)} open={helpOpen} />
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
