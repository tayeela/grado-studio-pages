"use strict";

// Соединение таблиц («Объединения» в QGIS). Что здесь важно:
// 1. Таблицы приходят из Excel: точка с запятой вместо запятой, кавычки вокруг
//    значений с запятыми внутри, BOM в начале, cp1251 вместо UTF-8. Всё это
//    должно читаться без вопросов к человеку.
// 2. Ключи не совпадают побайтно: кадастровый номер приходит с пробелами и
//    в другом регистре. Сравниваем нормализованно, иначе соединение молча
//    даёт ноль совпадений.
// 3. Повторный ключ в таблице — не ошибка, а частый случай; берём первую
//    строку и ГОВОРИМ об этом.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..");
global.window = globalThis;
require(path.join(root, "app-join.js"));
const J = globalThis.GRADO_JOIN;
assert.ok(J && typeof J.planJoin === "function", "модуль обязан подниматься без документа");

// ---------- разбор CSV ----------
{
  const excel = "﻿кадномер;площадь;назначение\r\n" +
    '77:01:0001:15;120,5;"жилое, секция 2"\r\n' +
    "77:01:0001:16;98;нежилое\r\n";
  const table = J.parseDelimited(excel);
  assert.equal(table.delimiter, ";", "разделитель Excel в русской локали");
  assert.deepEqual(table.columns, ["кадномер", "площадь", "назначение"], "BOM не должен попасть в имя столбца");
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]["назначение"], "жилое, секция 2",
    "запятая внутри кавычек — часть значения, а не разделитель");

  // запятая как разделитель, кавычка внутри кавычек
  const comma = 'name,note\r\nА,"он сказал ""да"""\r\n';
  const parsed = J.parseDelimited(comma);
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.rows[0].note, 'он сказал "да"');

  // табуляция
  assert.equal(J.detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  // разделитель внутри кавычек не считается
  assert.equal(J.detectDelimiter('"a;b;c",d\n'), ",");

  // пустые строки пропускаются, безымянные столбцы получают имя
  const ragged = J.parseDelimited("a;;c\r\n\r\n1;2;3\r\n");
  assert.deepEqual(ragged.columns, ["a", "столбец 2", "c"]);
  assert.equal(ragged.rows.length, 1);
}

// ---------- кодировка ----------
{
  const utf8 = Buffer.from("поле;значение\r\nдом;жилой\r\n", "utf8");
  assert.ok(J.decodeText(utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.length)).includes("жилой"));
  // cp1251: те же слова в однобайтовой кодировке
  const cp1251 = Buffer.from([0xef, 0xee, 0xeb, 0xe5, 0x3b, 0xe4, 0xee, 0xec]);   // «поле;дом»
  const decoded = J.decodeText(cp1251.buffer.slice(cp1251.byteOffset, cp1251.byteOffset + cp1251.length));
  assert.equal(decoded, "поле;дом", "cp1251 из Excel обязан читаться");
}

// ---------- ключи и план соединения ----------
{
  const rows = [
    { кад: "77:01:0001:15", площадь: "120,5", вид: "жилое" },
    { кад: "77:01:0001:16", площадь: "98", вид: "нежилое" },
    { кад: "77:01:0001:16", площадь: "77", вид: "повтор" },
  ];
  const features = [
    { id: 1, props: { cad: "77:01:0001:15" } },
    { id: 2, props: { cad: " 77:01:0001:16 " } },      // пробелы из выгрузки
    { id: 3, props: { cad: "77:09:9999:99" } },
    { id: 4, props: {} },                                // ключа нет вовсе
  ];
  const plan = J.planJoin({ features, keyField: "cad", rows, keyColumn: "кад",
    columns: ["кад", "площадь", "вид"], prefix: "т_" });
  assert.equal(plan.matched, 2, "пробелы вокруг ключа не должны мешать");
  assert.equal(plan.missed.length, 2, "объект без пары и объект без ключа остаются без значений");
  assert.equal(plan.duplicates, 1, "повторный ключ обязан считаться");
  assert.deepEqual(plan.fields.map(f => f.name), ["т_площадь", "т_вид"],
    "ключевой столбец второй раз не переносится");
  assert.equal(plan.updates[1].values["т_вид"], "нежилое", "берётся ПЕРВАЯ строка с ключом");
  assert.equal(J.normalizeKey(" 77:01:0001:16 "), J.normalizeKey("77:01:0001:16"));

  // без префикса имена столбцов идут как есть
  const bare = J.planJoin({ features, keyField: "cad", rows, keyColumn: "кад", columns: ["площадь"] });
  assert.deepEqual(bare.fields.map(f => f.name), ["площадь"]);
}

