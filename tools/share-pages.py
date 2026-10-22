#!/usr/bin/env python3
"""Страницы для репостов: plair.pro/g/<id>/ с названием, описанием и картинкой игры.

Соцсети и мессенджеры не запускают JavaScript, поэтому для каждой игры нужна
своя статичная страница с тегами og:* и twitter:*. Человека она сразу
переводит в ленту на эту игру (/?g=<id>, с теми же параметрами, например ?duel=).

Запуск из корня сайта:
    python3 tools/share-pages.py            # игры из games/games.json
    python3 tools/share-pages.py --server   # плюс одобренные игры с сервера

Для каждой игры пишет g/<id>/index.html и g/<id>/og.jpg (1200×630).
Нужен Pillow: pip install pillow
"""
import html, io, json, os, re, sys, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Основной адрес сайта — www (plair.pro перенаправляет сюда). Для превью
# берём его напрямую: не все соцсети идут по перенаправлению за картинкой.
SITE = 'https://www.plair.pro'
SERVER = 'https://plair-counts.timurshorts.workers.dev'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'tools', 'fonts')
W, H = 1200, 630
INK, MUTED, GREEN, BG = (243, 245, 239), (169, 179, 166), (52, 199, 89), (14, 18, 13)


def font(name, size, weight):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'plair-share-pages'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def load_cover(src):
    if not src:
        return None
    try:
        if src.startswith('/'):
            path = os.path.join(ROOT, src.split('?')[0].lstrip('/'))
            return Image.open(path).convert('RGB')
        return Image.open(io.BytesIO(fetch(src))).convert('RGB')
    except Exception as e:
        print('  cover not loaded:', src, e, file=sys.stderr)
        return None


def cover_fit(im, w, h):
    k = max(w / im.width, h / im.height)
    im = im.resize((max(w, round(im.width * k)), max(h, round(im.height * k))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def wrap(draw, text, f, width, lines):
    words, out, cur = text.split(), [], ''
    for wd in words:
        t = (cur + ' ' + wd).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            if cur:
                out.append(cur)
            cur = wd
        if len(out) == lines:
            break
    if cur and len(out) < lines:
        out.append(cur)
    if len(out) == lines and ' '.join(out) != ' '.join(words):
        last = out[-1]
        while last and draw.textlength(last + '…', font=f) > width:
            last = last[:-1]
        out[-1] = last.rstrip(' ,.;:—-') + '…'
    return out


def logo(height):
    m = Image.open(os.path.join(ROOT, 'assets', 'logo-mask.webp')).getchannel('A')
    m = m.crop(m.getbbox())
    m = m.resize((round(m.width * height / m.height), height), Image.LANCZOS)
    im = Image.new('RGBA', m.size, INK + (0,))
    im.putalpha(m)
    return im


def card(g):
    cov = load_cover(g.get('cover'))
    img = Image.new('RGB', (W, H), BG)
    if cov:
        back = cover_fit(cov, W, H).filter(ImageFilter.GaussianBlur(38))
        img = Image.blend(img, back, 0.42)
    shade = Image.new('L', (W, 1))
    for x in range(W):   # слева темнее — там текст
        shade.putpixel((x, 0), int(235 - 120 * x / W))
    img.paste(Image.new('RGB', (W, H), BG), (0, 0), shade.resize((W, H)))

    d = ImageDraw.Draw(img)
    # Обложка справа, как карточка в ленте: 9:16 со скруглением.
    ch, cw = 550, 310
    cx, cy = W - cw - 64, (H - ch) // 2
    if cov:
        c = cover_fit(cov, cw, ch)
        mask = Image.new('L', (cw, ch), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw - 1, ch - 1), 26, fill=255)
        sh = Image.new('L', (W, H), 0)
        ImageDraw.Draw(sh).rounded_rectangle((cx, cy + 18, cx + cw, cy + ch + 18), 26, fill=150)
        sh = sh.filter(ImageFilter.GaussianBlur(24))
        img.paste((0, 0, 0), (0, 0), sh)
        img.paste(c, (cx, cy), mask)
        d.rounded_rectangle((cx, cy, cx + cw - 1, cy + ch - 1), 26, outline=(255, 255, 255, 40), width=1)

    lg = logo(40)
    img.paste(lg, (72, 64), lg)
    left, width = 72, cx - 72 - 56
    title = g.get('title') or g['id']
    size = 76
    while size > 44:
        ft = font('Unbounded.ttf', size, b'SemiBold')
        tl = wrap(d, title, ft, width, 2)
        if ' '.join(tl) == title or size <= 46:
            break
        size -= 6
    y = 200
    for line in tl:
        d.text((left, y), line, font=ft, fill=INK)
        y += int(size * 1.18)
    fb = font('GolosText.ttf', 32, b'Regular')
    y += 14
    for line in wrap(d, g.get('blurb') or 'A small web game. Tap and play — nothing to install.', fb, width, 3):
        d.text((left, y), line, font=fb, fill=MUTED)
        y += 44
    # «Играть» — зелёная плашка внизу.
    fp = font('GolosText.ttf', 30, b'SemiBold')
    label = 'Play on plair.pro'
    tw = d.textlength(label, font=fp)
    bx, by, bh = left, H - 64 - 68, 68
    d.rounded_rectangle((bx, by, bx + tw + 96, by + bh), 34, fill=GREEN)
    d.polygon([(bx + 30, by + 22), (bx + 30, by + 46), (bx + 50, by + 34)], fill=(11, 20, 12))
    d.text((bx + 64, by + bh / 2), label, font=fp, fill=(11, 20, 12), anchor='lm')
    return img


PAGE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — play on PLAIR Games</title>
<meta name="description" content="{desc}">
<meta name="robots" content="noindex,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PLAIR Games">
<meta property="og:url" content="{site}/g/{id}/">
<meta property="og:title" content="{title} — play on PLAIR Games">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{site}/g/{id}/og.jpg?v={ver}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{title}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} — play on PLAIR Games">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{site}/g/{id}/og.jpg?v={ver}">
<meta name="theme-color" content="#0E120D">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script>
  // Человека сразу ведём в ленту на эту игру; ?duel= и прочее — с собой.
  (function () {{
    var q = new URLSearchParams(location.search);
    q.set('g', {jsid});
    location.replace('/?' + q.toString() + location.hash);
  }})();
