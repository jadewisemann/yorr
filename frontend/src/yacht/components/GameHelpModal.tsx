import { Modal } from '@/shared/components/Modal'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/yacht/domain/scoring'
import { categoryDescription, categoryLabel } from '@/yacht/domain/yachtCategoryView'
import { CategoryIcon } from './CategoryIcon'

interface GameHelpModalProps {
  onClose: () => void
  open: boolean
  /** 제한 시간이 있는 판인가. 봇만 데리고 혼자 하는 방은 시계가 없다. */
  timed?: boolean
}

const HOW_TO_PLAY = [
  '라운드마다 내 차례에 주사위를 최대 3번 굴릴 수 있어요.',
  '주사위를 탭하면 킵(고정)돼요. 킵한 주사위는 다시 굴리지 않아요.',
  '굴린 뒤 족보를 탭하면 그 점수로 바로 기록되고 턴이 끝나요.',
  '모든 족보를 한 번씩 기록하면 게임 끝 — 총점이 높은 사람이 승리!',
] as const

/** 시계가 도는 판에서만 붙는 마지막 줄 — 없는 규칙을 설명하면 그게 오답이다. */
const TIMEOUT_RULE = '시간이 다 되면 서버가 대신 굴리거나 남은 족보에 자동 기록해요.'
const UNTIMED_RULE = '혼자 하는 연습 방이라 제한 시간이 없어요. 천천히 골라도 돼요.'

export function GameHelpModal({ onClose, open, timed = true }: GameHelpModalProps) {
  const howToPlay = [...HOW_TO_PLAY, timed ? TIMEOUT_RULE : UNTIMED_RULE]

  return (
    <Modal onClose={onClose} open={open} title="게임 도움말">
      <div className="-mr-2 grid max-h-[62svh] gap-4 overflow-y-auto overscroll-contain pr-2">
        <section aria-label="진행 방법" className="grid gap-2">
          <h3 className="m-0 text-2xs font-bold tracking-[0.1em] text-content-muted uppercase">
            진행 방법
          </h3>
          <ol className="m-0 grid list-none gap-1.5 p-0">
            {howToPlay.map((line, index) => (
              <li className="flex gap-2 text-sm text-content" key={line}>
                <span
                  aria-hidden="true"
                  className="grid size-5 flex-none place-items-center rounded-full bg-surface text-2xs leading-none font-bold text-content-muted"
                >
                  {index + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="족보와 점수" className="grid gap-2">
          <h3 className="m-0 text-2xs font-bold tracking-[0.1em] text-content-muted uppercase">
            족보와 점수
          </h3>
          <ul className="m-0 grid list-none p-0">
            {[...YACHT_UPPER_CATEGORIES, ...YACHT_LOWER_CATEGORIES].map((category) => (
              <li
                className="grid grid-cols-[auto_7rem_1fr] items-center gap-2 border-b border-border/40 py-2 last:border-b-0"
                key={category}
              >
                <CategoryIcon category={category} className="size-4 flex-none text-content-muted" />
                <span className="text-xs font-semibold text-content">
                  {categoryLabel[category]}
                </span>
                <span className="text-xs text-content-muted">{categoryDescription[category]}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 rounded-card border border-border bg-surface px-3 py-2.5 text-xs text-content-muted">
            에이스~식스 소계가 {UPPER_BONUS_THRESHOLD}점 이상이면 보너스{' '}
            <strong className="text-brand-strong">+{UPPER_BONUS_POINTS}점</strong>을 받아요.
          </p>
        </section>
      </div>
    </Modal>
  )
}
