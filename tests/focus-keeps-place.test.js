"use strict";

// Окно выгрузки перерисовывает своё тело целиком. Вместе с телом пропадал
// элемент, на котором стоял фокус, и клавиатурный пользователь оказывался на
// <body> ЗА модальным окном: следующий Tab уводил в интерфейс под ним. Ловилось
// это только с клавиатуры — мышью незаметно.
// Второе: холст и разделитель панели берут фокус (обзор объектов с клавиатуры,
// изменение ширины стрелками), но не показывали его ничем.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const data = fs.readFileSync(path.join(root, "app-data.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "redesign", "shell.css"), "utf8");

// ---------- фокус переживает перерисовку ----------
const render = data.slice(data.indexOf("const focusMark = element =>"), data.indexOf("const visibleKeys ="));
assert.ok(render.length > 200, "перерисовка окна выгрузки должна оставаться извлекаемой");
assert.match(render, /const active = document\.activeElement;\s*\r?\n\s*const mark = focusMark\(active\);/,
  "перед перерисовкой нужно запомнить, на чём стоял фокус");
assert.match(render, /const caret = active && typeof active\.selectionStart === "number"/,
  "в поле поиска нужно вернуть и позицию курсора, иначе набор текста сбивается");
assert.match(render, /again\.focus\(\{ preventScroll: true \}\)/,
  "фокус обязан вернуться на тот же элемент");
assert.match(render, /if \(!overlay\.contains\(document\.activeElement\)\)/,
  "если возвращать некуда — фокус обязан остаться в окне, а не уйти за него");
// метка ищется по устойчивым признакам, а не по позиции в списке
for (const attr of ["data-src", "data-action", "data-group", "data-topic", "data-code", "id"])
  assert.ok(render.includes(`"${attr}"`), `метка фокуса обязана учитывать ${attr}`);
assert.match(render, /CSS\.escape\(value\)/,
  "код слоя портала попадает в селектор — его обязательно экранировать");

// ---------- видимый фокус там, где его не было ----------
assert.match(shell, /#cv:focus-visible\{outline:2px solid var\(--accent\);outline-offset:-3px\}/,
  "холст берёт фокус с клавиатуры и обязан это показывать");
assert.match(shell, /#panel-resizer:focus-visible\{outline:2px solid var\(--accent\)/,
  "границу панели двигают стрелками — она обязана быть видна с клавиатуры");

console.log("focus-keeps-place: OK");
