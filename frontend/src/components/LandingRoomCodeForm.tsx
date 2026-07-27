import type { FormEvent } from 'react'
import { cn } from '@/cn'
import { isCompleteRoomCode, sanitizeRoomCodeInput } from '@/roomCode'

interface LandingRoomCodeFormProps {
  code: string
  /** wide = 데스크톱 인라인 폼, narrow = 모바일 바텀시트 폼. */
  layout: 'narrow' | 'wide'
  onCodeChange: (code: string) => void
  onSubmit: () => void
}

export function LandingRoomCodeForm({
  code,
  layout,
  onCodeChange,
  onSubmit,
}: LandingRoomCodeFormProps) {
  const wide = layout === 'wide'
  const ready = isCompleteRoomCode(code)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready) return
    onSubmit()
  }

  return (
    <form
      className={cn(
        'flex items-center gap-2 rounded-full border py-1.5 pr-1.5',
        wide
          ? 'border-landing-hairline bg-landing-well pl-[18px]'
          : 'border-landing-hairline-strong bg-landing-soft pl-4',
      )}
      onSubmit={handleSubmit}
    >
      <label
        className="text-[13px] font-landing-bold whitespace-nowrap text-landing-text-secondary"
        htmlFor="room-code"
      >
        방 코드
      </label>
      <input
        aria-describedby="code-help"
        autoCapitalize="characters"
        autoComplete="off"
        className={cn(
          'border-0 bg-transparent text-center font-mono text-[20px]/none font-landing-bold text-landing-text placeholder:text-landing-placeholder focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
          wide
            ? 'h-11 w-[148px] rounded-[10px] tracking-[0.18em]'
            : 'h-12 min-w-0 flex-1 rounded-xl tracking-[0.16em]',
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
      <button
        className={cn(
          'flex-none rounded-full border-0 px-[22px] font-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-3',
          wide ? 'h-11 text-[14px]' : 'h-12 text-[15px]',
          ready
            ? 'cursor-pointer bg-landing-accent text-landing-accent-ink'
            : cn(
                'cursor-not-allowed bg-landing-disabled',
                wide ? 'text-landing-text-faint' : 'text-landing-text-muted',
              ),
        )}
        disabled={!ready}
        type="submit"
      >
        참가
      </button>
    </form>
  )
}
