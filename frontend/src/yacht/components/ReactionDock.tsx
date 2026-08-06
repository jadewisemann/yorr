import type { CSSProperties } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
/**
 * 계약(`wsEvents.ts`)의 `ReactionType` 5종 ↔ 화면 이모지. 배열 순서가 픽커에 놓이는 순서다.
 * 이모지는 화면에만 살고 와이어에는 `type` 문자열만 흐른다 — 서버는 이 표를 모른다.
 */
import { DRIFTS, LIFTS, REACTIONS } from '@/yacht/domain/reactions'
import { useReactionDock } from '@/yacht/model/useReactionDock'

interface ReactionDockProps {
  className?: string
  /** 닉네임을 붙여 "누가 보냈는지" 읽히게 한다. */
  players: Player[]
}

/**
 * 이모지 리액션 — 버튼 하나를 눌러 펼치고, 고른 이모지가 방 전원의 화면에서 솟아오른다.
 * <p>
 * 전송은 `reaction.send`, 수신은 `reaction.broadcast`로 이미 서버에 구현돼 있다
 * (`GameWebSocketHandler.handleReactionSend`). 서버는 보낸 본인에게도 되돌려주므로
 * 내가 누른 이모지도 남과 같은 경로로 뜬다 — 낙관적 렌더링을 따로 두지 않는다.
 * <p>
 * 뜬 이모지는 휘발성 연출이라 전역 store에 넣지 않고 여기서 소켓을 직접 구독한다.
 */
