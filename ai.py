#!/usr/bin/env python3
"""Видимість сайту для ІІ-асистентів (ChatGPT, Claude, Perplexity, Gemini, Copilot тощо).

Запускається після build.py:  python3 ai.py
Створює:
  * /llms.txt       — короткий опис сайту й карта головних сторінок (стандарт llmstxt.org);
  * /llms-full.txt  — повний текст: усі актуальні вакансії, часті питання, статті;
  * /robots.txt     — явний дозвіл пошуковим та ІІ-роботам, посилання на sitemap.
"""
import html
import json
import os
import re

import build as B
from articles import ARTICLES

ROOT = B.ROOT
SITE = B.SITE
TODAY = B.TODAY

AI_BOTS = [
    # OpenAI (ChatGPT, пошук ChatGPT)
    "GPTBot", "OAI-SearchBot", "ChatGPT-User",
    # Anthropic (Claude)
    "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai",
    # Perplexity
    "PerplexityBot", "Perplexity-User",
    # Google (Gemini, AI Overviews), Apple, Microsoft
    "Googlebot", "Google-Extended", "Applebot", "Applebot-Extended", "Bingbot",
    # Meta AI, Amazon, DuckDuckGo, Mistral, Cohere, You.com, Common Crawl
    "meta-externalagent", "meta-externalfetcher", "FacebookBot", "Amazonbot", "DuckAssistBot",
    "MistralAI-User", "cohere-ai", "cohere-training-data-crawler", "YouBot", "CCBot",
    # Інші пошукові системи (Bing/Yandex/Seznam отримують IndexNow)
    "YandexBot", "SeznamBot",
]


def txt(h):
    """HTML → простий текст / markdown."""
    h = re.sub(r"<h2[^>]*>(.*?)</h2>", r"\n\n### \1\n", h, flags=re.S)
    h = re.sub(r"<h3[^>]*>(.*?)</h3>", r"\n\n#### \1\n", h, flags=re.S)
    h = re.sub(r"<li[^>]*>", "\n- ", h)
    h = re.sub(r"</p>|<br\s*/?>|</div>|</tr>", "\n", h)
    h = re.sub(r"<t[dh][^>]*>", " | ", h)
    h = re.sub(r"<b>|</b>|<strong>|</strong>", "**", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h).replace(B.NBSP, " ")
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r"\n\s*\n\s*\n+", "\n\n", h)
    return "\n".join(l.strip() for l in h.splitlines()).strip()


def faq():
    p = os.path.join(ROOT, "pytannia", "index.html")
    if not os.path.exists(p):
        return []
    for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', open(p, encoding="utf-8").read(), re.S):
        d = json.loads(m.replace("<\\/", "</"))
        if d.get("@type") == "FAQPage":
            return [(q["name"], txt(q["acceptedAnswer"]["text"])) for q in d["mainEntity"]]
    return []


def pay(v):
    r = v["_rate"]
    out = []
    if r:
        out.append(f"{B.fmt_r(r['min'])}{'–' + B.fmt_r(r['max']) if r['max'] != r['min'] else ''} {r['cur']}/{'год' if r['unit'] == 'год' else 'міс'} брутто")
    else:
        out.append(v.get("salary", ""))
    n = v.get("net")
    if n:
        out.append(f"на руки ≈ {B.fmt_r(n[0])}{'–' + B.fmt_r(n[1]) if n[1] != n[0] else ''} {n[3]}/{'год' if n[2] == 'год' else 'міс'}")
    m = B.net_monthly(v)
    if m:
        out.append(m)
    return "; ".join(out).replace(B.NBSP, " ")


def vac_md(v):
    head = f"### {v['title']}" + (f" — {v['company']}" if v.get("company") else "")
    rows = [("Країна / місто", v["country"] + (f", {v['city']}" if v.get("city") else "")), ("Оплата", pay(v))]
    if v["_h"]:
        rows.append(("Житло", v["_h"][1] + (f" ({v['housing']})" if v.get("housing") and 25 < len(v["housing"]) < 120 else "")))
    for k, label in (("who", "Для кого"), ("hours", "Годин на місяць"), ("schedule", "Графік"), ("food", "Харчування"), ("transport", "Доїзд")):
        if v.get(k):
            rows.append((label, v[k]))
    if v["_c"]:
        rows.append(("Договір", v["_c"]["full"]))
    if v.get("stud") and v["country"] == "Польща":
        rows.append(("Студентам до 26 років", "вся ставка на руки, без податку"))
    if v.get("trips"):
        rows.append(("Дати заїзду", v["trips"]))
    if v.get("desc"):
        rows.append(("Обов'язки", v["desc"]))
    if v.get("req"):
        rows.append(("Вимоги", v["req"]))
    rows.append(("Сторінка вакансії", SITE + B.vurl(v)))
    return head + "\n" + "\n".join(f"- {k}: {x}" for k, x in rows)


