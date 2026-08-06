/** 열린 전체 랭킹 패널의 id. 트리거의 `aria-controls`가 이 값을 가리킨다. */
export const PANEL_ID = 'weekly-ranking-panel'

/** 항목 하나가 지나가는 데 걸리는 시간. 트랙 길이에 곱해 애니메이션 지속시간을 만든다. */
export const SECONDS_PER_ENTRY = 4.5

/** 이 개수 미만이면 흐르게 하지 않는다 — 한두 개가 도는 것은 정보가 아니라 산만함이다. */
export const MIN_SCROLL_ENTRIES = 2
