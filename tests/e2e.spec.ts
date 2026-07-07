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

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await editor.pressSequentially('Важный текст')
  await page.waitForTimeout(1200) // debounce сохранения описания
  await page.keyboard.press('Escape')

  // Переоткрываем — описание на месте
  await page.getByText('Задача с описанием').click()
  await expect(page.locator('.ProseMirror')).toContainText('Важный текст')
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
