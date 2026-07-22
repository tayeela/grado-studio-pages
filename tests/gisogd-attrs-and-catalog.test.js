"use strict";

// 1. Слой портала везёт 13 атрибутов, из которых читаются два: остальное —
//    внутренние идентификаторы выгрузки, флаги редактора и длина/площадь,
//    которую студия считает сама. В таблице они прятали то, ради чего объект
//    выгружали.
// 2. Списки полей у портала ПОЗИЦИОННЫЕ: linelineco «6,-1,4» идёт в ногу с
//    linerhanum «NOT_FOUND,П071-21/1v.4,NOT_FOUND». Без позиции в атрибуты
//    красной линии уезжали номера документов чужих сторон.
// 3. Каталог из 663 слоёв жил в памяти: перезагрузка страницы — и окно
//    выгрузки снова ждало сеть.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const core = fs.readFileSync(path.join(root, "pages-core.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");

// ---------- чистка атрибутов ----------
const start = core.indexOf("const GISOGD_SERVICE_PROPS");
const end = core.indexOf("// Кураторские наборы");
assert.ok(start > 0 && end > start, "чистка атрибутов должна оставаться извлекаемой");
const context = vm.createContext({ LINE_CODE_KEYS: ["linelineco"] });
vm.runInContext(core.slice(start, end), context);
const clean = vm.runInContext("gisogdCleanProps", context);

// настоящий объект портала (слой l1, orbis_id 1)
const simple = clean({
  orbis_id: 1.0, fid_1: 318833.0, guid: "072f46a9-8688-40e3-9f24-255db9b8fb50",
  linerhagui: "d8418862-3247-4965-981a-db3f95dbf58c", linelineco: "1",
  iseditedby: 0.0, changeauth: "Миграция данных", isauxiliar: 0.0,
  stylecode: "11000000000", changedate: "2019-10-09 10:24:30",
  createdate: "2017-03-24 00:00:00", linerhanum: "121", shape_length: 3.52,
}, 1);
assert.deepEqual(Object.keys(simple).sort(), ["changedate", "createdate", "linerhanum"],
  "из 13 полей портала остаётся то, что читает человек");
assert.equal(simple.linerhanum, "121", "номер документа обязан дойти без изменений");

// линия-граница трёх режимов: коды 6, -1, 4 — и три параллельных списка
const multi = {
  orbis_id: 4.0, linelineco: "6,-1,4",
  changeauth: "Миграция данных,butts_ae,butts_ae",
  linerhagui: "None,7f57bbf2-db0f-458f-afe4-a19396a1f092,None",
  changedate: "2019-10-09 10:24:30,2021-07-08 17:11:06,2021-07-08 17:11:06",
  createdate: "None,2021-07-08 17:11:06,2021-07-08 17:11:06",
  linerhanum: "NOT_FOUND,П071-21/1v.4,NOT_FOUND", shape_length: 147.7,
};
assert.equal(clean(multi, 1).linerhanum, "П071-21/1v.4",
  "у КЛ УДС обязан быть СВОЙ номер документа, а не склейка трёх сторон");
assert.equal(clean(multi, 6).linerhanum, undefined,
  "заглушка NOT_FOUND чужой стороны не должна становиться атрибутом");
assert.equal(clean(multi, 6).createdate, undefined, "None — это пусто, а не значение");
assert.equal(clean(multi, 4).createdate, "2021-07-08 17:11:06",
  "у третьей стороны берётся третий элемент списка");

// запятая внутри текста — не список: длина не совпадает с числом кодов
assert.equal(clean({ linelineco: "6,-1,4", name: "Зона, охраняемая" }, 1).name,
  "Зона, охраняемая", "текст с запятой резать нельзя");

// зона: имя и тип нужны стилю, площадь портала — нет, её студия считает сама
const zone = clean({ orbis_id: 1.0, id: 1.0, n: 1.0, name_okrug: "Центральный",
  naimfunkzony: "многофункциональные общественные зоны", fztip: "120",
  shape_area: 291258.26, shape_length: 2282.56, n_okrug: 1.0 }, null);
assert.deepEqual(Object.keys(zone).sort(), ["fztip", "naimfunkzony", "name_okrug"],
  "у функциональной зоны остаются поля, по которым назначается знак");

// имена полей НЕ переименовываем: по ним работают стили и правила маршрутизации
const labels = vm.runInContext("GISOGD_PROP_LABELS", context);
assert.equal(labels.linerhanum, "номер документа", "колонке нужен человеческий заголовок");
assert.match(core, /addFields\(group, props, GISOGD_PROP_LABELS\)/,
  "заголовки обязаны доезжать до таблицы");
assert.match(core, /const label = labels && labels\[name\];/,
  "имя поля остаётся исходным — меняется только заголовок колонки");
const attr = fs.readFileSync(path.join(root, "app-attr.js"), "utf8");
assert.match(attr, /label: cf\.label \|\| cf\.name/, "таблица обязана читать заголовок");

// ---------- каталог переживает перезагрузку ----------
assert.match(adapter, /const GISOGD_CATALOG_KEY = "gisogd_catalog"/,
  "каталог обязан лежать в хранилище, а не только в памяти");
const cat = adapter.slice(adapter.indexOf("let gisogdCatalogCache"),
  adapter.indexOf("// ключ источника → {code, name}"));
assert.match(cat, /await databaseGet\(GISOGD_CATALOG_KEY\)/, "чтение из кэша");
assert.match(cat, /await databaseSet\(GISOGD_CATALOG_KEY, \{ at: Date\.now\(\), data: catalog \}\)/,
  "запись в кэш");
assert.match(cat, /Array\.isArray\(hit\.data\) && hit\.data\.length/,
  "пустой или битый кэш не должен подменять каталог");
assert.match(cat, /Date\.now\(\) - hit\.at\) < GISOGD_CATALOG_TTL_MS/,
  "у каталога обязан быть срок годности — состав слоёв портала меняется");
assert.ok(cat.indexOf("catch (error) { /* не влез") > 0,
  "недоступное хранилище не должно ронять выгрузку");

console.log("gisogd-attrs-and-catalog: OK");
