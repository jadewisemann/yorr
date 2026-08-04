import { type ReactNode, useState } from 'react'
import { type AudioLevels, audioLevels, setAudioLevel } from '@/shared/audio/audioLevels'
import { applyMusicLevel } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Button } from '@/shared/components/Button'
import { IconMic, IconMusic, IconSound } from '@/shared/components/Icon'

interface AudioSheetProps {
  onClose: () => void
  onToggleMute: () => void
  open: boolean
  /**
   * 마이크 행. 음성 채팅이 쓸 수 없는 환경(HTTPS 아님·기기 없음)이면 undefined를 넘긴다 —
   * 그러면 행 자체가 없다. 눌러도 실패하는 버튼을 남기면 사용자가 자기 잘못이라고 생각한다.
   */
  microphone?:
    | {
        connectedPeers: number
        onToggle: () => void
        on: boolean
        requesting: boolean
        denied: boolean
      }
    | undefined
  muted: boolean
}

/**
 * 소리 관련 조작을 한 자리에 모은 시트.
 * <p>
 * 헤더의 소리 버튼이 이걸 연다. 마이크를 헤더에 따로 두면 320px에서 턴 표시가 한 글자씩
 * 세로로 접히고, 트레이에 띄우면 주사위 위에 버튼이 겹쳐 답답하다 — 버튼 개수를 늘리지 않고
 * 소리 입구를 하나로 만드는 쪽을 골랐다.
 * <p>
 * 음소거가 1탭에서 2탭이 된다. 시끄러운 곳에서 급하게 끄는 동작이 아니라 조용한 곳에서 한 번
 * 정하는 성격이라 감당한다고 봤고, 대신 전체 음소거를 시트 맨 위에 둬 경로를 짧게 유지한다.
 */
export function AudioSheet({ microphone, muted, onClose, onToggleMute, open }: AudioSheetProps) {
  // 슬라이더는 드래그 중 매 프레임 렌더돼야 하므로 화면 상태를 따로 든다.
  // 진짜 값은 audioLevels(메모리 + localStorage)가 들고 있다.
  const [levels, setLevels] = useState<AudioLevels>(audioLevels)

  const change = (kind: keyof AudioLevels, value: number) => {
    setAudioLevel(kind, value)
    setLevels({ ...audioLevels() })
    // 배경음은 계속 흐르므로 즉시 반영해야 한다. 효과음은 다음 소리에서 알아서 읽는다.
    if (kind === 'music') applyMusicLevel()
  }

  return (
    <BottomSheet className="h-auto max-h-[76%]" onClose={onClose} open={open} title="오디오 설정">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className="m-0 text-[17px] font-bold">오디오</h2>
        <button
          className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-content-muted hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
      </div>

      {/* 전체 음소거를 맨 위에 둔다 — 가장 자주 쓰는 조작이 가장 얕은 자리에 있어야 한다. */}
      <Button
        className="mt-2 w-full justify-center"
        onClick={onToggleMute}
        variant={muted ? 'primary' : 'secondary'}
      >
        {muted ? '소리 켜기' : '전체 음소거'}
      </Button>

      <div className="mt-5 grid gap-5">
        {microphone && (
          <section className="grid gap-2 rounded-panel border border-border bg-surface-raised p-3.5">
            <div className="flex items-center gap-2">
              <IconMic className="size-4.5 flex-none text-content-muted" />
              <span className="text-[15px] font-semibold">마이크</span>
              <span className="ml-auto text-[13px] text-content-muted tabular-nums">
                {microphoneStatusLabel(microphone)}
              </span>
            </div>
            <Button
              className="w-full justify-center"
              disabled={microphone.requesting}
              loading={microphone.requesting}
              onClick={microphone.onToggle}
              variant={microphone.on ? 'danger' : 'primary'}
            >
              {microphone.on ? '음성 채팅 끄기' : '음성 채팅 켜기'}
            </Button>
            {microphone.denied && (
              <p className="m-0 text-[13px] text-warning">
                브라우저가 마이크를 막았어요. 주소창의 권한 설정에서 허용한 뒤 다시 눌러 주세요.
              </p>
            )}
            {microphone.on && (
              <p className="m-0 text-[13px] text-content-faint">
                특정 사람 목소리만 끄려면 참가자 이름 옆 마이크를 누르세요.
              </p>
            )}
          </section>
        )}

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
    </BottomSheet>
  )
}

function microphoneStatusLabel(microphone: NonNullable<AudioSheetProps['microphone']>) {
  if (microphone.requesting) return '권한 요청 중'
  if (microphone.denied) return '권한 거부됨'
  if (!microphone.on) return '꺼짐'
  return microphone.connectedPeers > 0 ? `${microphone.connectedPeers}명 연결됨` : '연결 대기 중'
}

/**
 * 전체 음소거 중에는 값을 0으로 내리지 않는다. 슬라이더 위치는 **켰을 때 돌아갈 값**이라,
 * 표시를 위해 덮어쓰면 사용자가 맞춰 둔 크기가 사라진다(끄고 켤 때마다 다시 맞춰야 한다).
 * 대신 행 전체를 흐리게 하고 트랙 색을 빼고 값 자리에 "음소거"를 적어 **지금 듣지 않는다**는
 * 것만 말한다 — 브랜드 색으로 채워진 트랙이 "이만큼 들린다"로 읽히던 게 문제였다.
 * 조작도 막는다. 여기서 끌면 소리가 날 것 같지만 실제로는 음소거가 이기므로 아무 일도 없다.
 */
function LevelSlider({
  hint,
  icon,
  label,
  muted,
  onChange,
  value,
}: {
  hint?: string
  /** 줄 앞 아이콘. 공용 `Icon`을 넘긴다 — 이모지는 모노톤 크롬에서 혼자 튄다. */
  icon: ReactNode
  label: string
  muted: boolean
  onChange: (value: number) => void
  value: number
}) {
  const percent = Math.round(value * 100)

  return (
    <section className={cn('grid gap-1.5', muted && 'opacity-45')}>
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        {icon}
        {label}
        {hint && <span className="text-[12px] font-medium text-content-faint">{hint}</span>}
        <span className="ml-auto font-mono text-[13px] font-bold text-content-muted tabular-nums">
          {muted ? '음소거' : `${percent}%`}
        </span>
      </div>
      {/*
        네이티브 range를 쓴다. 직접 만들면 키보드 조작(←/→·Home/End)·스크린리더 값 낭독·
        터치 드래그를 전부 다시 구현해야 하고 브라우저가 이미 다 갖고 있다.
        accent-brand 하나로 손잡이와 채워진 트랙에 브랜드 색이 같이 붙는다.
      */}
      <input
        aria-label={`${label} 볼륨`}
        aria-valuetext={muted ? '음소거' : `${percent}퍼센트`}
        className={cn(
          'h-6 w-full',
          // 음소거 중에는 브랜드 색을 뺀다 — 채워진 빨간 트랙이 "이만큼 들린다"로 읽힌다.
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
