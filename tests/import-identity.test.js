"use strict";

const assert = require("node:assert/strict");

global.window = {
  __GRADO_GISOGD_RULES__: {
    doc_markers: [],
    layer_rules: [
      { kind: "restrict", layer_id: "source.gisogd.restrict", keys: ["сзз", "водоохран"] },
    ],
    style_rules: [],
    restrict_hints: [],
    restrict_layer_id: "source.gisogd.restrict",
    other_layer_id: "source.gisogd.other",
  },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};

const core = require("../pages-core.js");

const polygon = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    id: 1,
    properties: { NAME: "Тестовая зона" },
    geometry: { type: "Polygon", coordinates: [[
      [37.60, 55.70], [37.61, 55.70], [37.61, 55.71], [37.60, 55.70],
    ]] },
  }],
};

const szz = core.importGeoJson(polygon, "СЗЗ расчётная.geojson");
const water = core.importGeoJson(polygon, "Водоохранная зона.geojson");
const szzAgain = core.importGeoJson(polygon, "СЗЗ расчётная.geojson");

assert.notEqual(szz.layers[0].id, water.layers[0].id,
  "разные русские имена источников не должны схлопываться в один layer_id");
assert.equal(szz.layers[0].id, szzAgain.layers[0].id,
  "один источник должен получать устойчивый layer_id при повторном импорте");
assert.equal(szz.features[0].layer_id, szz.layers[0].id);
assert.equal(water.features[0].layer_id, water.layers[0].id);

const mixed = core.importGeoJson({
  type: "FeatureCollection",
  features: [
    polygon.features[0],
    { type: "Feature", id: 2, properties: { NAME: "Точка" },
      geometry: { type: "Point", coordinates: [37.62, 55.72] } },
  ],
}, "Смешанный набор.geojson");
assert.equal(mixed.layers.length, 2,
  "смешанные геометрии должны стать отдельными типизированными слоями");
assert.equal(new Set(mixed.features.map(feature => feature.layer_id)).size, 2);

const curated = Object.values(core.GISOGD_WEB_LAYERS).flat();
assert.equal(curated.length, 24);   // + четыре набора красных линий (l1…l4)
assert.equal(new Set(curated.map(layer => layer.layer_id)).size, curated.length,
  "каждый кураторский слой портала должен иметь собственную идентичность");

const extentA = core.importGisogdExtent(polygon,
  core.GISOGD_WEB_LAYERS["gisogd.szz"][0], [37, 55, 38, 56]);
const extentB = core.importGisogdExtent(polygon,
  core.GISOGD_WEB_LAYERS["gisogd.szz"][1], [37, 55, 38, 56]);
assert.notEqual(extentA.groups[0].layer_id, extentB.groups[0].layer_id);
assert.notEqual(extentA.layers[0].source_code, extentB.layers[0].source_code);

console.log("import identity: ok");
