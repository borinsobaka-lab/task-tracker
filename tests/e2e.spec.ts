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

test('мобильная навигация: разделы в нижнем меню', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  // Верхние табы скрыты, снизу — навигация из 6 разделов
  await expect(page.locator('.view-tabs')).toBeHidden()
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.locator('.bottom-nav-item:not(.bottom-nav-add)')).toHaveCount(6)
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

// ---------- Заметки ----------

/** Маленькая PNG-картинка (1×1) для вложений */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test('заметки: создание, форматирование и сохранение после перезагрузки', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'Заметки' }).click()
  await expect(page.getByText('Заметок пока нет')).toBeVisible()
  // В заметках плавающая кнопка — жёлтая «Добавить заметку» (вместо «Добавить задачу»)
  await expect(page.getByRole('button', { name: 'Добавить задачу' })).toHaveCount(0)
  const fab = page.locator('.fab.fab-note')
  await expect(fab).toHaveText(/Добавить заметку/)
  await expect(fab).toHaveCSS('background-color', 'rgb(250, 204, 21)')

  await fab.click()
  await expect(page.locator('.note-title')).toBeFocused()
  await page.keyboard.type('Идеи для отпуска')
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-content')).toBeFocused()
  await page.keyboard.type('Взять ')
  await page.getByTitle('Полужирный').click()
  await page.keyboard.type('паспорт')

  // Строка в списке: название и превью текста
  const row = page.locator('.note-row', { hasText: 'Идеи для отпуска' })
  await expect(row).toBeVisible()
  await expect(row.locator('.note-row-preview')).toHaveText('Взять паспорт')

  // Раздел и заметка переживают перезагрузку
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.locator('.note-title')).toHaveValue('Идеи для отпуска')
  await expect(page.locator('.note-content strong')).toHaveText('паспорт')
})

test('заметки: чек-лист, закрепление и удаление пустой заметки', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'Заметки' }).click()
  const compose = page.getByRole('button', { name: 'Новая заметка' }).first()

  await compose.click()
  await page.keyboard.type('Покупки')
  await page.keyboard.press('Enter')
  await page.getByTitle('Чек-лист').click()
  await page.keyboard.type('Молоко')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Хлеб')
  await expect(page.locator('.note-content li[data-checked]')).toHaveCount(2)
  await page.locator('.note-content input[type="checkbox"]').first().check()
  await expect(page.locator('.note-content li[data-checked="true"]')).toHaveCount(1)

  await compose.click()
  await page.keyboard.type('Вторая')
  await page.getByRole('button', { name: 'Закрепить' }).last().click()
  await expect(page.locator('.notes-group').first().locator('.notes-group-title')).toHaveText('Закреплённые')
  await expect(page.locator('.notes-group').first()).toContainText('Вторая')

  // Пустая заметка при уходе из неё удаляется сама
  await compose.click()
  await expect(page.locator('.note-row')).toHaveCount(3)
  await page.locator('.note-row', { hasText: 'Покупки' }).locator('.note-row-main').click()
  await expect(page.locator('.note-row')).toHaveCount(2)
})

test('заметки: картинка прямо в тексте, миниатюра в списке и просмотр', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'Заметки' }).click()
  await page.getByRole('button', { name: 'Новая заметка' }).first().click()
  await page.keyboard.type('С картинкой')
  await page.keyboard.press('Enter')
  await page.locator('input[type="file"][accept^="image"]').first().setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  })
  await page.locator('input[type="file"]:not([accept])').setInputFiles({
    name: 'readme.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('привет'),
  })
  // Картинка и файл — внутри текста заметки (вторая вставка не заменяет первую)
  await expect(page.locator('.note-content .natt-img-box img')).toBeVisible()
  await expect(page.locator('.note-content .natt-file-name')).toHaveText('readme.txt')
  await expect(page.locator('.natt-uploading')).toHaveCount(0)
  // Миниатюра в строке списка
  await expect(page.locator('.note-row', { hasText: 'С картинкой' }).locator('.note-row-thumb')).toBeVisible()
  // Просмотр на весь экран
  await page.locator('.natt-img-box').click()
  await expect(page.locator('.note-viewer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.note-viewer')).toBeHidden()
})

