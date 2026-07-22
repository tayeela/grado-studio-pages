"use strict";

// Площади ЗОУИТ суммируются без объединения геометрий, поэтому пересекающиеся
// зоны (СЗЗ + водоохранная над одним местом — обычное дело) вычитались дважды
// и уводили расчётную площадь, а за ней население, ДОО, школы и машино-места,
// в минус. Расчётная площадь клампится нулём, а пользователь получает явное
// предупреждение вместо отрицательных нормативных показателей.

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
const valueOf = (tep, id) => tep.results.find(result => result.id === id).value;

// граница 1 га и ДВЕ совпадающие ЗОУИТ по 0.81 га: сумма ограничений (1.62 га)
// больше территории
const overlapped = core.computeTep({
  features: [
    { kind: "boundary", ring: square(0, 0, 100) },
    { kind: "restrict", ring: square(5, 5, 90) },
    { kind: "restrict", ring: square(5, 5, 90) },
  ],
  params: {},
});

assert.equal(valueOf(overlapped, "calc_area"), 0,
  "расчётная площадь не может быть отрицательной");
for (const id of ["spp", "np", "spp_zh", "sq_flats", "population", "flats",
  "doo_norm", "school_norm", "parking_perm"]) {
  assert.ok(valueOf(overlapped, id) >= 0, `${id} не должен быть отрицательным`);
}
const warning = overlapped.checks.find(check => /превышают территорию/i.test(check.title));
assert.ok(warning, "должно появиться предупреждение о превышении ограничений");
assert.match(warning.msg, /пересекающиеся зоны/i,
  "предупреждение обязано объяснить причину — наложение зон");

// обычный расчёт не изменился
const normal = core.computeTep({
  features: [
    { kind: "boundary", ring: square(0, 0, 494.77) },
    { kind: "restrict", ring: square(10, 10, 50) },
  ],
  params: {},
});
assert.ok(valueOf(normal, "calc_area") > 0, "нормальная территория считается как раньше");
assert.ok(valueOf(normal, "population") > 0);
assert.ok(!normal.checks.some(check => /превышают территорию/i.test(check.title)),
  "без превышения предупреждения быть не должно");

// нулевая доля жилья — легитимный ввод: население честно нулевое,
// а не пересчитанное по умолчанию 80 %
const nonResidential = core.computeTep({
  features: [{ kind: "boundary", ring: square(0, 0, 494.77) }],
  params: { ratio_zh: 0 },
});
assert.equal(valueOf(nonResidential, "population"), 0,
  "при доле жилья 0 % населения быть не должно");
assert.ok(valueOf(nonResidential, "spp_nzh") > 0, "нежилая застройка при этом считается");

console.log("tep-restrict-clamp: OK");
