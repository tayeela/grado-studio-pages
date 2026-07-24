"use strict";

// Российские СК для импорта. Эталоны посчитаны pyproj 9.5 (PROJ) — числа
// в тесте скопированы из его вывода, а не выведены нашим же кодом.
// Допуск 2 см: ряды Меркатора миллиметровые, линеаризованный Гельмерт
// совпадает с +towgs84 PROJ по построению.

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = globalThis;
require(path.join(__dirname, "..", "app-crs-ru.js"));
const C = globalThis.GRADO_CRS_RU;

const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want} (±${tol})`);

const MOSCOW = [37.6176, 55.752];

// ---------- Гаусс-Крюгер СК-42 (EPSG:28407, зона 7) ----------
{
  const def = C.KNOWN.find(k => k.id === "gk7").def;
  const [dl, dp] = C.wgs84ToDatum(...MOSCOW, def.ell, def.towgs84);
  const [x, y] = C.tmForward(dl, dp, def);
  close(x, 7413315.9506, 0.02, "ГК-7 восток");
  close(y, 6181917.6539, 0.02, "ГК-7 север");
  // обратно: pyproj: 7411000,6181000 → 37.581027381, 55.743339998
  const [lon, lat] = C.toWgs84(7411000, 6181000, def);
  close(lon, 37.581027381, 3e-7, "ГК-7 обратно долгота");
  close(lat, 55.743339998, 3e-7, "ГК-7 обратно широта");
}

// ---------- зона 6 ----------
{
  const def = C.KNOWN.find(k => k.id === "gk6").def;
  const [x, y] = C.fromWgs84(33.5, 55.0, def);
  close(x, 6532118.7967, 0.02, "ГК-6 восток");
  close(y, 6097457.027, 0.02, "ГК-6 север");
}

// ---------- UTM 37N ----------
{
  const def = C.KNOWN.find(k => k.id === "utm37").def;
  const [x, y] = C.fromWgs84(...MOSCOW, def);
  close(x, 413234.5283, 0.01, "UTM37 восток");
  close(y, 6179343.7107, 0.01, "UTM37 север");
}

// ---------- Web Mercator ----------
{
  const def = C.KNOWN.find(k => k.id === "webmerc").def;
  const [x, y] = C.fromWgs84(...MOSCOW, def);
  close(x, 4187572.0769, 0.01, "WebMerc X");
  close(y, 7509203.4496, 0.01, "WebMerc Y");
  const [lon, lat] = C.toWgs84(x, y, def);
  close(lon, MOSCOW[0], 1e-9, "WebMerc туда-обратно");
  close(lat, MOSCOW[1], 1e-9, "WebMerc туда-обратно широта");
}

// ---------- МСК Москвы (Бессель, 7 параметров с большими поворотами) ----------
{
  const def = C.KNOWN.find(k => k.id === "msk-moscow").def;
  const [x, y] = C.fromWgs84(...MOSCOW, def);
  close(x, 7499.2218, 0.03, "МСК Москвы восток");
  close(y, 9469.1604, 0.03, "МСК Москвы север");
  const [lon, lat] = C.toWgs84(7000, -3000, def);
  close(lon, 37.609338558, 5e-7, "МСК Москвы обратно долгота");
  close(lat, 55.640011336, 5e-7, "МСК Москвы обратно широта");
}

// ---------- чистый Гельмерт Пулково→WGS84 ----------
{
  const [lon, lat] = C.datumToWgs84(37.6176, 55.752, C.ELLIPSOIDS.krass, C.TOWGS84_PULKOVO);
  close(lon, 37.615725695, 2e-8, "Пулково-42 долгота");
  close(lat, 55.752042606, 2e-8, "Пулково-42 широта");
}

// ---------- разбор .prj ----------
{
  const prj = `PROJCS["MSK-50 zone 2",GEOGCS["GCS_Pulkovo_1942",DATUM["D_Pulkovo_1942",
    SPHEROID["Krassowsky_1940",6378245.0,298.3]],PRIMEM["Greenwich",0.0],
    UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],
    PARAMETER["False_Easting",2250000.0],PARAMETER["False_Northing",-5712900.566],
    PARAMETER["Central_Meridian",38.47916666666666],PARAMETER["Scale_Factor",1.0],
    PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
  const def = C.parsePrj(prj);
  assert.equal(def.kind, "tmerc");
  close(def.lon0, 38.47916666666666, 1e-12, "осевой меридиан из prj");
  close(def.x0, 2250000, 0.001, "false easting из prj");
  assert.ok(def.towgs84, "Пулково распознано по имени датума → ГОСТ-параметры");
  // pyproj для той же СК: (38.0, 55.9) → 2220143.2513, 484734.1548
  const [x, y] = C.fromWgs84(38.0, 55.9, def);
  close(x, 2220143.2513, 0.03, "МСК-50-2 восток");
  close(y, 484734.1548, 0.03, "МСК-50-2 север");

  // towgs84 зашит в имя датума (приём местных МСК) — вычитывается
  const prjMsk = prj.replace('D_Pulkovo_1942',
    'D_MSK towgs84=316.151,78.924,589.650,-1.57273,2.69209,2.34693,8.4507');
  const defMsk = C.parsePrj(prjMsk);
  close(defMsk.towgs84[0], 316.151, 1e-9, "towgs84 из имени датума");
  close(defMsk.towgs84[6], 8.4507, 1e-9, "масштаб из имени датума");

  // ESRI-манглинг: towgs84 в имени датума с «_» вместо точек и запятых
  const mangled = C.parsePrj(prj.replace("D_Pulkovo_1942",
    "D_MSK_using_towgs84_316_151_78_924_589_650_-1_57273_2_69209_2_34693_8_4507"));
  assert.deepEqual(mangled.towgs84, [316.151, 78.924, 589.65, -1.57273, 2.69209, 2.34693, 8.4507],
    "манглинг из 14 токенов восстановлен");
  const gost = C.parsePrj(prj.replace("D_Pulkovo_1942",
    "D_using_towgs84_23_57_-140_95_-79_8_0_0_35_0_79_-0_22"));
  assert.deepEqual(gost.towgs84, [23.57, -140.95, -79.8, 0, 0.35, 0.79, -0.22],
    "неоднозначный манглинг: выбран разбор с нулевой одиночкой");

  // географическая без проекции
  const geo = C.parsePrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]');
  assert.equal(geo.kind, "geographic");
}

