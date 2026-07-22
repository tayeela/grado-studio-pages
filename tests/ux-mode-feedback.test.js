"use strict";

// Обратная связь режимов: подсказка должна быть видимой и на русском, а бейдж
// «живой расчёт» — отражать реальное состояние расчёта, а не гореть всегда.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "redesign", "studio2.css"), "utf8");

// --- подсказка режима видима ---
const hintTag = /<span id="st-hint"([^>]*)>/.exec(html);
assert.ok(hintTag, "элемент подсказки режима должен остаться в разметке");
assert.doesNotMatch(hintTag[1], /display\s*:\s*none/,
  "подсказку снова спрятали инлайн-стилем — её текст не увидит никто");

// --- мёртвый #st-core удалён вместе с записями ---
assert.doesNotMatch(html, /id="st-core"/,
  "#st-core был скрыт и без обработчика клика — возвращать его не нужно");
assert.doesNotMatch(app, /getElementById\("st-core"\)/,
  "запись в удалённый узел уронит расчёт");

// --- внутренние id инструментов не утекают в интерфейс ---
const setTool = app.slice(app.indexOf("function setTool("), app.indexOf("function setTool(") + 2600);
assert.doesNotMatch(setTool, /Режим \$\{tool\}/,
  "название инструмента обязано подставляться по-русски, а не внутренним id");
for (const ru of ["Обрезать", "Продлить", "Сопрячь"])
  assert.ok(setTool.includes(ru), `режим «${ru}» должен называться так же, как в тулбаре`);

// --- у «Сопрячь» есть озвучиваемая подсказка, а не только строка статуса ---
const fillet = setTool.slice(setTool.indexOf('tool === "fillet"'));
assert.match(fillet, /toast\(/,
  "после диалога радиуса пользователь оставался без единой инструкции");

// --- подсказка очищается при возврате к обычному инструменту ---
assert.match(setTool, /setHint\(""\)/,
  "иначе подсказка прошлого режима останется висеть навсегда");

// --- индикатор расчёта отражает состояние ---
assert.match(app, /function setTepMode\(/, "режим расчёта должен выставляться явно");
for (const mode of ["live", "error", "manual"])
  assert.ok(app.includes(`setTepMode("${mode}")`), `режим «${mode}» не выставляется`);
assert.match(css, /#panel\[data-tep-mode="error"\][^{]*\.panel-tab-live\{background:var\(--danger\)/,
  "при потере связи точка обязана перестать быть зелёной");
assert.match(css, /#panel\[data-tep-mode="(error|manual)"\][\s\S]{0,120}\.tep-live\{display:none\}/,
  "бейдж «живой расчёт» не должен висеть рядом с «нет связи с расчётом»");

// --- кнопка привязок называет то, что делает ---
const snapBtn = /<button[^>]*id="btn-snap"[^>]*>([\s\S]*?)<\/button>/.exec(html);
assert.ok(snapBtn, "кнопка привязок должна остаться");
assert.doesNotMatch(snapBtn[0], /aria-label="Привязки"/,
  "кнопка переключает только объектную привязку — общее название вводит в заблуждение");
assert.match(snapBtn[0], /К объектам/,
  "к сетке привязка живёт отдельно (клавиша C), это должно быть видно из названия");

console.log("ux-mode-feedback: OK");
