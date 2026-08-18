import { useState } from 'react'
import { PlayerCard } from '@/room/components/PlayerCard'
import { StatusPanel } from '@/room/components/StatusPanel'
import { Alert } from '@/shared/components/Alert'
import { Badge } from '@/shared/components/Badge'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Button } from '@/shared/components/Button'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { Modal } from '@/shared/components/Modal'
import { Panel } from '@/shared/components/Panel'
import { TextField } from '@/shared/components/TextField'
import { Tooltip } from '@/shared/components/Tooltip'
import { Dice } from '@/yacht/components/Dice'
import { GameHelpModal } from '@/yacht/components/GameHelpModal'
import { ScoreRow } from '@/yacht/components/ScoreRow'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'
import type { CategoryScores } from '@/yacht/domain/scoring'
import { HandVoiceLab } from './HandVoiceLab'
import { PhysicsDiceDemo } from './PhysicsDiceDemo'

const sectionClassName = 'grid gap-4 p-5'

const initialGuideSignals = {
  candidates: {} as CategoryScores,
  keptValues: [] as number[],
  rollCount: 0,
  rolled: false,
  submitted: false,
}

const LAST_ROLL_CANDIDATES: CategoryScores = {
  ones: 0,
  twos: 2,
  threes: 0,
  fours: 0,
  fives: 0,
  sixes: 24,
  choice: 26,
  fourOfAKind: 26,
  fullHouse: 0,
  smallStraight: 0,
  largeStraight: 0,
  yacht: 0,
}

const { fourOfAKind: _recorded, ...AFTER_RECORD_CANDIDATES } = LAST_ROLL_CANDIDATES

