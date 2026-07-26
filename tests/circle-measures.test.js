"use strict";

// Окружность рисуется своим инструментом и ложится в слой зоны — а во всей
// арифметике её не было: featureArea смотрела только на f.ring, длину брали
// только у f.line. Круглая зона молча весила НОЛЬ: ни площади в ТЭП, ни $area
// в таблице атрибутов, ни периметра. Дуга — то же самое.
//
// Проверяем меры на точных значениях, а не «примерно»: круг R=50 это ровно
// π·2500 = 7853.98 м², периметр 2πR = 314.16 м, дуга в четверть оборота —
// R·π/2 = 78.54 м.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

const геом = require("./_source").читатьЧистый("app-geom.js");

const начало = геом.indexOf("function featureArea(");
const конец = геом.indexOf("\n}", геом.indexOf("function lineLen(")) + 2;
assert.ok(начало > 0 && конец > начало, "меры должны оставаться извлекаемыми");

const среда = vm.createContext({
  ringArea: ring => {                       // та же формула, что в app-geom
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  },
});
vm.runInContext(геом.slice(начало, конец), среда);
const { featureArea, featureLength } = среда;

const близко = (было, надо, допуск, что) =>
  assert.ok(Math.abs(было - надо) < допуск, `${что}: получено ${было}, ожидалось ${надо}`);

// ---- площадь ----
близко(featureArea({ ring: [[0, 0], [100, 0], [100, 80], [0, 80]] }), 8000, 1e-6,
  "прямоугольник 100×80");
близко(featureArea({ circle: { cx: 0, cy: 0, r: 50 } }), Math.PI * 2500, 1e-6,
  "круг R=50 — площадь π·R², а не ноль");
близко(featureArea({ ring: [[0, 0], [100, 0], [100, 100], [0, 100]],
                     holes: [[[10, 10], [20, 10], [20, 20], [10, 20]]] }), 9900, 1e-6,
  "кольцо с дырой — дыра вычитается");
assert.equal(featureArea({ line: [[0, 0], [10, 0]] }), 0, "у линии площади нет");
assert.equal(featureArea({ arc: { r: 50, sweep: Math.PI } }), 0, "дуга не замкнута — площади нет");

// ---- длина ----
близко(featureLength({ line: [[0, 0], [300, 0]] }), 300, 1e-9, "ломаная 300 м");
близко(featureLength({ circle: { cx: 0, cy: 0, r: 50 } }), 2 * Math.PI * 50, 1e-9,
  "окружность R=50 — периметр 2πR");
близко(featureLength({ arc: { r: 50, sweep: Math.PI / 2 } }), 50 * Math.PI / 2, 1e-9,
  "дуга в четверть оборота — R·sweep");
близко(featureLength({ ring: [[0, 0], [100, 0], [100, 80], [0, 80]] }), 360, 1e-9,
  "у кольца длина — это периметр, с замыкающим звеном");
assert.equal(featureLength({ point: [1, 2] }), 0, "у точки длины нет");

// ---- сводка считает по тем же правилам ----
const сводка = require("./_source").читатьЧистый("app-summary.js");
assert.match(сводка, /if \(f && f\.circle\) return Math\.PI \* f\.circle\.r \* f\.circle\.r;/,
  "сводка обязана считать площадь круга так же, как featureArea");
assert.match(сводка, /if \(f && f\.circle\) return 2 \* Math\.PI \* f\.circle\.r;/,
  "и периметр круга тоже");

// ---- таблица атрибутов спрашивает меры у общих функций ----
const атрибуты = require("./_source").читатьЧистый("app-attr.js");
assert.match(атрибуты, /col\.name === "\$area"\) \{ const s = featureArea\(f\)/,
  "$area в таблице обязан идти через featureArea, а не через ringArea напрямую");
assert.match(атрибуты, /col\.name === "\$length"\) \{ const d = featureLength\(f\)/,
  "$length — через featureLength");
assert.match(атрибуты, /V\.\$area = featureArea\(f\);/,
  "и в калькуляторе полей тоже");

console.log("circle-measures: OK");
