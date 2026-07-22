"use strict";

// Таблица атрибутов строила ВСЕ строки разом и вешала по два обработчика на
// каждую. На слое в 20 тыс. объектов (обычная выгрузка ФГИС ТП) это 100 тыс.
// узлов: 337 мс на открытие, 1276 мс на вход в правку и 805 мс на ОДИН клик
// по строке — клик перерисовывал таблицу целиком.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const attr = fs.readFileSync(path.join(root, "app-attr.js"), "utf8");
const css = fs.readFileSync(path.join(root, "redesign", "studio2.css"), "utf8");

const table = attr.slice(attr.indexOf("function openAttributeTable"),
  attr.indexOf("function openAddFieldDialog"));
assert.ok(table.length > 400, "тело таблицы атрибутов должно оставаться извлекаемым");

// --- в DOM только видимое окно ---
assert.match(table, /function renderWindow\(/, "нужна отрисовка окна строк");
assert.match(table, /box\.scrollTop \/ rowH/, "первая строка окна считается от прокрутки");
assert.match(table, /function padHtml\(/, "высоту прокрутки должны держать распорки");
assert.doesNotMatch(table, /feats\.map\(\(f, i\) =>/,
  "полная материализация всех строк вернулась — это O(объекты) узлов на открытие");

// окно ограничено высотой видимой области, а не числом объектов
assert.match(table, /Math\.ceil\(view \/ rowH\) \+ AT_OVERSCAN \* 2/,
  "размер окна обязан считаться от высоты контейнера");
assert.match(table, /AT_OVERSCAN/, "нужен запас строк, иначе окно мигает при прокрутке");

// высота строки замеряется, а не берётся на веру: в режиме правки строки выше
assert.match(table, /probe\.offsetHeight/, "высоту строки нужно замерять по факту");
assert.match(table, /renderWindow\(true, false\)/,
  "пересборка после замера обязана быть однократной, иначе рекурсия");

// --- обработчики делегированы ---
for (const ev of ["scroll", "change", "click", "dblclick"])
  assert.match(table, new RegExp(`scrollBox\\(\\)\\.addEventListener\\("${ev}"`),
    `обработчик ${ev} обязан висеть на контейнере`);
assert.doesNotMatch(table, /querySelectorAll\("tbody tr"\)\.forEach/,
  "переподписка на каждую строку вернулась — при прокрутке она съест весь выигрыш");
assert.doesNotMatch(table, /querySelectorAll\("input\[data-col\]"\)\.forEach/,
  "обработчик на каждую ячейку вернулся");

// --- клик по строке не перестраивает таблицу ---
assert.match(table, /function paintSelection\(/,
  "выделение обязано перекрашивать видимые строки, а не пересобирать таблицу");
assert.match(table, /if \(filter === "selected"\) renderTable\(\); else paintSelection\(\)/,
  "при фильтре «выделенные» состав строк меняется — там нужна полная перерисовка");

// --- порядковый номер остаётся абсолютным ---
assert.match(table, /rowHtml\(feats\[i\], i\)/,
  "номер строки обязан считаться от начала списка, а не от начала окна");

// --- поведение таблицы сохранено ---
assert.match(table, /toggleSelection\(f\.id\); else selectOne\(f\.id\)/, "Shift/Ctrl-выделение");
assert.match(table, /zoomToFeature\(f\)/, "двойной клик приближает объект");
assert.match(table, /deleteLayerFieldFrom\(layer, del\.dataset\.col\)/, "удаление поля из шапки");
assert.match(table, /castField\(col\.type, inp\.value\)/, "правка ячейки приводит тип");
assert.match(table, /snapshot\(\); f\.props = f\.props \|\| \{\}/, "правка ячейки идёт в историю");

// --- оформление ---
assert.match(css, /\.attr-modal \.attr-table tr\.at-pad td\{padding:0;border:0\}/,
  "распорки не должны рисовать рамки на месте невидимых строк");
assert.match(css, /\.attr-modal \.attr-table thead th\{position:sticky/,
  "на десятках тысяч строк шапка обязана оставаться на виду");

console.log("attr-table-virtual: OK");
