/**
 * `<audio>` 요소의 볼륨을 정한다. iOS에서 `.volume` 대입이 무시되는 것을 감춘다.
 *
 * iOS Safari는 `HTMLMediaElement.volume`이 **읽기 전용**이다 — 대입해도 예외 없이 조용히
 * 무시되고, 볼륨은 하드웨어 버튼만 바꾼다. 그래서 슬라이더를 0%로 내려도 소리가 원래
 * 크기로 났고, 애초에 튜닝해 둔 기본 믹스(배경음 0.35 · 사발 0.5 · 쏟기 0.7)도 폰에서는
 * 전부 100%로 뭉쳐 있었다.
 *
 * 우회로는 요소를 Web Audio로 흘려 GainNode로 줄이는 것뿐이다. 족보 음성(handVoice)이 이미
 * 같은 방식으로 볼륨을 조절하고 폰에서 동작하는 것이 확인돼 있어, 그쪽에서 배운 것을 그대로
 * 가져왔다 — `running`이 아니면 계속 깨우기, 제스처 리스너를 `once`로 떼지 않기.
 *
 * **기능 탐지("대입해 보고 읽어서 확인")를 하지 않는다.** 실기기에서 그 방법이 속는 것을
 * 확인했다 — iOS는 대입을 무시하면서 값은 저장해서, 읽어 보면 넣은 값이 그대로 나온다.
 * 그래서 항상 Web Audio로 흘린다. UA도 보지 않는다. 대입이 먹는 브라우저에서도 GainNode는
 * 똑같이 동작하므로 갈래를 둘 이유가 없다(코드도 줄어든다).
 */

let context: AudioContext | null = null
let listeningForGestures = false
/** 요소별 GainNode. `createMediaElementSource`는 요소당 한 번만 부를 수 있어 재사용해야 한다. */
const gains = new WeakMap<HTMLAudioElement, GainNode>()

export function setElementVolume(audio: HTMLAudioElement, volume: number): void {
  // 0%는 GainNode와 별개로 muted로도 한 번 더 막는다. 이 대입은 iOS에서도 먹으므로,
  // Web Audio 쪽이 어떤 이유로든 어긋나도 "0%인데 들린다"는 다시 나오지 않는다.
  audio.muted = volume === 0

  const gain = gainFor(audio)
  if (gain) {
    gain.gain.value = volume
    resumeContext()
    return
  }
  // Web Audio가 없는 환경(jsdom 등)에서는 종전 경로로 떨어진다.
  audio.volume = volume
}

function gainFor(audio: HTMLAudioElement): GainNode | null {
  const existing = gains.get(audio)
  if (existing) return existing
  try {
    context ??= new AudioContext()
    const gain = context.createGain()
    // 요소를 그래프에 넣으면 소리는 destination으로만 나간다 — 연결을 빠뜨리면 통째로 무음이다.
    context.createMediaElementSource(audio).connect(gain).connect(context.destination)
    gains.set(audio, gain)
    listenForGestures()
    return gain
  } catch {
    // AudioContext가 없거나 이 요소가 이미 다른 그래프에 연결돼 있다. muted로 떨어진다.
    return null
  }
}

/**
 * context가 잠겨 있으면 깨운다. iOS는 전화·백그라운드 전환 뒤 다시 재우고, 잠긴 채로는
 * 그래프를 지나는 소리가 통째로 사라진다(요소 자체의 자동재생 잠금과는 별개다).
 */
function resumeContext(): void {
  if (context && context.state !== 'running') void context.resume().catch(() => undefined)
}

function listenForGestures(): void {
  if (listeningForGestures) return
  listeningForGestures = true
  // once를 쓰지 않는다 — 한 번만 깨우면 다시 잠긴 뒤로 영영 무음이다(handVoice와 같은 이유).
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, resumeContext, { passive: true })
  }
}
