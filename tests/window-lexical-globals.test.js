"use strict";

// window.X там, где X объявлен через const/let.
//
// В обычных скриптах `function f(){}` попадает на window, а `const state = {}`
// — НЕТ: он живёт в глобальной лексической области и снаружи через window
// невидим. Читать его как window.state можно вечно, ошибки не будет — просто
// всегда undefined.
//
// Так и случилось: `alignOgd: typeof window === "undefined" ||
// !(window.state && window.state.alignOgd === false)` давало true при любом
// состоянии галки, и выгрузки ГИС ОГД всегда сажались на границы ЕГРН,
// хотя человек поправку выключил. Молчаливо, без единого признака.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const файлы = [...fs.readdirSync(root).filter(f => /^app-.*\.js$|^pages-adapter\.js$/.test(f))
  .map(f => [f, path.join(root, f)]),
  ...fs.readdirSync(path.join(root, "redesign")).filter(f => f.endsWith(".js"))
    .map(f => ["redesign/" + f, path.join(root, "redesign", f)])];

// Комментарии режем: в них имя window.state упоминается как раз при объяснении,
// почему так писать нельзя.
const безКомментариев = текст => текст
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const лексические = new Map();
for (const [имя, путь] of файлы) {
  const s = fs.readFileSync(путь, "utf8");
  for (const m of безКомментариев(s).matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)/gm))
    if (!лексические.has(m[1])) лексические.set(m[1], имя);
}
assert.ok(лексические.size > 40,
  `лексических имён верхнего уровня всего ${лексические.size} — разбор сломался, проверка ослепла`);

const промахи = [];
for (const [имя, путь] of файлы) {
  const строки = безКомментариев(fs.readFileSync(путь, "utf8")).split("\n");
  строки.forEach((строка, i) => {
    for (const m of строка.matchAll(/window\.([A-Za-z_$][\w$]*)/g))
      if (лексические.has(m[1]))
        промахи.push(`${имя}:${i + 1}  window.${m[1]} — объявлено через const/let в ${лексические.get(m[1])}`);
  });
}

assert.deepEqual(промахи, [],
  "обращение к лексическому имени через window — всегда undefined, ошибки не будет:\n  " +
  промахи.join("\n  ") +
  "\n  Пишите имя напрямую (при нужде через typeof X === \"undefined\").");

console.log("window-lexical-globals: OK");