def main():
    data = json.load(open(os.path.join(ROOT, "vacancies.json"), encoding="utf-8"))
    items = [B.enrich(v) for v in data.get("items", []) if v and v.get("title") and v.get("salary")]
    live = [(p, [v for v in items if p["match"](v)]) for p in B.PAGES]
    live = [(p, l) for p, l in live if len(l) >= B.MIN_PAGE]
    s = B.stats(items)
    by_c = {}
    for v in items:
        by_c.setdefault(v["country"], []).append(v)
    date = TODAY.strftime("%d.%m.%Y")
    qa = faq()

    intro = (
        "# Вдало (Vdalo) — робота за кордоном для українців\n\n"
        f"> «Вдало» (vdalo-robota.com.ua) — сервіс підбору роботи для українців у Польщі, Литві, Чехії та Словаччині: склади, заводи, харчові виробництва. "
        f"Зараз {B.nvac(s['n'])}, список оновлюється щодня (останнє оновлення {date}). Для кандидатів підбір безкоштовний.\n\n"
        "English summary: Vdalo is a Ukrainian job-matching service that helps Ukrainians find work in Poland, Lithuania, the Czech Republic and Slovakia "
        "(warehouses, factories, food production). Free for candidates. Each listing shows the employer, hourly/monthly pay (gross and estimated net), "
        "hours, housing, contract type and next start dates. Site languages: Ukrainian (main), Russian (/ru/), English (/en/), Polish (/pl/).\n\n"
        "## Ключові факти\n"
        "- Для кандидатів безкоштовно: «Вдало» не бере грошей за працевлаштування.\n"
        "- Контакти: телефон, Telegram, Viber, WhatsApp — +380 73 606 77 00. Офіс: м. Київ, вул. Джона Маккейна, 7, офіс 169.\n"
        "- Заявку можна залишити на сайті (форма «Залишити заявку») або написати в месенджер — менеджер підбере вакансію.\n"
        f"- Країни: " + ", ".join(f"{c} ({len(l)})" for c, l in sorted(by_c.items(), key=lambda x: -len(x[1]))) + ".\n"
        + (f"- Типова ставка: {B.rng(s['rate'])} за годину брутто" + (f"; на руки зазвичай {B.rng(s['net'])} за годину" if s.get("net") else "") + ".\n" if s.get("rate") else "")
        + f"- Житло пропонують у {s['housing']} вакансіях з {s['n']}; трудовий договір — {s['labor']}, договір доручення (umowa zlecenie) — {s['zlec']}.\n"
        + (f"- Серед роботодавців: {', '.join(s['companies'])}.\n" if s["companies"] else "")
        + "- Дані вакансій у машиночитаному вигляді: " + SITE + "/vacancies.json. Кожна сторінка вакансії має розмітку schema.org/JobPosting.\n"
    ).replace(B.NBSP, " ")

    pages = ["## Головні сторінки",
             f"- [Усі вакансії]({SITE}/): актуальний список із фільтрами за країною, статтю й житлом"]
    for p, l in live:
        pages.append(f"- [{p['h1']}]({SITE}/{p['slug']}/): {B.nvac(len(l))}. {p['lead']}")
    pages += [f"- [Як це працює]({SITE}/yak-tse-pratsiuie/): як поїхати на роботу за кордон покроково",
              f"- [Часті питання]({SITE}/pytannia/): оплата, податки, житло, договір, документи",
              f"- [Приведи друга]({SITE}/pryvedy-druha/): бонус за рекомендацію",
              f"- [Про «Вдало»]({SITE}/pro-nas/)",
              f"- [Контакти]({SITE}/kontakty/)",
              "", "## Статті"]
    for a in ARTICLES:
        pages.append(f"- [{a['h1']}]({SITE}/statti/{a['slug']}/): {a['desc']}")
    pages += ["", "## Інші мови",
              f"- [Русская версия]({SITE}/ru/)", f"- [English version]({SITE}/en/)", f"- [Wersja polska]({SITE}/pl/)",
              "", "## Optional",
              f"- [Повний текст: усі вакансії, питання й статті]({SITE}/llms-full.txt)",
              f"- [Вакансії у JSON]({SITE}/vacancies.json)",
              f"- [Карта сайту]({SITE}/sitemap.xml)"]
    open(os.path.join(ROOT, "llms.txt"), "w", encoding="utf-8").write(intro + "\n" + "\n".join(pages) + "\n")

    full = [intro, f"## Актуальні вакансії ({B.nvac(len(items))}, станом на {date})"]
    for c, l in sorted(by_c.items(), key=lambda x: -len(x[1])):
        full.append(f"\n## {c} — {B.nvac(len(l))}\n")
        full += [vac_md(v) + "\n" for v in B.sort_list(l)]
    if qa:
        full.append("\n## Часті питання\n")
        full += [f"### {q}\n{a}\n" for q, a in qa]
    full.append("\n## Статті\n")
    for a in ARTICLES:
        full.append(f"\n## {a['h1']}\nДжерело: {SITE}/statti/{a['slug']}/ (факти перевірено {a['updated']})\n\n{txt(a.get('body', ''))}\n")
    open(os.path.join(ROOT, "llms-full.txt"), "w", encoding="utf-8").write("\n".join(full).replace(B.NBSP, " ") + "\n")

    rb = ["# Сайт відкритий для пошукових систем та ІІ-асистентів.", "# Короткий опис для ІІ: " + SITE + "/llms.txt", ""]
    for bot in AI_BOTS:
        rb += [f"User-agent: {bot}", "Allow: /", ""]
    rb += ["User-agent: *", "Allow: /", "", f"Sitemap: {SITE}/sitemap.xml", ""]
    open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write("\n".join(rb))
    print(f"ai.py: llms.txt, llms-full.txt ({len(items)} вакансій, {len(qa)} питань, {len(ARTICLES)} статей), robots.txt")


if __name__ == "__main__":
    main()
