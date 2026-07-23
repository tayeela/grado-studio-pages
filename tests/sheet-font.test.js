"use strict";

// Шрифт листа. Century Gothic — шрифт Monotype: раздавать его файл с сайта
// нельзя, а встраивать в свой выпущенный PDF можно. Поэтому файл кладёт
// человек, и он остаётся в браузере.
//
// Что здесь важно:
// 1. Негодный файл обязан отвергаться СРАЗУ, при выборе. Иначе о подмене
//    узнают по готовому листу с пустыми прямоугольниками вместо букв.
// 2. Одному глифу отвечает несколько кодов (дефис — U+002D и U+00AD, пробел —
//    U+0020 и U+00A0). В обратную таблицу обязан идти наименьший, иначе текст
//    из листа копируется мягкими переносами.
// 3. Пока своего файла нет, лист идёт на Onest из репозитория — его лицензия
//    встраивание разрешает.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-pdf.js"));
const P = globalThis.GRADO_PDF;

const onest = fs.readFileSync(path.join(root, "fonts", "Onest-Variable.ttf"));
const text = bytes => Buffer.from(bytes).toString("latin1");

// ---------- обратная таблица берёт основной код символа ----------
{
  const doc = P.createDocument();
  doc.addFont("F", onest);
  const page = doc.addPage(100, 40);
  const ctx = P.createContext(doc, page, { scale: 1, fontName: "F" });
  ctx.font = "12px sans-serif";
  ctx.fillText("архитектурно-планировочной", 5, 20);
  const file = text(doc.build());

  const cmap = file.slice(file.indexOf("beginbfchar"), file.indexOf("endbfchar"));
  const pairs = [...cmap.matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4})>/g)]
    .map(match => [match[1], parseInt(match[2], 16)]);
  assert.ok(pairs.length > 5, "таблица соответствия обязана быть заполнена");
  const codes = pairs.map(pair => pair[1]);
  assert.ok(codes.includes(0x2d), "дефис обязан отдаваться дефисом U+002D");
  assert.ok(!codes.includes(0xad), "а не мягким переносом U+00AD");
  // один глиф — одна строка таблицы
  const glyphs = pairs.map(pair => pair[0]);
  assert.equal(new Set(glyphs).size, glyphs.length, "глиф не должен встречаться дважды");
}

// ---------- негодный файл отвергается ----------
{
  assert.throws(() => P.readFont(new Uint8Array(300)), /не TrueType/,
    "мусор вместо шрифта обязан отвергаться сразу");
  // усечённый настоящий шрифт: заголовок на месте, таблиц нет
  const truncated = new Uint8Array(onest.subarray(0, 12));
  assert.throws(() => P.readFont(truncated), /повреждён или обрезан/,
    "и обрезанный файл — тоже, человеческими словами, а не про DataView");
}

// ---------- кириллица проверяется до выпуска ----------
{
  const font = P.readFont(onest);
  for (const char of "АБВЯабвя№")
    assert.ok(font.glyphOf(char.codePointAt(0)) > 0, `в шрифте нет символа ${char}`);
}

// ---------- проводка ----------
{
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  assert.match(sheet, /const FONT_DB = "grado-sheet-font";/,
    "файл шрифта обязан храниться в браузере, а не качаться с сайта");
  assert.match(sheet, /indexedDB\.open\(FONT_DB, 1\)/);
  assert.match(sheet, /for \(const char of "АБВЯабвя№"\)/,
    "перед сохранением шрифт обязан проверяться на кириллицу");
  assert.match(sheet, /в шрифте нет кириллицы/, "и человек обязан узнать причину отказа");
  assert.match(sheet, /FALLBACK_FONT = \{ name: "Onest"/,
    "пока своего файла нет, лист идёт на шрифте из репозитория");
  assert.match(sheet, /id="sheet-font-file"/, "файл выбирается в окне листа");
  assert.match(sheet, /Шрифт листа: \$\{info\.name\} \(ваш файл/,
    "и видно, каким шрифтом лист будет набран");
  // сам файл шрифта наружу не отправляется
  assert.doesNotMatch(sheet, /fetch\([^)]*font[^)]*POST/i);
}

console.log("sheet-font: OK");