</script>
<style>body{{margin:0;background:#0E120D;color:#F3F5EF;font:16px/1.5 system-ui,sans-serif;
display:grid;place-items:center;min-height:100vh}}a{{color:#34C759}}</style>
</head>
<body><p><a href="/?g={qid}">Play {title} on PLAIR Games</a></p></body>
</html>
'''


def page(g, ver):
    title = html.escape(g.get('title') or g['id'])
    desc = html.escape(g.get('blurb') or 'A small web game. Tap and play — nothing to install.')
    return PAGE.format(site=SITE, id=g['id'], qid=urllib.parse.quote(g['id']), jsid=json.dumps(g['id']),
                       title=title, desc=desc, ver=ver)


def main():
    import hashlib, urllib.parse  # noqa: F401  (urllib.parse нужен в page)
    games = json.load(open(os.path.join(ROOT, 'games', 'games.json'), encoding='utf-8'))
    if '--server' in sys.argv:
        try:
            extra = json.loads(fetch(SERVER + '/games')).get('games', [])
            ids = {g['id'] for g in games}
            games += [g for g in extra if g.get('id') and g['id'] not in ids]
        except Exception as e:
            print('server games not loaded:', e, file=sys.stderr)
    out = os.path.join(ROOT, 'g')
    for g in games:
        if not re.match(r'^[a-z0-9-]{1,40}$', g.get('id', '')):
            continue
        d = os.path.join(out, g['id'])
        os.makedirs(d, exist_ok=True)
        buf = io.BytesIO()
        card(g).save(buf, 'JPEG', quality=86, optimize=True, progressive=True)
        jpg = buf.getvalue()
        ver = hashlib.sha1(jpg).hexdigest()[:8]
        p = os.path.join(d, 'og.jpg')
        if not os.path.exists(p) or open(p, 'rb').read() != jpg:
            open(p, 'wb').write(jpg)
        p = os.path.join(d, 'index.html')
        text = page(g, ver)
        if not os.path.exists(p) or open(p, encoding='utf-8').read() != text:
            open(p, 'w', encoding='utf-8').write(text)
        print(g['id'], len(jpg) // 1024, 'KB')


if __name__ == '__main__':
    import urllib.parse
    main()
