import { Shell, Warn } from '@/duel/components/Arena'
import { DRAW_PENALTY_MS, drawOutcome, MAX_FOULS, MAX_HP, msLabel, slots } from '@/duel/domain/duel'
import type { DuelState } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { ControllerScreen } from '@/shared/components/Screen'
import type { SwingPermission } from '@/shared/useSwing'

/**
 * 파티 모드 폰 화면 — 손 안의 리볼버. (S15P11A406-207)
 *
 * 결투는 큰 화면에서 벌어진다. 두 총잡이·총알·석양은 TV가 그리고, 폰은 <b>뽑는 일</b>만 한다.
 * 그래서 여기에 무대(Arena)를 축소해 넣지 않는다 — 같은 것을 두 화면에 그리면 폰을 보는
 * 동안 TV의 연출을 놓치고, 세로 그립에 억지로 접어 넣은 무대는 둘 다 못 읽는 화면이 된다.
 *
 * 대신 아래를 <b>보지 않고도</b> 알아야 하는 것만 남긴다: 신호가 초록인가, 내 탄약이 몇 발
 * 남았나, 경고가 몇 개 쌓였나. 판정은 서버가 하고 이 화면은 상태를 읽기만 한다.
 */

interface DuelControllerProps {
  error: string | null
  nickname: string
  /** 화면을 눌러 뽑기. 스윙은 부모(DuelGame)의 useSwing이 같은 곳으로 보낸다. */
  onDraw: () => void
  onEnableMotion: () => void
  onLeave: () => void
  opponentName: string
  permission: SwingPermission
  playerId: string
  state: DuelState
}

/** 신호등이 지금 무슨 색인가 — 폰이 아는 것은 이 넷뿐이다. */
type ControllerSignal = 'hold' | 'draw' | 'result' | 'waiting'

function signalOf(state: DuelState, playerId: string): ControllerSignal {
  if (state.phase === 'RESULT' || state.phase === 'FINISHED') return 'result'
  // 한 라운드에 한 발이다. 이미 뽑았으면 초록이라도 더 할 일이 없다.
  if (state.phase === 'SIGNAL') return state.reactions[playerId] === undefined ? 'draw' : 'waiting'
  return 'hold'
}

export function DuelController({
  error,
  nickname,
  onDraw,
  onEnableMotion,
  onLeave,
  opponentName,
  permission,
  playerId,
  state,
}: DuelControllerProps) {
  const signal = signalOf(state, playerId)
  const fouls = state.fouls[playerId] ?? 0
  const myMs = state.reactions[playerId] ?? null
  const rival = state.playerOrder.find((id) => id !== playerId) ?? ''
  // 뽑기는 신호 전에도 받는다 — 성급하게 당기는 것도 플레이의 일부이고, 부정출발 판정은
  // 서버 몫이다. 눌러도 아무 일 없는 버튼으로 막으면 "안 눌린 것"과 구별되지 않는다.
  const live = signal === 'hold' || signal === 'draw'

  return (
    <ControllerScreen className="bg-duel-canvas">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-2xs tracking-[0.18em] text-duel-accent/60">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <GameChromeButton onClick={onLeave}>나가기</GameChromeButton>
      </header>

      {/* 기록(ms)은 판정이 난 뒤에만, 그리고 <b>여기에만</b> 뜬다. 유예 중에 상대 기록이
          보이면 승부가 김이 새고, 같은 숫자를 가운데 문구와 여기 둘 다 쓰면 좁은 화면에서
          같은 것을 두 번 읽는다. */}
      <section
        aria-label="탄약과 경고"
        className="mt-4 grid flex-none grid-cols-2 gap-2 rounded-card border border-white/12 bg-white/6 p-3"
      >
        <AmmoRow
          fouls={fouls}
          hp={state.hp[playerId] ?? 0}
          label="나"
          ms={myMs}
          showMs={signal === 'result'}
        />
        <AmmoRow
          fouls={state.fouls[rival] ?? 0}
          hp={state.hp[rival] ?? 0}
          label={opponentName}
          ms={state.reactions[rival] ?? null}
          showMs={signal === 'result'}
        />
      </section>

      <button
        aria-label="뽑기"
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-duel-accent/20 bg-[radial-gradient(circle_at_50%_40%,rgb(255_207_138_/_10%),transparent_62%)] active:bg-white/8"
        onPointerDown={(event) => {
          event.preventDefault()
          onDraw()
        }}
        type="button"
      >
        <Lamp signal={signal} />
        <DrawPrompt
          ms={myMs}
          opponentName={opponentName}
          permission={permission}
          signal={signal}
          state={state}
          you={playerId}
        />
      </button>

      <section className="mt-3 grid flex-none gap-2 text-center">
        {/* 경고는 신호를 기다리는 동안에만 세운다 — 판정 문구와 겹쳐 읽히면 둘 다 안 읽힌다. */}
        {live && fouls > 0 && (
          <p className="m-0 text-sm font-bold text-duel-gold" role="status">
            부정출발 경고 {fouls}/{MAX_FOULS} ·{' '}
            {fouls >= MAX_FOULS - 1 ? '한 번 더면 자기 발을 쏜다' : '신호를 보고 뽑아라'}
          </p>
        )}
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-card border border-duel-signal/50 bg-duel-signal/15 px-5 font-bold text-duel-accent-soft transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={onEnableMotion}
            type="button"
          >
            휴대폰 휘두르기 켜기
          </button>
        )}
        <DrawSourceStatus permission={permission} />
        {error && (
          <p className="m-0 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </section>
    </ControllerScreen>
  )
}

