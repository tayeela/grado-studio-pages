"use strict";

// Эквидистанта — параллельная копия на заданном расстоянии, как offset
// в AutoCAD. Что здесь важно:
// 1. Знак расстояния — сторона: положительное слева по ходу обхода.
// 2. Углы соединяются пересечением смещённых прямых; на острых углах, где
//    пересечение улетает дальше четырёх расстояний, ставится фаска — иначе
//    из угла торчит шип длиной в километры.
// 3. Замкнутый контур смещается замкнутым: сжатие квадрата 100 на 10 даёт
//    ровно 80×80, без скруглений (этим эквидистанта и отличается от буфера).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-edit.js"));
const E = globalThis.GRADO_EDIT;
assert.ok(typeof E.offsetChain === "function", "ядро обязано подниматься без документа");

const ringArea = ring => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum / 2);
};

// ---------- сторона и стыки ----------
{
  assert.deepEqual(E.offsetChain([[0, 0], [100, 0]], 10), [[0, 10], [100, 10]],
    "положительное расстояние — слева по ходу");
  assert.deepEqual(E.offsetChain([[0, 0], [100, 0]], -10), [[0, -10], [100, -10]],
    "отрицательное — справа");

  // прямой угол: стык пересечением, вершина одна
  assert.deepEqual(E.offsetChain([[0, 0], [100, 0], [100, 100]], 10),
    [[0, 10], [90, 10], [90, 100]], "прямой угол стыкуется пересечением");

  // коллинеарные рёбра не плодят точек
  const straight = E.offsetChain([[0, 0], [50, 0], [100, 0]], 10);
  assert.ok(straight.every(p => Math.abs(p[1] - 10) < 1e-9), "коллинеарная цепь остаётся прямой");
}

// ---------- острый угол: фаска вместо шипа ----------
{
  const sharp = E.offsetChain([[0, 0], [100, 0], [0, 10]], 8);
  const maxX = Math.max(...sharp.map(p => p[0]));
  assert.ok(maxX <= 100 + 8 * E.MITER_LIMIT,
    `на остром углу шип: x доходит до ${maxX}`);
  assert.ok(sharp.length >= 4, "фаска добавляет точку, а не теряет угол");
}

// ---------- замкнутый контур ----------
{
  // обход против часовой: слева — наружу... знак проверяем площадью
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const outward = E.offsetChain(square, -10, true);
  assert.ok(Math.abs(ringArea(outward) - 14400) < 1e-6,
    `наружу: 120×120 = 14400, вышло ${ringArea(outward)}`);
  const inward = E.offsetChain(square, 10, true);
  assert.ok(Math.abs(ringArea(inward) - 6400) < 1e-6,
    `внутрь: 80×80 = 6400, вышло ${ringArea(inward)} — углы НЕ скругляются`);
  assert.equal(inward.length, 4, "квадрат остаётся четырёхугольником");
}

// ---------- вырождение ----------
{
  assert.equal(E.offsetChain([[0, 0]], 10), null, "одной точки мало");
  assert.equal(E.offsetChain([[0, 0], [0, 0]], 10), null, "нулевое ребро — не линия");
  // замыкающая точка не даёт нулевого ребра
  const closed = E.offsetChain([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], 10, true);
  assert.equal(closed.length, 4, "дублированная замыкающая точка не ломает контур");
}

// ---------- проводка ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /data-tool="offset"/, "инструмент обязан быть на панели «Правка»");
  assert.match(cmdk, /Эквидистанта \(параллельная копия\)…/, "и в палитре команд");
  assert.match(app, /function handleOffsetClick\(wx, wy\)/);
  assert.match(app, /offsetSideOfClick\(f\.line, false, wx, wy\)/,
    "сторона у линии определяется кликом");
  assert.match(app, /const clickR = Math\.hypot\(wx - f\.circle\.cx, wy - f\.circle\.cy\);/,
    "у окружности сторона — внутрь или наружу от обводки");
  assert.match(app, /используйте «Буфер» со стороной/,
    "полигон с дырами честно отправляется к буферу, а не смещается враньём");
  assert.match(app, /props: cloneVariantValue\(f\.props \|\| \{\}\)/,
    "атрибуты исходного объекта едут в копию");
  assert.match(app, /"split", "identify", "offset"\]/, "инструмент гаснет без объектов");
}

console.log("offset-tool: OK");
