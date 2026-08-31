import { GuessPad } from '@/davinci/components/GuessPad'
import { PlaceRail } from '@/davinci/components/PlaceRail'
import { Tile } from '@/davinci/components/Tile'
import type { DavinciPrompt } from '@/davinci/domain/davinci'
import type { DavinciDecision, DavinciTile } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'

interface ActionPanelProps {
  drawn: DavinciTile | null
  drawnLabel: string
  hand: readonly DavinciTile[]
  number: number | null
  onDecide: (decision: DavinciDecision) => void
  onGuess: () => void
  onPick: (value: number) => void
  onPlace: (index: number) => void
  prompt: DavinciPrompt
  sendError: string | null
  spectating: boolean
  targetName: string | null
  turnName: string
}

/**
 * 화면 아래쪽 조작부. **`prompt` 하나로만 갈린다** — phase·턴·탈락 여부를 여기서 다시
 * 조합하면 "내 차례인데 탈락했다" 같은 조합이 조용히 생긴다(`domain/davinci.ts`).
 */
export function ActionPanel({
  drawn,
  drawnLabel,
  hand,
  number,
  onDecide,
  onGuess,
  onPick,
  onPlace,
  prompt,
  sendError,
  spectating,
  targetName,
  turnName,
}: ActionPanelProps) {
  return (
    <section className="grid gap-2 pb-2">
      {/* 뽑은 타일의 색은 계약상 모두에게 보인다 — 숫자는 뽑은 사람 것만 채워져 온다.
          남이 무슨 색을 들고 있는지가 다음 턴의 추론 재료라 자기 차례가 아닐 때도 보여 준다. */}
      {drawn !== null && prompt !== 'place' && (
        <div className="flex items-center justify-center gap-2 text-game-content-faint text-sm">
          <span>{drawnLabel}</span>
          <Tile size="sm" tile={drawn} />
        </div>
      )}

      {prompt === 'guess' && (
        <GuessPad
          disabled={sendError !== null}
          onPick={onPick}
          onSubmit={onGuess}
          picked={number}
          targetName={targetName}
        />
      )}

      {prompt === 'decide' && (
        <div className="grid gap-2">
          <p className="m-0 text-center text-game-content-muted text-sm">
            맞혔어요. 한 번 더 부를까요?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => onDecide('CONTINUE')} size="lg">
              한 번 더
            </Button>
            <Button onClick={() => onDecide('STOP')} size="lg" variant="secondary">
              멈추기
            </Button>
          </div>
        </div>
      )}

      {prompt === 'place' && drawn !== null && (
        <PlaceRail hand={hand} joker={drawn} onPlace={onPlace} />
      )}

      {prompt === 'wait' && (
        <p className="m-0 py-3 text-center text-game-content-muted text-sm">
          {spectating ? '판을 지켜보는 중이에요.' : `${turnName} 님이 부르는 중이에요.`}
        </p>
      )}

      {prompt === 'eliminated' && (
        <p className="m-0 py-3 text-center text-game-content-muted text-sm">
          타일이 모두 공개돼 탈락했어요. 남은 판을 지켜봐요.
        </p>
      )}

      {sendError !== null && (
        <p className="m-0 text-center text-dv-accent text-sm" role="alert">
          {sendError}
        </p>
      )}
    </section>
  )
}
