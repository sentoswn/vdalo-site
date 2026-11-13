#!/usr/bin/env python3
"""Генератор SEO-сторінок сайту «Вдало».

Запускати після кожного оновлення vacancies.json:
    python3 build.py

Що робить:
  * index.html — головна (оновлює заголовки, статичний список вакансій, SEO-текст);
  * /robota-v-polshchi/ та інші посадкові сторінки під пошукові запити (семантичне ядро);
  * /vakansii/<id>/ — окрема сторінка кожної вакансії з розміткою JobPosting (Google Jobs);
  * sitemap.xml, 404.html, seo-state.json (дати першої появи вакансій).
Шаблон — сам index.html: змінюються лише ділянки між мітками <!--seo:...--> і <!--/seo:...-->.
"""
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
from zoneinfo import ZoneInfo

from articles import ARTICLES
from keywords import vac_keywords, LANGS as KW_LANGS
import i18n

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = "https://vdalo-robota.com.ua"
PHONE_WA = "380736067700"
TG = "https://t.me/+380736067700"
VIBER = "viber://chat?number=%2B380736067700"
NOW = dt.datetime.now(ZoneInfo("Europe/Kyiv"))
TODAY = NOW.date()
MIN_PAGE = 3  # посадкова сторінка створюється, лише якщо на ній є стільки вакансій
NBSP = " "

CC = {"Польща": "PL", "Литва": "LT", "Чехія": "CZ", "Словаччина": "SK", "Німеччина": "DE", "Нідерланди": "NL", "Україна": "UA"}
COUNTRY_IN = {"Польща": "Польщі", "Литва": "Литві", "Чехія": "Чехії", "Словаччина": "Словаччині", "Німеччина": "Німеччині", "Нідерланди": "Нідерландах"}


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def plural(n, a, b, c):
    x, y = n % 10, n % 100
    return a if x == 1 and y != 11 else (b if 2 <= x <= 4 and (y < 10 or y >= 20) else c)


def nvac(n):
    return f"{n} {plural(n, 'вакансія', 'вакансії', 'вакансій')}"


def fmt(n):
    return f"{int(round(n)):,}".replace(",", NBSP)


def fmt_r(n):
    return f"{n:.2f}".replace(".", ",") if n % 1 else fmt(n)


def cur(c):
    c = c.lower()
    if c in ("€", "євро"):
        return "EUR"
    if c == "kč":
        return "CZK"
    if c.startswith("зл"):
        return "PLN"
    return c.upper()


def num(x):
    return float(x.replace(" ", "").replace(NBSP, "").replace(",", "."))


# ---------- Розбір полів (те саме, що робить JS на сторінці) ----------
def g_of(v):
    w = v.get("who") or ""
    if w.startswith("Жінки та чоловіки"):
        return "both"
    if w.startswith("Жінки"):
        return "w"
    if w.startswith("Чоловіки"):
        return "m"
    return "both"


def house(v):
    h, t = v.get("housing") or "", v.get("title") or ""
    if re.search(r"без прожив", t, re.I) or re.search(r"не надається|не передбач|без прожив", h, re.I):
        return ("no", "Без житла")
    if not h:
        return None
    if re.search(r"безкоштовн", h, re.I):
        return ("ok", "Житло безкоштовне")
    if not re.search(r"до працевлаштування", h, re.I):
        m = re.search(r"(\d[\d\s]*(?:[.,]\d+)?)\s*(PLN|EUR|CZK|€|Kč|злотих|зл|євро)", h, re.I)
        if m:
            u = "/міс" if re.search(r"міс|month", h, re.I) else "/доба" if re.search(r"доб|день", h, re.I) else "/тиж." if re.search(r"тиж", h, re.I) else ""
            return ("paid", f"Житло {m.group(1).strip()} {cur(m.group(2))}{u}")
    if re.search(r"оплачу|платн", h, re.I):
        return ("paid", "Житло платне")
    return ("ok", "Житло надається")


def dates(s):
    out = []
    for m in re.finditer(r"(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?", s or ""):
        d, mo = int(m.group(1)), int(m.group(2))
        if not (1 <= d <= 31 and 1 <= mo <= 12):
            continue
        y = (2000 + int(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3))) if m.group(3) else TODAY.year
        try:
            x = dt.date(y, mo, d)
        except ValueError:
            continue
        if not m.group(3) and (x - TODAY).days < -60:
            try:
                x = dt.date(y + 1, mo, d)
            except ValueError:
                continue
        out.append(x)
    return out


def rate(v):
    s = v.get("salary") or ""
    cm = re.search(r"PLN|EUR|CZK|€|Kč", s, re.I)
    if not cm:
        return None
    nums = [num(x) for x in re.findall(r"\d[\d\s]*(?:[.,]\d+)?", s[:cm.start()])]
    nums = [x for x in nums if x > 0][:2]
    if not nums:
        return None
    return {"unit": "год" if re.search(r"год", s, re.I) else "міс", "min": min(nums), "max": max(nums), "cur": cur(cm.group(0))}


def hours(v):
    hm = re.findall(r"\d+", v.get("hours") or "")
    if not hm:
        return None
    h1, h2 = int(hm[0]), int(hm[1] if len(hm) > 1 else hm[0])
    return None if h1 < 120 or h2 > 320 else (h1, h2)


def est(v):
    r, h = v["_rate"], hours(v)
    if not r or r["unit"] != "год" or not h or r["max"] >= 1000:
        return None
    return {"min": round(r["min"] * h[0] / 10) * 10, "max": round(r["max"] * h[1] / 10) * 10, "cur": r["cur"]}


def contract_info(c):
    c = c or ""
    s = c.lower()
    if not c:
        return None
    if re.search(r"zlecen|доручен", s):
        zus, health = bool(re.search(r"pełn|повн|zus", s)), bool(re.search(r"zdrowot|медичн", s))
        full = "Договір доручення (umowa zlecenie)" + (" з повним соцстрахуванням (ZUS)" if zus else ", лише медичне страхування" if health else "")
        if zus:
            note = "Цивільно-правовий договір з оплатою за відпрацьовані години. Сплачуються медичні й пенсійні внески. Оплачуваної відпустки за законом немає."
        elif health:
            note = "Цивільно-правовий договір з оплатою за відпрацьовані години. Є медичне страхування — можна звертатися до лікаря. Оплачуваної відпустки й лікарняних немає."
        else:
            note = "Цивільно-правовий договір з оплатою за відпрацьовані години. Оплачуваної відпустки за законом немає; які внески сплачуються — уточнить менеджер."
        return {"short": "Договір доручення", "ok": False, "full": full, "note": note}
    if re.search(r"o prac|трудов", s):
        temp, pl = bool(re.search(r"tymczas|тимчас", s)), "prac" in s
        full = ("Тимчасовий трудовий договір" if temp else "Трудовий договір") + ((" (umowa o pracę tymczasową)" if temp else " (umowa o pracę)") if pl else "")
        return {"short": "Трудовий договір", "ok": True, "full": full, "note": "Повноцінний трудовий договір: оплачувана відпустка, лікарняні та повне соціальне страхування."}
    return {"short": c, "full": c, "note": "", "ok": False}


RATES = {}
FLAG_CC = {"PL", "LT", "CZ", "SK", "DE", "NL", "UA"}


def uah_info(v):
    n, h = v.get("net"), hours(v)
    if n and RATES.get(n[3]):
        R = RATES[n[3]]
        if n[2] == "міс":
            return {"min": n[0] * R, "max": n[1] * R, "unit": "міс", "net": True, "pre": n[4] or "", "cur": n[3]}
        if h:
            return {"min": n[0] * h[0] * R, "max": n[1] * h[1] * R, "unit": "міс", "net": True, "pre": "", "cur": n[3]}
        return {"min": n[0] * R, "max": n[1] * R, "unit": "год", "net": True, "pre": n[4] or "", "cur": n[3]}
    g = v["_rate"]
    if not g or not RATES.get(g["cur"]):
        return None
    R = RATES[g["cur"]]
    if g["unit"] == "міс":
        return {"min": g["min"] * R, "max": g["max"] * R, "unit": "міс", "net": False, "pre": "", "cur": g["cur"]}
    if v["_est"]:
        return {"min": v["_est"]["min"] * R, "max": v["_est"]["max"] * R, "unit": "міс", "net": False, "pre": "", "cur": g["cur"]}
    return {"min": g["min"] * R, "max": g["max"] * R, "unit": "год", "net": False, "pre": "", "cur": g["cur"]}


