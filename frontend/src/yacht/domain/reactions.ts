import type { ReactionType } from '@/realtime/wsEvents'

export const REACTIONS = [
  { emoji: '👍', label: '좋아요', type: 'like' },
  { emoji: '😂', label: '웃겨요', type: 'laugh' },
  { emoji: '😱', label: '놀랐어요', type: 'shock' },
  { emoji: '👏', label: '박수', type: 'clap' },
  { emoji: '🫡', label: 'GG', type: 'gg' },
] as const satisfies ReadonlyArray<{ emoji: string; label: string; type: ReactionType }>

/** tokens.css의 `--animate-reaction-float` 지속시간과 같은 값. */
export const FLIGHT_MS = 2_200
/** 동시에 떠 있을 수 있는 개수. 6명이 연타해도 화면이 이모지로 덮이지 않게 한다. */
export const MAX_FLYING = 12
/**
 * 항목마다 돌려 쓰는 좌우 흩뿌림. Math.random 대신 id로 고르면 테스트도 같은 그림을 본다.
 * <p>
 * <b>0 이하만 쓴다 — 독은 화면 오른쪽 끝에 붙어 있다.</b> 양수 drift는 이모지와 닉네임 필을
 * 뷰포트 밖으로 밀어낸다(320px에서 실측: 필이 오른쪽에서 잘려 누가 보냈는지 못 읽었다).
 * 왼쪽은 트레이 안쪽이라 얼마든지 흩어져도 된다.
 */
export const DRIFTS = ['-3.2rem', '-2.4rem', '-1.5rem', '-0.7rem', '0rem']

/**
 * 세로 흩뿌림. 좌우만 흔들면 같은 순간에 도착한 것들이 <b>같은 높이에서 나란히</b> 올라가
 * 한 줄로 읽히고, motion-reduce에서는 제자리에 뜨는 닉네임 필이 그대로 겹친다.
 * <p>
 * <b>길이를 {@link DRIFTS}와 서로소로 둔다</b>(5 × 3). 같은 길이면 두 값이 같은 주기로 돌아
 * 조합이 5가지뿐인데, 서로소면 15가지가 돌아가서 연타해도 같은 자리가 겹치지 않는다.
 * 정확히 15개를 넘겨야 반복되므로 {@link MAX_FLYING}(12)보다 크다 — 화면에 함께 떠 있는
 * 것들끼리는 절대 같은 좌표를 쓰지 않는다.
 */
export const LIFTS = ['0rem', '-1.15rem', '-2.3rem']

export interface Flying {
  emoji: string
  id: number
  /** 낭독용 이름. 계약에 없는 reaction이 오면 빈 문자열이다. */
  label: string
  nickname: string
}
