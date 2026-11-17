"""Щоденні сторіс «Вдало» для Instagram.

Малює 3 сторіс 1080×1920 на день (вакансія дня, корисна картка, інтерактив)
і пише підказки: яке посилання чи стікер додати в Instagram.

  python3 tools/stories/stories.py [--day YYYY-MM-DD] [--out DIR]

Потрібен playwright з chromium. Тексти беруться з vacancies.json.
"""
import argparse, asyncio, base64, datetime as dt, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONTS_DIR = pathlib.Path(__file__).resolve().parent / "fonts"
SITE = "https://vdalo-robota.com.ua"
START = dt.date(2026, 11, 18)

CYR = "U+0400-04FF,U+2116"
LAT = "U+0000-00FF,U+00D7,U+2013-2014,U+2019,U+201C-201E,U+2026,U+2192,U+2191,U+2193,U+2248,U+2713"


def ff(name, d, w, sub):
    b = base64.b64encode((FONTS_DIR / f"{d}-{sub}-{w}-normal.woff2").read_bytes()).decode()
    rng = CYR if sub == "cyrillic" else LAT
    return f"@font-face{{font-family:{name};font-weight:{w};unicode-range:{rng};src:url('data:font/woff2;base64,{b}') format('woff2')}}"


FONTS = "".join(ff(n, d, w, s) for n, d, w in [("U", "unbounded", 700), ("M", "manrope", 600), ("M", "manrope", 800)] for s in ("latin", "cyrillic"))
CSS = FONTS + """*{margin:0;padding:0;box-sizing:border-box}
.c{width:1080px;height:1920px;padding:230px 84px 300px;display:flex;flex-direction:column;gap:70px;font-family:M;font-weight:600;color:#0b0c0e;
 background:linear-gradient(160deg,#bfe0f5 0%,#d4f0dd 50%,#f7dbe7 100%)}
.c.dark{background:#0b0c0e;color:#fff}
.logo{display:flex;align-items:center;gap:20px;font-family:U;font-weight:700;font-size:44px}
.mark{width:78px;height:78px;border-radius:24px;background:#0b0c0e;color:#fff;display:grid;place-items:center;font-size:37px}
.dark .mark{background:#fff;color:#0b0c0e}
.body{margin-top:auto;margin-bottom:auto;display:flex;flex-direction:column;gap:34px}
.k{font-size:34px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.6}
h1{font-family:U;font-weight:700;font-size:88px;line-height:1.08}
h1.s{font-size:72px} h1.xs{font-size:60px}
.big{font-family:U;font-weight:700;font-size:80px;line-height:1.05;white-space:nowrap}
.lbl{font-size:34px;font-weight:800;opacity:.65;margin-top:-18px}
.p{font-size:42px;line-height:1.35}
.list{display:flex;flex-direction:column;gap:22px}
.row{display:flex;gap:24px;align-items:flex-start;font-size:42px;line-height:1.28;font-weight:800}
.n{flex:none;width:64px;height:64px;border-radius:50%;background:#0b0c0e;color:#fff;display:grid;place-items:center;font-size:30px;font-family:U}
.dark .n{background:#fff;color:#0b0c0e}
.row small{display:block;font-weight:600;font-size:34px;opacity:.75;margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:18px}
.chip{background:rgba(255,255,255,.8);border-radius:999px;padding:20px 32px;font-size:36px;font-weight:800}
.dark .chip{background:rgba(255,255,255,.13)}
.slot{height:300px}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:32px;font-weight:800;opacity:.85}
"""
LOGO = '<div class="logo"><span class="mark">В</span>Вдало</div>'
FOOT = '<div class="foot"><span>vdalo-robota.com.ua</span><span>+380 66 005 00 60</span></div>'


def row(i, t, s=""):
    return f'<div class="row"><span class="n">{i}</span><span>{t}{"<small>" + s + "</small>" if s else ""}</span></div>'