// ---------- CoordSys MapInfo ----------
{
  const def = C.parseMapinfoCoordSys(
    'CoordSys Earth Projection 8, 1001, "m", 39, 0, 1, 7500000, 0');
  assert.equal(def.kind, "tmerc");
  assert.equal(def.lon0, 39);
  assert.equal(def.x0, 7500000);
  assert.deepEqual(def.towgs84, C.TOWGS84_PULKOVO, "датум 1001 = Пулково-42");
  const geo = C.parseMapinfoCoordSys("CoordSys Earth Projection 1, 104");
  assert.equal(geo.kind, "geographic");
}

// ---------- автоопределение ----------
{
  // точка в ГК-7 около Москвы
  const hit = C.detectByFit([7413315.95, 6181917.65], [37.62, 55.75]);
  assert.ok(hit, "СК нашлась");
  assert.equal(hit.id, "gk7", "выбрана зона 7 СК-42");
  // UTM-координаты той же точки
  const hit2 = C.detectByFit([413234.53, 6179343.71], [37.62, 55.75]);
  assert.equal(hit2.id, "utm37");
  // [1,2] метра — это, между прочим, валидная точка МСК Москвы (начало
  // системы в центре города): автоопределение честно её принимает
  assert.equal((C.detectByFit([1, 2], [37.62, 55.75]) || {}).id, "msk-moscow");
  // а вот далёкий мусор не подгоняется
  assert.equal(C.detectByFit([9.9e8, 9.9e8], [37.62, 55.75]), null, "далёкий мусор не СК");
  assert.ok(C.looksLikeDegrees([37.6, 55.7]));
  assert.ok(!C.looksLikeDegrees([413234, 6179343]));
}

console.log("crs-ru: OK");
