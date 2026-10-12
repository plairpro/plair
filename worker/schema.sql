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
