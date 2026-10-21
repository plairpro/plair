# Обзор проекта

## Что такое PLAIR

PLAIR — две вещи на одном домене **plair.pro**:

- **PLAIR Games** (главная `/`, на английском) — вертикальная лента коротких веб-игр. Свайп — следующая игра, нажал Play — играешь без установки. Игры присылают их авторы, лента ранжирует их по поведению игроков.
- **Студия PLAIR** (`/studio/` и SEO-страницы, на русском) — сайт студии, которая делает игры для брендов, выставок и обучения: портфолио кейсов, услуги, блог, форма заявки.

## Стек

| Часть | Технология | Где |
|---|---|---|
| Сайт | Статический HTML/CSS/JS, без сборки и зависимостей | репозиторий `plairpro/plair`, ветка `main` |
| Хостинг сайта | GitHub Pages, домен `plair.pro` (файл `CNAME`) | Settings → Pages: Deploy from a branch → `main` / root |
| Сервер | Cloudflare Worker `plair-counts` | `worker/src/worker.js`, адрес `https://plair-counts.timurshorts.workers.dev` |
| База | Cloudflare D1 `plair-counts` | таблицы создаёт сам Worker, справка — `worker/schema.sql` |
| Вход | Google Identity Services (игроки), GitHub OAuth (авторы игр) | Client ID — в `worker/wrangler.toml`, секреты — в Cloudflare |
| Уведомления | Telegram-бот | заявки на игры → `TG_BOT_TOKEN` (секрет Worker’а); форма студии → `content.js` |
| Шрифты | Unbounded (заголовки, Google Fonts), Golos Text (текст, файлы в `assets/`) | `styles.css` |
| Цвет бренда | `#34C759` (переменная `--accent`) | `styles.css` |

## Карта репозитория

```
/
├── index.html            ← лента PLAIR Games (главная). Подключает styles.css, games/games.css,
│                            content.js (настройки формы) и games/games.js
├── games/
│   ├── games.js          ← вся логика ленты (≈2800 строк, один IIFE, ES5-стиль)
│   ├── games.css         ← стили ленты
│   ├── games.json        ← каталог игр студии (ручной; игры авторов приходят с сервера)
│   ├── covers/*.webp     ← обложки игр каталога, 720×1280
│   └── index.html        ← старый адрес /games/ → редирект на /
├── sdk.js                ← PLAIR SDK для авторов игр (https://plair.pro/sdk.js)
├── privacy/index.html    ← политика конфиденциальности (англ.)
├── worker/
│   ├── src/worker.js     ← сервер: все запросы, таблицы, вход, модерация
│   ├── wrangler.toml     ← настройки Worker’а: имя, база D1, публичные переменные
│   ├── schema.sql        ← справочная схема базы (Worker создаёт таблицы сам)
│   ├── setup.sh          ← старый скрипт первичной настройки (уже выполнен)
│   └── README.md         ← краткая справка по Worker’у
├── studio/index.html     ← главная страница студии
├── about/ cases/ blog/ gamification/ promo-games/ serious-games/ expo-games/
│                         ← SEO-страницы студии (статический HTML)
├── thanks/ 404.html      ← служебные страницы
├── content.js            ← кейсы портфолио (PLAIR_CASES), клиенты, настройки формы (PLAIR_CONFIG)
├── app.js                ← логика сайта студии: кейсы, форма, лента логотипов
├── styles.css            ← общие стили и токены цвета/шрифтов для всего сайта
├── seo.css               ← стили SEO-страниц
├── robot.js              ← 3D-робот в форме заявки (three.js, грузится лениво)
├── spider.js             ← паук за курсором на странице «О студии»
├── assets/               ← картинки, видео, шрифты, three.js
├── tools/greyify-logos.py← перекраска логотипов клиентов в серый силуэт
├── sitemap.xml robots.txt SEO.md
└── docs/                 ← эта документация
```

## Как всё связано

```
Браузер игрока
  │  загружает статику с GitHub Pages: index.html, games.js, games.json
  │
  ├─► Cloudflare Worker (plair-counts.timurshorts.workers.dev)
  │      /counts, /play, /like, /time, /share, /skip  — счётчики
  │      /me, /auth/google/token, /auth/github…       — вход
  │      /comments, /saves, /lists                     — комментарии, избранное, PLAIR-листы
  │      /submit, /verify, /games, /submissions        — заявки игр и модерация
  │      /score, /board, /duel                         — рекорды PLAIR SDK
  │      └── D1 база plair-counts
  │
  └─► <iframe> с игрой (чужой сайт, например plairpro.github.io/shift/)
         └── если игра подключила sdk.js — шлёт ленте счёт через postMessage
```

Адрес Worker’а прописан в одной строке `games/games.js`: `var COUNTS = 'https://plair-counts.timurshorts.workers.dev';`. Если `COUNTS` пустой, лента работает без сервера: без счётчиков, лайков, комментариев и заявок.

## Принципы кода

- Без сборщиков, фреймворков и npm-зависимостей на сайте. Файлы правятся руками и сразу работают.
- Комментарии в коде — по-русски, объясняют *почему*, а не *что*.
- Интерфейс ленты и тексты для игроков/авторов — по-английски (аудитория не РФ). Сайт студии — по-русски.
- Всё, что пишет пользователь, выводится как текст (`esc()`), никакого HTML из данных.
- Данные о людях — минимум: случайный номер браузера, имя/аватар/ID аккаунта. Почту не храним (модератор определяется по SHA-256 почты).
