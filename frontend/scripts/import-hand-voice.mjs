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
 * 하는 일: 디코드 → 22.05kHz 모노 → DC offset 제거 → 말소리 구간 트림 → (족보별) 에코 →
 *         페이드 → 체감 크기 정규화 → public/audio/hand-voice/<슬러그>.wav
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

/**
 * 정규화 목표 — 피크가 아니라 **체감 크기**(가장 큰 50ms 창의 RMS)를 맞춘다.
 *
 * 피크로 맞추면 뾰족한 순간 하나가 전체를 눌러버린다. "라지 스트레이트" 녹음은 피크가 다른
 * 파일과 같은데도 체감이 6dB 작았다 — 120ms 지점 파열음 하나 때문이었다(0.5를 넘는 샘플이
 * 전체의 0.16%). 그 0.16%는 리미터로 눕히고 나머지를 올리는 게 맞다.
 */
const TARGET_LOUDNESS = 0.4
/** 창 RMS를 재는 창 길이. 음절 하나가 들어갈 만큼은 돼야 체감 크기에 가깝다. */
const LOUDNESS_WINDOW_MS = 50
/** 조용한 녹음을 무한정 키우면 잡음만 커진다. 이 배수를 넘으면 경고하고 여기서 멈춘다. */
const MAX_GAIN = 12

/** 리미터 — 이 값 위부터 완만하게 눕히고, 절대 CEILING을 넘기지 않는다. */
const LIMIT_KNEE = 0.7
const LIMIT_CEILING = 0.95

/**
 * 말소리 구간 검출 파라미터. 10ms 창의 RMS를 가장 큰 창과 비교한 비율로 쓴다.
 *
 * 창 피크를 절대 기준과 비교하면 트림이 거의 안 된다 — 폰 녹음에는 녹음 버튼 탭·숨·방 잡음이
 * 말소리의 5~12% 세기로 앞뒤에 붙어 있어서, 그 잡음까지 "소리 있는 구간"으로 잡힌다.
 * 그래서 (1) 확실한 말소리(ONSET)만 먼저 찾고 (2) 음절 사이 공백(GAP)만 이어 붙이고
 * (3) 자음 꼬리만큼만(EDGE_MAX) 밖으로 넓힌다.
 */
const ONSET_RATIO = 0.15
const EDGE_RATIO = 0.05
const WINDOW_MS = 10
/** 이보다 짧은 공백은 한 단어 안의 음절 간격으로 보고 이어 붙인다("스몰 스트레이트"의 중간 쉼). */
const GAP_MS = 250
/** 말소리 양끝을 EDGE 기준으로 넓힐 수 있는 최대 길이. 이 이상은 잡음으로 본다. */
const EDGE_MAX_MS = 80
/** 검출 구간 밖에 이 세기 이상이 남아 있으면 "잘렸을 수도 있다"고 알린다. */
const LEFTOVER_RATIO = 0.15

const HEAD_KEEP_MS = 20
const TAIL_KEEP_MS = 60
/** 페이드아웃은 길게 — 뒤에 남긴 TAIL_KEEP 구간의 잡음까지 같이 죽인다. */
const FADE_IN_MS = 5
const FADE_OUT_MS = 40

/**
 * 족보별 에코. 원음 뒤로 `delayMs`마다 `decay`배씩 작아지는 복사본을 `repeats`개 겹치는
 * 멀티탭 딜레이다. 꼬리가 `delayMs × repeats`만큼 붙으므로 콜아웃 표시 시간을 넘기지 않게
 * 잡아야 한다 — 넘기면 아래 길이 검사가 경고한다.
 *
 * 요트에만 붙인다: 콜아웃이 2.4초로 제일 길게 떠 있어 꼬리를 붙일 여유가 있고, 화면에도
 * 느낌표가 셋이라 울림이 있어야 다른 족보와 급이 달라 보인다. 1.4초짜리 하위 족보에
 * 같은 꼬리를 붙이면 텍스트가 사라진 뒤에도 소리가 남는다.
 */
