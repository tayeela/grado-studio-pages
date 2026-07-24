/* Exact coordinate transforms shared by the browser canvas and import core.
   Project coordinates are metres in EPSG:32637 minus the fixed project
   origin (413000, 6178000). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GRADO_CRS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const A = 6378137;
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  const EP2 = E2 / (1 - E2);
  const K0 = 0.9996;
  const LON0 = 39 * Math.PI / 180;
  const FALSE_EASTING = 500000;
  const MERCATOR_RADIUS = 6378137;
  const ORIGIN_UTM = Object.freeze([413000, 6178000]);
  const toRadians = value => Number(value) * Math.PI / 180;
  const toDegrees = value => value * 180 / Math.PI;

  function finitePair(point, name = "Координаты") {
    if (!Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])))
      throw new Error(`${name} должны быть парой конечных чисел`);
    return [Number(point[0]), Number(point[1])];
  }

  function wgs84ToUtm37n(point) {
    const [lon, lat] = finitePair(point);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
      throw new Error("Координаты WGS84 должны быть в пределах EPSG:4326");
    const phi = toRadians(lat), lam = toRadians(lon);
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
    const n = A / Math.sqrt(1 - E2 * sinPhi ** 2);
    const t = tanPhi ** 2, c = EP2 * cosPhi ** 2;
    const aa = (lam - LON0) * cosPhi;
    const m = A * (
      (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
      - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
      - 35 * E2 ** 3 / 3072 * Math.sin(6 * phi));
    const x = K0 * n * (aa + (1 - t + c) * aa ** 3 / 6
      + (5 - 18 * t + t ** 2 + 72 * c - 58 * EP2) * aa ** 5 / 120) + FALSE_EASTING;
    const y = K0 * (m + n * tanPhi * (aa ** 2 / 2
      + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24
      + (61 - 58 * t + t ** 2 + 600 * c - 330 * EP2) * aa ** 6 / 720));
    return [x, y];
  }

  function utm37nToWgs84(point) {
    const [x, y] = finitePair(point);
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const m = y / K0;
    const mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + 151 * e1 ** 3 / 96 * Math.sin(6 * mu)
      + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
    const sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1), tanPhi1 = Math.tan(phi1);
    const c1 = EP2 * cosPhi1 ** 2, t1 = tanPhi1 ** 2;
    const n1 = A / Math.sqrt(1 - E2 * sinPhi1 ** 2);
    const r1 = A * (1 - E2) / (1 - E2 * sinPhi1 ** 2) ** 1.5;
    const d = (x - FALSE_EASTING) / (n1 * K0);
    const phi = phi1 - (n1 * tanPhi1 / r1) * (
      d ** 2 / 2
      - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4 / 24
      + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6 / 720);
    const lam = LON0 + (d
      - (1 + 2 * t1 + c1) * d ** 3 / 6
      + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5 / 120) / cosPhi1;
    return [toDegrees(lam), toDegrees(phi)];
  }

  function wgs84ToLocal(point) {
    const [x, y] = wgs84ToUtm37n(point);
    return [x - ORIGIN_UTM[0], y - ORIGIN_UTM[1]];
  }

  function localToWgs84(point) {
    const [x, y] = finitePair(point);
    return utm37nToWgs84([x + ORIGIN_UTM[0], y + ORIGIN_UTM[1]]);
  }

  function mercatorToWgs84(point) {
    const [x, y] = finitePair(point);
    return [toDegrees(x / MERCATOR_RADIUS),
      toDegrees(Math.atan(Math.sinh(y / MERCATOR_RADIUS)))];
  }

  function wgs84ToMercator(point) {
    const [lon, rawLat] = finitePair(point);
    const lat = Math.max(-85.05112878, Math.min(85.05112878, rawLat));
    return [MERCATOR_RADIUS * toRadians(lon),
      MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2))];
  }

  const ORIGIN_WGS84 = Object.freeze(utm37nToWgs84(ORIGIN_UTM));

  /* Проектная система координат. По умолчанию проект живёт в исторической
     UTM 37N минус origin; setProjectCrs подменяет преобразования на местную
     СК территории (МСК Москвы, МСК-50, ГК-зону) — и ВЕСЬ конвейер (импорт,
     тайлы, холст) автоматически работает в ней: и pages-core, и app.js
     зовут одни и те же wgs84ToLocal/localToWgs84 отсюда. */
  let projectCrs = null;   // { id, fromWgs84([lon,lat])→[x,y], toWgs84([x,y])→[lon,lat] }
  function setProjectCrs(next) { projectCrs = next || null; }
  function projectCrsId() { return projectCrs ? projectCrs.id : "utm37-legacy"; }
  function wgs84ToLocalProject(point) {
    return projectCrs ? projectCrs.fromWgs84(finitePair(point)) : wgs84ToLocal(point);
  }
  function localToWgs84Project(point) {
    return projectCrs ? projectCrs.toWgs84(finitePair(point)) : localToWgs84(point);
  }
  return { ORIGIN_UTM, ORIGIN_WGS84, wgs84ToUtm37n, utm37nToWgs84,
    wgs84ToLocal: wgs84ToLocalProject, localToWgs84: localToWgs84Project,
    legacyWgs84ToLocal: wgs84ToLocal, legacyLocalToWgs84: localToWgs84,
    setProjectCrs, projectCrsId,
    mercatorToWgs84, wgs84ToMercator };
});