test('заметки на телефоне: «+» создаёт заметку, «‹ Заметки» возвращает к списку', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await createIdentity(page)
  await page.locator('.bottom-nav-item', { hasText: 'Заметки' }).click()
  await expect(page.locator('.header-title-mobile')).toHaveText('Заметки')
  await page.locator('.bottom-nav-add').click()
  // Заметка открылась поверх списка, курсор в названии
  await expect(page.locator('.note-editor')).toBeVisible()
  await page.keyboard.type('С телефона')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Текст заметки')
  await page.locator('.note-back').click()
  await expect(page.locator('.note-editor')).toBeHidden()
  await expect(page.locator('.note-row', { hasText: 'С телефона' })).toBeVisible()
  // Открываем снова и закрываем системным «назад»
  await page.locator('.note-row', { hasText: 'С телефона' }).locator('.note-row-main').click()
  await expect(page.locator('.note-editor')).toBeVisible()
  await page.goBack()
  await expect(page.locator('.note-editor')).toBeHidden()
  await expect(page.locator('.note-row')).toHaveCount(1)
})

test('заметки: без проекта — только автору, с проектом — участникам проекта', async ({ page }) => {
  await createIdentity(page, 'Борис')
  // Ждём, пока участник сохранится в хранилище (сохранение отложенное)
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  // Готовим данные: второй участник, проекты с участниками и заметки
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const boris = localStorage.getItem('tt.identity')!
    const ts = new Date().toISOString()
    data.members.push({ id: 'anya', name: 'Аня', color: '#ec4899', createdAt: ts, updatedAt: ts })
    data.projects = [
      { id: 'p-boris', name: 'Проект Бориса', memberIds: [boris], createdAt: ts, updatedAt: ts },
      { id: 'p-anya', name: 'Проект Ани', memberIds: ['anya'], createdAt: ts, updatedAt: ts },
    ]
    const note = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      id, title, html: '<p>текст</p>', attachments: [], createdAt: ts, updatedAt: ts, ...extra,
    })
    data.notes = {
      n1: note('n1', 'Старая без автора'),
      n2: note('n2', 'Заметка проекта Ани', { projectId: 'p-anya', authorId: 'anya' }),
      n3: note('n3', 'Заметка проекта Бориса', { projectId: 'p-boris', authorId: boris }),
      n4: note('n4', 'Личная Бориса', { authorId: boris }),
      n5: note('n5', 'Личная Ани', { authorId: 'anya' }),
    }
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
    localStorage.setItem('tt.view', 'notes')
  })
  await page.reload()
  const row = (t: string) => page.locator('.note-row', { hasText: t })

  // Борис: своя личная, заметка своего проекта и старая без автора; чужих — нет
  for (const t of ['Личная Бориса', 'Заметка проекта Бориса', 'Старая без автора']) await expect(row(t)).toBeVisible()
  await expect(row('Личная Ани')).toHaveCount(0)
  await expect(row('Заметка проекта Ани')).toHaveCount(0)

  // Личная заметка: видит только автор. Относим её к проекту Бориса — в выборе нет чужого проекта
  await row('Личная Бориса').locator('.note-row-main').click()
  await expect(page.locator('.note-project-who')).toHaveText('видите только вы')
  await page.locator('.note-project-btn').click()
  await expect(page.locator('.note-project-menu')).not.toContainText('Проект Ани')
  await page.locator('.note-project-menu button', { hasText: 'Проект Бориса' }).click()
  await expect(page.locator('.note-project-who')).toHaveText('видят только: Борис')

  // Таб проекта в шапке оставляет только его заметки
  await page.locator('.project-tabs').getByRole('button', { name: 'Проект Бориса' }).click()
  await expect(page.locator('.note-row')).toHaveCount(2)
  await page.locator('.project-tabs').getByRole('button', { name: 'Все' }).click()

  // Аня: своя личная, заметка своего проекта и старая без автора; заметок Бориса — нет
  await page.waitForTimeout(1500)
  await page.evaluate(() => localStorage.setItem('tt.identity', 'anya'))
  await page.reload()
  for (const t of ['Личная Ани', 'Заметка проекта Ани', 'Старая без автора']) await expect(row(t)).toBeVisible()
  await expect(page.locator('.note-row')).toHaveCount(3)
})

