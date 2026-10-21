# PLAIR SDK — рекорды и вызовы «побей мой рекорд»

Файл `sdk.js` в корне репозитория, публичный адрес `https://plair.pro/sdk.js`. Для авторов игр — необязательный. Правила для игроков и авторов показаны на сайте: окно «i» → «Scores and challenges» и форма «+» → блок «Scores and challenges — optional».

## Для автора игры

```html
<head>
  <meta name="plair-verify" content="plair-…">          <!-- подтверждение авторства (обязательно) -->
  <script src="https://plair.pro/sdk.js"></script>      <!-- SDK (по желанию) -->
</head>
```

```js
PLAIR.score(87);                              // партия закончилась: счёт
PLAIR.score(42.5, { lowerIsBetter: true });   // игры на время: меньше — лучше
PLAIR.onChallenge(function (c) {              // игрока позвал друг
  showGoal('Beat ' + c.score + (c.name ? ' by ' + c.name : ''));
});
PLAIR.inFeed;                                 // true, если игра открыта в ленте
```

- Вне ленты (игра открыта сама по себе) SDK ничего не делает и не ломает.
- SDK шлёт только переданный счёт, данных об игроке не собирает.
- Направление «меньше — лучше» для игры задаёт **первый** присланный счёт (таблица `boards`).
- Проверить подключение: в форме «+» нажать «Try it in the player» — появится «PLAIR SDK connected», после партии — «Score received».

## Как это работает внутри

```
игра (iframe)                    лента (games.js)                     сервер
  sdk.js ── postMessage {plair:1, type:'hello'} ──►  показать кубок в шапке
                                                      если есть вызов — отправить в игру
         ◄── postMessage {plair:1, type:'challenge', challenge:{score,name,lowerIsBetter}}
  PLAIR.score(v) ── {plair:1, type:'score', value, lower} ──►
                                    вошёл?  да ──► POST /score ──► лучший счёт, место
                                            нет ─► показать счёт, «Sign in to save»,
                                                   запомнить в sessionStorage до входа
```

- Лента принимает сообщения **только от окна текущей игры** (`e.source === iframe.contentWindow`).
- Карточка счёта (`#g-score` в проигрывателе): счёт, лучший результат, место «#3 of 40», кнопки «Challenge a friend» и «Leaderboard». Скрывается через 9–12 с.
- Таблица лидеров: топ-10 вошедших (`GET /board`), своё место ниже, если не в топе.

## Правила (так написано и на сайте)

- **Рекорд записывается только у вошедших через Google** (или GitHub): один лучший результат на аккаунт и игру, с именем.
- Гость видит счёт партии и может позвать друга, но в таблицу не попадает. Если он войдёт в той же вкладке, его лучший счёт отправится сам («Your score is saved»).
- Подделанные счёта модератор удаляет (браузерную игру можно обмануть — это неизбежно).

Лимиты сервера: ≤60 отправок счёта в сутки с браузера на игру, ≤20 ссылок-вызовов, модуль счёта ≤ 10¹².

## Вызов «побей мой рекорд»

1. «Challenge a friend» → `POST /duel {id, visitor, value: лучший счёт}` → короткий код.
2. Ссылка `https://plair.pro/?g=<игра>&duel=<код>` уходит через системное меню «Поделиться» (телефон) или копируется с текстом «I scored 87 in Shift on PLAIR — can you beat it?». Засчитывается как репост.
3. Друг открывает ссылку: лента встаёт на игру, на карточке плашка «Alex scored 120 — beat it», вызов передаётся в игру (`PLAIR.onChallenge`).
4. После партии друга лента пишет «You beat Alex’s 120!» или «120 to beat Alex — try again».

## Удалить подделанный рекорд

```sh
npx wrangler d1 execute plair-counts --remote --command "SELECT who, name, best FROM scores WHERE game='shift' ORDER BY best DESC LIMIT 20"
npx wrangler d1 execute plair-counts --remote --command "DELETE FROM scores WHERE game='shift' AND who='google:…'"
```

## Что дальше (не сделано)

- Встроить `PLAIR.score()` в игры студии (нужно править репозитории игр `plairpro/<игра>`).
- `PLAIR.rewarded()` — реклама за награду, доля автору.
- Сохранение прогресса между устройствами.
