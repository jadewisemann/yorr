interface IconProps {
  className?: string | undefined
}

function Dot({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return <circle cx={cx} cy={cy} fill="currentColor" r={r} stroke="none" />
}

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

export function IconCheck({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4.25 10.5 8 14.25 15.75 5.75" />
    </Svg>
  )
}

export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.25 5.25 14.75 14.75M14.75 5.25 5.25 14.75" />
    </Svg>
  )
}

export function IconBack({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12.25 4.25 6.5 10l5.75 5.75" />
    </Svg>
  )
}

export function IconSound({ className, muted }: IconProps & { muted: boolean }) {
  return (
    <Svg className={className}>
      <path d="M3.25 7.75h2.5L9.75 4.5v11L5.75 12.25h-2.5z" />
      {muted ? (
        <path d="M13.25 8.5 16.5 11.75M16.5 8.5 13.25 11.75" />
      ) : (
        <>
          <path d="M12.75 7.5a3.5 3.5 0 0 1 0 5" />
          <path d="M15.25 5.25a6.75 6.75 0 0 1 0 9.5" />
        </>
      )}
    </Svg>
  )
}

export function IconChat({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16.6 11.3a1.8 1.8 0 0 1-1.8 1.8H7.9L4.4 16.1a.5.5 0 0 1-.8-.4V5.7a1.8 1.8 0 0 1 1.8-1.8h9.4a1.8 1.8 0 0 1 1.8 1.8z" />
    </Svg>
  )
}

/** 라이트 모드 상태(=해). 테마 토글이 "지금 무엇인가"를 그린다. */
export function IconSun({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx={10} cy={10} r={3.4} />
      <path d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3" />
    </Svg>
  )
}

/** 다크 모드 상태(=달). */
export function IconMoon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15.4 12.4A6.2 6.2 0 0 1 8.1 4.9a6.4 6.4 0 1 0 7.3 7.5z" />
    </Svg>
  )
}

export function IconMusic({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8.4 14.1V5.4l6.2-1.4v8" />
      <Dot cx={6.5} cy={14.3} r={1.9} />
      <Dot cx={12.7} cy={12.3} r={1.9} />
    </Svg>
  )
}

export function IconWarning({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 3.4 18.4 16.6H1.6z" />
      <path d="M10 8.4v3.1" />
      <Dot cx={10} cy={14} r={1.05} />
    </Svg>
  )
}

export function IconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.25 8 10 12.75 14.75 8" />
    </Svg>
  )
}

export function IconEllipsis({ className }: IconProps) {
  return (
    <Svg className={className}>
      <Dot cx={5.4} cy={10} r={1.4} />
      <Dot cx={10} cy={10} r={1.4} />
      <Dot cx={14.6} cy={10} r={1.4} />
    </Svg>
  )
}

export function IconHelp({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7.4 7.6a2.6 2.6 0 1 1 2.6 2.6v1.55" />
      <Dot cx={10} cy={14.6} r={1.05} />
    </Svg>
  )
}

export function IconShake({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect height={12.5} rx={1.6} width={5.5} x={7.25} y={3.75} />
      <path d="M4.4 7.9a4.2 4.2 0 0 0 0 4.2" />
      <path d="M15.6 7.9a4.2 4.2 0 0 1 0 4.2" />
    </Svg>
  )
}
