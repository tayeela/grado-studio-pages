"use strict";

// Датум-поправка ГИС ОГД. Портал gisogd.mos.ru публикует координаты
// (заявлены WGS84) со СИСТЕМАТИЧЕСКИМ сдвигом 7,34 м от ЕГРН/спутника —
// у порталов разные реализации перехода МСК→WGS84.
//
// Замерено по 8999 ОДИНАКОВЫМ участкам (совпадение по кадастровому номеру,
// весь слой ЗУ портала против выгрузок НСПД), раздельно по округам:
//   • округ 77 (Москва):        dE=−4,819  dN=+5,540  (4081 пара)
//   • округ 50 (ТиНАО/область): dE=−4,817  dN=+5,566  (4918 пар)
//   • разница между округами 2,7 см → ОДНОЙ константы достаточно.
// Подгонка 2D-подобия: поворот 0,8″, масштаб 0,9 ppm — расхождение ЧИСТО
// поступательное, репроекция/смена зоны его не убирает.
// Контроль по ВЕРШИНАМ контуров (≈40 000 вершин): до поправки медиана
// расхождения 7,3 м и 0 % вершин ближе 0,3 м; после — медиана 3,4–4,5 см,
// p90 5,7–8,1 см, 100 % вершин ближе 0,3 м.
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
  close(dE, -4.818, 1e-9, "восточная составляющая");
  close(dN, 5.554, 1e-9, "северная составляющая");
  close(Math.hypot(dE, dN), 7.34, 0.02, "модуль поправки ≈ 7,34 м");

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
  // измеренный сдвиг ГИС ОГД−НСПД = (+4,818; −5,554): значит, чтобы ГИС ОГД
  // лёг на ЕГРН, надо сдвинуть на (−4,818; +5,554). Это и есть константа —
  // среднее по округам 77 и 50, взвешенное числом пар.
  const [dE, dN] = core.GISOGD_DATUM_SHIFT_UTM37;
  assert.ok(dE < 0 && dN > 0, "поправка: запад + север, как измерено");
  close(dE, -4.819, 0.02, "восток совпал с замером по участкам округа 77");
  close(dN, 5.553, 0.02, "север совпал с замером по участкам");
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
  close(d, 7.34, 0.05, "поправка сдвигает объект на ≈7,34 м");
  assert.match(corrected.notes.join(" "), /датум-поправка портала/, "поправка объявлена в примечании");
  assert.doesNotMatch(plain.notes.join(" "), /датум-поправка/, "выключается флагом");
}

// ---------- ГЛАВНОЕ: участки ГИС ОГД садятся на участки ЕГРН ----------
// Фикстура — РЕАЛЬНЫЕ пары вершин одного и того же участка (совпадение по
// кадастровому номеру): как его отдаёт портал и где он в ЕГРН. После
// поправки расстояние обязано падать с ~7,3 м до сантиметров.
{
  const fs = require("node:fs");
  const { pairs } = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "gisogd-egrn-pairs.json"), "utf8"));
  assert.ok(pairs.length >= 40, "фикстура содержит представительный набор пар");

  const metres = (a, b) => {
    const [ax, ay] = crs.wgs84ToUtm37n(a), [bx, by] = crs.wgs84ToUtm37n(b);
    return Math.hypot(ax - bx, ay - by);
  };
  const before = [], after = [];
  for (const { gisogd, egrn } of pairs) {
    before.push(metres(gisogd, egrn));
    after.push(metres(core.correctGisogdLonLat(gisogd), egrn));
  }
  const median = arr => [...arr].sort((x, y) => x - y)[arr.length >> 1];
  const medBefore = median(before), medAfter = median(after);

  close(medBefore, 7.45, 0.5, "до поправки участки портала расходятся с ЕГРН на ~7,4 м");
  assert.ok(medAfter < 0.25,
    `после поправки участки ГИС ОГД обязаны лечь на ЕГРН: медиана ${medAfter.toFixed(3)} м`);
  assert.ok(after.every(v => v < 0.6),
    `ни одна вершина не должна остаться дальше 0,6 м: макс ${Math.max(...after).toFixed(3)} м`);
  assert.ok(medAfter < medBefore / 20, "поправка убирает расхождение больше чем в 20 раз");
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
