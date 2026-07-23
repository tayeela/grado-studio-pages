"use strict";

// Копипаст объектов через системный буфер. Что здесь важно:
// 1. В буфер едет всё нужное для другой стороны: геометрия, атрибуты,
//    описание слоя — в чужом проекте слой заводится заново.
// 2. Буфер — недоверенный ввод: битая геометрия отбрасывается и не роняет
//    вставку остальных; чужой текст в буфере — просто null, не ошибка.
// 3. Служебное не едет: id остаётся на своей стороне (новая сторона выдаёт
//    свои), функции слоя (defaults) не сериализуются.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-clipboard.js"));
const C = globalThis.GRADO_CLIPBOARD;
assert.ok(typeof C.serializeFeatures === "function", "ядро обязано подниматься без документа");

const layer = { id: "user.zony", title: "Зоны", kind: "zone", geometry_type: "polygon",
  style_id: "func_zone.fill", fields: [{ name: "index" }], defaults: () => ({}) };
const resolve = () => layer;

// ---------- сериализация ----------
{
  const payload = C.serializeFeatures([
    { id: 7, layer_id: "user.zony", ring: [[0, 0], [10, 0], [10, 10]], props: { index: "Ж-1" } },
    { id: 8, layer_id: "user.zony", circle: { cx: 5, cy: 5, r: 2 }, style_id: "red.line" },
  ], resolve);
  assert.equal(payload.format, "grado-studio/features");
  assert.equal(payload.features.length, 2);
  assert.equal(payload.features[0].id, undefined, "id не едет — на той стороне свои");
  assert.equal(payload.features[0].props.index, "Ж-1", "атрибуты едут");
  assert.equal(payload.layers.length, 1, "слой описан один раз, не на каждый объект");
  assert.equal(payload.layers[0].title, "Зоны");
  assert.equal(payload.layers[0].defaults, undefined, "функции слоя не сериализуются");
  // круговая сериализация: то, что записали, обязано прочитаться
  const parsed = C.parsePayload(JSON.stringify(payload));
  assert.equal(parsed.features.length, 2);
  assert.equal(parsed.layers[0].id, "user.zony");
  // выделение без геометрии (наполовину созданный объект) — null, не пустой буфер
  assert.equal(C.serializeFeatures([{ id: 9, props: {} }], resolve), null);
}

// ---------- недоверенный ввод ----------
{
  assert.equal(C.parsePayload("обычный текст из буфера"), null, "чужой текст — не ошибка");
  assert.equal(C.parsePayload('{"format":"grado-studio/features","features":[]}'), null,
    "пустой список объектов — вставлять нечего");
  assert.equal(C.parsePayload('{"format":"other","features":[{"point":[1,2]}]}'), null,
    "чужой формат не принимается");

  // битые объекты отбрасываются, целые выживают
  const mixed = C.parsePayload(JSON.stringify({ format: "grado-studio/features", features: [
    { point: [1, 2] },
    { point: [NaN, 2] },                       // NaN сериализуется в null
    { ring: [[0, 0], [1, 1]] },                // кольцо из двух точек
    { circle: { cx: 0, cy: 0, r: -5 } },       // отрицательный радиус
    { point: [1, 2], ring: [[0, 0], [1, 0], [1, 1]] },   // две геометрии сразу
    { line: [[0, 0], [700, 700]], props: "не объект" },  // props-строка отрезается
  ] }));
  assert.equal(mixed.features.length, 2, "выжили точка и линия");
  assert.equal(mixed.features[1].props, undefined, "props не-объект отброшен");

  // дыры полигона проверяются так же строго, как внешнее кольцо
  assert.equal(C.parsePayload(JSON.stringify({ format: "grado-studio/features", features: [
    { ring: [[0, 0], [9, 0], [9, 9]], holes: [[[1, 1], [2, 2]]] },
  ] })), null, "битая дыра бракует объект");
}

// ---------- проводка ----------
{
  const clip = fs.readFileSync(path.join(root, "app-clipboard.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(html, /app-clipboard\.js\?v=/, "модуль обязан подключаться на странице");
  assert.match(cmdk, /Копировать объекты в буфер/, "команды в палитре");
  assert.match(cmdk, /Вставить объекты из буфера/);
  assert.match(clip, /existing\.has\(geomKey\(nf\)\)/,
    "вставка поверх себя — сдвиг; в чужом проекте координаты не трогаются");
  assert.match(clip, /_BUILTIN_LAYER_SPECS\.find/,
    "встроенный слой восстанавливается по спецификации, а не описанию из буфера");
  assert.match(clip, /if \(textSelection\) return;/,
    "Ctrl+C при выделенном тексте страницы остаётся обычным копированием");
  assert.match(clip, /t\.tagName === "INPUT" \|\| t\.tagName === "SELECT" \|\| t\.tagName === "TEXTAREA"/,
    "в полях ввода горячие клавиши не перехватываются");
}

console.log("clipboard: OK");