test('заметки: старая версия приложения стёрла заметки — новая возвращает их', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'Заметки' }).click()
  await page.getByRole('button', { name: 'Новая заметка' }).first().click()
  await page.keyboard.type('Важная заметка')
  const savedNotes = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tt.local.data')!).notes ?? {}).length)
  await expect.poll(savedNotes).toBe(1)

  // Старая версия при слиянии конфликта сохраняет доску без поля notes
  const dropNotes = () =>
    page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('tt.local.data')!)
      delete data.notes
      localStorage.setItem('tt.local.data', JSON.stringify(data))
      localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev')) + 1))
    })

  // 1) Приложение открыто: при опросе замечает пропажу и сохраняет заметки обратно
  await dropNotes()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(savedNotes).toBe(1)
  await expect(page.locator('.note-row', { hasText: 'Важная заметка' })).toBeVisible()

  // 2) Приложение открывают заново: заметки возвращаются из копии на устройстве
  await dropNotes()
  await page.reload()
  await expect(page.locator('.note-row', { hasText: 'Важная заметка' })).toBeVisible()
  await expect.poll(savedNotes).toBe(1)
})

test('фильтры: несколько проектов сразу и запоминание фильтров за участником', async ({ page }) => {
  await createIdentity(page, 'Борис')
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const boris = localStorage.getItem('tt.identity')!
    const ts = new Date().toISOString()
    data.members.push({ id: 'anya', name: 'Аня', color: '#ec4899', createdAt: ts, updatedAt: ts })
    data.projects = ['Альфа', 'Бета', 'Гамма'].map((name, i) => ({ id: `p${i}`, name, createdAt: ts, updatedAt: ts }))
    const card = (id: string, title: string, projectId: string | undefined, who: string) => ({
      id, title, description: '', columnId: 'col-todo', assigneeIds: [who], checklist: [], attachments: [],
      ...(projectId ? { projectId } : {}), createdAt: ts, updatedAt: ts,
    })
    const cards = [
      card('c0', 'Задача Альфы', 'p0', boris),
      card('c1', 'Задача Беты', 'p1', 'anya'),
      card('c2', 'Задача Гаммы', 'p2', boris),
      card('c3', 'Задача без проекта', undefined, boris),
    ]
    for (const c of cards) data.cards[c.id] = c
    data.columns.find((c: { id: string }) => c.id === 'col-todo').cardIds = cards.map((c) => c.id)
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
  })
  await page.reload()
  const tabs = page.locator('.project-tabs')
  const card = (t: string) => page.locator('.board-card', { hasText: t })
  await expect(page.locator('.board-card')).toHaveCount(4)

  // Два проекта сразу
  await tabs.getByRole('button', { name: 'Альфа' }).click()
  await tabs.getByRole('button', { name: 'Бета' }).click()
  await expect(card('Задача Альфы')).toBeVisible()
  await expect(card('Задача Беты')).toBeVisible()
  await expect(card('Задача Гаммы')).toHaveCount(0)
  await expect(card('Задача без проекта')).toHaveCount(0)
  await expect(tabs.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'false')

  // Плюс задачи без проекта: «все, кроме Гаммы»
  await tabs.getByRole('button', { name: 'Без проекта' }).click()
  await expect(page.locator('.board-card')).toHaveCount(3)
  await expect(card('Задача без проекта')).toBeVisible()
  await expect(card('Задача Гаммы')).toHaveCount(0)

  // Плюс фильтр по участнику
  await page.locator('.member-filter-btn[title^="Аня"]').click()
  await expect(page.locator('.board-card')).toHaveCount(1)
  await expect(card('Задача Беты')).toBeVisible()

  // Перезаходим — фильтры на месте
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(tabs.getByRole('button', { name: 'Альфа' })).toHaveAttribute('aria-pressed', 'true')
  await expect(tabs.getByRole('button', { name: 'Бета' })).toHaveAttribute('aria-pressed', 'true')
  await expect(tabs.getByRole('button', { name: 'Гамма' })).toHaveAttribute('aria-pressed', 'false')
  await expect(tabs.getByRole('button', { name: 'Без проекта' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.member-filter-btn[title^="Аня"]')).toHaveClass(/active/)
  await expect(page.locator('.board-card')).toHaveCount(1)

  // Без фильтра по участнику — снова «все, кроме Гаммы»; «Без проекта» выключается повторным нажатием
  await page.locator('.member-filter-btn[title^="Аня"]').click()
  await expect(page.locator('.board-card')).toHaveCount(3)
  await tabs.getByRole('button', { name: 'Без проекта' }).click()
  await expect(card('Задача без проекта')).toHaveCount(0)
  await expect(page.locator('.board-card')).toHaveCount(2)

  // «Все» возвращает всё (фильтр по участнику уже снят выше)
  await tabs.getByRole('button', { name: 'Все' }).click()
  await expect(page.locator('.board-card')).toHaveCount(4)
})

test('личные задачи (без проекта) видят только их исполнители и автор', async ({ page }) => {
  await createIdentity(page, 'Борис')
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  // Борис сам ставит себе задачу без проекта и без исполнителя — он её автор
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Моя заметка-задача')
  await page.keyboard.press('Enter')
  await expect(page.locator('.board-card', { hasText: 'Моя заметка-задача' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const boris = localStorage.getItem('tt.identity')!
    const ts = new Date().toISOString()
    data.members.push({ id: 'anya', name: 'Аня', color: '#ec4899', createdAt: ts, updatedAt: ts })
    data.projects = [{ id: 'p0', name: 'Общий проект', createdAt: ts, updatedAt: ts }]
    const card = (id: string, title: string, extra: Record<string, unknown>) => ({
      id, title, description: '', columnId: 'col-todo', assigneeIds: [], checklist: [], attachments: [], createdAt: ts, updatedAt: ts, ...extra,
    })
    const cards = [
      card('b1', 'Личная Бориса', { assigneeIds: [boris] }),
      card('a1', 'Личная Ани', { assigneeIds: ['anya'] }),
      card('a2', 'Аня поставила Борису', { assigneeIds: [boris], createdBy: 'anya' }),
      card('p1', 'Проектная Ани', { assigneeIds: ['anya'], projectId: 'p0' }),
      card('o1', 'Старая без хозяина', {}),
    ]
    const col = data.columns.find((c: { id: string }) => c.id === 'col-todo')
    for (const c of cards) {
      data.cards[c.id] = c
      col.cardIds.push(c.id)
    }
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
  })
  await page.reload()
  const card = (t: string) => page.locator('.board-card', { hasText: t })

  // Борис: свои личные + поставленная ему + проектные + старые без хозяина; чужой личной нет
  for (const t of ['Моя заметка-задача', 'Личная Бориса', 'Аня поставила Борису', 'Проектная Ани', 'Старая без хозяина']) {
    await expect(card(t)).toBeVisible()
  }
  await expect(card('Личная Ани')).toHaveCount(0)

  // Аня: своя личная, поставленная ею Борису, проектная, старая; личных Бориса — нет
  await page.evaluate(() => localStorage.setItem('tt.identity', 'anya'))
  await page.reload()
  for (const t of ['Личная Ани', 'Аня поставила Борису', 'Проектная Ани', 'Старая без хозяина']) {
    await expect(card(t)).toBeVisible()
  }
  await expect(card('Личная Бориса')).toHaveCount(0)
  await expect(card('Моя заметка-задача')).toHaveCount(0)
})

test('быстрый запуск: доска сразу из копии на устройстве, свежие данные — в фоне', async ({ page }) => {
  // Копия доски включена (как у GitHub); «сервер» (localStorage) отвечает с задержкой
  await page.evaluate(() => localStorage.setItem('tt.local.cache', '1'))
  await page.reload()
  await createIdentity(page)
  await page.getByText('Добавить карточку').first().click()
  await page.locator('textarea').first().fill('Задача из копии')
  await page.keyboard.press('Enter')
  // Сохранилось на «сервер» и (с небольшой задержкой) в копию на устройстве
  await page.waitForFunction(() => (localStorage.getItem('tt.local.data') ?? '').includes('Задача из копии'))
  const cachedHasTask = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open('tt-cache')
          req.onsuccess = () => {
            try {
              const get = req.result.transaction('kv').objectStore('kv').get('board')
              get.onsuccess = () => resolve(JSON.stringify(get.result ?? '').includes('Задача из копии'))
              get.onerror = () => resolve(false)
            } catch {
              resolve(false)
            }
          }
          req.onerror = () => resolve(false)
        }),
    )
  await expect.poll(cachedHasTask, { timeout: 5000 }).toBe(true)

  // Медленная сеть: доска видна сразу, в шапке «Загрузка…», пока сервер не ответил
  await page.evaluate(() => localStorage.setItem('tt.local.latency', '4000'))
  await page.reload()
  await expect(page.getByText('Задача из копии')).toBeVisible({ timeout: 2000 })
  await expect(page.locator('.sync-status')).toHaveText('Загрузка…')
  await expect(page.locator('.sync-status')).toHaveText('Сохранено', { timeout: 8000 })

  // Пока приложение закрыто, на «сервере» появилась задача от коллеги: сначала
  // видна копия, а после ответа сервера — и новая задача
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const col = data.columns.find((c: { role?: string }) => c.role === 'todo') ?? data.columns[0]
    const now = new Date().toISOString()
    data.cards['colleague'] = {
      id: 'colleague', title: 'Задача коллеги', description: '', columnId: col.id, assigneeIds: [],
      checklist: [], attachments: [], createdAt: now, updatedAt: now,
    }
    col.cardIds.push('colleague')
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev')) + 1))
  })
  await page.reload()
  await expect(page.getByText('Задача из копии')).toBeVisible({ timeout: 2000 })
  await expect(page.getByText('Задача коллеги')).toBeHidden()
  await expect(page.getByText('Задача коллеги')).toBeVisible({ timeout: 8000 })
  await expect(page.locator('.sync-status')).toHaveText('Сохранено')
})