def r_uah(x, unit):
    return int(x / 500 + 0.5) * 500 if unit == "міс" else int(x + 0.5)


def uah_range(u):
    a, b = r_uah(u["min"], u["unit"]), r_uah(u["max"], u["unit"])
    return (u["pre"] + " " if u["pre"] else "≈ ") + fmt(a) + ("–" + fmt(b) if b != a else "")


def orig_short(v):
    g = v["_rate"]
    if not g:
        return v.get("salary") or ""
    return fmt_r(g["min"]) + ("–" + fmt_r(g["max"]) if g["max"] != g["min"] else "") + f' {g["cur"]}{"/год" if g["unit"] == "год" else "/міс"} брутто'


def money_html(v):
    u = v.get("_uah")
    if not u:
        return f'<div class="money">{pay_html(v)}</div>'
    return (f'<div class="money"><p class="uah num">{uah_range(u)} <span class="u">грн/{u["unit"]}</span></p>'
            f'<p class="uah-sub">{"<b>на руки</b>" if u["net"] else "до сплати податків"} · {esc(orig_short(v))}</p></div>')


def rate_note(v):
    u = v.get("_uah")
    if not u or not RATES.get(u["cur"]):
        return ""
    d = f' на {esc(RATES["date"])}' if RATES.get("date") else ""
    return f'<p class="rate-note">Перераховано за курсом НБУ{d}: 1 {u["cur"]} = {RATES[u["cur"]]:.2f} грн. Зарплату виплачують у {u["cur"]}.</p>'.replace(f'{RATES[u["cur"]]:.2f}', f'{RATES[u["cur"]]:.2f}'.replace(".", ","))


def flag(cc):
    return f'<svg class="flag" aria-hidden="true"><use href="#f-{cc}"/></svg>' if cc in FLAG_CC else f'<span class="cc">{esc(cc)}</span>'


def card_facts(v):
    t = []
    if v["_h"]:
        k, txt = v["_h"]
        t.append(f'<li class="{"ok" if k == "ok" else ""}"><svg class="i"><use href="#i-home"/></svg>{esc(txt)}</li>')
    if v["_c"]:
        t.append(f'<li class="{"ok" if v["_c"]["ok"] else ""}"><svg class="i"><use href="#i-doc"/></svg>{esc(v["_c"]["short"])}</li>')
    if v["_next"]:
        r = rel(v["_next"])
        t.append(f'<li class="date"><svg class="i"><use href="#i-cal"/></svg>Заїзд {dd(v["_next"])}{" (" + r + ")" if r else ""}</li>')
    if v["_g"] in ("w", "m"):
        t.append(f'<li><svg class="i"><use href="#i-users"/></svg>{"Жінкам" if v["_g"] == "w" else "Чоловікам"}</li>')
    return '<ul class="facts">' + "".join(t) + "</ul>"


def enrich(v):
    v["id"] = str(v["id"])
    v["_g"] = g_of(v)
    v["_h"] = house(v)
    v["_rate"] = rate(v)
    v["_est"] = est(v)
    v["_c"] = contract_info(v.get("contract"))
    v["_cc"] = CC.get(v.get("country"), (v.get("country") or "")[:2].upper())
    ds = sorted(d for d in dates(v.get("trips")) if d >= TODAY)
    v["_next"] = ds[0] if ds else None
    v["_uah"] = uah_info(v)
    v["_txt"] = " ".join(str(v.get(k) or "") for k in ("title", "desc", "about", "company")).lower()
    return v


# ---------- HTML-фрагменти (повторюють розмітку JS) ----------
def dd(d):
    return d.strftime("%d.%m")


def rel(d):
    k = (d - TODAY).days
    return {0: "сьогодні", 1: "завтра", 2: "післязавтра"}.get(k, "")


def pay_html(v):
    g = v["_rate"]
    if not g:
        return f'<p class="pay">{esc(v["salary"])}</p>'
    extra = " + бонус" if re.search(r"бонус|премі", v["salary"], re.I) else ""
    rng = fmt_r(g["min"]) + ("–" + fmt_r(g["max"]) if g["max"] != g["min"] else "")
    m = re.search(r"\((до\s*\d[^)]*)\)", v["salary"])
    return (f'<p class="pay num">{rng} {g["cur"]}<span class="u">{"/год" if g["unit"] == "год" else "/міс"}{extra}</span></p>'
            f'<p class="gross">до сплати податків (брутто){" · " + esc(m.group(1)) if m else ""}</p>')


def net_monthly(v):
    n, h = v.get("net"), hours(v)
    if not n or n[2] != "год" or not h:
        return ""
    return f"≈ {fmt(round(n[0] * h[0] / 10) * 10)}–{fmt(round(n[1] * h[1] / 10) * 10)} {n[3]} за місяць"


def net_html(v):
    n = v.get("net")
    if not n:
        return ""
    t = (n[4] + " " if n[4] else "") + "≈ " + fmt_r(n[0]) + ("–" + fmt_r(n[1]) if n[1] != n[0] else "") + " " + n[3] + ("/год" if n[2] == "год" else "/міс")
    m = net_monthly(v)
    return f'<p class="net num">На руки {t}{"<span>" + m + "</span>" if m else ""}</p>'


def est_html(v):
    e = v["_est"]
    if not e:
        return ""
    return f'<p class="est num">≈ {fmt(e["min"])}{"–" + fmt(e["max"]) if e["max"] != e["min"] else ""} {e["cur"]} за місяць до податків</p>'


def tags_html(v):
    t = []
    if v["_h"]:
        k, txt = v["_h"]
        t.append(f'<li class="tag {"ok" if k == "ok" else "no" if k == "no" else ""}"><svg class="i"><use href="#i-home"/></svg>{esc(txt)}</li>')
    t.append(f'<li class="tag"><svg class="i"><use href="#i-users"/></svg>{esc(v.get("who") or "Жінки та чоловіки")}</li>')
    if v["_c"]:
        t.append(f'<li class="tag{" ok" if v["_c"]["ok"] else ""}"><svg class="i"><use href="#i-doc"/></svg>{esc(v["_c"]["short"])}</li>')
    if v["_next"]:
        r = rel(v["_next"])
        t.append(f'<li class="tag date"><svg class="i"><use href="#i-cal"/></svg>Заїзд {dd(v["_next"])}{" (" + r + ")" if r else ""}</li>')
    return '<ul class="tags">' + "".join(t) + "</ul>"


def vurl(v):
    return f"/vakansii/{v['id']}/"


def loc(v):
    return esc(v.get("country")) + (" · " + esc(v["city"]) if v.get("city") else "")


def stud_html(v, long=False):
    if not v.get("stud") or v.get("country") != "Польща":
        return ""
    txt = ("Студентам до 26 років: можливе звільнення від внесків ZUS за umowa zlecenie після підтвердження статусу студента. "
           "Для осіб до 26 років може застосовуватися пільга PIT. Умови та орієнтовну суму «на руки» уточнюйте в менеджера.") if long else \
          "Студентам до 26: можливе звільнення від внесків ZUS — умови уточнюйте в менеджера"
    return f'<p class="stud"><svg class="i"><use href="#i-grad"/></svg><span>{txt}</span></p>'


