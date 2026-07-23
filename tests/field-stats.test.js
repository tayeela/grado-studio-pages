"use strict";

// Статистика поля (панель статистики QGIS). Что здесь важно:
// 1. «Пусто» — то же, что в отборе: заглушки портала NOT_FOUND и None не
//    считаются значениями.
// 2. Числовая сводка появляется, только когда числа составляют большинство
//    заполненных значений: у «кадастрового номера» parseFloat выдирает «77»
//    и врал бы статистикой.
// 3. Медиана считается честно и для чётного числа значений.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app-attr.js"), "utf8");
const start = source.indexOf("function fieldStats(values) {");
assert.ok(start > 0, "ядро статистики обязано оставаться извлекаемым");
const end = source.indexOf("\n}", source.indexOf("return stats;", start)) + 2;
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const fieldStats = vm.runInContext("fieldStats", context);

// ---------- числовое поле ----------
{
  const stats = fieldStats([1, 2, 3, 4, 5, 9, 12, 17, 25, null]);
  assert.equal(stats.count, 10);
  assert.equal(stats.filled, 9);
  assert.equal(stats.empty, 1);
  assert.equal(stats.numeric.min, 1);
  assert.equal(stats.numeric.max, 25);
  assert.equal(stats.numeric.sum, 78);
  assert.ok(Math.abs(stats.numeric.mean - 78 / 9) < 1e-9);
  assert.equal(stats.numeric.median, 5, "медиана нечётного набора — средний элемент");

  const even = fieldStats([1, 2, 3, 100]);
  assert.equal(even.numeric.median, 2.5, "медиана чётного набора — среднее двух средних");

  // запятая как десятичный разделитель — из выгрузок портала
  assert.equal(fieldStats(["1,5", "2,5"]).numeric.sum, 4);
}

// ---------- пустые значения ----------
{
  const stats = fieldStats(["жилое", "", "NOT_FOUND", "None", "-", null, undefined, "нежилое"]);
  assert.equal(stats.filled, 2, "заглушки портала — это пусто");
  assert.equal(stats.empty, 6);
}

// ---------- текстовое поле: частые значения, а не ложная арифметика ----------
{
  const stats = fieldStats(["жилое", "жилое", "жилое", "нежилое", "гараж"]);
  assert.equal(stats.numeric, null, "текст не даёт числовой сводки");
  assert.equal(JSON.stringify(stats.top[0]), JSON.stringify(["жилое", 3]),
    "частые значения по убыванию (JSON: массивы из vm не проходят deepEqual)");
  assert.equal(stats.uniqueCount, 3);

  // кадастровые номера: parseFloat выдрал бы «77» — сводки быть не должно
  const cadastral = fieldStats(["77:01:0001:15", "77:01:0001:16", "77:01:0001:17"]);
  assert.equal(cadastral.numeric, null,
    "число, выдранное из кадастрового номера, — не статистика");
  assert.equal(cadastral.uniqueCount, 3);

  // а числа с редким мусором сводку сохраняют (числа ≥ 90% заполненных)
  const noisy = fieldStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(noisy.numeric, "чистые числа дают сводку");
}

// ---------- проводка ----------
{
  assert.match(source, /<button id="at-stats"/, "кнопка обязана быть в таблице атрибутов");
  assert.match(source, /openFieldStats\(layer, filtered\)/,
    "статистика считается по строкам ТЕКУЩЕГО фильтра — «все» или «выделенные»");
  assert.match(source, /attrValue\(f, column\)/,
    "значения берутся через attrValue — виртуальные $area и $length тоже считаются");
  assert.match(source, /по \$\{ruCount\(feats\.length/, "объём выборки виден в окне");
}

console.log("field-stats: OK");
