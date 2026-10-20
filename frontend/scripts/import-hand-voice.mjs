/**
 * 직접 녹음한 족보 콜아웃을 게임 에셋으로 변환한다.
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
 *
 * 신호 처리 자체는 [`voiceDsp.mjs`](./voiceDsp.mjs), 조정 가능한 값은
 * [`voiceConstants.mjs`](./voiceConstants.mjs)에 있다. 이 파일은 **입출력 배선**만 한다.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { SAMPLE_RATE, SLUGS } from './voiceConstants.mjs'
import { encodeWave, shape, VoiceImportError, warnings } from './voiceDsp.mjs'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const inputDir = resolve(process.argv[2] ?? join(scriptDir, 'voice-source'))
const outputDir = join(frontendDir, 'public/audio/hand-voice')

/** 입력 폴더에서 슬러그 → 파일 경로를 모은다. 확장자는 보지 않는다. */
function collectSources(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new VoiceImportError(`입력 폴더가 없습니다: ${dir}`)
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

async function main() {
  const sources = collectSources(inputDir)
  const missing = SLUGS.filter((slug) => !sources.has(slug))
  if (missing.length === SLUGS.length) {
    throw new VoiceImportError(
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

  try {
    for (const slug of SLUGS) {
      const source = sources.get(slug)
      if (!source) continue

      const decoded = await decode(page, source)
      const clip = shape(decoded, slug)
      writeFileSync(join(outputDir, `${slug}.wav`), encodeWave(clip.samples, SAMPLE_RATE))

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
    console.log('\n확인이 필요한 항목:')
    for (const warning of warnings) console.log(`  ! ${warning}`)
  }
  console.log('\n들어보기: npm run dev 후 굴리거나, public/audio/hand-voice 의 wav를 직접 재생')
}

try {
  await main()
} catch (error) {
  if (!(error instanceof VoiceImportError)) throw error
  console.error(`\n${error.message}\n`)
  process.exit(1)
}
