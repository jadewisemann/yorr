import { cn } from '@/shared/cn'

/**
 * 파티 모드 진입 — 이 화면을 대시보드로 쓰고 다른 사람은 폰으로 붙는다.
 *
 * 카드 안 액션 클러스터에서 <b>플레이 왼쪽</b>에 선다. 같은 게임을 시작하는 다른 방식이라
 * 같은 자리에 있어야 읽힌다(초대 코드처럼 게임과 무관한 경로가 아니다).
 *
 * <b>채운 레드도 글로우도 쓰지 않는다.</b> 바로 옆에 화면에서 유일하게 빛나는 플레이 CTA가
 * 서 있어, 여기에 레드를 한 번 더 쓰면 무엇이 primary인지 사라진다. 대신 3D 위에 얹히는
 * 자리라 well 색만으로는 피사체가 비쳐 보이므로 backdrop blur를 함께 준다.
 *
 * 기본은 wide에서만 그리지만, 탁구는 모바일에서도 AI/친구 선택이 필요해 narrow에 함께
 * 노출한다. narrow 호출부는 두 CTA에 같은 폭을 주어 한 줄에서 글자가 깨지지 않게 한다.
 */
const partyCta =
  'flex cursor-pointer items-center justify-center gap-2.5 rounded-[20px] border border-landing-hairline-strong bg-landing-well/70 font-bold text-landing-text backdrop-blur-sm transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:bg-landing-soft focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-3'

/** 플레이 CTA와 <b>같은 높이</b>다. 폭만 좁다 — primary가 면적으로 먼저 읽혀야 한다. */
const partyCtaSize = {
  narrow: 'h-15 w-full min-w-0 gap-1.5 whitespace-nowrap px-2 text-[15px]',
  wide: 'h-18 shrink-0 px-7 text-[19px]',
} as const

export function PartyModeEntry({
  kind,
  layout,
  onOpen,
}: {
  kind: 'ai' | 'party'
  layout: 'narrow' | 'wide'
  onOpen: () => void
}) {
  const ai = kind === 'ai'
  return (
    <button
      aria-label={ai ? '탁구 AI와 대전' : '파티 모드로 시작하기'}
      className={cn(partyCta, partyCtaSize[layout])}
      onClick={onOpen}
      type="button"
    >
      {ai ? <OpponentGlyph /> : <ScreenGlyph />}
      {ai ? 'AI와 대전' : '파티 모드'}
    </button>
  )
}

function OpponentGlyph() {
  return (
    <span aria-hidden="true" className="flex items-center -space-x-1">
      <span className="size-3.5 rounded-full border-2 border-current/70" />
      <span className="size-3.5 rounded-full border-2 border-current/70" />
    </span>
  )
}

/**
 * 큰 화면 + 그 안의 QR. 방 코드 세 칸 글리프(`CodeGlyph`)가 "여기에 쳐 넣는다"를 말하듯,
 * 이건 "이 화면이 게임판이 된다"를 글자 없이 한 번 더 말한다.
 */
function ScreenGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 flex-none items-center justify-center rounded-[5px] border-2 border-current/55"
    >
      <span className="size-2 rounded-[1px] bg-current/70" />
    </span>
  )
}
