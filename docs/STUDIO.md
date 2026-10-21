# Сайт студии (`/studio/` и SEO-страницы)

Русскоязычная часть plair.pro: продаёт услуги студии брендам, выставкам, обучению.

## Страницы

| Адрес | Файл | Что |
|---|---|---|
| `/studio/` | `studio/index.html` | главная студии: направления, портфолио кейсов, «Нас выбрали», форма заявки |
| `/about/` | `about/index.html` | о студии (с пауком `spider.js`) |
| `/cases/` | `cases/index.html` | портфолио статическим HTML (для поисковиков) |
| `/gamification/`, `/promo-games/`, `/serious-games/`, `/expo-games/` | `*/index.html` | страницы услуг |
| `/blog/` и статьи | `blog/…/index.html` | материалы |
| `/thanks/`, `/404.html` | | служебные |

Правила SEO (title, description, canonical, JSON-LD, sitemap) — в корневом `SEO.md`. Новые страницы добавлять в `sitemap.xml`.

## Кейсы портфолио — `content.js`

`window.PLAIR_CASES` — массив кейсов в порядке показа:

```js
{
  id: "vernye-resheniya",
  title: "Верные решения",
  category: "Web / стенд",
  description: "Одна-две строки о проекте.",
  media: [
    { type: "image", src: "/assets/vernye-resheniya-1.webp", w: 2000, h: 1143, alt: "Что на кадре" },
    { type: "video", src: "/assets/x.mp4", poster: "/assets/x.webp", alt: "…" }
  ]
}
```

- Картинки — webp в `assets/`, имена `<id>-N.webp`; `w`/`h` — реальные пиксели (от них считается раскладка коллажа).
- После правки `content.js` поднять `content.js?v=` во **всех** HTML, где он подключён (главная ленты, `/studio/`, SEO-страницы): `grep -rl "content.js?v=" --include=*.html .`
- Статические описания в `cases/index.html` держать в согласии с `content.js`.

`window.PLAIR_CLIENTS` — логотипы «Нас выбрали» (сейчас пусто). Логотипы перекрашиваются в серый силуэт: `python3 tools/greyify-logos.py <папка> assets/clients`.

## Логика — `app.js`

Кейсы и коллаж кадров (раскладка по пропорциям), наклон коллажа под курсором, лента логотипов, блокировка прокрутки фона под окнами, форма заявки.

## Форма заявки

`window.PLAIR_CONFIG` в `content.js`: `formService: "telegram"`, `telegramToken`, `telegramChat`, `contactEmail` (запасной путь — письмо). Заявка уходит прямо из браузера в Telegram Bot API. Та же форма на английском — «Contact us» в окне «i» ленты.

В форме — 3D-робот (`robot.js`, three.js из `assets/`), грузится лениво при первом открытии.

> ⚠️ Токен бота лежит в `content.js` открыто — его видит любой посетитель. См. OPERATIONS.md → «Риски».

## Стили

`styles.css` — общие токены для всего сайта (`--accent:#34C759`, `--bg`, `--ink`, `--muted`, `--dim`, `--line`, `--line-2`, `--danger`, шрифты `--display` = Unbounded, `--body` = Golos Text). `seo.css` — SEO-страницы. После правки поднять `styles.css?v=` / `seo.css?v=` во всех HTML.
