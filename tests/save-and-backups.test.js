"use strict";

// 1. Проверка перед выпуском следит за качеством ЧЕРТЕЖА, но запирала и
//    сохранение .grado: когда с проектом что-то не так, работу нельзя было
//    даже сохранить. Недоступная проверка запирала выпуск целиком.
// 2. Контрольная копия была ОДНА: следующая точка затирала единственный путь
//    назад, а на больших проектах глубина отмены и без того урезана по памяти.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");

// ---------- сохранение проекта не зависит от проверки выпуска ----------
const dl = app.slice(app.indexOf("async function download(url, suffix)"),
  app.indexOf('on("export-style", "change"'));
assert.match(dl, /const isProjectFile = url === "\/api\/grado"/,
  "сохранение проекта обязано отличаться от выпуска документа");
assert.match(dl, /if \(!isProjectFile\) \{/,
  "проверка перед выпуском не должна стоять на пути .grado");
const gate = dl.slice(dl.indexOf("if (!isProjectFile) {"), dl.indexOf("const r = await fetch(url"));
assert.match(gate, /catch \(error\) \{ report = null; \}/,
  "отказ проверки обязан обрабатываться, а не обрывать выпуск");
assert.match(gate, /if \(!report\) toast\("Проверка недоступна/,
  "о выпуске без проверки нужно предупредить");
assert.ok(dl.indexOf("/api/preflight") > dl.indexOf("if (!isProjectFile) {"),
  "обращение к проверке обязано быть внутри ветки выпуска");
assert.ok(!/throw new Error\("не удалось проверить проект"\)/.test(dl),
  "недоступная проверка больше не должна отменять выпуск");

// ---------- несколько слотов контрольных копий ----------
const start = adapter.indexOf("const BACKUP_SLOTS");
const end = adapter.indexOf("const backupMeta = payload");
assert.ok(start > 0 && end > start, "ротация копий должна оставаться извлекаемой");

const store = new Map();
const context = vm.createContext({
  isRecord: v => !!v && typeof v === "object" && !Array.isArray(v),
  backupMeta: payload => (payload && payload.state && Array.isArray(payload.state.features)
    ? { saved_at: payload.saved_at, name: payload.state.name,
        feature_count: payload.state.features.length, size: 1 } : null),
  storedProjectGet: async key => (store.has(key) ? store.get(key) : null),
  storedProjectSet: async (key, value) => {
    if (context.quotaFull && String(key).startsWith("grado_pages_backup_")
        && key !== "grado_pages_backup_index_v1")
      throw new Error("quota");
    store.set(key, value);
  },
  storedProjectDelete: async key => { store.delete(key); },
  quotaFull: false,
});
vm.runInContext(adapter.slice(start, end), context);
// const в vm не попадает на объект контекста — достаём явно
const pushBackup = vm.runInContext("pushBackup", context);
const readBackupIndex = vm.runInContext("readBackupIndex", context);
const envelope = name => ({ state: { name, features: [{ id: 1 }] }, saved_at: `2026-07-22T00:0${name}:00Z` });

(async () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) await pushBackup(envelope(String(n)));
  const index = await readBackupIndex();
  assert.equal(index.length, 5, "слотов ровно пять");
  // массив приходит из vm — приводим к своему реалму, иначе deepEqual падает
  assert.deepEqual(Array.from(index, item => item.name), ["7", "6", "5", "4", "3"],
    "новая копия первая, самая старая вытесняется");
  assert.equal(store.has("grado_pages_backup_1"), false,
    "вытесненная копия обязана освобождать место, иначе хранилище растёт вечно");
  assert.deepEqual((await context.storedProjectGet("grado_pages_backup_7")).state.name, "7",
    "копию можно достать по идентификатору из списка");

  // нет места: место освобождается за счёт самой старой копии, автосейв не падает
  const before = (await readBackupIndex()).length;
  context.quotaFull = true;
  await assert.doesNotReject(pushBackup(envelope("8")),
    "отказ копии не должен превращаться в отказ сохранения");
  context.quotaFull = false;
  assert.ok((await readBackupIndex()).length <= before,
    "при нехватке места список копий не должен расти");

  // мусорный индекс не должен ломать список
  store.set("grado_pages_backup_index_v1", "не массив");
  assert.equal((await readBackupIndex()).length, 0, "повреждённый список читается как пустой");

  // маршруты
  assert.match(adapter, /path\.startsWith\("\/api\/autosave\/backups\/"\)/,
    "копия обязана отдаваться по идентификатору");
  assert.match(adapter, /id === "legacy" \|\| id === "1"/,
    "прежний единственный слот обязан остаться доступным");
  assert.match(adapter, /await pushBackup\(envelope\)\.catch\(\(\) => \{\}\)/,
    "копия не должна ронять автосейв");

  console.log("save-and-backups: OK");
})();
