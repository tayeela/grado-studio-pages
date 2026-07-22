"use strict";

// Тёмная тема переопределяла только поверхности и текст: акцент и ВЕСЬ холст
// оставались светлыми. Граница территории #303640 на холсте #1d2023 давала
// 1.35:1 — основную линию чертежа было почти не видно; акцент 2.87:1 не
// дотягивал до AA.
// Второе: акцент и цвета состояний работают в ДВУХ ролях. Светлый синий
// читается текстом на панели (5.1:1), но белый на нём — 3.4:1; фирменный
// #315bea наоборот. Роли разведены: --accent / --accent-solid, и то же для
// success/warning/danger (--*-text).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const atelier = fs.readFileSync(path.join(root, "redesign", "atelier.css"), "utf8");
const tokens = fs.readFileSync(path.join(root, "tokens.css"), "utf8");
const cssFiles = ["redesign/shell.css", "redesign/studio2.css", "redesign/atelier.css",
  "redesign/layers-studio.css"].map(f => [f, fs.readFileSync(path.join(root, f), "utf8")]);

const srgb = hex => { const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luminance = hex => { const [r, g, b] = srgb(hex).map(v => { const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };

// блок тёмной темы ателье — источник правды для холста и акцента
const darkBlock = atelier.slice(atelier.indexOf('[data-theme="dark"]{'),
  atelier.indexOf("}", atelier.indexOf('[data-theme="dark"]{')));
const token = (block, name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block);
  assert.ok(m, `в тёмной теме обязан быть переопределён --${name}`);
  return m[1];
};
const canvas = token(darkBlock, "canvas-bg");
const panel = token(darkBlock, "panel");
const field = token(darkBlock, "field-bg");

// ---------- холст читается ----------
const AA = 4.5, GRAPHIC = 3;
const boundary = token(darkBlock, "canvas-boundary");
assert.ok(contrast(boundary, canvas) >= 7,
  `основная линия чертежа на тёмном холсте: ${contrast(boundary, canvas)}:1 — это тушь по бумаге, а не намёк`);
assert.ok(contrast(token(darkBlock, "canvas-label"), canvas) >= AA,
  "подписи объектов — это текст, порог 4.5:1");
for (const name of ["canvas-selection", "canvas-vertex", "canvas-shared", "canvas-redline",
  "zone-a-line", "zone-b-line", "zone-green-line"]) {
  const value = token(darkBlock, name);
  assert.ok(contrast(value, canvas) >= GRAPHIC,
    `${name} на тёмном холсте: ${contrast(value, canvas)}:1 — линию должно быть видно`);
}

// ---------- две роли акцента ----------
const accent = token(darkBlock, "accent");
const solid = token(darkBlock, "accent-solid");
assert.ok(contrast(accent, panel) >= AA && contrast(accent, field) >= AA,
  `акцент текстом на тёмной панели: ${contrast(accent, panel)}:1 / на поле ${contrast(accent, field)}:1`);
assert.ok(contrast("#ffffff", solid) >= AA,
  `белый текст на заливке акцента: ${contrast("#ffffff", solid)}:1 — это подписи кнопок`);
assert.notEqual(accent, solid, "на тёмной теме роли обязаны расходиться — в этом весь смысл разделения");
// светлая тема: роли совпадают, но обе обязаны существовать
assert.match(atelier, /--accent-solid:#315bea;/, "у светлой темы заливка — фирменный синий");
assert.match(tokens, /--accent-solid:\s*#3b63f6;/, "токен обязан быть и в базовом наборе");

// заливки обязаны брать именно роль заливки, иначе белый текст снова упрётся в 3.4:1
for (const [name, css] of cssFiles) {
  const stray = css.match(/background(-color)?:\s*var\(--accent\)(?!-)/g);
  assert.equal(stray, null, `${name}: заливка акцентом обязана идти через --accent-solid`);
}

// ---------- состояния текстом ----------
const lightRoles = { "success-text": "#107f3a", "warning-text": "#a55a05", "danger-text": "#d52525" };
const darkRoles = { "success-text": "#23a955", "warning-text": "#da7b0d", "danger-text": "#e86e6e" };
const lightPanel = /--panel:(#[0-9a-f]{6})/i.exec(atelier)[1];
for (const [name, value] of Object.entries(lightRoles)) {
  assert.ok(tokens.includes(`--${name}: ${value}`), `светлая тема: --${name}`);
  assert.ok(contrast(value, lightPanel) >= AA, `${name} на светлой панели: ${contrast(value, lightPanel)}:1`);
}
for (const [name, value] of Object.entries(darkRoles)) {
  assert.ok(tokens.includes(`--${name}: ${value}`), `тёмная тема: --${name}`);
  assert.ok(contrast(value, panel) >= AA, `${name} на тёмной панели: ${contrast(value, panel)}:1`);
}
for (const [name, css] of cssFiles) {
  const stray = css.match(/color:\s*var\(--(success|warning|danger)\)(?!-)/g);
  assert.equal(stray, null, `${name}: текст состояния обязан идти через --*-text`);
}

// ---------- тени ----------
// тень цветом светлой темы на тёмном фоне не читается вовсе
assert.match(darkBlock, /--shadow-md:0 8px 22px rgba\(0,0,0,\.55\)/,
  "тёмной теме нужна своя тень, иначе слои сливаются");

console.log("dark-theme-and-roles: OK");
