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
    // Ловим и `root.X`: модули-обёртки пишут `(function (root) {…})(window)`,
    // и `root.state` — ровно то же самое, что `window.state`. Сторож, который
    // знает только слово window, пропустил это в app-layer-diff.js: список
    // слоёв молча оказывался пустым, окно не открывалось, ошибок не было.
    for (const m of строка.matchAll(/(window|root)\.([A-Za-z_$][\w$]*)/g))
      if (лексические.has(m[2]))
        промахи.push(`${имя}:${i + 1}  ${m[1]}.${m[2]} — объявлено через const/let в ${лексические.get(m[2])}`);
  });
}

assert.deepEqual(промахи, [],
  "обращение к лексическому имени через window — всегда undefined, ошибки не будет:\n  " +
  промахи.join("\n  ") +
  "\n  Пишите имя напрямую (при нужде через typeof X === \"undefined\").");

// ---------- скучная, но работающая проверка на root.X ----------
//
// Разбор выше ловит `window.X`. Ту же ошибку можно написать как `root.X` —
// модули-обёртки объявлены как `(function (root) {…})(window)`, и `root.state`
// это ровно `window.state`. Я попробовал расширить общий разбор регуляркой и
// потратил на его отладку больше, чем он стоит: промахи не находились, хотя
// та же логика вне теста срабатывала.
//
// Поэтому здесь тупой список главных имён и прямой поиск. Скучно, зато
// понятно с первого взгляда и не ломается молча.
{
  const ГЛАВНЫЕ = ["state", "LAYERS_V2", "LAYER_BY_ID", "LAYER_BY_KIND", "STYLES_V2", "basemap"];
  const плохие = [];
  for (const [имя, путь] of файлы) {
    const текст = безКомментариев(fs.readFileSync(путь, "utf8"));
    for (const название of ГЛАВНЫЕ)
      if (текст.includes("root." + название))
        плохие.push(`${имя}: root.${название}`);
  }
  assert.deepEqual(плохие, [],
    "root.X — то же самое, что window.X: имя объявлено через const и на window " +
    "не попадает, обращение всегда даёт undefined:\n  " + плохие.join("\n  ") +
    "\n  Так в app-layer-diff.js список слоёв молча оказывался пустым: окно " +
    "не открывалось, ошибок в консоли не было.");
}

console.log("window-lexical-globals: OK");
