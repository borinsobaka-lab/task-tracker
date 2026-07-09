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

test('конфетти: кнопка «Готово» в модалке запускает анимацию', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Готово из модалки')
  await page.keyboard.press('Enter')
  await page.getByText('Готово из модалки').click()
  await page.locator('.cm-done').click()
  await expect(page.locator('.confetti-canvas')).toHaveAttribute('data-active', '1')
})

test('конфетти: смена статуса на «Готово» в модалке запускает анимацию', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Статус в Готово')
  await page.keyboard.press('Enter')
  await page.getByText('Статус в Готово').click()
  await page.locator('.cm-col-select').selectOption({ label: 'Готово' })
  await expect(page.locator('.confetti-canvas')).toHaveAttribute('data-active', '1')
})

test('конфетти: чекбокс в календаре запускает анимацию', async ({ page }) => {
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача на сегодня')
  await page.keyboard.press('Enter')
  await page.getByText('Задача на сегодня').click()
  await page.getByRole('button', { name: /Добавить дату/ }).click()
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await page.locator('input[type="date"]').fill(key)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.locator('.cal-chip-check').first().click()
  await expect(page.locator('.confetti-canvas')).toHaveAttribute('data-active', '1')
})

test('конфетти: отметка в разделе «Повтор» запускает анимацию', async ({ page }) => {
  await createIdentity(page)
  await page.getByRole('button', { name: 'Повтор' }).click()
  await page.getByRole('button', { name: /Регулярная задача/ }).click()
  await page.getByPlaceholder(/Планёрка/).fill('Регулярная задача')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.locator('.rec-check').first().click()
  await expect(page.locator('.confetti-canvas')).toHaveAttribute('data-active', '1')
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

test('история проекта фиксирует события и открывает задачу', async ({ page }) => {
  await createIdentity(page, 'Борис')
  await page.getByText('Добавить карточку').first().click()
  await page.locator('.board-col').first().locator('textarea').fill('Собрать отчёт')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // Назначаем приоритет — ещё одно событие в истории
  await page.getByText('Собрать отчёт').click()
  await page.locator('.cm-prio-btn').click()
  await page.locator('.cm-prio-item').first().click()
  await page.keyboard.press('Escape')

  // Открываем историю
  await page.getByRole('button', { name: 'История проекта' }).click()
  const modal = page.locator('.history-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.history-daylabel', { hasText: 'Сегодня' })).toBeVisible()
  await expect(modal.locator('.history-row', { hasText: 'создал(а) задачу' })).toContainText('Собрать отчёт')
  await expect(modal.locator('.history-row', { hasText: 'изменил(а) приоритет' })).toBeVisible()

  // Клик по записи открывает связанную задачу
  await modal.locator('.history-row.clickable').first().click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
})

test('мобильная навигация: разделы в нижнем меню', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  // Верхние табы скрыты, снизу — навигация из 4 разделов
  await expect(page.locator('.view-tabs')).toBeHidden()
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.locator('.bottom-nav-item:not(.bottom-nav-add)')).toHaveCount(4)
  // В шапке — название текущего раздела
  await expect(page.locator('.header-title-mobile')).toHaveText('Доска')
  // Переключаемся на «Календарь» через нижнее меню
  await page.locator('.bottom-nav-item', { hasText: 'Календарь' }).click()
  await expect(page.locator('.cal-view-select')).toBeVisible()
  await expect(page.locator('.header-title-mobile')).toHaveText('Календарь')
})

test('доска: сортировка колонки по приоритету', async ({ page }) => {
  await createIdentity(page)
  const col = page.locator('.board-col').first()
  const addCard = async (title: string) => {
    await col.getByText('Добавить карточку').click()
    await col.locator('textarea').fill(title)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
  }
  await addCard('Без приоритета')
  await addCard('Низкий')
  await addCard('Высокий')

  const setPrio = async (title: string, idx: number) => {
    await page.locator('.board-card-title-text', { hasText: title }).click()
    await page.locator('.cm-prio-btn').click()
    await page.locator('.cm-prio-item').nth(idx).click()
    await page.keyboard.press('Escape')
  }
  await setPrio('Высокий', 0) // q1 — срочно и важно
  await setPrio('Низкий', 3) // q4 — не срочно, не важно
  // «Без приоритета» остаётся без приоритета

  // Сортируем колонку по приоритету
  await col.locator('.col-menu-wrap .icon-btn').click()
  await page.getByRole('menuitem', { name: 'Сортировать по приоритету' }).click()

  // Порядок: высший приоритет → низший → без приоритета
  const titles = col.locator('.board-card-title-text')
  await expect(titles.nth(0)).toHaveText('Высокий')
  await expect(titles.nth(1)).toHaveText('Низкий')
  await expect(titles.nth(2)).toHaveText('Без приоритета')
})

