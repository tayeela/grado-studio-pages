"use strict";

// Упростить (Дуглас-Пекер) и сгладить (Чайкин). Что здесь важно:
// 1. Упрощение с допуском обязано снимать шум, не трогая форму: квадрат со
//    120 шумными вершинами при допуске больше шума становится ровно
//    четырёхугольником той же площади.
// 2. Кольцо остаётся кольцом: замыкающий дубль не плодится и не теряется.
// 3. Чайкин не двигает концы открытой линии и удваивает число точек за проход.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-edit.js"));
const E = globalThis.GRADO_EDIT;

const area = ring => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum / 2);
};

// ---------- упрощение ----------
{
  // шумная прямая: 101 точка с отклонением ±0.05
  const noisy = [];
  for (let i = 0; i <= 100; i++) noisy.push([i, i % 2 ? 0.05 : -0.05]);
  assert.equal(E.simplifyChain(noisy, 0.1).length, 2, "допуск больше шума оставляет два конца");
  assert.equal(E.simplifyChain(noisy, 0.01).length, 101, "допуск меньше шума не трогает ничего");

  // кольцо: квадрат, на каждом ребре 30 точек
  const ring = [];
  const corners = [[0, 0], [200, 0], [200, 150], [0, 150]];
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    for (let t = 0; t < 30; t++)
      ring.push([a[0] + (b[0] - a[0]) * t / 30, a[1] + (b[1] - a[1]) * t / 30]);
  }
  const simplified = E.simplifyChain(ring, 0.5, true);
  assert.ok(simplified.length <= 5, `квартал обязан схлопнуться к углам: ${simplified.length}`);
  assert.ok(Math.abs(area(simplified) - 30000) < 1, "площадь обязана сохраниться");
  // допуск монотонен: больше допуск — не больше вершин
  assert.ok(E.simplifyChain(ring, 5, true).length <= E.simplifyChain(ring, 0.5, true).length);

  // замыкающий дубль на входе не ломает кольцо
  const closedInput = [...ring, ring[0]];
  assert.ok(E.simplifyChain(closedInput, 0.5, true).length <= 5);
}

// ---------- сглаживание ----------
{
  const open = E.smoothChain([[0, 0], [50, 100], [100, 0]], 1, false);
  assert.deepEqual(open[0], [0, 0], "начало открытой линии не двигается");
  assert.deepEqual(open[open.length - 1], [100, 0], "конец — тоже");
  assert.ok(!open.some(p => p[1] > 99), "острая вершина обязана срезаться");

  assert.equal(E.smoothChain([[0, 0], [100, 0], [100, 100], [0, 100]], 1, true).length, 8,
    "замкнутый: пара точек на ребро");
  assert.equal(E.smoothChain([[0, 0], [100, 0], [100, 100], [0, 100]], 2, true).length, 16,
    "второй проход снова удваивает");
  // площадь после среза углов считается точно: первый проход снимает с
  // каждого угла треугольник 25×25/2 (−1250), второй — ещё 312,5 → 8437,5
  const smoothed = E.smoothChain([[0, 0], [100, 0], [100, 100], [0, 100]], 2, true);
  assert.ok(Math.abs(area(smoothed) - 8437.5) < 1,
    `площадь после Чайкина ${area(smoothed)}, расчёт даёт 8437.5`);
}

// ---------- проводка ----------
{
  const edit = fs.readFileSync(path.join(root, "app-edit.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /id="btn-simplify"/, "кнопка обязана быть на панели");
  assert.match(cmdk, /Упростить \/ сгладить геометрию…/, "и в палитре");
  assert.match(app, /if \(typeof simplifyDrawOverlay === "function"\) simplifyDrawOverlay\(ctx\);/,
    "предпросмотр обязан рисоваться поверх чертежа");
  assert.match(edit, /Пунктир на чертеже — предпросмотр результата/,
    "допуск в метрах на глаз не выбирается — предпросмотр обязателен");
  assert.match(edit, /выродилось бы — они не тронутся/,
    "вырожденные объекты пропускаются с объяснением, а не молча");
  assert.match(app, /"btn-join", "btn-buffer-open", "btn-merge", "btn-simplify", "btn-array"\]/,
    "кнопка гаснет в пустом проекте");
}

console.log("simplify-smooth: OK");
