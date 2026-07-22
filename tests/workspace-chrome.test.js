"use strict";

// Правки по замечаниям с рабочего экрана:
// 1. Демо-проект и экран-гид: гид перекрывал холст и вёл через границу
//    территории, хотя чертить можно с любого слоя; демо уводило от настоящих
//    данных, которые дают выгрузка по области и файлы.
// 2. Ширину тянула только правая панель, хотя длинные названия слоёв портала —
//    в левой.
// 3. Кнопки в тесной шапке сжимались, и содержимое упиралось в их края.
// 4. Стрелка севера на холсте: вид не поворачивается, север всегда вверх.
// 5. Кнопки панелей стояли обе справа — теперь каждая со своей стороны.
// 6. Окно типов слоёв первым делом показывало список НЕизменяемых встроенных.
// 7. Каталог ГИС ОГД схлопывался на каждый выбор слоя.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const data = fs.readFileSync(path.join(root, "app-data.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "redesign", "shell.css"), "utf8");
const layersCss = fs.readFileSync(path.join(root, "redesign", "layers-studio.css"), "utf8");

// ---------- 1. ни демо, ни экрана-гида ----------
for (const trace of ["btn-demo", "start-guide", "start-demo", "start-draw", "start-unlock"])
  assert.ok(!html.includes(trace) && !app.includes(trace), `рудимент: ${trace}`);
assert.match(html, /id="cv-empty"/, "пустой холст объясняется строкой");
assert.match(shell, /\.cv-empty\{[^}]*pointer-events:none/, "подсказка не перехватывает мышь");
// пустой проект больше не тупик: инструмент сам заводит слой
const setToolAt = app.indexOf("function setTool(tool, opts = {}) {");
const setTool = app.slice(setToolAt, app.indexOf("\nfunction ", setToolAt + 10));
assert.match(setTool, /createGenericLayer\(\{ geometry_type: geom, title: AUTO_LAYER_TITLE\[geom\] \}\)/,
  "выбор инструмента в пустом проекте обязан заводить слой сам");
assert.ok(!setTool.includes('toast("Создайте слой для рисования"'),
  "тупик с тостом «создайте слой» больше не нужен");
const avail = app.slice(app.indexOf("const drawingTools = new Set("), app.indexOf('["btn-join", "btn-buffer-open"]'));
assert.match(avail, /const blocked = !!active && !canDraw;/,
  "инструмент гасим только когда слой есть, но чертить в него нельзя");

// ---------- 2. обе панели тянутся ----------
assert.match(html, /id="layers-resizer"/, "у панели слоёв обязан быть разделитель");
assert.match(app, /function initSidePanelResizer\(config\)/, "логика ресайза общая для обеих панелей");
assert.match(app, /side: 'left', min: 240, max: 520/, "левая панель тянется в своих пределах");
assert.match(app, /side: 'right', min: 300, max: 640/, "правая — в своих");
assert.match(app, /setWidth\(config\.side === 'left' \? startW \+ dx : startW - dx, true\)/,
  "у левой панели перетаскивание вправо расширяет, у правой — сужает");
assert.match(app, /try \{ resizer\.setPointerCapture\(e\.pointerId\); \} catch \(error\) \{\}/,
  "захват указателя — удобство, а не условие: без него тянуть всё равно должно быть можно");
assert.match(shell, /#layers-resizer\{[^}]*cursor:col-resize/, "разделитель обязан выглядеть как разделитель");

// ---------- 3. содержимое кнопок не упирается в края ----------
assert.match(shell, /\.iconbtn\{\s*\r?\n\s*flex:0 0 auto;/, "иконочная кнопка не должна сжиматься");
assert.match(shell, /\.btn\{\s*\r?\n\s*flex:0 0 auto;/, "кнопка с текстом тоже");
assert.match(shell, /\.card-toggle\{[^}]*padding-inline:10px/, "заголовок карточки — с отступами");
assert.match(layersCss, /\.layer-create-main\{[^}]*padding:0 12px/, "«Слой / знак» — с отступами");
assert.match(layersCss, /\.layers-view-tabs button\{[^}]*padding-inline:8px/, "вкладки панели — с отступами");

// ---------- 4-5. холст и кнопки панелей ----------
assert.ok(!html.includes("cv-compass"), "север всегда вверх — стрелка не несёт сведений");
const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
const first = header.indexOf("btn-layers-visibility"), last = header.indexOf("btn-panel-visibility");
assert.ok(first > 0 && last > first, "кнопка слоёв слева, кнопка инспектора справа");
assert.ok(first < header.indexOf("workspace-modes"),
  "кнопка панели слоёв обязана стоять у своего края, а не в правой группе");

// ---------- 6. типы слоёв: только свои ----------
const kinds = app.slice(app.indexOf("function openManageKinds()"), app.indexOf("function openVariants"));
assert.ok(!kinds.includes("mk-builtin") && !kinds.includes("Встроенные</div>"),
  "неизменяемый список встроенных ролей из окна убран");
assert.match(kinds, /const customs = BASE_KINDS\.filter\(isCustomKind\);/, "в списке — свои типы");
assert.match(kinds, /Свои типы слоёв/, "и заголовок про них же");

// ---------- 7. каталог не схлопывается ----------
assert.match(data, /const ogdOpenPaths = new Set\(\)/, "раскрытые папки каталога обязаны переживать перерисовку");
assert.match(data, /overlay\.addEventListener\("toggle", event => \{/, "открытие папки нужно запоминать");
assert.match(data, /data-path="\$\{escHtml\(kidPath\)\}"/, "папка обязана знать свой путь");
assert.match(data, /ogdTreeHtml\(ogdBuildTree\(catalog\), gi, selectedMap, false, !!low \|\| !!activeTopic, 0, "", ogdOpenPaths\)/,
  "состояние раскрытия обязано доезжать до дерева");

console.log("workspace-chrome: OK");
