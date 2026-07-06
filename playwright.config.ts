import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199/task-tracker/',
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    // В CI/окружениях с предустановленным Chromium можно указать путь к бинарнику
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199/task-tracker/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
