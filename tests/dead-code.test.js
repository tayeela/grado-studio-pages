"use strict";

// Объявления, на которые никто не ссылается.
//
// Мёртвая функция хуже отсутствующей: её читают, на неё ориентируются при
// правках, её имя всплывает в поиске — и всё это впустую. Так в приложении
// жили openDataFetchLegacy (263 строки прежнего мастера данных) и
// importSourceFeatures, вытесненный транзакционным импортом: оба выглядели
// рабочим кодом и оба не вызывались ниоткуда.
//
// Считаем ВСЕ вхождения имени по всем исходникам, включая index.html: так
// учитываются и обработчики в разметке, и вызовы по строковому имени. Если
// имя встречается только там, где объявлено, — оно мертво.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ПРОПУСК = new Set(["vendor", "tests", "node_modules", "docs", ".git", ".github"]);

function исходники(dir = root, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ПРОПУСК.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...исходники(full, rel));
    else if (/\.(js|html)$/.test(entry.name) && entry.name !== "styles-lib.js")
      out.push({ rel, text: fs.readFileSync(full, "utf8") });
  }
  return out;
}

const все = исходники();
const js = все.filter(f => f.rel.endsWith(".js"));

const объявления = new Map();                 // имя -> [«файл:строка вид»]
for (const { rel, text } of js) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = /^(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!m) return;
    const [, kind, name] = m;
    if (!объявления.has(name)) объявления.set(name, []);
    объявления.get(name).push(`${rel}:${i + 1} (${kind})`);
  });
}
assert.ok(объявления.size > 400, `объявления найдены (нашлось ${объявления.size})`);

const мёртвые = [];
for (const [name, где] of объявления) {
  const pat = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g");
  const всего = все.reduce((sum, f) => sum + (f.text.match(pat) || []).length, 0);
  // вхождений не больше, чем самих объявлений → ссылок нет ни одной
  if (всего <= где.length) мёртвые.push(`${name} — ${где.join(", ")}`);
}

assert.equal(мёртвые.length, 0,
  "объявление без единой ссылки: код, который читают, но не исполняют:\n  " +
  мёртвые.join("\n  "));

console.log(`dead-code: OK (проверено ${объявления.size} объявлений)`);
