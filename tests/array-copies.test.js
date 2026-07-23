"use strict";

// Массив копий (array из AutoCAD). Что здесь важно:
// 1. Прямоугольный: сетка N×M, место (0,0) — сам исходный объект, копий N×M−1.
// 2. Полярный: центр задаётся ПОЛЯМИ, а не берётся из выделения — вокруг
//    центра самого объекта крутить бессмысленно, все копии совпали бы
//    с исходной (эта вырожденность поймана живой проверкой).
// 3. «Не поворачивать копии»: центр объекта едет по кругу, сама геометрия
//    остаётся в исходной ориентации.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

// вырезаем чистые функции
const context = vm.createContext({ Math });
for (const head of ["function arrayTransformed(f, dx, dy, rotation) {",
  "function arrayPlacements(mode, opts, center) {"]) {
  const at = app.indexOf(head);
  assert.ok(at > 0, `не найдено: ${head}`);
  const end = app.indexOf("\n}", at) + 2;
  vm.runInContext(app.slice(at, end), context);
}
const transformed = vm.runInContext("arrayTransformed", context);
const placements = vm.runInContext("arrayPlacements", context);

// ---------- прямоугольный ----------
{
  const grid = placements("rect", { cols: 3, rows: 2, stepX: 30, stepY: 50 }, [0, 0]);
  assert.equal(grid.length, 5, "3×2 минус исходное место — пять копий");
  assert.ok(grid.some(p => p.dx === 60 && p.dy === 50), "дальний угол сетки на месте");
  assert.ok(!grid.some(p => p.dx === 0 && p.dy === 0), "исходное место не дублируется");

  const moved = transformed({ ring: [[0, 0], [20, 0], [20, 40], [0, 40]] }, 30, 50, null);
  assert.equal(JSON.stringify(moved.ring[0]), "[30,50]", "сдвиг точен (JSON: vm-массивы не проходят deepEqual)");
}

// ---------- полярный ----------
{
  const circle = placements("polar", { count: 8, sweep: 360 }, [105, 105]);
  assert.equal(circle.length, 7, "полный круг из восьми позиций — семь копий");
  // все копии точки (105, 205) обязаны лечь на радиус 100
  for (const place of circle) {
    const g = transformed({ point: [105, 205] }, place.dx, place.dy, place.rotation);
    const r = Math.hypot(g.point[0] - 105, g.point[1] - 105);
    assert.ok(Math.abs(r - 100) < 1e-9, `радиус уплыл: ${r}`);
  }
  // неполная дуга: последняя копия ложится ровно на её конец
  const fan = placements("polar", { count: 3, sweep: 90 }, [0, 0]);
  assert.equal(fan.length, 3, "у неполной дуги копий ровно count");
  const last = transformed({ point: [100, 0] }, 0, 0, fan[fan.length - 1].rotation);
  assert.ok(Math.abs(last.point[0]) < 1e-9 && Math.abs(last.point[1] - 100) < 1e-9,
    "последняя копия на конце дуги 90°");
}

// ---------- дуги и окружности ----------
{
  const quarter = { cx: 0, cy: 0, ang: Math.PI / 2 };
  const circle = transformed({ circle: { cx: 100, cy: 0, r: 20 } }, 0, 0, quarter);
  assert.ok(Math.abs(circle.circle.cx) < 1e-9 && Math.abs(circle.circle.cy - 100) < 1e-9,
    "центр окружности вращается");
  assert.equal(circle.circle.r, 20, "радиус не трогается");
  const arc = transformed({ arc: { cx: 100, cy: 0, r: 10, a0: 0, sweep: 1 } }, 0, 0, quarter);
  assert.ok(Math.abs(arc.arc.a0 - Math.PI / 2) < 1e-9, "начальный угол дуги доворачивается");
}

// ---------- проводка ----------
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /id="btn-array"/, "кнопка обязана быть на панели «Правка»");
  assert.match(cmdk, /Массив копий…/, "и в палитре");
  assert.match(app, /id="ar-cx"/, "центр полярного задаётся полями — вокруг себя крутить бессмысленно");
  assert.match(app, /arrayDrawOverlay\(ctx\);/, "предпросмотр рисуется поверх чертежа");
  assert.match(app, /"btn-simplify", "btn-array"\]/, "кнопка гаснет в пустом проекте");
  assert.match(app, /props: cloneVariantValue\(f\.props \|\| \{\}\)/,
    "атрибуты исходного объекта едут в копии");
}

console.log("array-copies: OK");
