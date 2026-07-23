"use strict";

// Поиск объектов по атрибутам (локатор QGIS). Что здесь важно:
// 1. Каждое слово запроса обязано найтись в объекте (И, а не ИЛИ):
//    «жилая 77:01» сужает выборку, а не расширяет.
// 2. Служебные поля (с подчёркиванием) не ищутся — там мусор портала.
// 3. Список ограничен, и об обрезке сказано.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-select.js"));
const S = globalThis.GRADO_SELECT;
assert.ok(typeof S.searchFeatures === "function", "ядро поиска обязано подниматься без документа");

const make = (id, props) => ({ id, props });
const features = [
  make(1, { cad: "77:01:0001:15", use: "жилая застройка" }),
  make(2, { cad: "77:01:0002:16", use: "нежилая" }),
  make(3, { cad: "50:11:0003:17", use: "жилая застройка" }),
  make(4, { name: "Школа №12", _service: "77:01:секрет" }),
  make(5, {}),
];

// ---------- подстрока и регистр ----------
{
  assert.equal(S.searchFeatures(features, "77:01").length, 2, "подстрока в любом поле");
  assert.equal(S.searchFeatures(features, "ШКОЛА").length, 1, "регистр не важен");
  assert.equal(S.searchFeatures(features, "школа №12")[0].feature.id, 4);
  assert.equal(S.searchFeatures(features, "").length, 0, "пустой запрос молчит");
  assert.equal(S.searchFeatures(features, "   ").length, 0);
}

// ---------- И, а не ИЛИ ----------
{
  const both = S.searchFeatures(features, "жилая 77:01");
  assert.equal(both.length, 2, "оба слова обязаны найтись в одном объекте");
  assert.ok(both.every(match => match.feature.props.cad.startsWith("77:01")));
  assert.equal(S.searchFeatures(features, "жилая 50:11").length, 1, "сужение работает");
  assert.equal(S.searchFeatures(features, "школа 77:01").length, 0,
    "слова из разных объектов не складываются");
}

// ---------- служебные поля и лимит ----------
{
  assert.equal(S.searchFeatures(features, "секрет").length, 0,
    "поля с подчёркиванием — служебные, в них не ищем");
  const many = [];
  for (let i = 0; i < 200; i++) many.push(make(i, { name: `дом ${i}` }));
  assert.equal(S.searchFeatures(many, "дом", { limit: 50 }).length, 50, "лимит соблюдается");
  // совпавшее поле возвращается — его показывают в строке результата
  const hit = S.searchFeatures(features, "нежилая")[0];
  assert.equal(hit.field, "use");
  assert.equal(hit.value, "нежилая");
}

// ---------- проводка ----------
{
  const select = fs.readFileSync(path.join(root, "app-select.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /id="btn-find"/, "кнопка обязана быть на панели");
  assert.match(cmdk, /Найти объект…/, "и в палитре");
  assert.match(select, /L && L\.visible !== false;/,
    "ищем только по видимым слоям: скрытое не найти и глазами");
  assert.match(select, /zoomToFeature\(match\.feature\);/, "клик обязан приближать к объекту");
  assert.match(select, /показаны первые 50/, "об обрезке списка сказано");
  assert.match(select, /if \(event\.key === "Enter" && matches\.length\) \{ goTo\(0\); close\(\); \}/,
    "Enter уводит к первому совпадению");
}

console.log("find-feature: OK");
