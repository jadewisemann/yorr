export const DS_COLOR_FALLBACK = {
  '--ds-color-physics-accent': '#ff4d48',
  '--ds-color-physics-danger': '#e53935',
  '--ds-color-physics-die': '#f4f1e8',
  '--ds-color-physics-ground': '#1a1b1e',
  '--ds-color-physics-pip': '#0b0b0c',
  '--ds-color-physics-rail': '#0d0e10',
  '--ds-color-physics-slot': 'rgb(255 255 255 / 14%)',
} as const

export type DsColorName = keyof typeof DS_COLOR_FALLBACK

export function dsColorReader(): (name: DsColorName) => string {
  const styles = getComputedStyle(document.documentElement)
  return (name) => styles.getPropertyValue(name).trim() || DS_COLOR_FALLBACK[name]
}
