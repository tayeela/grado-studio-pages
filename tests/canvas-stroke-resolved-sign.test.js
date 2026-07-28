"use strict";

// canvasStrokeOf проверяла СЫРОЙ f.style_id/L.style_id вместо ЭФФЕКТИВНОГО
// (того, что реально выбрал styleOf).
//
// Слой «Граница территории» несёт L.style_id="boundary.line" — знак с
// тёмно-серым штрихом, у которого на тёмной теме есть отдельная поправка
// цвета через cvColor("boundary", ...). Стоит слою обзавестись правилом,
// которое для части объектов подменяет знак на что-то другое (например,
// «проектируемая красная линия», #d91a1a) — styleOf честно резолвит st в
// новый знак: заливка, штриховка, толщина линии всюду берутся из НОВОГО
// знака. Но canvasStrokeOf пересчитывала styleId САМА, заново, из сырых
// f.style_id/L.style_id — которые правило не трогало и трогать не могло
// (оно живёт только в возвращаемом объекте st). В результате ветка
// "boundary.line" срабатывала по СТАРОМУ знаку, и объект получал обводку
// темы границы территории вместо цвета нового, резолвленного знака —
// расхождение между тем, чем залит контур, и тем, чем он обведён.

const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = require("./app-source");
const start = source.indexOf("function ruleStyleFor(");
const end = source.indexOf("async function createProjectStyle(");
assert.ok(start > 0 && end > start, "styleOf и canvasStrokeOf обязаны оставаться извлекаемыми вместе");

const STYLES_V2 = {
  "boundary.line": { stroke: "#1c1c1a", width: 2.5 },
  "red.line.projected": { stroke: "#d91a1a", width: 2.5 },
};
const layer = { id: "L1", style_id: "boundary.line", fmt: null, rules: [] };
const CANVAS_THEME = { boundary: "#2b3550" };   // тёмная тема: свой токен, не st.stroke
const context = vm.createContext({
  STYLES_V2, state: { projectStyles: {} }, Math, Object, Array, String, parseFloat, JSON,
  window: { GRADO_SYMBOLOGY: null, CANVAS_THEME },
  layerOf: () => layer,
  layerStyle: L => (L.style_id ? STYLES_V2[L.style_id] : {}),
  categoryLayerVisualFormat: () => ({}),
  applyDataDefined: base => base,
  dataDefinedPatch: () => null,
  gpZoneSid: () => null,
  layerSignSid: () => null,
  cvColor: (key, fallback) => (CANVAS_THEME[key] || fallback),
});
vm.runInContext(source.slice(start, end), context);
const { styleOf, canvasStrokeOf } = context;

// ---------- без правил: L.style_id и есть эффективный знак ----------
{
  const f = { id: 1, props: {} };
  const st = styleOf(f);
  assert.equal(canvasStrokeOf(f, st), CANVAS_THEME.boundary,
    "объект без своего знака и без правил обязан получить тему границы территории");
}

// ---------- правило сменило знак — обводка обязана следовать за НОВЫМ ----------
{
  layer.rules = [{ field: "stage", op: "=", value: "temp", style_id: "red.line.projected" }];
  const f = { id: 2, props: { stage: "temp" } };
  const st = styleOf(f);
  assert.equal(st.stroke, "#d91a1a", "styleOf обязан резолвить в новый знак — это уже проверено rules-over-imported-sign");
  assert.equal(canvasStrokeOf(f, st), "#d91a1a",
    "обводка обязана взять цвет РЕЗОЛВЛЕННОГО знака (red.line.projected), а не " +
    "темы boundary — раньше здесь возвращался токен темы границы, потому что " +
    "проверка читала L.style_id='boundary.line' (сырое поле), не эффективный st");
}

// ---------- явная правка обводки объекта/слоя всё ещё главнее темы ----------
{
  layer.rules = [];
  const f = { id: 3, props: {}, fmt: { stroke: "#00ff00" } };
  const st = styleOf(f);
  assert.equal(canvasStrokeOf(f, st), "#00ff00",
    "личная правка обводки обязана оставаться сильнее темы boundary");
}

console.log("canvas-stroke-resolved-sign: OK");
