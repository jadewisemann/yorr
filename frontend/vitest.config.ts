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

    testTimeout: 20_000,

    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',

      reporter: ['text', 'html', 'lcov', 'json', 'json-summary'],

      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        // 하네스와 대역은 검사를 돕는 도구지 측정 대상이 아니다. `*.test.tsx`가 아니라서
        // 기본 제외에 걸리지 않는다.
        'src/**/__tests__/**',

        'src/mocks/**',

        'src/app/dev/DevCatalog.tsx',
        'src/app/dev/PhysicsDiceDemo.tsx',
        'src/app/dev/MotionLab*.tsx',
        'src/app/dev/useMotionLab.ts',
        'src/app/dev/HandVoiceLab.tsx',

        'src/yacht/rendering/physics-dice/World.ts',
      ],

      /*
       * **현재 수치를 바닥으로 고정한 래칫**이다(QUALITY.md 4단계). 여기 있던 96·91·96·98은
       * 실측이 아니라 목표였고, `npm test`가 --coverage 없이 도는 바람에 CI에서 한 번도
       * 강제된 적이 없었다 — 즉 통과한 적 없는 값이 설정만 되어 있었다.
       *
       * 올릴 때는 이 숫자를 함께 올린다. 내리는 변경은 리뷰에서 막는다.
       */
      thresholds: {
        statements: 82,
        branches: 77,
        functions: 85,
        lines: 83,
      },
    },
  },
})
