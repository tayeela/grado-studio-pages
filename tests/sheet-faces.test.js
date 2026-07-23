"use strict";

// Начертания шрифта на листе. В рабочем альбоме заказчика живут обычное,
// полужирное, курсив и полужирный курсив — в TrueType это РАЗНЫЕ файлы, а не
// варианты одного, поэтому каждое кладётся отдельно.
//
// Что здесь важно:
// 1. Начертание выбирается по той же строке шрифта, что и на холсте
//    («700 12px …», «italic 11px …»). Иначе лист пришлось бы размечать вторым,
//    отдельным от экрана способом — и он бы разъехался.
// 2. Если нужного начертания человек не положил, берётся обычное: лучше ровный
//    текст, чем пропавшая строка.
// 3. Заголовки колонки и значения ТЭП идут полужирным — как в эталоне.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-pdf.js"));
const P = globalThis.GRADO_PDF;
const onest = fs.readFileSync(path.join(root, "fonts", "Onest-Variable.ttf"));
const text = bytes => Buffer.from(bytes).toString("latin1");

// ---------- разбор строки шрифта ----------
{
  assert.equal(P.faceOf("12px sans-serif"), "regular");
  assert.equal(P.faceOf("700 12px sans-serif"), "bold");
  assert.equal(P.faceOf("600 12px sans-serif"), "bold", "600 — это уже полужирный");
  assert.equal(P.faceOf("bold 12px sans-serif"), "bold");
  assert.equal(P.faceOf("italic 11px Georgia"), "italic");
  assert.equal(P.faceOf("700 italic 14px sans-serif"), "boldItalic");
  assert.equal(P.faceOf("italic bold 14px sans-serif"), "boldItalic");
  assert.equal(P.faceOf("400 12px sans-serif"), "regular", "обычный вес — обычное начертание");
  assert.equal(P.faceOf(""), "regular");
  // капитель — отдельный файл (в эталоне CenturyGothic-SC700), а не приём вёрстки
  assert.equal(P.faceOf("small-caps 700 16px sans-serif"), "smallCaps");
  assert.equal(P.faceOf("small-caps 16px sans-serif"), "smallCaps");
}

// ---------- капитель и её замена ----------
{
  const doc = P.createDocument();
  doc.addFont("R", onest);
  doc.addFont("B", onest);
  const page = doc.addPage(120, 40);
  // капитель НЕ вложена: обязана замениться полужирным, а не обычным
  const ctx = P.createContext(doc, page, { scale: 1, fontName: "R",
    fontFaces: { regular: "R", bold: "B", smallCaps: "SC" } });
  ctx.font = "small-caps 700 16px sans-serif";
  ctx.fillText("Титульный лист", 5, 20);
  const stream = page.ops.join(" ");
  assert.ok(stream.includes("/B "), "без капители обязан браться полужирный");
  assert.ok(!stream.includes("/SC "), "и не ссылаться на невложенный шрифт");

  // а когда вложена — берётся она
  const doc2 = P.createDocument();
  doc2.addFont("R", onest);
  doc2.addFont("SC", onest);
  const page2 = doc2.addPage(120, 40);
  const ctx2 = P.createContext(doc2, page2, { scale: 1, fontName: "R",
    fontFaces: { regular: "R", smallCaps: "SC" } });
  ctx2.font = "small-caps 700 16px sans-serif";
  ctx2.fillText("Титульный лист", 5, 20);
  assert.ok(page2.ops.join(" ").includes("/SC "), "положенная капитель обязана использоваться");
}

// ---------- лист использует нужные начертания ----------
{
  const doc = P.createDocument();
  const faces = {};
  for (const key of ["regular", "bold", "italic", "boldItalic"]) {
    const name = `Sheet_${key}`;
    doc.addFont(name, onest);           // в тесте файл один, важны имена в потоке
    faces[key] = name;
  }
  const page = doc.addPage(200, 100);
  const ctx = P.createContext(doc, page, { scale: 1, fontName: faces.regular, fontFaces: faces });
  ctx.font = "700 16px sans-serif";
  ctx.fillText("Заголовок", 10, 20);
  ctx.font = "12px sans-serif";
  ctx.fillText("обычный", 10, 40);
  ctx.font = "italic 12px sans-serif";
  ctx.fillText("курсив", 10, 60);
  ctx.font = "700 italic 12px sans-serif";
  ctx.fillText("оба", 10, 80);

  const stream = page.ops.join("\n");
  for (const key of ["regular", "bold", "italic", "boldItalic"])
    assert.ok(stream.includes(`/Sheet_${key} `), `в потоке нет обращения к начертанию ${key}`);
  assert.equal(page.fonts.size, 4, "на странице обязаны быть объявлены все четыре");
}

// ---------- нет нужного начертания — берётся обычное ----------
{
  const doc = P.createDocument();
  doc.addFont("Sheet_regular", onest);
  const page = doc.addPage(100, 50);
  const ctx = P.createContext(doc, page, { scale: 1, fontName: "Sheet_regular",
    fontFaces: { regular: "Sheet_regular", bold: "Sheet_bold" } });   // жирного в документе нет
  ctx.font = "700 14px sans-serif";
  ctx.fillText("Заголовок", 5, 20);
  const stream = page.ops.join("\n");
  assert.ok(stream.includes("/Sheet_regular "), "строка обязана напечататься обычным");
  assert.ok(!stream.includes("/Sheet_bold "), "и не ссылаться на невложенный шрифт");
  // ширина тоже обязана считаться существующим шрифтом, а не нулём
  assert.ok(ctx.measureText("Заголовок").width > 0);
}

// ---------- проводка ----------
{
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  assert.match(sheet, /\{ key: "boldItalic", title: "полужирный курсив" \}/,
    "начертания обязаны быть в списке");
  assert.match(sheet, /\{ key: "smallCaps", title: "капитель \(SC700\)" \}/,
    "включая капитель из эталонного альбома");
  assert.match(sheet, /column\.smallCapsTitle[\s\S]{0,80}small-caps 700/,
    "заголовок капителью — по галочке, а не всегда");
  assert.match(sheet, /id="sheet-smallcaps"/, "и галочка обязана быть в окне");
  assert.match(sheet, /doc\.addFont\(name, faces\[item\.key\]\.bytes\);/,
    "каждое положенное начертание вкладывается в файл");
  assert.match(sheet, /fontName: fontFaces\.regular, fontFaces/,
    "и доезжает до рекордера");
  assert.match(sheet, /: `700 \$\{16 \* PT\}px sans-serif`;/,
    "заголовок листа обязан быть полужирным — как в эталоне");
  assert.match(sheet, /context\.font = `700 \$\{10 \* PT\}px sans-serif`;[\s\S]{0,120}Условные обозначения/,
    "и заголовок условных обозначений тоже");
  assert.match(sheet, /store\.put\(\{ name, bytes, face, at: Date\.now\(\) \}/,
    "начертания хранятся раздельно");
  assert.match(sheet, /data-face="\$\{item\.key\}"/, "и выбираются каждое своим файлом");
}

console.log("sheet-faces: OK");
