"use strict";

// Красная линия подписывалась НАШИМ алгоритмом «через каждые 320 px» — даже
// там, где у портала уже есть точечный слой-компаньон «Надписи …» с местом,
// которое для этой линии выбрал человек. Найдено обходом каталога ГИС ОГД:
// у слоя красных линий и его «Надписи»-соседа общий parent_id (лежат в одной
// папке дерева), а связь объект↔подпись — по guid отрезка (label.lineguid ===
// line.guid) и коду стороны (label.textlineco === код ЛГР).
//
// Портал режет линию на короткие отрезки, и подпись стоит не на каждом —
// только там, где её поставил составитель. Значит после склейки отрезков в
// цепочку якорь нужно пронести через ВСЕ вошедшие отрезки, а не только через
// «затравку» склейки (см. joinImportedRuns).
//
// Угол подписи НЕ берётся из textangle портала: конвенция его знака нигде не
// проверена вживую, ошибиться — значит поставить подпись вверх ногами. Угол
// всегда считается по локальному направлению ближайшего отрезка — так же, как
// у расчётного размещения.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

global.window = {
  __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
    restrict_hints: [], restrict_layer_id: "source.gisogd.restrict", other_layer_id: "source.gisogd.other" },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};
const pagesCore = require(path.join(__dirname, "..", "pages-core.js"));
// код без знака в библиотеке lineCodeRoutes молча пропускает — заводим оба
pagesCore.setLgrCodeStyles({ "lgr.1": { lgr_code: 1, title: "КЛ 1" }, "lgr.2": { lgr_code: 2, title: "КЛ 2" } });

// ---------- buildGisogdLabelIndex: сборка индекса из сырого GeoJSON ----------
{
  const label = (lineguid, textlineco, text, x, y) => ({ type: "Feature",
    properties: { lineguid, textlineco, text }, geometry: { type: "Point", coordinates: [x, y] } });
  const payload = { type: "FeatureCollection", features: [
    label("g1", 1, "красная", 37.6, 55.75),
    label("g2", "-1", "кл топ", 37.61, 55.76),   // код отрицательный — сторона, не часть кода
    label("g3", 1, "", 37.62, 55.77),            // пустой текст — не подпись, мусор
    label(null, 1, "красная", 37.63, 55.78),     // без guid — привязать не к чему
    label("g4", 1, "вне области", 38.9, 56.9),   // за bbox
  ] };
  const bbox = [37.5, 55.7, 37.7, 55.8];

  const index = pagesCore.buildGisogdLabelIndex(payload, bbox, false);
  assert.equal(index.size, 2, `в индексе обязаны остаться только g1|1 и g2|1 (код по модулю), получено ${index.size}`);
  assert.ok(index.has("g1|1"), "прямой код");
  assert.ok(index.has("g2|1"), "код обязан браться по модулю: сторона у знака своя, а не у подписи");
  assert.equal(index.get("g1|1").x, 37.6, "координата обязана сохраниться");

  // без bbox — не фильтруем (как и featureHitsBbox)
  const noBbox = pagesCore.buildGisogdLabelIndex(payload, null, false);
  assert.equal(noBbox.size, 3, "без области фильтр не режет — g4 тоже входит");
}

// ---------- датум-поправка применяется к точке подписи так же, как к линии ----------
{
  const raw = [37.6, 55.75];
  const corrected = pagesCore.correctGisogdGeometry({ type: "Point", coordinates: raw }).coordinates;
  assert.notDeepEqual(corrected, raw, "поправка обязана сдвигать координату — иначе тест ничего не проверяет");
  const payload = { features: [{ properties: { lineguid: "g1", textlineco: 1, text: "т" },
    geometry: { type: "Point", coordinates: raw } }] };
  const index = pagesCore.buildGisogdLabelIndex(payload, null, true);
  const got = index.get("g1|1");
  assert.equal(got.x, corrected[0], "x обязан пройти через ту же поправку, что и геометрия линии");
  assert.equal(got.y, corrected[1], "иначе якорь и линия разъедутся в разных СК");
}