test('уведомления: плашка просит разрешение, в начале встречи всплывает уведомление', async ({ page }) => {
  // Подменяем Notification API: разрешение «ещё не спрашивали», показанные уведомления копим
  await page.addInitScript(() => {
    const shown: { title: string; body?: string }[] = []
    let permission: NotificationPermission = (localStorage.getItem('test.perm') as NotificationPermission) || 'default'
    class FakeNotification {
      onclick: (() => void) | null = null
      static get permission() {
        return permission
      }
      static async requestPermission() {
        permission = 'granted'
        localStorage.setItem('test.perm', 'granted')
        return permission
      }
      constructor(title: string, opts?: NotificationOptions) {
        shown.push({ title, body: opts?.body })
      }
      close() {}
    }
    ;(window as unknown as { Notification: unknown }).Notification = FakeNotification
    ;(window as unknown as { __shown: unknown }).__shown = shown
  })
  await page.goto('?demo=1')
  await createIdentity(page, 'Борис')
  const shown = () => page.evaluate(() => (window as unknown as { __shown: { title: string; body?: string }[] }).__shown)

  const prompt = page.locator('.notify-prompt')
  await expect(prompt).toContainText('Показывать уведомления')
  await prompt.getByRole('button', { name: 'Включить' }).click()
  await expect(prompt).toBeHidden()
  expect((await shown()).map((n) => n.title)).toEqual(['Уведомления включены'])

  // Встреча, которая начинается в текущую минуту
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = now.toISOString()
    data.cards['m1'] = {
      id: 'm1', title: 'Созвон с командой', kind: 'meeting', description: '', columnId: data.columns[0].id,
      assigneeIds: [], checklist: [], attachments: [], createdAt: ts, updatedAt: ts,
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      start: `${pad(now.getHours())}:${pad(now.getMinutes())}`, durationMin: 30,
    }
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
  })
  await page.reload()
  // Разрешение уже дано — плашки нет, а уведомление о встрече приходит
  await expect.poll(async () => (await shown()).map((n) => n.title)).toContain('Созвон с командой')
  await expect(prompt).toBeHidden()
  expect((await shown()).find((n) => n.title === 'Созвон с командой')?.body).toMatch(/^Встреча начинается · \d\d:\d\d–\d\d:\d\d$/)
})

