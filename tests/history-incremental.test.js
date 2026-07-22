"use strict";

// Инкрементальные снимки отмены. Раньше каждый шаг хранил JSON всего проекта:
// на выгрузке ОГД в 20 000 объектов снимок весит ~13 МБ, а глубина истории — до
// 100 шагов, то есть больше гигабайта строк. Теперь неизменившиеся объекты
// переиспользуют ТУ ЖЕ строку, что и предыдущий шаг, поэтому сто шагов держат
// один экземпляр содержимого.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function historySnapshot(");
const end = source.indexOf("function historyStackFromStrings(");
assert.ok(start >= 0 && end > start, "history helpers must remain extractable");
const tailEnd = source.indexOf("\n}", end) + 2;

const state = { features: [] };
const context = vm.createContext({
  state, JSON, Map, Array, Number, console,
  isRecord: v => !!v && typeof v === "object" && !Array.isArray(v),
  historySmallState: () => JSON.stringify({ history_version: 2, layerOrder: ["a"] }),
});
vm.runInContext(source.slice(start, tailEnd), context);
const { historySnapshot, historyTail, historyEntryToString, historyEntryFromString,
  historyStackToStrings, historyStackFromStrings } = context;

const feature = (id, x) => ({ id, kind: "building", ring: [[x, 0], [x + 10, 0], [x + 10, 10]] });
state.features = [feature(1, 0), feature(2, 100), feature(3, 200)];

// первый снимок — всё содержимое новое
const first = historySnapshot(null);
assert.deepEqual(Array.from(first.ids), [1, 2, 3]);
assert.ok(first.freshBytes > 0);

// второй снимок после правки ОДНОГО объекта: остальные строки те же по ССЫЛКЕ
state.features[1] = feature(2, 555);
const second = historySnapshot(first);
assert.equal(second.jsons[0], first.jsons[0], "неизменённый объект — та же строка");
assert.ok(second.jsons[0] === first.jsons[0], "и именно тот же экземпляр, а не копия");
assert.equal(second.jsons[2], first.jsons[2]);
assert.notEqual(second.jsons[1], first.jsons[1], "изменённый объект пересериализован");

// в бюджет попадает только НОВОЕ содержимое — иначе разделяемые строки
// считались бы заново на каждом шаге
assert.ok(second.freshBytes < first.freshBytes / 2,
  `шаг с одной правкой должен быть много дешевле полного (${second.freshBytes} против ${first.freshBytes})`);
assert.equal(second.freshBytes, second.jsons[1].length,
  "в счёт идёт ровно один изменившийся объект");

// добавление и удаление
state.features.push(feature(4, 300));
const third = historySnapshot(second);
assert.deepEqual(Array.from(third.ids), [1, 2, 3, 4]);
assert.equal(third.jsons[1], second.jsons[1], "прежние объекты по-прежнему общие");
state.features = state.features.filter(f => f.id !== 2);
const fourth = historySnapshot(third);
assert.deepEqual(Array.from(fourth.ids), [1, 3, 4]);
assert.equal(fourth.freshBytes, 0, "удаление не добавляет нового содержимого");

// круговой обход через прежний строковый формат (файл проекта, автосейв)
const asString = historyEntryToString(third);
const parsed = JSON.parse(asString);
assert.equal(parsed.history_version, 2, "формат v2 сохранён — миграция не нужна");
assert.equal(parsed.features.length, 4);
assert.deepEqual(Array.from(parsed.features.map(f => f.id)), [1, 2, 3, 4]);
assert.deepEqual(Array.from(parsed.layerOrder), ["a"], "мелкое состояние доезжает целиком");

const back = historyEntryFromString(asString);
assert.deepEqual(Array.from(back.ids), Array.from(third.ids), "строка → снимок сохраняет состав и порядок");
assert.equal(historyEntryToString(back), asString, "обход туда-обратно устойчив");

// строки из старых проектов принимаются как есть
assert.equal(historyEntryToString("{\"history_version\":2,\"features\":[]}"),
  "{\"history_version\":2,\"features\":[]}", "легаси-строка проходит насквозь");
assert.equal(historyEntryFromString("не json"), null, "мусор отбрасывается, а не роняет историю");
assert.equal(historyEntryToString(null), null);

// на диск уходит ограниченное число шагов
const many = Array.from({ length: 30 }, () => third);
assert.equal(historyStackToStrings(many).length, 10, "в файл пишем только последние шаги");
assert.equal(historyStackFromStrings(historyStackToStrings(many)).length, 10);
assert.deepEqual(Array.from(historyStackToStrings(null)), []);
assert.deepEqual(Array.from(historyStackFromStrings(["мусор"])), []);

// historyTail
assert.equal(historyTail([]), null);
assert.equal(historyTail([first, second]), second);

console.log("history-incremental: OK");
