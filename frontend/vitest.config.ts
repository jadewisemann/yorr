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

      reporter: ['text', 'html', 'lcov', 'json-summary'],

      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',

        'src/mocks/**',

        'src/app/dev/DevCatalog.tsx',
        'src/app/dev/PhysicsDiceDemo.tsx',
        'src/app/dev/MotionLab*.tsx',
        'src/app/dev/useMotionLab.ts',
        'src/app/dev/HandVoiceLab.tsx',

        'src/yacht/rendering/physics-dice/World.ts',
      ],

      thresholds: {
        statements: 96,
        branches: 91,
        functions: 96,
        lines: 98,
      },
    },
  },
})
