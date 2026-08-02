import type { FormEvent } from 'react'
import { cn } from '@/cn'
import { isCompleteRoomCode, sanitizeRoomCodeInput } from '@/roomCode'

interface LandingRoomCodePanelProps {
  code: string
  /** wide = 헤더 버튼에 붙는 팝오버, narrow = 바텀시트. 크기만 갈린다. */
  layout: 'narrow' | 'wide'
  onClose: () => void
  onCodeChange: (code: string) => void
  onSubmit: () => void
}

/**
 * "방 코드로 참가"를 누르면 열리는 코드 입력 패널. 데스크톱 팝오버와 모바일 바텀시트가
 * 같은 내용을 쓰므로 껍데기(팝오버·시트)만 호출부에서 다르게 씌운다.
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
  const wide = layout === 'wide'
  const ready = isCompleteRoomCode(code)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready) return
    onSubmit()
  }

  return (
    <form className="relative flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5 pr-12">
        <span className={cn('font-bold text-landing-text', wide ? 'text-[20px]' : 'text-[21px]')}>
          초대받은 방에 참가
        </span>
        <span className="text-[14px] text-landing-text-muted">
          친구가 보낸 초대 코드를 입력하세요
        </span>
      </div>

      <label className="sr-only" htmlFor="room-code">
        방 코드
      </label>
      <input
        aria-describedby="code-help"
        autoCapitalize="characters"
        autoComplete="off"
        className={cn(
          'w-full border bg-landing-field text-center font-mono font-bold tracking-[0.22em] text-landing-text placeholder:tracking-[0.18em] placeholder:text-landing-placeholder focus-visible:border-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
          wide ? 'h-18 rounded-[14px] text-[30px]' : 'h-[74px] rounded-[16px] text-[30px]',
          code.length > 0 ? 'border-landing-hairline-strong' : 'border-landing-hairline',
        )}
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
      <span className="text-[13px] text-landing-text-muted" id="code-help">
        소문자로 입력해도 대문자로 바뀌어요
      </span>

      <button
        className={cn(
          'flex items-center justify-center rounded-[16px] border-0 font-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-3',
          wide ? 'h-14 text-[17px]' : 'h-14.5 text-[18px]',
          ready
            ? 'cursor-pointer bg-landing-accent text-landing-accent-ink shadow-landing-cta'
            : 'cursor-not-allowed bg-landing-disabled text-landing-text-muted',
        )}
        disabled={!ready}
        type="submit"
      >
        코드로 참가
      </button>

      <button
        aria-label="코드 입력 닫기"
        className={cn(
          'absolute top-0 right-0 grid size-tap cursor-pointer place-items-center rounded-[11px] border border-landing-hairline-strong bg-transparent text-landing-text-muted transition-colors hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
          wide ? 'text-[14px]' : 'text-[15px]',
        )}
        onClick={onClose}
        type="button"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </form>
  )
}
