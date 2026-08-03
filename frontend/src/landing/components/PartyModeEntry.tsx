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
 * <b>wide에서만 그린다</b>(호출부에서 분기). 폰의 대시보드는 덜 좋은 경험이 아니라 틀린
 * 경험이라 비활성 버튼조차 두지 않는다 — 링크로 직접 들어온 경우는 `/party`가 안내로 받는다.
 * narrow 카드 안쪽은 280px뿐이라 버튼 두 개가 한 줄에 서지 못하고 쌓여, 그만큼 3D 영역을
 * 잃는 문제도 함께 피한다.
 */
const partyCta =
  'flex cursor-pointer items-center justify-center gap-2.5 rounded-[20px] border border-landing-hairline-strong bg-landing-well/70 font-bold text-landing-text backdrop-blur-sm transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:bg-landing-soft focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-3'

/** 플레이 CTA와 <b>같은 높이</b>다. 폭만 좁다 — primary가 면적으로 먼저 읽혀야 한다. */
const partyCtaSize = {
  narrow: 'h-15 flex-1 text-[17px]',
  wide: 'h-18 shrink-0 px-7 text-[19px]',
} as const

export function PartyModeEntry({
  layout,
  onOpen,
}: {
  layout: 'narrow' | 'wide'
  onOpen: () => void
}) {
  return (
    <button
      aria-label="파티 모드로 시작하기"
      className={cn(partyCta, partyCtaSize[layout])}
      onClick={onOpen}
      type="button"
    >
      <ScreenGlyph />
      파티 모드
    </button>
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
