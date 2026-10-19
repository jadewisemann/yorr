// Botkeep 배포물을 만든다 — deploy/botkeep/README.md.
//
// 결과는 `deploy/botkeep/out/`의 파일 두 개다: 의존성을 전부 품은 `yorr.mjs`와
// 시작 명령만 든 `package.json`. Botkeep에서 `npm install`이 할 일이 없다.
//
//   npm run build:botkeep
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const outDir = new URL('../../deploy/botkeep/out/', import.meta.url)

// 번들 맨 앞에 깐다.
// - CJS 의존성(fastify 등)의 `require`가 ESM 번들 안에서도 돌게 한다.
// - Pterodactyl 계열 패널은 할당 포트를 SERVER_PORT로 준다. PORT만 주는 곳도 받는다.
const banner = `import { createRequire as __yorrRequire } from 'node:module';
const require = __yorrRequire(import.meta.url);
if (process.env.SERVER_PORT === undefined && process.env.PORT !== undefined) process.env.SERVER_PORT = process.env.PORT;`

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const result = await build({
  // `URL.pathname`은 퍼센트 인코딩이라 공백·한글이 든 경로에서 esbuild가 파일을 못 찾는다.
  entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('yorr.mjs', outDir)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  banner: { js: banner },
  metafile: true,
  logLevel: 'warning',
})

// 힙 상한 128MB: 512MB 플랜에서 GC 압박 없이 여유가 남는다(실측은 deploy/botkeep/README.md).
// SQLite의 ExperimentalWarning은 Node 22의 소음이다.
const packageJson = {
  name: 'yorr-botkeep',
  private: true,
  type: 'module',
  engines: { node: '>=22.13' },
  scripts: {
    start:
      'node --max-old-space-size=128 --max-semi-space-size=2 --disable-warning=ExperimentalWarning yorr.mjs',
  },
}
await writeFile(new URL('package.json', outDir), `${JSON.stringify(packageJson, null, 2)}\n`)

const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0)
console.log(`deploy/botkeep/out/yorr.mjs ${(bytes / 1024 / 1024).toFixed(2)}MB`)
