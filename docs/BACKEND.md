# Сервер: Cloudflare Worker `plair-counts` + D1

Код — один файл `worker/src/worker.js` (без зависимостей). Адрес: `https://plair-counts.timurshorts.workers.dev`. Выкладка — `cd worker && npx wrangler deploy` (см. OPERATIONS.md).

## Настройки

### Публичные переменные (`worker/wrangler.toml`, в git)

| Имя | Что |
|---|---|
| `GOOGLE_WEB_CLIENT_ID` | Client ID Google для входа (публичный). Проект Google Cloud «PLAIR» (`plair-511710`), разрешённые источники `https://plair.pro`, `https://www.plair.pro` |
| `GITHUB_WEB_CLIENT_ID` | Client ID OAuth-приложения GitHub «PLAIR» (аккаунт `plairpro`, Settings → Developer settings → OAuth Apps). Callback: `https://plair-counts.timurshorts.workers.dev/auth/github/callback` |
| `TG_CHAT_ID` | чат Telegram для уведомлений о новых заявках |
| `ADMIN_EMAIL_SHA256` | SHA-256 почты модератора(ов) Google, через запятую. Сама почта нигде не хранится |
| `[[d1_databases]]` | привязка базы `DB` → `plair-counts` |

### Секреты (только в Cloudflare, `npx wrangler secret put ИМЯ`)

| Имя | Обязателен | Что |
|---|---|---|
| `GITHUB_CLIENT_SECRET` | для входа GitHub через переход на github.com | без него вход GitHub работает «по коду» (device flow) |
| `TG_BOT_TOKEN` | для уведомлений | бот для сообщений о новых заявках |
| `SESSION_SECRET` | нет | ключ подписи пропусков. Если не задан — Worker сам создаёт случайный и хранит в таблице `meta` (`session_secret`). **Смена ключа разлогинивает всех** и меняет коды подтверждения авторства |
| `ADMINS` | нет | ID модераторов через запятую (`github:12345`, `google:…`) — запасной способ |
| `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID` | устарели | в Cloudflare остались старые значения; код их игнорирует, если они не похожи на настоящий ID |

### Для локальной разработки (`.dev.vars`, не в git)

`EXTRA_ORIGINS=http://localhost:8080` (разрешить локальный сайт), `CATALOG=http://localhost:8080/games/games.json`, `SESSION_SECRET=…`.

## Безопасность запросов

- CORS: отвечаем только `https://plair.pro`, `https://www.plair.pro` (+ `EXTRA_ORIGINS`).
- Пропуск входа — `seal()`: JSON + HMAC-SHA256 (`{k:'s', u: userId, e: срок}`), 180 дней, передаётся заголовком `Authorization: Bearer …`. Проверка с каноническим base64url (подмена битов не проходит).
- Номер браузера (`visitor`) — 16–64 hex, выдаёт себе сам браузер; по нему только лимиты.
- Игра (`id`) принимается, только если она есть в каталоге (`games.json`, кэш) или среди одобренных заявок — функция `known()`.

## Таблицы D1

Worker сам создаёт их при первом запросе (`install()`: `SCHEMA` + `ALTER TABLE … ADD COLUMN` с игнорированием ошибок). `worker/schema.sql` — справка.

| Таблица | Ключ | Поля и смысл |
|---|---|---|
| `games` | `id` | `plays`, `likes`, `comments`, `shares`, `seconds`, `skips` — счётчики игры |
| `plays_today` | `visitor, game, day` | `n` — запусков за сутки (лимит 10) |
| `acts_today` | `visitor, game, day, kind` | `n` — суточный учёт `share`, `time`, `skip`, `score`, `duel` |
| `likes` | `visitor, game` | лайк браузера |
| `users` | `id` (`google:…`/`github:…`) | `name`, `avatar`, `login`, `created`, `banned`, `admin` |
| `comments` | `id` | `game`, `user`, `text`, `created` |
| `meta` | `key` | служебное (`session_secret`) |
| `submissions` | `id` | заявки игр: `game` (id после одобрения), `url`, `title`, `blurb`, `tags` (JSON), `cover`, `cover_data` (data:-картинка), `by`, `by_url`, `contact`, `user`, `ip` (хэш), `status` (`pending`/`approved`/`rejected`), `created`, `decided`, `weight` (байт), `proof` (`github`/`code`/`moderator`) |
| `saves` | `user, game` | избранное аккаунта |
| `lists` | `code` | PLAIR-лист: публичный код → `user` |
| `scores` | `game, who` | лучший счёт аккаунта в игре: `best`, `name`, `updated` (только вошедшие) |
| `boards` | `game` | `lower` = 1, если в игре «меньше — лучше» |
| `duels` | `code` | вызов «побей мой рекорд»: `game`, `score`, `name`, `lower`, `created` |

