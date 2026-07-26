#!/usr/bin/env python3
"""Поднять номер сборки во ВСЕХ местах разом.

Номер живёт в index.html почти шестью десятками мест (`?v=` у каждого ассета
плюс `window.__GRADO_ASSET_VERSION__`) и ещё раз в version.json. Пока это
делалось вручную, каждый заход выглядел немного иначе — и однажды бамп по
шаблону `?v=10124` обновил ассеты, но не переменную: приложение сообщало о
себе старую версию, а прод-проверка читает именно её.

Запуск:  python tools/bump.py          — следующий номер
         python tools/bump.py 10200    — конкретный номер
"""
import io
import json
import os
import re
import sys

КОРЕНЬ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def читать(имя):
    return io.open(os.path.join(КОРЕНЬ, имя), encoding="utf-8", newline="").read()


def писать(имя, текст):
    io.open(os.path.join(КОРЕНЬ, имя), "w", encoding="utf-8", newline="").write(текст)


def main():
    html = читать("index.html")
    текущие = set(re.findall(r"\?v=(\d+)", html))
    if len(текущие) != 1:
        sys.exit(f"index.html уже собран из разных версий: {sorted(текущие)}. "
                 "Почините руками — молча перезаписывать это нельзя.")
    было = текущие.pop()
    стало = sys.argv[1] if len(sys.argv) > 1 else str(int(было) + 1)

    html = re.sub(r"\?v=\d+", f"?v={стало}", html)
    html, замен = re.subn(r'(__GRADO_ASSET_VERSION__\s*=\s*")\d+(")',
                          rf"\g<1>{стало}\g<2>", html)
    if замен != 1:
        sys.exit("объявление __GRADO_ASSET_VERSION__ не найдено — "
                 "именно его и забыл прошлый ручной бамп")
    писать("index.html", html)

    # Сторож самообновления сравнивает ВПЕЧАТАННЫЙ номер с version.json. Он тоже
    # обязан ехать вместе со всеми: пока он отставал, каждое открытие страницы
    # видело расхождение и делало лишнюю перезагрузку с ?b=НОМЕР.
    html, замен = re.subn(r'(\bvar B\s*=\s*")\d+(")', rf"\g<1>{стало}\g<2>", html)
    if замен != 1:
        sys.exit("сторож самообновления (var B) в index.html не найден")
    писать("index.html", html)

    version = json.loads(читать("version.json"))
    version["bundle_version"] = стало
    # Версия, которую человек видит в шапке — это version, а не номер сборки.
    # Пока бамп её не трогал, в углу годами стояло одно и то же число, и по нему
    # нельзя было понять, доехала выкладка или нет. Поднимаем младшую цифру.
    части = str(version.get("version", "0.0.0")).split(".")
    while len(части) < 3:
        части.append("0")
    части[-1] = str(int(части[-1]) + 1)
    version["version"] = ".".join(части)
    version["bundle_short_version"] = version["version"]
    писать("version.json", json.dumps(version, ensure_ascii=False, indent=2) + "\n")

    меток = len(re.findall(r"\?v=" + стало, html))
    print(f"bump: {было} -> {стало} (tags {меток} + var + сторож + version.json), "
          f"версия в шапке {version['version']}")


if __name__ == "__main__":
    main()