/**
 * 큰 신호등. 무대의 SignalLamp와 달리 매달린 줄도 간판도 없다 — 폰에서는 이것이 화면의
 * 중심이고, 초록인지 아닌지가 한 번의 눈길로 읽혀야 한다.
 */
function Lamp({ signal }: { signal: ControllerSignal }) {
  const green = signal === 'draw'
  const dim = signal === 'result' || signal === 'waiting'
  const face = green ? '#22c55e' : dim ? '#3d1a1a' : '#ef4444'
  const glow = green ? '#4ade80' : dim ? '#5b2323' : '#ef4444'

  return (
    <span
      aria-hidden="true"
      className={`absolute top-[14%] left-1/2 block aspect-square -translate-x-1/2 rounded-full ${green ? 'animate-duel-lamp-pop' : ''}`}
      key={signal}
      style={{
        background: `radial-gradient(circle at 40% 34%, ${green ? '#ffffff' : dim ? '#6b3030' : '#ffd0d0'} 0%, ${face} 55%, #1a0a0a 100%)`,
        border: '4px solid #2a1a12',
        boxShadow: `0 0 ${green ? 56 : 24}px ${glow}, inset 0 0 16px rgb(0 0 0 / 45%)`,
        width: 'min(38vw, 150px)',
      }}
    />
  )
}

/** 지금 무엇을 해야 하는가 — 신호 아래 한 줄. */
function DrawPrompt({
  ms,
  opponentName,
  permission,
  signal,
  state,
  you,
}: {
  ms: number | null
  opponentName: string
  permission: SwingPermission
  signal: ControllerSignal
  state: DuelState
  you: string
}) {
  if (signal === 'result') {
    const outcome = drawOutcome(state, you)
    const tone =
      outcome.tone === 'win'
        ? 'text-duel-positive'
        : outcome.tone === 'lose'
          ? 'text-duel-danger'
          : ''
    return (
      <Prompt sub={undefined} tone={tone}>
        {outcome.label}
      </Prompt>
    )
  }
  if (signal === 'waiting') {
    return (
      <Prompt sub={`${opponentName}를 기다린다`} tone="text-duel-accent">
        {msLabel(ms)}
      </Prompt>
    )
  }
  if (signal === 'draw') {
    return (
      <Prompt tone="text-duel-positive" sub={undefined}>
        뽑아!
      </Prompt>
    )
  }
  return (
    <Prompt sub={holdHint(permission)} tone="text-white/45">
      기다려
    </Prompt>
  )
}

function Prompt({
  children,
  sub,
  tone,
}: {
  children: string
  sub: string | undefined
  tone: string
}) {
  return (
    <span className="absolute inset-x-4 bottom-[12%] grid justify-items-center gap-1.5 text-center">
      <strong className={`text-4xl font-black ${tone}`}>{children}</strong>
      {sub && <span className="text-sm text-white/50">{sub}</span>}
    </span>
  )
}

function holdHint(permission: SwingPermission): string {
  return permission === 'granted' ? '초록이 되면 폰을 휘둘러라' : '초록이 되면 화면을 눌러라'
}

/**
 * 무엇으로 뽑고 있는지, 그게 불리한지.
 *
 * 페널티를 숨기지 않는다 — 왜 계속 지는지 모르는 것보다 "화면 탭은 스윙보다 100ms 느리게
 * 기록된다"고 알고 지는 편이 낫다. 알면 폰을 휘두르러 간다.
 */
function DrawSourceStatus({ permission }: { permission: SwingPermission }) {
  if (permission === 'granted') {
    return (
      <p className="m-0 text-sm font-bold text-duel-positive" role="status">
        스윙 연결됨 · 폰을 휘둘러 뽑는다
      </p>
    )
  }
  if (permission === 'unknown') return null
  return (
    <p className="m-0 text-sm text-amber-200" role="status">
      모션 센서를 쓸 수 없어 화면 탭으로 뽑는다 · 스윙보다 {DRAW_PENALTY_MS.tap}ms 느리게 기록된다
    </p>
  )
}

/** 이름 + 남은 탄약 + 경고. 무대의 Plate와 같은 칸을 쓰되 세로 그립에 맞춰 접었다. */
function AmmoRow({
  fouls,
  hp,
  label,
  ms,
  showMs,
}: {
  fouls: number
  hp: number
  label: string
  ms: number | null
  showMs: boolean
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-black text-duel-ink">{label}</span>
        <span className="flex flex-none items-center gap-0.5">
          {slots('warn', MAX_FOULS, fouls).map((slot) => (
            <Warn key={slot.id} lit={slot.filled} />
          ))}
        </span>
      </span>
      <span className="flex gap-1">
        {slots('shell', MAX_HP, hp).map((slot) => (
          <Shell key={slot.id} live={slot.filled} />
        ))}
      </span>
      {/* 자리는 늘 잡아 둔다 — 기록이 뜰 때마다 위 칸이 밀려 올라가면 눈이 따라가지 못한다. */}
      <span className="min-h-4 font-mono text-2xs text-white/40">
        {showMs && ms !== null ? msLabel(ms) : null}
      </span>
    </div>
  )
}