const ECHO = {
  yacht: { delayMs: 180, repeats: 3, decay: 0.5 },
}

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
    const sourceMs = Math.round((1000 * decoded.samples.length) / SAMPLE_RATE)
    const sizeKb = (clip.samples.length * 2 + 44) / 1024
    console.log(
      `${slug}.wav  ← ${basename(source)}  ` +
        `${durationMs}ms  ${sizeKb.toFixed(1)}KB  ` +
        `(원본 ${sourceMs}ms ${decoded.channels}ch 중 말소리 ` +
        `${clip.speech.beginMs}~${clip.speech.endMs}ms → gain x${clip.gain.toFixed(2)}` +
        `${clip.echo ? `, 에코 ${clip.echo.delayMs}ms x${clip.echo.repeats} decay ${clip.echo.decay}` : ''})`,
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

/** DC offset 제거 → 말소리 구간 트림 → 페이드 → 정규화. */
function shape({ samples }, slug) {
  if (samples.length === 0) fail(`${slug}: 디코딩 결과가 비어 있습니다.`)

  let sum = 0
  for (const value of samples) sum += value
  const offset = sum / samples.length
  const centered = Float32Array.from(samples, (value) => value - offset)

  let sourcePeak = 0
  for (const value of centered) sourcePeak = Math.max(sourcePeak, Math.abs(value))
  if (sourcePeak <= 0.001) fail(`${slug}: 거의 무음입니다. 마이크 입력을 확인해 주세요.`)

  const speech = findSpeech(centered, slug)
  const begin = Math.max(0, speech.begin - msToSamples(HEAD_KEEP_MS))
  const end = Math.min(centered.length, speech.end + msToSamples(TAIL_KEEP_MS))
  const trimmed = centered.subarray(begin, end)

  // 에코는 트림 다음에 붙인다 — 먼저 붙이면 울림 꼬리가 "말소리 밖"으로 잡혀 잘려나가고,
  // 앞뒤 잡음까지 같이 울린다. 페이드아웃도 꼬리 끝에 걸려야 매끄럽게 사라진다.
  const echo = ECHO[slug]
  const voiced = echo ? applyEcho(trimmed, echo) : trimmed

  // 정규화는 잘라낸 구간의 체감 크기로 한다. 원본 전체를 보면 녹음 버튼 탭 소리 하나가
  // 기준이 돼서, 5개 파일의 체감 크기가 서로 달라진다.
  const loudness = maxWindowRms(voiced, msToSamples(LOUDNESS_WINDOW_MS))
  const gain = Math.min(TARGET_LOUDNESS / loudness, MAX_GAIN)

  const fadeIn = Math.min(msToSamples(FADE_IN_MS), Math.floor(voiced.length / 2))
  const fadeOut = Math.min(msToSamples(FADE_OUT_MS), Math.floor(voiced.length / 2))
  const output = new Int16Array(voiced.length)
  let limited = 0
  for (let index = 0; index < voiced.length; index += 1) {
    // 잘라낸 자리에서 딱 끊기면 톡 하는 클릭이 남는다.
    let envelope = 1
    if (index < fadeIn) envelope = index / fadeIn
    const fromEnd = voiced.length - 1 - index
    if (fromEnd < fadeOut) envelope = Math.min(envelope, fromEnd / fadeOut)
    const raw = voiced[index] * gain * envelope
    if (Math.abs(raw) > LIMIT_KNEE) limited += 1
    output[index] = Math.round(softLimit(raw) * 32767)
  }

  const durationMs = (1000 * output.length) / SAMPLE_RATE
  if (sourcePeak > 0.995)
    warnings.push(
      `${slug}: 원본이 클리핑됐을 수 있습니다 — 마이크에서 더 떨어져 다시 녹음해 보세요.`,
    )
  if (speech.noise > speech.loudest * 0.1)
    warnings.push(
      `${slug}: 배경 잡음이 큽니다(말소리의 ${Math.round((100 * speech.noise) / speech.loudest)}%) — 조용한 곳에서 다시 녹음하면 트림이 깔끔해집니다.`,
    )
  for (const leftover of speech.leftovers)
    warnings.push(
      `${slug}: 검출 구간(${speech.beginMs}~${speech.endMs}ms) 밖 ${leftover}ms 쯤에 소리가 남아 있습니다 — ` +
        `wav를 들어보고 말끝이 잘렸으면 그 부분까지 붙여서 다시 녹음해 주세요.`,
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
  if (gain >= MAX_GAIN)
    warnings.push(
      `${slug}: 너무 작게 녹음돼 ${MAX_GAIN}배까지만 키웠습니다 — 다른 족보보다 작게 들립니다. ` +
        `마이크에 조금 더 가까이서 다시 녹음해 주세요.`,
    )
  // 리미터가 넓게 물리면 소리가 뭉개진다. 뾰족한 순간 몇 개를 눕히는 정도여야 한다.
  const limitedRatio = limited / output.length
  if (limitedRatio > 0.05)
    warnings.push(
      `${slug}: 리미터가 샘플의 ${(100 * limitedRatio).toFixed(1)}%에 걸렸습니다 — ` +
        `들어보고 뭉개진 느낌이면 마이크에서 조금 떨어져 다시 녹음해 주세요.`,
    )

  return {
    echo,
    gain,
    limitedRatio,
    loudness: maxWindowRms(output, msToSamples(LOUDNESS_WINDOW_MS), 32767),
    samples: output,
    sourcePeak,
    speech,
  }
}

/**
 * 멀티탭 딜레이로 에코를 붙인다. 꼬리(`delayMs × repeats`)만큼 길어진 새 버퍼를 돌려준다.
 *
 * 피드백 딜레이(출력을 다시 입력으로 넣는 방식)가 아니라 원음의 복사본을 그대로 겹친다 —
 * 탭 수와 꼬리 길이가 계산으로 딱 정해져서, 콜아웃 표시 시간 안에 들어오는지 미리 알 수 있다.
 * 겹치는 만큼 진폭이 커지지만 뒤이어 정규화·리미터가 받아주므로 여기서는 조정하지 않는다.
 */
function applyEcho(samples, { delayMs, repeats, decay }) {
  const delay = msToSamples(delayMs)
  const output = new Float32Array(samples.length + delay * repeats)
  output.set(samples)
  for (let tap = 1; tap <= repeats; tap += 1) {
    const gain = decay ** tap
    const offset = delay * tap
    for (let index = 0; index < samples.length; index += 1) {
      output[offset + index] += samples[index] * gain
    }
  }
  return output
}

/** 가장 큰 창의 RMS = 체감 크기. `scale`은 Int16 배열을 넘길 때 쓴다. */
function maxWindowRms(samples, window, scale = 1) {
  let loudest = 0
  for (let start = 0; start + window <= samples.length; start += window) {
    let square = 0
    for (let index = start; index < start + window; index += 1) {
      const value = samples[index] / scale
      square += value * value
    }
    loudest = Math.max(loudest, Math.sqrt(square / window))
  }
  // 창 하나가 안 되는 짧은 녹음은 전체를 한 창으로 본다.
  if (loudest === 0) {
    let square = 0
    for (const value of samples) square += (value / scale) * (value / scale)
    loudest = Math.sqrt(square / Math.max(1, samples.length))
  }
  return loudest
}

/** KNEE 위를 tanh로 눕힌다. 어떤 입력도 CEILING을 넘지 않으므로 클리핑이 없다. */
function softLimit(value) {
  const magnitude = Math.abs(value)
  if (magnitude <= LIMIT_KNEE) return value
  const headroom = LIMIT_CEILING - LIMIT_KNEE
  const eased = LIMIT_KNEE + headroom * Math.tanh((magnitude - LIMIT_KNEE) / headroom)
  return value < 0 ? -eased : eased
}

/**
 * 말소리 구간을 찾는다. 10ms 창 RMS를 만들고,
 *
 *   1. 가장 큰 창의 ONSET_RATIO를 넘는 창만 "확실한 말소리"로 본다.
 *   2. GAP_MS보다 짧은 공백은 음절 사이 쉼으로 보고 이어 붙인다.
 *   3. 그렇게 만든 구간 중 가장 큰 창이 들어 있는 것을 콜아웃으로 고른다.
 *      — 녹음 버튼 탭 소리처럼 짧고 큰 잡음이 따로 떨어져 있으면 여기서 버려진다.
 *   4. 자음 꼬리를 살리려고 EDGE_RATIO 기준으로 양끝을 넓히되 EDGE_MAX_MS까지만 넓힌다.
 */
function findSpeech(samples, slug) {
  const window = msToSamples(WINDOW_MS)
  const rms = []
  for (let start = 0; start + window <= samples.length; start += window) {
    let square = 0
    for (let index = start; index < start + window; index += 1) {
      square += samples[index] * samples[index]
    }
    rms.push(Math.sqrt(square / window))
  }
  if (rms.length === 0) fail(`${slug}: 녹음이 ${WINDOW_MS}ms보다 짧습니다.`)

  let loudest = 0
  let loudestAt = 0
  for (let index = 0; index < rms.length; index += 1) {
    if (rms[index] > loudest) {
      loudest = rms[index]
      loudestAt = index
    }
  }
  const onset = loudest * ONSET_RATIO
  const edge = loudest * EDGE_RATIO

  const gap = Math.round(GAP_MS / WINDOW_MS)
  const runs = []
  for (let index = 0; index < rms.length; index += 1) {
    if (rms[index] <= onset) continue
    const previous = runs[runs.length - 1]
    if (previous && index - previous.end <= gap) previous.end = index
    else runs.push({ start: index, end: index })
  }
  const run = runs.find(({ start, end }) => loudestAt >= start && loudestAt <= end)
  if (!run) fail(`${slug}: 말소리 구간을 찾지 못했습니다.`)

  const reach = Math.round(EDGE_MAX_MS / WINDOW_MS)
  let first = run.start
  while (first > 0 && run.start - first < reach && rms[first - 1] > edge) first -= 1
  let last = run.end
  while (last < rms.length - 1 && last - run.end < reach && rms[last + 1] > edge) last += 1

  // 구간 밖 소리는 잡음(median)과 "말끝이 잘렸을 수도 있는 소리"(ONSET급)를 나눠서 본다.
  const outside = []
  const leftovers = []
  for (let index = 0; index < rms.length; index += 1) {
    if (index >= first && index <= last) continue
    outside.push(rms[index])
    if (rms[index] > loudest * LEFTOVER_RATIO) leftovers.push(index * WINDOW_MS)
  }
  outside.sort((left, right) => left - right)

  return {
    begin: first * window,
    end: Math.min(samples.length, (last + 1) * window),
    beginMs: first * WINDOW_MS,
    endMs: (last + 1) * WINDOW_MS,
    loudest,
    noise: outside.length > 0 ? outside[Math.floor(outside.length / 2)] : 0,
    // 연속으로 여러 창이 남으면 경고가 도배된다 — 구간별 첫 지점만 알린다.
    leftovers: leftovers.filter((ms, index) => index === 0 || ms - leftovers[index - 1] > GAP_MS),
  }
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
