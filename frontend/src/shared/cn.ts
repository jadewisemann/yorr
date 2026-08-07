import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ['tap', 'content', 'landing', 'play', 'gutter', 'safe-top', 'safe-bottom'],
      radius: ['control', 'card', 'panel', 'sheet'],
      shadow: [
        'raised',
        'overlay',
        'cta',
        'landing-panel',
        'landing-card',
        'landing-card-quiet',
        'landing-card-inset',
        'landing-popover',
        'landing-cta',
        'landing-cta-sheet',
      ],
      text: ['display'],
      'font-weight': ['landing-medium', 'landing-bold'],
      ease: ['snappy'],
      animate: [
        'spin-slow',
        'dice-roll',
        'ring-pulse',
        'turn-pop',
        'turn-flash',
        'callout-pop',
        'callout-flash',
        'callout-burst',
        'guide-bob',
        'caret-blink',
      ],
    },
    classGroups: {
      z: [{ z: ['sticky', 'banner', 'sheet', 'modal', 'toast'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
