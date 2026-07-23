"use strict";

// Лист PDF: собственный писатель формата и рекордер холста.
//
// Печать в масштабе в браузерной редакции была недоступна вовсе, хотя работа
// идёт именно в браузере. Что здесь важно:
// 1. Лист рисуется ТЕМ ЖЕ кодом, что экран: рекордер повторяет подмножество
//    Canvas 2D. Второй рендерер неизбежно разошёлся бы с холстом.
// 2. Масштаб точен по построению: 300 м при 1:2000 — это ровно 150 мм листа.
// 3. Кириллица идёт встроенным шрифтом с таблицей ToUnicode, иначе текст в
//    готовом листе не ищется и не копируется.
// 4. Прозрачность обязана возвращаться к единице: иначе линия после
//    полупрозрачной заливки наследует её альфу.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-pdf.js"));
require(path.join(root, "app-sheet.js"));
const P = globalThis.GRADO_PDF;
const S = globalThis.GRADO_SHEET_CORE;
assert.ok(P && typeof P.createDocument === "function", "писатель обязан подниматься без документа");
assert.ok(S && typeof S.sheetView === "function", "ядро листа — тоже");

const fontBytes = fs.readFileSync(path.join(root, "fonts", "Onest-Variable.ttf"));
const text = bytes => Buffer.from(bytes).toString("latin1");

// ---------- чтение шрифта ----------
{
  const font = P.readFont(fontBytes);
  assert.ok(font.unitsPerEm >= 16, "единицы кегля обязаны читаться");
  assert.ok(font.numGlyphs > 100, `глифов ${font.numGlyphs} — таблица не прочиталась`);
  const glyphA = font.glyphOf("А".codePointAt(0));
  const glyphLatin = font.glyphOf("A".codePointAt(0));
  assert.ok(glyphA > 0, "кириллица обязана находиться в таблице символов");
  assert.notEqual(glyphA, glyphLatin, "кириллическая А и латинская A — разные глифы");
  assert.ok(font.advance(glyphA) > 0, "ширина глифа обязана читаться");
  assert.throws(() => P.readFont(new Uint8Array(64)), /не TrueType/);
}

// ---------- цвета ----------
{
  const near = (value, expected) => Math.abs(value - expected) < 0.01;
  const white = P.parseColor("#ffffff");
  assert.ok(near(white.r, 1) && near(white.a, 1));
  const short = P.parseColor("#fc0");
  assert.ok(near(short.r, 1) && near(short.g, 0.8) && near(short.b, 0));
  const rgba = P.parseColor("rgba(245,219,219,.85)");
  assert.ok(near(rgba.a, 0.85), "прозрачность из rgba обязана доезжать");
  const hexAlpha = P.parseColor("#12345680");
  assert.ok(near(hexAlpha.a, 0.502), `альфа из hex: ${hexAlpha.a}`);
  assert.equal(P.parseColor("transparent"), null);
}

// ---------- геометрия листа: масштаб точен по построению ----------
{
  const sheet = { format: "A3", portrait: false, scale: 2000, cx: 0, cy: 0 };
  const [widthMm, heightMm] = S.sheetSize("A3", false);
  assert.deepEqual([widthMm, heightMm], [420, 297]);
  assert.deepEqual(S.sheetSize("A3", true), [297, 420], "книжная ориентация меняет стороны");
  const extent = S.sheetExtent(sheet);
  assert.ok(Math.abs((extent[2] - extent[0]) - 840) < 1e-6, "A3 в 1:2000 накрывает 840 м");
  assert.ok(Math.abs((extent[3] - extent[1]) - 594) < 1e-6, "и 594 м по высоте");

  const view = S.sheetView(sheet);
  // k — экранных единиц на метр; в миллиметрах это ровно 1000/знаменатель
  const mmPerMetre = view.k * S.MM_PER_PX;
  assert.ok(Math.abs(mmPerMetre - 0.5) < 1e-9, `при 1:2000 метр — полмиллиметра, вышло ${mmPerMetre}`);
  const fine = S.sheetView({ ...sheet, scale: 500 });
  assert.ok(Math.abs(fine.k * S.MM_PER_PX - 2) < 1e-9, "при 1:500 метр — два миллиметра");
}

// ---------- писатель: структура файла ----------
{
  const doc = P.createDocument();
  doc.addFont("SheetFont", fontBytes);
  const page = doc.addPage(420, 297);
  const ctx = P.createContext(doc, page, { scale: 96 / 72, fontName: "SheetFont" });
  ctx.fillStyle = "#faf0bf";
  ctx.strokeStyle = "#b89e59";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(100, 0); ctx.lineTo(100, 60); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.fillText("Ж-1 многоквартирная", 20, 40);
  const bytes = doc.build();
  const file = text(bytes);

  assert.ok(file.startsWith("%PDF-1.7"), "файл обязан начинаться заголовком PDF");
  assert.ok(file.includes("%%EOF"), "и заканчиваться концом файла");
  assert.match(file, /\/Type \/Catalog/);
  assert.match(file, /\/MediaBox \[0 0 1190\.551 841\.89\]/,
    "A3 в пунктах — 1190.55×841.89; иначе размер листа не тот");
  assert.match(file, /\/Subtype \/Type0/, "кириллица требует составного шрифта");
  assert.match(file, /\/Encoding \/Identity-H/);
  assert.match(file, /\/ToUnicode \d+ 0 R/, "без ToUnicode текст в листе не ищется");
  assert.match(file, /\/FontFile2 \d+ 0 R/, "шрифт обязан вкладываться в файл");
  assert.match(file, /beginbfchar/, "таблица соответствия глиф→символ обязана быть заполнена");
  assert.ok(bytes.length > fontBytes.length, "файл обязан содержать шрифт целиком");
  // таблица ссылок обязана указывать на реальные объекты
  const xrefAt = file.lastIndexOf("startxref");
  const xref = parseInt(file.slice(xrefAt + 9).trim(), 10);
  assert.ok(xref > 0 && file.slice(xref, xref + 4) === "xref", "startxref обязан указывать на таблицу");
}

