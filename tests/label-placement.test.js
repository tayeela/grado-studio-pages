"use strict";

// Движок подписей (аналог label placement в QGIS). Что здесь важно:
// 1. Точка подписи полигона — полюс недоступности, а не среднее вершин: у
//    подковы, поймы и зоны вдоль набережной среднее лежит ВНЕ контура, и
//    подпись уезжала на соседа. Та же ошибка была у стороны засечек.
// 2. Сетка занятости одна на кадр: раньше их было по одной на слой, и подписи
//    разных слоёв садились друг на друга.
// 3. Спорное место достаётся важному, а не тому, кого раньше нарисовали.
// 4. Подпись, которая шире объекта, не ставится вовсе: «5 этажей» шириной
//    с квартал поверх соседнего здания читается как чужая.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-labels.js"));
const L = globalThis.GRADO_LABELS;
assert.ok(L && typeof L.poleOfInaccessibility === "function", "модуль обязан подниматься без документа");

const mean = ring => ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
const inside = (point, rings) => L.signedDistance(point[0], point[1], rings) > 0;

// ---------- точка подписи всегда внутри контура ----------
{
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(inside(L.poleOfInaccessibility([square]), [square]), "квадрат");

  const horseshoe = [[0, 0], [100, 0], [100, 30], [70, 30], [70, 10], [30, 10], [30, 30], [0, 30]];
  assert.ok(!inside(mean(horseshoe), [horseshoe]), "у подковы среднее вершин снаружи — на этом ломалось");
  assert.ok(inside(L.poleOfInaccessibility([horseshoe]), [horseshoe]), "подкова");

  // извилистая пойма: много вогнутостей подряд
  const river = [];
  for (let i = 0; i <= 20; i++) river.push([i * 10, Math.sin(i / 2) * 25]);
  for (let i = 20; i >= 0; i--) river.push([i * 10, Math.sin(i / 2) * 25 + 14]);
  assert.ok(!inside(mean(river), [river]), "у поймы среднее вершин снаружи");
  assert.ok(inside(L.poleOfInaccessibility([river]), [river]), "пойма");

  // полигон с дырой: подпись не должна попасть в дыру
  const outer = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const hole = [[10, 10], [90, 10], [90, 90], [10, 90]];
  const at = L.poleOfInaccessibility([outer, hole]);
  assert.ok(inside(at, [outer, hole]), `подпись выколотого полигона села в дыру: ${at}`);

  // и она действительно «глубокая», а не у самого края
  const corridor = [[0, 0], [400, 0], [400, 40], [0, 40]];
  const deep = L.poleOfInaccessibility([corridor]);
  assert.ok(Math.abs(deep[1] - 20) < 2, `в коридоре подпись обязана идти по оси, а не по краю: ${deep}`);
}

// ---------- раскладка ----------
const job = (text, x, y, extra = {}) => ({ text, x, y, width: 40, height: 12, ...extra });

{
  // два кандидата на одно место: побеждает важный, а не первый в списке
  const placed = L.layout([job("фоновый", 100, 100, { priority: 10 }),
                           job("верхний", 100, 100, { priority: 900 })]);
  assert.equal(placed.length, 1, "на одном месте остаётся одна подпись");
  assert.equal(placed[0].text, "верхний", "место достаётся важному");

  // далеко друг от друга — обе на месте
  const both = L.layout([job("слева", 0, 0, { priority: 1 }), job("справа", 500, 500, { priority: 2 })]);
  assert.equal(both.length, 2, "непересекающиеся подписи обязаны ставиться обе");

  // одна сетка на все задания: подписи разных слоёв обязаны видеть друг друга
  const grid = L.createGrid();
  const first = L.layout([job("слой А", 50, 50, { priority: 5 })], { grid });
  const second = L.layout([job("слой Б", 55, 52, { priority: 900 })], { grid });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, "вторая раскладка обязана видеть занятое первой");
}

{
  // подпись шире объекта не ставится
  const tight = L.layout([job("длинная строка", 100, 100, { width: 120, fit: [90, 90, 110, 110] })]);
  assert.equal(tight.length, 0, "подпись шире объекта читается как чужая — её не ставим");
  const roomy = L.layout([job("влезает", 100, 100, { width: 15, fit: [50, 90, 150, 110] })]);
  assert.equal(roomy.length, 1, "а помещающаяся — ставится");
}

{
  // точка: подпись обходит занятые места по кандидатам вокруг знака
  const candidates = L.aroundPoint(4);
  assert.ok(candidates.length >= 4, "у точки обязано быть несколько мест");
  assert.deepEqual(candidates[0].map(Math.sign), [1, -1], "первое место — справа сверху, как в QGIS");
  const grid = L.createGrid();
  L.layout([job("занято", 107, 93, { priority: 900 })], { grid });     // первое место занято
  const placed = L.layout([job("точка", 100, 100, { priority: 1, candidates })], { grid });
  assert.equal(placed.length, 1, "подпись точки обязана подвинуться, а не пропасть");
  assert.notDeepEqual([placed[0].x, placed[0].y], [107, 93], "и встать на другое место");
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const styleUi = fs.readFileSync(path.join(root, "app-style-ui.js"), "utf8");

  assert.ok(html.indexOf('src="./app-labels.js') < html.indexOf('src="./app.js'),
    "движок обязан подниматься до app.js");
  assert.match(app, /const _labelGrid = LABELS \? LABELS\.createGrid\(\) : null;/,
    "сетка занятости — одна на кадр");
  assert.doesNotMatch(app, /_placedLabels/, "старая сетка по слою обязана исчезнуть целиком");
  assert.match(app, /function labelAnchor\(f\)/, "точка подписи полигона обязана считаться отдельно");
  assert.match(app, /LABELS\.poleOfInaccessibility\(rings\)/,
    "и быть полюсом недоступности, а не средним вершин");
  assert.match(app, /const _anchorCache = new WeakMap\(\);/,
    "полюс обязан кешироваться: на 20 000 подписанных зданий пересчёт каждый кадр невозможен");
  assert.match(app, /const stamp = `\$\{ring\.length\}\|/,
    "но правка вершины обязана сбрасывать кеш");
  assert.match(app, /drawLineLabel\(pts, st\.line_label, .+, _labelGrid\)/,
    "подпись знака вдоль линии обязана занимать место в общей сетке");
  assert.match(app, /ctx\.strokeText\(job\.text, job\.x, job\.y\)/,
    "у подписи обязан быть ореол — иначе она не читается поверх заливки и снимка");
  // подписи собираются, а не рисуются на месте: иначе приоритет не работает
  const jobs = app.slice(app.indexOf("if (st.label_field) {"), app.indexOf("if (state.selectedIds.has(f.id))"));
  assert.match(jobs, /_labelJobs\.push\(job\)/, "подпись обязана попадать в общий список");
  assert.doesNotMatch(jobs, /ctx\.fillText/, "и не рисоваться сразу");
  // ранний отсев по габариту объекта
  assert.match(app, /if \(f\.ring && \(fit\[2\] - fit\[0\] < size \|\| fit\[3\] - fit\[1\] < size\)\) return null;/,
    "подпись, которой негде поместиться, не должна даже собираться");
  // подписи теперь не только у полигонов
  assert.match(styleUi, /const canLabel = layer\.kind !== "dim";/,
    "поле подписи обязано быть доступно и точечным, и линейным слоям");
  assert.match(styleUi, /\$\{canLabel \?/, "секция подписи больше не полигональная");
}

console.log("label-placement: OK");