// ---------- CRM ----------

/** Данные доски из демо-хранилища */
const savedBoard = (page: import('@playwright/test').Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('tt.local.data') ?? '{}'))

test('CRM: сделка, смена этапа пишет историю, статистика считает воронку', async ({ page }) => {
  await createIdentity(page, 'Роман')
  await page.locator('.view-tabs button', { hasText: 'CRM' }).click()
  await page.getByRole('button', { name: 'Добавить сделку' }).click()

  const modal = page.locator('.crm-deal-modal')
  await modal.getByLabel('Компания / агентство').fill('МТС')
  await modal.getByLabel('Мероприятие', { exact: true }).fill('Конференция 27.11.26')
  await modal.getByLabel('Сумма предложения, ₽').fill('190 000')
  // Ответственный по умолчанию — тот, кто завёл сделку
  await expect(modal.getByLabel('Ответственный')).toHaveValue(await page.evaluate(() => localStorage.getItem('tt.identity')!))
  // Без шага и срока — контроль шага предупреждает
  await expect(modal.locator('.crm-controls')).toContainText('Нет шага / срока')

  await modal.getByLabel('Этап').selectOption('proposal')
  await expect(modal.locator('.crm-history')).toContainText('Новый контакт → КП отправлено')
  // Дата отправки КП проставилась сама
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await expect(modal.getByLabel('Дата отправки КП')).toHaveValue(today)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()

  // Карточка — в колонке «КП отправлено», с суммой
  const col = page.locator('.crm-col', { hasText: 'КП отправлено' })
  await expect(col.locator('.crm-card')).toContainText('МТС')
  await expect(col.locator('.crm-card')).toContainText('190 000 ₽')

  // Статистика: открытая воронка и КП за неделю
  await page.getByRole('tab', { name: 'Статистика' }).click()
  await expect(page.locator('.crm-kpi', { hasText: 'Открытая воронка' })).toContainText('190 000 ₽')
  await expect(page.locator('.crm-kpi', { hasText: 'КП за 7 дней' })).toContainText('1')
  // «Нет шага или срока» ведёт к отфильтрованной таблице
  await page.locator('.crm-attention button', { hasText: 'Нет шага или срока' }).click()
  await expect(page.locator('.crm-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.crm-table')).toContainText('МТС')

  // Всё сохранилось в board.json
  await expect.poll(async () => Object.values((await savedBoard(page)).crm?.deals ?? {}).length).toBe(1)
  await expect.poll(async () => Object.values((await savedBoard(page)).crm?.records ?? {}).length).toBe(1)
})

