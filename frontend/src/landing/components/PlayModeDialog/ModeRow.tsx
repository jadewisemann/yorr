export type ModeIconKind = 'quick' | 'ai' | 'party' | 'tutorial'

export function ModeIcon({ kind }: { kind: ModeIconKind }) {
  if (kind === 'quick') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'party') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'tutorial') {
    return (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg
      aria-hidden="true"
      className="size-[18px]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.7-3 2.5-4.5 5.5-4.5S13.8 16 14.5 19M17 6v6m-3-3h6" strokeLinecap="round" />
    </svg>
  )
}

export function ModeRow({
  description,
  icon,
  onClick,
  tag,
  title,
}: {
  description: string
  icon: ModeIconKind
  onClick: () => void
  tag?: string | undefined
  title: string
}) {
  return (
    <button
      className="group flex min-h-16 w-full cursor-pointer items-center gap-3 border-0 border-b border-border bg-transparent px-3 py-3 text-left transition-colors duration-150 ease-out last:border-b-0 hover:bg-white/4 focus-ring pressable"
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center text-content-muted"
      >
        <ModeIcon kind={icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-content">{title}</span>
        <span className="text-xs text-content-muted">{description}</span>
      </span>
      {tag && (
        <span className="rounded-full border border-border px-2.5 py-1 text-2xs font-semibold whitespace-nowrap text-content-muted">
          {tag}
        </span>
      )}
      <span
        aria-hidden="true"
        className="text-lg text-content-muted transition-transform group-hover:translate-x-0.5"
      >
        ›
      </span>
    </button>
  )
}
