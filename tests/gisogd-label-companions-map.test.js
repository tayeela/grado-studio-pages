"use strict";

// Место подписи с портала было доступно только четырём курируемым наборам
// красных линий (l1-l4) — а в каталоге ГИС ОГД (874 записи) обходом найдено
// 16 таких пар «граница-линия ↔ Надписи-компаньон». Остальные 12 линий
// (границы ООПТ, водоохранных зон, полос отвода ЖД, береговой полосы и др.)
// в куратора не попали, но остаются импортируемыми по сырому коду портала
// («gisogd:{code}» в источниках, см. gisogdLayersFor) — и подпись с портала
// им кстати ровно так же, как красным линиям.
//
// Поэтому карта компаньонов — ОТДЕЛЬНАЯ от списка курируемых наборов
// (GISOGD_WEB_LAYERS) структура, ключ — код геометрии, значение — код
// «Надписи…». pages-adapter.js применяет её по layer.code для ЛЮБОГО
// импортируемого слоя, а не только для l1-l4.

const assert = require("node:assert/strict");
const path = require("node:path");
const pagesCore = require(path.join(__dirname, "..", "pages-core.js"));
const { читатьЧистый } = require("./_source");

const M = pagesCore.GISOGD_LABEL_COMPANIONS;

// ---------- все 16 пар, найденные обходом каталога, на месте ----------
const ОЖИДАЕТСЯ = {
  l1: "virtual14", l2: "virtual15", l3: "virtual16", l4: "virtual17",
  l25: "virtual28", l16: "virtual18", l17: "virtual19", l7: "virtual21",
  l57: "virtual22", l41: "virtual23", l18: "virtual24", l29: "virtual25",
  l6: "virtual26", l45: "virtual29", l26: "virtual30", virtual2950: "virtual27",
};
assert.deepEqual(M, ОЖИДАЕТСЯ, "карта компаньонов обязана содержать ровно эти 16 пар — ни забытых, ни лишних");

// ---------- курируемые красные линии по-прежнему совпадают с картой ----------
for (const [source, code] of [["gisogd.kl_uds", "l1"], ["gisogd.kl_top", "l2"],
  ["gisogd.kl_lo", "l3"], ["gisogd.kl_odms", "l4"]]) {
  const [layer] = pagesCore.GISOGD_WEB_LAYERS[source];
  assert.equal(layer.code, code, `${source} обязан остаться кодом ${code}`);
  assert.ok(M[layer.code], `${source} (${code}) обязан иметь компаньона в общей карте`);
}

// ---------- adapter читает карту по layer.code, а не по полю на курируемой записи ----------
{
  const adapter = читатьЧистый("pages-adapter.js");
  assert.match(adapter, /const labelCode = pagesCore\.GISOGD_LABEL_COMPANIONS\[layer\.code\];/,
    "поиск компаньона обязан идти по коду слоя — тогда он сработает и для " +
    "слоя, импортированного по сырому коду (gisogd:{code}), не только для " +
    "четырёх курируемых наборов красных линий");
  assert.ok(!/layer\.label_code/.test(adapter),
    "старое поле на курируемой записи убрано вместе с частным механизмом — " +
    "карта теперь одна и общая");
}

// ---------- сквозной сценарий: слой БЕЗ курации (сырой импорт по коду) ----------
// gisogdLayersFor("gisogd:l16") отдаёт {code, name} — без line_code, без kind:
// именно так приходит слой, который человек добавил по коду портала, а не
// через забронированный пункт списка. Якорь обязан долететь и сюда.
{
  global.window = {
    __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
      restrict_hints: [], restrict_layer_id: "source.gisogd.restrict", other_layer_id: "source.gisogd.other" },
    __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
  };
  delete require.cache[require.resolve(path.join(__dirname, "..", "pages-core.js"))];
  const core = require(path.join(__dirname, "..", "pages-core.js"));
  core.setLgrCodeStyles({ "lgr.16": { lgr_code: 16, title: "Границы водоохранных зон" } });

  const bbox = [37.4, 55.6, 37.5, 55.65];
  const payload = { features: [{ type: "Feature", id: 1,
    properties: { orbis_id: 1, guid: "gW", linelineco: "16", linerhanum: "П1" },
    geometry: { type: "LineString", coordinates: [[37.44, 55.62], [37.45, 55.63]] } }] };
  const labelsPayload = { features: [{
    properties: { lineguid: "gW", textlineco: 16, text: "водоохранная" },
    geometry: { type: "Point", coordinates: [37.445, 55.625] } }] };

  // ровно то, что доедет из gisogdLayersFor("gisogd:l16") — без line_code, без kind
  const layer = { code: "l16", name: "Границы водоохранных зон" };
  const part = core.importGisogdExtent(payload, layer, bbox, { correctDatum: false, labelsPayload });
  const feats = part.groups[0].features;
  assert.ok(feats.length >= 1, "сырой импорт по коду обязан отдать хотя бы один объект");
  const anchored = feats.find(f => f.label_anchor);
  assert.ok(anchored, "объект без курации (без line_code, без kind) обязан всё равно получить якорь — " +
    "карта компаньонов ищется по коду СЛОЯ, курация для этого не нужна");
  assert.equal(anchored.label_anchor.x, 37.445);
}

console.log("gisogd-label-companions-map: OK");
