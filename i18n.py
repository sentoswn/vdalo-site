"""Мовні версії сайту: /ru/, /en/, /pl/ (українська — основна, у корені).

Як це працює:
  * build.py генерує всі сторінки українською, а потім для кожної мови робить копію
    у /ru/…, /en/…, /pl/… — тексти перекладаються за словником i18n/<мова>.json.
  * Переклад стосується тексту сторінки й атрибутів (title, placeholder, aria-label, meta),
    але не коду скриптів і не data-атрибутів (від них залежить логіка сайту).
  * Вміст, який з'являється в браузері (картки вакансій, лічильники, повідомлення),
    перекладає скрипт сторінки за /<мова>/i18n.json (частина того самого словника).
  * Довгі описи вакансій і компаній (desc / about) лишаються українською.

Словник: { "українська фраза": "переклад" }. Фрази шукаються цілими словами,
спершу найдовші. Неперекладене можна знайти: python3 i18n.py check
"""
import html as _html
import json
import os
import re
import sys

LANGS = ["ru", "en", "pl"]
ALL = ["uk"] + LANGS
LABEL = {"uk": "УКР", "ru": "РУС", "en": "ENG", "pl": "POL"}
HTML_LANG = {"uk": "uk", "ru": "ru", "en": "en", "pl": "pl"}
ROOT = os.path.dirname(os.path.abspath(__file__))
DICT_DIR = os.path.join(ROOT, "i18n")

CYR = re.compile(r"[А-Яа-яІіЇїЄєҐґ]")
TR_ATTRS = ("placeholder", "aria-label", "title", "alt")
META_NAMES = ("description", "og:title", "og:description", "twitter:title", "twitter:description")
# блоки, які не перекладаємо (опис вакансії та компанії)
KEEP_RX = re.compile(r'(<span class="kw-w">.*?</span>|<span class="logo-mark">.*?</span>)', re.S)
LETTER = r"[^\W\d_]"


SRC_DIR = os.path.join(DICT_DIR, "src")
COL = {"ru": 1, "en": 2, "pl": 3}
# правила з числами: (регулярний вираз, {мова: заміна})
RULES = [
    (r"вакансій із житлом, у (\d+) — безкоштовне", {"ru": r"вакансий с жильём, в \1 — бесплатное", "en": r"jobs with housing, \1 with free housing", "pl": r"ofert z zakwaterowaniem, w \1 — darmowe"}),
    (r"(\d+) км від ", {"ru": r"\1 км от ", "en": r"\1 km from ", "pl": r"\1 km od "}),
    (r"(\d) год(?![/А-Яа-яІіЇїЄєҐґ])", {"ru": r"\1 ч", "en": r"\1 h", "pl": r"\1 h"}),
    (r"(\S) у (?=[A-ZŁŚŻŹĆa-z])", {"ru": r"\1 в ", "en": r"\1 at ", "pl": r"\1 w "}),
    (r"(\d+) з (\d+)", {"ru": r"\1 из \2", "en": r"\1 of \2", "pl": r"\1 z \2"}),
    (r"\) — це ", {"ru": ") — это ", "en": ") — that's ", "pl": ") — to "}),
    (r"(\d+) років", {"ru": r"\1 лет", "en": r"\1", "pl": r"\1 lat"}),
    (r"(\d+) роки", {"ru": r"\1 года", "en": r"\1", "pl": r"\1 lata"}),
    (r"(\d+) рік", {"ru": r"\1 год", "en": r"\1", "pl": r"\1 lat"}),
    (r"(\d{4}) року", {"ru": r"\1 года", "en": r"\1", "pl": r"\1 r."}),
    (r"(\d+)–(\d+) р\.", {"ru": r"\1–\2 лет", "en": r"aged \1–\2", "pl": r"\1–\2 lat"}),
]


