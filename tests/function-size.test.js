"use strict";

// Храповик на размер функций.
//
// Функция на несколько сотен строк — не стилистическая придирка: её нельзя
// целиком удержать в голове, поэтому правка в одном её конце не учитывает
// другой. Отсюда и берутся дефекты, которые чинишь по одному и которые
// возвращаются. Ровно этот класс закрывали треки A–D для интерфейса; здесь
// то же самое для кода.
//
// Переписывать все разом опаснее, чем оставить как есть: гиганты — рабочий
// код. Поэтому храповик, а не запрет: существующие могут только УМЕНЬШАТЬСЯ,
// новых сверх порога появляться не должно. Когда функция похудела — бюджет
// опускается за ней и назад уже не отпускает.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ПОРОГ = 150;          // выше этого функция обязана иметь бюджет
const ЛЮФТ = 20;            // насколько бюджет может отстать от факта

// Бюджеты сняты 24.07.2026. Уменьшать можно и нужно; увеличивать — нельзя.
const БЮДЖЕТ = {
  "app-style-ui.js openLayerStyle": 633,   // 847 → 734 → 633: разметка и редактор категории вынесены
  "app-data.js openDataFetch": 520,     // 556 → 520: строители шагов вынесены
  "app-labels-place.js drawNow": 306,   // 523 -> 306: пикетаж и живые подсказки вынесены
  "app-labels-place.js drawLiveHints": 204,  // вынесено из drawNow целиком, дословно
  "app-layer-panel.js renderLayers": 110,   // 270 -> 110: строка слоя вынесена
  "app-layer-panel.js layerPanelRow": 166,  // вынесено из renderLayers дословно
  "app-style-ui.js openStyleLibrary": 258,
  "app-layer-ui.js openVariants": 206,
  "app-shell.js applyRestoredState": 182,
  "app-tep.js renderProps": 178,
  "app-data.js openFgistpDialog": 158,
  "app-attr.js openAttributeTable": 157,
};

const files = fs.readdirSync(root)
  .filter(name => name.endsWith(".js") && name !== "styles-lib.js");

// Размер функции верхнего уровня — по балансу фигурных скобок от строки
// объявления. Грубо, но одинаково для всех, а сравниваем мы с самими собой.
function функции(source) {
  const lines = source.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (!m) continue;
    let depth = 0, started = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; started = true; }
        else if (ch === "}") depth--;
      }
      if (started && depth <= 0) { out.push({ name: m[1], size: j - i + 1 }); break; }
    }
  }
  return out;
}

const факт = new Map();
for (const file of files)
  for (const { name, size } of функции(fs.readFileSync(path.join(root, file), "utf8")))
    факт.set(`${file} ${name}`, Math.max(факт.get(`${file} ${name}`) || 0, size));

// ---------- 1. новых гигантов не появилось ----------
{
  const новые = [...факт].filter(([key, size]) => size > ПОРОГ && !(key in БЮДЖЕТ));
  assert.equal(новые.length, 0,
    `функция длиннее ${ПОРОГ} строк без бюджета. Разнесите ответственность ` +
    "или впишите бюджет осознанно:\n  " +
    новые.map(([k, s]) => `${k}: ${s} строк`).join("\n  "));
}

// ---------- 2. существующие не выросли ----------
{
  const выросли = [];
  for (const [key, бюджет] of Object.entries(БЮДЖЕТ)) {
    const size = факт.get(key);
    if (size === undefined) continue;                  // разнесли или переименовали
    if (size > бюджет) выросли.push(`${key}: ${size} строк при бюджете ${бюджет}`);
  }
  assert.equal(выросли.length, 0,
    "функция под бюджетом выросла — храповик крутится только в сторону " +
    "уменьшения:\n  " + выросли.join("\n  "));
}

// ---------- 3. бюджет опускается за фактом ----------
{
  const отставшие = [];
  for (const [key, бюджет] of Object.entries(БЮДЖЕТ)) {
    const size = факт.get(key);
    if (size === undefined) {
      отставшие.push(`${key}: функции больше нет — уберите строку из бюджета`);
    } else if (бюджет - size > ЛЮФТ) {
      отставшие.push(`${key}: стало ${size} строк при бюджете ${бюджет} — опустите бюджет`);
    }
  }
  assert.equal(отставшие.length, 0,
    "бюджет отстал от факта: не опустив его, храповик отпустит функцию " +
    "обратно вырасти:\n  " + отставшие.join("\n  "));
}

console.log(`function-size: OK (под бюджетом ${Object.keys(БЮДЖЕТ).length} функций)`);
