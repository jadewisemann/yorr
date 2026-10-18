// Botkeep 배포물을 만든다 — deploy/botkeep/README.md.
//
// 결과는 `deploy/botkeep/out/`의 파일 두 개다: 의존성을 전부 품은 `yorr.mjs`와
// 시작 명령만 든 `package.json`. Botkeep에서 `npm install`이 할 일이 없다.
//
//   npm run build:botkeep
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const outDir = new URL('../../deploy/botkeep/out/', import.meta.url)

// 번들은 SQLite만 쓴다(DB_DRIVER=sqlite). mysql2와 그 의존성(iconv-lite 등)이 번들의
// 3분의 1이라 빈 모듈로 바꿔 끼운다. 누가 MySQL을 고르면 기동 즉시 시끄럽게 실패한다.
const withoutMysql = {
  name: 'without-mysql',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^mysql2(\/promise)?$/ }, () => ({
      path: 'mysql2',
      namespace: 'without-mysql',
    }))
    pluginBuild.onLoad({ filter: /.*/, namespace: 'without-mysql' }, () => ({
      contents:
        "export default { createPool() { throw new Error('Botkeep 번들에는 MySQL이 없다 — DB_DRIVER=sqlite') } }",
      loader: 'js',
    }))
  },
}

// 번들 맨 앞에서 Botkeep의 기본값을 깐다. 패널에 같은 이름의 환경 변수를 넣으면 그쪽이 이긴다.
// - CJS 의존성(ioredis 등)의 `require`가 ESM 번들 안에서도 돌게 한다.
// - Pterodactyl 계열 패널은 할당 포트를 SERVER_PORT로 준다. PORT만 주는 곳도 받는다.
const banner = `import { createRequire as __yorrRequire } from 'node:module';
const require = __yorrRequire(import.meta.url);
process.env.REDIS_DRIVER ??= 'memory';
process.env.DB_DRIVER ??= 'sqlite';
if (process.env.SERVER_PORT === undefined && process.env.PORT !== undefined) process.env.SERVER_PORT = process.env.PORT;`

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const result = await build({
  entryPoints: [new URL('../src/main.ts', import.meta.url).pathname],
  outfile: new URL('yorr.mjs', outDir).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  banner: { js: banner },
  plugins: [withoutMysql],
  metafile: true,
  logLevel: 'warning',
})

// 힙 상한: 512MB 플랜에서 실측 RSS가 기동 직후 약 100MB, 부하 뒤 약 140MB였다(힙 96MB 기준).
// 128MB면 GC 압박 없이 여유가 남는다. SQLite의 ExperimentalWarning은 Node 22의 소음이다.
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
