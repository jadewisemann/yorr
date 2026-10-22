/**
 * 탁구 로컬(연습·파티) 판의 타구 판정 — 스윙 거리와 타이밍으로 스매시·퍼펙트·굿·
 * 폴트를 가른다. 순수 계산만 두고 상태 변이는 `localGame`이 한다.
 */

export interface SwingQuality {
  kind: 'smash' | 'nice' | 'ok'
  text: string
}

/**
 * 거리(이상적인 타격 지점과의 차)로 타구의 세기를 정한다. 폴트는 호출부가
 * `faultOf`로 먼저 판정한다 — 이 함수는 맞은 공의 질만 본다.
 */
export function swingQualityOf(
  distance: number,
  thresholds: { perfect: number; good: number },
): SwingQuality {
  if (distance <= thresholds.perfect) return { kind: 'smash', text: '스매시! 💥' }
  if (distance <= thresholds.good) return { kind: 'nice', text: '퍼펙트!' }
  return { kind: 'ok', text: '굿!' }
}