def chips(*xs):
    return '<div class="chips">' + "".join(f'<span class="chip">{x}</span>' for x in xs if x) + "</div>"


def h1(t):
    cls = "" if len(t) <= 26 else ("s" if len(t) <= 42 else "xs")
    return f'<h1 class="{cls}">{t}</h1>'


def fmt(x, dec=0):
    s = f"{x:,.{dec}f}".replace(",", " ")
    return s.replace(".", ",")


def utm(path, camp):
    return f"{SITE}{path}?utm_source=instagram&utm_medium=stories&utm_campaign={camp}"


def short(s, n):
    s = re.split(r"[.;(]", s or "")[0].strip()
    if len(s) > n:
        s = s[:n].rsplit(" ", 1)[0] + "…"
    return s


# ---------- 1. Вакансія дня ----------
def vacancy_story(data, idx):
    items = data["items"]
    rate = data["rates"]["PLN"]
    pool = [v for v in items if v.get("city") and v.get("title") and v.get("net") and v["net"][2] == "год" and v["net"][3] == "PLN"]
    hot = [v for v in pool if v.get("hot")] or pool
    hot.sort(key=lambda v: int(re.sub(r"\D", "", str(v["id"])) or 0))
    v = hot[idx % len(hot)]
    lo, hi = v["net"][0], v["net"][1]
    hrs = [int(x) for x in re.findall(r"\d+", v.get("hours") or "")][:2] or [160, 180]
    if len(hrs) == 1:
        hrs = hrs * 2
    mlo, mhi = round(lo * hrs[0] / 10) * 10, round(hi * hrs[1] / 10) * 10
    uah = lambda z: round(z * rate / 100) * 100
    per_h = f"≈ {fmt(lo, 2)}" + (f"–{fmt(hi, 2)}" if hi != lo else "") + " зл"
    month = f"≈ {fmt(mlo)}–{fmt(mhi)} зл/міс · ≈ {fmt(uah(mlo))}–{fmt(uah(mhi))} грн"
    ds = re.findall(r"\b\d{1,2}\.\d{2}\b", v.get("trips") or "")
    trips = ("Заїзди: " + ", ".join(dict.fromkeys(ds[:3]))) if ds else ""
    body = f"""<div class="k">Вакансія дня · {v['country']}</div>{h1(v.get('title','Вакансія'))}
<div class="p" style="margin-top:-12px">{v.get('city') or v.get('country')}</div>
<div class="big">{per_h}</div><div class="lbl">на руки за годину</div>
<div class="p">{month}<br><span style="opacity:.65;font-size:34px">при {hrs[0]}–{hrs[1]} год на місяць, курс НБУ</span></div>
{chips(short(v.get('housing'), 30) and "Житло: " + short(v.get('housing'), 26), short(v.get('who'), 32), trips)}
<div class="slot"></div>"""
    tip = (f"Вакансія дня №{v['id']} ({v.get('title','Вакансія')}, {v['city']}).\n"
           f"Додайте стікер «Посилання» в рамку з написом: {utm('/vakansii/' + str(v['id']) + '/', 'vac_' + str(v['id']))}\n"
           f"Текст на стікері: «Відгукнутися»")
    return "", body, tip


