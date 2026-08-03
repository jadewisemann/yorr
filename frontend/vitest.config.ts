import react from '@vitejs/plugin-react'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // 기본 5000ms는 setup.ts의 asyncUtilTimeout(5000)과 같아, 쿼리가 대기를 다 쓰면
    // 어떤 DOM을 봤는지 알려주는 RTL 오류 대신 밋밋한 "test timed out"이 뜬다.
    testTimeout: 20_000,
    // RAPIER wasm 초기화(World.test.ts)는 부하가 걸리면 기본 10000ms를 넘긴다.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // lcov·json-summary 는 CI·후속 도구(리포트 코멘트, ratchet 스크립트) 연계용.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // 테스트가 import한 파일만 세면 한 번도 실행되지 않은 소스가 분모에서 빠진다.
      // 전체 src를 기준으로 재야 수치가 실제 안전망 크기를 말해 준다.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        // mock 인프라(MSW 핸들러·픽스처)는 제품 코드가 아니라 분모에서 뺀다.
        'src/mocks/**',
        // 개발 전용 내부 도구 UI — 제품 코드가 아니라 분모에서 뺀다. 근거는 .dev.md 참고.
        // app/dev/** 로 뭉치지 않는다 — 같은 폴더의 motionLab*.ts 유틸은 테스트가 있고
        // 분모에 남아야 한다. UI만 빼는 것이 이 목록의 의도다.
        'src/app/dev/DevCatalog.tsx',
        'src/app/dev/PhysicsDiceDemo.tsx',
        'src/app/dev/MotionLab*.tsx',
        'src/app/dev/useMotionLab.ts',
        'src/app/dev/HandVoiceLab.tsx',
        // 커버리지가 실행마다 갈리는 유일한 파일 — 렌더 루프가 performance.now()로 실제
        // 프레임 간격을 재고, 그 값이 accumulator 루프 반복 횟수와 Math.min(0.08, ...) clamp
        // 분기를 좌우한다. 부하에 따라 branches 71.71%~84.84%로 흔들려, 분모에 두면 코드
        // 변경 없이 CI 가 랜덤 실패한다(측정: 같은 829 테스트로 전역 branches 90.48% vs 91.43%).
        // 물리 난수는 seed 고정이라 원인이 아니고, 이 파일을 빼면 전역 수치가 두 실행에서
        // 소수점까지 같아진다. thresholds 의 파일별 glob 은 전역 분모에서 빼주지 않아
        // (검증: glob 하한을 줘도 전역이 World.ts 를 계속 계산) exclude 가 유일한 수단이다.
        // 테스트 47개는 그대로 돌며 물리 거동을 검증한다 — 빠지는 것은 측정뿐이다.
        // 근본 해결은 World.ts 가 시간을 주입받아 테스트가 가짜 시계를 넣는 것이고,
        // 렌더 루프를 고쳐야 하므로 별도 작업이다.
        'src/yacht/rendering/physics-dice/World.ts',
      ],
      // ratchet 방식: 실측값(statements 96.33 · branches 91.94 · functions 96.63 · lines 98.40)에서
      // 소폭 여유를 둔 하한. 커버리지가 오르면 임계값도 따라 올린다. 내려가는 변경은 CI 에서 막는다.
      thresholds: {
        statements: 96,
        branches: 91,
        functions: 96,
        lines: 98,
      },
    },
  },
})
