"use strict";

// Читалка Shapefile против НАСТОЯЩИХ файлов (fiona/GDAL, МСК-50 зона 2,
// DBF в cp1251). Что важно:
// 1. Полигон с дырой собирается в Polygon с двумя кольцами.
// 2. Кириллица из DBF читается (cp1251 по .cpg).
// 3. .prj с towgs84, зашитым в ИМЯ датума ESRI-манглингом
//    (using_towgs84_23_57_-140_95_…), даёт СК с точностью pyproj.
// 4. ZIP с шейпом распаковывается DecompressionStream.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
global.window = globalThis;
require(path.join(root, "app-crs-ru.js"));
require(path.join(root, "app-shp.js"));
const S = globalThis.GRADO_SHP;
const C = globalThis.GRADO_CRS_RU;
const expect = JSON.parse(fs.readFileSync(path.join(FIX, "expect-wgs84.json"), "utf8"));

const load = name => {
  const p = path.join(FIX, "shp", name);
  return fs.existsSync(p) ? fs.readFileSync(p).buffer.slice(
    fs.readFileSync(p).byteOffset, fs.readFileSync(p).byteOffset + fs.readFileSync(p).length) : null;
};
const buf = name => {
  const b = fs.readFileSync(path.join(FIX, "shp", name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want}`);

// ---------- полигон с дырой + DBF + PRJ ----------
{
  const fc = S.readShapefile({ shp: buf("zones.shp"), dbf: buf("zones.dbf"),
    prj: buf("zones.prj"), cpg: buf("zones.cpg") });
  assert.equal(fc.features.length, 1);
  const g = fc.features[0].geometry;
  assert.equal(g.type, "Polygon");
  assert.equal(g.coordinates.length, 2, "внешнее кольцо + дыра");
  assert.equal(g.coordinates[0].length, 5);
  const props = fc.features[0].properties;
  assert.equal(props.name, "Жилая зона", "кириллица DBF по .cpg");
  assert.equal(props.num, 7);
  close(props.area_ha, 12.5, 1e-9, "дробное поле");

  assert.ok(fc.crsDef, "СК из .prj распознана несмотря на ESRI-манглинг towgs84");
  assert.equal(fc.crsDef.kind, "tmerc");
  close(fc.crsDef.x0, 2250000, 0.001, "false easting");
  // конечная проверка: первая точка внешнего кольца → WGS84 как у pyproj
  const first = g.coordinates[0][0];
  const [lon, lat] = C.toWgs84(first[0], first[1], fc.crsDef);
  close(lon, expect.poly_first[0], 2e-7, "полигон долгота");
  close(lat, expect.poly_first[1], 2e-7, "полигон широта");
  const hole = g.coordinates[1][0];
  const [hl, hp] = C.toWgs84(hole[0], hole[1], fc.crsDef);
  close(hl, expect.hole_first[0], 2e-7, "дыра долгота");
  close(hp, expect.hole_first[1], 2e-7, "дыра широта");
}

// ---------- линия и точка ----------
{
  const roads = S.readShapefile({ shp: buf("roads.shp"), dbf: buf("roads.dbf"),
    prj: buf("roads.prj"), cpg: buf("roads.cpg") });
  const line = roads.features[0].geometry;
  assert.equal(line.type, "LineString");
  assert.equal(line.coordinates.length, 3);
  const [lon, lat] = C.toWgs84(...line.coordinates[2], roads.crsDef);
  close(lon, expect.line_last[0], 2e-7, "линия долгота");
  close(lat, expect.line_last[1], 2e-7, "линия широта");
  assert.equal(roads.features[0].properties.name, "Осевая");

  const pts = S.readShapefile({ shp: buf("pts.shp"), dbf: buf("pts.dbf"),
    prj: buf("pts.prj"), cpg: buf("pts.cpg") });
  assert.equal(pts.features[0].geometry.type, "Point");
  assert.equal(pts.features[0].properties.name, "Точка №1");
}

// ---------- ZIP ----------
{
  const b = fs.readFileSync(path.join(FIX, "zones-shp.zip"));
  const zipBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  S.unzip(zipBuf).then(files => {
    const names = Object.keys(files).sort();
    assert.ok(names.includes("zones.shp") && names.includes("zones.dbf"), "состав ZIP");
    const fc = S.readShapefile({ shp: files["zones.shp"], dbf: files["zones.dbf"],
      prj: files["zones.prj"], cpg: files["zones.cpg"] });
    assert.equal(fc.features[0].properties.name, "Жилая зона", "шейп из ZIP читается");
    console.log("shp-import: OK");
  }).catch(err => { console.error(err); process.exit(1); });
}
