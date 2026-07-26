"use strict";

// Знак «засечки в обе стороны» (ООПТ-8, ПК-18, памятник природы-55) рисовался
// двумя рядами В ОДНОЙ И ТОЙ ЖЕ точке: получалась «бабочка» — остриё наружу и
// внутрь сразу. В эталонном QML это два слоя MarkerLine с одинаковым interval
// и разным offset_along_line, отличающимся ровно на полшага: треугольники
// ЧЕРЕДУЮТСЯ вдоль черты. Проверяем, что второй ряд сдвинут, а не наложен.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const исходник = fs.readFileSync(path.join(root, "app-labels-place.js"), "utf8");

const начало = исходник.indexOf("function drawLineMarkers(");
assert.ok(начало > 0, "drawLineMarkers должна оставаться извлекаемой");
const конец = исходник.indexOf("\n}", исходник.indexOf("ctx.restore();", начало)) + 2;

const поставленные = [];
const среда = vm.createContext({
  w2s: (x, y) => [x, y],
  ctx: { save() {}, restore() {}, setLineDash() {}, strokeStyle: "", fillStyle: "", lineWidth: 1 },
  MARKER_WIDTH_RATIO: 0.65,
  drawMarkerGlyph: (mk, px) => поставленные.push(Math.round(px * 100) / 100),
});
vm.runInContext(исходник.slice(начало, конец), среда);
const drawLineMarkers = vm.runInContext("drawLineMarkers", среда);

const линия = [[0, 0], [400, 0]];
const знак = { shape: "triangle", period: 40, size: 4 };

поставленные.length = 0;
drawLineMarkers(линия, знак, "#f00", false, 1, 1, null, 0);
const первый = [...поставленные];

поставленные.length = 0;
drawLineMarkers(линия, знак, "#f00", false, -1, 1, null, 0.5);
const второй = [...поставленные];

assert.ok(первый.length >= 4 && второй.length >= 4, "оба ряда должны попасть на линию");
assert.equal(первый[0], 20, "первый ряд начинается на полшага от начала линии");
assert.equal(второй[0], 40, "второй ряд сдвинут ещё на полшага — засечки чередуются");

const наложились = первый.filter(x => второй.includes(x));
assert.deepEqual(наложились, [],
  "ряды «в обе стороны» не должны совпадать точками — иначе знак читается как «бабочка»");

for (let i = 0; i < Math.min(первый.length, второй.length) - 1; i++) {
  assert.ok(второй[i] > первый[i] && второй[i] < первый[i + 1],
    "засечка обратной стороны стоит МЕЖДУ соседними засечками прямой");
}

// Шаг внутри ряда не должен поехать от сдвига фазы.
const шаг = первый[1] - первый[0];
assert.equal(шаг, знак.period, "шаг ряда равен period знака");
assert.equal(второй[1] - второй[0], знак.period, "сдвиг фазы не меняет шаг второго ряда");

console.log("marker-phase: OK");
