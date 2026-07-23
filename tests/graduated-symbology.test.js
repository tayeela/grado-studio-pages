"use strict";

// Градуированная символика («Graduated» в QGIS) и свойства по выражению
// (data-defined). Что здесь важно:
// 1. Каждое значение обязано попадать РОВНО в один класс: границу включает
//    только нижний класс, верхнюю — только последний. Иначе объект на границе
//    получил бы два цвета, а счётчики в легенде не сошлись бы с числом объектов.
// 2. Три способа классификации дают РАЗНЫЕ границы — в этом их смысл: равные
//    интервалы на перекошенных данных (много малоэтажек, редкие высотки) дают
//    пустые классы, квантили и естественные границы — нет.
// 3. Выражения считаются один раз на объект и живут до правки данных: на
//    20 000 объектов пересчёт каждый кадр — десятки миллисекунд впустую.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-symbology.js"));
const S = globalThis.GRADO_SYMBOLOGY;
assert.ok(S && typeof S.buildGraduated === "function", "модуль обязан подниматься без документа");

// перекошенная выборка: 200 малоэтажек и 100 высоток — как в реальном квартале
const floors = [];
for (let i = 0; i < 200; i++) floors.push(1 + (i % 5));
for (let i = 0; i < 100; i++) floors.push(9 + (i % 16));
const features = floors.map((value, id) => ({ id, props: { floors: value } }));

// ---------- каждое значение ровно в одном классе ----------
for (const method of ["equal", "quantile", "jenks"]) {
  const built = S.buildGraduated(features, { field: "floors", method, classes: 5 });
  assert.equal(built.reason, null, `${method}: ${built.reason}`);
  assert.ok(built.rules.length >= 2, `${method}: классов ${built.rules.length}`);
  for (const value of floors) {
    const hits = built.rules.filter(rule => S.ruleMatchesValue(rule, value)).length;
    assert.equal(hits, 1, `${method}: значение ${value} попало в ${hits} классов`);
  }
  // счётчики классов обязаны в сумме давать все объекты
  const total = built.rules.reduce((sum, rule) =>
    sum + floors.filter(value => S.ruleMatchesValue(rule, value)).length, 0);
  assert.equal(total, floors.length, `${method}: сумма классов ${total} вместо ${floors.length}`);
}

// ---------- способы дают разные границы ----------
{
  const values = floors.slice().sort((a, b) => a - b);
  const equal = S.classify(values, { method: "equal", classes: 5 });
  const quantile = S.classify(values, { method: "quantile", classes: 5 });
  const jenks = S.classify(values, { method: "jenks", classes: 5 });
  assert.notDeepEqual(equal, quantile, "равные интервалы и квантили обязаны различаться");
  assert.notDeepEqual(equal, jenks, "равные интервалы и естественные границы — тоже");

  // равные интервалы на перекошенных данных оставляют почти пустые классы,
  // квантили — нет; ради этого выбора способ и предлагается
  const fill = breaks => {
    const rules = S.graduatedRules({ field: "floors", breaks,
      colors: S.rampColors("grey", breaks.length - 1) });
    return rules.map(rule => floors.filter(value => S.ruleMatchesValue(rule, value)).length);
  };
  const spread = counts => Math.max(...counts) / Math.max(1, Math.min(...counts));
  const equalFill = fill(equal), quantileFill = fill(quantile);
  assert.ok(spread(equalFill) > 3 * spread(quantileFill),
    `равные интервалы обязаны быть заметно неравномернее: ${equalFill} против ${quantileFill}`);

  // границы строго возрастают и накрывают весь размах
  for (const breaks of [equal, quantile, jenks]) {
    for (let i = 1; i < breaks.length; i++)
      assert.ok(breaks[i] > breaks[i - 1], `границы обязаны возрастать: ${breaks}`);
    assert.ok(breaks[0] <= values[0] + 1e-9 && breaks[breaks.length - 1] >= values[values.length - 1] - 1e-9,
      `границы обязаны накрывать размах: ${breaks}`);
  }
}

