/** 총잡이가 취하는 자세. 무대 번역(stage.ts)이 이 어휘로 말한다. */
export type Pose = 'ready' | 'draw' | 'hit' | 'dead'

/**
 * 진영 색 — 스카프·모자띠·총구 화염에 쓰여 두 캐릭터를 구분한다.
 *
 * 컴포넌트가 아니라 여기 있는 이유: `stage.ts`가 서버 상태를 무대 props로 번역할 때 이 값을
 * 읽는다. `Gunslinger.tsx`에 두면 순수 번역 모듈이 컴포넌트 파일을 값으로 참조하게 되어
 * `domain/`이 React를 모른다는 규칙이 깨진다.
 */
export interface Outfit {
  /** 스카프·모자띠 (진영 색) */
  scarf: string
  /** 림라이트 (석양 반사) */
  rim: string
}

export const OUTFIT_LEFT: Outfit = { scarf: '#e0483a', rim: '#ffb56b' }
export const OUTFIT_RIGHT: Outfit = { scarf: '#38bdf8', rim: '#ffd08a' }

/** 무대가 그리는 국면. `stage.ts`가 서버 상태를 이 셋 중 하나로 번역한다. */
export type ArenaPhase = 'waiting' | 'signal' | 'result'

/**
 * 무대에 선 총잡이 한 명. `stage.ts`가 만들고 `Arena`가 받는다 —
 * 생산하는 쪽에 두어 도메인이 컴포넌트를 참조하지 않게 한다.
 */
export interface Fighter {
  name: string
  pose: Pose
  outfit: Outfit
  hp: number
  /** 이번 라운드 기록. 결과 국면에서만 쓴다. */
  ms: number | null
  /** 쌓인 부정출발 경고 — 이름표에 삼각형으로 표시된다. */
  fouls: number
}
