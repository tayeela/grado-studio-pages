"use strict";

// Целостность разреза холста.
//
// app.js разрезан на части, живущие в общей глобальной области. Разрез
// безопасен ровно до тех пор, пока выполняются три условия, и каждое из них
// ломается молча — приложение не падает, оно начинает вести себя иначе:
//
//   1. Порядок тегов в index.html совпадает с порядком частей. Порядок = тот
//      же, каким был порядок строк единого файла; переставленный `let` даёт
//      ReferenceError только в момент обращения, то есть у пользователя.
//   2. Ни одна часть не потеряна и ни одна не подключена дважды.
//   3. Каждая часть разбирается как самостоятельный скрипт — то есть разрез
//      прошёл между инструкциями верхнего уровня, а не посреди функции.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const PARTS = require("./app-source-parts");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// ---------- 1 и 2. порядок и полнота подключения ----------
{
  const loaded = [...html.matchAll(/src="\.\/(app[\w.-]*\.js)\?/g)].map(m => m[1]);
  const positions = PARTS.map(name => ({ name, at: loaded.indexOf(name) }));

  const missing = positions.filter(p => p.at < 0).map(p => p.name);
  assert.equal(missing.length, 0,
    "часть холста не подключена в index.html — всё, что в ней объявлено, " +
    "просто не существует в браузере:\n  " + missing.join("\n  "));

  for (const name of PARTS) {
    const count = loaded.filter(other => other === name).length;
    assert.equal(count, 1, `${name} подключён ${count} раза: повторная загрузка ` +
      "скрипта с top-level let роняет его на переобъявлении");
  }

  const order = positions.map(p => p.at);
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted,
    "порядок частей в index.html разошёлся с порядком разреза.\n" +
    "  ожидалось: " + PARTS.join(" → ") + "\n" +
    "  в разметке: " + PARTS.map((n, i) => `${n}@${order[i]}`).join(" "));
}

// ---------- 3. каждая часть — самостоятельный скрипт ----------
{
  for (const name of PARTS) {
    const file = path.join(root, name);
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      const detail = String(error.stderr || error.message).split("\n").slice(0, 3).join(" ");
      assert.fail(`${name} не разбирается как отдельный скрипт — значит разрез ` +
        `прошёл посреди функции: ${detail}`);
    }
  }
}

// ---------- 4. части не подменяют друг друга ----------
{
  // Одноимённая функция в двух частях — второй файл молча затирает первый:
  // порядок загрузки решает, чья версия победит. В едином файле такое
  // невозможно было не заметить, после разреза — легко.
  const seen = new Map();
  const dupes = [];
  for (const name of PARTS) {
    const source = fs.readFileSync(path.join(root, name), "utf8");
    for (const m of source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const fn = m[1];
      if (seen.has(fn) && seen.get(fn) !== name) dupes.push(`${fn}: ${seen.get(fn)} и ${name}`);
      else seen.set(fn, name);
    }
  }
  assert.equal(dupes.length, 0,
    "одна и та же функция объявлена в двух частях — побеждает загруженная " +
    "позже, и какая именно, зависит от порядка тегов:\n  " + dupes.join("\n  "));
}

console.log("split-integrity: OK");
