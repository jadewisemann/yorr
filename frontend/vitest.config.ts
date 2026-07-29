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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 테스트가 import한 파일만 세면 한 번도 실행되지 않은 소스가 분모에서 빠진다.
      // 전체 src를 기준으로 재야 수치가 실제 안전망 크기를 말해 준다.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        // 개발 전용 내부 도구 UI — 제품 코드가 아니라 분모에서 뺀다. 근거는 .dev.md 참고.
        'src/app/DevCatalog.tsx',
        'src/app/PhysicsDiceDemo.tsx',
        'src/app/MotionLab*.tsx',
        'src/app/useMotionLab.ts',
      ],
    },
  },
})
