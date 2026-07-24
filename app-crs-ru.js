"use strict";
// ---------- российские системы координат для импорта ----------
// Файлы градостроительных выгрузок приходят в чём угодно: СК-42 (Гаусса-
// Крюгера), местные МСК на Красовском или Бесселе, UTM, Web Mercator, голый
// WGS84. Модуль умеет: обобщённый Меркатор поперечный (любой эллипсоид,
// любой осевой), Гельмерта 7 параметров (линеаризованный, знаки как у
// +towgs84 в PROJ), разбор .prj (WKT) и строки CoordSys MapInfo, таблицу
// известных СК и автоопределение по попаданию точки в область карты.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const ELLIPSOIDS = {
    wgs84: { a: 6378137, f: 1 / 298.257223563 },
    grs80: { a: 6378137, f: 1 / 298.257222101 },
    krass: { a: 6378245, f: 1 / 298.3 },
    bessel: { a: 6377397.155, f: 1 / 299.1528128 },
  };
  // Пулково-42 → WGS84, параметры ГОСТ 32453 (те же, что в открытых prj МСК)
  const TOWGS84_PULKOVO = [23.57, -140.95, -79.8, 0, 0.35, 0.79, -0.22];

  // ---------- геодезические ↔ пространственные (ECEF) ----------
  function geodToXyz(lon, lat, ell) {
    const e2 = ell.f * (2 - ell.f);
    const sinP = Math.sin(lat * D2R), cosP = Math.cos(lat * D2R);
    const n = ell.a / Math.sqrt(1 - e2 * sinP * sinP);
    return [n * cosP * Math.cos(lon * D2R), n * cosP * Math.sin(lon * D2R),
      n * (1 - e2) * sinP];
  }
  function xyzToGeod(x, y, z, ell) {
    const e2 = ell.f * (2 - ell.f);
    const p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 6; i++) {
      const sinP = Math.sin(lat);
      const n = ell.a / Math.sqrt(1 - e2 * sinP * sinP);
      lat = Math.atan2(z + e2 * n * sinP, p);
    }
    return [Math.atan2(y, x) * R2D, lat * R2D];
  }
  // Гельмерт как +towgs84 (position vector, повороты в секундах, масштаб ppm)
  const AS2R = Math.PI / 648000;
  function helmert([dx, dy, dz, rx, ry, rz, s], x, y, z, inverse) {
    const m = 1 + s * 1e-6;
    const RX = rx * AS2R, RY = ry * AS2R, RZ = rz * AS2R;
    if (!inverse) return [
      dx + m * (x - RZ * y + RY * z),
      dy + m * (RZ * x + y - RX * z),
      dz + m * (-RY * x + RX * y + z)];
    const px = (x - dx) / m, py = (y - dy) / m, pz = (z - dz) / m;
    return [px + RZ * py - RY * pz, -RZ * px + py + RX * pz, RY * px - RX * py + pz];
  }
  // датум → WGS84 на уровне широт-долгот
  function datumToWgs84(lon, lat, ell, towgs84) {
    if (!towgs84 || towgs84.every(v => !v)) return [lon, lat];
    const [x, y, z] = geodToXyz(lon, lat, ell);
    return xyzToGeod(...helmert(towgs84, x, y, z, false), ELLIPSOIDS.wgs84);
  }
  function wgs84ToDatum(lon, lat, ell, towgs84) {
    if (!towgs84 || towgs84.every(v => !v)) return [lon, lat];
    const [x, y, z] = geodToXyz(lon, lat, ELLIPSOIDS.wgs84);
    return xyzToGeod(...helmert(towgs84, x, y, z, true), ell);
  }

  // ---------- Меркатор поперечный (ряды, точность миллиметровая) ----------
  function tmMeridianArc(phi, e2, a) {
    return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
      - 35 * e2 ** 3 / 3072 * Math.sin(6 * phi));
  }
  function tmForward(lon, lat, def) {
    const ell = def.ell, e2 = ell.f * (2 - ell.f), ep2 = e2 / (1 - e2);
    const k = def.k ?? 1;
    const phi = lat * D2R;
    const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
    const n = ell.a / Math.sqrt(1 - e2 * sinP * sinP);
    const t = tanP * tanP, c = ep2 * cosP * cosP;
    const aa = (lon - def.lon0) * D2R * cosP;
    const m = tmMeridianArc(phi, e2, ell.a);
    const m0 = tmMeridianArc((def.lat0 || 0) * D2R, e2, ell.a);
    const x = k * n * (aa + (1 - t + c) * aa ** 3 / 6
      + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa ** 5 / 120) + (def.x0 || 0);
    const y = k * (m - m0 + n * tanP * (aa ** 2 / 2
      + (5 - t + 9 * c + 4 * c * c) * aa ** 4 / 24
      + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa ** 6 / 720)) + (def.y0 || 0);
    return [x, y];
  }
  function tmInverse(x, y, def) {
    const ell = def.ell, e2 = ell.f * (2 - ell.f), ep2 = e2 / (1 - e2);
    const k = def.k ?? 1;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const m0 = tmMeridianArc((def.lat0 || 0) * D2R, e2, ell.a);
    const m = m0 + (y - (def.y0 || 0)) / k;
    const mu = m / (ell.a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + 151 * e1 ** 3 / 96 * Math.sin(6 * mu)
      + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
    const sinP = Math.sin(phi1), cosP = Math.cos(phi1), tanP = Math.tan(phi1);
    const c1 = ep2 * cosP * cosP, t1 = tanP * tanP;
    const n1 = ell.a / Math.sqrt(1 - e2 * sinP * sinP);
    const r1 = ell.a * (1 - e2) / Math.pow(1 - e2 * sinP * sinP, 1.5);
    const d = (x - (def.x0 || 0)) / (n1 * k);
    const lat = phi1 - (n1 * tanP / r1) * (d * d / 2
      - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24
      + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720);
    const lon = def.lon0 * D2R + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
      + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / cosP;
    return [lon * R2D, lat * R2D];
  }

  // ---------- определение СК: { kind, ell, towgs84, lon0, lat0, k, x0, y0 } --
  // kind: "geographic" | "tmerc" | "webmerc"
  const WEBMERC_R = 6378137;
  function toWgs84(x, y, def) {
    if (!def || def.kind === "geographic")
      return def && def.towgs84 ? datumToWgs84(x, y, def.ell, def.towgs84) : [x, y];
    if (def.kind === "webmerc")
      return [x / WEBMERC_R * R2D,
        (2 * Math.atan(Math.exp(y / WEBMERC_R)) - Math.PI / 2) * R2D];
    const [lon, lat] = tmInverse(x, y, def);
    return datumToWgs84(lon, lat, def.ell, def.towgs84);
  }
  function fromWgs84(lon, lat, def) {
    if (!def || def.kind === "geographic") return [lon, lat];
    if (def.kind === "webmerc")
      return [lon * D2R * WEBMERC_R,
        Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) * WEBMERC_R];
    const [dl, dp] = wgs84ToDatum(lon, lat, def.ell, def.towgs84);
    return tmForward(dl, dp, def);
  }

  // ---------- известные СК (для ручного выбора и автоопределения) ----------
  const KNOWN = [
    { id: "wgs84", title: "WGS 84 (широта/долгота)", def: { kind: "geographic", ell: ELLIPSOIDS.wgs84 } },
    { id: "webmerc", title: "Web Mercator (EPSG:3857)", def: { kind: "webmerc" } },
  ];
  for (const z of [36, 37, 38]) KNOWN.push({ id: "utm" + z, title: `UTM ${z}N (WGS 84)`,
    def: { kind: "tmerc", ell: ELLIPSOIDS.wgs84, lon0: z * 6 - 183, lat0: 0, k: 0.9996, x0: 500000, y0: 0 } });
  for (let z = 4; z <= 12; z++) KNOWN.push({ id: "gk" + z, title: `Гаусса-Крюгера зона ${z} (СК-42)`,
    def: { kind: "tmerc", ell: ELLIPSOIDS.krass, towgs84: TOWGS84_PULKOVO,
      lon0: z * 6 - 3, lat0: 0, k: 1, x0: z * 1e6 + 500000, y0: 0 } });
  KNOWN.push({ id: "msk50-2", title: "МСК-50 зона 2 (Московская область)",
    def: { kind: "tmerc", ell: ELLIPSOIDS.krass, towgs84: TOWGS84_PULKOVO,
      lon0: 38.47916666666666, lat0: 0, k: 1, x0: 2250000, y0: -5712900.566 } });
  KNOWN.push({ id: "msk-moscow", title: "МСК Москвы (Бессель)",
    def: { kind: "tmerc", ell: ELLIPSOIDS.bessel,
      towgs84: [316.151, 78.924, 589.65, -1.57273, 2.69209, 2.34693, 8.4507],
      lon0: 37.5, lat0: 55.66666666667, k: 1, x0: 16.098, y0: 14.512 } });

  // ---------- разбор .prj (ESRI WKT) ----------
  function wktParam(text, name) {
    const m = text.match(new RegExp(`PARAMETER\\s*\\[\\s*"${name}"\\s*,\\s*(-?[\\d.eE+]+)`, "i"));
    return m ? parseFloat(m[1]) : null;
  }
  function wktEllipsoid(text) {
    const m = text.match(/SPHEROID\s*\[\s*"[^"]*"\s*,\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)/i);
    if (!m) return null;
    const a = parseFloat(m[1]), rf = parseFloat(m[2]);
    return { a, f: rf ? 1 / rf : 0 };
  }
  // ESRI при записи .prj заменяет точки и запятые в имени датума на «_»:
  // towgs84=23.57,-140.95,… превращается в towgs84_23_57_-140_95_….
  // Восстанавливаем: каждое число — один или два токена (второй — дробная
  // часть), токен с минусом всегда НАЧИНАЕТ число. Из всех разборов на
  // ровно 7 чисел берём правдоподобный (|сдвиги|≤10 км, |повороты|≤15″,
  // |масштаб|≤50 ppm), при равенстве — тот, где одиночные токены нулевые.
  function unmangleTowgs84(tokens) {
    const results = [];
    const walk = (i, acc, singles) => {
      if (acc.length > 7) return;
      if (i === tokens.length) { if (acc.length === 7) results.push({ acc: [...acc], singles }); return; }
      walk(i + 1, [...acc, parseFloat(tokens[i])], singles + (tokens[i] === "0" ? 0 : 1));
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-"))
        walk(i + 2, [...acc, parseFloat(tokens[i] + "." + tokens[i + 1])], singles);
    };
    walk(0, [], 0);
    const plausible = results.filter(({ acc }) =>
      acc.slice(0, 3).every(v => Math.abs(v) <= 10000) &&
      acc.slice(3, 6).every(v => Math.abs(v) <= 15) && Math.abs(acc[6]) <= 50);
    const pool = plausible.length ? plausible : results;
    if (!pool.length) return null;
    pool.sort((a, b) => a.singles - b.singles);
    return pool[0].acc;
  }
  function wktTowgs84(text) {
    // сами параметры TOWGS84[…] — либо зашиты в имя датума (частый приём в
    // .prj местных МСК: pyproj их тоже вычитывает только из имени)
    let m = text.match(/TOWGS84\s*\[([^\]]+)\]/i);
    if (!m) m = text.match(/towgs84=([-\d.,eE+ ]+)/);
    if (m) {
      const nums = m[1].split(/[,; ]+/).map(parseFloat).filter(Number.isFinite);
      while (nums.length < 7) nums.push(0);
      return nums.slice(0, 7);
    }
    const mangled = text.match(/towgs84_((?:-?\d+_)+-?\d+)/i);
    if (mangled) return unmangleTowgs84(mangled[1].split("_"));
    return null;
  }
  function parsePrj(text) {
    if (!text || typeof text !== "string") return null;
    const t = text.trim();
    if (!/GEOGCS|PROJCS/i.test(t)) return null;
    const ell = wktEllipsoid(t) || ELLIPSOIDS.wgs84;
    const towgs84 = wktTowgs84(t) ||
      (/Pulkovo|Krasso|krass/i.test(t) ? TOWGS84_PULKOVO : null);
    if (!/PROJCS/i.test(t)) return { kind: "geographic", ell, towgs84 };
    if (/Mercator_Auxiliary_Sphere|Pseudo.?Mercator|Popular Visualisation/i.test(t))
      return { kind: "webmerc" };
    if (!/Transverse_Mercator|Gauss_Kruger|Gauss.?Kr/i.test(t)) return null;
    return {
      kind: "tmerc", ell, towgs84,
      lon0: wktParam(t, "Central_Meridian") ?? wktParam(t, "central_meridian") ?? 0,
      lat0: wktParam(t, "Latitude_Of_Origin") ?? wktParam(t, "latitude_of_origin") ?? 0,
      k: wktParam(t, "Scale_Factor") ?? wktParam(t, "scale_factor") ?? 1,
      x0: wktParam(t, "False_Easting") ?? wktParam(t, "false_easting") ?? 0,
      y0: wktParam(t, "False_Northing") ?? wktParam(t, "false_northing") ?? 0,
    };
  }

  // ---------- разбор CoordSys (MapInfo .tab / .mif) ----------
  // Эллипсоиды MapInfo по номерам: 28 — WGS84? нет: 28=GRS80? Проверено по
  // MITAB: 0=Clarke66, 3=Krassovsky, 10=Bessel, 28=WGS84 (номер датума ниже
  // важнее номера эллипсоида; для 9999 эллипсоид идёт первым параметром).
  const MI_ELLIPSOID = { 3: ELLIPSOIDS.krass, 10: ELLIPSOIDS.bessel,
    28: ELLIPSOIDS.wgs84, 0: ELLIPSOIDS.wgs84 };
  function parseMapinfoCoordSys(line) {
    if (!line) return null;
    const t = String(line).replace(/^\s*CoordSys\s*/i, "");
    if (/^\s*Earth\s+Projection\s+1\s*,/i.test(t) || /NonEarth/i.test(t) === false && /Projection\s+1\b/.test(t)) {
      // Projection 1 = широта/долгота
      const dm = t.match(/Projection\s+1\s*,\s*(\d+)/);
      const datum = dm ? +dm[1] : 104;
      return { kind: "geographic", ell: ELLIPSOIDS.wgs84,
        towgs84: datum === 1001 ? TOWGS84_PULKOVO : null };
    }
    const m = t.match(/Projection\s+(\d+)\s*,\s*(.+)$/i);
    if (!m) return null;
    const proj = +m[1];
    const parts = m[2].split(",").map(s => s.trim());
    if (proj === 10) return { kind: "webmerc" };          // Mercator (упрощённо)
    if (proj !== 8) return null;                          // 8 = Transverse Mercator
    // datum, "units", lon0, lat0, k, x0, y0 [ , bounds]
    let datumSpec = parts[0], idx = 1;
    let ell = ELLIPSOIDS.wgs84, towgs84 = null;
    if (datumSpec === "9999" || datumSpec === "999") {
      // свой датум: 9999, эллипсоид, dx,dy,dz,rx,ry,rz,s[,ppm]
      const ellCode = +parts[1];
      ell = MI_ELLIPSOID[ellCode] || ELLIPSOIDS.krass;
      const p = parts.slice(2, 9).map(parseFloat);
      // MapInfo пишет повороты с противоположным знаком относительно
      // +towgs84 (соглашение coordinate frame) — выяснено по эталонным
      // файлам fiona/GDAL; сдвиги и масштаб совпадают
      towgs84 = [p[0], p[1], p[2], -p[3], -p[4], -p[5], p[6]];
      idx = 9;
      while (idx < parts.length && !/^"/.test(parts[idx])) idx++;   // до "m"
    } else {
      const datum = +datumSpec;
      if (datum === 1001) { ell = ELLIPSOIDS.krass; towgs84 = TOWGS84_PULKOVO; }
      else if (datum === 104 || datum === 33) ell = ELLIPSOIDS.wgs84;
    }
    const nums = parts.slice(idx).filter(s => !/^"/.test(s)).map(parseFloat);
    if (nums.length < 5) return null;
    return { kind: "tmerc", ell, towgs84,
      lon0: nums[0], lat0: nums[1], k: nums[2], x0: nums[3], y0: nums[4] };
  }

  // ---------- автоопределение: чьи метры? ----------
  // Берём первую точку файла и проверяем известные СК: в правильной точка
  // падает рядом с областью карты (центр текущего вида), в чужой — за сотни
  // километров или в океан.
  function detectByFit(point, viewLonLat) {
    const [vx, vy] = viewLonLat || [37.62, 55.75];
    let best = null;
    for (const cand of KNOWN) {
      if (cand.def.kind === "geographic") continue;
      let lon, lat;
      try { [lon, lat] = toWgs84(point[0], point[1], cand.def); }
      catch { continue; }
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lat < 40 || lat > 82 || lon < 18 || lon > 180) continue;   // не Россия
      const dist = Math.hypot((lon - vx) * Math.cos(lat * D2R), lat - vy) * 111320;
      if (!best || dist < best.dist) best = { ...cand, dist };
    }
    return best && best.dist < 300000 ? best : null;   // ближе 300 км к области
  }
  const looksLikeDegrees = point =>
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

  root.GRADO_CRS_RU = { ELLIPSOIDS, TOWGS84_PULKOVO, KNOWN,
    tmForward, tmInverse, datumToWgs84, wgs84ToDatum, toWgs84, fromWgs84,
    parsePrj, parseMapinfoCoordSys, detectByFit, looksLikeDegrees };
})();