test('доска: приоритет показывается полосой слева, а не точкой', async ({ page }) => {
  await createIdentity(page)
  const col = page.locator('.board-col').first()
  const addCard = async (title: string) => {
    await col.getByText('Добавить карточку').click()
    await col.locator('textarea').fill(title)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
  }
  await addCard('Красная задача')
  await addCard('Серая задача')

  // Ставим «Красной задаче» приоритет q1 (красный)
  await page.locator('.board-card-title-text', { hasText: 'Красная задача' }).click()
  await page.locator('.cm-prio-btn').click()
  await page.locator('.cm-prio-item').nth(0).click()
  await page.keyboard.press('Escape')

  // Точек приоритета больше нет — приоритет теперь полоса слева
  await expect(page.locator('.card-prio-dot')).toHaveCount(0)
  const stripe = (title: string) =>
    page.locator('.board-card', { hasText: title }).evaluate((el) => getComputedStyle(el).borderLeftColor)
  expect(await stripe('Красная задача')).toBe('rgb(239, 68, 68)') // q1 #ef4444
  expect(await stripe('Серая задача')).toBe('rgb(201, 204, 221)') // без приоритета — серый #c9ccdd
})

test('повтор: описание одной строкой и новый крестик в редакторе', async ({ page }) => {
  await createIdentity(page)
  await page.getByRole('button', { name: 'Повтор' }).click()
  await page.getByRole('button', { name: /Регулярная задача/ }).click()
  await page.getByPlaceholder(/Планёрка/).fill('Планёрка')
  const editor = page.locator('.rec-editor .ProseMirror').first()
  await editor.click()
  await editor.pressSequentially('Короткое описание планёрки')
  // Крестик — такой же, как в модалке задачи (.cm-close с тонким IcoX)
  await expect(page.locator('.rec-editor .cm-close')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  // Описание показано одной строкой под названием
  await expect(page.locator('.rec-desc')).toHaveText('Короткое описание планёрки')
})

test('десктоп: плавающая кнопка «Добавить задачу» открывает модалку новой задачи', async ({ page }) => {
  await createIdentity(page)
  const fab = page.locator('.fab')
  await expect(fab).toBeVisible()
  await expect(fab).toContainText('Добавить задачу')
  await fab.click()
  // Открылась модалка создания задачи
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
})

test('пустой черновик от «+» не сохраняется, а с названием — сохраняется при закрытии', async ({ page }) => {
  await createIdentity(page)
  // Открываем новую задачу и закрываем, ничего не введя — пустышка не остаётся
  await page.locator('.fab').click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
  await page.locator('.cm-close').click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeHidden()
  await page.waitForTimeout(200) // отложенная проверка пустоты черновика
  await expect(page.locator('.board-card')).toHaveCount(0)

  // Теперь вводим название — задача фиксируется при закрытии
  await page.locator('.fab').click()
  await page.locator('.cm-title').fill('Черновик с названием')
  await page.locator('.cm-close').click()
  await page.waitForTimeout(200)
  await expect(page.locator('.board-card', { hasText: 'Черновик с названием' })).toBeVisible()
})

test('мобильное меню: кнопка «+» открывает быстрое добавление и создаёт задачу', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  // Плавающей кнопки на телефоне нет — только «+» в нижнем меню
  await expect(page.locator('.fab')).toBeHidden()
  await page.locator('.bottom-nav-add').click()
  // Открылся лист быстрого добавления (а не полная модалка)
  await expect(page.locator('.qa-sheet')).toBeVisible()
  await page.locator('.qa-title').fill('Быстрая задача')
  await page.locator('.qa-desc').fill('Короткое описание')
  await page.locator('.qa-send').click()
  // Лист закрылся, карточка появилась на доске
  await expect(page.locator('.qa-sheet')).toBeHidden()
  await expect(page.locator('.board-card', { hasText: 'Быстрая задача' })).toBeVisible()
})