test('CRM: комментарии к сделке — пишем, видим на плитке, сохраняются', async ({ page }) => {
  await createIdentity(page, 'Роман')
  await page.locator('.view-tabs button', { hasText: 'CRM' }).click()
  await page.getByRole('button', { name: 'Добавить сделку' }).click()

  const modal = page.locator('.crm-deal-modal')
  await modal.getByLabel('Компания / агентство').fill('Премьер')
  // Справа от полей — панель комментариев, как у задачи
  await expect(modal.locator('.cm-comments')).toBeVisible()
  await expect(modal.locator('.comment-empty')).toBeVisible()
  await modal.locator('.comment-composer .ProseMirror').click()
  await page.keyboard.type('Клиент просит скидку')
  await modal.locator('.comment-composer').getByRole('button', { name: 'Отправить' }).click()
  const item = modal.locator('.comment', { hasText: 'Клиент просит скидку' })
  await expect(item.locator('.comment-author')).toHaveText('Роман')

  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  // Счётчик на плитке в воронке (свой комментарий — не «непрочитанный»)
  const tile = page.locator('.crm-card', { hasText: 'Премьер' })
  await expect(tile.locator('.crm-card-comments')).toHaveText('1')
  await expect(tile.locator('.crm-card-comments')).not.toHaveClass(/unseen/)

  await expect
    .poll(async () => {
      const deals = Object.values((await savedBoard(page)).crm?.deals ?? {}) as { comments?: { html: string }[] }[]
      return deals[0]?.comments?.map((c) => c.html).join('')
    })
    .toContain('Клиент просит скидку')
})

test('CRM: пустая сделка от «+» не сохраняется', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'CRM' }).click()
  await page.getByRole('button', { name: 'Добавить сделку' }).click()
  await expect(page.locator('.crm-deal-modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.crm-card')).toHaveCount(0)
  await page.waitForTimeout(1600)
  const deals = Object.values((await savedBoard(page)).crm?.deals ?? {}) as { deleted?: boolean }[]
  expect(deals.filter((d) => !d.deleted)).toHaveLength(0)
})