// ---------- XLSX ----------
// Проверяется САМ модуль: собираем настоящий xlsx (zip со сжатыми записями) и
// скармливаем его parseXlsx. В Node есть DecompressionStream и Blob, поэтому
// распаковка идёт тем же путём, что в браузере; не хватает только DOMParser —
// его подменяем разбором на регулярных выражениях.
const xlsxChecks = async () => {
  const files = new Map([
    ["xl/sharedStrings.xml",
      '<?xml version="1.0"?><sst><si><t>кадномер</t></si><si><t>площадь</t></si>' +
      '<si><t>77:01:0001:15</t></si><si><t>объект </t><t>из двух кусков</t></si></sst>'],
    ["xl/worksheets/sheet1.xml",
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>вид</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120.5</v></c><c r="C2" t="s"><v>3</v></c></row>' +
      "</sheetData></worksheet>"],
  ]);
  globalThis.DOMParser = FakeDomParser;
  const parsed = await J.parseXlsx(buildZip(files));
  assert.deepEqual(parsed.columns, ["кадномер", "площадь", "вид"], "заголовок берётся из первой строки");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["кадномер"], "77:01:0001:15", "общие строки обязаны разворачиваться");
  assert.equal(parsed.rows[0]["площадь"], "120.5", "число берётся как есть");
  assert.equal(parsed.rows[0]["вид"], "объект из двух кусков",
    "текст ячейки бывает разбит на куски с разным начертанием — их надо склеить");

  // не архив — понятная ошибка, а не падение
  await assert.rejects(() => J.parseXlsx(new ArrayBuffer(64)), /не похож на xlsx/);
};

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const join = fs.readFileSync(path.join(root, "app-join.js"), "utf8");
  assert.match(app, /\["Присоединить таблицу…", \(\) => window\.openJoinTable && window\.openJoinTable\(layer\)\]/,
    "соединение обязано открываться из меню слоя");
  assert.ok(html.indexOf('src="./app.js') < html.indexOf('src="./app-join.js'),
    "модуль работает поверх состояния приложения");
  assert.match(join, /snapshot\(\);/, "запись атрибутов обязана отменяться");
  assert.match(join, /addLayerFieldTo\(layer, field\.name, "text"\)/,
    "новые столбцы обязаны появляться в схеме слоя, иначе их не будет в таблице атрибутов");
  assert.match(join, /Совпадёт \$\{plan\.matched\} из \$\{total\}/,
    "человек обязан видеть, сколько ключей сойдётся, ДО записи");
}

xlsxChecks().then(() => console.log("join-table: OK"),
  error => { console.error(error); process.exit(1); });

// ---------- вспомогательное ----------

// минимальный zip-архив со сжатием deflate-raw
function buildZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, packed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...chunks, centralBuffer, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// В Node нет DOMParser; подменяем ровно теми методами, которыми пользуется
// разбор книги: getElementsByTagName и textContent.
function FakeDomParser() {
  this.parseFromString = function (xml) {
  const node = tag => {
    const items = [];
    const re = new RegExp(`<${tag}\\b([^>]*)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
    let match;
    while ((match = re.exec(xml))) items.push(element(match[1] || "", match[2] || ""));
    return items;
  };
  const element = (attrs, inner) => ({
    textContent: inner.replace(/<[^>]*>/g, ""),
    getAttribute: name => {
      const found = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return found ? found[1] : null;
    },
    getElementsByTagName: tag => {
      const items = [];
      const re = new RegExp(`<${tag}\\b([^>]*)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
      let match;
      while ((match = re.exec(inner))) items.push(element(match[1] || "", match[2] || ""));
      return items;
    },
  });
    return { getElementsByTagName: node };
  };
}
