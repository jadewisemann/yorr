// 눌림은 공통 Button과 같은 값(scale 0.97)을 쓴다 — hover가 없는 터치에서 손가락이 닿았다를
// 알리는 유일한 채널이라, 이 대화상자의 여섯 행이 그것만 빠져 있었다.
export const row =
  'flex w-full items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5 text-left text-sm font-semibold text-content transition-[color,background-color,border-color,scale] duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable'
export const activeRow =
  'cursor-pointer hover:border-landing-hairline-strong hover:bg-surface-raised'
export const lockedRow = 'cursor-not-allowed text-content-faint'
