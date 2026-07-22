"use strict";

// Источники отдают геометрию «как есть»: повторяющиеся подряд точки, иглы
// (A-B-A нулевой площади), вырожденные части и самопересечения. Дальше на этом
// считается ТЭП, строятся привязки и офсеты, поэтому чиним ОДИН раз на входе —
// в geometryParts, через который проходят GeoJSON, НСПД, ОСМ и ГИС ОГД.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
// правила маршрутизации впекаются в страницу; ядру достаточно пустого набора
global.window = {
  __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
    restrict_hints: [], restrict_layer_id: "source.gisogd.restrict",
    other_layer_id: "source.gisogd.other" },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};
const core = require(path.join(root, "pages-core.js"));
const src = fs.readFileSync(path.join(root, "pages-core.js"), "utf8");

// каждый импорт обязан начинать со сброса счётчиков и заканчивать отчётом
for (const fn of ["importNspd(payload = {}) {", "importGeoJson(payload = {}, filename",
  "importOsmExtent(payload = {}, sources = [], bbox = []) {",
  "importNspdExtent(payload = {}, source, bbox = []) {",
  "importGisogdExtent(payload = {}, layer = {}, bbox = []) {"]) {
  const at = src.indexOf(fn);
  assert.ok(at > 0, `не найден импорт ${fn}`);
  assert.match(src.slice(at, at + 200), /geomFixReset\(\)/,
    `импорт ${fn.slice(0, 24)} обязан сбрасывать счётчики починки`);
}
assert.equal((src.match(/geomFixNotes\(\)/g) || []).length, 5,
  "отчёт о починке обязан попадать во все пять импортов");

const FC = features => ({ type: "FeatureCollection", features });
const feature = geometry => ({ type: "Feature", properties: { NAME: "x" }, geometry });
// шаг ~1e-4° по долготе на широте Москвы ≈ 6 м — крупнее допуска склейки (1 мм)
const P = (i, j) => [37.6 + i * 1e-4, 55.75 + j * 1e-4];

const importOne = geometry => core.importGeoJson(FC([feature(geometry)]), "проверка.geojson");

// --- повторяющиеся точки ---
const dupes = importOne({ type: "LineString",
  coordinates: [P(0, 0), P(0, 0), P(1, 0), P(1, 0), P(2, 0)] });
assert.equal(dupes.features.length, 1, "линия обязана уцелеть");
assert.equal(dupes.features[0].line.length, 3, "повторы подряд обязаны схлопнуться");
assert.ok(dupes.notes.some(n => /геометрия исправлена/.test(n)),
  "починка обязана попадать в отчёт, а не происходить молча");

// --- игла A-B-A ---
const spike = importOne({ type: "LineString",
  coordinates: [P(0, 0), P(1, 0), P(2, 0), P(1, 0), P(2, 0), P(3, 0)] });
assert.ok(spike.features[0].line.length < 6, "игла обязана уйти");

// --- вырожденная линия ---
const degenerate = core.importGeoJson(FC([
  feature({ type: "LineString", coordinates: [P(0, 0), P(0, 0)] }),
  feature({ type: "LineString", coordinates: [P(0, 0), P(1, 0)] }),
]), "проверка.geojson");
assert.equal(degenerate.features.length, 1, "линия из одной точки — не линия");
assert.ok(degenerate.notes.some(n => /вырожденных частей отброшено: 1/.test(n)),
  "отброшенное обязано быть посчитано");

// --- замыкающая точка кольца не хранится дважды ---
const ring = importOne({ type: "Polygon",
  coordinates: [[P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(0, 0)]] });
assert.equal(ring.features.length, 1);
assert.equal(ring.features[0].ring.length, 4, "кольцо хранится незамкнутым");

// --- кольцо нулевой площади ---
const flat = core.importGeoJson(FC([
  feature({ type: "Polygon", coordinates: [[P(0, 0), P(1, 0), P(2, 0), P(0, 0)]] }),
  feature({ type: "Polygon", coordinates: [[P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(0, 0)]] }),
]), "проверка.geojson");
assert.equal(flat.features.length, 1, "контур без площади не объект");

// --- дыры сохраняются, вырожденные дыры отбрасываются ---
const holed = importOne({ type: "Polygon", coordinates: [
  [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)],
  [P(2, 2), P(4, 2), P(4, 4), P(2, 4), P(2, 2)],
  [P(6, 6), P(6, 6), P(6, 6), P(6, 6)],
] });
assert.equal(holed.features[0].holes.length, 1, "живая дыра остаётся, вырожденная уходит");

// --- самопересечение: без библиотеки клиппинга контур сохраняется и считается ---
const bow = importOne({ type: "Polygon",
  coordinates: [[P(0, 0), P(4, 4), P(4, 0), P(0, 4), P(0, 0)]] });
assert.equal(bow.features.length, 1, "самопересекающийся контур нельзя терять");
assert.ok(bow.notes.some(n => /самопересечений осталось: 1/.test(n)),
  "в Node библиотеки клиппинга нет — об этом обязано быть сказано честно");
const repair = src.slice(src.indexOf("const repairPolygonPart"),
  src.indexOf("const geometryParts"));
assert.match(repair, /window\.polygonClipping/,
  "починка самопересечений обязана искать библиотеку лениво — она грузится позже ядра");
assert.match(repair, /pc\.union\(\[polygon\]\)/,
  "объединение контура с самим собой — это и есть makeValid");
assert.match(repair, /geomFix\.selfFixed \+= 1/, "исправленные обязаны считаться отдельно");

// --- честная геометрия не должна меняться ---
const clean = importOne({ type: "Polygon",
  coordinates: [[P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(0, 0)]] });
assert.deepEqual(clean.notes.filter(n => /геометрия|самопересеч|вырожден/.test(n)), [],
  "на чистых данных починка обязана молчать");

console.log("geometry-repair: OK");
