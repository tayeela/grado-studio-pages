"use strict";

// Чертёж живёт в canvas: для скринридера холст — пустой прямоугольник, объектов
// в дереве доступности нет вовсе. Живая область сообщала только о выделении,
// сделанном мышью. Здесь проверяется сама навигация: порядок объектов, шаг по
// слоям и то, что обзор не превращается в ловушку фокуса.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "redesign", "shell.css"), "utf8");

// --- разметка ---
assert.match(html, /id="cv-reader"[^>]*tabindex="0"/,
  "обзор объектов обязан быть в порядке обхода клавиатуры");
assert.match(html, /id="cv"[^>]*aria-label="[^"]*Tab[^"]*"/,
  "подпись холста обязана сообщать, как попасть в обзор объектов");
const readerIdx = html.indexOf('id="cv-reader"');
assert.ok(readerIdx > html.indexOf('id="cv"'),
  "обзор должен идти после холста, иначе Tab ведёт в него до самого чертежа");
assert.match(html, /id="cv-reader-pos"/, "нужна строка позиции курсора");
assert.match(html, /id="cv-reader-text"/, "нужна строка описания объекта");

// --- показ по фокусу, но без выпадения из обхода ---
const rule = css.slice(css.indexOf(".cv-reader{"), css.indexOf(".statusbar{"));
assert.doesNotMatch(rule, /display:none|visibility:hidden/,
  "скрытие через display/visibility выкидывает элемент из порядка Tab");
assert.match(rule, /\.cv-reader:focus/, "по фокусу панель обязана становиться видимой");

// --- логика порядка и шагов ---
const start = app.indexOf("const cvReader = { order: null, pos: -1 }");
const end = app.indexOf("function renderProps()");
assert.ok(start > 0 && end > start, "блок обзора должен оставаться извлекаемым");

const LAYERS = [
  { id: "L1", title: "Границы", visible: true },
  { id: "L2", title: "Здания", visible: true },
  { id: "L3", title: "Скрытый", visible: false },
];
const FEATURES = [
  { id: "b1", layer_id: "L1", ring: [] },
  { id: "h1", layer_id: "L2", ring: [], props: { floors: 9 } },
  { id: "h2", layer_id: "L2", ring: [], props: {} },
  { id: "x1", layer_id: "L3", ring: [] },
];
const said = [];
const status = [];
const context = vm.createContext({
  state: { features: FEATURES, selected: null, view: { tx: 0, ty: 0, k: 1 } },
  layerOf: f => LAYERS.find(L => L.id === f.layer_id) || null,
  layerDrawable: L => !!L && L.visible,
  // панель слоёв показывает верхний слой первым — обзор обязан идти так же
  layerRowsTopFirst: () => [...LAYERS].reverse(),
  ATTR_FIELDS: {},
  featureArea: () => 12345,
  fmtAreaHa: v => (v / 10000).toFixed(2) + " га",
  fmtLen: v => v + " м",
  lineLen: () => 0,
  featureViewBox: () => null,
  w2s: (x, y) => [x, y],
  zoomToFeature: () => {},
  selectOne: id => { context.state.selected = id; },
  draw: () => {},
  renderProps: () => {},
  srSay: text => said.push(text),
  document: { getElementById: () => null },
  cvReaderStatus: (head, body) => status.push([head, body]),
});
vm.runInContext(app.slice(start, end).replace(/^\{[\s\S]*\}$/m, ""), context);
// const в vm не попадает на объект контекста — вытаскиваем состояние явно
const cvReader = vm.runInContext("cvReader", context);

const order = context.cvReaderOrder();
assert.deepEqual(Array.from(order, e => e.id), ["h1", "h2", "b1"],
  "объекты скрытого слоя не читаются, порядок слоёв — как в панели");

context.cvReaderGoto(0, false);
assert.equal(context.state.selected, "h1", "переход обязан выделять объект");
assert.match(said.at(-1), /^1 из 3 · Здания\./,
  "скринридер обязан слышать позицию и слой, иначе непонятно, где он");

context.cvReaderStep(1, false);
assert.equal(context.state.selected, "h2", "шаг вниз ведёт к следующему объекту");

// шаг по слоям: из «Зданий» сразу к первому объекту «Границ»
context.cvReaderLayerStep(1);
assert.equal(context.state.selected, "b1", "PageDown обязан перепрыгивать слой целиком");

context.cvReaderStep(1, false);
assert.equal(context.state.selected, "b1", "за последним объектом курсор не уезжает");
assert.match(said.at(-1), /последний объект/, "об упоре в конец нужно сообщить");

context.cvReaderGoto(0, false);
context.cvReaderStep(-1, false);
assert.match(said.at(-1), /первый объект/, "об упоре в начало — тоже");

// курсор подхватывает выделение мышью, а не уводит на своё старое место
context.cvReaderGoto(0, false);
context.state.selected = "b1";
context.cvReaderStep(-1, false);
assert.equal(context.state.selected, "h2",
  "после выбора мышью шаг обязан считаться от выбранного объекта");

// пустая сцена не должна ронять обзор
context.state.features = [];
cvReader.order = null;
context.cvReaderGoto(0, false);
assert.match(said.at(-1), /нет объектов/, "пустой чертёж обязан сообщать о себе словами");

// --- атрибуты по Enter ---
const attrs = app.slice(app.indexOf("function featureAttrText"),
  app.indexOf("function featureReadText"));
assert.match(attrs, /ATTR_FIELDS\[L\.semantic_class\]/, "семантические атрибуты обязаны читаться");
assert.match(attrs, /L\.fields/, "пользовательские атрибуты слоя — тоже");
assert.match(attrs, /field\.compute\(f\)/, "вычисляемые показатели (СПП) читаются вместе с остальными");

// --- не ловушка фокуса и не общий обработчик ---
const handler = app.slice(app.indexOf('reader.addEventListener("keydown"'), end);
assert.match(handler, /key === "Escape"/, "Escape обязан возвращать на холст");
assert.doesNotMatch(handler, /"Tab"/,
  "Tab обязан выводить из обзора — перехват сделал бы его ловушкой фокуса");
assert.match(handler, /event\.stopPropagation\(\)/,
  "стрелки не должны доходить до общего обработчика: там они двигают объекты");

// кэш порядка обязан сбрасываться при правках, иначе обзор читает удалённое
assert.match(app, /state\._ix = null; state\._snapIndex = null; cvReader\.order = null;/,
  "afterChange обязан сбрасывать кэш порядка обзора");

// двойное озвучивание: renderProps объявляет выделение сам
assert.match(app, /if \(!node \|\| _srSuppress\) return;/,
  "на время правки панели обычное объявление выделения обязано молчать");

console.log("canvas-reader: OK");
