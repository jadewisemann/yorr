import { type ReactNode, type RefObject, useState } from 'react'
import { type AudioLevels, audioLevels, setAudioLevel } from '@/shared/audio/audioLevels'
import { applyMusicLevel } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { IconMusic, IconSound } from '@/shared/components/Icon'
import { Popover, PopoverHeader } from '@/shared/components/Popover'

interface AudioPopoverProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  onClose: () => void
  onToggleMute: () => void
  open: boolean
  muted: boolean
}

export function AudioPopover({ anchorRef, muted, onClose, onToggleMute, open }: AudioPopoverProps) {
  const [levels, setLevels] = useState<AudioLevels>(audioLevels)

  const change = (kind: keyof AudioLevels, value: number) => {
    setAudioLevel(kind, value)
    setLevels({ ...audioLevels() })
    if (kind === 'music') applyMusicLevel()
  }

  return (
    <Popover anchorRef={anchorRef} label="오디오 설정" onClose={onClose} open={open}>
      <PopoverHeader onClose={onClose}>오디오</PopoverHeader>

      <Button
        className="mt-2 w-full justify-center"
        onClick={onToggleMute}
        variant={muted ? 'primary' : 'secondary'}
      >
        {muted ? '소리 켜기' : '전체 음소거'}
      </Button>

      <div className="mt-5 grid gap-4">
        <LevelSlider
          icon={<IconMusic className="size-4.5 flex-none text-content-muted" />}
          label="배경음"
          muted={muted}
          onChange={(value) => change('music', value)}
          value={levels.music}
        />
        <LevelSlider
          icon={<IconSound className="size-4.5 flex-none text-content-muted" muted={false} />}
          label="효과음"
          hint="주사위·족보 음성"
          muted={muted}
          onChange={(value) => change('effects', value)}
          value={levels.effects}
        />
      </div>
    </Popover>
  )
}

function LevelSlider({
  hint,
  icon,
  label,
  muted,
  onChange,
  value,
}: {
  hint?: string
  icon: ReactNode
  label: string
  muted: boolean
  onChange: (value: number) => void
  value: number
}) {
  const percent = Math.round(value * 100)

  return (
    <section className={cn('grid gap-1.5', muted && 'opacity-45')}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {label}
        {hint && <span className="text-xs font-medium text-content-faint">{hint}</span>}
        <span className="ml-auto font-mono text-xs font-bold text-content-muted tabular-nums">
          {muted ? '음소거' : `${percent}%`}
        </span>
      </div>
      <input
        aria-label={`${label} 볼륨`}
        aria-valuetext={muted ? '음소거' : `${percent}퍼센트`}
        className={cn(
          'h-6 w-full',
          muted ? 'cursor-not-allowed accent-content-faint' : 'cursor-pointer accent-brand',
          'focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2',
        )}
        disabled={muted}
        max={1}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        step={0.05}
        type="range"
        value={value}
      />
    </section>
  )
}
