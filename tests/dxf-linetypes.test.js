"use strict";

// Штрих не доезжал до AutoCAD вообще.
//
// В стилях лежат настоящие узоры ЛГР — [11.34, 3.78] у КЛ ТОП, [14,5,4,5] у
// границы территории и ещё десяток. А выгрузка в DXF писала КАЖДОМУ слою
// безусловное CONTINUOUS, и таблицы LTYPE в файле не было вовсе. Замер до
// правки: в файле ноль вхождений «LTYPE», у всех слоёв код 6 = CONTINUOUS.
// В AutoCAD красная линия застройки приходила сплошной и становилась
// неотличима от границы участка — чертёж менял смысл, а не только вид.
// Человеку об этом не говорили: предупреждение при выгрузке упоминало только
// заливку и штриховку зон.
//
// Единицы — отдельная ловушка. В стилях штрих задан в пикселях ОПОРНОГО
// масштаба (96 dpi, 3779.5 px в метре бумаги), а в DXF единица одна — метр
// местности. При 1:2000 это ровно ×2 от миллиметров бумаги: 11.34 px = 3 мм
// = 6 м местности. Сторож проверяет именно число, а не факт наличия таблицы:
// таблица с неверными длинами хуже её отсутствия — она выглядит правильной.

const assert = require("node:assert/strict");
const path = require("node:path");
const { читатьЧистый } = require("./_source");

const root = path.join(__dirname, "..");
require(path.join(root, "app-labels.js"));
require(path.join(root, "app-dxf.js"));
const D = globalThis.GRADO_DXF;

const пары = text => {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1].trim()]);
  return out;
};
// значения кода внутри записи, начинающейся с 0/<тип> и имени 2/<имя>
function записьLtype(text, имя) {
  const p = пары(text);
  const начало = p.findIndex((пара, i) => пара[0] === "2" && пара[1] === имя &&
    i > 0 && p[i - 1][0] === "0" && p[i - 1][1] === "LTYPE");
  assert.ok(начало > 0, `в файле нет типа линии «${имя}»`);
  const запись = [];
  for (let i = начало + 1; i < p.length && p[i][0] !== "0"; i++) запись.push(p[i]);
  return запись;
}

function выгрузить(стилиПоСлоям, стильОбъекта) {
  const слои = [...стилиПоСлоям.keys()];
  const features = слои.map((слой, index) => ({ id: index + 1, line: [[0, 0], [100, 0]], __l: слой }));
  return D.buildDxf({
    features, layers: слои,
    styleOf: (feature, layer) => (layer ? стилиПоСлоям.get(layer)
      : (стильОбъекта && стильОбъекта(feature)) || стилиПоСлоям.get(feature.__l)) || {},
    layerOf: feature => feature.__l,
  });
}

const КЛ = { title: "КЛ ТОП" };
const ГРАНИЦА = { title: "Граница территории" };
const УЧАСТОК = { title: "Участок" };
const КЛ2 = { title: "КЛ ЛО" };

// ---------- узор и его единицы ----------
{
  const { text } = выгрузить(new Map([
    [КЛ, { stroke: "#fe0004", dash: [11.34, 3.78], ground_units: true, ref_scale: 2000 }],
    [УЧАСТОК, { stroke: "#8a7a5c" }],
  ]));

  assert.ok(text.includes("\n2\nLTYPE\n"), "в файле обязана быть таблица типов линий");
  assert.ok(text.indexOf("\n2\nLTYPE\n") < text.indexOf("\n2\nLAYER\n"),
    "LTYPE обязан объявляться раньше LAYER: слой ссылается на тип по имени");

  const запись = записьLtype(text, "GRADO_D1");
  const отрезки = запись.filter(пара => пара[0] === "49").map(пара => Number(пара[1]));
  assert.equal(отрезки.length, 2, "узор [штрих, пробел] обязан дать два отрезка");
  assert.ok(Math.abs(отрезки[0] - 6) < 0.01,
    `11.34 px опорного 1:2000 — это 6 м местности, получено ${отрезки[0]}`);
  assert.ok(Math.abs(отрезки[1] + 2) < 0.01,
    `пробел 3.78 px — это −2 м (в LTYPE пробел отрицателен), получено ${отрезки[1]}`);
  const всего = Number(запись.find(пара => пара[0] === "40")[1]);
  assert.ok(Math.abs(всего - 8) < 0.02, `длина узора — сумма модулей, ожидалось 8 м, получено ${всего}`);
  assert.equal(запись.find(пара => пара[0] === "73")[1], "2", "73 — число отрезков в узоре");
  assert.equal(запись.find(пара => пара[0] === "72")[1], "65",
    "72=65 — единственный код выравнивания, который знает R12");

  // слой без штриха обязан остаться сплошным, а не получить чужой узор
  const слои = text.slice(text.indexOf("\n2\nLAYER\n"));
  assert.match(слои, /\n2\nУчасток\n70\n0\n62\n\d+\n6\nCONTINUOUS\n/,
    "слой без штриха обязан остаться CONTINUOUS");
  assert.match(слои, /\n2\nКЛ_ТОП\n70\n0\n62\n\d+\n6\nGRADO_D1\n/,
    "слой со штрихом обязан ссылаться на свой тип линии");
}

