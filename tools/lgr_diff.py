#!/usr/bin/env python3
"""Сверка знаков ЛГР с эталонными QML.

Знаки правились по одному, глядя на экран, — на это ушли сутки, и часть всё
равно осталась неверной. Здесь эталон и наша библиотека сравниваются РАЗОМ:
на выходе список расхождений с числами, а не разговор про каждый знак.

Эталон — выгрузка стилей QGIS (spritlines / spritzones / spritlines_uds /
textlines). Правило QML несёт фильтр по LineCode и символ; у нас тот же код
лежит в поле lgr_code.

Единицы — здесь легко ошибиться, поэтому по порядку.

QML: `MM` — миллиметры бумаги, `MapUnit` — МЕТРЫ МЕСТНОСТИ, `Pixel` — пиксель
устройства (зумом не масштабируется, у нас для него свой «читаемый режим»).

Наша библиотека: при `ground_units` размеры записаны в ЭКРАННЫХ ПИКСЕЛЯХ НА
ОПОРНОМ МАСШТАБЕ (`ref_scale`), а не в метрах — так их читает groundFactor в
app-labels-place.js. Перевод:
    px_на_опорном = метры × MM_PX / (ref_scale / 1000)
При ref_scale 2000: 1 м = 3.7795 / 2 = 1.88975 px. Отсюда 6 м = 11.34.

Первая версия сверялки приняла наши px за метры и объявила 37 знаков
сломанными — ровно на коэффициент 1.88975. Знаки были верны, врала сверялка.

Запуск:  python tools/lgr_diff.py <папка с .qml>
"""
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

КОРЕНЬ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def наши_знаки():
    """lgr_code -> знак из встроенной библиотеки."""
    текст = io.open(os.path.join(КОРЕНЬ, "styles-lib.js"), encoding="utf-8").read()
    начало = текст.index("{", текст.index("="))
    глубина, конец = 0, None
    for i in range(начало, len(текст)):
        if текст[i] == "{":
            глубина += 1
        elif текст[i] == "}":
            глубина -= 1
            if глубина == 0:
                конец = i + 1
                break
    данные = json.loads(текст[начало:конец])
    по_коду = {}
    for style_id, знак in данные.items():
        код = знак.get("lgr_code")
        if код is not None:
            по_коду.setdefault(int(код), (style_id, знак))
    return по_коду


def _опции(слой):
    """Параметры слоя символа: и старый <prop>, и новый <Option>."""
    опции = {}
    for узел in слой.findall("./Option/Option"):
        имя, значение = узел.get("name"), узел.get("value")
        if имя and значение is not None:
            опции[имя] = значение
    for узел in слой.findall("prop"):            # старая форма важнее: QGIS пишет её последней
        опции[узел.get("k")] = узел.get("v")
    return опции


def эталон(путь):
    """lgr_code -> {label, цвет, ширина_мм, штрих, слоёв} по QML."""
    дерево = ET.parse(путь)
    корень = дерево.getroot()
    символы = {}
    for символ in корень.findall(".//renderer-v2/symbols/symbol"):
        слои = []
        for слой in символ.findall("layer"):
            о = {"класс": слой.get("class"), **_опции(слой)}
            if о["класс"] == "MarkerLine":
                # вложенный маркер: его угол и задаёт сторону засечки
                под = слой.find(".//symbol/layer")
                if под is not None:
                    м = _опции(под)
                    о["маркер_угол"] = float(м.get("angle") or 0)
            слои.append(о)
        символы[символ.get("name")] = слои

    итог = {}
    for правило in корень.findall(".//renderer-v2/rules/rule"):
        фильтр = правило.get("filter") or ""
        коды = [int(x) for x in re.findall(r"-?\d+", " ".join(re.findall(r"array\(([^)]*)\)", фильтр)))]
        коды = sorted({abs(k) for k in коды})     # «1» и «−1» — одна линия с разных сторон
        if not коды:
            continue
        слои = символы.get(правило.get("symbol"), [])
        основной = next((s for s in слои if s.get("класс") in ("SimpleLine", "SimpleFill")), None)
        маркеры = [s for s in слои if s.get("класс") == "MarkerLine"]
        # Сторона засечки: QGIS кладёт по MarkerLine на каждую сторону, разница
        # в угле маркера (0 против 180). Два слоя с разными углами = «в обе
        # стороны»; так нарисованы ООПТ, ПК и памятник природы.
        углы = sorted({м.get("маркер_угол", 0.0) for м in маркеры})
        for код in коды:
            итог.setdefault(код, {
                "label": правило.get("label", "").strip(),
                "цвет": (основной or {}).get("line_color") or (основной or {}).get("outline_color"),
                "заливка": (основной or {}).get("color"),
                "ширина": (основной or {}).get("line_width") or (основной or {}).get("outline_width"),
                "ширина_ед": (основной or {}).get("line_width_unit")
                             or (основной or {}).get("outline_width_unit"),
                "штрих": (основной or {}).get("customdash")
                         if (основной or {}).get("use_custom_dash") == "1" else None,
                "штрих_ед": (основной or {}).get("customdash_unit"),
                "стиль_линии": (основной or {}).get("line_style"),
                "маркеров": len(маркеры),
                "засечка_в_обе": len(углы) > 1,
                "файл": os.path.basename(путь),
            })
    return итог


