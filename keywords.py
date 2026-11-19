"""Ключові слова для вакансій чотирма мовами (uk / ru / en / pl).

Підбираються автоматично за назвою й описом вакансії. Використовуються:
  - у пошуку на сайті (keywords.json → можна шукати «погрузчик», «magazyn», «forklift»);
  - на сторінці кожної вакансії (блок «Ключові слова»), щоб її знаходили в Google різними мовами.
Щоб додати нову професію — допишіть рядок у GROUPS.
"""
import re

GROUPS = [
    (r"склад|комплект|логіст|дистриб|ретрак", {
        "uk": ["робота на складі", "складський працівник", "комплектувальник замовлень"],
        "ru": ["работа на складе", "кладовщик", "комплектовщик", "сборщик заказов"],
        "en": ["warehouse worker", "order picker", "warehouse job"],
        "pl": ["praca na magazynie", "magazynier", "pracownik magazynu", "kompletacja zamówień"]}),
    (r"виробни|продукці|оператор|збірк|монтаж|лінії|ливарн|ламін|порцелян|пластик|картон|турбін|робітник$|^робітник", {
        "uk": ["робота на заводі", "робота на виробництві", "оператор виробництва"],
        "ru": ["работа на заводе", "работа на производстве", "разнорабочий", "оператор производства"],
        "en": ["factory worker", "production worker", "production operator"],
        "pl": ["praca na produkcji", "pracownik produkcji", "operator produkcji", "praca w fabryce"]}),
    (r"пакув|фасув|упаков|маркув|зважув", {
        "uk": ["пакувальник", "фасувальник", "пакування"],
        "ru": ["упаковщик", "фасовщик", "работа упаковщиком"],
        "en": ["packer", "packing job"],
        "pl": ["pakowacz", "pakowanie", "praca przy pakowaniu"]}),
    (r"навантажувач|ретрак|вилков", {
        "uk": ["водій навантажувача", "карщик", "оператор навантажувача"],
        "ru": ["водитель погрузчика", "карщик", "погрузчик", "водитель вилочного погрузчика"],
        "en": ["forklift driver", "forklift operator", "reach truck"],
        "pl": ["operator wózka widłowego", "wózek widłowy", "UDT", "operator reach trucka"]}),
    (r"м.ясн", {
        "uk": ["м'ясне виробництво", "м'ясокомбінат"],
        "ru": ["мясокомбинат", "мясное производство", "работа на мясокомбинате"],
        "en": ["meat processing", "meat factory"],
        "pl": ["zakład mięsny", "przetwórstwo mięsa", "praca w zakładzie mięsnym"]}),
    (r"риб|лосос|оселед|філет", {
        "uk": ["рибопереробка", "рибний завод", "філетування риби"],
        "ru": ["рыбный завод", "переработка рыбы", "рыбзавод"],
        "en": ["fish processing", "fish factory"],
        "pl": ["przetwórstwo ryb", "zakład rybny", "filetowanie ryb"]}),
    (r"пекар|сирн|харч|паличок|оселед|лосос|м.ясн", {
        "uk": ["харчове виробництво", "харчова промисловість"],
        "ru": ["пищевое производство", "пищевая промышленность"],
        "en": ["food production", "food factory"],
        "pl": ["produkcja spożywcza", "przemysł spożywczy"]}),
    (r"пекар", {
        "uk": ["пекар", "пекарня"], "ru": ["пекарь", "пекарня"], "en": ["baker", "bakery"], "pl": ["piekarz", "piekarnia"]}),
    (r"електро|електрон|джгут|акумулятор|енерго|навушник", {
        "uk": ["збирання електроніки", "монтажник", "електромонтер"],
        "ru": ["сборщик электроники", "монтажник", "электромонтажник"],
        "en": ["electronics assembly", "assembly worker", "electrician"],
        "pl": ["montaż elektroniki", "monter", "elektromonter"]}),
    (r"ЧПУ|CNC", {
        "uk": ["оператор ЧПУ", "верстати з ЧПУ"], "ru": ["оператор ЧПУ", "станки с ЧПУ"],
        "en": ["CNC operator", "CNC machinist"], "pl": ["operator CNC", "operator maszyn CNC"]}),
    (r"Лікар", {
        "uk": ["лікар", "робота лікарем за кордоном"], "ru": ["врач", "работа врачом за границей"],
        "en": ["doctor", "physician", "medical doctor job"], "pl": ["lekarz", "praca dla lekarza"]}),
    (r"Покоївк", {
        "uk": ["покоївка", "прибирання в готелі"], "ru": ["горничная", "уборка в отеле"],
        "en": ["housekeeper", "hotel housekeeping"], "pl": ["pokojówka", "sprzątanie hotelu"]}),
    (r"Гідротехн", {
        "uk": ["гідротехнік", "гідравлік"], "ru": ["гидротехник", "гидравлик"],
        "en": ["hydraulic technician"], "pl": ["hydraulik", "technik hydraulik"]}),
    (r"Шпаклюв|шліфув", {
        "uk": ["шліфувальник", "шпаклювальник"], "ru": ["шлифовщик", "шпаклёвщик"],
        "en": ["grinder", "surface finisher"], "pl": ["szlifierz", "szpachlowanie"]}),
    (r"прядил|одяг|шкіряних|текстил", {
        "uk": ["текстильне виробництво", "швейне виробництво"], "ru": ["текстильное производство", "швейное производство"],
        "en": ["textile factory", "garment production"], "pl": ["produkcja tekstylna", "szwalnia"]}),
]

