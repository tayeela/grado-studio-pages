"use strict";

// Слой портала качается ЦЕЛИКОМ: bbox он не фильтрует, у красных линий УДС это
// 99.5 МБ и два десятка секунд. Молчащий индикатор на такой загрузке
// неотличим от зависшего приложения, а занятое место было невидимо: убрать
// один слой можно было только «почистив браузер» — вместе с проектом и
// контрольными копиями.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
const data = fs.readFileSync(path.join(root, "app-data.js"), "utf8");

// ---------- чтение потока с прогрессом ----------
const start = adapter.indexOf("const gisogdProgress");
const end = adapter.indexOf("async function gisogdLayerJson");
assert.ok(start > 0 && end > start, "чтение с прогрессом должно оставаться извлекаемым");

const events = [];
const context = vm.createContext({
  window: { dispatchEvent: e => events.push(e.detail) },
  CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
  TextDecoder, Blob,
  throwIfAborted: signal => { if (signal && signal.aborted) throw new Error("aborted"); },
});
vm.runInContext(adapter.slice(start, end), context);
const readWithProgress = vm.runInContext("readWithProgress", context);

const chunk = (size, fill) => new Uint8Array(size).fill(fill);
const fakeResponse = (chunks, total) => ({
  headers: { get: name => (name === "Content-Length" && total ? String(total) : null) },
  body: { getReader: () => { let i = 0; return {
    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
    cancel: async () => {} }; } },
  text: async () => "нельзя: поток обязан читаться кусками",
});

(async () => {
  // 8 кусков по 200 КБ: событий должно быть меньше, чем кусков
  const body = Array.from({ length: 8 }, () => chunk(204800, 65));
  const res = await readWithProgress(fakeResponse(body, 1638400), "l1", "КЛ УДС", null);
  assert.equal(res.bytes, 1638400, "байты считаются по факту прочитанного");
  assert.equal(res.text.length, 1638400, "тело собирается целиком");
  assert.ok(events.length >= 2 && events.length < body.length,
    `событий ${events.length}: на каждый кусок — тысячи перерисовок, ни одного — молчащий индикатор`);
  assert.equal(events[events.length - 1].loaded, 1638400, "последнее событие — итоговый объём");
  assert.equal(events[events.length - 1].total, 1638400, "Content-Length доезжает до индикатора");
  assert.equal(events[0].name, "КЛ УДС", "в индикаторе имя слоя, а не код");

  // портал отдаёт chunked без Content-Length — процентов нет, объём есть
  events.length = 0;
  const noLen = await readWithProgress(fakeResponse([chunk(600000, 66)], 0), "l2", "КЛ ТОП", null);
  assert.equal(noLen.bytes, 600000);
  assert.equal(events[events.length - 1].total, 600000,
    "без Content-Length итог берётся по прочитанному, а не подделывается процентами");

  // отмена в середине не должна дочитывать сотню мегабайт
  events.length = 0;
  const signal = { aborted: false };
  const slow = { headers: { get: () => null }, body: { getReader: () => { let i = 0; return {
    read: async () => { i += 1; if (i === 2) signal.aborted = true; return { done: false, value: chunk(300000, 67) }; },
    cancel: async () => {} }; } } };
  await assert.rejects(readWithProgress(slow, "l1", "КЛ УДС", signal), /aborted/,
    "отмена обязана обрывать чтение потока");

  // ---------- размер запоминается при записи ----------
  assert.match(adapter, /databaseSet\(gisogdCacheKey\(code\), \{ at: Date\.now\(\), bytes, name: name \|\| null, data \}\)/,
    "иначе размер пришлось бы считать разворачиванием сотни мегабайт в строку");
  assert.match(adapter, /слой \$\{code\} загружен целиком \(\$\{\(data\.features \|\| \[\]\)\.length\} об\., `\s*\+ `\$\{formatBytes\(bytes\)\}\)/,
    "объём обязан попадать в отчёт о выгрузке");

  // ---------- маршруты управления кэшем ----------
  assert.match(adapter, /if \(path === "\/api\/gisogd-cache"\)/, "список кэша");
  assert.match(adapter, /path\.startsWith\("\/api\/gisogd-cache\/"\) && method === "DELETE"/,
    "удаление одного слоя");
  const drop = adapter.slice(adapter.indexOf('path.startsWith("/api/gisogd-cache/")'),
    adapter.indexOf('if (path === "/api/initial-grado")'));
  assert.match(drop, /\/\^\[A-Za-z0-9_\.-\]\{1,40\}\$\//,
    "код слоя приходит из адресной строки — он обязан проверяться");
  assert.match(adapter, /key\.startsWith\(GISOGD_KEY_PREFIX\)/,
    "чистка обязана трогать только слои портала, а не проект и копии");
  const list = adapter.slice(adapter.indexOf("const gisogdCacheList"), adapter.indexOf("// Каталог — 663"));
  assert.match(list, /stale: !at \|\| \(Date\.now\(\) - at\) >= GISOGD_TTL_MS/,
    "устаревший слой обязан быть виден: он всё равно перекачается");
  assert.match(list, /sort\(\(a, b\) => \(b\.at \|\| 0\) - \(a\.at \|\| 0\)\)/, "свежие сверху");

  // ---------- окно выгрузки ----------
  assert.match(data, /window\.addEventListener\("grado-source-progress", onLayerBytes\)/,
    "окно обязано слушать байты");
  assert.match(data, /window\.removeEventListener\("grado-source-progress", onLayerBytes\)/,
    "и отписываться — иначе слушатели копятся с каждой выгрузкой");
  const handler = data.slice(data.indexOf("const onLayerBytes"), data.indexOf("window.addEventListener(\"grado-source-progress\""));
  assert.match(handler, /const share = total \? ` \$\{Math\.round\(loaded \/ total \* 100\)\}%` : "";/,
    "нет Content-Length — нет процентов: врать про остаток нельзя");
  assert.match(handler, /const inner = total \? loaded \/ total : 0;/,
    "доля слоя считается внутри доли источника, иначе индикатор прыгает назад");
  assert.match(data, /fetch\(url, \{ method: "DELETE" \}\)/, "кнопка «Убрать» обязана ходить в кэш");
  assert.match(data, /cacheOpen = !cacheOpen/, "список кэша раскрывается по требованию");
  assert.ok(data.indexOf("cacheHtml()") > 0 && data.indexOf("Каталог портала") > data.indexOf("${cacheHtml()}"),
    "блок кэша стоит над каталогом — он про то, что уже скачано");

  console.log("gisogd-cache-and-progress: OK");
})();
