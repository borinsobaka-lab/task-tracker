// Готовит папку site/ для ручной публикации без GitHub Actions (например,
// Cloudflare Pages → «Upload assets»): приложение лежит в site/task-tracker/,
// как на GitHub Pages, а корень сайта перенаправляет туда.
// Запуск: npm run pack:site (сначала собирает проект).
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

rmSync('site', { recursive: true, force: true })
mkdirSync('site')
cpSync('dist', 'site/task-tracker', { recursive: true })
writeFileSync('site/_redirects', '/              /task-tracker/  302\n/task-tracker  /task-tracker/  301\n')
writeFileSync(
  'site/index.html',
  '<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=/task-tracker/">\n<title>Задачи</title>\n<a href="/task-tracker/">Открыть приложение</a>\n',
)
console.log('Готово: папка site/ — загрузите её содержимое на хостинг.')
