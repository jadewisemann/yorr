/**
 * 히어로 에셋 베이크 — heroScene(three.js)을 오프라인에서 돌려 투명 배경 WebP를 굽는다.
 *
 * 랜딩 런타임은 이 결과물(`public/hero/*.webp`)만 쓴다. three.js 512KB(gzip 127KB)와
 * WebGL 렌더 루프를 첫 화면에서 치우는 대신, heroScene.ts는 이 스크립트의 렌더러로
 * 남는다 — 장면(구도·재질·조명)을 고치면 이 스크립트를 다시 돌려 에셋을 갈아끼운다.
 *
 *   npm run bake:hero
 *
 * ⚠️ 피사체 색은 `--ds-color-physics-*` 토큰에서 굽는 시점에 동결된다.
 *    팔레트를 바꾸면 재베이크해야 한다(docs/llmwiki/landing.md 「히어로 아트」).
 *
 * 프레이밍 두 벌을 굽는다 — heroScene.handleResize가 컨테이너 세로/가로비로
 * 카메라·무대를 다르게 잡기 때문에(카메라 z 22↔30, 무대 오프셋·스케일) 한 장으로는
 * 두 레이아웃을 다 못 덮는다. 런타임은 object-cover로 얹는다: 장면의 피사체 크기가
 * 컨테이너 높이에 비례하므로(세로 FOV 고정) cover가 라이브 프레이밍과 같은 규칙이다.
 *
 * 주사위 눈은 Math.random을 시드 LCG로 갈아끼워 고정한다 — 아니면 베이크마다
 * diff가 나서 "장면이 바뀌었는가"를 파일로 판정할 수 없다.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'hero')
const PORT = 5183

const GAMES = ['yacht', 'pingpong', 'duel', 'davinci', 'liars', 'fishing']
const FRAMINGS = [
  { name: 'wide', width: 1280, height: 768 },
  { name: 'narrow', width: 560, height: 800 },
]
// 눈 배치가 보기 좋게 나오는 시드를 골라 둔 값 — 바꾸면 모든 에셋의 주사위가 다시 구른다.
const SEED = 20260821

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 아직 안 떴다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`vite dev 서버가 ${timeoutMs}ms 안에 뜨지 않았습니다: ${url}`)
}

async function bake(page, { game, width, height }) {
  return page.evaluate(
    async ({ game, width, height, seed }) => {
      let state = seed
      Math.random = () => {
        state = (state * 1664525 + 1013904223) % 4294967296
        return state / 4294967296
      }
      const { HeroScene } = await import('/src/landing/rendering/heroScene.ts')
      const container = document.createElement('div')
      container.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;background:transparent`
      document.body.appendChild(container)
      // reducedMotion: 등장 애니메이션 없이 완성 프레임을 동기로 그린다. WebGL 버퍼는
      // 태스크가 끝나면 비워질 수 있으므로 drawImage까지 같은 태스크 안에서 끝낸다.
      const scene = new HeroScene({ container, game, reducedMotion: true })
      const glCanvas = container.querySelector('canvas')
      const out = document.createElement('canvas')
      out.width = glCanvas.width
      out.height = glCanvas.height
      out.getContext('2d').drawImage(glCanvas, 0, 0)
      scene.destroy()
      container.remove()
      return out.toDataURL('image/webp', 0.85)
    },
    { game, width, height, seed: SEED },
  )
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
try {
  await waitForServer(`http://localhost:${PORT}/`)
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch(
    process.env.HERO_BAKE_CHROMIUM ? { executablePath: process.env.HERO_BAKE_CHROMIUM } : {},
  )
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })

  for (const game of GAMES) {
    for (const framing of FRAMINGS) {
      const dataUrl = await bake(page, { game, ...framing })
      const file = path.join(OUT_DIR, `${game}-${framing.name}.webp`)
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      await writeFile(file, bytes)
      console.log(`${path.relative(ROOT, file)}  ${(bytes.length / 1024).toFixed(0)}KB`)
    }
  }
  await browser.close()
} finally {
  server.kill()
}
