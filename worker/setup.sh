#!/usr/bin/env bash
# Поднимает Worker счётчиков и комментариев ленты plair.pro.
#
#   cd ~/Documents/plair/site/worker && ./setup.sh
#
# Скрипт можно запускать сколько угодно раз: база и секрет пропусков
# создаются один раз, остальное он спрашивает заново, Enter — пропустить.
# Ключи вы вставляете прямо в Terminal: они уходят в Cloudflare как
# секреты Worker’а и не попадают ни в файлы, ни в git.
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

command -v npx >/dev/null 2>&1 || { echo "Нужен Node.js — https://nodejs.org (кнопка LTS), потом запустите скрипт снова."; exit 1; }
W() { npx --yes wrangler@4 "$@"; }

say "1/6 Вход в Cloudflare"
if ! W whoami 2>/dev/null | grep -qi "logged in"; then
  note "Откроется браузер — войдите в свой аккаунт Cloudflare и нажмите Allow."
  W login
fi

say "2/6 База данных"
if grep -q "ПОДСТАВИТЬ_ID" wrangler.toml; then
  out="$(W d1 create plair-counts 2>&1 || true)"
  id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
  if [ -z "$id" ]; then   # база уже была — берём её id из списка
    id="$(W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const d=l.find(x=>x.name==="plair-counts");process.stdout.write(d?d.uuid:"")})')"
  fi
  [ -n "$id" ] || { echo "Не получилось создать базу:"; echo "$out"; exit 1; }
  node -e 'const fs=require("fs");fs.writeFileSync("wrangler.toml",fs.readFileSync("wrangler.toml","utf8").replace(/ПОДСТАВИТЬ_ID[^"]*/,process.argv[1]))' "$id"
  note "База plair-counts: $id"
else
  note "Уже есть, пропускаю."
fi
W d1 execute plair-counts --remote --yes --file=./schema.sql >/dev/null
note "Таблицы на месте."

say "3/6 Публикация Worker’а"
# Первый раз Cloudflare может спросить имя поддомена *.workers.dev —
# поэтому сначала публикуем «вживую», а адрес берём со второго, тихого раза.
W deploy
URL="$(W deploy 2>&1 | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)"
[ -n "$URL" ] || { echo "Не нашёл адрес Worker’а в выводе выше."; exit 1; }
note "Адрес: $URL"

if ! W secret list 2>/dev/null | grep -q SESSION_SECRET; then
  # Ключ подписи пропусков. Генерируется здесь и сразу уходит в
  # Cloudflare; если его сменить, всех разлогинит.
  openssl rand -hex 32 | W secret put SESSION_SECRET >/dev/null
  note "Ключ пропусков создан."
fi

put() {  # put ИМЯ "подсказка" [скрыто]
  local v=""
  if [ "${3:-}" = "hidden" ]; then read -r -s -p "  $2: " v; echo; else read -r -p "  $2: " v; fi
  if [ -n "$v" ]; then printf '%s' "$v" | W secret put "$1" >/dev/null && note "✓ $1 сохранён"; else note "— пропущено"; fi
}

say "4/6 Вход через Google"
cat <<EOF
  1. Откройте https://console.cloud.google.com/auth/overview и создайте проект PLAIR
     (Get started: имя приложения PLAIR, ваша почта, Audience — External).
  2. Clients → Create client → Web application.
     Authorized redirect URIs:  $URL/auth/google/callback
  3. Audience → Publish app — иначе войти смогут только тестовые аккаунты.
  Скопируйте Client ID и Client secret сюда.
EOF
put GOOGLE_CLIENT_ID "Google Client ID (Enter — пропустить)"
put GOOGLE_CLIENT_SECRET "Google Client secret" hidden

say "5/6 Вход через GitHub"
cat <<EOF
  1. Откройте https://github.com/organizations/plairpro/settings/applications/new
     (или https://github.com/settings/applications/new, если без организации).
  2. Application name: PLAIR   Homepage URL: https://plair.pro
     Authorization callback URL:  $URL/auth/github/callback
  3. Register application → скопируйте Client ID → Generate a new client secret.
EOF
put GITHUB_CLIENT_ID "GitHub Client ID (Enter — пропустить)"
put GITHUB_CLIENT_SECRET "GitHub Client secret" hidden

say "6/6 Модерация и уведомления"
read -r -p "  Ваш ник на GitHub — сможете удалять любые комментарии (Enter — пропустить): " gh
if [ -n "$gh" ]; then
  uid="$(curl -fsS "https://api.github.com/users/$gh" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).id||"")))' || true)"
  if [ -n "$uid" ]; then printf 'github:%s' "$uid" | W secret put ADMINS >/dev/null && note "✓ модератор: @$gh"
  else note "GitHub не знает @$gh — пропускаю."; fi
fi
note "Уведомления о новых комментариях приходят в Telegram тем же ботом, что и заявки с сайта."
put TG_BOT_TOKEN "Токен бота от @BotFather (Enter — без уведомлений)" hidden

# Лента узнаёт адрес Worker’а из одной строки в games.js.
node -e 'const fs=require("fs"),f="../games/games.js";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/var COUNTS = [^;]*;/,"var COUNTS = "+JSON.stringify(process.argv[1])+";"))' "$URL"

say "Готово"
note "Адрес Worker’а вписан в games/games.js. Осталось опубликовать сайт"
note "(git commit + push или просто скажите Claude — он опубликует)."
note "Проверка: $URL/config — в providers должны быть google и github."