COUNTRY = {
    "Польща": {"uk": ["робота в Польщі"], "ru": ["работа в Польше", "работа в Польше для украинцев"],
               "en": ["jobs in Poland", "work in Poland for Ukrainians"], "pl": ["praca w Polsce", "praca dla Ukraińców"]},
    "Литва": {"uk": ["робота в Литві"], "ru": ["работа в Литве", "работа в Литве для украинцев"],
              "en": ["jobs in Lithuania"], "pl": ["praca na Litwie"]},
    "Чехія": {"uk": ["робота в Чехії"], "ru": ["работа в Чехии", "работа в Чехии для украинцев"],
              "en": ["jobs in Czech Republic"], "pl": ["praca w Czechach"]},
    "Словаччина": {"uk": ["робота в Словаччині"], "ru": ["работа в Словакии"],
                   "en": ["jobs in Slovakia"], "pl": ["praca na Słowacji"]},
}

HOUSING = {"uk": ["робота з житлом"], "ru": ["работа с жильём", "работа с проживанием"],
           "en": ["job with accommodation"], "pl": ["praca z zakwaterowaniem"]}
NOEXP = {"uk": ["без досвіду"], "ru": ["без опыта"], "en": ["no experience"], "pl": ["bez doświadczenia"]}

LANGS = (("uk", "Українською"), ("ru", "Російською"), ("en", "English"), ("pl", "Polski"))


def vac_keywords(v):
    title = v.get("title") or ""
    text = " ".join(str(v.get(k) or "") for k in ("title", "desc", "req"))
    out = {l: [] for l, _ in LANGS}

    def add(d):
        for l in out:
            for w in d.get(l, []):
                if w not in out[l]:
                    out[l].append(w)

    matched = False
    for rx, d in GROUPS:
        if re.search(rx, title, re.I):
            add(d); matched = True
    if not matched:
        for rx, d in GROUPS:
            if re.search(rx, text, re.I):
                add(d); break
    if v.get("country") in COUNTRY:
        add(COUNTRY[v["country"]])
    h = v.get("_h")
    if h and h[0] != "no":
        add(HOUSING)
    if re.search(r"без досвіду|досвід не (потрібен|обов)", text, re.I):
        add(NOEXP)
    if v.get("city"):
        c = re.split(r"[\s(,]", v["city"].strip())[0]
        if c:
            out["pl"].append("praca " + c)
            out["en"].append("jobs " + c)
    return out


# ---------- Додаткові слова ЛИШЕ для пошуку на сайті (на сторінках не показуються) ----------
# Українські слова з назви посади → російські відповідники (щоб «электрик», «сварщик», «грузчик» знаходили вакансії)
TITLE_RU = [
    (r"оператор", "оператор"), (r"працівни|робітни", "работник рабочий разнорабочий"),
    (r"різноробоч", "разнорабочий"), (r"комплектувальн", "комплектовщик сборщик заказов"),
    (r"пакувальн|пакуванн", "упаковщик упаковка"), (r"фасувальн", "фасовщик"),
    (r"сортувальн|сортуванн", "сортировщик сортировка"), (r"вантажн", "грузчик"),
    (r"навантажувач|ретрак|вилков", "погрузчик водитель погрузчика карщик"),
    (r"зварювальн|зварник", "сварщик"), (r"електрик|електромонт|електро", "электрик электромонтер электромонтажник"),
    (r"слюсар", "слесарь"), (r"токар", "токарь"), (r"фрезерувальн", "фрезеровщик"), (r"механік", "механик"),
    (r"монтажник|монтаж|збирач|складальн|збиранн|збірк", "монтажник сборщик сборка"),
    (r"водій", "водитель"), (r"прибиральн|прибиранн|покоївк", "уборщик уборщица уборка горничная"),
    (r"кухар|кухн", "повар кухня"), (r"пекар", "пекарь пекарня"), (r"кондитер", "кондитер"),
    (r"швач|швейн", "швея швейное"), (r"маляр|фарбувальн", "маляр"), (r"столяр|тесля", "столяр плотник"),
    (r"будівельн|будов", "строитель стройка"), (r"муляр", "каменщик"), (r"шліфувальн", "шлифовщик"),
    (r"контролер|контроль якост", "контролер качества"), (r"продавц|продавець", "продавец"), (r"касир", "кассир"),
    (r"склад|логіст", "склад кладовщик работа на складе грузчик вантажник"), (r"виробництв|виробнич", "производство работа на производстве"),
    (r"завод|фабрик", "завод фабрика"), (r"м.ясн|м.яс", "мясо мясной мясокомбинат"), (r"риб", "рыба рыбный"),
    (r"птиц|курк|курятин", "птица курица птицефабрика"), (r"овоч|фрукт|ягід|теплиц", "овощи фрукты ягоды теплица"),
    (r"лікар", "врач доктор"), (r"медсестр", "медсестра"), (r"догляд", "уход сиделка"),
    (r"інженер", "инженер"), (r"технік", "техник"), (r"менеджер", "менеджер"),
    (r"гідравлік|гідротехн", "гидравлик гидротехник"), (r"кабел|джгут", "кабели жгуты"),
]

