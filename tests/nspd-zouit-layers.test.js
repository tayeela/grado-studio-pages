"use strict";

// «ЗОУИТ (все виды)» — это пять разных категорий НСПД. Раньше все они падали
// в один слой source.nspd.zouit с общим названием «ЗОУИТ»: охранные зоны ОКН,
// СЗЗ и водоохранные оказывались в одном разворачивающемся слое и различались
// только атрибутом. Теперь категория = слой-источник, как у ГИС ОГД.

const assert = require("node:assert/strict");

global.window = {
  __GRADO_GISOGD_RULES__: {
    doc_markers: [], layer_rules: [], style_rules: [], restrict_hints: [],
    restrict_layer_id: "source.gisogd.restrict", other_layer_id: "source.gisogd.other",
  },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};

const core = require("../pages-core.js");

const toMercator = (lon, lat) => [
  lon * 20037508.34 / 180,
  Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180,
];
const polygon = (lon, lat) => ({
  type: "Polygon",
  coordinates: [[toMercator(lon, lat), toMercator(lon + 0.001, lat),
    toMercator(lon + 0.001, lat + 0.001), toMercator(lon, lat + 0.001), toMercator(lon, lat)]],
});
const bbox = [37.5, 55.7, 37.7, 55.8];

const zouit = core.importNspdExtent({
  features: [
    { id: 1, geometry: polygon(37.600, 55.75), properties: { categoryName: "Охранная зона ОКН", label: "77:01-1" } },
    { id: 2, geometry: polygon(37.601, 55.75), properties: { categoryName: "Санитарно-защитная зона", label: "77:01-2" } },
    { id: 3, geometry: polygon(37.602, 55.75), properties: { categoryName: "Водоохранная зона", label: "77:01-3" } },
    { id: 4, geometry: polygon(37.603, 55.75), properties: { categoryName: "Охранная зона ОКН", label: "77:01-4" } },
  ],
}, "nspd.zouit", bbox);

assert.equal(zouit.groups.length, 3, "три разные категории — три слоя-источника");
assert.equal(new Set(zouit.groups.map(group => group.layer_id)).size, 3,
  "layer_id категорий обязаны различаться");
assert.equal(zouit.groups.find(group => group.title === "Охранная зона ОКН").count, 2,
  "объекты одной категории остаются вместе");

// динамические слои фронт статически не знает — их обязательно регистрировать,
// иначе объекты уедут в слой по виду (правило 7) и снова слипнутся
assert.equal(zouit.layers.length, 3, "каждый слой категории должен быть зарегистрирован");
for (const layer of zouit.layers) {
  assert.ok(layer.id && layer.title, "у слоя есть идентификатор и название");
  assert.equal(layer.source_kind, "nspd");
  assert.ok(layer.source_name, "имя источника нужно для проверки коллизий слоёв");
}
assert.deepEqual(
  zouit.layers.map(layer => layer.id).sort(),
  zouit.groups.map(group => group.layer_id).sort(),
  "зарегистрированные слои совпадают с группами");

// srcKey ведёт на собственный слой — иначе дедупликация склеит разные категории
for (const group of zouit.groups) {
  for (const feature of group.features) {
    assert.equal(feature.layer_id, group.layer_id);
    assert.ok(feature.srcKey.startsWith(`${group.layer_id}:`));
  }
}
assert.equal(zouit.snapshots.length, 3, "у каждого слоя своя выписка о происхождении");

// прочие источники НСПД остаются одним статическим слоем
const parcels = core.importNspdExtent({
  features: [{ id: 9, geometry: polygon(37.6, 55.75), properties: { opt_cad_num: "77:01:0001:1" } }],
}, "nspd.parcels", bbox);
assert.equal(parcels.groups.length, 1);
assert.equal(parcels.groups[0].layer_id, "source.nspd.parcels");
assert.equal(parcels.layers.length, 0, "статический слой регистрировать не требуется");

console.log("nspd-zouit-layers: OK");