def card(v):
    u = vurl(v)
    return ('<article class="vac">'
            f'<div class="vac-top">{flag(v["_cc"])}<span class="loc">{loc(v)}</span>{"<span class=\"badge\">Гаряча</span>" if v.get("hot") else ""}</div>'
            f'<h3><a href="{u}" data-vid="{esc(v["id"])}">{esc(v["title"])}</a></h3>'
            + (f'<p class="co-line"><svg class="i"><use href="#i-bld"/></svg>{esc(v["company"])}</p>' if v.get("company") else "")
            + money_html(v)
            + stud_html(v)
            + card_facts(v)
            + f'<div class="vac-actions"><a class="btn sm ghost" href="{u}" data-vid="{esc(v["id"])}">Детальніше</a><button class="btn sm" type="button" data-apply="{esc(v["id"])}">Відгукнутися</button></div>'
            "</article>")


def sort_list(lst):
    far = dt.date(2100, 1, 1)
    return sorted(lst, key=lambda v: (0 if v.get("hot") else 1, v["_next"] or far))


def grid_html(lst, n=12):
    lst = sort_list(lst)
    if not lst:
        return '<div class="empty">Зараз вакансій у цьому розділі немає. Залиште заявку — підберемо інший варіант.</div>'
    return "".join(card(v) for v in lst[:n])


# ---------- Статистика для текстів ----------
def pct(vals, q):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, max(0, round(q * (len(vals) - 1))))]


