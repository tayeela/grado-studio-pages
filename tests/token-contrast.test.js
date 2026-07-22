"use strict";

// --faint набирает подписи 9–10px: счётчики слоёв, хинты командной палитры,
// заголовки групп ТЭП, метаданные библиотеки знаков. Это мелкий текст, для него
// WCAG AA требует 4.5:1. Токен легко «осветлить до красивого» и уронить контраст,
// поэтому порог зафиксирован тестом.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "redesign", "atelier.css"), "utf8");

const srgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `цвет должен быть шестизначным hex, получено «${hex}»`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = hex => {
  const [r, g, b] = srgb(hex).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// значения токенов по порядку объявления: первый блок — светлая тема, второй — тёмная
const faints = [...css.matchAll(/--faint:\s*(#[0-9a-f]{6})/gi)].map(m => m[1]);
const panels = [...css.matchAll(/--panel:\s*(#[0-9a-f]{6})/gi)].map(m => m[1]);
assert.equal(faints.length, 2, "ожидаются ровно два объявления --faint (светлая и тёмная тема)");
assert.ok(panels.length >= 2, "ожидаются объявления --panel для обеих тем");

const AA_SMALL = 4.5;
const themes = [
  { name: "светлая", faint: faints[0], panel: panels[0] },
  { name: "тёмная", faint: faints[1], panel: panels[1] },
];
for (const t of themes) {
  const ratio = contrast(t.faint, t.panel);
  assert.ok(ratio >= AA_SMALL,
    `${t.name} тема: --faint ${t.faint} на --panel ${t.panel} даёт ${ratio.toFixed(2)}:1, ` +
    `нужно ≥ ${AA_SMALL}:1 — этим цветом набраны подписи 9–10px`);
}

// проверка самого измерителя на эталонных парах
assert.ok(Math.abs(contrast("#ffffff", "#000000") - 21) < 0.01, "белое к чёрному — 21:1");
assert.ok(Math.abs(contrast("#777777", "#ffffff") - 4.48) < 0.05, "серый 777 к белому — ≈4.48:1");

console.log("token-contrast: OK —",
  themes.map(t => `${t.name} ${contrast(t.faint, t.panel).toFixed(2)}:1`).join(", "));
