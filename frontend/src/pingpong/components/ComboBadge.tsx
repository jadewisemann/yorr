import { comboStyle } from '@/pingpong/feedback'

export function ComboBadge({ count }: { count: number }) {
  const tier = comboStyle(count)
  return (
    <span
      className="animate-pp-combo-hit pointer-events-none text-center leading-none"
      style={{ color: tier.color, textShadow: tier.glow }}
    >
      <span className={`${tier.size} font-black tabular-nums`}>{count}</span>
      <span className="ml-1 align-super text-sm font-black tracking-widest">COMBO</span>
    </span>
  )
}