export function ReactionDock({ className, players }: ReactionDockProps) {
  const {
    chipsRef,
    close,
    dockRef,
    flying,
    focusedChip,
    handleChipKeyDown,
    open,
    pickerId,
    send,
    setOpen,
    triggerRef,
  } = useReactionDock(players)

  const latest = flying.at(-1)

  return (
    <div className={cn('relative flex-none', className)} ref={dockRef}>
      {/* 떠오르는 이모지는 장식이라 aria-hidden이고, 낭독은 이 줄이 대신한다
          (6명이 연타할 때 이모지마다 읽히면 소음이 된다 — polite로 최신 하나만). */}
      <p aria-live="polite" className="sr-only" role="status">
        {latest ? `${latest.nickname} ${latest.label}` : ''}
      </p>

      {flying.map((item) => (
        <span
          aria-hidden="true"
          // bottom-full: 버튼 바로 위에서 출발한다. w-tap + items-center로 버튼 중심에 정렬.
          // 이 위쪽 통로는 비워 둔다 — 픽커를 여기(bottom-full)에 두었을 때 막 보낸 이모지가
          // 그 판 뒤에서 떠올라, 연달아 눌러도 아무 일도 일어나지 않는 것처럼 보였다.
          // 그래서 픽커는 트리거 왼쪽(right-full)으로 비켰다.
          // motion-reduce에서는 제자리에 뜬 채로 FLIGHT_MS 뒤 사라진다 — "누가 리액션을
          // 보냈다"는 정보는 남기고 움직임만 뺀다(RollResultCallout과 같은 처리).
          // translate-x/y-(--drift/--lift): 애니메이션이 도는 동안은 keyframe의 transform이
          // 이겨서 무시되고, motion-reduce로 애니메이션이 없을 때만 적용된다 — 그래야 동시에
          // 온 리액션이 한 점에 겹쳐 하나처럼 보이지 않는다. 좌우(--drift)만으로는 같은
          // 높이에 한 줄로 서므로 세로(--lift)까지 흔든다.
          // items-end: 닉네임 필(max-w-24)은 버튼(w-tap)보다 넓다 — 가운데 정렬이면 버튼
          // 오른쪽으로 26px 삐져나가고, 독이 화면 오른쪽 끝에 붙어 있으므로 그만큼 뷰포트를
          // 넘어 잘렸다. 오른쪽 끝을 맞추면 넘치는 쪽이 안쪽(왼쪽)으로만 자란다.
          className="pointer-events-none absolute right-0 bottom-full flex w-tap translate-x-(--drift) translate-y-(--lift) flex-col items-end gap-1 animate-reaction-float motion-reduce:animate-none"
          key={item.id}
          style={
            {
              '--drift': DRIFTS[item.id % DRIFTS.length],
              '--lift': LIFTS[item.id % LIFTS.length],
            } as CSSProperties
          }
        >
          <span className="text-3xl leading-none drop-shadow-[0_2px_10px_rgb(0_0_0_/_60%)]">
            {item.emoji}
          </span>
          {item.nickname && (
            <span className="max-w-24 truncate rounded-full bg-surface-overlay/90 px-1.5 py-px text-2xs font-semibold whitespace-nowrap text-content-muted">
              {item.nickname}
            </span>
          )}
        </span>
      ))}

      {/* 픽커는 항상 마운트해두고 열림/닫힘만 전환한다 — 마운트/언마운트가 아니라 상태
          전환이라 CSS transition으로 충분하다(motion은 진입·퇴장용). absolute로 띄워
          닫혔을 때 버튼을 아래로 밀지 않게 한다.
          <b>트리거 위가 아니라 옆(right-full)으로 편다.</b> 위에 두면 판이 이모지가 솟는
          자리를 정확히 덮는다 — 날아오르는 첫 구간(-1rem 언저리)이 통째로 판 뒤라 연타해도
          화면이 조용했고, motion-reduce에서는 제자리에 뜨므로 아예 보이지 않았다.
          옆으로 비키면 위쪽 통로가 열려 모바일·데스크톱 모두 누른 즉시 이모지가 보인다.
          독은 화면 오른쪽 끝에 붙어 있으니 왼쪽으로만 자란다 — 지원 하한 320px에서도
          픽커 왼쪽 끝이 37.8px에 선다(실측). 여섯 번째 칸을 늘리기 전에는 이 폭을 다시 잰다. */}
      <div
        aria-label="리액션 고르기"
        aria-orientation="horizontal"
        className={cn(
          'absolute top-1/2 right-full mr-2 flex -translate-y-1/2 gap-0.5 rounded-panel border border-border bg-surface-overlay/95 p-1 shadow-raised transition-all duration-(--ds-motion-fast) ease-snappy',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
        )}
        id={pickerId}
        onKeyDown={handleChipKeyDown}
        // 여러 버튼이 한 덩어리로 움직이는 묶음이다 — toolbar로 알리면 보조기기가 방향키
        // 이동을 예고하고, Tab은 픽커 전체를 한 칸으로 지나간다.
        role="toolbar"
        style={{ transformOrigin: 'right center' }}
      >
        {REACTIONS.map((reaction, index) => (
          <button
            aria-label={reaction.label}
            // active:scale-90 — 리액션은 서버를 한 바퀴 돌아 와야 화면에 뜬다. 그 사이가
            // 무반응으로 읽혀 "눌렸나?" 하고 다시 누르게 된다. 누르는 순간의 응답은 칩이
            // 직접 낸다(전송 성공을 뜻하지 않는다 — 그것은 떠오르는 이모지가 말한다).
            className="reaction-chip focus-ring active:scale-90"
            key={reaction.type}
            onClick={() => send(reaction.type)}
            ref={(element) => {
              chipsRef.current[index] = element
            }}
            // 닫힌 픽커가 탭 순서에 남으면 포커스가 보이지 않는 곳으로 들어간다.
            // 열려 있을 때도 Tab에 걸리는 것은 현재 칸 하나뿐이다(roving tabindex) —
            // 다섯 칸이 각각 Tab을 먹으면 헤더까지 가는 데 다섯 번을 더 눌러야 한다.
            tabIndex={open && index === focusedChip ? 0 : -1}
            type="button"
          >
            {reaction.emoji}
          </button>
        ))}
      </div>

      <button
        aria-controls={pickerId}
        aria-expanded={open}
        aria-label="리액션 보내기"
        className={cn(
          'grid size-tap cursor-pointer place-items-center rounded-card border border-border bg-surface/90 text-lg shadow-raised transition-colors focus-ring',
          open && 'border-brand bg-brand/15',
        )}
        onClick={() => (open ? close(false) : setOpen(true))}
        ref={triggerRef}
        type="button"
      >
        {/* 픽커 5종과 겹치지 않는 글리프여야 한다 — 🙂는 🫡와 나란히 놓으면 같은 얼굴로 읽힌다.
            aria-label이 있으니 글리프를 aria-hidden으로 감싸지 않는다 — 이름은 이미 덮인다. */}
        💬
      </button>
    </div>
  )
}
