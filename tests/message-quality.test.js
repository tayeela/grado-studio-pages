"use strict";

// Качество сообщений (трек D спеки о слаженности).
//
// Сообщение — часть интерфейса. Два класса дефектов, из которых складывается
// ощущение наспех собранного:
//   1. Сообщение ВРЁТ о причине. Так было с «Функция требует настольную
//      версию с сервером»: до этой строки доходили, только если не загрузился
//      модуль листа, а вовсе не потому, что функции нет в браузере — лист,
//      DXF и буфер давно считаются прямо тут.
//   2. Ошибка без следующего шага: человеку сказали «не удалось» и оставили
//      в тупике.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = fs.readdirSync(root).filter(f => f.endsWith(".js") && f !== "styles-lib.js");
// Сообщение часто собирается склейкой: «не удалось …» + причина + совет.
// Поэтому берём вызов toast(...) ЦЕЛИКОМ (по балансу скобок) и склеиваем все
// строковые куски внутри — иначе совет, дописанный вторым слагаемым, не виден.
function toastCalls(src) {
  const out = [];
  const marker = "toast(";
  for (let at = src.indexOf(marker); at >= 0; at = src.indexOf(marker, at + 1)) {
    const before = src[at - 1] || "";
    if (/[A-Za-z0-9_$.]/.test(before)) continue;      // showToast(, obj.toast( и т.п.
    let depth = 0, end = -1;
    for (let i = at + marker.length - 1; i < src.length && i < at + 4000; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (!depth) { end = i; break; } }
    }
    if (end < 0) continue;
    const call = src.slice(at, end);
    const parts = [];
    const re = new RegExp("([\"'`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1", "g");
    let m;
    while ((m = re.exec(call))) parts.push(m[2]);
    if (parts.length) out.push(parts.join(" ").replace(/\$\{[^}]*\}/g, "…"));
  }
  return out;
}
const texts = [];
for (const file of files)
  for (const text of toastCalls(fs.readFileSync(path.join(root, file), "utf8")))
    texts.push({ file, text });
assert.ok(texts.length > 100, `сообщения найдены (нашлось ${texts.length})`);

// ---------- 1. не сваливаем на настольную версию то, что работает ----------
{
  // Всё, что раньше «требовало настольную версию», считается в браузере:
  // лист PDF, DXF, буфер, печать в масштабе. Ссылаться на неё в сообщении
  // теперь значит вводить в заблуждение.
  //
  // Настоящие ограничения браузера упоминать честно и МОЖНО, и нужно: ZIP-
  // выгрузки портала, пределы размера файла (браузер 64 МБ против 256 МБ) и
  // рельеф по области. Такое сообщение обязано называть само ограничение —
  // тогда человек понимает, почему, а не просто «идите в другую программу».
  const honest = /ZIP|МБ|рельеф/i;
  const lying = texts.filter(t => /настольн/i.test(t.text) && !honest.test(t.text));
  assert.equal(lying.length, 0,
    "сообщение ссылается на настольную версию там, где функция работает в браузере:\n  " +
    lying.map(t => `[${t.file}] ${t.text}`).join("\n  "));
}

// ---------- 2. у ошибки есть следующий шаг ----------
{
  const isError = t => /не удалось|нельзя|невозможно|не получилось/i.test(t.text);
  const hasNextStep = t => /выбер|выдел|нажм|попроб|укаж|созд|добав|уменьш|приблиз|сохран|повтор|провер|откр|включ|переключ|разблокир|очист|подожд|обнов|уточн/i.test(t.text);
  const stuck = texts.filter(t => isError(t) && !hasNextStep(t));
  assert.equal(stuck.length, 0,
    "ошибка без следующего шага — человек остаётся в тупике:\n  " +
    stuck.map(t => `[${t.file}] ${t.text}`).join("\n  "));
}

console.log("message-quality: OK");
