/**
 * 족보 콜아웃 오디오의 DSP — 디코드된 Float32 샘플을 게임에 넣을 wav로 다듬는다.
 *
 * 왜 분리했나: 이 스크립트의 절반은 **순수 신호 처리**(DC 제거·트림·정규화·리미터·에코)이고
 * 나머지는 Playwright로 Chromium을 띄우는 배선이다. 후자는 거의 바뀌지 않는데 전자는
 * 귀에 들리는 결과를 좌우하므로, 계산과 상수를 한자리에 모아 두는 편이 조정하기 쉽다.
 */
import {
  CALLOUT_MARGIN_MS,
  CALLOUT_MS,
  ECHO,
  EDGE_MAX_MS,
  EDGE_RATIO,
  FADE_IN_MS,
  FADE_OUT_MS,
  GAP_MS,
  HEAD_KEEP_MS,
  LEFTOVER_RATIO,
  LIMIT_CEILING,
  LIMIT_KNEE,
  LOUDNESS_WINDOW_MS,
  MAX_GAIN,
  ONSET_RATIO,
  SAMPLE_RATE,
  TAIL_KEEP_MS,
  TARGET_LOUDNESS,
  WINDOW_MS,
} from './voiceConstants.mjs'

/** 진단 메시지를 모으는 곳. 경고는 실패가 아니므로 던지지 않고 여기에 쌓는다. */
export const warnings = []

/**
 * 변환 실패 — 사용자가 고칠 수 있는 문제(입력 폴더 없음, 무음 녹음)만 던진다.
 * `process.exit(1)` 대신 던지는 이유는 호출자가 브라우저를 닫을 수 있게 하기 위해서다.
 */
export class VoiceImportError extends Error {}

/** 경고·실패 메시지의 공통 접두. */
const fail = (message) => {
  throw new VoiceImportError(message)
}

