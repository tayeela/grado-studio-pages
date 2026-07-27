"use strict";

// Подпись круглой зоны печаталась в УГЛУ холста.
//
// Раскладка подписей делит объекты на площадные (подпись в теле, по якорю) и
// линейные (подпись вдоль). Круг не попадал в площадные: labelAnchor смотрел
// только на f.ring и возвращал null, и круг уходил в линейную ветку — где его
// «ломаная» бралась у featurePts, а тот для круга отдаёт РУЧКИ РЕДАКТОРА
// (центр и четыре стороны света). Замер до правки: подпись «Круглая зона» в
// точке (0,0) при центре круга на экране (191,648) — промах 676 px.

const assert = require("node:assert/strict");
const vm = require("node:vm");
const источник = require("./_source").читатьЧистый("app-labels-place.js");

// ---- якорь ----
const начало = источник.indexOf("function labelAnchor(f) {");
const конец = источник.indexOf("function featureScreenBox(");
assert.ok(начало > 0 && конец > начало, "labelAnchor обязана оставаться извлекаемой");

const среда = vm.createContext({
  LABELS: { poleOfInaccessibility: rings => [rings[0][0][0], rings[0][0][1]] },
  _anchorCache: new WeakMap(),
});
vm.runInContext(источник.slice(начало, конец), среда);
const { labelAnchor } = среда;

assert.deepEqual([...labelAnchor({ circle: { cx: 12, cy: -7, r: 50 } })], [12, -7],
  "якорь круга — его центр");
assert.equal(labelAnchor({ line: [[0, 0], [10, 0]] }), null, "у линии площадного якоря нет");
assert.equal(labelAnchor({ arc: { cx: 0, cy: 0, r: 5, a0: 0, sweep: 1 } }), null,
  "у дуги тоже нет: она кривая и подписывается вдоль");
assert.ok(labelAnchor({ ring: [[0, 0], [10, 0], [10, 10]] }), "у кольца якорь считается как прежде");

// ---- ветка раскладки ----
assert.match(источник, /if \(f\.ring \|\| f\.circle\) \{/,
  "круг обязан идти по ПЛОЩАДНОЙ ветке раскладки, а не по линейной");
assert.match(источник, /const pts = f\.line \|\| \(f\.arc \? featurePts\(f\) : null\);/,
  "в линейной ветке круга остаться не должно — иначе подпись снова поедет по ручкам редактора");

console.log("circle-label-anchor: OK");
