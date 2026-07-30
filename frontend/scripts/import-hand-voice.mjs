/**
 * 직접 녹음한 족보 콜아웃을 게임 에셋으로 변환한다(S15P11A406-138).
 *
 *   node scripts/import-hand-voice.mjs [입력폴더]      # 기본값: scripts/voice-source
 *
 * 입력폴더에 족보 슬러그 이름으로 파일을 넣어두면 된다. 확장자는 상관없다 —
 * 폰 음성메모(m4a), 브라우저 녹음(webm), Audacity(wav/mp3) 무엇이든 받는다.
 *
 *   yacht.m4a  large-straight.m4a  small-straight.m4a  full-house.m4a  four-of-a-kind.m4a
 *
 * 하는 일: 디코드 → 22.05kHz 모노 → DC offset 제거 → 앞뒤 무음 트림 →
 *         5ms 페이드 → 피크 정규화 → public/audio/hand-voice/<슬러그>.wav
 *
 * 디코딩은 Playwright의 Chromium(Web Audio `decodeAudioData`)에 맡긴다. 이 PC에 ffmpeg가
 * 없고 Playwright는 이미 e2e용 devDependency로 깔려 있어서, 새 의존성 없이 크롬이 읽는
 * 모든 포맷을 그대로 받을 수 있다. `decodeAudioData`가 컨텍스트 샘플레이트로 리샘플까지
 * 해주므로 변환 단계가 하나로 줄어든다.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

/**
 * 슬러그 → 콜아웃이 화면에 떠 있는 시간(ms).
 * `RollResultCallout.tsx`의 `tierByHand` × `durationMsByTier`가 원본이다 —
 * 저쪽을 조정하면 여기도 같이 맞춰야 목소리가 텍스트보다 오래 남지 않는다.
 */
const CALLOUT_MS = {
  yacht: 2400,
  'large-straight': 1800,
  'small-straight': 1400,
  'full-house': 1400,
  'four-of-a-kind': 1400,
}
const SLUGS = Object.keys(CALLOUT_MS)
/** 목소리가 텍스트보다 먼저 끝나야 한다. 이만큼 여유를 남겨 경고 기준으로 쓴다. */
const CALLOUT_MARGIN_MS = 200

const SAMPLE_RATE = 22050
/** 정규화 목표 피크. 1.0은 클리핑 위험이 있어 -1dB 정도로 둔다. */
const TARGET_PEAK = 0.89
/** 무음 판정 기준 — 피크 대비 비율. 절대값으로 두면 방 잡음이 있는 녹음에서 트림이 안 된다. */
const SILENCE_RATIO = 0.03
const HEAD_KEEP_MS = 20
const TAIL_KEEP_MS = 60
const FADE_MS = 5

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const inputDir = resolve(process.argv[2] ?? join(scriptDir, 'voice-source'))
const outputDir = join(frontendDir, 'public/audio/hand-voice')

const sources = collectSources(inputDir)
const missing = SLUGS.filter((slug) => !sources.has(slug))
if (missing.length === SLUGS.length) {
  fail(
    `${inputDir} 에서 녹음 파일을 찾지 못했습니다.\n` +
      `아래 이름으로 넣어주세요(확장자는 무엇이든 됩니다):\n` +
      SLUGS.map((slug) => `  ${slug}.m4a`).join('\n'),
  )
}
if (missing.length > 0) {
  console.log(`! 없는 파일은 기존 에셋을 그대로 둡니다: ${missing.join(', ')}\n`)
}

// 에셋을 전부 지운 상태(첫 녹음 직전)에는 폴더 자체가 없다.
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
const warnings = []

try {
  for (const slug of SLUGS) {
    const source = sources.get(slug)
    if (!source) continue

    const decoded = await decode(page, source)
    const clip = shape(decoded, slug)
    const outPath = join(outputDir, `${slug}.wav`)
    writeFileSync(outPath, encodeWave(clip.samples, SAMPLE_RATE))

    const durationMs = Math.round((1000 * clip.samples.length) / SAMPLE_RATE)
    const sizeKb = (clip.samples.length * 2 + 44) / 1024
    console.log(
      `${slug}.wav  ← ${basename(source)}  ` +
        `${durationMs}ms  ${sizeKb.toFixed(1)}KB  ` +
        `(원본 ${decoded.channels}ch 피크 ${(100 * clip.sourcePeak).toFixed(0)}% → gain x${clip.gain.toFixed(2)})`,
    )
  }
} finally {
  await browser.close()
}

if (warnings.length > 0) {
  console.log(`\n확인이 필요한 항목:`)
  for (const warning of warnings) console.log(`  ! ${warning}`)
}
console.log(`\n들어보기: npm run dev 후 굴리거나, public/audio/hand-voice 의 wav를 직접 재생`)

/** 입력 폴더에서 슬러그 → 파일 경로를 모은다. 확장자는 보지 않는다. */
function collectSources(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    fail(`입력 폴더가 없습니다: ${dir}`)
  }
  const found = new Map()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const slug = basename(entry.name, extname(entry.name)).toLowerCase()
    if (SLUGS.includes(slug)) found.set(slug, join(dir, entry.name))
  }
  return found
}

