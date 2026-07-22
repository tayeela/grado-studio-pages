"use strict";

// Масштабная видимость слоя (аналог «Видимость слоёв» во FlexGIS и
// scale-dependent visibility в QGIS): городская выгрузка ОГД/ОСМ не должна
// рисоваться на обзорном масштабе. Порог — знаменатель масштаба в fmt.scale_max.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function lgrDenom(");
const marker = "function layerDrawable(L)";
const end = source.indexOf("\n", source.indexOf(marker));
assert.ok(start >= 0 && end > start, "scale visibility helpers must remain extractable");

const state = { view: { k: 1 } };
const context = vm.createContext({ state });
vm.runInContext(source.slice(start, end), context);
const { lgrDenom, layerInScale, layerDrawable } = context;

// state.view.k подобран так, чтобы знаменатель был ровно 5000
state.view.k = 3779.5 / 5000;
assert.equal(Math.round(lgrDenom()), 5000);

// без порога слой виден всегда
assert.equal(layerInScale({ visible: true }), true, "слой без порога виден на любом масштабе");
assert.equal(layerInScale({ visible: true, fmt: {} }), true);
assert.equal(layerInScale({ visible: true, fmt: { scale_max: 0 } }), true, "0 = «всегда»");

// порог сравнивается со знаменателем: крупнее порога — видно, мельче — нет
const layer = { visible: true, fmt: { scale_max: 5000 } };
assert.equal(layerInScale(layer), true, "на самом пороге слой ещё виден");
state.view.k = 3779.5 / 4000;                       // приблизили: 1:4000
assert.equal(layerInScale(layer), true, "крупнее порога — виден");
state.view.k = 3779.5 / 10000;                      // отдалили: 1:10000
assert.equal(layerInScale(layer), false, "отдалились за порог — скрыт");

// layerDrawable совмещает ручную видимость и масштаб
state.view.k = 3779.5 / 4000;
assert.equal(layerDrawable({ visible: true, fmt: { scale_max: 5000 } }), true);
assert.equal(layerDrawable({ visible: false, fmt: { scale_max: 5000 } }), false,
  "снятая галка видимости сильнее масштаба");
state.view.k = 3779.5 / 10000;
assert.equal(layerDrawable({ visible: true, fmt: { scale_max: 5000 } }), false);
assert.equal(layerDrawable({ visible: true }), true, "слой без порога рисуется всегда");
assert.equal(layerDrawable(null), false, "объект без слоя не рисуется");

// мусор в пороге не должен прятать слой
for (const bad of [null, undefined, NaN, -1, "нет"]) {
  assert.equal(layerInScale({ visible: true, fmt: { scale_max: bad } }), true,
    `некорректный порог ${String(bad)} игнорируется`);
}

console.log("layer-scale-visibility: OK");
