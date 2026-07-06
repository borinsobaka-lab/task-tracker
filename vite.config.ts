import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Приложение публикуется на GitHub Pages по адресу
// https://<owner>.github.io/task-tracker/ — поэтому base = '/task-tracker/'
export default defineConfig({
  plugins: [react()],
  base: '/task-tracker/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