def stats(lst):
    s = {"n": len(lst)}
    rs = [v["_rate"] for v in lst if v["_rate"] and v["_rate"]["unit"] == "год"]
    if rs:
        by_cur = {}
        for r in rs:
            by_cur.setdefault(r["cur"], []).append(r)
        c, rr = max(by_cur.items(), key=lambda x: len(x[1]))
        allv = [x for r in rr for x in (r["min"], r["max"])]
        s["rate"] = (pct(allv, .1), pct(allv, .9), c)
    nets = [v["net"] for v in lst if v.get("net") and v["net"][2] == "год"]
    if nets:
        c = max(set(n[3] for n in nets), key=lambda c: sum(1 for n in nets if n[3] == c))
        allv = [x for n in nets if n[3] == c for x in (n[0], n[1])]
        s["net"] = (pct(allv, .1), pct(allv, .9), c)
    us = [v["_uah"] for v in lst if v.get("_uah") and v["_uah"]["unit"] == "міс"]
    nus = [u for u in us if u["net"]]
    pick = nus if len(nus) >= max(3, len(us) // 3) else us
    if pick:
        lo = r_uah(pct([u["min"] for u in pick], .1), "міс")
        hi = r_uah(pct([u["max"] for u in pick], .9), "міс")
        s["uah"] = (lo, hi, pick is nus)
    s["housing"] = sum(1 for v in lst if v["_h"] and v["_h"][0] != "no")
    s["free_housing"] = sum(1 for v in lst if v["_h"] and v["_h"][1] == "Житло безкоштовне")
    s["labor"] = sum(1 for v in lst if v["_c"] and v["_c"]["ok"])
    s["zlec"] = sum(1 for v in lst if v["_c"] and v["_c"]["short"] == "Договір доручення")
    s["stud"] = sum(1 for v in lst if v.get("stud") and v.get("country") == "Польща")
    cities = {}
    for v in lst:
        c = (v.get("city") or "").strip()
        if c and len(c) < 30 and not re.search(r"\d", c):
            cities[c] = cities.get(c, 0) + 1
    s["cities"] = [c for c, _ in sorted(cities.items(), key=lambda x: (-x[1], x[0]))[:6]]
    cos = {}
    for v in lst:
        if v.get("company"):
            cos[v["company"]] = cos.get(v["company"], 0) + 1
    s["companies"] = [c for c, _ in sorted(cos.items(), key=lambda x: (-x[1], x[0]))[:8]]
    countries = {}
    for v in lst:
        countries[v["country"]] = countries.get(v["country"], 0) + 1
    s["countries"] = sorted(countries.items(), key=lambda x: -x[1])
    nx = sorted(v["_next"] for v in lst if v["_next"])
    s["next"] = nx[0] if nx else None
    titles = {}
    for v in lst:
        titles[v["title"]] = titles.get(v["title"], 0) + 1
    s["titles"] = [t for t, _ in sorted(titles.items(), key=lambda x: -x[1])[:6]]
    return s


def rng(t):
    a, b, c = t
    return f"{fmt_r(a)}–{fmt_r(b)} {c}" if a != b else f"{fmt_r(a)} {c}"


def facts_html(s):
    t = []
    if s.get("uah"):
        lo, hi, net = s["uah"]
        t.append(("main", "i-piggy", f"≈ {fmt(lo)}–{fmt(hi)} грн" if hi != lo else f"≈ {fmt(lo)} грн",
                  "на місяць " + ("на руки" if net else "до сплати податків") + " — так зазвичай виходить у наших вакансіях"))
    if s["n"]:
        t.append(("", "i-bld", nvac(s["n"]), f"у {len(s['countries'])} {plural(len(s['countries']), 'країні', 'країнах', 'країнах')} · оновлюємо щодня"))
        t.append(("", "i-home", f"{s['housing']} з {s['n']}", "вакансій із житлом" + (f", у {s['free_housing']} — безкоштовне" if s["free_housing"] else "")))
    if s["next"]:
        t.append(("", "i-cal", dd(s["next"]), "найближчий заїзд"))
    if s["labor"] or s["zlec"]:
        t.append(("", "i-doc", f"{s['labor']} / {s['zlec']}", "трудовий договір / договір доручення"))
    if not t:
        return ""
    return '<div class="facts">' + "".join(
        f'<div class="ft{" ft-main" if k else ""}"><span class="ft-ic"><svg class="i"><use href="#{ic}"/></svg></span><b class="num">{esc(a)}</b><span>{esc(b)}</span></div>'
        for k, ic, a, b in t) + "</div>"


def common_par(s):
    """Абзац із живими цифрами — робить кожну сторінку унікальною й актуальною."""
    p = []
    if s.get("uah"):
        lo, hi, net = s["uah"]
        d = f" на {RATES['date']}" if RATES.get("date") else ""
        p.append(f"Зазвичай {'на руки' if net else 'до сплати податків'} виходить ≈ {fmt(lo)}–{fmt(hi)} грн на місяць (за курсом НБУ{d}; зарплату виплачують у валюті країни)"
                 + (f" — це {rng(s['rate'])} за годину брутто" if s.get("rate") else "")
                 + (f", {rng(s['net'])} за годину на руки" if s.get("net") else "") + ".")
    elif s.get("rate"):
        p.append(f"Типова ставка — {rng(s['rate'])} за годину брутто" + (f", на руки зазвичай {rng(s['net'])} за годину" if s.get("net") else "") + ".")
    if s["n"]:
        p.append(f"Житло пропонують у {s['housing']} {plural(s['housing'], 'вакансії', 'вакансіях', 'вакансіях')} з {s['n']}"
                 + (f", з них безкоштовне — у {s['free_housing']}" if s["free_housing"] else "") + ".")
    if s["labor"] or s["zlec"]:
        p.append(f"Тип договору вказаний у кожній вакансії: трудовий договір — {s['labor']}, договір доручення (umowa zlecenie) — {s['zlec']}.")
    if s["cities"]:
        p.append("\n\nМіста й селища, де зараз є робота: " + ", ".join(s["cities"]) + ".")
    if s["companies"]:
        p.append("Серед роботодавців — " + ", ".join(s["companies"]) + ".")
    return " ".join(p).replace(" \n\n", "\n\n").strip()


# ---------- Семантичне ядро: посадкові сторінки ----------
def rx(pattern):
    r = re.compile(pattern, re.I)
    return lambda v: bool(r.search(v["_txt"]))


PAGES = [
    {"slug": "robota-v-polshchi", "label": "Робота в Польщі", "country": "Польща",
     "match": lambda v: v["country"] == "Польща",
     "title": "Робота в Польщі для українців: {n} | Вдало",
     "h1": "Робота в Польщі для українців",
     "lead": "Вакансії на складах і заводах Польщі з житлом і офіційним договором. У кожній — підприємство, ставка, години, тип договору й дати заїзду.",
     "desc": "Робота в Польщі для українців: {n}, ставка {rate} брутто/год, житло, umowa zlecenie або трудовий договір. Безкоштовно для кандидатів. 073 606 77 00.",
     "text": ["Польща — найпопулярніший напрямок для українців, які шукають роботу за кордоном: багато вакансій на складах, у логістиці та на виробництві, де не потрібне знання польської мови й досвід.",
              "Ставка в Польщі вказується брутто — до сплати податків і внесків. Для осіб до 26 років може діяти пільга з податку PIT, а студенти на договорі доручення можуть не сплачувати внески ZUS — умови залежать від договору й документів. Перед виїздом порівнюйте не тільки ставку, а й кількість годин на місяць, вартість житла й тип договору — усе це є в наших вакансіях."]},
    {"slug": "robota-v-lytvi", "label": "Робота в Литві", "country": "Литва",
     "match": lambda v: v["country"] == "Литва",
     "title": "Робота в Литві для українців: {n} | Вдало",
     "h1": "Робота в Литві для українців",
     "lead": "Вакансії в Литві з житлом: виробництво, переробка риби, склади. Ставка, графік і умови проживання — у кожній вакансії.",
     "desc": "Робота в Литві для українців: {n}, зарплата {rate}, житло й офіційне працевлаштування. Підбір безкоштовний. Telegram, Viber, WhatsApp: 073 606 77 00.",
     "text": ["У Литві українців найчастіше беруть на виробництво, рибопереробку й склади. Зарплату тут зазвичай вказують за місяць у євро, тож суму легко порівняти з іншими країнами.",
              "Литва входить до ЄС і зони євро, а до кордону з Польщею — кілька годин дороги, тому багато хто поєднує ці два напрямки й обирає вакансію з кращими умовами."]},
    {"slug": "robota-v-chekhii", "label": "Робота в Чехії", "country": "Чехія",
     "match": lambda v: v["country"] == "Чехія",
     "title": "Робота в Чехії для українців: {n} | Вдало",
     "h1": "Робота в Чехії для українців",
     "lead": "Вакансії в Чехії: заводи, склади, виробництво. У кожній — ставка, години, житло та найближчі дати заїзду.",
     "desc": "Робота в Чехії для українців: {n}, ставка {rate}, житло та офіційний договір. Безкоштовний підбір вакансії. 073 606 77 00.",
     "text": ["Чехія — один із найстабільніших ринків праці в Європі: багато промислових підприємств і складів, які постійно шукають працівників з України.",
              "Ставки в Чехії вказують у кронах (CZK) або євро. Уточнюйте, скільки годин на місяць пропонує роботодавець і скільки коштує житло, — від цього залежить реальна сума на руки."]},
    {"slug": "robota-v-slovachchyni", "label": "Робота в Словаччині", "country": "Словаччина",
     "match": lambda v: v["country"] == "Словаччина",
     "title": "Робота в Словаччині для українців — {n} | Вдало",
     "h1": "Робота в Словаччині для українців",
     "lead": "Вакансії в Словаччині з житлом і офіційним договором. Ставка, графік і дати заїзду — у кожній вакансії.",
     "desc": "Робота в Словаччині для українців: {n}, зарплата {rate}, житло, офіційне працевлаштування. Підбір безкоштовний. 073 606 77 00.",
     "text": ["Словаччина межує із Закарпаттям, тому дорога туди коротка й недорога. Найчастіше українців запрошують на автомобільні й промислові заводи.",
              "Зарплату в Словаччині вказують у євро. Ми показуємо ставку, години й умови проживання, щоб ви могли порівняти вакансію з пропозиціями в Польщі чи Чехії."]},
    {"slug": "robota-na-skladi", "label": "Робота на складі",
     "match": rx(r"склад|комплектув|пакувальн|логіст|ретрак|навантажувач"),
     "title": "Робота на складі в Польщі та Європі — {n} | Вдало",
     "h1": "Робота на складі за кордоном",
     "lead": "Вакансії працівника складу, комплектувальника й пакувальника в Польщі та інших країнах ЄС. Житло, ставка й дати заїзду — у кожній вакансії.",
     "desc": "Робота на складі в Польщі та Європі: {n} — працівник складу, комплектувальник, пакувальник. Ставка {rate}, житло. Безкоштовно для кандидатів.",
     "text": ["Робота на складі — найпростіший старт за кордоном: досвід і знання мови зазвичай не потрібні, навчання проводять на місці. Працівник складу комплектує й пакує замовлення, сканує товар, обробляє повернення інтернет-магазинів.",
              "На великих логістичних складах працюють позмінно, часто 160–200 годин на місяць. Якщо маєте посвідчення водія навантажувача (UDT), ставка зазвичай вища."]},
    {"slug": "robota-na-vyrobnytstvi", "label": "Робота на заводі",
     "match": rx(r"виробн|завод|оператор|монтаж|монтер|продукц|лінії|чпу|ливарн|робітник|шліфуваль|верстат"),
     "title": "Робота на заводі в Польщі та Європі — {n} | Вдало",
     "h1": "Робота на заводі та виробництві за кордоном",
     "lead": "Вакансії на заводах і виробництвах Польщі, Литви, Чехії та Словаччини: оператор виробництва, збирання, пакування, контроль якості.",
     "desc": "Робота на заводі за кордоном: {n} — оператор виробництва, працівник на лінії, збирання. Ставка {rate}, житло, офіційний договір.",
     "text": ["На виробництві українці найчастіше працюють операторами ліній і верстатів, на збиранні деталей, пакуванні та контролі якості. Для більшості вакансій досвід не потрібен — навчають на місці.",
              "Заводи працюють у 2–3 зміни, тому годин на місяць зазвичай багато, а сума за місяць вища. Для автомобільних і електронних заводів іноді потрібна мінімальна технічна підготовка — це вказано у вимогах вакансії."]},
    {"slug": "robota-na-kharchovomu-vyrobnytstvi", "label": "М’ясне й рибне виробництво",
     "match": lambda v: bool(re.search(r"м[’'`]?яс|(?<![а-яіїєґ])риб|лосос|оселед|харчов|кондитер|пекар|хліб|сирн|ковбас|молоч", (v["title"] + " " + (v.get("desc") or "")).lower())),
     "title": "Робота на м’ясному й рибному виробництві за кордоном | Вдало",
     "h1": "Робота на м’ясному та рибному виробництві",
     "lead": "Вакансії на м’ясокомбінатах, рибопереробці, пекарнях і харчових фабриках Європи. Ставка, житло й дати заїзду — у кожній вакансії.",
     "desc": "Робота на м’ясокомбінаті й рибопереробці за кордоном: {n}, ставка {rate}, житло. Без досвіду. Безкоштовно для кандидатів.",
     "text": ["Харчове виробництво — пакування й фасування м’яса та риби, філетування, зважування й маркування продукції, робота в пекарнях. Тут постійно потрібні люди, а досвід здебільшого не вимагається.",
              "Зважайте на умови: у цехах переробки м’яса й риби прохолодно, робочий одяг видає роботодавець. Для роботи з харчовими продуктами може знадобитися санітарна книжка — менеджер підкаже до виїзду."]},
    {"slug": "vodii-navantazhuvacha", "label": "Водій навантажувача",
     "match": rx(r"навантажувач|ретрак|wózk|udt"),
     "title": "Робота водієм навантажувача за кордоном — {n} | Вдало",
     "h1": "Робота водієм навантажувача за кордоном",
     "lead": "Вакансії оператора вилкового навантажувача й ретрака на складах і заводах Європи. Ставка вища, ніж у звичайного працівника складу.",
     "desc": "Робота водієм навантажувача в Польщі та Європі: {n}, ставка {rate}, житло. Потрібне посвідчення UDT або аналог. 073 606 77 00.",
     "text": ["Водії навантажувачів потрібні на кожному великому складі. Зазвичай роботодавець просить посвідчення на навантажувач (у Польщі — UDT) і досвід роботи, але й платить за це більше.",
              "Якщо українського посвідчення недостатньо, менеджер підкаже, чи можна почати як працівник складу й отримати потрібні права вже на місці."]},
    {"slug": "robota-dlia-zhinok", "label": "Для жінок", "who": "w",
     "match": lambda v: v["_g"] != "m",
     "title": "Робота для жінок за кордоном: {n} | Вдало",
     "h1": "Робота для жінок за кордоном",
     "lead": "Вакансії, куди беруть жінок: пакування, комплектування, легке виробництво, харчові фабрики. Житло й офіційний договір.",
     "desc": "Робота для жінок за кордоном: {n} у Польщі та ЄС — пакувальниця, працівниця складу й виробництва. Ставка {rate}, житло. Безкоштовно.",
     "text": ["Для жінок за кордоном найбільше вакансій на пакуванні, комплектуванні замовлень, легкому виробництві й харчових фабриках. Досвід і знання мови здебільшого не потрібні.",
              "Жінки можуть виїжджати з України без обмежень. Перед поїздкою уточніть, хто живе в кімнаті й скільки людей, — ці деталі є в описі житла кожної вакансії, а решту підкаже менеджер."]},
    {"slug": "robota-dlia-cholovikiv", "label": "Для чоловіків", "who": "m",
     "match": lambda v: v["_g"] != "w",
     "title": "Робота для чоловіків за кордоном: {n} | Вдало",
     "h1": "Робота для чоловіків за кордоном",
     "lead": "Вакансії для чоловіків на складах, заводах і виробництві в Польщі та ЄС. Ставка, житло, тип договору й дати заїзду.",
     "desc": "Робота для чоловіків за кордоном: {n} — склад, завод, навантажувач, виробництво. Ставка {rate}, житло. Безкоштовний підбір.",
     "text": ["Для чоловіків за кордоном є робота на складах, заводах, у металообробці, на навантажувачах і важчих ділянках виробництва — там ставки й кількість годин зазвичай вищі.",
              "Під час воєнного стану чоловіки 18–60 років можуть виїхати лише за наявності законних підстав для перетину кордону. Менеджер підкаже, які вакансії підходять саме вам."]},
    {"slug": "robota-dlia-par", "label": "Для пар", "who": "pair",
     "match": lambda v: v["_g"] == "both",
     "title": "Робота для пар за кордоном — {n} для сімейних пар | Вдало",
     "h1": "Робота для пар за кордоном",
     "lead": "Вакансії, куди беруть і жінок, і чоловіків, — щоб поїхати разом. Про спільне проживання підкаже менеджер.",
     "desc": "Робота для сімейних пар за кордоном: {n} у Польщі та ЄС, де беруть і жінок, і чоловіків. Ставка {rate}, житло. Безкоштовно.",
     "text": ["Поїхати на роботу за кордон парою — зручно: спільні витрати на житло й дорогу, підтримка поруч. У цьому розділі — вакансії, куди беруть і жінок, і чоловіків.",
              "Не всі роботодавці можуть поселити пару в окрему кімнату. Напишіть менеджеру, що їдете парою, — ми підберемо вакансію з відповідним житлом."]},
    {"slug": "robota-v-polshchi-dlia-studentiv", "label": "Для студентів",
     "match": lambda v: v["country"] == "Польща" and bool(v.get("stud")),
     "title": "Робота в Польщі для студентів: вакансії та умови | Вдало",
     "h1": "Робота в Польщі для студентів",
     "lead": "Вакансії в Польщі, де можна працювати студентам. Студенти до 26 років на договорі доручення можуть не сплачувати внески ZUS — умови уточнить менеджер.",
     "desc": "Робота в Польщі для студентів: {n}, ставка {rate} брутто/год. Договір доручення, житло, пільги для осіб до 26 років. Безкоштовно для кандидатів.",
     "text": ["Якщо вам менше 26 років і ваш статус студента підтверджено, за договором доручення (umowa zlecenie) можливе звільнення від внесків ZUS — навчання в Україні саме по собі цьому не заважає. Окремо для осіб до 26 років може застосовуватися пільга з податку PIT у межах річного ліміту 85 528 zł; студентом для неї бути не обов’язково. Результат залежить від договору, документів і податкового резидентства, тому точну суму «на руки» менеджер повідомить після перевірки.", "Зверніть увагу: без внесків за цим договором не нараховується пенсійне й медичне страхування.",
              "Потрібен документ про навчання (студентський квиток або довідка). Менеджер підкаже, які документи підійдуть і як оформити статус у роботодавця."]},
]

HOME = {
    "title": "Робота за кордоном для українців — {n} в Європі | Вдало",
    "desc": "Робота за кордоном для українців: {n} у Польщі, Литві, Чехії та Словаччині. Ставка, житло, договір і дати заїзду в кожній вакансії. Безкоштовно. 073 606 77 00.",
    "text": ["«Вдало» допомагає українцям знайти роботу за кордоном: на складах, заводах і харчових виробництвах Польщі, Литви, Чехії та Словаччини. Для кандидатів підбір безкоштовний.",
             "Ми показуємо умови так, щоб їх можна було порівняти ще до виїзду: ставку брутто й приблизну суму на руки, кількість годин, житло, тип договору та найближчі дати заїзду. Список вакансій оновлюється щодня."],
}


def fill(t, s):
    return t.replace("{n}", nvac(s["n"])).replace("{rate}", rng(s["rate"]) if s.get("rate") else "за домовленістю")


# ---------- Шаблон ----------
def region(src, name, new):
    pat = re.compile(r"(<!--seo:%s-->)(.*?)(<!--/seo:%s-->)" % (name, name), re.S)
    assert pat.search(src), name
    return pat.sub(lambda m: m.group(1) + new + m.group(3), src, count=1)


def get_region(src, name):
    return re.search(r"<!--seo:%s-->(.*?)<!--/seo:%s-->" % (name, name), src, re.S).group(1)


def jsonld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def head(title, desc, path, extra_ld=(), page=None, robots=None):
    url = SITE + path
    h = [f"<title>{esc(title)}</title>",
         f'<meta name="description" content="{esc(desc)}">']
    if robots:
        h.append(f'<meta name="robots" content="{robots}">')
    else:
        h.append(f'<link rel="canonical" href="{url}">')
    h += [f'<meta property="og:title" content="{esc(title)}">',
          f'<meta property="og:description" content="{esc(desc)}">',
          f'<meta property="og:url" content="{url}">']
    h += [jsonld(x) for x in extra_ld]
    if page:
        h.append("<script>window.VDALO_PAGE=" + json.dumps(page, ensure_ascii=False) + ";</script>")
    return "\n" + "\n".join(h) + "\n"


def crumbs(items):
    parts = []
    for i, (name, path) in enumerate(items):
        if i:
            parts.append('<span aria-hidden="true">›</span>')
        parts.append(f'<a href="{path}">{esc(name)}</a>' if path and i < len(items) - 1 else f"<span>{esc(name)}</span>")
    return '<nav class="crumbs" aria-label="Навігація">' + "".join(parts) + "</nav>"


def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (n, p) in enumerate(items)]}


