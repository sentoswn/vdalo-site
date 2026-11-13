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
