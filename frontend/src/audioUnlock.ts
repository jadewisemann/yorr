/**
 * 자동재생 잠금 해제 유틸(S15P11A406-160).
 *
 * 브라우저는 사용자가 페이지를 만지기 전에는 소리를 내주지 않는다. 데스크톱 크롬은 한 번
 * 클릭하면 그 뒤로 페이지 전체가 풀리지만, **iOS Safari는 `<audio>` 요소마다 따로** 기억한다 —
 * "이 요소가 사용자 제스처 안에서 play()된 적이 있는가". 그래서 랜딩에서 탭해 BGM이 나기
 * 시작해도, 게임 화면으로 넘어가며 **다른 요소**(yacht_ingame)로 갈아타면 그 요소는 아직
 * 잠겨 있어 조용하다. 화면 전환은 코드가 하는 일이라 그 순간엔 제스처가 없다.
 *
 * 그래서 첫 제스처 안에서 쓸 요소를 **전부** 한 번씩 재생했다 즉시 멈춰 둔다. 그 뒤로는
 * 코드가 언제든 재생할 수 있다.
 */

const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const

/** 첫 사용자 제스처에서 run을 실행한다. 반환값을 부르면 기다리기를 그만둔다. */
export function onFirstGesture(run: () => void): () => void {
  const handler = () => {
    detach()
    run()
  }
  const detach = () => {
    for (const type of GESTURE_EVENTS) document.removeEventListener(type, handler)
  }
  for (const type of GESTURE_EVENTS) document.addEventListener(type, handler, { passive: true })
  return detach
}

/**
 * 제스처 안에서 불러야 의미가 있다 — 요소마다 play() → 곧바로 pause()로 잠금만 푼다.
 *
 * pause()를 promise를 기다리지 않고 바로 부르는 이유는 소리가 새지 않게 하기 위해서다.
 * 재생이 시작되기 전에 멈추므로 들리지 않고(play()는 AbortError로 거절되며, 그래도 요소는
 * "제스처로 재생된" 것으로 기록된다), 이미 재생 중인 요소는 건드리지 않는다.
 */
export function primeAudio(elements: Iterable<HTMLAudioElement>): void {
  for (const audio of elements) {
    if (!audio.paused) continue
    void audio.play().catch(() => undefined)
    audio.pause()
    audio.currentTime = 0
  }
}
