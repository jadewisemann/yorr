/**
 * 화면 크롬(닫기·뒤로·소리·확인 등)에 쓰는 공용 아이콘.
 *
 * <b>규약은 {@link CategoryIcon}에서 그대로 가져온다</b> — 20×20 `viewBox`, 색은
 * `currentColor`, `aria-hidden` 고정, 크기는 호출부의 `className`이 정한다. 저장소에 이미
 * 아이콘 방식이 하나 있으므로 두 번째 방식을 만들지 않는다.
 *
 * <b>왜 이모지·글리프를 쓰지 않는가.</b> 여기 있는 아이콘들은 전부 `🔇`·`✕`·`✓`·`‹`처럼
 * 문자로 그려져 있었다. 문자는 세 가지를 못 한다: `currentColor`를 따르지 않아 이모지는
 * 무조건 플랫폼 색으로 나오고(모노톤 크롬에서 혼자 튄다), 폭과 베이스라인이 기기마다 달라
 * 같은 줄의 줄바꿈 지점까지 흔들리고, 글자라서 `size-*`로 크기를 통제할 수 없다.
 *
 * <b>`aria-hidden`이 고정인 이유.</b> 이 아이콘들은 전부 `aria-label`이 달린 아이콘 전용
 * 버튼 안이나 이미 텍스트가 있는 줄에 놓인다 — 접근 가능한 이름은 호출부가 책임지고,
 * 아이콘은 예외 없이 장식이다. 이름이 필요한 자리라면 아이콘이 아니라 텍스트를 넣어야 한다.
 *
 * 선은 `strokeWidth={1.8}` + 둥근 끝이다. `CategoryIcon`의 1.6보다 굵은 이유는 그쪽은
 * 20px 사각형과 원이고 이쪽은 12~28px에서 그려지는 선이라, 얇으면 끝이 깨져 보인다.
 */

interface IconProps {
  // DOM이 아니라 아래 Svg 컴포넌트로 넘기는 값이라 `| undefined`를 명시한다
  // (`exactOptionalPropertyTypes`).
  className?: string | undefined
}

/** 20×20 stroke 아이콘의 공통 껍데기. */
function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 20 20"
    >
      {children}
    </svg>
  )
}

/** 확인·완료. */
export function IconCheck({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4.25 10.5 8 14.25 15.75 5.75" />
    </Svg>
  )
}

/** 닫기·나가기. */
export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.25 5.25 14.75 14.75M14.75 5.25 5.25 14.75" />
    </Svg>
  )
}

/** 뒤로 가기. */
export function IconBack({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12.25 4.25 6.5 10l5.75 5.75" />
    </Svg>
  )
}

/**
 * 소리 켜짐/꺼짐 한 컴포넌트. 호출부가 `muted ? A : B`로 갈라 쓰던 자리라
 * 분기를 아이콘 안으로 들여 호출부에서 삼항을 없앤다.
 */
export function IconSound({ className, muted }: IconProps & { muted: boolean }) {
  return (
    <Svg className={className}>
      <path d="M3.25 7.75h2.5L9.75 4.5v11L5.75 12.25h-2.5z" />
      {muted ? (
        <path d="M12.75 8.25 16.75 12.25M16.75 8.25 12.75 12.25" />
      ) : (
        <>
          <path d="M12.75 7.5a3.5 3.5 0 0 1 0 5" />
          <path d="M15.25 5.25a6.75 6.75 0 0 1 0 9.5" />
        </>
      )}
    </Svg>
  )
}

/** 경고·주의. */
export function IconWarning({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 4.5v6.25" />
      <path d="M10 14.5h.01" />
    </Svg>
  )
}

/**
 * 펼침·접힘 표시. 닫힌 상태가 아래를 보고, 호출부가 `rotate-180`으로 뒤집는다 —
 * 두 방향을 각각 그리면 회전 트랜지션을 잃는다.
 */
export function IconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.25 8 10 12.75 14.75 8" />
    </Svg>
  )
}

/** 목록에서 건너뛴 구간. 가로 세 점. */
export function IconEllipsis({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.5 10h.01M10 10h.01M14.5 10h.01" />
    </Svg>
  )
}

/** 도움말. */
export function IconHelp({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7.4 7.6a2.6 2.6 0 1 1 2.6 2.6v1.55" />
      <path d="M10 14.75h.01" />
    </Svg>
  )
}
