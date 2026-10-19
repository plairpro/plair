-- Счётчики ленты игр. Ничего личного: только числа и случайный номер
-- браузера, который этот же браузер себе и выдал.

CREATE TABLE IF NOT EXISTS games (
  id       TEXT PRIMARY KEY,
  plays    INTEGER NOT NULL DEFAULT 0,
  likes    INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0
);

-- Запуски считаются не чаще десяти раз в сутки с одного браузера на игру:
-- иначе свою игру накручивают перезагрузкой страницы.
CREATE TABLE IF NOT EXISTS plays_today (
  visitor TEXT NOT NULL,
  game    TEXT NOT NULL,
  day     TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor, game, day)
);
CREATE INDEX IF NOT EXISTS plays_today_day ON plays_today (day);

-- Один лайк с браузера на игру. Строка и есть признак лайка.
CREATE TABLE IF NOT EXISTS likes (
  visitor TEXT NOT NULL,
  game    TEXT NOT NULL,
  PRIMARY KEY (visitor, game)
);

-- ── Комментарии ─────────────────────────────────────────────
-- Вход через Google или GitHub. Храним только то, что видно под
-- комментарием: имя и аватар. Почту не просим и не храним.
-- id — 'google:<sub>' или 'github:<числовой id>'.
CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  avatar  TEXT,
  login   TEXT,                       -- ник на GitHub, для ссылки на профиль
  created INTEGER NOT NULL,
  banned  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  game    TEXT NOT NULL,
  user    TEXT NOT NULL,
  text    TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_game ON comments (game, id DESC);
CREATE INDEX IF NOT EXISTS comments_user ON comments (user, created);

-- Служебное: ключ подписи пропусков, если он не задан секретом.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Избранное: какие игры человек сохранил себе.
CREATE TABLE IF NOT EXISTS saves (user TEXT NOT NULL, game TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (user, game));
