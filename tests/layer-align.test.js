"use strict";

// Совмещение слоя сдвигом по двум точкам: выгрузки НСПД/ОСМ/ГИС ОГД
// расходятся между собой на метры (это свойство источников — конвейер
// сверен с pyproj до миллиметра), и слой сажают на место целиком.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

// ---------- чистая функция сдвига ----------
{
  const at = app.indexOf("function shiftLayerFeatures(layerId, dx, dy) {");
  assert.ok(at > 0, "функция сдвига слоя обязана существовать");
  const end = app.indexOf("\n}", at) + 2;
  const context = vm.createContext({
    state: { features: [
      { id: 1, layer_id: "a", ring: [[0, 0], [10, 0], [10, 10]] },
      { id: 2, layer_id: "a", circle: { cx: 5, cy: 5, r: 2 } },
      { id: 3, layer_id: "b", point: [1, 1] },
    ] },
    layerOf: f => ({ id: f.layer_id }),
    featureMovablePts: f => (f.ring || (f.point ? [f.point] : [])),
  });
  vm.runInContext(app.slice(at, end), context);
  const moved = vm.runInContext('shiftLayerFeatures("a", 3, -4)', context);
  assert.equal(moved, 2, "двигаются только объекты слоя");
  const st = vm.runInContext("state", context);
  assert.equal(JSON.stringify(st.features[0].ring[0]), "[3,-4]", "кольцо сдвинуто");
  assert.equal(st.features[1].circle.cx, 8, "центр окружности сдвинут");
  assert.equal(JSON.stringify(st.features[2].point), "[1,1]", "чужой слой не тронут");
}

// ---------- проводка ----------
{
  assert.match(app, /Совместить слой \(сдвиг по двум точкам\)…/, "пункт в меню слоя");
  assert.match(app, /state\.tool === "layeralign" && state\.layerAlign/, "ветка инструмента");
  assert.match(app, /Теперь кликните, куда должна встать эта точка/, "двухшаговый протокол");
  assert.match(app, /if \(state\.layerAlign\) \{ state\.layerAlign = null; setTool\("select"\); draw\(\); return; \}/,
    "Esc отменяет совмещение");
  assert.match(app, /snapshot\(\);\r?\n\s*const moved = shiftLayerFeatures/, "сдвиг попадает в undo");
}

console.log("layer-align: OK");
