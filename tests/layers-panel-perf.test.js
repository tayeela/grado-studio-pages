"use strict";

// Панель слоёв перестраивалась целиком на каждую правку. Две причины, обе
// квадратичные по своей сути:
//   1) layerRowsTopFirst() отсеивал пустые слои-приёмники через
//      featuresOnLayer(L.id) — полный проход по объектам НА КАЖДЫЙ слой,
//      и так дважды за перерисовку (панель + легенда);
//   2) каждая строка со всеми её обработчиками собиралась заново, даже когда
//      её содержимое не менялось.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// --- отбор слоёв: один проход вместо прохода на каждый слой ---
const rows = app.slice(app.indexOf("function layersWithFeatures()"),
  app.indexOf("function reorderLayer("));
assert.match(rows, /function layersWithFeatures\(\)/,
  "множество слоёв с объектами должно считаться одним проходом");
assert.match(rows, /withFeatures\.has\(L\.id\)/,
  "фильтр обязан спрашивать готовое множество");
assert.doesNotMatch(rows, /featuresOnLayer\(L\.id\)/,
  "проход по всем объектам на каждый слой вернулся — это O(слои × объекты)");

// оба горячих вызова получают уже посчитанное множество, а не считают заново
assert.match(app, /layerRowsTopFirst\(new Set\(statsByLayer\.keys\(\)\)\)/,
  "панель обязана переиспользовать статистику, собранную тем же проходом");
assert.match(app, /layerRowsTopFirst\(withFeatures\)/,
  "легенда обязана получать множество, а не пересчитывать его");

// --- кэш строк ---
assert.match(app, /const _layerRowCache = new Map\(\)/, "кэш строк панели должен существовать");
assert.match(app, /function layerRowSignature\(layer, view\)/,
  "нужна явная сигнатура видимого содержимого строки");

// сигнатура обязана учитывать всё, что строка показывает — иначе кэш соврёт
const sig = app.slice(app.indexOf("function layerRowSignature"),
  app.indexOf("function layerRowSignature") + 800);
for (const field of ["layer.title", "layer.visible", "layer.locked", "view.count",
  "view.isActive", "view.catOpen", "view.swSvg"])
  assert.ok(sig.includes(field), `сигнатура обязана учитывать ${field}`);
assert.match(sig, /cats\.map/, "состав и счётчики категорий тоже входят в сигнатуру");
assert.match(sig, /catsOff\.includes/, "видимость категории входит в сигнатуру");

// переиспользование и уборка
const render = app.slice(app.indexOf("function renderLayers()"));
assert.match(render, /if \(cached && cached\.sig === sig\)/, "совпала сигнатура — строка переиспользуется");
assert.match(render, /for \(const node of cached\.nodes\) groupHost\.appendChild\(node\)/,
  "переиспользуются и строка, и её подпункты-категории");
assert.match(render, /_layerRowCache\.set\(layer\.id, \{ sig, nodes: rowNodes \}\)/,
  "новая строка обязана попадать в кэш вместе с категориями");
assert.match(render, /if \(!displayedIds\.has\(id\)\) _layerRowCache\.delete\(id\)/,
  "исчезнувшие слои нужно убирать из кэша, иначе он растёт вечно");

console.log("layers-panel-perf: OK");
