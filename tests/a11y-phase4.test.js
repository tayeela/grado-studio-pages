"use strict";

// Доступность: чертёж живёт в canvas и скринридеру недоступен, поэтому каждая
// текстовая альтернатива на счету. Пять мест, где обещанное поведение
// расходилось с фактическим.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
const a11y = fs.readFileSync(path.join(root, "redesign", "a11y.js"), "utf8");

// --- контролы поповеров имеют доступное имя ---
for (const id of ["basemap-source", "basemap-opacity", "grid-step", "access-r"]) {
  assert.match(html, new RegExp(`<label for="${id}"`),
    `контрол #${id} обязан быть связан с подписью: без for= скринридер читает ` +
    `«поле со списком» без имени, а клик по подписи не фокусирует контрол`);
  assert.match(html, new RegExp(`id="${id}"`), `контрол #${id} должен существовать`);
}

// --- палитра объявлена aria-modal, значит фокус обязан оставаться внутри ---
assert.match(html, /id="cmdk"[^>]*aria-modal="true"/,
  "палитра объявлена модальной — фон скрыт от скринридера");
assert.match(cmdk, /e\.key === "Tab"[\s\S]{0,80}preventDefault/,
  "без перехвата Tab фокус уходит в скрытый от AT фон (WCAG 2.4.3)");

// aria-expanded комбобокса синхронизируется, а не стоит статично
assert.match(cmdk, /q\.setAttribute\("aria-expanded", "true"\)/, "открытие обязано выставлять aria-expanded");
assert.match(cmdk, /q\.setAttribute\("aria-expanded", "false"\)/, "закрытие обязано его снимать");

// --- Escape закрывает поповер и возвращает фокус на триггер ---
const popEscape = a11y.slice(a11y.indexOf("closest?.('.pop')"), a11y.indexOf("closest?.('.pop')") + 400);
assert.ok(popEscape.length > 20, "обработка Escape для поповеров должна остаться распознаваемой");
assert.match(popEscape, /event\.key === 'Escape'/, "поповер обязан реагировать на Escape");
assert.match(popEscape, /stopImmediatePropagation/,
  "иначе Escape провалится в глобальный обработчик и снимет выделение на холсте");
assert.match(popEscape, /trigger\?\.focus\(\)/, "фокус обязан вернуться на кнопку-триггер");

// --- живая область для выделения ---
assert.match(html, /id="sr-selection"[^>]*aria-live="polite"/,
  "смена выделения на canvas обязана объявляться живой областью");
assert.match(html, /id="sr-selection"[^>]*class="sr-only"/,
  "область служебная — визуально её быть не должно");
assert.match(app, /function announceSelection\(/, "описание выделения должно собираться явно");
assert.match(app, /if \(text === _srLastSelection\) return;/,
  "повтор того же текста нужно подавлять, иначе скринридер тараторит на каждый кадр");
const renderProps = app.slice(app.indexOf("function renderProps()"), app.indexOf("function renderProps()") + 200);
assert.match(renderProps, /announceSelection\(\)/, "объявление обязано идти из общего места отрисовки свойств");

// --- чип пустого состояния доступен с клавиатуры ---
const chip = app.slice(app.indexOf("function updateLayerStatus()"),
  app.indexOf("function updateLayerStatus()") + 1600);
assert.match(chip, /setAttribute\("role", "button"\)/, "кликабельный чип обязан быть кнопкой для AT");
assert.match(chip, /setAttribute\("tabindex", "0"\)/, "и попадать в порядок табуляции");
assert.match(chip, /chip\.onkeydown = event =>/, "Enter и пробел обязаны срабатывать");
assert.match(chip, /removeAttribute\("role"\)/,
  "в неинтерактивном состоянии роль нужно снимать — иначе подпись останется кнопкой");

console.log("a11y-phase4: OK");
