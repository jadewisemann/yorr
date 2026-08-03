/**
 * WAI-ARIA tabs 패턴의 방향키 이동. 양 끝에서 반대편으로 감싼다(wrap).
 * 처리 대상이 아닌 키는 null을 돌려주고, 호출부는 그때만 기본 동작을 살려둔다.
 */
export function resolveTablistKey(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowUp':
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
