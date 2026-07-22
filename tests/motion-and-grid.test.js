"use strict";

// Движение было набрано вручную: семь длительностей (.1/.12/.14/.15/.16/.18/.2)
// и часть переходов без кривой вовсе — браузер брал свою «ease». Соседние
// свойства одного элемента ехали с разной скоростью и по разным кривым; глазом
// это читается как небрежность, а не как замысел.
// Размеры контролов — одиннадцать ступеней, включая нечётные 25/29/31/33.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tokens = fs.readFileSync(path.join(root, "tokens.css"), "utf8");
const files = ["redesign/shell.css", "redesign/studio2.css", "redesign/atelier.css",
  "redesign/layers-studio.css"].map(f => [f, fs.readFileSync(path.join(root, f), "utf8")]);

// ---------- ступени времени ----------
assert.match(tokens, /--dur-1:\s*\.12s;\s*--dur-2:\s*\.18s;/,
  "две ступени: микро-отклик и движение на экране");

for (const [name, css] of files) {
  for (const m of css.matchAll(/transition(?:-duration)?:\s*([^;}]+)/g)) {
    const value = m[1];
    // .01ms — это глушилка движения для prefers-reduced-motion, не ступень
    if (/\.01ms/.test(value)) continue;
    const literal = value.match(/(^|[\s,])\.?\d+(?:\.\d+)?m?s/g);
    assert.equal(literal, null,
      `${name}: длительность перехода «${value.trim().slice(0, 60)}» задана числом мимо ступеней`);
    // у каждой части перехода обязана быть кривая — иначе браузер подставит свою
    for (const part of value.split(",")) {
      if (!/var\(--dur-/.test(part)) continue;
      assert.match(part, /var\(--ease-(out|in-out)\)/,
        `${name}: «${part.trim()}» едет по браузерной кривой вместо фирменной`);
    }
  }
  // сырые кривые допустимы только в анимациях (бегунок загрузки)
  for (const m of css.matchAll(/transition:\s*([^;}]+)/g))
    assert.doesNotMatch(m[1], /(^|[\s,])ease(-in|-out|-in-out)?(?![-\w(])/,
      `${name}: сырая кривая в переходе «${m[1].trim().slice(0, 50)}»`);
}

// ---------- отклик на нажатие ----------
const presses = new Set();
for (const [, css] of files)
  for (const m of css.matchAll(/:active\{[^}]*transform:[^;}]*scale\(([\d.]+)\)/g)) presses.add(m[1]);
assert.deepEqual([...presses], [".97"],
  `нажатие обязано отзываться одинаково, найдено: ${[...presses].join(", ")}`);

// ---------- лестница размеров ----------
const offGrid = [];
for (const [name, css] of files)
  for (const m of css.matchAll(/(?:min-|max-)?(?:height|width):(\d+)px/g)) {
    const n = Number(m[1]);
    if (n >= 24 && n <= 40 && n % 4 !== 0) offGrid.push(`${name}:${n}px`);
  }
// 41px у полосы вкладок — 40 контента плюс разделитель под ней
assert.deepEqual(offGrid.filter(x => !x.endsWith(":41px")), [],
  `размеры контролов обязаны стоять на лестнице кратно 4: ${offGrid.join(", ")}`);

// ---------- уважение к системной настройке ----------
const shell = files.find(([n]) => n.endsWith("shell.css"))[1];
assert.match(shell, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important;transition-duration:\.01ms!important\}\}/,
  "выключенное движение в системе обязано выключать движение в интерфейсе");

console.log("motion-and-grid: OK");
