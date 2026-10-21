/**
 * `voiceDsp.mjs`의 타입 선언 — 테스트(`src/__tests__/voiceDsp.test.ts`)가 쓰는
 * 표면만 담는다. 이 스크립트는 TS 빌드 대상이 아니라 `.mjs`로 남는다.
 */

export interface DecodedAudio {
  readonly samples: Float32Array
}

export interface SpeechRange {
  readonly begin: number
  readonly end: number
  readonly beginMs: number
  readonly endMs: number
  readonly loudest: number
  readonly noise: number
  readonly leftovers: readonly number[]
}

export interface EchoSettings {
  readonly delayMs: number
  readonly repeats: number
  readonly decay: number
}

export interface ShapedClip {
  readonly echo: EchoSettings | undefined
  readonly gain: number
  readonly limitedRatio: number
  readonly loudness: number
  readonly samples: Int16Array
  readonly sourcePeak: number
  readonly speech: SpeechRange
}

export declare const warnings: string[]

export declare class VoiceImportError extends Error {}

export declare function shape(audio: DecodedAudio, slug: string): ShapedClip

export declare function encodeWave(samples: Int16Array, sampleRate: number): Buffer
