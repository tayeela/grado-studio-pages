"use strict";

// «Изменить форму» (reshape из QGIS): ломаная дважды пересекает контур или
// линию — участок между первым и последним пересечением заменяется на неё.
//
// Что здесь важно:
// 1. Заменяется дуга контура, БЛИЖАЙШАЯ к нарисованному пути: человек чертит
//    новую форму вместо старого куска, и старый кусок — рядом с новым.
//    Правило «внутрь — меньший, наружу — больший» врёт: вырез у правого края
//    оставлял правый обрезок (3286 м²) вместо основного тела (6714 м²).
// 2. Для линии направление пути подгоняется под направление линии: ломаную
//    можно чертить в любую сторону.
// 3. Меньше двух пересечений — честный отказ, а не тихое ничего.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-edit.js"));
const E = globalThis.GRADO_EDIT;
assert.ok(typeof E.reshapeRing === "function", "ядро обязано подниматься без документа");

const area = ring => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum / 2);
};
const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

// ---------- контур: четыре стороны, прирезка и вырез ----------
{
  const bulgeRight = E.reshapeRing(square, [[80, -20], [130, 50], [80, 120]]);
  assert.ok(area(bulgeRight.ring) > 10000, "выгиб наружу прирезает площадь");

  const carveRight = E.reshapeRing(square, [[80, -20], [60, 50], [80, 120]]);
  assert.ok(Math.abs(area(carveRight.ring) - 6714) < 30,
    `вырез справа обязан оставить ТЕЛО слева: ${Math.round(area(carveRight.ring))}, а не правый обрезок`);

  const carveLeft = E.reshapeRing(square, [[20, -20], [40, 50], [20, 120]]);
  assert.ok(Math.abs(area(carveLeft.ring) - 6714) < 30,
    "вырез слева симметричен — тело остаётся справа");

  const bulgeLeft = E.reshapeRing(square, [[20, -20], [-30, 50], [20, 120]]);
  assert.ok(area(bulgeLeft.ring) > 10000);

  // сама форма пути обязана войти в контур
  assert.ok(carveRight.ring.some(p => Math.abs(p[0] - 60) < 1e-6 && Math.abs(p[1] - 50) < 1e-6),
    "вершина нарисованного пути обязана стать вершиной контура");
}

// ---------- отказы ----------
{
  assert.equal(E.reshapeRing(square, [[50, 50], [200, 50]]).ring, null,
    "одно пересечение — не reshape");
  assert.match(E.reshapeRing(square, [[50, 50], [200, 50]]).reason, /минимум дважды/);
  assert.equal(E.reshapeRing(square, [[300, 0], [400, 0]]).ring, null, "мимо контура");
  assert.equal(E.reshapeRing([[0, 0], [1, 0]], [[0, -1], [0, 1]]).ring, null, "двух точек мало для контура");
}

// ---------- линия ----------
{
  const replaced = E.reshapeLine([[0, 0], [200, 0]], [[50, -20], [100, 40], [150, -20]]);
  assert.ok(replaced.line.some(p => Math.abs(p[1] - 40) < 1e-6),
    "середина линии обязана пройти через вершину пути");
  assert.ok(Math.abs(replaced.line[0][0]) < 1e-9 && Math.abs(replaced.line[replaced.line.length - 1][0] - 200) < 1e-9,
    "концы линии не трогаются");

  // ломаная в обратную сторону даёт ту же форму
  const reversed = E.reshapeLine([[0, 0], [200, 0]], [[150, -20], [100, 40], [50, -20]]);
  assert.equal(JSON.stringify(replaced.line.map(p => p.map(v => +v.toFixed(6)))),
    JSON.stringify(reversed.line.map(p => p.map(v => +v.toFixed(6)))),
    "направление черчения не должно менять результат");

  assert.equal(E.reshapeLine([[0, 0], [200, 0]], [[50, -20], [60, 20]]).line, null,
    "одно пересечение линии — отказ");
}

// ---------- проводка ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /data-tool="reshape"/, "инструмент обязан быть на панели");
  assert.match(cmdk, /Изменить форму \(reshape\)/, "и в палитре");
  assert.match(app, /dim: "polyline", split: "polyline", reshape: "polyline"/,
    "ломаная собирается тем же черчением, что разрез");
  assert.match(app, /function reshapeByLine\(cut\)/);
  assert.match(app, /Ломаная задевает \$\{results\.length\} объектов — выделите один/,
    "несколько кандидатов — просьба выделить, а не правка всех подряд");
  assert.match(app, /Новая форма отрезает дыру полигона/,
    "вырез, съедающий дыру, обязан отклоняться — иначе геометрия станет враньём");
  assert.match(app, /"split", "identify", "offset", "reshape"\]/,
    "инструмент гаснет без объектов");
}

console.log("reshape: OK");
