export function Score({
  name,
  score,
  tone,
  tag,
  large = false,
}: {
  name: string
  score: number
  tone: 'blue' | 'red'
  tag?: string
  large?: boolean
}) {
  return (
    <div
      className={`grid min-w-20 text-center ${tone === 'blue' ? 'text-pp-side-blue-text' : 'text-pp-danger-text'}`}
    >
      <span className="flex min-w-0 items-center justify-center gap-1 text-xs font-bold text-game-content-muted">
        {tag && (
          <span className="rounded-xs border border-current px-1 font-mono text-2xs font-black leading-none">
            {tag}
          </span>
        )}
        <span className="max-w-28 truncate">{name}</span>
      </span>
      <strong className={`font-mono leading-none ${large ? 'text-7xl' : 'text-4xl'}`}>
        {score}
      </strong>
    </div>
  )
}
