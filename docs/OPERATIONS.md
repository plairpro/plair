# Эксплуатация: выкладка, доступы, частые задачи, риски

## Где что живёт (доступы)

| Что | Где | Кто управляет |
|---|---|---|
| Код сайта и сервера | GitHub `plairpro/plair`, ветка `main` | владелец аккаунта `plairpro`; коллабораторов добавляет он: Settings → Collaborators |
| Хостинг сайта | GitHub Pages этого репозитория, домен `plair.pro` | там же, Settings → Pages |
| Игры студии | отдельные репозитории `plairpro/<игра>` → `plairpro.github.io/<игра>/` | там же |
| Сервер и база | Cloudflare: Worker `plair-counts`, D1 `plair-counts`, поддомен `timurshorts.workers.dev` | владелец аккаунта Cloudflare (вход через `npx wrangler login`) |
| Вход Google | Google Cloud, проект «PLAIR» (`plair-511710`), OAuth-клиент Web | владелец проекта |
| Вход GitHub | OAuth-приложение «PLAIR» в аккаунте `plairpro` (Settings → Developer settings → OAuth Apps) | `plairpro` |
| Уведомления | Telegram-бот (токен — секрет Worker’а `TG_BOT_TOKEN` и, к сожалению, `content.js`) | владелец бота |

Пароли и ключи в этой документации не хранятся и храниться не должны.

## Выкладка сайта

```sh
git add …; git commit -m "…"; git push origin main
```

GitHub Pages обновляет сайт за 1–2 минуты (статус: вкладка Actions → «pages build and deployment»). Кэш CDN GitHub — до 10 минут, поэтому файлы подключаются с версией.

### Версии файлов (обязательно!)

После правки файла поднять его `?v=` во всех HTML, где он подключён:

| Файл | Где подключён | Сейчас |
|---|---|---|
| `games/games.js`, `games/games.css` | `index.html` | `v=53` / `v=46` |
| `styles.css` | все HTML | `v=41` |
| `content.js` | `index.html`, `studio/`, SEO-страницы | `v=48` |
| `app.js`, `seo.css` | страницы студии | `v=42` / `v=38–39` |

Найти все места: `grep -rn "games.js?v=" --include=*.html .`

`games/games.json` и `sdk.js` версий не требуют (каталог грузится с `?t=…`, SDK — стабильный адрес).

## Выкладка сервера

```sh
cd worker
npx wrangler deploy                    # выложить worker.js и wrangler.toml
npx wrangler secret put ИМЯ            # положить/сменить секрет
npx wrangler secret list               # какие секреты есть (без значений)
npx wrangler tail                      # живой лог запросов
```

Таблицы и новые столбцы Worker создаёт сам при первом запросе — миграции руками не нужны. Совместимость: новый сайт должен работать со старым Worker’ом и наоборот (код ленты это учитывает: неизвестный запрос → тихий откат).

Порядок при изменениях в обоих местах: можно в любом, но лучше сначала Worker, потом сайт.

## База: запросы и резервная копия

```sh
npx wrangler d1 execute plair-counts --remote --command "SELECT id, plays, likes, seconds FROM games"
npx wrangler d1 execute plair-counts --remote --command "SELECT id, name, login, admin FROM users ORDER BY created DESC LIMIT 20"
npx wrangler d1 export plair-counts --remote --output=backup.sql   # резервная копия
```

## Локальная разработка

```sh
python3 -m http.server 8080          # сайт на http://localhost:8080
cd worker && npx wrangler dev --local --port 8787   # сервер
```

- В `worker/.dev.vars` (не в git): `EXTRA_ORIGINS=http://localhost:8080`, `CATALOG=http://localhost:8080/games/games.json`, `SESSION_SECRET=test`.
- Чтобы лента ходила в локальный сервер, временно поменять `var COUNTS` в `games/games.js` на `http://localhost:8787` (не коммитить!). Удобнее подменять файл в тестах (Playwright `route`).
- Проверять на телефоне в портретной ориентации (390×844), на узком 320 px и на десктопе 1440×900.

## Частые задачи

| Задача | Как |
|---|---|
| Добавить игру студии | `games/games.json` + обложка в `games/covers/` (SUBMISSIONS.md) |
| Добавить модератора | SHA-256 его Google-почты в `ADMIN_EMAIL_SHA256` (`wrangler.toml`), `wrangler deploy`, он перезаходит (BACKEND.md) |
| Снять игру автора | `UPDATE submissions SET status='rejected' WHERE game='…'` |
| Забанить пользователя | `UPDATE users SET banned=1 WHERE id='…'` |
| Удалить подделанный рекорд | `DELETE FROM scores WHERE game='…' AND who='…'` (SDK.md) |
| Изменить веса «Популярного» | `WEIGHT` в `games/games.js` (RANKING.md) |
| Изменить лимит веса игры | `LIMIT_MB` в `games/games.js` и `MAX_WEIGHT` в `worker.js` |
| Добавить кейс студии | `content.js` → `PLAIR_CASES` + картинки в `assets/` (STUDIO.md) |
| Обновить питч/правила | тексты окна «i» — `howSheet()` в `games/games.js`; политика — `privacy/index.html` |

## Тарифы и масштаб

Сейчас — бесплатный тариф Cloudflare (Workers: 100 тыс. запросов в сутки; D1: 5 млн чтений и 100 тыс. записей в сутки, 5 ГБ). При росте — платный Workers за $5/мес (10 млн запросов/мес; D1: 25 млрд чтений и 50 млн записей в месяц включено). GitHub Pages: сайт до 1 ГБ, мягкий лимит трафика 100 ГБ/мес.

## Известные риски и долги

1. **Токен Telegram-бота открыт в `content.js`** (форма заявки шлёт прямо в Telegram из браузера). Любой может слать сообщения от имени бота. Исправление: перенести отправку формы в Worker (`POST /contact`), токен — только секрет `TG_BOT_TOKEN`; затем выпустить новый токен у @BotFather и удалить старый из `content.js`.
2. Рекорды PLAIR SDK можно подделать (так в любой браузерной игре) — есть лимиты и ручная чистка.
3. В `games/games.js` остался неиспользуемый блок «запросы к GitHub» (`gh()`) — можно удалить.
4. Взрослый контент на plair.pro не размещать: рекламные сети и платёжные системы (Visa/Mastercard) отключают за это весь сайт.
5. Аудитория 14–24 частично несовершеннолетняя: перед запуском рекламы — юрист и возрастные настройки.
6. `worker/setup.sh` и часть `worker/README.md` описывают первую установку (уже выполнена) — при повторном запуске скрипт спрашивает ключи заново; не вставлять туда команды.

## Работа с ИИ-агентами

- Перед правкой — прочитать нужный раздел `docs/` и соответствующий файл целиком; файлы большие, но без сборки.
- Не коммитить локальный адрес `COUNTS`, `.dev.vars`, секреты, токены.
- После правки фронтенда — поднять `?v=`; после правки Worker’а — напомнить владельцу `npx wrangler deploy` (у агента обычно нет доступа к Cloudflare).
- Проверять изменения в браузере (Playwright) до коммита: лента, проигрыватель, форма «+», окно «i».