## Все запросы

| Запрос | Вход | Что делает |
|---|---|---|
| `GET /config` | — | `{providers:['google','github'], google, github:'web'|'device', max}` |
| `GET /counts` | — | `{counts:{id:{plays,likes,comments,shares,seconds,saves,skips}}}`, кэш 60 с |
| `POST /play` `{id, visitor}` | — | +1 запуск (≤10/сутки) |
| `POST /like` `{id, visitor, on}` | — | лайк / снять |
| `POST /time` `{id, visitor, seconds}` | — | секунды в игре (≤60 за раз, ≤1800 в сутки). Тело читается как текст — приходит через `sendBeacon` |
| `POST /share` `{id, visitor}` | — | репост (1/сутки) |
| `POST /skip` `{id, visitor}` | — | скип (1/сутки) |
| `GET /mine?visitor=` | — | какие игры лайкнул браузер |
| `POST /auth/google/token` `{credential}` | — | проверка ID-токена Google по JWKS (RS256, aud, iss, exp) → `{session, user}`. Модератор — если SHA-256 почты в `ADMIN_EMAIL_SHA256` |
| `GET /auth/github?back=…` → `/auth/github/callback` | — | вход GitHub с переходом (нужен `GITHUB_CLIENT_SECRET`); возвращает на `back#session=…` |
| `POST /auth/github/device` → `POST /auth/github/poll {handle}` | — | вход GitHub по коду, без секрета |
| `GET /me`, `DELETE /me` | да | кто я; удалить аккаунт, комментарии, сохранения, листы, рекорды |
| `GET /comments?game=&before=` | — | по 20, новые сверху |
| `POST /comments` `{game, text}` | да | ≤500 символов, раз в 15 с, ≤60/сутки |
| `DELETE /comments/:id` | да | свой; модератор — любой |
| `GET/POST /saves` | да | список сохранённых / `{game, on}` |
| `POST /lists` → `{code}`; `GET /lists/:code` | да / — | PLAIR-лист: публичная ссылка на избранное |
| `POST /verify` `{url}` | можно | «это моя игра?» → `{verified, how, code}` |
| `POST /submit` `{url, title, blurb, tags, cover, coverData, contact, weight}` | можно | заявка: ≤5/сутки с IP, без дублей, вес ≤10 МБ, обязательное подтверждение авторства; уведомление в Telegram |
| `GET /games` | — | одобренные заявки в формате каталога (+ `verified`) |
| `GET /cover/:game` | — | обложка, загруженная автором |
| `GET /submissions` | модератор | очередь (до 20) с весом и способом подтверждения |
| `POST /submissions/:id` `{action}` | модератор | `approve` (выдаёт id-слаг из названия), `reject`, `unpublish` |
| `POST /score` `{id, visitor, value, lower}` | да | счёт из SDK, хранится лучший; ≤60/сутки |
| `GET /board?game=` | — | топ-10 и моё место |
| `POST /duel` `{id, visitor, value}` → `{code}`; `GET /duel/:code` | можно / — | вызов «побей мой рекорд» (≤20/сутки) |

Ответы — JSON `{ok:true, …}` или `{ok:false, why:'…'}` с кодом 400/401/403/404/413/429.

## Модераторы

Модератор (`admin`) видит очередь заявок, удаляет любые комментарии, его заявки не требуют подтверждения авторства. Назначается:

1. добавлением SHA-256 его Google-почты в `ADMIN_EMAIL_SHA256` (через запятую) и выкладкой Worker’а; права включаются при **следующем входе** через Google. Посчитать хэш: `printf '%s' 'name@gmail.com' | shasum -a 256`;
2. или ID аккаунта в секрете `ADMINS`.

Забанить пользователя (комментарии и рекорды):

```sh
npx wrangler d1 execute plair-counts --remote --command "UPDATE users SET banned = 1 WHERE id = 'google:…'"
```
