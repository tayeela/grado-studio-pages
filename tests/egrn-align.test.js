"use strict";

// Датум-поправка ГИС ОГД. Портал gisogd.mos.ru публикует координаты
// (заявлены WGS84) со СИСТЕМАТИЧЕСКИМ сдвигом ~7,3 м от ЕГРН/спутника —
// разные параметры перехода МСК→WGS84 у двух порталов. Доказано ДВУМЯ
// независимыми замерами по реальным данным:
//   • один и тот же участок по кадастровому номеру ГИС ОГД↔НСПД: постоянный
//     вектор (+4,8; −5,6) м, одинаковый по всей области (30+ км);
//   • совмещение красных линий с границами участков ЕГРН по городу: пик
//     совпадений при сдвиге (−5,2; +5,4) м, остаток 0,11 м.
// Лечится ОДНОЙ постоянной поправкой в метрах UTM 37N, применяемой ко всем
// координатам ГИС ОГД (frame-independent — не зависит от СК проекта).

const assert = require("node:assert/strict");
const path = require("node:path");
// правила маршрутизации ГИС ОГД впекаются в страницу; ядру хватит пустых
global.window = {
  __GRADO_GISOGD_RULES__: { doc_markers: [], layer_rules: [], style_rules: [],
    restrict_hints: [], restrict_layer_id: "source.gisogd.restrict",
    other_layer_id: "source.gisogd.other" },
  __GRADO_GP_ZONE_RULES__: { name_to_style: {}, code_to_zone: {} },
};
const core = require(path.join(__dirname, "..", "pages-core.js"));
const crs = require(path.join(__dirname, "..", "crs.js"));

const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want}`);

// ---------- поправка задана в метрах UTM 37N ----------
{
  const [dE, dN] = core.GISOGD_DATUM_SHIFT_UTM37;
  close(dE, -5.0, 1e-9, "восточная составляющая");
  close(dN, 5.45, 1e-9, "северная составляющая");
  close(Math.hypot(dE, dN), 7.40, 0.02, "модуль поправки ≈ 7,40 м");

  // точка центра Москвы: после поправки её UTM37-координаты сдвинуты РОВНО
  // на (dE, dN) — это и есть определение поправки
  const p = [37.6176, 55.752];
  const before = crs.wgs84ToUtm37n(p);
  const after = crs.wgs84ToUtm37n(core.correctGisogdLonLat(p));
  close(after[0] - before[0], dE, 5e-3, "сдвиг по востоку точен");
  close(after[1] - before[1], dN, 5e-3, "сдвиг по северу точен");
}

// ---------- поправка направлена НА ЕГРН ----------
{
  // измеренный сдвиг ГИС ОГД−НСПД = (+4,8; −5,6): значит, чтобы ГИС ОГД лёг
  // на ЕГРН, надо сдвинуть примерно на (−4,8; +5,6). Наша поправка (−5,0;
  // +5,45) — того же направления, в пределах разброса замеров (<0,5 м).
  const [dE, dN] = core.GISOGD_DATUM_SHIFT_UTM37;
  assert.ok(dE < 0 && dN > 0, "поправка: запад + север, как измерено");
  close(dE, -4.8, 0.4, "восток близок к замеру участков");
  close(dN, 5.6, 0.4, "север близок к замеру участков");
}

// ---------- importGisogdExtent применяет поправку ----------
{
  crs.setProjectCrs(null);   // историческая UTM37-local, детерминизм
  const feature = {
    type: "Feature", properties: { linelineco: "1" },
    geometry: { type: "LineString", coordinates: [[37.617, 55.751], [37.62, 55.753]] },
  };
  const payload = { type: "FeatureCollection", features: [feature] };
  const layer = { code: "l1", name: "КЛ УДС", kind: "redline", line_code: 1 };
  const bbox = [37.61, 55.749, 37.625, 55.755];

  const corrected = core.importGisogdExtent(payload, layer, bbox, { correctDatum: true });
  const plain = core.importGisogdExtent(payload, layer, bbox, { correctDatum: false });
  const cf = corrected.groups[0].features[0];
  const pf = plain.groups[0].features[0];
  assert.ok(cf && cf.line, "объект построен");
  const d = Math.hypot(cf.line[0][0] - pf.line[0][0], cf.line[0][1] - pf.line[0][1]);
  close(d, 7.40, 0.05, "поправка сдвигает объект на ≈7,40 м");
  assert.match(corrected.notes.join(" "), /датум-поправка портала/, "поправка объявлена в примечании");
  assert.doesNotMatch(plain.notes.join(" "), /датум-поправка/, "выключается флагом");
}

// ---------- проводка ----------
{
  const fs = require("node:fs");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "pages-adapter.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(adapter, /correctDatum: payload\.alignOgd !== false/,
    "по-области импорт передаёт флаг поправки");
  assert.doesNotMatch(adapter, /computeEgrnAlign/, "старая МНК-привязка удалена");
  assert.match(app, /alignOgd: state\.alignOgd !== false,/, "настройка хранится в проекте");
}

console.log("egrn-align: OK");
