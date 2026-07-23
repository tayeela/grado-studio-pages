"use strict";

// Колонка листа — по эталону заказчика (альбом «Левшинский», A3): чертёж идёт
// под обрез слева, справа белая колонка с заголовком, условными обозначениями,
// таблицей ТЭП и сносками; номер листа — в рамке в правом нижнем углу.
//
// Что здесь важно:
// 1. Чертёж центрируется по СВОЕЙ полосе, а не по всему листу. Иначе правый
//    край молча уходит под колонку, и человек видит это только в готовом файле.
// 2. Охват на местности считается от чертёжной части: рамка на холсте обязана
//    показывать ровно то, что попадёт на лист.
// 3. Строки условных обозначений собираются из того же, что показывает панель
//    «Легенда»: слои, категории и диапазоны символики.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-pdf.js"));
require(path.join(root, "app-sheet.js"));
const S = globalThis.GRADO_SHEET_CORE;

// ---------- чертёж центрируется в своей полосе ----------
{
  const withColumn = { format: "A3", portrait: false, scale: 2000, cx: 0, cy: 0,
    column: { on: true, widthMm: 110 } };
  const view = S.sheetView(withColumn);
  assert.ok(Math.abs(view.width - 420 * S.PX_PER_MM) < 1e-6, "лист остаётся полным A3");
  assert.ok(Math.abs(view.drawWidth - 310 * S.PX_PER_MM) < 1e-6,
    "под чертёж остаётся лист минус колонка");
  assert.ok(Math.abs(view.tx - view.drawWidth / 2) < 1e-6,
    "центр чертежа — середина ЧЕРТЁЖНОЙ полосы, а не листа");

  const extent = S.sheetExtent(withColumn);
  assert.ok(Math.abs((extent[2] - extent[0]) - 620) < 1e-6,
    `310 мм при 1:2000 — это 620 м, вышло ${extent[2] - extent[0]}`);
  assert.ok(Math.abs((extent[3] - extent[1]) - 594) < 1e-6, "по высоте колонка ничего не отнимает");

  // без колонки чертёж занимает лист целиком
  const full = { ...withColumn, column: { on: false, widthMm: 110 } };
  assert.ok(Math.abs(S.sheetView(full).drawWidth - 420 * S.PX_PER_MM) < 1e-6);
  assert.ok(Math.abs((S.sheetExtent(full)[2] - S.sheetExtent(full)[0]) - 840) < 1e-6);
}

// ---------- колонка рисуется в лист ----------
{
  const P = globalThis.GRADO_PDF;
  const doc = P.createDocument();
  doc.addFont("F", fs.readFileSync(path.join(root, "fonts", "Onest-Variable.ttf")));
  const page = doc.addPage(420, 297);
  const ctx = P.createContext(doc, page, { scale: 96 / 72, fontName: "F" });
  const sheet = { format: "A3", portrait: false, scale: 2000, cx: 0, cy: 0,
    column: { on: true, widthMm: 110, legend: false, tep: false,
      title: "Схема архитектурно-планировочной организации территории",
      notes: "* коэффициент перехода — 0,614", number: "13" } };
  const view = S.sheetView(sheet);
  // ни слоёв, ни расчёта в Node нет — проверяем ту часть, что от них не зависит
  globalThis.LAYERS_V2 = [];
  globalThis.state = { features: [] };
  globalThis.drawSheetColumn(ctx, sheet, view);
  const stream = page.ops.join("\n");

  assert.match(stream, /1 1 1 rg/, "под колонкой обязан быть белый фон, иначе чертёж просвечивает");
  const texts = (stream.match(/<[0-9a-f]+> Tj/g) || []).length;
  assert.ok(texts >= 4, `в колонку попало ${texts} строк — заголовок с переносом, сноска и номер`);
  assert.match(stream, /re\nS/, "номер листа обязан стоять в рамке");

  // выключенная колонка не рисуется вовсе
  const page2 = doc.addPage(420, 297);
  const ctx2 = P.createContext(doc, page2, { scale: 96 / 72, fontName: "F" });
  const before = page2.ops.length;
  globalThis.drawSheetColumn(ctx2, { ...sheet, column: { on: false } }, view);
  assert.equal(page2.ops.length, before, "выключенная колонка не должна оставлять следов");
}

// ---------- проводка ----------
{
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  assert.match(sheet, /drawSheetColumn\(context, sheet, view\);/,
    "колонка обязана рисоваться при выпуске, после сцены");
  assert.match(sheet, /function tepRows\(\)/, "таблица ТЭП берётся из готового расчёта студии");
  assert.match(sheet, /root\.lastTepData/, "того же, что показан в панели");
  assert.match(sheet, /function wrapText\(context, text, maxWidth\)/,
    "длинные названия обязаны переноситься по ширине колонки");
  assert.match(sheet, /context\.measureText\(probe\)\.width/,
    "перенос обязан мерить теми же метриками, которыми пишется текст");
  assert.match(sheet, /id="sheet-title-text"/, "заголовок листа задаётся в окне");
  assert.match(sheet, /id="sheet-number"/, "и номер листа тоже");
  // на эталонных листах нет рамки по периметру: чертёж идёт под обрез
  assert.doesNotMatch(sheet, /strokeRect\(0, 0, view\.width/,
    "рамки по периметру листа быть не должно");
}

console.log("sheet-column: OK");
