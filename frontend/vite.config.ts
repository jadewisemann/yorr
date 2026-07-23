import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
<<<<<<< HEAD
  plugins: [react()],
=======
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': '/src' },
  },
>>>>>>> 96e7252d9d23d7d509ed4819e8180e49c884c7c8
  server: {
    host: true,
    port: 5173,
  },
})
