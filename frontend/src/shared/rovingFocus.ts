/**
 * roving tabindex 묶음(tablist · toolbar)의 방향키 이동. 양 끝에서 반대편으로 감싼다(wrap).
 * 처리 대상이 아닌 키는 null을 돌려주고, 호출부는 그때만 기본 동작을 살려둔다.
 *
 * <b>왜 shared에 있는가.</b> 원래 `landing/tablistNavigation.ts`였다. 야추의 리액션 픽커도
 * 같은 패턴(항목 여럿, 포커스는 하나, 방향키로 이동)이 필요한데 의존 방향이
 * `landing → room → yacht`라 야추가 랜딩을 import할 수 없다 — 게임과 랜딩이 함께 쓰는
 * 순수 함수는 경계 모듈인 shared의 몫이다.
 */
export function resolveRovingKey(key: string, current: number, count: number): number | null {
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