# Польська латиниця → кирилиця (для міст і компаній: «Łódź» → «лодзь», «TEMU» → «тему»)
_PL = [("szcz", "щ"), ("sz", "ш"), ("cz", "ч"), ("rz", "ж"), ("ch", "х"), ("dż", "дж"), ("dź", "дзь"), ("dz", "дз"),
       ("ż", "ж"), ("ź", "зь"), ("ś", "сь"), ("ć", "ць"), ("ń", "нь"), ("ł", "л"), ("ó", "о"), ("ą", "он"), ("ę", "ен"),
       ("ie", "е"), ("ia", "я"), ("iu", "ю"), ("io", "ё"), ("ja", "я"), ("je", "е"), ("ju", "ю"), ("j", "й"),
       ("w", "в"), ("y", "и"), ("x", "кс"), ("q", "к"), ("v", "в")]
_LAT = dict(zip("abcdefghiklmnoprstuz", "абцдефгхіклмнопрстуз"))


def to_cyr(s):
    s = (s or "").lower()
    for a, b in _PL:
        s = s.replace(a, b)
    return "".join(_LAT.get(ch, ch) for ch in s)


def search_extras(v):
    """Слова, за якими вакансію знаходять у пошуку на сайті. Користувач їх не бачить."""
    title = v.get("title") or ""
    text = " ".join(str(v.get(k) or "") for k in ("title", "desc", "req", "schedule", "hours", "housing", "perks", "transport", "night"))
    out = []
    for rx, ru in TITLE_RU:
        if re.search(rx, title, re.I):
            out.append(ru)
    city = re.split(r"\s*\(", (v.get("city") or "").strip())[0]
    if city:
        cy = to_cyr(city)
        out += [city, cy, cy.replace("і", "и")]
    co = v.get("company") or ""
    if co:
        cy = to_cyr(co)
        out += [co, cy, cy.replace("і", "и"), to_cyr(co.lower().replace("sh", "ш").replace("ee", "і").replace("ea", "і"))]
    h = v.get("_h")
    if h and h[0] != "no":
        out.append("з житлом житло надається з проживанням с жильем с жильём с проживанием жилье предоставляется")
        if "безкоштов" in str(h):
            out.append("безкоштовне житло бесплатное жилье")
    else:
        out.append("без житла без жилья без проживания")
    if v.get("own"):
        out.append("доплата за власне житло доплата за своє житло доплата за свое жилье компенсація житла компенсация жилья своє житло свое жилье")
    sched = " ".join(str(v.get(k) or "") for k in ("schedule", "night"))
    days = set(re.findall(r"\b(8|10|11|12)\s*(?:[-–]\s*\d{1,2}\s*)?(?:год|h\b|godz|часов|час)", sched, re.I))
    if not days:
        m = [int(x) for x in re.findall(r"\d{3}", v.get("hours") or "")]
        if m:
            mx = max(m)
            days = {"8"} if mx <= 200 else {"10"} if mx <= 240 else {"12"}
    for d in sorted(days):
        out.append(f"{d} годин {d}-годинний робочий день {d} часов {d}-часовой рабочий день {d}h")
    if re.search(r"нічн|ночн|nocn", text, re.I) and not re.match(r"\s*(ні|нет|no)\b", v.get("night") or "", re.I):
        out.append("нічні зміни ночные смены ночная смена")
    if re.search(r"інвалід|инвалид|niepełnospraw|disab", text, re.I):
        out.append("інвалідність людей з інвалідністю инвалид инвалидность")
    if re.search(r"сидяч|сидячи|сидінн|siedząc", text, re.I):
        out.append("сидяча робота сидячая работа")
    if re.search(r"пар[аи]|сімейн|для пар", (v.get("who") or "") + " " + text, re.I):
        out.append("для пар семейные пары")
    seen, res = set(), []
    for w in " ".join(out).split():
        if w.lower() not in seen:
            seen.add(w.lower()); res.append(w)
    return " ".join(res)