# ---------- 2. Корисна картка ----------
def tips_bank(data):
    rate = data["rates"]["PLN"]
    m = 22.69 * 180
    return [
        ("dark", f"""<div class="k">Головне правило</div>{h1("Для кандидатів — безкоштовно")}
<p class="p">Ми не беремо передоплату за працевлаштування. За підбір платить роботодавець, а не ви.</p>{chips("0 грн за підбір", "Без передоплати")}""",
         "/", "free"),
        ("", f"""<div class="k">Будьте уважні</div>{h1("5 ознак шахраїв")}<div class="list">
{row(1, "Просять передоплату «за оформлення»")}{row(2, "Зарплата в рази вища за ринкову")}{row(3, "«Виїзд завтра, без питань»")}
{row(4, "Немає фото й адреси житла")}{row(5, "Забирають паспорт «на зберігання»")}</div>""", "/", "scam"),
        ("dark", f"""<div class="k">Польща</div>{h1("Які документи потрібні")}<div class="list">
{row("✓", "Біометричний закордонний паспорт")}{row("✓", "Внутрішній паспорт або ID-картка, ІПН")}
{row("✓", "Чоловікам 18–60 — законна підстава для виїзду")}{row("✓", "Договір і PESEL — оформлюються на місці")}</div>""", "/", "docs"),
        ("", f"""<div class="k">Чекліст</div>{h1("Що взяти в дорогу")}<div class="list">
{row("✓", "Документи + фото в телефоні")}{row("✓", "Гроші на 2–4 тижні", "Перша зарплата — не одразу")}
{row("✓", "Ліки й аптечка")}{row("✓", "Зручне взуття, теплий одяг")}{row("✓", "Павербанк і контакти координатора")}</div>""", "/", "checklist"),
        ("dark", f"""<div class="k">Як ми працюємо</div>{h1("4 кроки до роботи")}<div class="list">
{row(1, "Заявка", "На сайті або в месенджері")}{row(2, "Підбір", "Менеджер пропонує вакансії під вас")}
{row(3, "Документи й дата", "Підкажемо, що потрібно, погодимо заїзд")}{row(4, "Робота", "Координатор на місці, ми на зв'язку")}</div>""", "/", "steps"),
        ("", f"""<div class="k">Склад у Польщі</div>{h1("Скільки реально на руки?")}
<p class="p">31,40 зл брутто → ≈ 22,70 зл на руки за годину × 180 годин</p><div class="big">≈ {fmt(round(m / 10) * 10)} зл</div>
<p class="p">≈ {fmt(round(m * rate / 1000) * 1000)} грн на місяць за сьогоднішнім курсом</p>""", "/robota-na-skladi/", "netto"),
        ("dark", f"""<div class="k">Житло</div>{h1("Що спитати про житло до виїзду")}<div class="list">
{row(1, "Скільки людей у кімнаті")}{row(2, "Чи вираховують оплату з зарплати")}{row(3, "Як добиратися на роботу")}{row(4, "Чи є кухня й пральна машина")}</div>
<p class="p">У кожній вакансії на сайті ці відповіді вже є.</p>""", "/", "housing"),
        ("", f"""<div class="k">Приведи друга</div>{h1("До 4 000 грн за кожного друга")}<div class="list">
{row(1, "2 000 грн за першого друга в місяці")}{row(2, "+200 грн за кожного наступного")}{row(3, "Виплата, коли друг відпрацює 2 тижні")}</div>""", "/", "referral"),
        ("dark", f"""<div class="k">Разом</div>{h1("Їдете парою? Є вакансії для пар")}
<p class="p">Робота для двох на одному підприємстві й житло разом. Шукайте позначку «для пар» на сайті.</p>{chips("Одне житло", "Одне місто", "Різні або однакові зміни")}""", "/", "pairs"),
        ("", f"""<div class="k">Без досвіду</div>{h1("Мова й досвід не обов'язкові")}
<p class="p">Більшість вакансій на складах і виробництві — без досвіду і без польської. Навчають на місці.</p>{chips("Інструктаж на місці", "Координатор говорить українською")}""", "/", "noexp"),
        ("dark", f"""<div class="k">Студентам до 26</div>{h1("Більше на руки — без податку")}
<p class="p">У Польщі студенти до 26 років на umowa zlecenie не платять податок і внески. Шукайте позначку «студентам» у вакансіях.</p>""", "/", "students"),
        ("", f"""<div class="k">Перший день</div>{h1("Як усе відбувається на місці")}<div class="list">
{row(1, "Зустріч із координатором")}{row(2, "Заселення в житло")}{row(3, "Інструктаж з безпеки й медогляд")}{row(4, "Перша зміна з наставником")}</div>""", "/", "firstday"),
    ]