def links_html(live, current=None):
    a = [f'<a href="/"{" aria-current=\"page\"" if current == "" else ""}>Усі вакансії</a>']
    for p, lst in live:
        a.append(f'<a href="/{p["slug"]}/"{" aria-current=\"page\"" if current == p["slug"] else ""}>{esc(p["label"])} · {len(lst)}</a>')
    return '<div class="links">' + "".join(a) + "</div>"


def text_section(h2, paras, s, live, current):
    body = "".join(f"<p>{esc(q.strip())}</p>" for p in paras if p for q in p.split("\n\n") if q.strip())
    fx = facts_html(s) if s else ""
    return ('\n  <section aria-labelledby="seo-h"><div class="seo">'
            f'<div class="seo-grid{" has-f" if fx else ""}"><div class="seo-txt"><h2 id="seo-h">{esc(h2)}</h2>{body}</div>{fx}</div>'
            + f'<h3 style="margin-top:26px">Інші напрямки</h3>{links_html(live, current)}'
            "</div></section>\n  ")


def foot_links(live):
    arts = '<div class="links" style="margin-top:6px"><a href="/statti/">Усі статті</a>' + "".join(f'<a href="/statti/{a["slug"]}/">{esc(a["h1"])}</a>' for a in ARTICLES) + "</div>"
    return ('\n  <div class="flinks"><b>Робота за кордоном</b>' + links_html(live).replace('class="links"', 'class="links" style="margin-top:6px"')
            + '<b style="display:block;margin-top:16px">Корисні статті</b>' + arts + "</div>\n  ")


