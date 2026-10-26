import { describe, expect, it } from 'vitest'
import { shape, VoiceImportError, warnings } from '../../scripts/voiceDsp.mjs'

const SAMPLE_RATE = 22050

/** 말소리처럼 보이는 사각파 — 무음이면 `shape`가 거부하므로 진폭이 필요하다. */
const tone = (seconds: number, amplitude = 0.3): { samples: Float32Array } => {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((index / SAMPLE_RATE) * 2 * Math.PI * 220) * amplitude
  }
  return { samples }
}

/**
 * 회귀: `shape`가 `CALLOUT_MS`를 참조하는데 import가 빠져 있어, **유효한 녹음이면
 * 어떤 입력이든** `ReferenceError: CALLOUT_MS is not defined`로 죽던 버그(2026-10-21).
 * 리팩터링으로 DSP를 떼어낼 때 상수 import만 남은 자리였다.
 *
 * 이 스크립트는 CI·테스트 대상이 아니라서 잡히지 않았다 — 이제 이 테스트가 잡는다.
 */
describe('shape', () => {
  it('유효한 녹음을 ReferenceError 없이 변환한다', () => {
    const clip = shape(tone(1), 'yacht')
    expect(clip.samples.length).toBeGreaterThan(0)
    expect(clip.gain).toBeGreaterThan(0)
  })

  it('콜아웃 표시 시간을 넘기면 경고를 남긴다', () => {
    warnings.length = 0
    // yacht 콜아웃은 2400ms(여유 200ms) — 4초짜리는 반드시 넘는다.
    shape(tone(4), 'yacht')
    expect(warnings.join('\n')).toContain('yacht')
    expect(warnings.join('\n')).toContain('깁니다')
  })

  it('적당한 길이의 녹음에는 길이 경고가 붙지 않는다', () => {
    warnings.length = 0
    // 0.5초 사인파 → 에코 꼬리(240ms)를 붙여도 740ms — 1200ms 예산 안이다.
    shape(tone(0.5), 'small-straight')
    expect(warnings.join('\n')).not.toContain('깁니다')
  })

  it('무음은 사용자가 고칠 수 있는 오류로 거부한다', () => {
    warnings.length = 0
    expect(() => shape({ samples: new Float32Array(SAMPLE_RATE) }, 'yacht')).toThrow(
      VoiceImportError,
    )
  })
})