def tip_story(data, idx):
    bank = tips_bank(data)
    cls, body, path, camp = bank[idx % len(bank)]
    body += '<div class="slot"></div>'
    tip = f"Корисна картка.\nСтікер «Посилання»: {utm(path, 'tip_' + camp)}\nТекст на стікері: «Підібрати роботу»"
    return cls, body, tip


# ---------- 3. Інтерактив ----------
POLLS = [
    ("Куди б ви поїхали працювати?", "Опитування (Poll) з 3 варіантами: Польща / Литва / Чехія"),
    ("Ви вже працювали за кордоном?", "Опитування: Так, і не раз / Ще ні, вперше"),
    ("Що для вас важливіше?", "Опитування: Ставка / Житло"),
    ("Скільки на руки з 31,40 зл брутто?", "Вікторина (Quiz): 18 зл / ≈22,70 зл ✓ / 31,40 зл"),
    ("Коли готові виїхати?", "Опитування: Цього тижня / Цього місяця / Пізніше"),
    ("Поставте питання про роботу в Польщі", "Стікер «Запитання» (Questions). Відповіді — наступними сторіс"),
    ("Чи можна брати гроші з кандидата за підбір?", "Вікторина (Quiz): Так, це нормально / Ні, підбір безкоштовний ✓"),
    ("Яка робота вам ближча?", "Опитування: Склад / Завод / Пакування"),
    ("Їдете самі чи з кимось?", "Опитування: Сам(а) / З парою / З другом"),
    ("Наскільки хочете стабільну роботу з житлом?", "Стікер-слайдер з емодзі 🔥"),
]


def poll_story(idx):
    q, how = POLLS[idx % len(POLLS)]
    cls = "dark" if idx % 2 else ""
    body = f"""<div class="k">Ваша думка</div>{h1(q)}<p class="p" style="opacity:.7">Голосуйте — результати покажемо в наступних сторіс</p><div class="slot" style="height:520px"></div>"""
    return cls, body, f"Інтерактив.\nДодайте в рамку: {how}"


async def render(stories, out):
    from playwright.async_api import async_playwright
    out.mkdir(parents=True, exist_ok=True)
    files = []
    async with async_playwright() as p:
        import os
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        pg = await b.new_page(viewport={"width": 1080, "height": 1920})
        for i, (cls, body, _) in enumerate(stories, 1):
            await pg.set_content(f"<style>{CSS}</style><div class='c {cls}' id=x>{LOGO}<div class=body>{body}</div>{FOOT}</div>")
            await pg.evaluate("Promise.all([document.fonts.load('700 50px U','Вз4'),document.fonts.load('800 50px M','Вз4≈✓'),document.fonts.load('600 50px M','Вз4')])")
            await pg.wait_for_timeout(300)
            f = out / f"story-{i}.jpg"
            await pg.locator("#x").screenshot(path=str(f), type="jpeg", quality=93)
            files.append(f)
        await b.close()
    return files


def main():
    ap = argparse.ArgumentParser()
    now = dt.datetime.now()
    ap.add_argument("--day", default=(now.date() + dt.timedelta(days=1 if now.hour >= 18 else 0)).isoformat())
    ap.add_argument("--out", default="stories-out")
    a = ap.parse_args()
    day = dt.date.fromisoformat(a.day)
    idx = (day - START).days
    data = json.loads((ROOT / "vacancies.json").read_text())
    stories = [vacancy_story(data, idx), tip_story(data, idx), poll_story(idx)]
    out = pathlib.Path(a.out)
    asyncio.run(render(stories, out))
    tips = [f"{i}. {s[2]}" for i, s in enumerate(stories, 1)]
    (out / "tips.txt").write_text(
        f"Сторіс на {day.strftime('%d.%m')} — викладайте по черзі, з інтервалом 2–3 години:\n\n" + "\n\n".join(tips))
    print((out / "tips.txt").read_text())


if __name__ == "__main__":
    main()
