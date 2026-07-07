import { expect, test } from '@playwright/test'

// Тесты идут в демо-режиме (?demo=1): вместо GitHub — localStorage.
// Каждый тест начинается с чистого состояния.

test.beforeEach(async ({ page }) => {
  await page.goto('?demo=1')
  await page.evaluate(() => localStorage.clear())
  await page.goto('?demo=1')
})

async function createIdentity(page: import('@playwright/test').Page, name = 'Борис') {
  await expect(page.getByRole('heading', { name: 'Кто вы?' })).toBeVisible()
  await page.getByPlaceholder(/Имя/).fill(name)
  await page.getByRole('button', { name: 'Добавить' }).click()
}

test('первый вход: создание участника и пустая доска', async ({ page }) => {
  await createIdentity(page)
  await expect(page.getByText('Нужно сделать')).toBeVisible()
  await expect(page.getByText('В работе')).toBeVisible()
  await expect(page.getByText('Готово')).toBeVisible()
})

test('создание карточки и открытие модалки', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Позвонить клиенту')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Позвонить клиенту')).toBeVisible()

  await page.getByText('Позвонить клиенту').click()
  // Модалка открылась: есть заголовок карточки и кнопка удаления
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeHidden()
})

test('чек-лист в карточке', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача с чек-листом')
  await page.keyboard.press('Enter')
  await page.getByText('Задача с чек-листом').click()

  const addItem = page.getByPlaceholder(/пункт/i)
  await addItem.fill('Первый шаг')
  await addItem.press('Enter')
  await addItem.fill('Второй шаг')
  await addItem.press('Enter')

  // Текст пунктов живёт в input.cm-check-text
  await expect(page.locator('.cm-check-text').nth(0)).toHaveValue('Первый шаг')
  await expect(page.locator('.cm-check-text').nth(1)).toHaveValue('Второй шаг')

  // Отмечаем первый пункт выполненным
  await page.locator('input[type="checkbox"]').first().check()
  await expect(page.locator('.cm-check-count')).toHaveText('1/2')
})

test('назначение даты и отображение в календаре', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Встреча с командой')
  await page.keyboard.press('Enter')
  await page.getByText('Встреча с командой').click()

  // Назначаем сегодняшнюю дату со временем 14:00
  await page.getByRole('button', { name: /Добавить дату/ }).click()
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await page.locator('input[type="date"]').fill(key)
  await page.locator('input[type="time"]').fill('14:00')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.keyboard.press('Escape')

  // Переключаемся на календарь (на десктопе — таб в шапке) — блок задачи виден на этой неделе
  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByText('Встреча с командой')).toBeVisible()
  await expect(page.getByText(/14:00/).first()).toBeVisible()
})

test('данные переживают перезагрузку страницы', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Стабильная задача')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Стабильная задача')).toBeVisible()

  // Ждём debounce-сохранение
  await page.waitForTimeout(2000)
  await page.reload()
  await expect(page.getByText('Стабильная задача')).toBeVisible()
})

test('редактирование описания с форматированием', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача с описанием')
  await page.keyboard.press('Enter')
  await page.getByText('Задача с описанием').click()

  // Редактор описания — в левой (контентной) части модалки
  const editor = page.locator('.cm-main .ProseMirror')
  await editor.click()
  await editor.pressSequentially('Важный текст')
  await page.waitForTimeout(1200) // debounce сохранения описания
  await page.keyboard.press('Escape')

  // Переоткрываем — описание на месте
  await page.getByText('Задача с описанием').click()
  await expect(page.locator('.cm-main .ProseMirror')).toContainText('Важный текст')
})

test('глобальный поиск в шапке находит задачу и открывает её', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Уникальная задача поиска')
  await page.keyboard.press('Enter')
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Другое дело')
  await page.keyboard.press('Enter')

  // Поле поиска — в верхнем хедере (десктоп)
  const search = page.locator('.header-search-input')
  await search.fill('Уникальная')
  const result = page.locator('.search-result', { hasText: 'Уникальная задача поиска' })
  await expect(result).toBeVisible()
  // Статус (колонка) показан в результате
  await expect(result.locator('.search-result-status')).toContainText('Нужно сделать')
  // Нерелевантная задача не в выдаче
  await expect(page.locator('.search-result', { hasText: 'Другое дело' })).toHaveCount(0)

  // Клик открывает карточку
  await result.click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
})

