# Настройка Telegram-бота задач на Cloudflare (инструкция для исполнителя)

Нужно развернуть один Cloudflare Worker — он заменяет оба прежних бота
(групповые отчёты и личные уведомления) и работает без задержек: мгновенные
ответы в личке и обновление статусов в группе раз в минуту.

Старые боты на GitHub уже отключены, так что дублей не будет.

Всё бесплатно (Cloudflare Workers free-план покрывает такую нагрузку с запасом).

---

## 0. Что подготовить заранее

Понадобятся 4 значения (первые два, скорее всего, уже есть у владельца):

1. **Токен бота** — от [@BotFather](https://t.me/BotFather) (строка вида `12345:AA...`).
2. **GitHub-токен на чтение данных** — с доступом на **чтение** приватного
   репозитория с задачами `borinsobaka-lab/task-tracker-data` (scope `repo` у
   классического токена, либо fine-grained с Contents: Read). Это тот же токен,
   что раньше стоял в секрете `DATA_REPO_TOKEN` в GitHub.
3. **ID группового чата**, куда бот шлёт отчёты (число, у групп обычно
   отрицательное, напр. `-1001234567890`). Как узнать — см. пункт «Как найти
   ID группы» ниже.
4. **Секрет вебхука** — придумайте длинную случайную строку (30–40 символов),
   например из букв и цифр. Нужна для защиты бота от чужих запросов.

**Код воркера** лежит в репозитории:
`bot/worker/worker.js`
Прямая ссылка на «сырой» файл (его содержимое целиком вставляется в Cloudflare):
`https://raw.githubusercontent.com/borinsobaka-lab/task-tracker/claude/task-tracker-service-lpv708/bot/worker/worker.js`

---

## 1. Настройка через сайт Cloudflare (без терминала) — рекомендую

1. Зарегистрируйтесь / войдите на **[dash.cloudflare.com](https://dash.cloudflare.com)** (бесплатно).
2. Слева **Workers & Pages → Create → Workers → Create Worker**. Имя, например,
   `tasktracker-bot`. Нажмите **Deploy** (пока с примером).
3. **Edit code** → удалите пример и вставьте **всё содержимое** `worker.js`
   (по ссылке выше) → **Deploy**.
4. **KV-хранилище.** Слева **Storage & Databases → KV → Create a namespace**,
   имя `BOT_KV`. Затем в воркере: **Settings → Bindings → Add → KV namespace**,
   Variable name: `BOT_KV`, выбрать созданное хранилище. Сохранить.
5. **Переменные и секреты.** Воркер → **Settings → Variables and Secrets**:
   - Обычные переменные (Type: **Plaintext**):
     - `DATA_OWNER` = `borinsobaka-lab`
     - `DATA_REPO` = `task-tracker-data`
     - `DATA_BRANCH` = `tasks-data`
     - `AUTH_OWNER` = `borinsobaka-lab`
     - `AUTH_REPO` = `task-tracker`
     - `AUTH_BRANCH` = `app-config`
     - `TZ_NAME` = `Asia/Tbilisi`
     - `APP_URL` = `https://borinsobaka-lab.github.io/task-tracker/`
     - `MORNING` = `10:00`  (время утреннего сообщения)
     - `EVENING` = `20:00`  (время вечернего сообщения)
     - `GROUP_CHAT_ID` = ID вашей группы (напр. `-1001234567890`)
   - Секреты (Type: **Secret** / Encrypt):
     - `TELEGRAM_BOT_TOKEN` = токен бота
     - `DATA_TOKEN` = GitHub-токен на чтение данных
     - `WEBHOOK_SECRET` = придуманная длинная строка
6. **Расписание.** Воркер → **Settings → Triggers → Cron Triggers → Add**,
   выражение `* * * * *` (раз в минуту). Сохранить и задеплоить ещё раз (**Deploy**).
7. **Адрес воркера.** Скопируйте URL вида
   `https://tasktracker-bot.ВАШ-ПОДДОМЕН.workers.dev`.
8. **Подключите вебхук.** Откройте в браузере ссылку (подставьте свои значения
   токена бота, URL воркера и WEBHOOK_SECRET):

   ```
   https://api.telegram.org/bot<ТОКЕН_БОТА>/setWebhook?url=<URL_ВОРКЕРА>&secret_token=<WEBHOOK_SECRET>
   ```

   В ответе должно быть `{"ok":true,...}`.

Готово. Дальше:
- В группе бот сам пришлёт утреннее сообщение в `MORNING` и вечернее в `EVENING`,
  а днём будет обновлять утреннее под текущие статусы.
- Каждый участник в личке пишет боту `/start`, вводит пароль сервиса, выбирает
  себя — и получает персональные уведомления. `/stop` — отключить.

---

## 2. Альтернатива — через терминал (wrangler)

```bash
cd bot/worker
npx wrangler kv namespace create BOT_KV      # id вписать в wrangler.toml
# В wrangler.toml также заполнить GROUP_CHAT_ID
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put DATA_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy
```
Затем подключить вебхук той же ссылкой `setWebhook`, что в пункте 1.8.

---

## Как найти ID группы

1. Добавьте бота в группу (если ещё не добавлен) и дайте право писать сообщения.
2. Напишите в группе любое сообщение с упоминанием бота или просто любое
   сообщение, затем откройте в браузере (webhook при этом должен быть ещё НЕ
   установлен, либо используйте бота [@getidsbot](https://t.me/getidsbot) /
   [@RawDataBot](https://t.me/RawDataBot), добавив его в группу):

   ```
   https://api.telegram.org/bot<ТОКЕН_БОТА>/getUpdates
   ```

   Найдите `"chat":{"id":-100...}` — это и есть `GROUP_CHAT_ID`.
   (После получения id этого вспомогательного бота можно удалить из группы.)

## Проверка, что всё работает

- Личка: напишите боту `/start` — он сразу (за секунды) попросит пароль.
- Группа: можно не ждать утра — временно поставьте `MORNING` на ближайшую минуту
  (по TZ_NAME), сохраните, дождитесь сообщения, затем верните `10:00`.

## Если что-то не так

- В Cloudflare: воркер → **Logs** (Real-time logs) — там видно ошибки.
- `{"ok":false,"description":"..."}` в ответе setWebhook — проверьте URL воркера
  и токен бота.
- Бот молчит в личке — проверьте, что вебхук установлен (setWebhook вернул ok) и
  что задан `WEBHOOK_SECRET` (одинаковый в секрете воркера и в ссылке setWebhook).
- Нет отчётов в группе — проверьте `GROUP_CHAT_ID`, что бот добавлен в группу и
  может писать, и что `DATA_TOKEN` имеет доступ к репозиторию данных.
