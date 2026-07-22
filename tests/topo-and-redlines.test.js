"use strict";

// 1. Совместная правка общих границ была включена всегда и без выключателя.
//    Покрытием помечены почти все проектные слои (границы, зоны, ограничения),
//    поэтому перемещение одной зоны утаскивало соседнюю за общие вершины —
//    пользователь видел не помощь, а поломку.
// 2. Набор портала «Границы улично-дорожной сети (красные линии)» везёт не
//    только КЛ УДС: там же природный комплекс, полосы отвода железных дорог и
//    технические зоны инженерных сетей. Они попадали в тот же слой.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const core = fs.readFileSync(path.join(root, "pages-core.js"), "utf8");
const styles = JSON.parse(fs.readFileSync(path.join(root, "styles.json"), "utf8"));

// ---------- 1. выключатель общих границ ----------
assert.match(app, /^\s*topoEdit: false,/m, "по умолчанию режим обязан быть выключен");
const cov = app.slice(app.indexOf("function isCoverageFeature"),
  app.indexOf("function sharedCompanions"));
assert.match(cov, /if \(!state\.topoEdit\) return false;/,
  "выключатель обязан гаситься в одной точке — иначе часть путей продолжит тянуть соседей");

// обе ветки перетаскивания (тело объекта и вершина) берут спутников отсюда
assert.match(app, /companions: sharedCompanions\(cur, vi\)/, "правка вершины берёт спутников");
assert.match(app, /for \(const \{ feat, vi, comps \} of \(ed\.bodyComps \|\| \[\]\)\)/,
  "перемещение тела объекта берёт спутников оттуда же");

// состояние переживает перезагрузку — иначе выключатель приходится жать каждый раз
assert.match(app, /topoEdit: state\.topoEdit,/, "выбор обязан сохраняться в проект");
assert.match(app, /topoEdit: restored\.topoEdit === true,/,
  "при восстановлении режим включается только явным true");
assert.match(app, /setTopoEdit\(d\.topoEdit === true, true\)/,
  "восстановление обязано молчать, а не сыпать тост при каждой загрузке");

// доступность и обнаружимость
assert.match(html, /id="btn-topo"[^>]*aria-pressed="false"/,
  "кнопка обязана сообщать состояние и стартовать выключенной");
assert.match(app, /button\.setAttribute\("aria-pressed", String\(state\.topoEdit\)\)/,
  "состояние кнопки обязано обновляться");
assert.match(app, /if \(e\.code === "KeyY"\)/, "нужна горячая клавиша");
assert.ok(!/KeyY/.test(app.slice(app.indexOf("const TOOL_CODES"), app.indexOf("document.addEventListener(\"keydown\"", app.indexOf("const TOOL_CODES")))),
  "клавиша Y не должна быть занята инструментом или быстрым слоем");
assert.match(app, /\["Y", "Общие границы/, "клавиша обязана быть в справке");

// ---------- 2. импорт красных линий ----------
// коды 1–4 — красные линии (КЛ УДС/ТОП/ЛО/ОДМС), 6 — полосы отвода ж/д
const byCode = new Map();
for (const [sid, s] of Object.entries(styles))
  if (s && s.lgr_code != null) byCode.set(s.lgr_code, { sid, title: s.title });
assert.match(byCode.get(1).title, /КЛ УДС/, "код 1 — КЛ УДС, на нём держится фильтр");
assert.match(byCode.get(6).title, /железных дорог/, "код 6 — полосы отвода, их и жаловались видеть");

const imp = core.slice(core.indexOf("function importGisogdExtent"),
  core.indexOf("return { setLgrCodeStyles"));
assert.match(imp, /const redlineOnly = kind === "redline"/,
  "фильтр обязан включаться по виду набора, а не по всем слоям подряд");
assert.match(imp, /allRoutes\.filter\(\(\[code\]\) => REDLINE_CODES\.has\(code\)\)/,
  "из набора красных линий берутся только коды красных линий");
assert.match(imp, /if \(redlineOnly && allRoutes\.length && !routes\.length\) \{ dropped \+= 1; return; \}/,
  "объект без единого красного кода не должен попадать в слой");
assert.match(imp, /не красные линии, не загружены/,
  "молча терять данные портала нельзя — количество обязано попадать в отчёт");

// объект БЕЗ кодов вообще не отбрасываем: набор сам по себе о красных линиях
assert.ok(!/if \(redlineOnly && !allRoutes\.length\)/.test(imp),
  "объекты без LineCode из набора красных линий отбрасывать нельзя");

// правило маршрутизации: «красн» в названии слоя → kind redline
assert.match(html, /"keys":\s*\["красн",\s*"krasn"\],\s*"kind":\s*"redline"/,
  "правило, по которому набор считается красными линиями, обязано быть впечено");

// ---------- фильтр в работе ----------
const REDLINE_CODES = new Set([1, 2, 3, 4]);
const routesOf = codes => codes.map(c => [c, "both", byCode.get(c).sid]);
const filterFor = (kind, codes) => {
  const redlineOnly = kind === "redline";
  const all = routesOf(codes);
  const routes = redlineOnly ? all.filter(([c]) => REDLINE_CODES.has(c)) : all;
  return { routes, dropped: redlineOnly && all.length && !routes.length };
};
assert.equal(filterFor("redline", [1]).routes.length, 1, "КЛ УДС остаётся");
assert.equal(filterFor("redline", [6]).dropped, true, "полоса отвода ж/д не загружается");
assert.equal(filterFor("redline", [1, 6]).routes.length, 1,
  "у объекта с двумя кодами остаётся только красная линия");
assert.equal(filterFor("restrict", [6]).routes.length, 1,
  "в наборах ограничений фильтр не работает — там эти коды на своём месте");

// vm-прогон куска ядра здесь не нужен: importGisogdExtent завязан на правила из
// window, они впечены в index.html и проверены выше по разметке
void vm;

console.log("topo-and-redlines: OK");
