"use strict";

// Условное оформление слоя не действовало на импортированные слои ВООБЩЕ.
//
// У слоёв ГИС ОГД и шейпов знак живёт на объекте: он проставлен при импорте по
// коду ЛГР, а человеком не выбирался. В порядке разрешения стиля f.style_id
// стоял выше правил слоя — и первое же совпадение отсекалось. При этом окно
// оформления честно считало классы, легенда листа их рисовала, а выгрузка QML
// писала renderer graduatedSymbol: человек настраивает раскраску по полю,
// видит легенду, отдаёт QML коллеге — а на холсте ничего не меняется, и в
// QGIS у коллеги цвета не такие, как у него.
//
// Теперь правила-ЗНАКИ идут впереди знака объекта, а правила-ДИАПАЗОНЫ
// (градуированная символика) накладываются патчем поверх любого знака.

const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = require("./app-source");
const start = source.indexOf("function ruleStyleFor(");
const end = source.indexOf("function canvasStrokeOf(");
assert.ok(start > 0 && end > start, "разрешение стиля обязано оставаться извлекаемым");

const STYLES_V2 = {
  "ogd.redline": { stroke: "#e11", w: 2, sign: "ЛГР" },
  "user.green": { stroke: "#0a0", w: 1, sign: "правило" },
};
const layer = {
  id: "L1", style_id: null,
  fmt: { fill: "#eee" },
  rules: [],
};
const context = vm.createContext({
  STYLES_V2, state: { projectStyles: {} }, Math, Object, Array, String, parseFloat, JSON,
  window: { GRADO_SYMBOLOGY: null },
  layerOf: () => layer,
  layerStyle: L => (L.style_id ? STYLES_V2[L.style_id] : { fill: L.fmt ? L.fmt.fill : undefined }),
  categoryLayerVisualFormat: L => ({ ...(L.fmt || {}) }),
  applyDataDefined: (base) => base,
  dataDefinedPatch: () => null,
  gpZoneSid: () => null,
  layerSignSid: () => null,
});
vm.runInContext(source.slice(start, end), context);
const { styleOf } = context;

const объект = { id: 1, style_id: "ogd.redline", props: { ВИД: "сквер", ПЛОЩАДЬ: 900 } };

// ---------- знак импорта работает, пока правил нет ----------
assert.equal(styleOf(объект).stroke, "#e11", "без правил объект рисуется своим знаком");

// ---------- правило-ЗНАК перебивает знак импорта ----------
layer.rules = [{ field: "ВИД", op: "=", value: "сквер", style_id: "user.green" }];
assert.equal(styleOf(объект).stroke, "#0a0",
  "правило слоя обязано перебивать знак, проставленный ИМПОРТОМ: человек не " +
  "выбирал этот знак, он взялся из кода ЛГР");
assert.equal(styleOf({ id: 2, style_id: "ogd.redline", props: { ВИД: "двор" } }).stroke, "#e11",
  "объект вне условия остаётся при своём знаке");

// ---------- правило-ДИАПАЗОН ложится патчем поверх знака ----------
context.window.GRADO_SYMBOLOGY = { ruleMatchesValue: (r, v) => v >= r.min && v < r.max };
layer.rules = [
  { field: "ПЛОЩАДЬ", min: 0, max: 1000, patch: { fill: "#fee" } },
  { field: "ПЛОЩАДЬ", min: 1000, max: 1e9, patch: { fill: "#f00" } },
];
const покрашен = styleOf(объект);
assert.equal(покрашен.fill, "#fee", "цвет диапазона обязан примениться");
assert.equal(покрашен.stroke, "#e11",
  "диапазон — ПАТЧ: он красит заливку, но не стирает знак ЛГР целиком");
assert.equal(покрашен.sign, "ЛГР", "остальные свойства знака обязаны уцелеть");
assert.equal(styleOf({ id: 3, style_id: "ogd.redline", props: { ПЛОЩАДЬ: 5000 } }).fill, "#f00",
  "второй диапазон");
assert.equal(styleOf({ id: 4, style_id: "ogd.redline", props: {} }).fill, "#eee",
  "объект без значения поля остаётся с оформлением слоя");

// ---------- оформление объекта по-прежнему главнее всего ----------
assert.equal(styleOf({ ...объект, fmt: { fill: "#123456" } }).fill, "#123456",
  "личная правка объекта обязана оставаться последним словом");

console.log("rules-over-imported-sign: OK");
