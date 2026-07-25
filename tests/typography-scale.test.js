"use strict";

// Размеры шрифта были вписаны числом мимо токенов: 10px оказался самым частым
// размером интерфейса (74 места) и токена для него не существовало вовсе.
// Из-за этого правка шкалы не влияла на половину подписей. Тест держит шкалу
// замкнутой: любой размер в CSS обязан идти через токен.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tokens = fs.readFileSync(path.join(root, "tokens.css"), "utf8");
const files = ["shell.css", "studio2.css", "atelier.css", "layers-studio.css"];

// шкала объявлена и включает служебные ступени
const declared = new Set([...tokens.matchAll(/--fs-(\d+):\s*(\d+)px/g)].map(m => Number(m[1])));
for (const step of [9, 10, 11, 12, 13, 15, 18, 22])
  assert.ok(declared.has(step), `ступень --fs-${step} должна быть объявлена в шкале`);

// значение токена совпадает с его именем — иначе шкала врёт
for (const m of tokens.matchAll(/--fs-(\d+):\s*(\d+)px/g))
  assert.equal(m[1], m[2], `--fs-${m[1]} обязан быть ${m[1]}px, объявлено ${m[2]}px`);

// в интерфейсных стилях не осталось хардкодов размеров ТЕКСТА
// Из исключений остался только 8px: шеврон дерева ОГД и два микро-бейджа —
// это глифы, а не читаемый текст. Прежний список (14/17/18/19/22) был не
// исключением, а дырой в шкале: между 15 и 20 ступеней не было, и заголовки
// окон писали числом по месту. Верхний ярус узаконен как 18 и 22.
const ALLOWED_RAW = new Set([8]);
const offenders = [];
for (const name of files) {
  // Комментарии режем: пояснение «раньше здесь стояло font-size:11px» — не код.
  const css = fs.readFileSync(path.join(root, "redesign", name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));   // строки сохраняем
  for (const m of css.matchAll(/font(?:-size)?:\s*(\d+)px/g)) {
    const size = Number(m[1]);
    if (ALLOWED_RAW.has(size)) continue;
    const line = css.slice(0, m.index).split("\n").length;
    offenders.push(`${name}:${line} — ${m[0]}`);
  }
}
assert.equal(offenders.length, 0,
  "размеры текста обязаны идти через токены шкалы, иначе её правка снова перестанет " +
  "действовать. Мимо токенов:\n  " + offenders.slice(0, 10).join("\n  "));

// служебные ступени реально используются — иначе токены мёртвые
for (const step of [9, 10, 18, 22]) {
  const used = files.some(n =>
    fs.readFileSync(path.join(root, "redesign", n), "utf8").includes(`var(--fs-${step})`));
  assert.ok(used, `токен --fs-${step} никем не используется — либо применить, либо убрать`);
}

console.log("typography-scale: OK — шкала",
  [...declared].sort((a, b) => a - b).join("/"), "замкнута");
