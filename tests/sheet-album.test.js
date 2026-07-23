"use strict";

// Альбом: несколько листов одним файлом. Что здесь важно:
// 1. У каждого листа свои формат, масштаб, охват, заголовок и номер — иначе
//    это не альбом, а копии одного листа.
// 2. Шрифт вкладывается в файл ОДИН раз на все страницы: альбом из десяти
//    листов не должен весить в десять раз больше одного.
// 3. Номер листа не может повторяться: два листа с одним номером — брак
//    выпуска, который заметят уже в переплёте.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-pdf.js"));
require(path.join(root, "app-sheet.js"));
const P = globalThis.GRADO_PDF;
const S = globalThis.GRADO_SHEET_CORE;
const fontBytes = fs.readFileSync(path.join(root, "fonts", "Onest-Variable.ttf"));
const text = bytes => Buffer.from(bytes).toString("latin1");

// ---------- страницы с разными форматами и масштабами ----------
{
  const doc = P.createDocument();
  doc.addFont("SheetFont", fontBytes);
  globalThis.LAYERS_V2 = [];
  globalThis.state = { features: [] };

  const sheets = [
    { format: "A3", portrait: false, scale: 2000, cx: 0, cy: 0,
      column: { on: true, widthMm: 110, title: "Существующее положение", number: "1" } },
    { format: "A2", portrait: true, scale: 1000, cx: 100, cy: 50,
      column: { on: true, widthMm: 90, title: "Архитектурно-планировочная организация", number: "2" } },
  ];
  for (const sheet of sheets) {
    const view = S.sheetView(sheet);
    const page = doc.addPage(view.widthMm, view.heightMm);
    const ctx = P.createContext(doc, page, { scale: 96 / 72, fontName: "SheetFont" });
    globalThis.drawSheetColumn(ctx, sheet, view);
  }
  const bytes = doc.build();
  const file = text(bytes);

  assert.equal((file.match(/\/Type \/Page[^s]/g) || []).length, 2, "в файле обязаны быть две страницы");
  assert.match(file, /\/MediaBox \[0 0 1190\.551 841\.89\]/, "A3 альбомный");
  assert.match(file, /\/MediaBox \[0 0 1190\.551 1683\.78\]/, "A2 книжный — другой размер");
  // шрифт один на весь файл
  assert.equal((file.match(/\/FontFile2/g) || []).length, 1,
    "шрифт обязан вкладываться один раз на все страницы");
  assert.ok(bytes.length < fontBytes.length * 1.6,
    `альбом весит ${bytes.length} при шрифте ${fontBytes.length} — шрифт задвоился`);
}

// ---------- охват каждого листа считается по его же настройкам ----------
{
  const a3 = S.sheetExtent({ format: "A3", portrait: false, scale: 2000, cx: 0, cy: 0,
    column: { on: true, widthMm: 110 } });
  const a2 = S.sheetExtent({ format: "A2", portrait: true, scale: 1000, cx: 0, cy: 0,
    column: { on: true, widthMm: 90 } });
  assert.ok(Math.abs((a3[2] - a3[0]) - 620) < 1e-6, "A3 с колонкой в 1:2000 — 620 м");
  assert.ok(Math.abs((a2[2] - a2[0]) - 330) < 1e-6, "A2 книжный с колонкой 90 мм в 1:1000 — 330 м");
  assert.ok(Math.abs((a2[3] - a2[1]) - 594) < 1e-6, "и 594 м по высоте");
}

// ---------- проводка ----------
{
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  assert.match(sheet, /const list = options\.sheets && options\.sheets\.length \? options\.sheets : \[sheet\];/,
    "выпуск обязан принимать набор листов, а не только текущий");
  assert.match(sheet, /async function addSheetPage\(doc, PDF, current, options\)/,
    "лист альбома — страница того же документа");
  assert.match(sheet, /const ALBUM_KEY = "grado-sheet-album";/,
    "альбом — состояние выпуска, а не данные проекта");
  assert.match(sheet, /const taken = new Set\(album\.map\(item => String\(item\.column && item\.column\.number \|\| ""\)\)\);/,
    "номер листа обязан быть уникальным");
  assert.match(sheet, /while \(taken\.has\(String\(next\)\)\) next \+= 1;/,
    "и подбираться, если занят");
  assert.match(sheet, /ruCount\(pages, "лист", "листа", "листов"\)/,
    "число листов обязано склоняться");
  assert.match(sheet, /id="sheet-album-run"/, "альбом выпускается своей кнопкой");
  assert.match(sheet, /data-album-open/, "лист альбома можно показать на чертеже");
  assert.match(sheet, /data-album-drop/, "и убрать из альбома");
}

console.log("sheet-album: OK");