test('таймлайн календаря: хронология с закреплением просроченных', async ({ page }) => {
  await createIdentity(page)
  // Создаём задачу и ставим ей сегодняшнюю дату/время
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача таймлайна')
  await page.keyboard.press('Enter')
  await page.getByText('Задача таймлайна').click()
  await page.getByRole('button', { name: /Добавить дату/ }).click()
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await page.locator('input[type="date"]').fill(key)
  await page.locator('input[type="time"]').fill('12:00')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.keyboard.press('Escape')

  // Открываем календарь и переключаемся в «Таймлайн»
  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.locator('.cal-view-select').selectOption('timeline')
  await expect(page.locator('.cal-timeline')).toBeVisible()
  // Задача видна в таймлайне (в блоке «Сегодня» или «Просрочено» — зависит от времени запуска)
  await expect(page.locator('.tl-card', { hasText: 'Задача таймлайна' })).toBeVisible()
  await expect(page.locator('.tl-daylabel').first()).toBeVisible()
})

test('крупная кнопка закрытия модалки работает', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Закрыть по кнопке')
  await page.keyboard.press('Enter')
  await page.getByText('Закрыть по кнопке').click()

  await expect(page.locator('.cm-close')).toBeVisible()
  await page.locator('.cm-close').click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeHidden()
})

test('комментарии: добавление, бейдж, правка и удаление', async ({ page }) => {
  await createIdentity(page, 'Борис')
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача для обсуждения')
  await page.keyboard.press('Enter')
  await page.getByText('Задача для обсуждения').click()

  // Панель комментариев видна (десктоп — справа)
  await expect(page.locator('.cm-comments')).toBeVisible()

  // Пишем и отправляем комментарий
  const composer = page.locator('.comment-composer .ProseMirror')
  await composer.click()
  await composer.pressSequentially('Первый комментарий')
  await page.locator('.comment-composer').getByRole('button', { name: 'Отправить' }).click()

  // Комментарий появился с автором и текстом
  const item = page.locator('.comment', { hasText: 'Первый комментарий' })
  await expect(item).toBeVisible()
  await expect(item.locator('.comment-author')).toHaveText('Борис')

  await page.keyboard.press('Escape')

  // На карточке доски — бейдж комментариев с количеством, не красный (я автор и прочитал)
  const card = page.locator('.board-card', { hasText: 'Задача для обсуждения' })
  const badge = card.locator('.card-badge').filter({ hasText: '1' })
  await expect(badge).toBeVisible()
  await expect(badge).not.toHaveClass(/unseen/)

  // Переоткрываем и правим свой комментарий
  await card.click()
  await page.locator('.comment').getByRole('button', { name: 'Изменить' }).click()
  const editor = page.locator('.comment .comment-composer .ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+A')
  await editor.pressSequentially('Исправленный комментарий')
  await page.locator('.comment .comment-composer').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.comment', { hasText: 'Исправленный комментарий' })).toBeVisible()
  await expect(page.locator('.comment-time')).toContainText('изменён')

  // Удаляем свой комментарий
  page.once('dialog', (d) => d.accept())
  await page.locator('.comment').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.comment')).toHaveCount(0)
})

test('живая публичная ссылка на таймлайн — внешняя страница только для просмотра', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await createIdentity(page)
  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.locator('.cal-view-select').selectOption('timeline')
  // Кнопка «Ссылка» копирует стабильную живую ссылку #timeline
  await page.getByRole('button', { name: 'Ссылка' }).click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toMatch(/#timeline$/)

  // Живая страница читает публичный timeline.json (мокаем сеть) и рендерит только просмотр
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const pub = await context.newPage()
  await pub.route('**/raw.githubusercontent.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        items: [{ id: 'x', title: 'Задача из виджета', date: key, start: '10:00', durationMin: 60, members: [{ name: 'Борис', color: '#7c5cff' }] }],
      }),
    }),
  )
  await pub.goto(url)
  await expect(pub.locator('.public-tl')).toBeVisible()
  await expect(pub.locator('.tl-card', { hasText: 'Задача из виджета' })).toBeVisible()
  await expect(pub.locator('.view-tabs')).toHaveCount(0)
  await expect(pub.locator('.tl-card.clickable')).toHaveCount(0)
})
