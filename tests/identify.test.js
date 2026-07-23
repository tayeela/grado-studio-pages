"use strict";

// «Определить объект» — инструмент Identify из QGIS. На плотной выгрузке в одной
// точке лежат функциональная зона, земельный участок, здание и красная линия;
// клик отдаёт только верхний, и до нижних объектов не добраться никак.
//
// Здесь проверяется попадание объекта под точку: оно считается ИНАЧЕ, чем при
// обычном клике. Обычный клик учитывает заливку (незалитый полигон ловится за
// обводку, залитый — телом), потому что решает, кого выбрать одним движением.
// Списку «что под курсором» нужны все.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

// вырезаем геометрические предикаты и саму проверку попадания
const pieces = ["function pointInPolygon(x, y, f) {", "function pointInRing(x, y, ring) {",
  "function nearestOnSeg(", "function nearChain(x, y, chain, tolW) {",
  "function nearRing(wx, wy, ring, tolW) {", "function featureHitsPoint(f, wx, wy, tolW, pointTolW) {"];
const context = vm.createContext({});
for (const head of pieces) {
  const at = app.indexOf(head);
  assert.ok(at > 0, `не найдено: ${head}`);
  // конец функции — по закрывающей скобке в начале строки (файл бывает с CRLF)
  const end = app.indexOf("\n}", at);
  assert.ok(end > at, `не извлекается: ${head}`);
  vm.runInContext(app.slice(at, end + 2), context);
}
const hits = vm.runInContext("featureHitsPoint", context);

const box = (x0, y0, x1, y1) => ({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const TOL = 1;

// ---------- полигон ловится и телом, и контуром ----------
{
  const zone = box(0, 0, 100, 100);
  assert.ok(hits(zone, 50, 50, TOL), "точка внутри полигона — попадание");
  assert.ok(hits(zone, 100, 50, TOL), "точка на границе — тоже");
  assert.ok(hits(zone, 100.5, 50, TOL), "и в пределах допуска снаружи");
  assert.ok(!hits(zone, 130, 50, TOL), "а дальше допуска — нет");

  // выколотая часть: тело не считается, но за контур дыры схватить можно
  const donut = { ring: [[0, 0], [100, 0], [100, 100], [0, 100]],
    holes: [[[30, 30], [70, 30], [70, 70], [30, 70]]] };
  assert.ok(!hits(donut, 50, 50, TOL), "в дыре тела нет");
  assert.ok(hits(donut, 30, 50, TOL), "но контур дыры ловится");
  assert.ok(hits(donut, 10, 50, TOL), "а тело за дырой — попадание");
}

// ---------- линия, точка, дуга, окружность ----------
{
  assert.ok(hits({ line: [[0, 0], [100, 0]] }, 50, 0.5, TOL), "линия ловится по допуску");
  assert.ok(!hits({ line: [[0, 0], [100, 0]] }, 50, 5, TOL), "дальше допуска — нет");

  // у точки свой допуск: знак крупнее волоска линии
  assert.ok(hits({ point: [10, 10] }, 13, 10, TOL, 5), "точка ловится по своему допуску");
  assert.ok(!hits({ point: [10, 10] }, 13, 10, TOL, 1), "с обычным допуском — нет");

  assert.ok(hits({ circle: { cx: 0, cy: 0, r: 50 } }, 50.4, 0, TOL), "окружность ловится за обводку");
  assert.ok(!hits({ circle: { cx: 0, cy: 0, r: 50 } }, 20, 0, TOL), "внутри окружности тела нет");
  assert.ok(hits({ arc: { cx: 0, cy: 0, r: 50 } }, 0, 49.7, TOL), "дуга — за обводку");
}

// ---------- проводка в приложении ----------
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "redesign", "studio2.css"), "utf8");

  assert.match(html, /data-tool="identify"/, "инструмент обязан быть на панели");
  assert.match(cmdk, /Определить объект под курсором/, "и в палитре команд");
  assert.match(app, /function hitTestAll\(wx, wy\)/, "стек под курсором собирается отдельной функцией");
  assert.match(app, /if \(state\.tool === "identify"\) \{ openIdentify\(wxr, wyr, ex, ey\); return; \}/,
    "клик в этом режиме обязан открывать список, а не выбирать верхний объект");
  assert.match(app, /state\.hoverIdentifyId = f\.id/, "наведение на строку обязано подсвечивать объект");
  assert.match(app, /if \(state\.hoverIdentifyId === f\.id\)/, "и подсветка обязана рисоваться");
  assert.match(css, /\.identify-menu\{/, "список обязан быть оформлен");
  // список ничего не меняет в проекте — только выбор и активный слой
  const identify = app.slice(app.indexOf("function openIdentify("), app.indexOf("function featureHitsPoint("));
  assert.doesNotMatch(identify, /snapshot\(\)|state\.features\s*=/, "определение объекта ничего не правит");
  assert.match(identify, /selectOne\(f\.id\)/, "клик по строке выбирает объект");
}

console.log("identify: OK");