MM_PX = 96 / 25.4                     # тот же множитель, что в app-shell.js


def метры_в_px(знак, метры):
    """Метры местности → пиксели на опорном масштабе знака."""
    if метры is None:
        return None
    масштаб = float(знак.get("ref_scale") or 2000)
    return float(метры) * MM_PX / (масштаб / 1000.0)


def мм_в_px(мм):
    """Миллиметры бумаги → пиксели (единицы холста)."""
    return None if мм is None else float(мм) * MM_PX


def цвет_к_hex(значение):
    if not значение:
        return None
    части = [c.strip() for c in значение.split(",")]
    if len(части) < 3:
        return значение
    r, g, b = (int(float(x)) for x in части[:3])
    return "#%02x%02x%02x" % (r, g, b)


def снимок(эталонные):
    """Эталон в виде, пригодном для сторожа на Node: сырые числа + единицы.

    Перевод в пиксели холста НЕ делаем — он живёт в тесте, рядом с той же
    формулой, что в app-labels-place.js. Именно на этом переводе сверялка и
    ошиблась в первый раз; пусть правило будет одно и на виду.
    """
    из = {}
    for код in sorted(эталонные):
        э = эталонные[код]
        из[str(код)] = {
            "label": э["label"],
            "цвет": цвет_к_hex(э["цвет"]),
            "ширина": None if not э["ширина"] else
                      {"v": float(э["ширина"]), "ед": э["ширина_ед"] or "MM"},
            "штрих": None if not э["штрих"] else
                     {"v": [float(x) for x in э["штрих"].replace(",", ";").split(";") if x.strip()],
                      "ед": э["штрих_ед"] or "MapUnit"},
            "сплошная": (э["стиль_линии"] or "solid") == "solid",
            "маркеров": э["маркеров"],
            "засечка_в_обе": э["засечка_в_обе"],
            "файл": э["файл"],
        }
    return из


