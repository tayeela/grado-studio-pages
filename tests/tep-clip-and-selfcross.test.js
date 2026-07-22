"use strict";

// Две методики, зафиксированные пользователем:
//   • здание отдаёт ВЕСЬ свой СПП, даже если частью вышло за границу;
//   • ЗОУИТ вычитается только той частью, что попала в границы разработки.
// Плюс предупреждение о самопересекающемся контуре: формула шнурования гасит
// собственную площадь «бабочки», и ТЭП молча уезжает в ноль.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = {
  __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
    restrict_hints: [], restrict_layer_id: "r", other_layer_id: "o" },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};
// клиппинг живёт в вендорной библиотеке, которая в браузере грузится ПОЗЖЕ ядра;
// ядро обязано находить её лениво — здесь подкладываем её так же, как страница
global.window.polygonClipping = require("../vendor/polygon-clipping.umd.min.js");
const core = require("../pages-core.js");

const square = (x, y, side) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side]];
const territory = { kind: "boundary", ring: square(0, 0, 100) };   // 1 га
const calcArea = tep => tep.results.find(r => r.id === "calc_area").value;
const run = features => core.computeTep({ features, params: {} });

// --- ЗОУИТ: только часть внутри границы ---
const half = run([territory, { kind: "restrict", ring: square(50, 0, 100) }]);
assert.equal(calcArea(half), 0.5, "зона, наполовину вышедшая за границу, вычитается наполовину");

// зона, ЦЕНТР которой снаружи, раньше выпадала целиком — теперь режется по границе
const cornerOnly = run([territory, { kind: "restrict", ring: square(90, 90, 100) }]);
assert.equal(calcArea(cornerOnly), 0.99,
  "зона с центроидом снаружи обязана вычесть накрытый угол (100 м² из 1 га)");

// зона целиком снаружи ничего не отнимает
const outside = run([territory, { kind: "restrict", ring: square(500, 500, 100) }]);
assert.equal(calcArea(outside), 1, "зона вне территории на расчёт не влияет");

// перекрывающиеся зоны считаются по ОБЪЕДИНЕНИЮ, а не суммой
const overlap = run([territory,
  { kind: "restrict", ring: square(10, 10, 50) },
  { kind: "restrict", ring: square(30, 10, 50) }]);
assert.equal(calcArea(overlap), 0.65,
  "перекрытие двух зон 50×50 со сдвигом 30 даёт 3500 м², а не 5000 — иначе двойной счёт");

// --- здание: весь СПП, даже частью снаружи ---
const building = run([territory,
  { kind: "building", ring: square(20, 0, 100), props: { floors: 10 } }]);
assert.equal(building.fact.spp, 100,
  "здание с центроидом внутри отдаёт СПП целиком, обрезать его не нужно");
const buildingOut = run([territory,
  { kind: "building", ring: square(500, 500, 100), props: { floors: 10 } }]);
assert.equal(buildingOut.fact.spp, 0, "здание вне территории в посадку не идёт");

// --- самопересечение контура ---
const twisted = run([{ kind: "boundary", ring: [[0, 0], [100, 100], [100, 0], [0, 100]] }]);
const cross = twisted.checks.find(c => /пересекает/i.test(c.title));
assert.ok(cross, "«бабочка» обязана давать предупреждение");
assert.match(cross.msg, /граница территории/, "нужно назвать, что задета именно граница");
assert.equal(cross.ok, false);
assert.ok(!run([territory]).checks.some(c => /пересекает/i.test(c.title)),
  "нормальный контур предупреждения не вызывает");

// вырожденные входы не роняют расчёт
for (const ring of [[[0, 0], [1, 1]], [], null])
  assert.doesNotThrow(() => run([{ kind: "boundary", ring: square(0, 0, 100) },
    { kind: "restrict", ring }]), "мусорная геометрия не должна ронять ТЭП");

console.log("tep-clip-and-selfcross: OK");