/** Chromium에 파일을 넘겨 22.05kHz 모노 Float32로 되돌려받는다. */
async function decode(page, path) {
  const base64 = readFileSync(path).toString('base64')
  const result = await page.evaluate(
    async ([encoded, sampleRate]) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      // decodeAudioData는 컨텍스트 샘플레이트로 리샘플해준다 — 44.1kHz 녹음도 여기서 맞춰진다.
      const context = new OfflineAudioContext(1, 1, sampleRate)
      const buffer = await context.decodeAudioData(bytes.buffer)

      // 다운믹스는 직접 평균 낸다. 스테레오 녹음의 한쪽 채널만 쓰면 위상에 따라 소리가 죽는다.
      const tracks = []
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        tracks.push(buffer.getChannelData(channel))
      }
      const mono = new Float32Array(buffer.length)
      for (let index = 0; index < buffer.length; index += 1) {
        let sum = 0
        for (const track of tracks) sum += track[index]
        mono[index] = sum / tracks.length
      }

      // Float32 원본 바이트를 base64로 넘긴다. 숫자 배열로 직렬화하면 긴 녹음에서 수 MB가 된다.
      const raw = new Uint8Array(mono.buffer)
      let binary = ''
      for (let offset = 0; offset < raw.length; offset += 0x8000) {
        binary += String.fromCharCode(...raw.subarray(offset, offset + 0x8000))
      }
      return { channels: buffer.numberOfChannels, samples: btoa(binary) }
    },
    [base64, SAMPLE_RATE],
  )

  const bytes = Buffer.from(result.samples, 'base64')
  return {
    channels: result.channels,
    // x86·ARM 모두 little-endian이라 Float32Array로 그대로 덮어 읽는다.
    samples: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
  }
}

/**
 * DC offset 제거 → 무음 트림 → 페이드 → 정규화.
 * 트림은 10ms 창의 피크로 판정한다. 샘플 하나로 보면 잡음 튐 하나에 앞이 안 잘린다.
 */
function shape({ samples }, slug) {
  if (samples.length === 0) fail(`${slug}: 디코딩 결과가 비어 있습니다.`)

  let sum = 0
  for (const value of samples) sum += value
  const offset = sum / samples.length
  const centered = Float32Array.from(samples, (value) => value - offset)

  let peak = 0
  for (const value of centered) peak = Math.max(peak, Math.abs(value))
  if (peak <= 0.001) fail(`${slug}: 거의 무음입니다. 마이크 입력을 확인해 주세요.`)

  const window = Math.round(SAMPLE_RATE * 0.01)
  const floor = Math.max(peak * SILENCE_RATIO, 0.004)
  let first = -1
  let last = -1
  let noiseFloor = 0
  for (let start = 0; start + window <= centered.length; start += window) {
    let windowPeak = 0
    for (let index = start; index < start + window; index += 1) {
      windowPeak = Math.max(windowPeak, Math.abs(centered[index]))
    }
    if (windowPeak > floor) {
      if (first < 0) first = start
      last = start + window - 1
    } else {
      noiseFloor = Math.max(noiseFloor, windowPeak)
    }
  }
  if (first < 0) fail(`${slug}: 말소리 구간을 찾지 못했습니다.`)

  const begin = Math.max(0, first - msToSamples(HEAD_KEEP_MS))
  const end = Math.min(centered.length - 1, last + msToSamples(TAIL_KEEP_MS))
  const trimmed = centered.subarray(begin, end + 1)

  const gain = TARGET_PEAK / peak
  const fade = Math.min(msToSamples(FADE_MS), Math.floor(trimmed.length / 2))
  const output = new Int16Array(trimmed.length)
  for (let index = 0; index < trimmed.length; index += 1) {
    // 잘라낸 자리에서 딱 끊기면 톡 하는 클릭이 남는다.
    let envelope = 1
    if (index < fade) envelope = index / fade
    else if (index >= trimmed.length - fade) envelope = (trimmed.length - 1 - index) / fade
    const value = Math.round(trimmed[index] * gain * envelope * 32767)
    output[index] = Math.max(-32768, Math.min(32767, value))
  }

  const durationMs = (1000 * output.length) / SAMPLE_RATE
  if (peak > 0.995)
    warnings.push(
      `${slug}: 원본이 클리핑됐을 수 있습니다 — 마이크에서 더 떨어져 다시 녹음해 보세요.`,
    )
  if (noiseFloor > peak * 0.1)
    warnings.push(
      `${slug}: 배경 잡음이 큽니다(피크의 ${Math.round((100 * noiseFloor) / peak)}%) — 조용한 곳에서 다시 녹음하면 트림이 깔끔해집니다.`,
    )
  const budgetMs = CALLOUT_MS[slug] - CALLOUT_MARGIN_MS
  if (durationMs > budgetMs)
    warnings.push(
      `${slug}: ${Math.round(durationMs)}ms로 깁니다(권장 ${budgetMs}ms 이내) — ` +
        `이 족보의 콜아웃은 ${CALLOUT_MS[slug]}ms만 떠 있어 목소리가 끝나기 전에 텍스트가 사라집니다. ` +
        `더 빠르게 다시 녹음하거나 RollResultCallout의 표시 시간을 늘려야 합니다.`,
    )
  if (durationMs < 200)
    warnings.push(
      `${slug}: ${Math.round(durationMs)}ms로 너무 짧습니다 — 앞부분이 잘렸는지 들어봐 주세요.`,
    )

  return { gain, samples: output, sourcePeak: peak }
}

function msToSamples(ms) {
  return Math.round((SAMPLE_RATE * ms) / 1000)
}

/** 16bit 모노 PCM WAV. 헤더는 44바이트 표준형 하나만 쓴다. */
function encodeWave(samples, sampleRate) {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2)
  }
  return buffer
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