def load(lang):
    """Словник мови: зі вихідних файлів i18n/src/*.txt (українська ¦ ru ¦ en ¦ pl)."""
    d = {}
    if os.path.isdir(SRC_DIR):
        for fn in sorted(os.listdir(SRC_DIR)):
            if not fn.endswith(".txt"):
                continue
            for line in open(os.path.join(SRC_DIR, fn), encoding="utf-8"):
                line = line.rstrip("\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                cols = [c.strip() for c in line.split(" ¦ ")]
                if len(cols) == 4 and cols[0] and cols[COL[lang]]:
                    d[cols[0]] = cols[COL[lang]]
    return d


PRE = {0, 1, 2}  # індекси правил, що застосовуються ДО словника


def rules(lang, pre=False):
    return [(re.compile(rx), rep[lang]) for i, (rx, rep) in enumerate(RULES) if lang in rep and ((i in PRE) == pre)]


def guard(k):
    """Шаблон для фрази: межі слова лише там, де фраза починається/закінчується літерою."""
    a = r"(?<!" + LETTER + r")" if re.match(LETTER, k[0]) else ""
    b = r"(?!" + LETTER + r")" if re.match(LETTER, k[-1]) else ""
    return a + re.escape(k) + b


class Tr:
    def __init__(self, d, lang=None, exact=None, frozen=None):
        self.exact = exact or {}    # цілі тексти (описи вакансій) — лише точний збіг
        self.frozen = frozen or set()  # тексти без перекладу: лишаємо як є, а не перекладаємо шматками
        self.d = {k: v for k, v in d.items() if k and v and k != v}
        keys = sorted(self.d, key=len, reverse=True)
        self.rx = re.compile("|".join(guard(k) for k in keys)) if keys else None
        self.rules = rules(lang) if lang else []
        self.pre = rules(lang, True) if lang else []

    def text(self, s):
        if not s or not CYR.search(s):
            return s
        s = s.replace("\xa0", " ")
        st = s.strip()
        if st in self.exact:
            return s.replace(st, self.exact[st])
        if st in self.frozen:
            return s
        if st in self.d:
            return s.replace(st, self.d[st])
        for rx, rep in self.pre:
            s = rx.sub(rep, s)
        if self.rx:
            s = self.rx.sub(lambda m: self.d.get(m.group(0), m.group(0)), s)
        for rx, rep in self.rules:
            s = rx.sub(rep, s)
        return s


def lp(lang):
    return "" if lang == "uk" else "/" + lang


def rewrite_links(h, lang):
    pre = lp(lang)

    def fix(m):
        url = m.group(2)
        if re.match(r"/(img|ru|en|pl)/|/[^/]*\.(json|xml|svg|png|ico|txt|js|css)$", url):
            return m.group(0)
        return m.group(1) + pre + url + m.group(3)
    h = re.sub(r'(href=")(/[^"]*)(")', fix, h)
    h = h.replace('href="/"', f'href="{pre}/"')
    return h


def alternates(path, site):
    out = [f'<link rel="alternate" hreflang="{HTML_LANG[l]}" href="{site}{lp(l)}{path}">' for l in ALL]
    out.append(f'<link rel="alternate" hreflang="x-default" href="{site}{path}">')
    return "\n".join(out)


def translate_html(h, lang, path, site, tr):
    """h — готова українська сторінка; повертає сторінку мовою lang."""
    keep = []

    def stash(m):
        keep.append(m.group(0))
        return f"\x00K{len(keep)-1}\x00"
    h = KEEP_RX.sub(stash, h)
    # прибираємо JobPosting (щоб Google Jobs не дублював вакансії різними мовами)
    h = re.sub(r'<script type="application/ld\+json">(?:(?!</script>).)*"JobPosting"(?:(?!</script>).)*</script>\n?', "", h, flags=re.S)
    parts = re.split(r"(<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)", h, flags=re.S)
    out = []
    for p in parts:
        if not p:
            continue
        if p.startswith("<script") or p.startswith("<style"):
            out.append(p)
        elif p.startswith("<"):
            def attr(m):
                return f'{m.group(1)}="{_html.escape(tr.text(_html.unescape(m.group(2))), quote=True)}"'
            p = re.sub(r'\b(' + "|".join(TR_ATTRS) + r')="([^"]*)"', attr, p)
            if p.startswith("<meta") and re.search(r'(?:name|property)="(' + "|".join(META_NAMES) + ')"', p):
                p = re.sub(r'(content)="([^"]*)"', attr, p)
            out.append(p)
        else:
            out.append(_html.escape(tr.text(_html.unescape(p)), quote=False) if CYR.search(p) else p)
    h = "".join(out)
    h = re.sub("\x00K(\\d+)\x00", lambda m: keep[int(m.group(1))], h)
    # <title>
    h = re.sub(r"<title>(.*?)</title>", lambda m: "<title>" + _html.escape(tr.text(_html.unescape(m.group(1))), quote=False) + "</title>", h, count=1, flags=re.S)
    h = h.replace('<html lang="uk">', f'<html lang="{HTML_LANG[lang]}">', 1)
    h = rewrite_links(h, lang)
    url = site + lp(lang) + path
    h = re.sub(r'(<link rel="canonical" href=")[^"]*(")', r"\g<1>" + url + r"\2", h)
    h = re.sub(r'(<meta property="og:url" content=")[^"]*(")', r"\g<1>" + url + r"\2", h)
    h = h.replace('<meta property="og:locale" content="uk_UA">', f'<meta property="og:locale" content="{ {"ru": "ru_UA", "en": "en_US", "pl": "pl_PL"}[lang] }">')
    h = h.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<script>window.VDALO_LANG="{lang}";</script>', 1)
    if lang in ("en", "pl"):
        h = h.replace('<span class="logo-mark">В</span>', '<span class="logo-mark">V</span>')
    return h


# ---------- описи вакансій: переклад цілими текстами ----------
DESC_FILE = os.path.join(DICT_DIR, "desc.txt")
AUTO_FILE = os.path.join(DICT_DIR, "desc_auto.json")


def load_desc(lang):
    """Переклади цілих текстів: вручну (i18n/desc.txt) + автоматичні (i18n/desc_auto.json)."""
    d = {}
    if os.path.exists(AUTO_FILE):
        for k, v in json.load(open(AUTO_FILE, encoding="utf-8")).items():
            if v.get(lang):
                d[k] = v[lang]
    if os.path.exists(DESC_FILE):
        for line in open(DESC_FILE, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            cols = [c.strip() for c in line.split(" ¦ ")]
            if len(cols) == 4 and cols[0] and cols[COL[lang]]:
                d[cols[0]] = cols[COL[lang]]
    return d


def desc_texts(items):
    out = []
    for v in items:
        for k in ("desc", "about"):
            x = v.get(k)
            if isinstance(x, str) and CYR.search(x) and x.strip() not in out:
                out.append(x.strip())
    return out


def _gtx(text, lang):
    import urllib.parse
    import urllib.request
    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=uk&tl=" + lang + "&dt=t&q=" + urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
    res = "".join(seg[0] for seg in data[0] if seg and seg[0])
    if not res.strip():
        raise ValueError("empty")
    return res


def auto_translate(texts, limit=400):
    """Перекладає машинно ті тексти, яких немає у словниках; зберігає в i18n/desc_auto.json.
    Без інтернету тихо нічого не робить — такі тексти лишаються українською."""
    auto = json.load(open(AUTO_FILE, encoding="utf-8")) if os.path.exists(AUTO_FILE) else {}
    have = {l: load_desc(l) for l in LANGS}
    todo = [t for t in texts if any(t not in have[l] for l in LANGS)][:limit]
    done = 0
    for t in todo:
        rec = auto.get(t, {})
        try:
            for l in LANGS:
                if t not in have[l] and not rec.get(l):
                    rec[l] = _gtx(t, l)
        except Exception as e:  # немає мережі / ліміт — спробуємо наступного разу
            print("автопереклад зупинено:", type(e).__name__)
            if rec:
                auto[t] = rec
            break
        auto[t] = rec
        done += 1
    if done or todo:
        json.dump(auto, open(AUTO_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    return done


def runtime_dict(d, keys):
    """Частина словника для перекладу в браузері (динамічний вміст)."""
    return {k: d[k] for k in keys if d.get(k)}


# ---------- збір фраз для словника ----------
def segments_from_html(h):
    segs = set()
    h = KEEP_RX.sub("", h)
    h = re.sub(r'<script type="application/ld\+json">.*?</script>', "", h, flags=re.S)
    for p in re.split(r"(<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)", h, flags=re.S):
        if not p or p.startswith("<script") or p.startswith("<style"):
            continue
        if p.startswith("<"):
            for a, v in re.findall(r'\b(' + "|".join(TR_ATTRS) + r')="([^"]*)"', p):
                v = _html.unescape(v).strip()
                if CYR.search(v):
                    segs.add(v)
            if p.startswith("<meta") and re.search(r'(?:name|property)="(' + "|".join(META_NAMES) + ')"', p):
                for v in re.findall(r'content="([^"]*)"', p):
                    v = _html.unescape(v).strip()
                    if CYR.search(v):
                        segs.add(v)
        else:
            t = _html.unescape(p).strip()
            if CYR.search(t):
                segs.add(t)
    m = re.search(r"<title>(.*?)</title>", h, re.S)
    if m:
        segs.add(_html.unescape(m.group(1)).strip())
    return segs


def js_literals(h):
    """Українські рядки з коду сторінки (з'являються в браузері)."""
    segs = set()
    for sc in re.findall(r"<script>(.*?)</script>", h, re.S):
        for q in re.findall(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'', sc):
            s = q[0] or q[1]
            if CYR.search(s) and "<" not in s and "\\" not in s:
                for piece in re.split(r"\s*[·—]\s*", s):
                    piece = piece.strip(" ,.:;()+")
                    if CYR.search(piece):
                        segs.add(piece)
            elif CYR.search(s) and "<" in s:
                for t in re.findall(r">([^<>]+)<", s):
                    t = t.strip()
                    if CYR.search(t):
                        segs.add(t)
    return segs


def vacancy_segments(items):
    segs = set()
    for v in items:
        for k in ("title", "who", "housing", "food", "transport", "schedule", "night", "contract", "perks", "req", "trips", "salary", "hours"):
            s = v.get(k)
            if isinstance(s, str) and CYR.search(s):
                segs.add(s.strip())
    return segs


def residual(lang, segs):
    """Що лишилося неперекладеним: {сегмент: залишок}."""
    tr = Tr(load(lang), lang)
    out = {}
    for s in segs:
        r = tr.text(s)
        bad = re.findall(r"[А-Яа-яІіЇїЄєҐґ’'ʼ-]*[ІіЇїЄєҐґ][А-Яа-яІіЇїЄєҐґ’'ʼ-]*", r) if lang == "ru" else re.findall(r"[А-Яа-яІіЇїЄєҐґ’'ʼ-]*[А-Яа-яІіЇїЄєҐґ][А-Яа-яІіЇїЄєҐґ’'ʼ-]*", r)
        if bad:
            out[s] = r
    return out


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "residual":
    lang = sys.argv[2]
    segs = json.load(open(os.path.join(DICT_DIR, "_segments.json"), encoding="utf-8"))
    res = residual(lang, segs)
    print(lang, "неперекладених сегментів:", len(res), "з", len(segs))
    for s, r in sorted(res.items(), key=lambda x: len(x[0])):
        print("•", r[:200])

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "check":
    # показує фрази, яких бракує у словниках
    want = set(json.load(open(os.path.join(DICT_DIR, "_segments.json"), encoding="utf-8")))
    for l in LANGS:
        d = load(l)
        miss = sorted(s for s in want if s not in d)
        print(f"{l}: бракує {len(miss)} з {len(want)}")
        for s in miss[:40]:
            print("   ", s[:120])
