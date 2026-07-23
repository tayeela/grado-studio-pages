"use strict";

// Измерение площади — базовый инструмент CAD/GIS, которого не было: мерить
// можно было только расстояние. Что здесь важно:
// 1. Контур собирается кликами, счёт живёт на холсте и следует за курсором;
//    Enter замыкает (счёт остаётся), Esc убирает.
// 2. Замыкающее ребро входит в периметр — иначе периметр врёт на одну сторону.
// 3. Инструмент ничего не создаёт: это измерение, а не черчение.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");

// ---------- проводка ----------
{
  assert.match(html, /data-tool="marea"/, "инструмент обязан быть в группе «Мера»");
  assert.match(cmdk, /Измерение площади/, "и в палитре команд");

  // клик копит точки и ничего не создаёт
  const clickAt = app.indexOf('} else if (state.tool === "marea") {');
  assert.ok(clickAt > 0, "ветка клика обязана существовать");
  const clickBranch = app.slice(clickAt, clickAt + 400);
  assert.match(clickBranch, /state\.measureArea\.pts\.push\(s\.p\);/,
    "клик добавляет точку контура — с привязкой, как всё черчение");
  assert.doesNotMatch(clickBranch, /addFeature|snapshot/,
    "измерение не создаёт объектов и не трогает историю");

  // отрисовка: площадь и в гектарах, и в метрах, периметр с замыкающим ребром
  assert.match(app, /fmtAreaHa\(area\)\} \(\$\{Math\.round\(area\)\.toLocaleString\("ru-RU"\)\} м²\) · периметр \$\{fmtLen\(per \+ closing\)\}/,
    "площадь в га и м², периметр — с замыкающим ребром");
  assert.match(app, /const closing = chain\.length > 2/,
    "замыкающее ребро считается только когда контур есть");

  // Enter замыкает, Esc убирает, смена инструмента чистит
  assert.match(app, /state\.measureArea\.done = true;/,
    "Enter обязан замыкать контур, оставляя счёт на экране");
  assert.match(app, /if \(state\.measureArea\) \{ state\.measureArea = null; draw\(\); return; \}/,
    "Esc обязан убирать измерение");
  assert.match(app, /if \(tool !== "marea"\) state\.measureArea = null;/,
    "смена инструмента не оставляет висящий контур");
}

console.log("measure-area: OK");
