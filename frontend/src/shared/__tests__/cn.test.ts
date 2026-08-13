import { describe, expect, it } from 'vitest'
import { cn } from '@/shared/cn'

/**
 * 디자인 시스템은 "외부 배치는 className으로 확장한다"(docs/wiki/design-system.md)를
 * 전제로 한다. 그 전제가 성립하려면 cn()이 프로젝트 토큰 class를 같은 충돌 그룹으로 알아야
 * 한다 — 모르면 양쪽이 다 살아남고 승자를 빌드된 CSS 선언 순서가 정한다.
 *
 * tailwind-merge는 기본 설정에서 Tailwind 기본 테마만 알기 때문에, @theme으로 추가한
 * tap·card·panel 같은 키는 등록해 주지 않으면 병합되지 않는다.
 */
describe('cn() 토큰 병합', () => {
  it('호출자가 넘긴 class가 컴포넌트의 같은 그룹 class를 이긴다', () => {
    expect(cn('min-h-tap px-6 py-3', 'min-h-[3.625rem]')).toBe('px-6 py-3 min-h-[3.625rem]')
    expect(cn('rounded-card', 'rounded-panel')).toBe('rounded-panel')
    expect(cn('shadow-cta', 'shadow-none')).toBe('shadow-none')
  })

  it('spacing 토큰(tap·content·gutter)을 병합한다', () => {
    expect(cn('min-h-tap', 'min-h-12')).toBe('min-h-12')
    expect(cn('size-tap', 'size-10')).toBe('size-10')
    expect(cn('px-gutter', 'px-4')).toBe('px-4')
    expect(cn('max-w-content', 'max-w-2xl')).toBe('max-w-2xl')
  })

  it('radius 토큰(control·card·panel·sheet)을 병합한다', () => {
    expect(cn('rounded-control', 'rounded-sheet')).toBe('rounded-sheet')
    expect(cn('rounded-panel', 'rounded-[1.25rem]')).toBe('rounded-[1.25rem]')
  })

  it('shadow 토큰을 병합한다', () => {
    expect(cn('shadow-raised', 'shadow-overlay')).toBe('shadow-overlay')
    expect(cn('shadow-cta', 'shadow-landing-cta')).toBe('shadow-landing-cta')
  })

  it('타이포 토큰(text-display·font-weight)을 병합한다', () => {
    expect(cn('text-display', 'text-lg')).toBe('text-lg')
    expect(cn('font-landing-medium', 'font-bold')).toBe('font-bold')
  })

  it('모션 토큰(duration·ease)을 병합한다', () => {
    // duration은 이름 있는 토큰이 없다(Tailwind v4에 --duration-* 네임스페이스 없음).
    // 원시값을 직접 참조하는 형태끼리 병합되는지만 본다.
    expect(cn('duration-(--ds-motion-base)', 'duration-150')).toBe('duration-150')
    expect(cn('ease-snappy', 'ease-linear')).toBe('ease-linear')
  })

  it('레이어 토큰(z-index 스케일)을 병합한다', () => {
    expect(cn('z-sheet', 'z-modal')).toBe('z-modal')
    expect(cn('z-banner', 'z-10')).toBe('z-10')
  })

  it('색 토큰은 기존대로 병합된다', () => {
    expect(cn('bg-surface', 'bg-canvas')).toBe('bg-canvas')
    expect(cn('text-content', 'text-danger')).toBe('text-danger')
  })

  it('서로 다른 그룹은 함께 남긴다', () => {
    expect(cn('min-h-tap', 'rounded-panel')).toBe('min-h-tap rounded-panel')
  })
})