// ---------- importGisogdExtent: якорь долетает до ОБЪЕКТА, только при совпадении guid+код ----------
{
  const bbox = [37.5, 55.7, 37.7, 55.8];
  const line = (id, guid, linelineco) => ({ type: "Feature", id,
    properties: { orbis_id: id, guid, linelineco, linerhanum: "П1" },
    geometry: { type: "LineString", coordinates: [[37.6, 55.75], [37.61, 55.76]] } });
  const payload = { features: [line(1, "gA", "1"), line(2, "gB", "1")] };
  const labelsPayload = { features: [
    { properties: { lineguid: "gA", textlineco: 1, text: "красная" },
      geometry: { type: "Point", coordinates: [37.605, 55.755] } },
    // gB — код НЕ совпадает (только код 2 подписан), якорь к линии 2 не должен долететь
    { properties: { lineguid: "gB", textlineco: 2, text: "чужая" },
      geometry: { type: "Point", coordinates: [37.606, 55.756] } },
  ] };
  const part = pagesCore.importGisogdExtent(payload, { code: "l1", name: "КЛ", kind: "redline", line_code: 1 },
    bbox, { correctDatum: false, labelsPayload });
  const feats = part.groups[0].features;
  assert.equal(feats.length, 2, "обе линии обязаны попасть в набор (код 1 совпал у обеих)");
  // порядок вывода — порядок источника (gA, затем gB); srcKey несёт код орбиса
  const withGuidA = feats.find(f => f.srcKey.endsWith(":1:1#0"));
  assert.ok(withGuidA, "объект линии gA (orbis_id=1) обязан присутствовать");
  assert.ok(withGuidA.label_anchor, "у линии gA якорь ЕСТЬ — guid и код совпали");
  assert.equal(withGuidA.label_anchor.x, 37.605);
  const withGuidB = feats.find(f => f.srcKey.endsWith(":1:2#0"));
  assert.ok(withGuidB, "объект линии gB (orbis_id=2) обязан присутствовать");
  assert.ok(!withGuidB.label_anchor,
    "у линии gB якоря НЕТ: подпись на портале стоит для кода 2, а не для запрошенного кода 1 — " +
    "подставлять чужой якорь значило бы соврать про место");
}

// ---------- склейка отрезков проносит якорь через ВСЮ цепочку ----------
{
  const app = require("./app-source");
  const start = app.indexOf("const JOIN_SOFT_PROPS");
  const end = app.indexOf("function normalizeImportFields");
  assert.ok(start > 0 && end > start, "склейка обязана оставаться извлекаемой");
  const context = vm.createContext({});
  vm.runInContext(app.slice(start, end), context);
  const join = vm.runInContext("joinImportedRuns", context);

  let nextId = 1;
  const seg = (line, extra = {}) => ({ id: nextId++, layer_id: "source.gisogd.l1",
    kind: "redline", style_id: "lgr.1", joinable: true, srcKey: `k${nextId}`,
    props: { line_code: 1, line_side: 1, linerhanum: "П1" }, line, ...extra });

  const chain = join([
    seg([[0, 0], [10, 0]]),
    seg([[10, 0], [20, 0]], { label_anchor: { x: 15, y: 0 } }),   // якорь стоит на СРЕДНЕМ отрезке
    seg([[20, 0], [30, 0]]),
  ]);
  assert.equal(chain.length, 1, "три отрезка одного проезда — одна линия, как и до этой правки");
  assert.ok(chain[0].label_anchor, "якорь среднего отрезка обязан долететь до склеенной линии");
  assert.equal(chain[0].label_anchor.x, 15);

  const noAnchor = join([seg([[0, 0], [10, 0]]), seg([[10, 0], [20, 0]])]);
  assert.ok(!noAnchor[0].label_anchor,
    "если якоря не было ни у одного отрезка — на склеенной линии его тоже нет, выдумывать нечего");
}

// ---------- placeAtAnchor: позиция с портала, угол — свой (по геометрии) ----------
{
  const labels = require("./_source").читатьЧистый("app-labels-place.js");
  const start = labels.indexOf("function repeatAlongChain");
  const end = labels.indexOf("function drawLineLabel");
  assert.ok(start > 0 && end > start, "placeAtAnchor обязана оставаться извлекаемой");
  const context = vm.createContext({ Math, w2s: (x, y) => [x, y] });
  vm.runInContext(labels.slice(start, end), context);
  const placeAtAnchor = vm.runInContext("placeAtAnchor", context);

  // отрезок [0,0]-[100,0]: якорь ровно на середине
  const segs = [{ ax: 0, ay: 0, bx: 100, by: 0, len: 100, s0: 0 }];
  const near = placeAtAnchor(segs, { x: 50, y: 3 });   // чуть в стороне от линии — так и приходят реальные точки
  assert.ok(near, "якорь рядом с линией обязан дать место");
  assert.equal(near[0].x, 50, "x — проекция на линию, не сырая координата якоря");
  assert.equal(near[0].y, 0, "y — тоже проекция: подпись обязана стоять НА линии");
  assert.equal(near[0].ang, 0, "угол — направление отрезка, не то, что мог бы прислать textangle портала");

  const far = placeAtAnchor(segs, { x: 50, y: 500 });
  assert.equal(far, null, "далёкий от линии якорь (чужая датум-поправка, обрезок склейки) — не подставляем");
}

console.log("gisogd-label-anchors: OK");
