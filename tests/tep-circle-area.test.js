"use strict";

// Круглые здание, территория и ЗОУИТ молча давали НОЛЬ площади в ТЭП.
//
// Весь computeTep фильтрует по feature.ring, а круг несёт feature.circle. Круг —
// площадная фигура наравне с полигоном, и рисуется своим инструментом. Круглая
// санитарная зона вокруг источника — обычное дело; её нулевая площадь занижала
// «ограничения», а значит завышала расчётную площадь, плотность, население и
// нормативы. Молча. Теперь круг раскладывается в кольцо на входе computeTep, и
// все проверки по .ring работают.

const assert = require("node:assert/strict");

global.window = {
  __GRADO_GISOGD_RULES__: {
    doc_markers: [], layer_rules: [], style_rules: [], restrict_hints: [],
    restrict_layer_id: "source.gisogd.restrict", other_layer_id: "source.gisogd.other",
  },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};

const core = require("../pages-core.js");
const square = (x, y, side) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];

// территория 200×200 = 4 га; круглая ЗОУИТ R=50 (π·2500 ≈ 0.785 га);
// круглое здание R=20, 5 этажей (СПП = π·400·5/1000 ≈ 6.28 тыс. м²)
const круглые = core.computeTep({
  features: [
    { kind: "boundary", ring: square(0, 0, 200) },
    { kind: "restrict", circle: { cx: 100, cy: 100, r: 50 } },
    { kind: "building", circle: { cx: 100, cy: 100, r: 20 }, props: { floors: 5 } },
  ],
});

assert.equal(круглые.inputs.terr_area, 4, "территория 200×200 = 4 га");
assert.ok(Math.abs(круглые.inputs.restrict_area - 0.785) < 0.01,
  `круглая ЗОУИТ обязана давать ~0.785 га, получено ${круглые.inputs.restrict_area}`);
assert.ok(круглые.inputs.restrict_area > 0, "круглая ЗОУИТ НЕ должна давать ноль — в этом весь баг");
assert.ok(Math.abs(круглые.fact.spp - 6.28) < 0.05,
  `СПП круглого здания R=20×5эт обязан быть ~6.28, получено ${круглые.fact.spp}`);

// контроль: полигональное здание равной площади даёт тот же СПП
const сторонаКвадрата = Math.sqrt(Math.PI) * 20;   // площадь = π·400
const полигон = core.computeTep({
  features: [
    { kind: "boundary", ring: square(0, 0, 200) },
    { kind: "building", ring: square(50, 50, сторонаКвадрата), props: { floors: 5 } },
  ],
});
assert.ok(Math.abs(круглые.fact.spp - полигон.fact.spp) < 0.05,
  "СПП круга и равновеликого квадрата обязаны совпадать");

// круглая территория тоже считается (не только полигональная граница)
const круглаяТерр = core.computeTep({
  features: [{ kind: "boundary", circle: { cx: 0, cy: 0, r: 100 } }],
});
assert.ok(Math.abs(круглаяТерр.inputs.terr_area - Math.PI * 10000 / 10000) < 0.02,
  `круглая территория R=100 обязана давать ~3.14 га, получено ${круглаяТерр.inputs.terr_area}`);

console.log("tep-circle-area: OK");
