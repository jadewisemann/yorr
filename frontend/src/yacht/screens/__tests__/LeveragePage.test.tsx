import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { createDiceSet } from '@/yacht/domain/dice'
import { scoreCategory, type YachtCategory } from '@/yacht/domain/scoring'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/yacht/rendering/physics-dice/types'
import { LeveragePage } from '@/yacht/screens/LeveragePage'
import { categoryLabel } from '@/yacht/yachtCategoryView'

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/yacht/input/useMotionRollInput', () => ({
  useMotionRollInput: (_onGestureEvent: (event: MotionGestureEvent) => void) => ({
    availability: 'unsupported',
    calibrated: true,
    canConfirmThrow: false,
    gestureState: 'idle',
    inputMode: 'tap',
    lastPulseDirection: null,
    noiseRms: 0,
    requestPermission: vi.fn(),
    resetGesture: vi.fn(),
    reversalCount: 0,
  }),
}))

/** 물리 렌더러는 rAF·WebGL에 기대 jsdom에서 굴림을 끝낼 수 없다. 완료를 버튼으로 노출한다. */
vi.mock('@/yacht/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    onRollComplete,
    request,
  }: {
    onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
    request: PhysicsDiceRollRequest | null
  }) => (
    <div data-target={request?.targetDice.join(',') ?? ''} data-testid="dice-scene">
      {request && (
        <button onClick={() => onRollComplete(request.requestId, request.targetDice)} type="button">
          굴림 완료
        </button>
      )}
    </div>
  ),
}))

const categoryByLabel = new Map(
  Object.entries(categoryLabel).map(([category, label]) => [label, category as YachtCategory]),
)

/** 화면이 ×2로 표시한 족보. 라벨로 되짚어 실제 키를 얻는다. */
function leveragedCategory(): YachtCategory {
  const notice = screen.getByText(/이번 턴 ×2 —/)
  const label = notice.textContent?.split('—')[1]?.trim() ?? ''
  const category = categoryByLabel.get(label)
  if (!category) throw new Error(`알 수 없는 족보 표기: ${label}`)
  return category
}

/** 족보 이름으로 기록 자리를 찾는다. 앞을 고정해야 '포'가 '포커'를 잡지 않는다. */
function recordButtons(category: YachtCategory) {
  return screen.getAllByRole('button', { name: new RegExp(`^${categoryLabel[category]} `) })
}

/** 기록 한 번. 0점 확정은 일반 모드와 같은 확인 모달을 거친다. */
async function record(user: ReturnType<typeof userEvent.setup>, category: YachtCategory) {
  const [pick] = recordButtons(category)
  if (!pick) throw new Error(`${categoryLabel[category]} 기록 자리를 찾지 못했다`)
  await user.click(pick)
  const confirm = screen.queryByRole('button', { name: '0점 확정' })
  if (confirm) await user.click(confirm)
}

async function rollOnce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '굴리기' }))
  const complete = await screen.findByRole('button', { name: '굴림 완료' })
  // 굴림이 끝나면 request가 비므로 목표 눈은 그 전에 읽는다.
  const target = screen.getByTestId('dice-scene').getAttribute('data-target') ?? ''
  await user.click(complete)
  return createDiceSet(target.split(',').map(Number))
}

describe('레버리지 다이스 화면', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    useAppStore.setState({ connectionStatus: 'idle' })
  })

  it('이번 턴의 2배 족보를 실제 플레이 화면 위에 알린다', () => {
    render(<LeveragePage />)

    expect(screen.getByTestId('dice-scene')).toBeInTheDocument()
    expect(leveragedCategory()).toBeTruthy()
  })

  it('레버리지 족보는 미리보기부터 2배로 보인다 — 기록한 뒤 알면 고를 수 없다', async () => {
    const user = userEvent.setup()
    render(<LeveragePage />)
    const category = leveragedCategory()

    const dice = await rollOnce(user)

    const doubled = scoreCategory(dice, category) * 2
    const labels = recordButtons(category).map((button) => button.getAttribute('aria-label') ?? '')

    expect(labels.some((label) => label.includes('2배') && label.includes(String(doubled)))).toBe(
      true,
    )
  })

  it('기록하면 다음 라운드가 열리고, 쓴 족보는 레버리지 후보에서 빠진다', async () => {
    const user = userEvent.setup()
    render(<LeveragePage />)
    const category = leveragedCategory()

    await rollOnce(user)
    await record(user, category)

    expect(await screen.findByText(/02 \/ 12/)).toBeInTheDocument()
    expect(leveragedCategory()).not.toBe(category)
  })

  it('12라운드를 혼자 완주하면 결과가 뜬다', async () => {
    const user = userEvent.setup()
    render(<LeveragePage />)

    for (let round = 1; round <= 12; round += 1) {
      const category = leveragedCategory()
      await rollOnce(user)
      await record(user, category)
    }

    expect(await screen.findByText('레버리지 · 12라운드 종료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeInTheDocument()
  })
})