// ---------- прозрачность возвращается к единице ----------
{
  const doc = P.createDocument();
  doc.addFont("F", fontBytes);
  const page = doc.addPage(100, 100);
  const ctx = P.createContext(doc, page, { scale: 1, fontName: "F" });
  ctx.fillStyle = "rgba(255,0,0,0.3)";
  ctx.fillRect(0, 0, 10, 10);
  ctx.strokeStyle = "#0000ff";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.stroke();
  const ops = page.ops.join("\n");
  const states = [...ops.matchAll(/\/(GS\d+) gs/g)].map(match => match[1]);
  assert.ok(states.length >= 2, "состояние прозрачности обязано выставляться перед каждой операцией");
  assert.notEqual(states[0], states[1],
    "после полупрозрачной заливки альфа обязана вернуться к единице, иначе линия выйдет бледной");
  const alphas = [...page.alphas.keys()].sort();
  assert.deepEqual(alphas, [0.3, 1], `в ресурсах обязаны быть обе прозрачности: ${alphas}`);
}

// ---------- рекордер: подмножество Canvas 2D ----------
{
  const doc = P.createDocument();
  doc.addFont("F", fontBytes);
  const page = doc.addPage(100, 100);
  const ctx = P.createContext(doc, page, { scale: 1, fontName: "F" });

  ctx.setLineDash([8, 4]);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(50, 0); ctx.stroke();
  assert.match(page.ops.join("\n"), /\[8 4\] 0 d/, "штрих обязан доезжать до листа");

  // дуга ломается на кубические кривые: окружностей в PDF нет
  ctx.beginPath(); ctx.arc(50, 50, 20, 0, Math.PI * 2);
  ctx.stroke();
  assert.ok((page.ops.join("\n").match(/ c$/gm) || []).length >= 4,
    "полная окружность обязана разложиться минимум на четыре кривые");

  // save/restore обязаны попадать в поток как q/Q — иначе состояние потечёт
  const before = page.ops.length;
  ctx.save(); ctx.restore();
  assert.deepEqual(page.ops.slice(before), ["q", "Q"]);

  // измерение текста обязано совпадать с тем, чем он рисуется
  const width = ctx.measureText("Ж-1").width;
  assert.ok(width > 0 && width < 100, `ширина строки ${width} — метрики шрифта не читаются`);
  assert.ok(ctx.measureText("ЖЖЖЖ").width > ctx.measureText("Ж").width * 3.5,
    "ширина обязана расти с числом символов");

  // текст пишется номерами глифов, а не байтами строки
  ctx.fillText("Ж-1", 10, 10);
  assert.match(page.ops.join("\n"), /<[0-9a-f]{12}> Tj/,
    "три символа — шесть байт номеров глифов");
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");

  assert.match(app, /function renderSceneTo\(target, width, height, view\)/,
    "лист обязан рисоваться тем же drawNow, что и экран");
  assert.match(app, /let ctx = cv\.getContext\("2d"\);/,
    "цель отрисовки обязана подменяться — иначе нужен второй рендерер");
  assert.match(app, /const viewportW = \(\) => _renderTarget \? _renderTarget\.w : cv\.clientWidth;/,
    "размер «холста» на время листа берётся из листа");
  assert.match(app, /if \(!_renderTarget\) \{ drawBasemap\(w, h\); drawGrid\(w, h\); \}/,
    "сетке и тайлам на листе не место");
  assert.match(app, /if \(!_renderTarget && typeof sheetDrawOverlay === "function"\)/,
    "рамка листа рисуется только на экране");
  assert.match(app, /state\.selected = null; state\.selectedIds = new Set\(\); state\.snapHit = null; state\.guides = \[\];/,
    "выделение и привязки — это экран, на лист они не идут");
  assert.match(html, /id="btn-sheet-pdf"/, "выпуск листа обязан быть в меню «Выпуск»");
  assert.ok(html.indexOf('src="./app-pdf.js') < html.indexOf('src="./app-sheet.js'),
    "лист опирается на писатель — порядок загрузки обязан это учитывать");
  assert.match(sheet, /localStorage\.setItem\("grado-sheet"/,
    "рамка — состояние вида: в проект она не пишется");
  assert.doesNotMatch(sheet, /snapshot\(\)/, "выпуск листа ничего не меняет в проекте");
}

console.log("sheet-pdf: OK");
