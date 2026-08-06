import type { FormEvent } from 'react'
import { isCompleteRoomCode, sanitizeRoomCodeInput } from '@/room/domain/roomCode'
import { IconClose } from '@/shared/components/Icon'

interface LandingRoomCodePanelProps {
  code: string
  layout: 'narrow' | 'wide'
  onClose: () => void
  onCodeChange: (code: string) => void
  onSubmit: () => void
}

/**
 * "방 코드로 참가"를 누르면 열리는 코드 입력 팝업의 내용.
 *
 * 레퍼런스는 코드를 네 칸으로 쪼개 그렸지만, 실제 방 코드는 4~12자다(`roomCode.ts`) —
 * 칸을 고정하면 5자 이상인 코드를 아예 입력할 수 없으므로 한 칸짜리 mono 필드로 옮긴다.
 * 닫기 ✕는 DOM 마지막에 두고 위치만 올린다 — 시트가 첫 포커스 대상을 코드 입력으로 잡게 한다.
 */
export function LandingRoomCodePanel({
  code,
  layout,
  onClose,
  onCodeChange,
  onSubmit,
}: LandingRoomCodePanelProps) {
  const narrow = layout === 'narrow'
  const ready = isCompleteRoomCode(code)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready) return
    onSubmit()
  }

  return (
    <form
      className={`relative flex flex-col ${narrow ? 'gap-3' : 'gap-4'}`}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5 pr-12">
        <span className={`${narrow ? 'text-base' : 'text-xl'} font-bold text-landing-text`}>
          초대받은 방에 참가
        </span>
        {!narrow && (
          <span className="text-sm text-landing-text-muted">
            친구가 보낸 초대 코드를 입력하세요
          </span>
        )}
      </div>

      <div className={`flex ${narrow ? 'gap-2' : 'flex-col gap-4'}`}>
        <label className="sr-only" htmlFor="room-code">
          방 코드
        </label>
        <input
          aria-describedby="code-help"
          autoCapitalize="characters"
          autoComplete="off"
          className={`${narrow ? 'h-12 min-w-0 flex-1 rounded-control text-lg tracking-[0.14em]' : 'h-18 w-full rounded-card text-3xl tracking-[0.22em]'} border bg-landing-field text-center font-mono font-bold text-landing-text placeholder:tracking-[0.18em] placeholder:text-landing-placeholder focus-visible:border-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 ${code.length > 0 ? 'border-landing-hairline-strong' : 'border-landing-hairline'}`}
          id="room-code"
          // maxLength는 두지 않는다 — 브라우저가 정규화 전 원문을 먼저 잘라내서
          // 초대 URL을 붙여넣으면 앞 12자("https://yorr")만 남아 엉뚱한 코드가 통과한다.
          // 길이 제한은 sanitizeRoomCodeInput이 기호를 제거한 뒤에 건다.
          name="room-code"
          onChange={(event) => onCodeChange(sanitizeRoomCodeInput(event.target.value))}
          placeholder="YORR64"
          spellCheck={false}
          type="text"
          value={code}
        />
        <button
          // 비활성 이유를 버튼에도 물린다 — 포커스가 여기 왔을 때 라벨만 읽히면
          // 무엇을 고쳐야 눌리는지 알 수 없다.
          aria-describedby="code-help"
          className={`flex items-center justify-center border-0 font-bold whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-3 pressable ${
            narrow ? 'h-12 rounded-control px-3 text-sm' : 'h-14 rounded-card text-base'
          } ${
            ready
              ? 'cursor-pointer bg-landing-accent text-landing-accent-ink shadow-landing-cta'
              : 'cursor-not-allowed bg-landing-disabled text-landing-text-muted'
          }`}
          disabled={!ready}
          type="submit"
        >
          코드로 참가
        </button>
      </div>
      {/* 입력 규칙을 여기서 말한다. 아래 제출 버튼이 규칙을 만족할 때까지 비활성이라,
          이 문장이 없으면 "왜 눌리지 않는가"에 답하는 것이 화면에 하나도 없다. */}
      <span className={`${narrow ? 'text-2xs' : 'text-xs'} text-landing-text-muted`} id="code-help">
        영문·숫자 4~12자 · 소문자로 입력해도 대문자로 바뀌어요
      </span>

      <button
        aria-label="코드 입력 닫기"
        className="absolute top-0 right-0 grid size-tap cursor-pointer place-items-center rounded-control border border-landing-hairline-strong bg-transparent text-landing-text-muted transition-colors hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable"
        onClick={onClose}
        type="button"
      >
        <IconClose className="size-3.5" />
      </button>
    </form>
  )
}