test('CRM: проект новой сделки — выбранный в шапке, фильтр проектов действует', async ({ page }) => {
  await createIdentity(page)
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const ts = new Date().toISOString()
    data.projects = [
      { id: 'p-a', name: 'Альфа', createdAt: ts, updatedAt: ts },
      { id: 'p-b', name: 'Бета', createdAt: ts, updatedAt: ts },
    ]
    data.crm = {
      deals: { d1: { id: 'd1', company: 'Сделка Беты', stage: 'new', projectId: 'p-b', createdAt: ts, updatedAt: ts } },
      records: {},
      partners: {},
    }
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
    localStorage.setItem('tt.view', 'crm')
  })
  await page.reload()
  await expect(page.locator('.crm-card', { hasText: 'Сделка Беты' })).toBeVisible()

  await page.locator('.project-tabs').getByRole('button', { name: 'Альфа' }).click()
  await expect(page.locator('.crm-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить сделку' }).click()
  const modal = page.locator('.crm-deal-modal')
  await expect(modal.getByLabel('Проект')).toHaveValue('p-a')
  await modal.getByLabel('Компания / агентство').fill('Сделка Альфы')
  await page.keyboard.press('Escape')
  await expect(page.locator('.crm-card')).toHaveCount(1)
  await expect(page.locator('.crm-card')).toContainText('Сделка Альфы')
})

test('CRM: старая версия приложения стёрла CRM — новая возвращает её', async ({ page }) => {
  await createIdentity(page)
  await page.locator('.view-tabs button', { hasText: 'CRM' }).click()
  await page.getByRole('button', { name: 'Добавить сделку' }).click()
  await page.locator('.crm-deal-modal').getByLabel('Компания / агентство').fill('Важный клиент')
  await page.keyboard.press('Escape')
  const savedDeals = async () => Object.keys((await savedBoard(page)).crm?.deals ?? {}).length
  await expect.poll(savedDeals).toBe(1)

  // Старая версия при слиянии конфликта сохраняет доску без поля crm
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    delete data.crm
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev')) + 1))
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(savedDeals).toBe(1)
  await expect(page.locator('.crm-card', { hasText: 'Важный клиент' })).toBeVisible()
})

test('CRM: партнёр, задача по сделке и контроль просрочки', async ({ page }) => {
  await createIdentity(page)
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('tt.local.data') ?? '{}').members ?? []).length > 0)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tt.local.data')!)
    const ts = new Date().toISOString()
    const me = localStorage.getItem('tt.identity')!
    data.crm = {
      deals: { d1: { id: 'd1', company: 'ОТП Банк', stage: 'contact', ownerId: me, nextStep: 'Позвонить', nextStepDate: '2020-01-01', createdAt: ts, updatedAt: ts } },
      records: {},
      partners: {},
    }
    localStorage.setItem('tt.local.data', JSON.stringify(data))
    localStorage.setItem('tt.local.rev', String(Number(localStorage.getItem('tt.local.rev') ?? '1') + 1))
    localStorage.setItem('tt.view', 'crm')
    localStorage.setItem('tt.crmTab', 'deals')
  })
  await page.reload()
  await expect(page.locator('.crm-table tbody tr')).toContainText('Просрочено')

  // Задача по сделке из её карточки
  await page.locator('.crm-table tbody tr', { hasText: 'ОТП Банк' }).click()
  await page.locator('.crm-deal-modal').getByRole('button', { name: '+ Запись' }).click()
  const rec = page.locator('.crm-record-modal')
  await rec.getByLabel('Тип записи').selectOption('task')
  await rec.getByLabel('Следующее действие').fill('Отправить КП')
  await rec.getByLabel('Срок').fill('2020-01-02')
  await rec.getByLabel('Статус').selectOption('planned')
  await rec.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.crm-deal-modal .crm-history')).toContainText('Отправить КП')
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: 'Задачи' }).click()
  await expect(page.locator('.crm-table tbody tr', { hasText: 'Отправить КП' })).toContainText('Просрочено')

  // Партнёр
  await page.getByRole('tab', { name: 'Партнёры' }).click()
  await page.getByRole('button', { name: '+ Партнёр' }).click()
  await page.locator('.crm-modal').getByLabel('Компания / партнёр').fill('Агентство Вектор')
  await page.keyboard.press('Escape')
  await expect(page.locator('.crm-table tbody tr', { hasText: 'Агентство Вектор' })).toContainText('Нет шага / срока')
})

test('заголовок вкладки браузера — по текущему разделу', async ({ page }) => {
  await createIdentity(page)
  await expect(page).toHaveTitle('Доска — Задачи')
  for (const name of ['Календарь', 'Заметки', 'CRM']) {
    await page.locator('.view-tabs button', { hasText: name }).click()
    await expect(page).toHaveTitle(`${name} — Задачи`)
  }
  // После перезагрузки — раздел, в котором остановились
  await page.reload()
  await expect(page).toHaveTitle('CRM — Задачи')
})
