# Личный Telegram-бот (Cloudflare Worker)

Этот бот работает **в личке**: человек пишет боту, вводит **пароль сервиса**,
выбирает себя из списка участников — и после этого получает персональные
уведомления:

- **«Вам назначили задачу/встречу»** — когда вас добавили в исполнители;
- **«Через ~30 минут»** — напоминание перед началом задачи или встречи.

Групповые отчёты (утро/вечер) продолжает слать прежний бот из GitHub Actions —
этот Worker им не мешает.

Всё бесплатно: Cloudflare Workers free-план с запасом покрывает такую нагрузку
(проверка раз в минуту, несколько пользователей).

---

## Что понадобится заранее

1. **Токен бота** — тот же, что уже настроен (от [@BotFather](https://t.me/BotFather)).
2. **GitHub-токен на чтение данных** — с доступом к приватному репозиторию с
   задачами (`task-tracker-data`). Можно использовать тот же токен `DATA_TOKEN`,
   что уже задан в секретах GitHub Actions. Нужен доступ **Contents: Read**.
3. **Секрет вебхука** — придумайте длинную случайную строку (например,
   40 символов). Она защищает бота от чужих запросов. Пусть будет `WEBHOOK_SECRET`.

---

## Вариант A. Через сайт Cloudflare (без терминала) — проще

1. Зарегистрируйтесь на **[dash.cloudflare.com](https://dash.cloudflare.com)** (бесплатно).
2. Слева **Workers & Pages → Create → Workers → Create Worker**. Имя —
   например `tasktracker-bot`. Нажмите **Deploy** (пока с примером).
3. **Edit code** → удалите пример, вставьте содержимое файла
   [`worker.js`](./worker.js) целиком → **Deploy**.
4. **Хранилище (KV).** Слева **Storage & Databases → KV → Create a namespace**,
   имя `BOT_KV`. Затем в Worker: **Settings → Bindings → Add → KV namespace**,
   имя переменной `BOT_KV`, выберите созданное хранилище. Сохраните.
5. **Переменные и секреты.** Worker → **Settings → Variables and Secrets**:
   - Обычные переменные (Type: *Plaintext*):
     `DATA_OWNER=borinsobaka-lab`, `DATA_REPO=task-tracker-data`,
     `DATA_BRANCH=tasks-data`, `AUTH_OWNER=borinsobaka-lab`,
     `AUTH_REPO=task-tracker`, `AUTH_BRANCH=app-config`,
     `TZ_NAME=Asia/Tbilisi`, `APP_URL=https://borinsobaka-lab.github.io/task-tracker/`
   - Секреты (Type: *Secret* / Encrypt):
     `TELEGRAM_BOT_TOKEN`, `DATA_TOKEN`, `WEBHOOK_SECRET`.
6. **Расписание.** Worker → **Settings → Triggers → Cron Triggers → Add** →
   выражение `* * * * *` (раз в минуту). Сохраните и задеплойте ещё раз.
7. **Адрес Worker.** Скопируйте URL воркера (вида
   `https://tasktracker-bot.ВАШ-ПОДДОМЕН.workers.dev`).
8. **Подключите вебхук.** Откройте в браузере ссылку (подставьте свои значения):

   ```
   https://api.telegram.org/bot<ТОКЕН_БОТА>/setWebhook?url=<URL_WORKER>&secret_token=<WEBHOOK_SECRET>
   ```

   В ответе должно быть `{"ok":true,...}`. (По умолчанию Telegram шлёт и
   сообщения, и нажатия кнопок — этого достаточно.)
9. **Проверка.** Откройте бота в Telegram, напишите `/start` — он попросит пароль.

---

## Вариант B. Через терминал (wrangler)

```bash
cd bot/worker

# создать KV-хранилище и вписать его id в wrangler.toml (поле id у kv_namespaces)
npx wrangler kv namespace create BOT_KV

# секреты
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put DATA_TOKEN
npx wrangler secret put WEBHOOK_SECRET

# выкатить
npx wrangler deploy
```

Затем подключите вебхук той же ссылкой `setWebhook`, что в шаге 8 выше.

---

## Как пользоваться

- Каждый участник пишет боту `/start`, вводит **пароль сервиса**, выбирает себя.
  Сообщение с паролем бот сразу удаляет из переписки.
- Дальше уведомления приходят автоматически.
- `/stop` — отключить уведомления.

## Полезно знать

- **Пароль нигде не хранится.** Бот проверяет его, пытаясь расшифровать
  `auth.json` (тот же приём, что и вход в приложение): подошёл — значит верный.
- **Часовой пояс** для напоминаний — переменная `TZ_NAME` (сейчас `Asia/Tbilisi`).
- Один человек может выбрать только одного участника; повторный `/start`
  переназначает.
- Проверка идёт раз в минуту, поэтому «через 30 минут» может прийти за 29–30
  минут — это нормально.
