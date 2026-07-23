"use strict";

// Выпуск DXF в браузере. Пункт «Экспорт чертежа (DXF)» был выключен и подписан
// «требует настольную версию», хотя DXF — текстовый формат.
//
// Что здесь важно:
// 1. Пишем R12 (AC1009) намеренно: его читают все, включая старые версии и
//    сторонние просмотрщики, и он не требует таблиц классов и объектов.
// 2. Координаты — местные метры проекта: CAD ждёт метры, а не градусы.
// 3. Цвет в R12 — номер палитры ACI, а не RGB: красная линия обязана остаться
//    красной, зона — жёлтой.
// 4. Дыра в полигоне выходит отдельным замкнутым контуром, подпись — отдельной
//    сущностью TEXT: в CAD подпись это текст на чертеже, а не свойство линии.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-labels.js"));
require(path.join(root, "app-dxf.js"));
const D = globalThis.GRADO_DXF;
assert.ok(D && typeof D.buildDxf === "function", "модуль обязан подниматься без документа");

const pairsOf = text => {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1].trim()]);
  return out;
};
const kinds = pairs => pairs.filter(pair => pair[0] === "0").map(pair => pair[1]);

// ---------- цвета ----------
{
  assert.equal(D.toAci("#ff0000"), 1, "красный обязан оставаться красным");
  assert.equal(D.toAci("#ffff00"), 2, "жёлтый — жёлтым");
  assert.equal(D.toAci("#0000ff"), 5, "синий — синим");
  assert.equal(D.toAci(null), 7, "без цвета — по умолчанию");
  assert.equal(D.toAci("не цвет"), 7, "мусор не должен ломать файл");
  assert.equal(D.toAci("rgba(255,0,0,0.5)"), 1, "прозрачности в DXF нет, цвет остаётся");
}

// ---------- имена слоёв ----------
{
  assert.equal(D.layerName("Функциональные зоны", 0), "Функциональные_зоны",
    "пробелы в имени слоя AutoCAD не любит");
  assert.equal(D.layerName('Слой "особый": тест', 0), "Слой_особый_тест",
    "подряд идущие подчёркивания схлопываются");
  assert.equal(D.layerName("", 3), "Слой_4", "безымянный слой получает номер");
}

// ---------- сборка ----------
{
  const zones = { id: "zones", title: "Функциональные зоны", visible: true,
    fmt: { stroke: "#b89e59" } };
  const red = { id: "red", title: "Красные линии", visible: true, fmt: { stroke: "#ff0000" } };
  const features = [
    { id: 1, layer: zones, props: { name: "Ж-1" },
      ring: [[0, 0], [100, 0], [100, 60], [0, 60]],
      holes: [[[20, 20], [40, 20], [40, 40], [20, 40]]] },
    { id: 2, layer: red, props: {}, line: [[-10, 80], [120, 80]] },
    { id: 3, layer: zones, props: { name: "Школа" }, point: [50, 30] },
    { id: 4, layer: zones, props: {}, circle: { cx: 200, cy: 30, r: 15 } },
    { id: 5, layer: zones, props: {} },                       // без геометрии
  ];
  const result = D.buildDxf({ features, layers: [zones, red],
    styleOf: feature => feature ? (feature.layer.fmt || {}) : {},
    layerOf: feature => feature.layer,
    labelOf: feature => feature.props.name });
  const pairs = pairsOf(result.text);
  const seen = kinds(pairs);

  assert.ok(result.text.startsWith("0\nSECTION"), "файл начинается секцией");
  assert.ok(result.text.trim().endsWith("EOF"), "и заканчивается EOF");
  assert.ok(pairs.some(pair => pair[0] === "1" && pair[1] === "AC1009"),
    "версия обязана быть R12 — её читают все");
  assert.ok(pairs.some(pair => pair[0] === "9" && pair[1] === "$INSUNITS"), "единицы обязаны объявляться");

  assert.equal(seen.filter(kind => kind === "POLYLINE").length, 3,
    "контур, дыра и линия — три полилинии");
  assert.equal(seen.filter(kind => kind === "SEQEND").length, 3, "каждая закрыта SEQEND");
  assert.equal(seen.filter(kind => kind === "POINT").length, 1);
  assert.equal(seen.filter(kind => kind === "CIRCLE").length, 1);
  assert.equal(seen.filter(kind => kind === "TEXT").length, 2, "подписи двух объектов");
  assert.equal(result.counts.skipped, 1, "объект без геометрии обязан считаться пропущенным");

  // замкнутость: у контура и дыры флаг 70 = 1, у линии = 0
  const closed = pairs.filter(pair => pair[0] === "70").map(pair => pair[1]);
  assert.ok(closed.includes("1") && closed.includes("0"),
    "контур обязан быть замкнут, линия — нет");

  // координаты в метрах проекта, а не в градусах и не в веб-меркаторе
  const xs = pairs.filter(pair => pair[0] === "10").map(pair => parseFloat(pair[1]));
  assert.ok(Math.min(...xs) >= -20 && Math.max(...xs) <= 220,
    `координаты ушли за пределы проекта: ${Math.min(...xs)}…${Math.max(...xs)}`);

  // слои с русскими именами и своими цветами
  assert.deepEqual(result.layers, ["Функциональные_зоны", "Красные_линии"]);
  const layerColors = pairs.filter(pair => pair[0] === "62").map(pair => pair[1]);
  assert.ok(layerColors.includes("1"), "красный слой обязан получить цвет 1");

  // подпись стоит внутри объекта: для полигона — полюс недоступности
  const anchor = D.textAnchor(features[0]);
  assert.ok(anchor[0] > 0 && anchor[0] < 100 && anchor[1] > 0 && anchor[1] < 60,
    `подпись вне объекта: ${anchor}`);
  assert.deepEqual(D.textAnchor(features[3]), [200, 30], "у окружности подпись в центре");
}

// ---------- проводка ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(app, /if \(typeof exportDxf === "function"\) \{ exportDxf\(\); return; \}/,
    "в браузере DXF собирается на месте");
  assert.doesNotMatch(adapter, /new Set\(\["btn-album", "btn-dxf"/,
    "кнопка DXF больше не заглушка");
  assert.doesNotMatch(cmdk, /"Экспорт чертежа \(DXF\)", run: \(\) => click\("btn-dxf"\), desktop: true/,
    "и в палитре команд она не помечена настольной");
}

console.log("dxf-export: OK");
