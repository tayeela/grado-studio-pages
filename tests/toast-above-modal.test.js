"use strict";

// Тост живёт в статус-строке, а диалоги перекрывают её оверлеем. Сообщения,
// которые шлют САМИ диалоги (ошибки импорта, предупреждения мастера данных,
// отчёт о повреждённых объектах), оказывались под затемнением — их не видел
// никто. Правило поднимает строку над диалогом ровно на время показа.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const shell = fs.readFileSync(path.join(__dirname, "..", "redesign", "shell.css"), "utf8");
const tokens = fs.readFileSync(path.join(__dirname, "..", "tokens.css"), "utf8");

const rule = /\.statusbar:has\(#st-toast:not\(:empty\)\)\s*\{([^}]*)\}/.exec(shell);
assert.ok(rule, "правило подъёма статус-строки на время показа тоста потеряно");

const zIndex = /z-index:\s*([^;}]+)/.exec(rule[1]);
assert.ok(zIndex, "правило обязано задавать z-index");
assert.match(zIndex[1], /--z-modal/,
  "слой должен считаться ОТ токена диалога, иначе разъедется при его правке");

// подъём именно ВЫШЕ диалога, а не вровень
const bump = /calc\(\s*var\(--z-modal\)\s*\+\s*(\d+)\s*\)/.exec(zIndex[1]);
assert.ok(bump && Number(bump[1]) > 0,
  "к слою диалога нужен положительный сдвиг, иначе тост останется под оверлеем");

// базовый слой статус-строки не тронут: подъём только на время сообщения
const base = /\.statusbar\{[^}]*z-index:\s*var\(--z-panel\)/.exec(shell);
assert.ok(base, "в покое статус-строка обязана оставаться на слое панели");

// токены, от которых всё зависит, существуют и упорядочены
const zOf = name => {
  const m = new RegExp(`--z-${name}:\\s*(\\d+)`).exec(tokens);
  assert.ok(m, `токен --z-${name} должен быть объявлен`);
  return Number(m[1]);
};
assert.ok(zOf("modal") > zOf("panel"),
  "диалог обязан перекрывать панель — иначе поднимать строку незачем");

console.log("toast-above-modal: OK — статус-строка поднимается до z-modal +",
  bump[1], "на время показа сообщения");
