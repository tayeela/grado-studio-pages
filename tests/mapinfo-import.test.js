"use strict";

// Читалка MapInfo против НАСТОЯЩИХ файлов (GDAL, МСК-50 зона 2).
// TAB: бинарный .map — точка, ломаная (сжатые вершины в координатном
// блоке), регион с дырой (две секции); проекция и 7 параметров датума
// из заголовка .map (повороты там с обратным знаком — сверено с pyproj).
// MIF/MID: текстовый Region с дырой + CoordSys c датумом 9999.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
global.window = globalThis;
require(path.join(root, "app-crs-ru.js"));
require(path.join(root, "app-shp.js"));
require(path.join(root, "app-mapinfo.js"));
const M = globalThis.GRADO_MAPINFO;
const C = globalThis.GRADO_CRS_RU;
const expect = JSON.parse(fs.readFileSync(path.join(FIX, "expect-wgs84.json"), "utf8"));

const buf = (dir, name) => {
  const b = fs.readFileSync(path.join(FIX, dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const tabSet = stem => ({
  tab: fs.readFileSync(path.join(FIX, "tab", stem + ".tab"), "latin1"),
  dat: buf("tab", stem + ".dat"),
  map: buf("tab", stem + ".map"),
  id: buf("tab", stem + ".id"),
});
const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want}`);

// ---------- TAB: точка ----------
{
  const fc = M.readTab(tabSet("pts"));
  assert.equal(fc.features.length, 1);
  const g = fc.features[0].geometry;
  assert.equal(g.type, "Point");
  assert.ok(fc.crsDef, "СК из бинарного заголовка .map");
  assert.equal(fc.crsDef.kind, "tmerc");
  close(fc.crsDef.lon0, 38.4791666666667, 1e-9, "осевой меридиан из .map");
  const [lon, lat] = C.toWgs84(...g.coordinates, fc.crsDef);
  close(lon, expect.point[0], 2e-6, "точка долгота");   // int-сетка .map ≈ 3 см
  close(lat, expect.point[1], 2e-6, "точка широта");
  assert.equal(fc.features[0].properties.name, "Точка №1", "кириллица из .dat");
}

// ---------- TAB: ломаная (сжатые вершины) ----------
{
  const fc = M.readTab(tabSet("roads"));
  const g = fc.features[0].geometry;
  assert.equal(g.type, "LineString");
  assert.equal(g.coordinates.length, 3, "все три вершины из координатного блока");
  const [lon, lat] = C.toWgs84(...g.coordinates[2], fc.crsDef);
  close(lon, expect.line_last[0], 2e-6, "линия долгота");
  close(lat, expect.line_last[1], 2e-6, "линия широта");
  assert.equal(fc.features[0].properties.name, "Осевая");
}

// ---------- TAB: регион с дырой ----------
{
  const fc = M.readTab(tabSet("zones"));
  const g = fc.features[0].geometry;
  assert.equal(g.type, "Polygon");
  assert.equal(g.coordinates.length, 2, "внешнее кольцо + дыра");
  const props = fc.features[0].properties;
  assert.equal(props.name, "Жилая зона");
  assert.equal(props.num, 7);
  const [lon, lat] = C.toWgs84(...g.coordinates[0][0], fc.crsDef);
  const dLon = Math.min(...g.coordinates[0].map(pt =>
    Math.abs(C.toWgs84(...pt, fc.crsDef)[0] - expect.poly_first[0])));
  assert.ok(dLon < 2e-6, "угол внешнего кольца совпал с pyproj");
  // датум из .map: повороты возвращены к соглашению towgs84
  close(fc.crsDef.towgs84[4], 0.35, 1e-9, "поворот ry вернул знак");
  close(fc.crsDef.towgs84[6], -0.22, 1e-9, "масштаб знака не менял");
}

// ---------- MIF/MID ----------
{
  const mif = fs.readFileSync(path.join(FIX, "mif", "zones.mif"), "latin1");
  const mid = buf("mif", "zones.mid");
  const fc = M.parseMif(mif, mid);
  assert.equal(fc.features.length, 1);
  const g = fc.features[0].geometry;
  assert.equal(g.type, "Polygon");
  assert.equal(g.coordinates.length, 2, "Region 2 → кольцо + дыра");
  assert.equal(fc.features[0].properties.name, "Жилая зона", "кириллица MID");
  assert.equal(fc.features[0].properties.num, 7);
  assert.ok(fc.crsDef, "CoordSys с датумом 9999 разобран");
  const [lon, lat] = C.toWgs84(...g.coordinates[0][0], fc.crsDef);
  close(lon, expect.poly_first[0], 2e-7, "MIF долгота");
  close(lat, expect.poly_first[1], 2e-7, "MIF широта");

  const roads = M.parseMif(fs.readFileSync(path.join(FIX, "mif", "roads.mif"), "latin1"),
    buf("mif", "roads.mid"));
  assert.equal(roads.features[0].geometry.type, "LineString");
  assert.equal(roads.features[0].geometry.coordinates.length, 3);
}

console.log("mapinfo-import: OK");