// ---------- один узор — одна запись на весь файл ----------
{
  const узор = { stroke: "#fe0004", dash: [11.34, 3.78], ground_units: true, ref_scale: 2000 };
  const { text } = выгрузить(new Map([[КЛ, узор], [КЛ2, { ...узор }]]));
  const сколько = text.split("\n2\nGRADO_D").length - 1;
  assert.equal(сколько, 1, "одинаковый штрих у двух слоёв обязан дать ОДИН тип линии");
  assert.ok(!text.includes("GRADO_D2"), "второй записи под тот же узор быть не должно");
}

// ---------- нечётный массив: фаза не должна перевернуться ----------
{
  // canvas повторяет [a,b,c] как a b c a b c — штрих и пробел на втором проходе
  // меняются местами. LTYPE так не умеет, поэтому массив разворачиваем сами.
  const { text } = выгрузить(new Map([[КЛ, { stroke: "#f00", dash: [4, 2, 8] }]]));
  const отрезки = записьLtype(text, "GRADO_D1").filter(п => п[0] === "49").map(п => Number(п[1]));
  assert.equal(отрезки.length, 6, "нечётный узор обязан развернуться в чётный, а не обрезаться");
  assert.deepEqual(отрезки.map(v => Math.sign(v)), [1, -1, 1, -1, 1, -1],
    "знаки обязаны чередоваться: штрих, пробел, штрих…");
}

// ---------- свой знак объекта поверх слоевого ----------
{
  const { text } = выгрузить(
    new Map([[ГРАНИЦА, { stroke: "#1c1c1a", dash: [14, 5, 4, 5] }]]),
    () => ({ stroke: "#1c1c1a", dash: [11.34, 3.78], ground_units: true, ref_scale: 2000 }));
  const polyline = text.slice(text.indexOf("\n0\nPOLYLINE\n"));
  assert.match(polyline.slice(0, 120), /\n6\nGRADO_D\d\n/,
    "объект со своим штрихом обязан нести тип линии на себе: цвет так уже работает");
}

// ---------- слоевой знак не дублируется на каждой сущности ----------
{
  const { text } = выгрузить(new Map([
    [КЛ, { stroke: "#fe0004", dash: [11.34, 3.78], ground_units: true, ref_scale: 2000 }]]));
  const polyline = text.slice(text.indexOf("\n0\nPOLYLINE\n"), text.indexOf("\n0\nVERTEX\n"));
  assert.doesNotMatch(polyline, /\n6\n/,
    "если знак объекта совпадает со слоевым, переопределение лишнее — сущность и так BYLAYER");
}

// ---------- пересчёт px→метры опирается на ту же величину, что и холст ----------
{
  const dxf = читатьЧистый("app-dxf.js");
  const render = читатьЧистый("app-labels-place.js");
  assert.match(dxf, /3779\.5/, "коэффициент пересчёта обязан остаться в выгрузке");
  assert.match(render, /3779\.5/,
    "тот же коэффициент живёт в groundFactor: разъедутся — штрих в CAD и на холсте станут разной длины");
}

console.log("dxf-linetypes: OK");