def h1_block(h1, lead):
    return f"\n      <h1>{esc(h1)}</h1>\n      <p class=\"lead\">{esc(lead)}</p>\n      "


ORG = {"@context": "https://schema.org", "@type": "EmploymentAgency", "name": "Вдало", "url": SITE + "/",
       "image": SITE + "/og.png", "telephone": "+380736067700", "areaServed": "UA",
       "address": {"@type": "PostalAddress", "streetAddress": "вул. Джона Маккейна, 7, офіс 169", "addressLocality": "Київ", "addressCountry": "UA"},
       "description": "Підбір роботи для українців у Польщі, Литві, Чехії та Словаччині. Безкоштовно для кандидатів."}


# ---------- Сторінка вакансії ----------
def vac_rows(v):
    c = v["_c"]
    rows = [("Для кого", v.get("who")), ("Годин на місяць", v.get("hours")), ("Графік", v.get("schedule")), ("Нічні зміни", v.get("night")),
            ("Житло", v.get("housing")), ("Харчування", v.get("food")), ("Доїзд до роботи", v.get("transport")),
            ("Договір", {"html": esc(c["full"]) + (f"<small>{esc(c['note'])}</small>" if c["note"] else "")} if c else None),
            ("Вимоги", v.get("req")), ("Бонуси", v.get("perks")), ("Дати заїзду", v.get("trips"))]
    return [(k, x) for k, x in rows if x]


def vac_msg(v):
    return (f"Вітаю! Мене цікавить вакансія №{v['id']} «{v['title']}»" + (f" у компанії {v['company']}" if v.get("company") else "")
            + f" ({v['country']}" + (f", {v['city']}" if v.get("city") else "") + "). Підкажіть, будь ласка, деталі.")


def kw_html(v):
    kw = vac_keywords(v)
    rows = "".join(f'<div class="kw-row"><span class="kw-l">{lab}</span><span class="kw-w">{esc(", ".join(kw[l]))}</span></div>' for l, lab in KW_LANGS if kw[l])
    return f'<div class="kw"><b>Ключові слова</b>{rows}</div>' if rows else ""


def vac_detail(v, back):
    from urllib.parse import quote
    msg = vac_msg(v)
    dl = "".join(f"<dt>{k}</dt><dd>{x['html'] if isinstance(x, dict) else esc(x)}</dd>" for k, x in vac_rows(v))
    note = ("Точна сума на руки залежить від вашого податкового статусу — менеджер пояснить." if v.get("net")
            else "Брутто — це сума до сплати податків. На руки зазвичай приблизно на 15–30% менше — точну суму підкаже менеджер.")
    stud = stud_html(v, True)
    return (crumbs([("Головна", "/"), (back[0], back[1]), (v["title"], "")])
            + '\n  <section class="vpage" id="hero">'
            '<article class="vbox">'
            f'<div class="vac-top">{flag(v["_cc"])}<span class="loc">{loc(v)}</span>{"<span class=\"badge\">Гаряча</span>" if v.get("hot") else ""}</div>'
            f'<h1>{esc(v["title"])}' + (f" — {esc(v['city'])}" if v.get("city") and len(v["city"]) < 30 else "") + "</h1>"
            + (f'<p class="co-line" style="margin-top:10px"><svg class="i"><use href="#i-bld"/></svg>{esc(v["company"])}</p>' if v.get("company") else "")
            + f'<div class="m-pay">{(money_html(v) + "<div class=\"m-break\">") if v.get("_uah") else "<div>"}{pay_html(v)}{est_html(v)}{net_html(v)}</div>{rate_note(v)}{stud}<p class="m-note">{note}</p></div>'
            + f'<div style="margin-top:14px">{tags_html(v)}</div>'
            + (f'<p class="m-desc">{esc(v["desc"])}</p>' if v.get("desc") else "")
            + (f'<div class="m-about"><b><svg class="i"><use href="#i-bld"/></svg>{"Про компанію " + esc(v["company"]) if v.get("company") else "Про компанію"}</b><p>{esc(v["about"])}</p></div>' if v.get("about") else "")
            + f'<dl class="m-dl">{dl}</dl>'
            + kw_html(v)
            + f'<div class="m-foot"><span>Вакансія №{esc(v["id"])} · актуальна на {TODAY.strftime("%d.%m.%Y")}</span><button class="linkbtn" type="button" data-share="{esc(v["id"])}">Скопіювати посилання</button></div>'
            "</article>"
            '<aside class="side">'
            "<h2>Відгукнутися на вакансію</h2>"
            '<p style="color:var(--muted)">Безкоштовно для кандидатів. Залиште заявку або напишіть нам — текст повідомлення вже готовий.</p>'
            f'<button class="btn wide" type="button" data-apply="{esc(v["id"])}">Залишити заявку</button>'
            '<div class="send-row">'
            f'<a class="msgr" href="https://wa.me/{PHONE_WA}?text={quote(msg)}" data-ch="whatsapp"><span class="dot wa"></span>WhatsApp</a>'
            f'<a class="msgr" href="{TG}" data-ch="telegram" data-copytext="{esc(msg)}"><span class="dot tg"></span>Telegram</a>'
            f'<a class="msgr" href="{VIBER}" data-ch="viber" data-copytext="{esc(msg)}"><span class="dot vb"></span>Viber</a>'
            "</div>"
            '<a class="btn ghost wide" href="tel:+380736067700" data-ch="phone">Подзвонити: 073 606 77 00</a>'
            "</aside>"
            "</section>\n  ")


def city_ok(c):
    return bool(c) and len(c) < 40 and not re.search(r"\d|км|район|біля|околиц", c, re.I)


def job_ld(v, posted):
    desc_parts = [f"<p>{esc(v.get('desc') or v['title'])}</p>"]
    if v.get("about"):
        desc_parts.append(f"<p>{esc(v['about'])}</p>")
    desc_parts.append("<ul>" + "".join(f"<li>{k}: {esc(x if not isinstance(x, dict) else v['_c']['full'])}</li>" for k, x in [("Зарплата", v["salary"])] + vac_rows(v)) + "</ul>")
    addr = {"@type": "PostalAddress", "addressCountry": v["_cc"]}
    if city_ok(v.get("city")):
        addr["addressLocality"] = v["city"]
    o = {"@context": "https://schema.org", "@type": "JobPosting",
         "title": v["title"], "description": "".join(desc_parts),
         "datePosted": posted,
         "hiringOrganization": {"@type": "Organization", "name": v["company"]} if v.get("company") else {"@type": "Organization", "name": "confidential"},
         "jobLocation": {"@type": "Place", "address": addr},
         "employmentType": ["FULL_TIME", "TEMPORARY"] if v["_c"] and "Тимчасовий" in v["_c"]["full"] else "FULL_TIME",
         "identifier": {"@type": "PropertyValue", "name": "Вдало", "value": v["id"]},
         "directApply": True,
         "url": SITE + vurl(v)}
    r = v["_rate"]
    if r:
        val = {"@type": "QuantitativeValue", "unitText": "HOUR" if r["unit"] == "год" else "MONTH"}
        if r["min"] != r["max"]:
            val.update(minValue=r["min"], maxValue=r["max"])
        else:
            val["value"] = r["min"]
        o["baseSalary"] = {"@type": "MonetaryAmount", "currency": r["cur"], "value": val}
    if v.get("hours"):
        o["workHours"] = f"{v['hours']} год на місяць"
    return o


