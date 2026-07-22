"use strict";

// Масштаб с отрицательным коэффициентом — это центральная симметрия: центр дуги
// отражается через опорную точку, и КАЖДАЯ её точка обязана уехать на угол +π.
// Раньше a0 оставался прежним, и дуга оказывалась на противоположной стороне
// своей окружности относительно правильного положения.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app-transform.js"), "utf8");
const start = source.indexOf("function xfMappers(");
const end = source.indexOf("function xfApplyFromOrig(");
assert.ok(start >= 0 && end > start, "мапперы преобразований должны оставаться извлекаемыми");

const context = vm.createContext({ Math, state: { mouse: null } });
vm.runInContext(source.slice(start, end), context);
const { xfMappers } = context;

const arc = { cx: 100, cy: 0, r: 50, a0: 0, sweep: Math.PI / 2 };
const pointAt = (a, angle) => [a.cx + a.r * Math.cos(angle), a.cy + a.r * Math.sin(angle)];
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- отрицательный масштаб: центральная симметрия ---
const flipped = xfMappers({ kind: "scale", val: -1, pivot: [0, 0] }).arc(arc);
assert.ok(near(flipped.cx, -100) && near(flipped.cy, 0), "центр обязан отразиться через опорную точку");
assert.ok(near(flipped.a0, arc.a0 + Math.PI), "a0 обязан сдвинуться на 180°");
assert.equal(flipped.sweep, arc.sweep, "развёртка при подобии не меняется");
assert.equal(flipped.r, arc.r, "|-1| не меняет радиус");

// каждая точка дуги — в центральной симметрии относительно опорной точки
for (const k of [0, 0.25, 0.5, 0.75, 1]) {
  const before = pointAt(arc, arc.a0 + arc.sweep * k);
  const after = pointAt(flipped, flipped.a0 + flipped.sweep * k);
  assert.ok(near(after[0], -before[0]) && near(after[1], -before[1]),
    `точка дуги на ${k * 100}% развёртки обязана перейти в центрально-симметричную: ` +
    `[${before}] → ожидалось [${before.map(v => -v)}], получено [${after}]`);
}

// --- положительный масштаб углы не трогает ---
const scaled = xfMappers({ kind: "scale", val: 2, pivot: [0, 0] }).arc(arc);
assert.equal(scaled.a0, arc.a0, "при положительном коэффициенте поворота быть не должно");
assert.equal(scaled.r, arc.r * 2, "радиус масштабируется по модулю коэффициента");

// --- отрицательный масштаб с модулем ≠ 1 ---
const both = xfMappers({ kind: "scale", val: -2, pivot: [10, 10] }).arc(arc);
assert.equal(both.r, arc.r * 2, "радиус берётся по модулю");
assert.ok(near(both.a0, arc.a0 + Math.PI), "разворот на 180° не зависит от модуля");
const b0 = pointAt(arc, arc.a0), a0p = pointAt(both, both.a0);
assert.ok(near(a0p[0], 10 + (b0[0] - 10) * -2) && near(a0p[1], 10 + (b0[1] - 10) * -2),
  "точка обязана лечь туда же, куда её отправляет точечный маппер");

// окружность разворота не требует — она симметрична
const circle = xfMappers({ kind: "scale", val: -1, pivot: [0, 0] }).circle({ cx: 100, cy: 0, r: 50 });
assert.ok(near(circle.cx, -100) && near(circle.r, 50));

console.log("transform-negative-scale: OK");