/** DC offset 제거 → 말소리 구간 트림 → 페이드 → 정규화. */
export function shape({ samples }, slug) {
  if (samples.length === 0) fail(`${slug}: 디코딩 결과가 비어 있습니다.`)

  const centered = centerSamples(samples)
  const sourcePeak = peakMagnitude(centered)
  if (sourcePeak <= 0.001) fail(`${slug}: 거의 무음입니다. 마이크 입력을 확인해 주세요.`)

  const speech = findSpeech(centered, slug)
  const trimmed = trimSpeech(centered, speech)

  // 에코는 트림 다음에 붙인다 — 먼저 붙이면 울림 꼬리가 "말소리 밖"으로 잡혀 잘려나가고,
  // 앞뒤 잡음까지 같이 울린다. 페이드아웃도 꼬리 끝에 걸려야 매끄럽게 사라진다.
  const echo = ECHO[slug]
  const voiced = echo ? applyEcho(trimmed, echo) : trimmed

  // 정규화는 잘라낸 구간의 체감 크기로 한다. 원본 전체를 보면 녹음 버튼 탭 소리 하나가
  // 기준이 돼서, 5개 파일의 체감 크기가 서로 달라진다.
  const loudness = maxWindowRms(voiced, msToSamples(LOUDNESS_WINDOW_MS))
  const gain = Math.min(TARGET_LOUDNESS / loudness, MAX_GAIN)
  const { output, limited } = normalizeSamples(voiced, gain)

  const durationMs = (1000 * output.length) / SAMPLE_RATE
  // 리미터가 넓게 물리면 소리가 뭉개진다. 뾰족한 순간 몇 개를 눕히는 정도여야 한다.
  const limitedRatio = limited / output.length
  warnAboutSource(slug, sourcePeak, speech)
  warnAboutDuration(slug, durationMs)
  warnAboutLevels(slug, gain, limitedRatio)

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

function centerSamples(samples) {
  let sum = 0
  for (const value of samples) sum += value
  const offset = sum / samples.length
  return Float32Array.from(samples, (value) => value - offset)
}

function peakMagnitude(samples) {
  let peak = 0
  for (const value of samples) peak = Math.max(peak, Math.abs(value))
  return peak
}

function trimSpeech(samples, speech) {
  const begin = Math.max(0, speech.begin - msToSamples(HEAD_KEEP_MS))
  const end = Math.min(samples.length, speech.end + msToSamples(TAIL_KEEP_MS))
  return samples.subarray(begin, end)
}

function normalizeSamples(samples, gain) {
  const fadeIn = Math.min(msToSamples(FADE_IN_MS), Math.floor(samples.length / 2))
  const fadeOut = Math.min(msToSamples(FADE_OUT_MS), Math.floor(samples.length / 2))
  const output = new Int16Array(samples.length)
  let limited = 0
  for (let index = 0; index < samples.length; index += 1) {
    const envelope = fadeEnvelope(index, samples.length, fadeIn, fadeOut)
    const raw = samples[index] * gain * envelope
    if (Math.abs(raw) > LIMIT_KNEE) limited += 1
    output[index] = Math.round(softLimit(raw) * 32767)
  }
  return { output, limited }
}

function fadeEnvelope(index, length, fadeIn, fadeOut) {
  const entering = index < fadeIn ? index / fadeIn : 1
  const fromEnd = length - 1 - index
  const leaving = fromEnd < fadeOut ? fromEnd / fadeOut : 1
  return Math.min(entering, leaving)
}

function warnAboutSource(slug, sourcePeak, speech) {
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
}

function warnAboutDuration(slug, durationMs) {
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
}

function warnAboutLevels(slug, gain, limitedRatio) {
  if (gain >= MAX_GAIN)
    warnings.push(
      `${slug}: 너무 작게 녹음돼 ${MAX_GAIN}배까지만 키웠습니다 — 다른 족보보다 작게 들립니다. ` +
        `마이크에 조금 더 가까이서 다시 녹음해 주세요.`,
    )
  if (limitedRatio > 0.05)
    warnings.push(
      `${slug}: 리미터가 샘플의 ${(100 * limitedRatio).toFixed(1)}%에 걸렸습니다 — ` +
        `들어보고 뭉개진 느낌이면 마이크에서 조금 떨어져 다시 녹음해 주세요.`,
    )
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
  const rms = windowRms(samples, window)
  if (rms.length === 0) fail(`${slug}: 녹음이 ${WINDOW_MS}ms보다 짧습니다.`)

  const { loudest, loudestAt } = loudestWindow(rms)
  const onset = loudest * ONSET_RATIO
  const edge = loudest * EDGE_RATIO

  const runs = speechRuns(rms, onset)
  const run = runs.find(({ start, end }) => loudestAt >= start && loudestAt <= end)
  if (!run) fail(`${slug}: 말소리 구간을 찾지 못했습니다.`)

  const { first, last } = expandSpeechRun(rms, run, edge)
  const { noise, leftovers } = analyzeOutsideSpeech(rms, first, last, loudest)

  return {
    begin: first * window,
    end: Math.min(samples.length, (last + 1) * window),
    beginMs: first * WINDOW_MS,
    endMs: (last + 1) * WINDOW_MS,
    loudest,
    noise,
    leftovers,
  }
}

function windowRms(samples, window) {
  const rms = []
  for (let start = 0; start + window <= samples.length; start += window) {
    let square = 0
    for (let index = start; index < start + window; index += 1) {
      square += samples[index] * samples[index]
    }
    rms.push(Math.sqrt(square / window))
  }
  return rms
}

function loudestWindow(rms) {
  let loudest = 0
  let loudestAt = 0
  for (let index = 0; index < rms.length; index += 1) {
    if (rms[index] <= loudest) continue
    loudest = rms[index]
    loudestAt = index
  }
  return { loudest, loudestAt }
}

function speechRuns(rms, onset) {
  const gap = Math.round(GAP_MS / WINDOW_MS)
  const runs = []
  for (let index = 0; index < rms.length; index += 1) {
    if (rms[index] <= onset) continue
    const previous = runs[runs.length - 1]
    if (previous && index - previous.end <= gap) previous.end = index
    else runs.push({ start: index, end: index })
  }
  return runs
}

function expandSpeechRun(rms, run, edge) {
  const reach = Math.round(EDGE_MAX_MS / WINDOW_MS)
  let first = run.start
  while (first > 0 && run.start - first < reach && rms[first - 1] > edge) first -= 1
  let last = run.end
  while (last < rms.length - 1 && last - run.end < reach && rms[last + 1] > edge) last += 1
  return { first, last }
}

function analyzeOutsideSpeech(rms, first, last, loudest) {
  const outside = []
  const leftovers = []
  for (let index = 0; index < rms.length; index += 1) {
    if (index >= first && index <= last) continue
    outside.push(rms[index])
    if (rms[index] > loudest * LEFTOVER_RATIO) leftovers.push(index * WINDOW_MS)
  }
  outside.sort((left, right) => left - right)
  return {
    noise: outside.length > 0 ? outside[Math.floor(outside.length / 2)] : 0,
    // 연속으로 여러 창이 남으면 경고가 도배된다 — 구간별 첫 지점만 알린다.
    leftovers: leftovers.filter((ms, index) => index === 0 || ms - leftovers[index - 1] > GAP_MS),
  }
}

function msToSamples(ms) {
  return Math.round((SAMPLE_RATE * ms) / 1000)
}

/** 16bit 모노 PCM WAV. 헤더는 44바이트 표준형 하나만 쓴다. */
export function encodeWave(samples, sampleRate) {
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