def главное():
    if "--snapshot" in sys.argv:
        папка = os.path.join(КОРЕНЬ, "tools", "lgr-reference")
        эталонные = {}
        for f in sorted(x for x in os.listdir(папка) if x.endswith(".qml")):
            for код, знак in эталон(os.path.join(папка, f)).items():
                эталонные.setdefault(код, знак)
        путь = os.path.join(папка, "etalon.json")
        io.open(путь, "w", encoding="utf-8", newline="\n").write(
            json.dumps(снимок(эталонные), ensure_ascii=False, indent=1) + "\n")
        print(f"записано {len(эталонные)} знаков в {путь}")
        return

    папка = sys.argv[1] if len(sys.argv) > 1 else "."
    файлы = sorted(f for f in os.listdir(папка) if f.endswith(".qml"))
    if not файлы:
        sys.exit("не найдено ни одного .qml")

    эталонные = {}
    for f in файлы:
        for код, знак in эталон(os.path.join(папка, f)).items():
            эталонные.setdefault(код, знак)

    наши = наши_знаки()
    расхождения, совпало, нет_у_нас = [], 0, []

    for код in sorted(эталонные):
        э = эталонные[код]
        если_наш = наши.get(код)
        if not если_наш:
            нет_у_нас.append((код, э["label"]))
            continue
        style_id, наш = если_наш
        беды = []

        э_цвет = цвет_к_hex(э["цвет"])
        наш_цвет = (наш.get("stroke") or "").lower()
        if э_цвет and наш_цвет and э_цвет.lower() != наш_цвет:
            беды.append(f"цвет: эталон {э_цвет}, у нас {наш_цвет}")

        # Ширина. Pixel — экранный волосок, зумом не масштабируется: у нас для
        # него «читаемый режим», сверять нечего. MapUnit — метры, MM — бумага;
        # и то и другое приводим к px холста, где живёт наш width.
        эталон_px = None
        if э["ширина"] and э["ширина_ед"] == "MapUnit":
            эталон_px = метры_в_px(наш, э["ширина"])
        elif э["ширина"] and э["ширина_ед"] == "MM":
            эталон_px = мм_в_px(э["ширина"])
        if эталон_px is not None:
            наш_px = float(наш.get("width") or 0)
            if abs(наш_px - эталон_px) > 0.3:
                беды.append(f"ширина: эталон {эталон_px:.2f} px, у нас {наш_px:.2f} px")

        штрих_эталон = bool(э["штрих"]) or (э["стиль_линии"] or "solid") != "solid"
        штрих_наш = bool(наш.get("dash"))
        if штрих_эталон != штрих_наш:
            беды.append("штрих: " + ("должен быть, у нас сплошная" if штрих_эталон
                                     else "должна быть сплошная, у нас штрих"))
        elif э["штрих"] and наш.get("dash"):
            сырьё = [float(x) for x in э["штрих"].replace(",", ";").split(";") if x.strip()]
            ед = э["штрих_ед"] or "MapUnit"
            э_знач = [метры_в_px(наш, v) if ед == "MapUnit" else мм_в_px(v) for v in сырьё]
            наш_знач = [float(v) for v in наш["dash"]]
            если_разные = len(э_знач) != len(наш_знач) or any(
                abs(a - b) > 0.3 for a, b in zip(э_знач, наш_знач))
            if если_разные:
                беды.append("штрих (px): эталон [" + ", ".join(f"{v:.2f}" for v in э_знач) +
                            "], у нас [" + ", ".join(f"{v:.2f}" for v in наш_знач) + "]")

        if э["маркеров"] and not наш.get("line_marker"):
            беды.append(f"засечки: эталон есть ({э['маркеров']}), у нас нет")
        if not э["маркеров"] and наш.get("line_marker"):
            беды.append("засечки: эталон без них, у нас есть")
        if э["маркеров"] and наш.get("line_marker"):
            в_обе = наш["line_marker"].get("dir") == "both"
            if э["засечка_в_обе"] != в_обе:
                беды.append("сторона засечки: эталон "
                            + ("в обе стороны, у нас в одну" if э["засечка_в_обе"]
                               else "в одну сторону, у нас в обе"))
            # Заливку НЕ сверяем: наш словарь форм (tick/tee/corner/chevron)
            # не переводится в SimpleMarker QGIS один-в-один, и любой ответ был
            # бы догадкой. Проверка, которая кричит на 13 верных знаках, хуже
            # отсутствия проверки.

        if беды:
            расхождения.append((код, э["label"], style_id, беды))
        else:
            совпало += 1

    print(f"эталонных знаков: {len(эталонные)} | сверено с нашими: {len(эталонные) - len(нет_у_нас)}")
    print(f"совпадают полностью: {совпало} | с расхождениями: {len(расхождения)} | нет у нас: {len(нет_у_нас)}")
    if расхождения:
        print("\n--- расхождения ---")
        for код, label, style_id, беды in расхождения:
            print(f"\n[{код}] {label}   ({style_id})")
            for b in беды:
                print("    •", b)
    if нет_у_нас:
        print("\n--- есть в эталоне, нет у нас ---")
        for код, label in нет_у_нас:
            print(f"  [{код}] {label}")


if __name__ == "__main__":
    главное()