def vac_desc(v):
    bits = []
    r = v["_rate"]
    if r:
        bits.append(f"{fmt_r(r['min'])}{'–' + fmt_r(r['max']) if r['max'] != r['min'] else ''} {r['cur']}/{'год' if r['unit'] == 'год' else 'міс'} брутто")
    if v["_h"]:
        bits.append(v["_h"][1].lower())
    if v["_c"]:
        bits.append(v["_c"]["short"].lower())
    if v.get("hours"):
        bits.append(f"{v['hours']} год/міс")
    if v["_next"]:
        bits.append(f"заїзд {dd(v['_next'])}")
    head_ = f"{v['title']}" + (f" у {v['company']}" if v.get("company") else "") + f", {v['country']}" + (f", {v['city']}" if city_ok(v.get("city")) else "")
    d = head_ + ": " + ", ".join(bits) + ". Безкоштовно для кандидатів."
    return d if len(d) <= 300 else d[:297] + "…"


# ---------- Збирання ----------
WRITTEN = []


def write(path, text):
    WRITTEN.append(path)
    full = os.path.join(ROOT, path.strip("/"), "index.html") if path.endswith("/") and path != "/" else os.path.join(ROOT, path.strip("/") or "index.html")
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


def fetch_rates():
    """Курс НБУ (грн за 1 PLN/EUR/CZK). Повертає None, якщо сайт НБУ недоступний."""
    import urllib.request
    try:
        req = urllib.request.Request("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json", headers={"User-Agent": "vdalo-build"})
        rows = json.load(urllib.request.urlopen(req, timeout=20))
        r = {x["cc"]: round(float(x["rate"]), 4) for x in rows if x.get("cc") in ("PLN", "EUR", "CZK")}
        if len(r) == 3:
            r["date"] = next(x["exchangedate"] for x in rows if x.get("cc") == "PLN")
            return r
    except Exception as e:  # noqa: BLE001
        print("NBU rates unavailable:", e)
    return None


def article_card(a, tag="h3"):
    return (f'<a class="acard" href="/statti/{a["slug"]}/"><{tag}>{esc(a["h1"])}</{tag}>'
            f'<p>{esc(a["lead"])}</p><span>Читати · {esc(a["read"])}</span></a>')


def article_page(a):
    from urllib.parse import quote
    src = ""
    if a.get("sources"):
        src = ('<div class="src"><b>Джерела</b> (станом на ' + esc(a["updated"]) + "):<br>"
               + "<br>".join(f'<a href="{esc(u)}" target="_blank" rel="noopener nofollow">{esc(t)}</a>' for t, u in a["sources"]) + "</div>")
    msg = "Вітаю! Прочитав(ла) статтю «" + a["h1"] + "» на сайті. Хочу підібрати роботу."
    others = [x for x in ARTICLES if x["slug"] != a["slug"]][:3]
    return (crumbs([("Головна", "/"), ("Статті", "/statti/"), (a["h1"], "")])
            + '\n  <section class="vpage" id="hero">'
            '<article class="vbox art">'
            f'<h1>{esc(a["h1"])}</h1>'
            f'<div class="art-meta"><span>Оновлено {esc(a["updated"])}</span><span>Читати {esc(a["read"])}</span></div>'
            f'<p class="lead">{esc(a["lead"])}</p>'
            + a["body"] + src +
            "</article>"
            '<aside class="side">'
            "<h2>Підберемо роботу безкоштовно</h2>"
            '<p style="color:var(--muted)">Залиште заявку або напишіть нам — менеджер відповість і пояснить усе щодо документів і дороги.</p>'
            '<button class="btn wide" type="button" data-apply="">Залишити заявку</button>'
            '<div class="send-row">'
            f'<a class="msgr" href="https://wa.me/{PHONE_WA}?text={quote(msg)}" data-ch="whatsapp"><span class="dot wa"></span>WhatsApp</a>'
            f'<a class="msgr" href="{TG}" data-ch="telegram" data-copytext="{esc(msg)}"><span class="dot tg"></span>Telegram</a>'
            f'<a class="msgr" href="{VIBER}" data-ch="viber" data-copytext="{esc(msg)}"><span class="dot vb"></span>Viber</a>'
            "</div>"
            '<a class="btn ghost wide" href="/#vacancies">Переглянути вакансії</a>'
            + ("<h3 style=\"margin-top:10px\">Інші статті</h3>" + "".join(f'<a href="/statti/{x["slug"]}/" style="font-weight:700">{esc(x["h1"])}</a>' for x in others) if others else "")
            + "</aside>"
            "</section>\n  ")


def article_ld(a, path):
    d = "-".join(reversed(a["updated"].split(".")))
    return {"@context": "https://schema.org", "@type": "Article", "headline": a["h1"], "description": a["desc"],
            "inLanguage": "uk", "dateModified": d, "mainEntityOfPage": SITE + path,
            "author": {"@type": "Organization", "name": "Вдало", "url": SITE + "/"},
            "publisher": {"@type": "Organization", "name": "Вдало", "url": SITE + "/"}}