// ---------- палитра ----------
{
  assert.equal(S.rampColors("yellow-red", 5).length, 5);
  assert.equal(S.rampColors("yellow-red", 3).length, 3, "палитра обязана растягиваться на любое число классов");
  assert.equal(S.rampColors("yellow-red", 9).length, 9);
  const seven = S.rampColors("white-blue", 7);
  assert.equal(new Set(seven).size, 7, "цвета классов обязаны различаться");
  assert.match(seven[0], /^#[0-9a-f]{6}$/i, "цвет — шестнадцатеричный");
  // тёмный конец достаётся большим значениям
  const light = parseInt(seven[0].slice(1, 3), 16), dark = parseInt(seven[6].slice(1, 3), 16);
  assert.ok(light > dark, "первый класс светлее последнего");
  // заливка тянет за собой обводку — иначе класс без контура сливается с соседом
  const rules = S.graduatedRules({ field: "x", breaks: [0, 1, 2], colors: ["#ffffff", "#000000"] });
  assert.ok(rules[0].patch.stroke && rules[0].patch.stroke !== rules[0].patch.fill,
    "у заливки обязана быть своя обводка");
}

// ---------- вырожденные случаи ----------
{
  assert.equal(S.buildGraduated([{ props: { a: 5 } }], { field: "a" }).rules.length, 0,
    "по одному значению класс не построить");
  assert.match(S.buildGraduated([{ props: { a: 5 } }], { field: "a" }).reason, /меньше двух/);
  const same = S.buildGraduated([{ props: { a: 7 } }, { props: { a: 7 } }, { props: { a: 7 } }], { field: "a" });
  assert.equal(same.rules.length, 0, "все значения одинаковы — классов нет");
  const текст = S.buildGraduated([{ props: { a: "Ж-1" } }, { props: { a: "О-2" } }], { field: "a" });
  assert.equal(текст.rules.length, 0, "по текстовому полю диапазоны не строятся");
  // запятая как десятичный разделитель — из выгрузок портала
  assert.deepEqual(S.numericValues([{ props: { a: "1,5" } }, { props: { a: "2,5" } }], "a"), [1.5, 2.5]);
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const ui = fs.readFileSync(path.join(root, "app-style-ui.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.ok(html.indexOf('src="./app-symbology.js') < html.indexOf('src="./app-style-ui.js'),
    "модуль обязан подниматься до окна оформления");
  assert.match(app, /if \(r\.patch && SY && r\.min !== undefined && r\.max !== undefined\)/,
    "правило-диапазон обязано разбираться отдельно от правила по значению");
  assert.match(app, /return \{ \.\.\.\(layerStyle\(L\) \|\| \{\}\), \.\.\.r\.patch \};/,
    "цвет диапазона ложится патчем поверх стиля слоя — знака в библиотеке у него нет");
  assert.match(app, /function rangeLegendItems\(L, ranges\)/,
    "в легенде обязаны стоять диапазоны, иначе цвет есть, а ключа к нему нет");
  assert.match(ui, /data-mode="graduated"/, "в окне оформления обязан быть третий режим");
  assert.match(ui, /SYMBOLOGY\.buildGraduated\(layerFeatures, settings\)/, "и он обязан считать по данным слоя");

  // свойства по выражению
  assert.match(app, /const _ddCache = new WeakMap\(\);/, "значения выражений обязаны кешироваться");
  assert.match(app, /_dataVersion \+= 1;/, "и сбрасываться при правке данных");
  assert.match(app, /hit\.v === _dataVersion && hit\.owner === L/,
    "кеш обязан помнить, для какого слоя посчитан: оформление слоя меняется отдельно от данных");
  assert.match(app, /\["width_expr", "width", 0\.1, 20\]/, "толщина обязана быть в разумных пределах");
  assert.match(ui, /id="gr-width-expr"/, "и задаваться в интерфейсе");
  assert.match(ui, /Выражение \$\{title\}/, "ошибка выражения обязана показываться человеку");
}

console.log("graduated-symbology: OK");
