import { SPECIAL_HANDS_BY_RANK, type SpecialHand } from '@/domain/specialHands'

/**
 * `public/audio/hand-voice/`의 콜아웃 음성. 화면에 뜨는 족보 텍스트와 같은 말을 읽는다.
 * 성우 녹음이나 다른 TTS로 교체할 때는 같은 경로에 덮어쓰면 코드 변경이 필요 없다
 * (생성 스크립트는 `scripts/generate-hand-voice.ps1`).
 */
const SOURCE_BY_HAND: Record<SpecialHand, string> = {
  fourOfAKind: '/audio/hand-voice/four-of-a-kind.wav',
  fullHouse: '/audio/hand-voice/full-house.wav',
  largeStraight: '/audio/hand-voice/large-straight.wav',
  smallStraight: '/audio/hand-voice/small-straight.wav',
  yacht: '/audio/hand-voice/yacht.wav',
}

/** 주사위 굴림 소리 위에 얹히는 외침이라 조금 낮춘다. 1.0은 좁은 스피커에서 갈라진다. */
const VOICE_VOLUME = 0.9

export interface HandVoice {
  dispose(): void
  /** 족보 콜아웃이 화면에 뜨는 시점에 호출한다. 음소거·미지원이면 조용히 넘어간다. */
  play(hand: SpecialHand): void
  setMuted(muted: boolean): void
}

/**
 * 족보 콜아웃 음성 재생기(S15P11A406-138).
 *
 * 굴림이 끝나는 시점은 사용자가 화면을 탭한 뒤 1초 이상 지난 뒤고, 흔들어 굴리면 탭이 아예 없다.
 * 두 경우 모두 iOS Safari의 자동재생 정책에 걸리므로, 마운트 후 첫 제스처에서 각 음성을
 * 무음으로 한 번 재생해 잠금을 풀어둔다. 잠금을 풀지 못해도 게임은 그대로 진행된다 —
 * 목소리는 콜아웃 텍스트를 보조하는 연출이고, 실패는 조용히 넘긴다.
 */
export function createHandVoice({ muted = false }: { muted?: boolean } = {}): HandVoice {
  let isMuted = muted
  let unlocked = false
  let playing: HTMLAudioElement | null = null
  const elements = new Map<SpecialHand, HTMLAudioElement>()

  const elementFor = (hand: SpecialHand): HTMLAudioElement => {
    const cached = elements.get(hand)
    if (cached) return cached
    const element = new Audio(SOURCE_BY_HAND[hand])
    // 굴림이 착지하는 순간에 바로 나와야 한다 — 그때 받아오면 콜아웃이 먼저 사라진다.
    element.preload = 'auto'
    element.volume = VOICE_VOLUME
    elements.set(hand, element)
    return element
  }

  const stop = (element: HTMLAudioElement) => {
    element.pause()
    element.currentTime = 0
  }

  /** 첫 사용자 제스처 안에서만 의미가 있다. 여기서 벗어나면 브라우저가 재생을 거부한다. */
  const unlock = () => {
    if (unlocked) return
    unlocked = true
    for (const hand of SPECIAL_HANDS_BY_RANK) {
      const element = elementFor(hand)
      element.muted = true
      const started = element.play()
      // jsdom처럼 play()가 Promise를 주지 않는 환경도 있어 옵셔널 체이닝으로 받는다.
      started
        ?.then(() => {
          stop(element)
          element.muted = false
        })
        .catch(() => {
          // 정책·디코딩 실패. 다음 제스처를 기다리지 않고 그대로 둔다.
          element.muted = false
        })
    }
  }

  const gestureEvents = ['pointerdown', 'keydown'] as const
  for (const type of gestureEvents) {
    document.addEventListener(type, unlock, { once: true, passive: true })
  }

  return {
    dispose() {
      for (const type of gestureEvents) document.removeEventListener(type, unlock)
      for (const element of elements.values()) {
        stop(element)
        // src를 비워 디코딩·버퍼를 놓아준다. 방을 오래 오가면 요소가 쌓인다.
        element.src = ''
      }
      elements.clear()
      playing = null
    },
    play(hand) {
      if (isMuted) return
      const element = elementFor(hand)
      // 앞 콜아웃이 아직 말하는 중이면 끊는다 — 두 목소리가 겹치면 둘 다 안 들린다.
      if (playing && playing !== element) stop(playing)
      // 같은 족보가 연속으로 떠도 처음부터 다시 외쳐야 한다.
      element.currentTime = 0
      playing = element
      element.play()?.catch(() => {
        // 자동재생이 막혔거나 파일을 못 읽었다. 콜아웃 텍스트가 이미 결과를 알리고 있다.
      })
    },
    setMuted(next) {
      isMuted = next
      if (next && playing) stop(playing)
    },
  }
}
