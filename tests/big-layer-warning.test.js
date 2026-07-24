"use strict";

// Предупреждение о большой закачке (трек C спеки о слаженности).
//
// Портал ГИС ОГД не фильтрует по области: слой приходит целиком, и это
// 44 МБ у функциональных зон, 100 МБ у красных линий УДС. Раньше закачка
// начиналась молча.
//
// Спросить по заголовку ответа НЕЛЬЗЯ: Content-Length у портала не открыт
// через CORS — браузеру видны только cache-control, content-type, expires,
// last-modified, pragma (проверено живьём, поэтому проверка по заголовку
// была бы мёртвым кодом). Вес берём из памяти о прошлой закачке, которая
// живёт отдельно от кэша слоёв: кэш чистят ради места, а знание о весе при
// этом терять незачем — именно оно предупреждает о следующей закачке.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adapter = fs.readFileSync(path.join(__dirname, "..", "pages-adapter.js"), "utf8");

assert.match(adapter, /const BIG_LAYER_BYTES = 25 \* 1024 \* 1024;/,
  "порог задан явно: ниже него спрашивать значит мешать");

assert.match(adapter, /const LAYER_SIZES_KEY = "grado_gisogd_layer_sizes_v1";/,
  "вес слоёв хранится под собственным ключом, отдельно от самих слоёв");

assert.match(adapter, /async function rememberLayerBytes\(code, bytes\)/,
  "вес запоминается после закачки");
assert.match(adapter, /async function rememberedLayerBytes\(code\)/,
  "и читается перед следующей");

// вес пишется ПОСЛЕ чтения тела (раньше он неизвестен), спрашиваем ДО запроса
{
  const at = adapter.indexOf("async function gisogdLayerJson(");
  const body = adapter.slice(at, at + 3000);
  const askAt = body.indexOf("uiConfirm");
  const fetchAt = body.indexOf("externalFetch(`ГИС ОГД");
  const rememberAt = body.indexOf("await rememberLayerBytes(");
  assert.ok(askAt > 0 && fetchAt > 0 && rememberAt > 0, "все три шага на месте");
  assert.ok(askAt < fetchAt,
    "спрашиваем ДО запроса к порталу — иначе стомегабайтная закачка уже пошла");
  assert.ok(rememberAt > fetchAt,
    "вес запоминается после закачки, когда он наконец известен");
}

assert.match(adapter, /stop\.name = "GradoUserDeclined"/,
  "отказ — не сбой сети: у него своё имя и человеческое сообщение");
{
  // в самой закачке слоя заголовок не спрашиваем: он скрыт CORS, и проверка
  // по нему была бы мёртвым кодом. (В индикаторе прогресса обращение к нему
  // остаётся законным — там оно лишь уточняет процент, когда доступно.)
  const at = adapter.indexOf("async function gisogdLayerJson(");
  const body = adapter.slice(at, at + 3000);
  assert.ok(!/headers\.get\("Content-Length"\)/.test(body),
    "решение о предупреждении не должно опираться на скрытый CORS заголовок");
}

console.log("big-layer-warning: OK");
