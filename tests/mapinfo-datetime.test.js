"use strict";

// Дата и время из MapInfo приезжали в таблицу атрибутов мусором.
//
// В .dat MapInfo дескрипторы полей врут: почти всё объявлено как «C», а на
// деле лежит бинарно. Истинные типы объявлены в .tab, и читалка их уже
// забирала — но только для чисел. Date, Time и DateTime в перечень не попали
// вовсе, поэтому четыре (или восемь) двоичных байтов декодировались как
// текст: в колонке «дата ввода в эксплуатацию» человек видел кракозябры.
//
// Раскладка сверена с MITAB из GDAL
// (ogr/ogrsf_frmts/mitab/mitab_datfile.cpp, ReadDateField / ReadTimeField /
// ReadDateTimeField):
//   Date     — 4 байта: int16 год, байт месяц, байт день
//   Time     — 4 байта: int32 миллисекунд от полуночи
//   DateTime — 8 байт: дата, затем те же миллисекунды
// Порядок байтов little-endian: в MITAB перестановка стоит под #ifdef
// CPL_MSB, то есть на обычной машине читается как есть. Там же сверено, что
// Integer/SmallInt/LargeInt/Float читаются little-endian — это уже работало.

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
require(path.join(__dirname, "..", "app-shp.js"));
require(path.join(__dirname, "..", "app-mapinfo.js"));
const SHP = global.GRADO_SHP;
const MI = global.GRADO_MAPINFO;

// ---------- .tab объявляет типы, и все они должны опознаваться ----------
{
  const tab = [
    '!table', '!version 300', 'Definition Table', '  Type NATIVE Charset "WindowsCyrillic"',
    '  Fields 8',
    '    name Char (50) ;', '    floors SmallInt ;', '    persons Integer ;',
    '    huge LargeInt ;', '    area Float ;', '    built Date ;',
    '    opened Time ;', '    checked DateTime ;',
  ].join("\r\n");
  const { binTypes, charset } = MI.parseTabText(tab);
  assert.equal(charset, "WindowsCyrillic", "кодировка обязана читаться из .tab");
  assert.deepEqual(binTypes, {
    floors: "i16", persons: "i32", huge: "i64", area: "f64",
    built: "date", opened: "time", checked: "datetime",
  }, "Char остаётся текстом, остальное — бинарное; Date/Time/DateTime в перечне обязаны быть");
}

// ---------- DateTime не должен съедаться правилом для Date ----------
{
  const { binTypes } = MI.parseTabText("Fields 1\r\n    checked DateTime ;");
  assert.equal(binTypes.checked, "datetime",
    "«DateTime» опознан как «Date» — восьмибайтовое поле прочитается четырьмя байтами");
}

// ---------- собираем .dat по раскладке MITAB и читаем его ----------
{
  const поля = [["built", 4], ["opened", 4], ["checked", 8], ["persons", 4]];
  const headerSize = 32 + поля.length * 32 + 1;
  const recordSize = 1 + поля.reduce((sum, [, len]) => sum + len, 0);
  const записей = 2;
  const buffer = new ArrayBuffer(headerSize + recordSize * записей + 1);
  const bytes = new Uint8Array(buffer), dv = new DataView(buffer);
  bytes[0] = 0x03;
  dv.setUint32(4, записей, true);
  dv.setUint16(8, headerSize, true);
  dv.setUint16(10, recordSize, true);
  поля.forEach(([имя, len], i) => {
    const at = 32 + i * 32;
    for (let c = 0; c < имя.length; c++) bytes[at + c] = имя.charCodeAt(c);
    bytes[at + 11] = "C".charCodeAt(0);          // .dat врёт: «текст» на всё
    bytes[at + 16] = len;
  });
  bytes[32 + поля.length * 32] = 0x0d;

  // запись 1: 27 июля 2026, 13:45:07.250, и то же в DateTime, 123456 человек
  const мс = ((13 * 60 + 45) * 60 + 7) * 1000 + 250;
  let at = headerSize;
  bytes[at] = 0x20;
  dv.setInt16(at + 1, 2026, true); bytes[at + 3] = 7; bytes[at + 4] = 27;
  dv.setInt32(at + 5, мс, true);
  dv.setInt16(at + 9, 2026, true); bytes[at + 11] = 7; bytes[at + 12] = 27;
  dv.setInt32(at + 13, мс, true);
  dv.setInt32(at + 17, 123456, true);
  // запись 2: пустая дата (нули) и пустое время (-1)
  at += recordSize;
  bytes[at] = 0x20;
  dv.setInt32(at + 5, -1, true);
  dv.setInt32(at + 17, -7, true);

  const binTypes = { built: "date", opened: "time", checked: "datetime", persons: "i32" };
  const { rows } = SHP.parseDbf(buffer, null, binTypes);
  assert.equal(rows.length, 2, "обе записи обязаны прочитаться");
  assert.equal(rows[0].built, "2026-07-27",
    "дата: int16 год, байт месяц, байт день — по MITAB");
  assert.equal(rows[0].opened, "13:45:07.250",
    "время: int32 миллисекунд от полуночи");
  assert.equal(rows[0].checked, "2026-07-27 13:45:07.250",
    "«дата и время» — дата, затем те же миллисекунды, восемь байтов");
  assert.equal(rows[0].persons, 123456, "целое читается little-endian — это уже работало");
  assert.equal(rows[1].built, null, "нулевая дата в MITAB значит «значения нет», а не нулевой год");
  assert.equal(rows[1].opened, null, "время −1 значит «значения нет»");
  assert.equal(rows[1].persons, -7, "отрицательное целое не должно пострадать");

  // без binTypes (не передали типы из .tab) поле остаётся мусором — ровно та
  // беда, что была: сторож фиксирует, что лечится это именно типами из .tab
  const сырое = SHP.parseDbf(buffer, null, null).rows[0].built;
  assert.notEqual(сырое, "2026-07-27",
    "без типов из .tab дата и не должна складываться — иначе проверка ничего не значит");
}

console.log("mapinfo-datetime: OK");
