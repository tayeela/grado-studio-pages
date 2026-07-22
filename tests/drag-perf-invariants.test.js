"use strict";

// Две горячие точки перетаскивания на больших выгрузках:
//   1) индекс привязок обнулялся на КАЖДОЕ движение мыши и строился заново по
//      всем объектам — O(все сегменты) на кадр;
//   2) общие вершины покрытийных слоёв искались заново на каждом кадре —
//      O(вершин × объектов × вершин).
// Оба инварианта легко потерять при правке обработчика, поэтому проверяем форму
// кода: измеримой единицы здесь нет — логика живёт внутри pointermove.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// --- 1. индекс привязок не сбрасывается вслепую на каждом кадре ---
const editBlock = app.slice(app.indexOf("  if (state.edit) {"),
  app.indexOf("const s = cursorPoint(wx, wy);"));
assert.ok(editBlock.length > 0, "блок правки должен оставаться распознаваемым");

assert.match(editBlock, /let snapDirty = false;/,
  "нужен признак «двигали объекты вне exclude-набора»");
assert.match(editBlock, /if \(snapDirty\) state\._snapIndex = null;/,
  "сброс индекса привязок обязан быть условным");
assert.doesNotMatch(editBlock, /state\._ix = null; state\._snapIndex = null;\s*\n\s*draw\(\); return;\s*\n\s*\}\s*\n\s*const s = cursorPoint/,
  "безусловный сброс индекса в конце обработчика вернулся");

// признак ставится ровно там, где двигаются ЧУЖИЕ объекты
const compsAssign = editBlock.slice(editBlock.indexOf("ed.bodyComps"));
assert.match(compsAssign, /snapDirty = true/,
  "перенос общей вершины соседа обязан помечать индекс устаревшим");

// --- 2. общие вершины ищутся один раз за жест ---
const downIdx = app.indexOf('state.edit = { vi: "body"');
assert.ok(downIdx > 0, "инициализация перетаскивания тела должна оставаться распознаваемой");
const downBlock = app.slice(downIdx - 900, downIdx + 300);
assert.match(downBlock, /const bodyComps = \[\]/,
  "кэш общих вершин собирается при pointerdown");
assert.match(downBlock, /sharedCompanions\(feat, vi\)/,
  "и именно через sharedCompanions");
assert.match(downBlock, /state\.edit = \{ vi: "body",[^}]*bodyComps/,
  "кэш обязан попасть в состояние жеста");

// в самом обработчике движения sharedCompanions больше не зовётся
assert.doesNotMatch(editBlock, /sharedCompanions\(/,
  "на каждом кадре общие вершины пересчитываться не должны");
assert.match(editBlock, /for \(const \{ feat, vi, comps \} of \(ed\.bodyComps \|\| \[\]\)\)/,
  "движение обязано идти по готовому кэшу");

// --- 3. после жеста индексы всё равно обновляются ---
const afterChange = app.slice(app.indexOf("function afterChange()"),
  app.indexOf("function afterChange()") + 200);
assert.match(afterChange, /state\._ix = null; state\._snapIndex = null;/,
  "afterChange обязан сбрасывать индексы — иначе пропуск сброса в drag протечёт");

console.log("drag-perf-invariants: OK");
