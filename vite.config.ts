import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * Service worker для мгновенного запуска PWA: берёт шаблон src/serviceWorker.js,
 * подставляет версию сборки и полный список файлов приложения (для скачивания
 * при установке) и кладёт результат в dist/sw.js. Версия также пишется в
 * index.html (<meta name="tt-build">) — по ней SW проверяет, что скачал
 * index.html ровно своей сборки, а страница — что вышла новая версия.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'tt-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') throw new Error('tt-service-worker: нет index.html в сборке')
      const publicFiles = readdirSync('public').filter((f) => f !== 'sw.js' && !f.startsWith('.'))
      const files = [...Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map')), ...publicFiles].sort()

      const hash = createHash('sha256')
      hash.update(String(html.source))
      for (const f of files) {
        hash.update(f)
        if (publicFiles.includes(f)) hash.update(readFileSync(`public/${f}`))
      }
      hash.update(readFileSync('src/serviceWorker.js'))
      const version = hash.digest('hex').slice(0, 12)

      html.source = String(html.source).replace('<head>', `<head>\n    <meta name="tt-build" content="${version}" />`)
      const sw = readFileSync('src/serviceWorker.js', 'utf8')
        .replace('__TT_VERSION__', version)
        .replace('__TT_PRECACHE__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw })
    },
  }
}

// Приложение публикуется на GitHub Pages по адресу
// https://<owner>.github.io/task-tracker/ — поэтому base = '/task-tracker/'
export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  base: '/task-tracker/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
