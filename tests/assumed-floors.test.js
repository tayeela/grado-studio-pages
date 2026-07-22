"use strict";

// Этажность вне 1..75 (пусто, 0, текст) подставляется девяткой. Дефолт разумный,
// но он МОЛЧА попадал в «СПП факт» и «Плотность факт»: у выгрузки НСПД поле
// opt_floors часто пустое, и каждое такое здание считалось девятиэтажным —
// цифра уезжала в документацию как измеренная. Значения не меняем, но допущение
// обязано быть видимым.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = {
  __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
    restrict_hints: [], restrict_layer_id: "r", other_layer_id: "o" },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};
const core = require("../pages-core.js");

const square = (x, y, side) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];
const building = (id, x, assumed) => ({
  id, kind: "building", ring: square(x, 0, 50),
  props: assumed ? { floors: 9, floors_assumed: true } : { floors: 9 },
});
const boundary = { kind: "boundary", ring: square(0, 0, 500) };
const floorsCheck = tep => tep.checks.find(c => /этажность/i.test(c.title));

// два из трёх зданий с подставленной этажностью
const mixed = core.computeTep({
  features: [boundary, building(1, 0, false), building(2, 60, true), building(3, 120, true)],
  params: {},
});
const check = floorsCheck(mixed);
assert.ok(check, "допущение об этажности обязано попадать в проверки ТЭП");
assert.match(check.msg, /2 зданий/, "число зданий с допущением должно называться");
assert.match(check.msg, /67\s*%/, "доля в фактическом СПП считается от factSpp");
assert.equal(check.ok, false, "это предупреждение, а не подтверждение");

// сами цифры не тронуты: предупреждение ничего не пересчитывает
const three = core.computeTep({
  features: [boundary, building(1, 0, false), building(2, 60, false), building(3, 120, false)],
  params: {},
});
assert.equal(mixed.fact.spp, three.fact.spp,
  "пометка допущения не должна менять СПП — только сообщать о нём");

// при полных данных лишнего предупреждения нет
assert.ok(!floorsCheck(three), "без допущений проверка появляться не должна");

// нормализация этажности во фронте помечает допущение
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const upgrade = app.slice(app.indexOf("function upgradeFeature("),
  app.indexOf("function upgradeFeature(") + 1200);
assert.match(upgrade, /floors_assumed = true/,
  "upgradeFeature обязан помечать подставленную этажность");
assert.match(upgrade, /delete f\.props\.floors_assumed/,
  "при корректной этажности пометку нужно снимать, иначе она залипнет навсегда");

console.log("assumed-floors: OK —", check.msg.slice(0, 70) + "…");