test('мобильная модалка-лист: грабер виден и закрывает окно', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача-лист')
  await page.keyboard.press('Enter')
  await page.getByText('Задача-лист').click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeVisible()
  // Полоска-грабер вверху видна на мобильном и закрывает окно по нажатию
  const grab = page.locator('.sheet-grabber')
  await expect(grab).toBeVisible()
  await grab.click()
  await expect(page.getByRole('button', { name: /Удалить карточку/ })).toBeHidden()
})

test('быстрое добавление: приоритет и статус применяются', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  await page.locator('.bottom-nav-add').click()
  await page.locator('.qa-title').fill('Срочная')
  // приоритет q1 (красный)
  await page.locator('.qa-chip', { hasText: 'Приоритет' }).click()
  await page.locator('.qa-pop-item', { hasText: 'Срочно и важно' }).click()
  // статус «В работе»
  await page.locator('.qa-chip', { hasText: 'Нужно сделать' }).click()
  await page.locator('.qa-pop-item', { hasText: 'В работе' }).click()
  await page.locator('.qa-send').click()
  // карточка в колонке «В работе», левая полоса — красная (q1)
  const doingCol = page.locator('.board-col', { hasText: 'В работе' })
  const card = doingCol.locator('.board-card', { hasText: 'Срочная' })
  await expect(card).toBeVisible()
  const color = await card.evaluate((el) => getComputedStyle(el).borderLeftColor)
  expect(color).toBe('rgb(239, 68, 68)')
})

test('мобильный календарь запоминает свёрнутую панель «Без даты»', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  await page.waitForTimeout(1500) // дождаться сохранения участника (демо-дебаунс), чтобы пережить reload
  await page.locator('.bottom-nav-item', { hasText: 'Календарь' }).click()
  // Панель развёрнута, сворачиваем её
  await expect(page.locator('.cal-sidebar-title')).toBeVisible()
  await page.locator('.cal-sidebar .cal-collapse').click()
  await expect(page.locator('.cal-sidebar.collapsed')).toBeVisible()
  await page.waitForTimeout(300)

  // После перезагрузки (тот же вид) панель осталась свёрнутой
  await page.reload()
  await expect(page.locator('.cal-sidebar.collapsed')).toBeVisible()
})

test('десктоп: панель «Без даты» всегда развёрнута', async ({ page }) => {
  await createIdentity(page)
  // Помечаем панель как свёрнутую (как будто с телефона) — на десктопе это игнорируется
  await page.evaluate(() => localStorage.setItem('tt.calPanel', '0'))
  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.locator('.cal-sidebar-title')).toBeVisible()
  await expect(page.locator('.cal-sidebar.collapsed')).toHaveCount(0)
})

test('календарь: панель «Без даты» скрывает готовые задачи', async ({ page }) => {
  await createIdentity(page)
  // Активная задача остаётся в «Нужно сделать»
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Активная задача')
  await page.keyboard.press('Enter')
  // Вторую помечаем выполненной — уезжает в «Готово»
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Готовая задача')
  await page.keyboard.press('Enter')
  await page.getByText('Готовая задача').click()
  await page.locator('.cm-done').click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Календарь' }).click()
  const sidebar = page.locator('.cal-sidebar')
  await expect(sidebar.locator('.cal-sidebar-title')).toBeVisible()
  // Активная — в панели, готовая — скрыта, заголовка «Готово» нет
  await expect(sidebar.getByText('Активная задача')).toBeVisible()
  await expect(sidebar.getByText('Готовая задача')).toHaveCount(0)
  await expect(sidebar.locator('.cal-side-status', { hasText: 'Готово' })).toHaveCount(0)
  await expect(sidebar.locator('.cal-side-status', { hasText: 'Нужно сделать' })).toBeVisible()
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
