#!/usr/bin/env python3
"""IndexNow: миттєво повідомляє Bing (на ньому працює пошук ChatGPT і Copilot), Yandex, Seznam, Naver
про нові та змінені сторінки. Запускається з GitHub Action після публікації.
    python3 indexnow.py        — сторінки, змінені сьогодні
    python3 indexnow.py --all  — усі сторінки з sitemap.xml
"""
import datetime as dt
import json
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

KEY = "f987c49e7e7f42d9979667d8cd4d9fd1"
HOST = "vdalo-robota.com.ua"
today = dt.datetime.now(ZoneInfo("Europe/Kyiv")).date().isoformat()
sm = open("sitemap.xml", encoding="utf-8").read()
pairs = re.findall(r"<loc>(.*?)</loc><lastmod>(.*?)</lastmod>", sm)
urls = [u for u, lm in pairs if "--all" in sys.argv or lm == today]
urls += ["https://%s/llms.txt" % HOST, "https://%s/llms-full.txt" % HOST]
body = json.dumps({"host": HOST, "key": KEY, "keyLocation": "https://%s/%s.txt" % (HOST, KEY), "urlList": urls[:10000]}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
try:
    r = urllib.request.urlopen(req, timeout=30)
    print("IndexNow:", r.status, len(urls), "URL")
except Exception as e:
    print("IndexNow error:", e)
