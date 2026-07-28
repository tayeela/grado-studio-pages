"use strict";

// Функциональная проверка streamGisogdFiltered: читает FeatureCollection
// КУСКАМИ (как настоящий поток) и должна отдать ровно объекты внутри bbox,
// не больше и не меньше, независимо от того, где легла граница куска.
//
// Регэксп-проверки в gisogd-heavy-layers.test.js смотрят, что код ПОХОЖ на
// правильный; эта проверка гоняет реальную функцию на реальном разбитом на
// куски документе и сверяет результат по значению.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
const pagesCore = require(path.join(root, "pages-core.js"));

const start = adapter.indexOf("async function streamGisogdFiltered");
const end = adapter.indexOf("async function gisogdLayerJson");
assert.ok(start > 0 && end > start, "streamGisogdFiltered обязана оставаться извлекаемой");

const events = [];
const context = vm.createContext({
  window: { dispatchEvent: e => events.push(e.detail) },
  CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
  TextDecoder,
  pagesCore,
  throwIfAborted: signal => { if (signal && signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; } },
  gisogdProgress: (code, name, loaded, total) => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("p", { detail: { loaded, total } }));
  },
});
vm.runInContext("const gisogdProgress = (code, name, loaded, total) => window.dispatchEvent(new CustomEvent('p', { detail: { loaded, total } }));", context);
vm.runInContext(adapter.slice(start, end), context);
const streamGisogdFiltered = vm.runInContext("streamGisogdFiltered", context);

const точка = (n, x, y) => `{"type":"Feature","properties":{"n":${n}},"geometry":{"type":"Point","coordinates":[${x},${y}]}}`;
const doc = `{"type":"FeatureCollection","name":"zu","features":[` +
  [точка(1, 37.60, 55.75), точка(2, 38.90, 56.90), точка(3, 37.61, 55.76), точка(4, 30.0, 50.0)].join(",") +
  `]}`;
const bbox = [37.5, 55.7, 37.7, 55.8];   // задевает объекты 1 и 3

const fakeResponse = (текст, шаг) => {
  const bytes = Buffer.from(текст, "utf8");
  const chunks = [];
  for (let i = 0; i < bytes.length; i += шаг) chunks.push(new Uint8Array(bytes.subarray(i, i + шаг)));
  let idx = 0;
  return {
    headers: { get: () => String(bytes.length) },
    body: { getReader: () => ({
      read: async () => (idx < chunks.length ? { done: false, value: chunks[idx++] } : { done: true }),
      cancel: async () => {},
    }) },
  };
};

async function main() {
  for (const шаг of [1, 3, 7, 23, 4096]) {
    const { features, bytes } = await streamGisogdFiltered(fakeResponse(doc, шаг), "zu_29_06_2021", "Земельные участки", bbox, null);
    // сравниваем через JSON: массив приходит из другого realm (vm)
    assert.equal(JSON.stringify(features.map(f => f.properties.n)), "[1,3]",
      `кусок ${шаг}: в область обязаны попасть объекты 1 и 3, получено ${JSON.stringify(features.map(f => f.properties.n))}`);
    assert.equal(bytes, Buffer.byteLength(doc, "utf8"), `кусок ${шаг}: посчитаны байты ВСЕГО потока, а не только отобранного`);
  }

  // отмена на середине потока останавливает чтение и не отдаёт частичный результат молча
  {
    const response = fakeResponse(doc, 5);
    const signal = { aborted: false };
    const controller = { get: () => signal };
    let reads = 0;
    const originalGetReader = response.body.getReader;
    response.body.getReader = () => {
      const reader = originalGetReader();
      const read = reader.read.bind(reader);
      reader.read = async () => { reads += 1; if (reads === 3) signal.aborted = true; return read(); };
      return reader;
    };
    await assert.rejects(
      () => streamGisogdFiltered(response, "zu_29_06_2021", "Земельные участки", bbox, signal),
      /aborted/,
      "отмена посреди потока обязана прерывать чтение, а не тихо доскачивать всё");
  }

  console.log("gisogd-stream-filtered: OK");
}

main().catch(error => { console.error(error); process.exit(1); });
