"use strict";

// Обрезка/продление дуги зажимали новую развёртку в ±180°. Дуга больше
// полуокружности (arcFrom3Pts строит такие намеренно) превращалась в своё
// дополнение с ДРУГОЙ стороны окружности: оставался не тот кусок, по которому
// кликнули, и остаток >180° после обрезки был невозможен в принципе.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function sweepLike(");
const end = source.indexOf("function extendArcAt(", start);
assert.ok(start >= 0 && end > start, "sweepLike must remain extractable for this test");

const context = vm.createContext({ Number, Math });
vm.runInContext(source.slice(start, end), context);
const { sweepLike } = context;

const deg = d => d * Math.PI / 180;
const asDeg = rad => Math.round(rad * 180 / Math.PI);

// ключевой случай: дуга 270° против часовой, обрезали немного —
// остаток 250° обязан остаться 250°, а не превратиться в −110°
assert.equal(asDeg(sweepLike(deg(250), deg(270))), 250,
  "остаток больше полуокружности сохраняется");
assert.equal(asDeg(sweepLike(deg(-110), deg(270))), 250,
  "сырая разность atan2 приводится к направлению исходного обхода");

// по часовой стрелке — зеркально
assert.equal(asDeg(sweepLike(deg(-250), deg(-270))), -250);
assert.equal(asDeg(sweepLike(deg(110), deg(-270))), -250);

// обычные дуги меньше полуокружности не трогаем
assert.equal(asDeg(sweepLike(deg(90), deg(120))), 90);
assert.equal(asDeg(sweepLike(deg(-90), deg(-120))), -90);
assert.equal(asDeg(sweepLike(deg(30), deg(45))), 30);

// направление берётся от ИСХОДНОЙ дуги, а не от знака разности
assert.ok(sweepLike(deg(-10), deg(90)) > 0, "положительная дуга остаётся положительной");
assert.ok(sweepLike(deg(10), deg(-90)) < 0, "отрицательная дуга остаётся отрицательной");

// вырожденные значения
assert.equal(sweepLike(0, deg(270)), 0, "нулевая развёртка не превращается в полный круг");
assert.equal(sweepLike(1e-12, deg(270)), 0, "дребезг округляется в ноль");
assert.ok(Number.isNaN(sweepLike(NaN, deg(90))), "NaN пробрасывается, а не подменяется");

// полный круг остаётся в пределах 360°
assert.ok(Math.abs(sweepLike(deg(359), deg(270))) <= 2 * Math.PI + 1e-9);

console.log("arc-sweep-normalize: OK");