export function DevCatalog() {
  const [modalOpen, setModalOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [guideVisible, setGuideVisible] = useState(true)
  const [guideRun, setGuideRun] = useState(0)
  const [guideSignals, setGuideSignals] = useState(initialGuideSignals)

  const resetGuide = () => {
    setGuideSignals(initialGuideSignals)
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

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Screens</h2>
        <p className="m-0 text-sm text-content-muted">
          컴포넌트가 아니라 화면 전체를 가짜 서버로 굴려 보는 자리
        </p>
        <div className="flex flex-wrap gap-3">
          <a className="quick-chip focus-ring" href="/__dev/controller">
            파티 모드 컨트롤러
          </a>
          <a className="quick-chip focus-ring" href="/__dev/motion">
            모션 센서 랩
          </a>
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
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
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Dice</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Dice value={1} size="sm" />
          <Dice value={3} />
          <Dice value={5} held />
          <Dice value={6} rolling size="lg" />
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Physics dice renderer</h2>
        <p className="text-sm text-content-muted">
          결과 입력형 Three.js·Rapier 렌더러의 굴림, KEEP, 품질 preset을 검증합니다.
        </p>
        <PhysicsDiceDemo />
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Hand callout and voice</h2>
        <p className="text-sm text-content-muted">
          숫자키 1~5로 족보 콜아웃과 직접 녹음한 음성을 게임 없이 확인합니다. 소리가 나지 않으면
          화면을 한 번 클릭해 브라우저 자동재생 잠금을 풀어주세요.
        </p>
        <HandVoiceLab />
      </Panel>

      <Panel as="section" className={sectionClassName}>
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
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Alert</h2>
        <div className="grid gap-3">
          <Alert>방을 만든 사람이 호스트가 돼요</Alert>
          <Alert tone="danger">빠른 대전은 로그인이 필요해요.</Alert>
          <Alert tone="positive">점수가 반영됐습니다. 다음 턴을 기다립니다.</Alert>
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Panel</h2>
        <p className="m-0 text-sm text-content-muted">
          이 카탈로그의 섹션 상자가 곧 Panel이다. 아래는 면 세 단.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Panel className="p-4 text-sm">surface</Panel>
          <Panel className="p-4 text-sm" surface="raised">
            raised
          </Panel>
          <Panel className="p-4 text-sm" surface="sunken">
            sunken
          </Panel>
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Badge</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>2인</Badge>
          <Badge tone="warning">연결 끊김</Badge>
          <Badge tone="brand">추천</Badge>
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
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
      </Panel>

      <Panel as="section" className={sectionClassName}>
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
          마스코트 가이드는 <code>/tutorial</code> 연습 모드의 안내다. 실제 플레이(굴림 → 킵 →
          재굴림 → 기록)에 반응해 넘어가므로, 아래 버튼으로 연습 대본과 같은 신호를 흉내 낸다 — 6이
          2개에서 3개로 늘어나는 흐름이 "같은 눈을 모으면 커진다"를 말하는 대본이다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setGuideSignals((signals) => ({
                ...signals,
                candidates: { sixes: 12 },
                rollCount: 1,
                rolled: true,
              }))
            }
          >
            1굴림 완료 (6이 2개)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGuideSignals((signals) => ({ ...signals, keptValues: [6, 6] }))}
          >
            6 두 개 킵
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setGuideSignals((signals) => ({
                ...signals,
                candidates: { sixes: 18 },
                rollCount: 2,
              }))
            }
          >
            2굴림 완료 (6이 3개)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGuideSignals((signals) => ({ ...signals, keptValues: [6, 6, 6] }))}
          >
            6 세 개 킵 (→ 던지기 물음)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setGuideSignals((signals) => ({
                ...signals,
                candidates: LAST_ROLL_CANDIDATES,
                keptValues: [6, 6, 6, 6],
                rollCount: 3,
              }))
            }
          >
            3굴림 완료 (6이 4개 → 기록)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setGuideSignals((signals) => ({
                ...signals,
                candidates: AFTER_RECORD_CANDIDATES,
                submitted: true,
              }))
            }
          >
            포커 기록 완료 (→ 족보 둘러보기)
          </Button>
          <Button size="sm" variant="ghost" onClick={resetGuide}>
            리셋
          </Button>
        </div>
        <div className="relative h-80 overflow-hidden rounded-panel border border-white/8 [background:var(--ds-physics-tray)]">
          {guideVisible && (
            <TutorialGuide
              key={guideRun}
              candidates={guideSignals.candidates}
              keptValues={guideSignals.keptValues}
              motionNoticeVisible
              onClose={() => setGuideVisible(false)}
              rollCount={guideSignals.rollCount}
              rolled={guideSignals.rolled}
              rolling={false}
              submitted={guideSignals.submitted}
              wide={false}
            />
          )}
        </div>
        <GameHelpModal onClose={() => setHelpOpen(false)} open={helpOpen} />
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Async states</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <StatusPanel variant="loading" />
          <StatusPanel variant="empty" />
          <StatusPanel variant="error" />
          <StatusPanel variant="reconnect" />
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Game chrome</h2>
        <p className="m-0 text-sm text-content-muted">
          overlay 톤은 게임 화면 위에 얹히는 버튼이라 어두운 바닥 위에서 봐야 한다.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <GameChromeButton>나가기</GameChromeButton>
          <GameChromeButton disabled>비활성</GameChromeButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-panel bg-canvas p-4">
          <GameChromeButton tone="overlay">도움말</GameChromeButton>
          <GameChromeButton disabled tone="overlay">
            비활성
          </GameChromeButton>
        </div>
      </Panel>

      <Panel as="section" className={sectionClassName}>
        <h2 className="text-xl font-bold">Bottom sheet</h2>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Bottom sheet 열기
        </Button>
        <BottomSheet open={sheetOpen} title="족보" onClose={() => setSheetOpen(false)}>
          <p className="text-content-muted">아래로 끌어내리거나 바깥을 눌러 닫습니다.</p>
        </BottomSheet>
      </Panel>

      <Panel as="section" className={sectionClassName}>
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
      </Panel>
    </main>
  )
}
