"use strict";

// Группы легенды листа («Границы / Застройка / Линии градрегулирования»
// как в эталонном альбоме). Что здесь важно:
// 1. Группы печатаются заголовками в своём порядке; слои внутри группы —
//    в порядке панели слоёв (второй ручной порядок не заводится).
// 2. Пустая группа (слой скрыт или без объектов) заголовок НЕ печатает —
//    иначе на листе повиснет «Застройка» над пустотой.
// 3. Слои вне групп идут после групп без заголовка; без настройки легенда
//    остаётся сплошным списком, как раньше.
// 4. Раскладка хранится в проекте: едет в collectState и восстанавливается.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

// минимальное окружение студии
const L = (id, kind, title, visible = true) =>
  ({ id, kind, title, visible, geometry_type: "polygon" });
global.window = globalThis;
global.LAYERS_V2 = [
  L("granica", "boundary", "Граница участка"),
  L("zdaniya", "building", "Здания"),
  L("krasnye", "redline", "Красные линии"),
  L("zony", "zone", "Функциональные зоны"),
  L("skrytyj", "building", "Скрытый слой", false),
];
global.state = { features: [
  { layer_id: "granica" }, { layer_id: "zdaniya" },
  { layer_id: "krasnye" }, { layer_id: "zony" }, { layer_id: "skrytyj" },
], sheetLegend: null };
global.layerOf = f => LAYERS_V2.find(l => l.id === f.layer_id) || null;
global.layerStyle = () => ({ stroke: "#5c5a54" });
global.styleOf = () => ({ stroke: "#5c5a54" });

require(path.join(root, "app-sheet.js"));
const legendRows = globalThis.GRADO_SHEET_CORE.legendRows;

// ---------- без настройки — сплошной список ----------
{
  const rows = legendRows();
  assert.equal(rows.length, 4, "видимые слои с объектами, скрытый не печатается");
  assert.ok(rows.every(row => !row.heading), "заголовков без групп нет");
  assert.equal(rows[0].title, "Граница участка");
}

// ---------- группы: порядок групп + порядок панели внутри ----------
{
  state.sheetLegend = { groups: [
    { title: "Застройка", layers: ["zdaniya"] },
    { title: "Границы", layers: ["granica"] },
    { title: "Пустая", layers: ["skrytyj"] },              // слой скрыт
  ] };
  const rows = legendRows();
  const titles = rows.map(row => (row.heading ? "## " : "") + row.title);
  assert.deepEqual(titles, [
    "## Застройка", "Здания",
    "## Границы", "Граница участка",
    "Красные линии", "Функциональные зоны",               // вне групп — после, без заголовка
  ], "порядок групп ручной, пустая группа не печатает заголовок");
}

// ---------- слой в группе, но невидимый — не всплывает ----------
{
  state.sheetLegend = { groups: [{ title: "Всё", layers: ["skrytyj", "zdaniya"] }] };
  const rows = legendRows();
  assert.ok(!rows.some(row => row.title === "Скрытый слой"),
    "скрытый слой не печатается даже из группы");
  assert.equal(rows.filter(row => row.heading).length, 1);
}

// ---------- проводка ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const sheetSrc = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(app, /sheetLegend: state\.sheetLegend \|\| null,/,
    "раскладка обязана ехать в снимке проекта (автосейв и .grado)");
  assert.match(app, /delete saved\.sheetLegend;/,
    "но не в геометрической истории — Undo чертежа не трогает легенду");
  assert.match(app, /state\.sheetLegend = isRecord\(d\.sheetLegend\)/,
    "и восстанавливаться при загрузке");
  assert.match(sheetSrc, /id="sheet-legend-groups"/, "кнопка в окне листа");
  assert.match(cmdk, /Группы легенды листа…/, "и в палитре");
  assert.match(sheetSrc, /if \(row\.heading\) \{/, "колонка рисует заголовок группы без образца");
  assert.match(sheetSrc, /\{ title: "Границы", layers: byKind\(\["boundary"\]\) \}/,
    "пресет «Как в альбоме» раскладывает слои по ролям");
}

console.log("sheet-legend-groups: OK");