def main():
    tpl = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    vp = os.path.join(ROOT, "vacancies.json")
    data = json.load(open(vp, encoding="utf-8"))
    # курс гривні: свіжий з НБУ, інакше — останній збережений (rates.json)
    rp = os.path.join(ROOT, "rates.json")
    rates = fetch_rates() or data.get("rates") or (json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else None)
    if rates:
        json.dump(rates, open(rp, "w", encoding="utf-8"), ensure_ascii=False)
        if data.get("rates") != rates:
            data["rates"] = rates
            json.dump(data, open(vp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    RATES.clear()
    RATES.update(data.get("rates") or {})
    items = [enrich(v) for v in data.get("items", []) if v and v.get("title") and v.get("salary")]
    by_id = {v["id"]: v for v in items}
    # ключові слова 4 мовами для пошуку на сайті
    json.dump({str(v["id"]): " ".join(w for ws in vac_keywords(v).values() for w in ws) for v in items},
              open(os.path.join(ROOT, "keywords.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # стан: дата першої появи / зміни кожної вакансії
    sp = os.path.join(ROOT, "seo-state.json")
    state = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {}
    new_state = {}
    for v in items:
        hsh = hashlib.md5(json.dumps({k: x for k, x in v.items() if not k.startswith("_")}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
        old = state.get(v["id"], {})
        new_state[v["id"]] = {"first": old.get("first", TODAY.isoformat()), "mod": old.get("mod", TODAY.isoformat()) if old.get("hash") == hsh else TODAY.isoformat(), "hash": hsh}

    live = []
    for p in PAGES:
        lst = [v for v in items if p["match"](v)]
        if len(lst) >= MIN_PAGE:
            live.append((p, lst))
    sitemap = [("/", TODAY.isoformat(), "daily", "1.0")]

    # спільний підвал зі списком напрямків
    tpl = region(tpl, "foot", foot_links(live))
    hero_tpl = get_region(tpl, "hero")

    # головна
    s = stats(items)
    home = region(tpl, "head", head(fill(HOME["title"], s), fill(HOME["desc"], s), "/",
                                   [ORG, {"@context": "https://schema.org", "@type": "WebSite", "name": "Вдало", "url": SITE + "/", "inLanguage": "uk"}]))
    home = region(home, "hero", hero_tpl)
    home = region(home, "vach", "Актуальні вакансії")
    home = region(home, "grid", grid_html(items))
    home = region(home, "text", text_section("Робота за кордоном для українців", HOME["text"] + [common_par(s)], s, live, ""))
    write("index.html", home)

    # посадкові сторінки
    for p, lst in live:
        s = stats(lst)
        path = f"/{p['slug']}/"
        cr = [("Головна", "/"), (p["h1"], path)]
        page = {"ids": [v["id"] for v in lst]}
        if p.get("country"):
            page = {"country": p["country"]}
        if p.get("who"):
            page = {"who": p["who"]}
        t = region(tpl, "head", head(fill(p["title"], s), fill(p["desc"], s), path, [crumbs_ld(cr)], page))
        hero = region(hero_tpl, "h1", h1_block(p["h1"], p["lead"]))
        t = region(t, "hero", "\n  " + crumbs(cr) + hero)
        t = region(t, "vach", f"Вакансії: {p['label'].lower() if not p.get('country') else p['h1'].lower()}")
        t = region(t, "grid", grid_html(lst))
        t = region(t, "text", text_section(p["h1"], p["text"] + [common_par(s)], s, live, p["slug"]))
        write(path, t)
        sitemap.append((path, TODAY.isoformat(), "daily", "0.9"))

    # сторінки вакансій
    vdir = os.path.join(ROOT, "vakansii")
    if os.path.isdir(vdir):
        shutil.rmtree(vdir)  # закриті вакансії зникають (404) — так вимагає Google Jobs
    country_page = {p["country"]: p for p, _ in live if p.get("country")}
    for v in items:
        cp = country_page.get(v["country"])
        back = (cp["h1"], f"/{cp['slug']}/") if cp else ("Усі вакансії", "/")
        path = vurl(v)
        cr = [("Головна", "/"), back, (v["title"], path)]
        similar = [x for x in items if x["country"] == v["country"] and x["id"] != v["id"]]
        st_ = new_state[v["id"]]
        title = f"{v['title']}" + (f" — {v['city']}" if city_ok(v.get("city")) else "") + f", {v['country']} | Вдало"
        t = region(tpl, "head", head(title, vac_desc(v), path, [job_ld(v, st_["first"]), crumbs_ld(cr)],
                                     {"ids": [x["id"] for x in similar], "vac": v["id"]}))
        t = region(t, "hero", "\n  " + vac_detail(v, back))
        t = region(t, "vach", f"Схожі вакансії — {COUNTRY_IN.get(v['country'], v['country'])}" if v["country"] in COUNTRY_IN else "Схожі вакансії")
        t = region(t, "grid", grid_html(similar))
        t = region(t, "text", text_section("Шукаєте інші варіанти?", [], None, live, None))
        write(path, t)
        sitemap.append((path, st_["mod"], "daily", "0.7"))

    # статті
    hot = sort_list(items)[:12]
    sdir = os.path.join(ROOT, "statti")
    if os.path.isdir(sdir):
        shutil.rmtree(sdir)
    for a in ARTICLES:
        path = f"/statti/{a['slug']}/"
        cr = [("Головна", "/"), ("Статті", "/statti/"), (a["h1"], path)]
        t = region(tpl, "head", head(a["title"], a["desc"], path, [article_ld(a, path), crumbs_ld(cr)], {"ids": [v["id"] for v in hot]}))
        t = region(t, "hero", "\n  " + article_page(a))
        t = region(t, "vach", "Вакансії, відкриті зараз")
        t = region(t, "grid", grid_html(hot))
        t = region(t, "text", text_section("Напрямки", [], None, live, None))
        write(path, t)
        sitemap.append((path, "-".join(reversed(a["updated"].split("."))), "monthly", "0.6"))
    path = "/statti/"
    cr = [("Головна", "/"), ("Статті", path)]
    t = region(tpl, "head", head("Статті про роботу за кордоном для українців | Вдало",
                                 "Корисні гайди: документи для роботи в Польщі, договір доручення чи трудовий, як не потрапити до шахраїв, що взяти в дорогу.",
                                 path, [crumbs_ld(cr)], {"ids": [v["id"] for v in hot]}))
    t = region(t, "hero", "\n  " + crumbs([("Головна", "/"), ("Статті", "")])
               + '\n  <section id="hero"><div class="statti-head"><h1>Статті про роботу за кордоном</h1><p>Простими словами про документи, договори, дорогу й безпеку — щоб ви їхали підготовленими.</p></div>'
               + '<div class="alist">' + "".join(article_card(a, "h2") for a in ARTICLES) + "</div></section>\n  ")
    t = region(t, "vach", "Вакансії, відкриті зараз")
    t = region(t, "grid", grid_html(hot))
    t = region(t, "text", text_section("Напрямки", [], None, live, None))
    write(path, t)
    sitemap.append((path, TODAY.isoformat(), "weekly", "0.6"))

    # 404 — для закритих вакансій і старих посилань
    t = region(tpl, "head", head("Сторінку не знайдено | Вдало", "Можливо, вакансію вже закрито. Перегляньте актуальні вакансії.", "/404.html", (), None, robots="noindex"))
    t = region(t, "hero", region(hero_tpl, "h1", h1_block("Цю вакансію вже закрито", "Або сторінку перенесено. Нижче — актуальні вакансії, оновлені сьогодні. Можна також залишити заявку — підберемо схожу.")))
    t = region(t, "vach", "Актуальні вакансії")
    t = region(t, "grid", grid_html(items))
    t = region(t, "text", text_section("Напрямки", [], None, live, None))
    write("404.html", t)

    # видалити посадкові сторінки, які зараз порожні
    for p in PAGES:
        if p not in [x for x, _ in live]:
            d = os.path.join(ROOT, p["slug"])
            if os.path.isdir(d):
                shutil.rmtree(d)

    # ---------- мовні версії /ru/ /en/ /pl/ ----------
    def page_file(p):
        return os.path.join(ROOT, p.strip("/"), "index.html") if p.endswith("/") and p != "/" else os.path.join(ROOT, p.strip("/") or "index.html")
    uk_pages = ["/" if p == "index.html" else p for p in dict.fromkeys(WRITTEN)]
    segs = set(i18n.vacancy_segments(items))
    js = set()
    for p in uk_pages:
        h = open(page_file(p), encoding="utf-8").read()
        segs |= i18n.segments_from_html(h)
        if p == "/":
            js = i18n.js_literals(h)
    segs |= js
    months = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"]
    os.makedirs(i18n.DICT_DIR, exist_ok=True)
    json.dump(sorted(segs), open(os.path.join(i18n.DICT_DIR, "_segments.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    rt_keys = js | set(i18n.vacancy_segments(items)) | set(months) | {"Заїзд", "І", "О", "Н", "Л", "Т", "М", "В", "Ю", "Г", "НП", "А", "С", "К", "Р", "Брно", "Вроцлава", "Гданська", "Лодзі", "Любіна", "Острави", "Пльзеня", "Познані"}
    for p in uk_pages:  # hreflang і на українських сторінках
        if p == "404.html":
            continue
        f = page_file(p)
        h = open(f, encoding="utf-8").read()
        h = re.sub(r'\n<link rel="alternate" hreflang="[^"]*" href="[^"]*">', "", h)
        h = re.sub(r'(<link rel="canonical" href="[^"]*">)', lambda m: m.group(1) + "\n" + i18n.alternates(p, SITE), h, count=1)
        open(f, "w", encoding="utf-8").write(h)
    for lang in i18n.LANGS:
        d = i18n.load(lang)
        tr = i18n.Tr(d, lang)
        ldir = os.path.join(ROOT, lang)
        if os.path.isdir(ldir):
            shutil.rmtree(ldir)
        os.makedirs(ldir)
        json.dump({"d": i18n.runtime_dict(d, rt_keys), "r": [[rx, rep.replace("\\", "$"), i in i18n.PRE] for i, (rx, rep) in enumerate((r, x[lang]) for r, x in i18n.RULES if lang in x)]},
                  open(os.path.join(ldir, "i18n.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        for p in uk_pages:
            if p == "404.html":
                continue
            h = open(page_file(p), encoding="utf-8").read()
            out = i18n.translate_html(h, lang, p, SITE, tr)
            f = os.path.join(ldir, p.strip("/"), "index.html") if p != "/" else os.path.join(ldir, "index.html")
            os.makedirs(os.path.dirname(f), exist_ok=True)
            open(f, "w", encoding="utf-8").write(out)
    for path, lm, cf, pr in list(sitemap):
        for lang in i18n.LANGS:
            sitemap.append(("/" + lang + path, lm, cf, pr))

    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, lm, cf, pr in sitemap:
        sm.append(f"  <url><loc>{SITE}{path}</loc><lastmod>{lm}</lastmod><changefreq>{cf}</changefreq><priority>{pr}</priority></url>")
    sm.append("</urlset>")
    open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(sm) + "\n")
    json.dump(new_state, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    print(f"OK: головна + {len(live)} посадкових + {len(items)} сторінок вакансій; sitemap: {len(sitemap)} URL")
    for p, lst in live:
        print(f"  /{p['slug']}/  {len(lst)}")


if __name__ == "__main__":
    main()
