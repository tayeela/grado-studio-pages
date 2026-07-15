/* Pure computation and project validation for the static browser edition.
   Kept separate from the fetch adapter so the same fixtures can verify the
   browser and desktop engines without a DOM. */
(function (root, factory) {
  const crs = typeof module === "object" && module.exports
    ? require("./crs.js") : root.GRADO_CRS;
  const api = factory(crs);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GRADO_PAGES_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (crs) {
  "use strict";

  if (!crs) throw new Error("Не загружен модуль точных преобразований координат");
  const { ORIGIN_WGS84, mercatorToWgs84, wgs84ToLocal, wgs84ToMercator } = crs;

  const PROFILE = {
    id: "moscow_urban_planning_2026_07",
    jurisdiction: "Москва",
    checked_at: "2026-07-13",
    automated_acts: ["2151-ПП", "2152-ПП"],
    screening_acts: ["945-ПП", "2150-ПП", "120-ПП"],
    notice: "Расчёт предназначен для предпроектной проверки. Соответствие ПЗЗ, ГПЗУ, ППТ, санитарным, пожарным и отраслевым требованиям подтверждается по исходным данным проекта.",
  };
  const BUILTIN_LAYERS = new Set([
    "project.territory.boundary", "project.tp.func_zone", "project.apo.public_zones",
    "source.constraints.restrict", "source.nspd.parcels", "project.apo.buildings",
    "project.apo.red_lines", "project.social.objects", "source.fgistp.func_zones",
    "source.gisogd.func_zones", "source.gisogd.red_lines", "source.gisogd.restrict",
    "source.gisogd.other", "source.nspd.buildings", "source.nspd.constructions",
    "source.nspd.zouit", "source.osm.roads", "source.osm.buildings",
    "source.osm.landuse", "source.osm.water", "source.osm.boundaries",
    "source.terrain.contours",
  ]);
  const LEGACY_KINDS = new Set([
    "boundary", "restrict", "zone", "building", "redline", "social", "public", "parcel",
  ]);

  const number = (value, fallback) => {
    if (value === null || value === undefined ||
        (typeof value === "string" && !value.trim())) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const bounded = (value, minimum, maximum, fallback) => {
    const parsed = number(value, fallback);
    return parsed >= minimum && parsed <= maximum ? parsed : fallback;
  };
  const floorCount = value => {
    const floors = Math.trunc(number(value, 9));
    return floors >= 1 && floors <= 75 ? floors : 9;
  };
  const roundBits = new DataView(new ArrayBuffer(8));
  const compareDoubleToDecimalHalf = (value, lower, factor) => {
    roundBits.setFloat64(0, value, false);
    const bits = roundBits.getBigUint64(0, false);
    const exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fractionBits = bits & ((1n << 52n) - 1n);
    const mantissa = exponentBits === 0 ? fractionBits : (1n << 52n) | fractionBits;
    const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
    const numerator = BigInt(lower) * 2n + 1n;
    const denominator = BigInt(factor) * 2n;
    let left = mantissa * denominator;
    let right = numerator;
    if (exponent >= 0) left <<= BigInt(exponent);
    else right <<= BigInt(-exponent);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const rounded = (value, digits = 0) => {
    const parsed = number(value, 0);
    if (!parsed) return 0;
    const factor = 10 ** digits;
    const absolute = Math.abs(parsed);
    const lower = Math.floor(absolute * factor);
    const side = compareDoubleToDecimalHalf(absolute, lower, factor);
    const integer = side < 0 ? lower : side > 0 ? lower + 1
      : (lower % 2 === 0 ? lower : lower + 1);
    return (parsed < 0 ? -integer : integer) / factor;
  };
  const ringArea = ring => {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += number(a && a[0], 0) * number(b && b[1], 0) -
              number(b && b[0], 0) * number(a && a[1], 0);
    }
    return Math.abs(area) / 2;
  };
  const ringCentroid = ring => {
    if (!Array.isArray(ring) || !ring.length) return null;
    let twiceArea = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const cross = number(a[0], 0) * number(b[1], 0) - number(b[0], 0) * number(a[1], 0);
      twiceArea += cross;
      cx += (number(a[0], 0) + number(b[0], 0)) * cross;
      cy += (number(a[1], 0) + number(b[1], 0)) * cross;
    }
    if (Math.abs(twiceArea) < 1e-9) {
      return [ring.reduce((sum, point) => sum + number(point[0], 0), 0) / ring.length,
        ring.reduce((sum, point) => sum + number(point[1], 0), 0) / ring.length];
    }
    return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  };
  const representativePoint = feature => {
    if (feature && feature.ring) return ringCentroid(feature.ring);
    if (Array.isArray(feature && feature.point)) return feature.point;
    if (Array.isArray(feature && feature.line) && feature.line.length)
      return feature.line[Math.floor(feature.line.length / 2)];
    if (feature && feature.circle) return [feature.circle.cx, feature.circle.cy];
    if (feature && feature.arc) return [feature.arc.cx, feature.arc.cy];
    return null;
  };
  const pointInRing = (point, ring) => {
    if (!point || !Array.isArray(ring) || ring.length < 3) return false;
    const x = number(point[0], 0), y = number(point[1], 0);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = number(ring[i][0], 0), yi = number(ring[i][1], 0);
      const xj = number(ring[j][0], 0), yj = number(ring[j][1], 0);
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        inside = !inside;
    }
    return inside;
  };
  const clippedToTerritory = features => {
    const boundaries = features.filter(feature => feature && feature.kind === "boundary" && feature.ring);
    if (!boundaries.length) return features;
    return features.filter(feature => {
      if (feature && feature.kind === "boundary" && feature.ring) return true;
      const point = representativePoint(feature);
      return !point || boundaries.some(boundary => pointInRing(point, boundary.ring));
    });
  };
  const result = (id, group, title, value, unit, digits = 0) => ({
    id, group, title, value: rounded(value, digits), unit,
  });

  function computeTep(payload = {}) {
    const rawFeatures = Array.isArray(payload.features) ? payload.features.filter(Boolean) : [];
    const params = payload.params && typeof payload.params === "object" ? payload.params : {};
    const hasTerritory = rawFeatures.some(feature => feature.kind === "boundary" && feature.ring);
    const features = clippedToTerritory(rawFeatures);
    const rawTerrArea = hasTerritory
      ? features.filter(feature => feature.kind === "boundary" && feature.ring)
        .reduce((sum, feature) => sum + ringArea(feature.ring), 0) / 10000
      : 15;
    const rawRestrictArea = features.filter(feature => feature.kind === "restrict" && feature.ring)
      .reduce((sum, feature) => sum + ringArea(feature.ring), 0) / 10000;
    const terrArea = rounded(rawTerrArea, 4);
    const restrictArea = rounded(rawRestrictArea, 4);
    const calcArea = terrArea - restrictArea;
    // Диапазоны совпадают с moscow_krt.json и настольным studio_core.
    // Иначе вручную отредактированный веб-проект мог получить расчёт,
    // который невозможно задать через интерфейс.
    const density = bounded(params.density, 1, 60, 25);
    const ratioZh = bounded(params.ratio_zh, 0, 100, 80);
    const percentVpp = bounded(params.percent_vpp, 0, 30, 6);
    const educationZone = number(params.education_zone, 1) === 2 ? 2 : 1;
    const territoryMode = number(params.territory_mode, 1) === 2 ? 2 : 1;
    const kRail = bounded(params.k_rail, 0.5, 1, 1);
    const kBa = bounded(params.k_ba, 0.1, 1, 0.5);
    const spp = density * calcArea;
    const np = spp * 0.9;
    const sppZh = spp * ratioZh / 100;
    const sppNzh = spp - sppZh;
    const sppVpp = sppZh * percentVpp / 100;
    const sppZhNet = sppZh - sppVpp;
    const sqFlats = sppZhNet * 0.65;
    const populationThs = sqFlats / 33;
    const population = rounded(populationThs * 1000);
    const flats = rounded(populationThs * 1000 / 2.1);
    const dooNorm = rounded(populationThs * (educationZone === 2 ? 63 : 44));
    const schoolNorm = rounded(populationThs * (educationZone === 2 ? 124 : 90));
    const policlinicNorm = rounded(populationThs * 19);
    const retail = rounded(populationThs * 270);
    const services = rounded(populationThs * 100);
    const green = rounded(territoryMode === 2 ? calcArea * 10000 * 0.25 : populationThs * 1000 * 5);
    const playground = rounded(territoryMode === 2 ? populationThs * 1000 * 0.5 : 0);
    const adultRecreation = rounded(territoryMode === 2 ? populationThs * 1000 * 0.1 : 0);
    const parking = rounded(populationThs * 257 * kRail * kBa);
    const factSpp = features.filter(feature => feature.kind === "building" && feature.ring)
      .reduce((sum, feature) => sum + ringArea(feature.ring) * floorCount(feature.props && feature.props.floors) / 1000, 0);
    const factDensity = calcArea > 0 ? factSpp / calcArea : 0;
    const results = [
      result("calc_area", "Территория", "Расчётная площадь территории", calcArea, "га", 2),
      result("spp", "Застройка", "СПП в габаритах наружных стен", spp, "тыс. м²", 1),
      result("np", "Застройка", "Наземная площадь (НП)", np, "тыс. м²", 1),
      result("spp_zh", "Застройка", "СПП жилых зданий", sppZh, "тыс. м²", 1),
      result("spp_nzh", "Застройка", "СПП нежилых зданий", sppNzh, "тыс. м²", 1),
      result("spp_vpp", "Застройка", "СПП встроенных нежилых помещений (ВПП)", sppVpp, "тыс. м²", 1),
      result("spp_zh_net", "Застройка", "СПП жилой части МКД", sppZhNet, "тыс. м²", 1),
      result("sq_flats", "Жильё и население", "Площадь квартир", sqFlats, "тыс. м²", 1),
      result("population", "Жильё и население", "Расчётное население", population, "чел"),
      result("flats", "Жильё и население", "Количество квартир", flats, "кв."),
      result("doo_norm", "Социальные объекты", "Потребность в местах ДОО (2151-ПП)", dooNorm, "мест"),
      result("doo_places", "Социальные объекты", "Расчётная потребность ДОО", dooNorm, "мест"),
      result("school_norm", "Социальные объекты", "Потребность в местах школ (2151-ПП)", schoolNorm, "мест"),
      result("school_places", "Социальные объекты", "Расчётная потребность школ", schoolNorm, "мест"),
      result("policlinic_norm", "Социальные объекты", "Потребность в поликлиниках", policlinicNorm, "посещ./смену"),
      result("policlinic_places", "Социальные объекты", "Расчётная потребность поликлиник", policlinicNorm, "посещ./смену"),
      result("retail_nnp_required", "Обслуживание", "Торговля к размещению (2152-ПП)", retail, "м² ННП"),
      result("services_nnp_required", "Обслуживание", "Бытовое обслуживание (2152-ПП)", services, "м² ННП"),
      result("green_area_required", "Жилые территории", "Озеленённая территория по режиму 2152-ПП", green, "м²"),
      result("playground_area_required", "Жилые территории", "Детские площадки при реконструкции", playground, "м²"),
      result("adult_recreation_area_required", "Жилые территории", "Площадки отдыха взрослых при реконструкции", adultRecreation, "м²"),
      result("parking_perm", "Транспорт", "Машино-места — предварительный расчёт", parking, "м/м"),
      result("parking_guest", "Транспорт", "Гостевые машино-места — предварительно", rounded(parking / 10), "м/м"),
    ];
    const checks = [];
    if (factDensity > 0) checks.push({
      title: "Плотность по ПЗЗ/ГПЗУ", ok: false,
      msg: `Факт ${rounded(factDensity, 2)} тыс. м²/га — требуется сверка с предельными параметрами участка`,
    });
    if (population > 0) {
      checks.push({ title: "Образование · 2151-ПП", ok: true,
        msg: `Зона ${educationZone}: потребность ДОО ${dooNorm} мест, школа ${schoolNorm} мест` });
      checks.push({ title: "Транспорт · 945-ПП", ok: false,
        msg: "Машино-места рассчитаны предварительно; требуется уточнение по ВРИ, территориальной зоне и типам объектов" });
      checks.push({ title: "Территориальная доступность", ok: false,
        msg: "Потребность рассчитана; существующую ёмкость и нормативные радиусы объектов необходимо проверить по окружению" });
    }
    if (!hasTerritory && rawFeatures.some(feature => feature && feature.ring)) {
      checks.unshift({ title: "Граница территории", ok: false,
        msg: "не задана — ТЭП по всем объектам карты; начертите границу, чтобы считать внутри территории разработки" });
    }
    return {
      inputs: { terr_area: rounded(terrArea, 4), restrict_area: rounded(restrictArea, 4) },
      results, fact: { spp: rounded(factSpp, 1), density: rounded(factDensity, 2) },
      zones: null, checks, regulatory_profile: PROFILE, has_territory: hasTerritory,
    };
  }

  const MAX_COORDINATE = 1e9;
  const finiteCoordinate = value => value !== null && value !== undefined &&
    !(typeof value === "string" && !value.trim()) && Number.isFinite(Number(value)) &&
    Math.abs(Number(value)) <= MAX_COORDINATE;
  const finitePoint = value => Array.isArray(value) && value.length >= 2 &&
    finiteCoordinate(value[0]) && finiteCoordinate(value[1]);
  const validGeometry = feature => {
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) return false;
    if (feature.kind === "social") return finitePoint(feature.point);
    if (feature.kind === "redline")
      return Array.isArray(feature.line) && feature.line.length >= 2 && feature.line.every(finitePoint);
    if (feature.circle) return finiteCoordinate(feature.circle.cx) &&
      finiteCoordinate(feature.circle.cy) && finiteCoordinate(feature.circle.r) && Number(feature.circle.r) > 0;
    if (feature.arc) return finiteCoordinate(feature.arc.cx) &&
      finiteCoordinate(feature.arc.cy) && finiteCoordinate(feature.arc.r) && Number(feature.arc.r) > 0;
    if (["boundary", "restrict", "zone", "building", "public", "parcel"].includes(feature.kind))
      return Array.isArray(feature.ring) && feature.ring.length >= 3 && feature.ring.every(finitePoint);
    if (feature.point) return finitePoint(feature.point);
    if (feature.line) return Array.isArray(feature.line) && feature.line.length >= 2 && feature.line.every(finitePoint);
    return Array.isArray(feature.ring) && feature.ring.length >= 3 && feature.ring.every(finitePoint);
  };
  function preflightProject(payload = {}) {
    const features = Array.isArray(payload.features) ? payload.features : [];
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    const target = ["grado", "album", "print", "dxf"].includes(payload.target) ? payload.target : "grado";
    const knownLayers = new Set(BUILTIN_LAYERS);
    layers.forEach(layer => { if (layer && typeof layer.layer_id === "string") knownLayers.add(layer.layer_id); });
    const broken = [], unrouted = [], duplicateIds = [], seen = new Set();
    let exportable = 0, annotations = 0, hasBoundary = false;
    features.forEach((feature, index) => {
      const label = feature && feature.id !== undefined && feature.id !== "" ? String(feature.id) : `№${index + 1}`;
      if (!feature || typeof feature !== "object" || Array.isArray(feature)) { broken.push(label); return; }
      if (feature.id !== undefined && feature.id !== "") {
        const key = String(feature.id);
        if (seen.has(key)) duplicateIds.push(key);
        seen.add(key);
      }
      if (feature.kind === "dim" || feature.layer_id === "annotation.dimensions") { annotations += 1; return; }
      const routed = typeof feature.layer_id === "string"
        ? knownLayers.has(feature.layer_id) : LEGACY_KINDS.has(feature.kind);
      if (!routed) { unrouted.push(label); return; }
      if (!validGeometry(feature)) { broken.push(label); return; }
      exportable += 1;
      if (feature.kind === "boundary") hasBoundary = true;
    });
    const errors = [], warnings = [];
    if (!features.length && target !== "grado") errors.push({ code: "empty_project", title: "В проекте нет объектов", detail: "Добавьте объекты перед выпуском файла." });
    if (unrouted.length) errors.push({ code: "unrouted_features", title: "Не найден слой для объектов", detail: "Проверьте, что пользовательские слои проекта не удалены.", feature_ids: unrouted.slice(0, 12), count: unrouted.length });
    if (broken.length) errors.push({ code: "invalid_geometry", title: "Есть повреждённые объекты", detail: "Исправьте геометрию или атрибуты отмеченных объектов.", feature_ids: broken.slice(0, 12), count: broken.length });
    if (duplicateIds.length) warnings.push({ code: "duplicate_ids", title: "Повторяются идентификаторы объектов", detail: "Файл соберётся, но выбор и история изменений могут работать неоднозначно.", feature_ids: duplicateIds.slice(0, 12), count: duplicateIds.length });
    if (["album", "print"].includes(target) && exportable && !hasBoundary) warnings.push({ code: "missing_boundary", title: "Не задана граница территории", detail: "Листы будут собраны по общему охвату объектов; ТЭП и компоновка могут быть неточными." });
    if (exportable > 8000) warnings.push({ code: "large_project", title: "Очень большой проект", detail: "Сборка файла может занять несколько минут." });
    return { target, can_export: !errors.length, errors, warnings,
      summary: { total: features.length, exportable, annotations, blocked: broken.length + unrouted.length } };
  }

  function webProject(payload = {}) {
    return { format: "grado-web", version: 1, name: payload.name || "Проект",
      features: Array.isArray(payload.features) ? payload.features : [],
      userLayers: Array.isArray(payload.layers) ? payload.layers : [],
      projectStyles: payload.projectStyles && typeof payload.projectStyles === "object" ? payload.projectStyles : {},
      projectCustomKinds: Array.isArray(payload.projectCustomKinds) ? payload.projectCustomKinds : [],
      undo_stack: Array.isArray(payload.undo_stack) ? payload.undo_stack : [],
      redo_stack: Array.isArray(payload.redo_stack) ? payload.redo_stack : [],
      studioState: payload.studioState && typeof payload.studioState === "object" ? payload.studioState : {} };
  }

  // Client-side source imports used by the GitHub Pages edition.  GeoJSON is
  // WGS84 by specification; НСПД browser captures use Web Mercator (3857).
  // Keeping the projection here lets the regular canvas/import pipeline stay
  // identical to the desktop edition instead of maintaining a second UI.
  const closeRing = ring => {
    const local = ring.map(wgs84ToLocal);
    if (local.length > 1 && local[0][0] === local[local.length - 1][0] &&
        local[0][1] === local[local.length - 1][1]) local.pop();
    return local.length >= 3 ? local : null;
  };
  const geometryParts = geometry => {
    if (!geometry || typeof geometry !== "object") return [];
    const coordinates = geometry.coordinates;
    if (geometry.type === "Point") return [{ point: wgs84ToLocal(coordinates) }];
    if (geometry.type === "MultiPoint")
      return Array.isArray(coordinates) ? coordinates.map(point => ({ point: wgs84ToLocal(point) })) : [];
    if (geometry.type === "LineString")
      return Array.isArray(coordinates) && coordinates.length >= 2
        ? [{ line: coordinates.map(wgs84ToLocal) }] : [];
    if (geometry.type === "MultiLineString")
      return Array.isArray(coordinates) ? coordinates.filter(line => Array.isArray(line) && line.length >= 2)
        .map(line => ({ line: line.map(wgs84ToLocal) })) : [];
    const polygons = geometry.type === "Polygon" ? [coordinates]
      : geometry.type === "MultiPolygon" ? coordinates : [];
    if (!Array.isArray(polygons)) return [];
    return polygons.map(polygon => Array.isArray(polygon) && Array.isArray(polygon[0])
      ? closeRing(polygon[0]) : null).filter(Boolean).map(ring => ({ ring }));
  };
  const stableHash = value => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const snapshot = (source, sourceDoc, features, fingerprint) => ({
    id: `${source}-web-${stableHash(fingerprint)}`,
    source,
    source_doc: sourceDoc || null,
    fetched_at: new Date().toISOString(),
    count: features.length,
    sha8: stableHash(fingerprint),
  });
  const provenance = manifest => ({
    source: manifest.source, snapshot: manifest.id, source_doc: manifest.source_doc,
  });

  // НСПД (и файл-захват, и выгрузка по экстенту) кладёт атрибуты во вложенное
  // поле options — иногда строкой JSON. Разворачиваем в opt_* и убираем исходное.
  const flattenNspdOptions = record => {
    let options = record.options;
    if (typeof options === "string") {
      try { options = JSON.parse(options); } catch (error) { options = null; }
    }
    if (options && typeof options === "object" && !Array.isArray(options))
      Object.entries(options).forEach(([key, value]) => { record[`opt_${key}`] = value; });
    delete record.options;
    return record;
  };
  // Геометрия НСПД приходит в Web Mercator (3857); переводим в WGS84 покоординатно.
  const mercatorGeometryToWgs84 = geometry => ({
    type: geometry.type,
    coordinates: (function transform(value, depth) {
      return depth === 0 ? mercatorToWgs84(value) : value.map(item => transform(item, depth - 1));
    })(geometry.coordinates, geometry.type === "Polygon" ? 2 : 3),
  });

  function importNspd(payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !Array.isArray(payload.features)) throw new Error("Файл НСПД должен быть GeoJSON FeatureCollection");
    if (payload.grado_source && payload.grado_source !== "nspd")
      throw new Error("Выбранный файл не является захватом НСПД");
    const seen = new Set(), normalized = [];
    let duplicates = 0, skipped = 0;
    payload.features.forEach((feature, index) => {
      const geometry = feature && feature.geometry;
      if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) { skipped += 1; return; }
      const signature = stableHash(geometry);
      if (seen.has(signature)) { duplicates += 1; return; }
      seen.add(signature);
      const props = flattenNspdOptions(feature.properties && typeof feature.properties === "object"
        ? { ...feature.properties } : {});
      const key = String(feature.id || props.cad_num || props.opt_cad_num || `geom:${signature}`);
      const wgsGeometry = mercatorGeometryToWgs84(geometry);
      let parts;
      try { parts = geometryParts(wgsGeometry); }
      catch (error) { skipped += 1; return; }
      parts.forEach((part, partIndex) => normalized.push({
        kind: "parcel", layer_id: "source.nspd.parcels", ring: part.ring,
        props: Object.fromEntries(Object.entries({
          cad_num: props.opt_cad_num || props.cad_num || key,
          category: props.opt_land_record_category_type,
          vri: props.opt_permitted_use_established_by_document,
        }).filter(([, value]) => value !== null && value !== undefined && value !== "")),
        srcKey: `source.nspd.parcels:${key}#${partIndex}`,
      }));
    });
    const manifest = snapshot("nspd", payload.grado_doc || "НСПД, файл браузерного захвата",
      normalized, payload);
    const prov = provenance(manifest);
    normalized.forEach(feature => { feature.prov = { ...prov }; });
    const notes = [];
    if (duplicates) notes.push(`дубликатов по геометрии отброшено: ${duplicates}`);
    if (skipped) notes.push(`неполигональных или повреждённых объектов пропущено: ${skipped}`);
    return { features: normalized, notes, source_doc: manifest.source_doc,
      snapshot: manifest, diff: null };
  }

  const GISOGD_LAYER_RULES = [
    [["функционал", "funkcional"], "zone", "source.gisogd.func_zones"],
    [["красн", "krasn"], "redline", "source.gisogd.red_lines"],
  ];
  const GISOGD_STYLE_RULES = [
    [["1а пояса", "зона_1а", "zona_1a", "sanokhr_1a"], "lgr.sanokhr.1a"],
    [["1б пояса", "зона_1б", "zona_1b", "sanokhr_1b"], "lgr.sanokhr.1b"],
    [["жестк", "zhestk"], "lgr.sanokhr.2hard"],
    [["1 пояса санитар", "зона_1_пояса", "zona_1_poyasa"], "lgr.sanokhr.1"],
    [["2 пояса санитар", "зона_2_пояса", "zona_2_poyasa"], "lgr.sanokhr.2"],
    [["3 пояса санитар", "зона_3_пояса", "zona_3_poyasa"], "lgr.sanokhr.3"],
    [["водоохран", "vodoohran"], "lgr.vodookhr"],
    [["прибрежн", "pribrezh"], "lgr.pribrezh"],
    [["сзз_расчет", "szz_raschet", "расчетн"], "lgr.szz.calc"],
    [["сзз_ориент", "szz_orient", "ориентировоч"], "lgr.szz.orient"],
    [["санитарно-защит", "sanitarno_zash", "сзз"], "lgr.szz.set"],
    [["подтоплен", "podtoplen"], "lgr.podtop.mid"],
    [["затоплен", "zatoplen"], "lgr.zatop"],
    [["защитная зона окн", "zashitnaya_zona_okn"], "lgr.okn.zashchit"],
    [["охранная зона окн", "ohrannaya_zona_okn"], "lgr.okn.okhr"],
    [["регулирования застройки", "regulirovaniya"], "lgr.okn.reg"],
    [["охраняемого природного ландшафта", "landshaft"], "lgr.okn.landshaft"],
    [["территория окн", "ter_okn", "territoriya_okn"], "lgr.okn.terr"],
    [["охранная зона оопт", "ohrannaya_zona_oopt"], "lgr.oopt.okhr"],
    [["оопт", "oopt"], "lgr.oopt"],
    [["лесопарков", "lesopark"], "lgr.lesopark"],
    [["электроэнерг", "лэп", "elektroenerg"], "lgr.energo"],
    [["трубопровод", "truboprovod"], "lgr.truboprovod"],
    [["теплосет", "teplosetey"], "lgr.teplo"],
    [["связи", "svyazi"], "lgr.svyaz"],
    [["метрополит", "metro"], "lgr.metro"],
    [["железных дорог", "пожд", "zhd_"], "lgr.zhd"],
    [["приаэродром", "priaerodrom"], "lgr.priaero"],
    [["береговая полоса", "beregovaya"], "lgr.beregovaya"],
    [["военного объекта", "military"], "lgr.military"],
    [["радиотехническ", "radio"], "lgr.radio"],
    [["технич", "инженерных коммуникаций", "tehnicheskaya_zona"], "lgr.tech.zone"],
  ];
  const GISOGD_RESTRICT_HINTS = ["зоуит", "zouit", "охран", "ohran", "sanit", "санит"];
  const gisogdRoute = member => {
    const lower = member.toLowerCase();
    for (const [keys, kind, layerId] of GISOGD_LAYER_RULES)
      if (keys.some(key => lower.includes(key))) return [kind, layerId];
    if (GISOGD_RESTRICT_HINTS.some(key => lower.includes(key)) ||
        GISOGD_STYLE_RULES.some(([keys]) => keys.some(key => lower.includes(key))))
      return ["restrict", "source.gisogd.restrict"];
    return ["generic", "source.gisogd.other"];
  };
  const gisogdStyle = member => {
    const lower = member.toLowerCase();
    const rule = GISOGD_STYLE_RULES.find(([keys]) => keys.some(key => lower.includes(key)));
    return rule ? rule[1] : null;
  };
  const safeStem = filename => String(filename || "layer").split(/[\\/]/).pop()
    .replace(/\.(geojson|json)$/i, "").replace(/[/:*?"<>|]/g, "").trim() || "layer";

  function importGeoJson(payload = {}, filename = "layer.geojson") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Файл не содержит объект GeoJSON");
    const inputFeatures = payload.type === "FeatureCollection" ? payload.features
      : payload.type === "Feature" ? [payload] : null;
    if (!Array.isArray(inputFeatures)) throw new Error("Нужен GeoJSON FeatureCollection");
    const member = safeStem(filename), [kind, layerId] = gisogdRoute(member);
    const fields = {}, features = [], notes = [];
    let skipped = 0, geometryError = null;
    inputFeatures.forEach((feature, index) => {
      const rawProps = feature && feature.properties && typeof feature.properties === "object"
        ? feature.properties : {};
      const props = Object.fromEntries(Object.entries(rawProps)
        .filter(([, value]) => value !== null && value !== ""));
      let parts;
      try { parts = geometryParts(feature && feature.geometry); }
      catch (error) { skipped += 1; geometryError = error; return; }
      if (!parts.length) { skipped += 1; return; }
      const sourceKey = `${member}:${feature.id ?? index}`;
      const name = props.NAME || props.name;
      const fieldList = Object.keys(props).map(key => ({ name: key, type: "text" }));
      parts.forEach((part, partIndex) => {
        let output;
        if (kind === "redline" && part.line) {
          output = { kind, layer_id: layerId, line: part.line,
            props: { status: "существующая", ...props } };
        } else if ((kind === "zone" || kind === "restrict") && part.ring) {
          output = { kind, layer_id: layerId, ring: part.ring,
            props: kind === "zone" ? { zone_title: name || "ГИС ОГД", ...props }
              : { kind: name || "ЗОУИТ", basis: "ГИС ОГД", ...props } };
          const styleId = gisogdStyle(member);
          if (styleId) output.style_id = styleId;
        } else {
          output = { kind: "generic", layer_id: "source.gisogd.other", ...part, props: { ...props } };
        }
        output.srcKey = `${output.layer_id}:${sourceKey}#${partIndex}`;
        features.push(output);
        if (!fields[output.layer_id]) fields[output.layer_id] = [];
        const taken = new Set(fields[output.layer_id].map(field => field.name));
        fieldList.forEach(field => {
          if (!taken.has(field.name)) { fields[output.layer_id].push(field); taken.add(field.name); }
        });
      });
    });
    if (!features.length && geometryError) throw geometryError;
    if (kind === "generic") notes.push(`«${member}»: тип не распознан — добавлен в слой «прочие»`);
    if (skipped) notes.push(`неподдерживаемых или повреждённых объектов пропущено: ${skipped}`);
    const sourceDoc = `ГИС ОГД / GeoJSON, файл ${filename}`;
    const manifest = snapshot("gisogd", sourceDoc, features, { filename, payload });
    const prov = provenance(manifest);
    features.forEach(feature => { feature.prov = { ...prov }; });
    return { features, notes, fields, source_doc: sourceDoc, snapshot: manifest, diff: null };
  }

  // Static Pages edition: direct extent imports. Public OSM Overpass and
  // NSPD endpoints allow browser CORS requests, so the web app can offer the
  // same visible-area workflow without an unsafe third-party proxy.
  const EXTENT_SPECS = {
    "osm.roads": { title: "Дороги и улицы", layer_id: "source.osm.roads", kind: "generic", set: "roads" },
    "osm.buildings": { title: "Здания (OSM)", layer_id: "source.osm.buildings", kind: "building", set: "buildings" },
    "osm.landuse": { title: "Землепользование", layer_id: "source.osm.landuse", kind: "generic", set: "landuse" },
    "osm.water": { title: "Вода", layer_id: "source.osm.water", kind: "generic", set: "water" },
    "osm.boundaries": { title: "Административные границы", layer_id: "source.osm.boundaries", kind: "generic", set: "boundaries" },
    "nspd.parcels": { title: "Участки ЕГРН", layer_id: "source.nspd.parcels", kind: "parcel", categories: [36368] },
    "nspd.buildings": { title: "Здания (ЕГРН)", layer_id: "source.nspd.buildings", kind: "building", categories: [36369] },
    "nspd.constructions": { title: "Сооружения (ЕГРН)", layer_id: "source.nspd.constructions", kind: "generic", categories: [36383] },
    "nspd.zouit": { title: "ЗОУИТ", layer_id: "source.nspd.zouit", kind: "restrict", categories: [469038, 469039, 469040, 469041, 469042] },
  };
  const OSM_SELECTORS = {
    roads: ['way["highway"]'],
    buildings: ['way["building"]'],
    landuse: ['way["landuse"]', 'way["leisure"~"^(park|garden|pitch|playground)$"]',
      'way["natural"~"^(wood|scrub|grassland|heath)$"]', 'relation["landuse"]',
      'relation["leisure"~"^(park|garden|pitch|playground)$"]',
      'relation["natural"~"^(wood|scrub|grassland|heath)$"]'],
    water: ['way["natural"="water"]', 'way["water"]',
      'way["waterway"~"^(riverbank|dock|canal)$"]', 'relation["natural"="water"]',
      'relation["water"]', 'relation["waterway"="riverbank"]'],
    boundaries: ['relation["boundary"="administrative"]["admin_level"~"^(6|8)$"]'],
  };
  const OSM_RING_SETS = new Set(["buildings", "landuse", "water", "boundaries"]);
  const finiteBbox = bbox => Array.isArray(bbox) && bbox.length === 4 &&
    bbox.every(value => Number.isFinite(Number(value))) && Number(bbox[0]) < Number(bbox[2]) &&
    Number(bbox[1]) < Number(bbox[3]) && Number(bbox[0]) >= -180 && Number(bbox[2]) <= 180 &&
    Number(bbox[1]) >= -90 && Number(bbox[3]) <= 90;
  const whichOsmSet = tags => {
    if (tags.boundary === "administrative" && tags.admin_level) return "boundaries";
    if (tags.building) return "buildings";
    if (tags.highway) return "roads";
    if (tags.natural === "water" || tags.water || tags.waterway) return "water";
    if (tags.landuse || tags.leisure || tags.natural) return "landuse";
    return null;
  };
  const assembleOsmRings = segments => {
    const pending = segments.filter(segment => Array.isArray(segment) && segment.length >= 2)
      .map(segment => segment.map(point => [...point]));
    const rings = [];
    while (pending.length) {
      let ring = pending.shift(), changed = true;
      while (ring.length && String(ring[0]) !== String(ring[ring.length - 1]) && changed) {
        changed = false;
        for (let i = 0; i < pending.length; i++) {
          const segment = pending[i], first = String(segment[0]), last = String(segment[segment.length - 1]);
          const ringFirst = String(ring[0]), ringLast = String(ring[ring.length - 1]);
          if (first === ringLast) ring = ring.concat(segment.slice(1));
          else if (last === ringLast) ring = ring.concat(segment.slice(0, -1).reverse());
          else if (last === ringFirst) ring = segment.slice(0, -1).concat(ring);
          else if (first === ringFirst) ring = segment.slice().reverse().slice(0, -1).concat(ring);
          else continue;
          pending.splice(i, 1); changed = true; break;
        }
      }
      if (ring.length >= 4 && String(ring[0]) === String(ring[ring.length - 1])) rings.push(ring);
    }
    return rings;
  };
  const newExtentGroup = source => {
    const spec = EXTENT_SPECS[source];
    return { source, title: spec.title, layer_id: spec.layer_id, kind: spec.kind,
      features: [], fields: [], count: 0 };
  };
  const addFields = (group, props) => {
    const existing = new Set(group.fields.map(field => field.name));
    Object.entries(props).forEach(([name, value]) => {
      if (existing.has(name)) return;
      group.fields.push({ name, type: typeof value === "number" ? "real" : "text" });
      existing.add(name);
    });
  };
  const finishExtentGroup = (group, sourceDoc, fingerprint) => {
    group.count = group.features.length;
    const manifest = snapshot(group.source.split(".")[0], sourceDoc, group.features, fingerprint);
    const prov = provenance(manifest);
    group.features.forEach(feature => { feature.prov = { ...prov }; });
    return { groups: [group], notes: [], snapshots: [manifest] };
  };

  function buildOsmExtentRequest(bbox, sources = []) {
    if (!finiteBbox(bbox)) throw new Error("Некорректная видимая область");
    const sets = [...new Set(sources.map(source => EXTENT_SPECS[source]?.set).filter(Boolean))];
    if (!sets.length) throw new Error("Не выбраны источники OSM");
    const [west, south, east, north] = bbox.map(Number);
    const bb = `(${south},${west},${north},${east})`;
    const clauses = sets.flatMap(set => OSM_SELECTORS[set].map(selector => selector + bb));
    return `[out:json][timeout:25];(${clauses.join(";")};);out geom;`;
  }

  function importOsmExtent(payload = {}, sources = [], bbox = []) {
    if (!payload || !Array.isArray(payload.elements)) throw new Error("Overpass вернул некорректный ответ");
    const selected = new Set(sources.filter(source => EXTENT_SPECS[source]?.set));
    const groups = Object.fromEntries([...selected].map(source => [source, newExtentGroup(source)]));
    let skipped = 0;
    for (const element of payload.elements) {
      if (!element || !["way", "relation"].includes(element.type)) continue;
      const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
      const set = whichOsmSet(tags);
      const source = [...selected].find(key => EXTENT_SPECS[key].set === set);
      if (!source) continue;
      const group = groups[source], spec = EXTENT_SPECS[source];
      const props = Object.fromEntries(Object.entries(tags).filter(([key, value]) =>
        ["name", "highway", "building", "building:levels", "landuse", "leisure", "natural",
          "water", "waterway", "surface", "lanes", "admin_level"].includes(key) && value != null));
      let geometries = [];
      if (element.type === "way" && Array.isArray(element.geometry)) {
        const points = element.geometry.map(point => [point.lon, point.lat]);
        if (OSM_RING_SETS.has(set)) {
          if (points.length >= 4 && String(points[0]) === String(points[points.length - 1]))
            geometries = [{ type: "Polygon", coordinates: [points] }];
          else skipped += 1;
        } else if (points.length >= 2) geometries = [{ type: "LineString", coordinates: points }];
      } else if (element.type === "relation" && OSM_RING_SETS.has(set)) {
        const segments = (element.members || []).filter(member => member.type === "way" &&
          ["outer", "", undefined, null].includes(member.role) && Array.isArray(member.geometry))
          .map(member => member.geometry.map(point => [point.lon, point.lat]));
        const rings = assembleOsmRings(segments);
        if (rings.length) geometries = [{ type: "MultiPolygon", coordinates: rings.map(ring => [ring]) }];
        else skipped += 1;
      }
      geometries.flatMap(geometryParts).forEach((part, index) => {
        const feature = { kind: spec.kind, layer_id: spec.layer_id, ...part, props: { ...props },
          srcKey: `${spec.layer_id}:${element.type}/${element.id}#${index}` };
        if (source === "osm.buildings") {
          feature.props.purpose = tags.building === "yes" ? "здание" : tags.building;
          const floors = Number.parseInt(tags["building:levels"], 10);
          if (Number.isFinite(floors)) feature.props.floors = floors;
        }
        group.features.push(feature); addFields(group, feature.props);
      });
    }
    const allFeatures = Object.values(groups).flatMap(group => group.features);
    const manifest = snapshot("osm", "OpenStreetMap (Overpass API), выгрузка по экстенту",
      allFeatures, { bbox, sources, keys: allFeatures.map(feature => feature.srcKey) });
    const prov = provenance(manifest);
    Object.values(groups).forEach(group => {
      group.count = group.features.length;
      group.features.forEach(feature => { feature.prov = { ...prov }; });
    });
    return { groups: Object.values(groups), notes: skipped ? [`пропущено вырожденных геометрий: ${skipped}`] : [],
      snapshots: [manifest] };
  }

  function buildNspdExtentRequest(bbox, source) {
    if (!finiteBbox(bbox)) throw new Error("Некорректная видимая область");
    const spec = EXTENT_SPECS[source];
    if (!spec || !spec.categories) throw new Error("Неизвестный источник НСПД");
    const [west, south, east, north] = bbox.map(Number);
    const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]].map(wgs84ToMercator);
    return { geom: { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
      geometry: { crs: { type: "name", properties: { name: "EPSG:3857" } },
        type: "Polygon", coordinates: [ring] } }] },
      categories: spec.categories.map(id => ({ id })) };
  }

  function importNspdExtent(payload = {}, source, bbox = []) {
    const spec = EXTENT_SPECS[source];
    if (!spec || !spec.categories || !Array.isArray(payload.features))
      throw new Error("НСПД вернула некорректный ответ");
    const group = newExtentGroup(source);
    let skipped = 0;
    payload.features.forEach((item, itemIndex) => {
      const geometry = item && item.geometry;
      if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) { skipped += 1; return; }
      const raw = flattenNspdOptions(item.properties && typeof item.properties === "object" ? { ...item.properties } : {});
      const props = source === "nspd.parcels" ? {
        cad_num: raw.opt_cad_num || raw.cad_num || raw.label,
        category: raw.opt_land_record_category_type,
        vri: raw.opt_permitted_use_established_by_document,
        address: raw.opt_readable_address,
      } : source === "nspd.buildings" ? {
        purpose: raw.opt_building_name || raw.opt_purpose || "здание",
        floors: Number.parseInt(raw.opt_floors, 10) || undefined,
        cad_num: raw.opt_cad_num,
        address: raw.opt_readable_address,
      } : source === "nspd.constructions" ? {
        name: raw.opt_building_name || raw.label || "сооружение", cad_num: raw.opt_cad_num,
      } : { kind: String(raw.categoryName || "ЗОУИТ").replace(/[_ ]+$/, ""),
        number: raw.label, basis: "НСПД" };
      Object.keys(props).forEach(key => { if (props[key] == null || props[key] === "") delete props[key]; });
      const wgsGeometry = mercatorGeometryToWgs84(geometry);
      let parts = [];
      try { parts = geometryParts(wgsGeometry); } catch (error) { skipped += 1; return; }
      const key = item.id ?? raw.opt_cad_num ?? raw.label ?? itemIndex;
      parts.forEach((part, partIndex) => group.features.push({ kind: spec.kind, layer_id: spec.layer_id,
        ...part, props: { ...props }, srcKey: `${spec.layer_id}:${key}#${partIndex}` }));
      addFields(group, props);
    });
    const result = finishExtentGroup(group, "НСПД (nspd.gov.ru), выгрузка по экстенту",
      { bbox, source, keys: group.features.map(feature => feature.srcKey) });
    if (skipped) result.notes.push(`повреждённых объектов НСПД пропущено: ${skipped}`);
    return result;
  }

  // ---- ГИС ОГД Москвы по видимой области (портал отдаёт CORS: браузеру можно) --
  // Портал ИГНОРИРУЕТ bbox — слой всегда приходит целиком (функц. зоны Москвы
  // ≈14 МБ gzip). Поэтому слой качается один раз, кладётся в кэш (IndexedDB на
  // стороне адаптера), а по области режем сами. Маршрут и знак — по имени слоя
  // (те же GISOGD_LAYER_RULES, что у ручного импорта GeoJSON).
  const GISOGD_BASE = "https://gisogd.mos.ru/gis/api/2.8/gisogd/isogd";
  const gisogdCatalogUrl = () => `${GISOGD_BASE}/layers/`;
  const gisogdLayerUrl = code => `${GISOGD_BASE}/layers/${encodeURIComponent(code)}/export/?format=geojson`;

  function buildGisogdCatalog(raw) {
    if (!Array.isArray(raw)) throw new Error("ГИС ОГД вернул некорректный каталог");
    const byId = new Map(raw.map(x => [x.id, x]));
    const path = x => {
      const parts = []; let cur = x, guard = 0;
      while (cur && guard < 8) { parts.unshift(cur.name || ""); cur = byId.get(cur.parent_id); guard += 1; }
      return parts.filter(Boolean).join(" / ");
    };
    return raw.filter(x => x.type === "layer" && x.code)
      .map(x => ({ code: x.code, name: x.name || x.code, path: path(x) }));
  }

  const geomBbox = geom => {
    const xs = [], ys = [];
    const walk = c => {
      if (!Array.isArray(c) || !c.length) return;
      if (typeof c[0] === "number") { xs.push(c[0]); ys.push(c[1]); return; }
      c.forEach(walk);
    };
    walk((geom || {}).coordinates);
    return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
  };
  const bboxHit = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  const gisogdKey = (props, feature, index) =>
    String(props.orbis_id ?? props.id ?? feature.id ?? index).replace(/\.0$/, "");

  // Кураторские наборы: маршрут задан явно. У слоёв ТиНАО имя — это тип зоны
  // («Жилая зона»), правила по имени его не опознают как функц. зону и увели бы
  // в «прочие», поэтому kind/layer_id проставлены руками (как в настольной версии).
  const _TINAO_FZ = [["virtual1982", "Жилая зона"], ["virtual1981", "Зона объектов внешнего транспорта"],
    ["virtual1980", "Общественная зона"], ["virtual1979", "Общественно-жилая зона"],
    ["virtual1978", "Общественно-производственная зона"], ["virtual1977", "Общественно-производственно-жилая зона"],
    ["virtual1976", "Природная зона"], ["virtual1975", "Природно-жилая зона"],
    ["virtual1971", "Природно-общественная зона"], ["virtual1970", "Природно-общественно-жилая зона"],
    ["virtual1969", "Природно-общественно-производственная зона"], ["virtual1968", "Природно-производственная зона"],
    ["virtual1967", "Производственная зона"], ["virtual1966", "Производственно-жилая зона"],
    ["virtual1965", "Сельскохозяйственная зона"]];
  const _FZ_ROUTE = { kind: "zone", layer_id: "source.gisogd.func_zones" };
  const GISOGD_WEB_LAYERS = {
    "gisogd.func_zones": [{ code: "virtual1742", name: "Функциональные зоны", ..._FZ_ROUTE }],
    "gisogd.func_zones_tinao": _TINAO_FZ.map(([code, name]) => ({ code, name, ..._FZ_ROUTE })),
    "gisogd.szz": [["virtual1743", "СЗЗ установленная"], ["virtual1746", "СЗЗ ориентировочная"],
      ["virtual1745", "СЗЗ расчётная"]].map(([code, name]) =>
      ({ code, name, kind: "restrict", layer_id: "source.gisogd.restrict" })),
    "gisogd.vodookhr": [{ code: "virtual1747", name: "Водоохранная зона",
      kind: "restrict", layer_id: "source.gisogd.restrict" }],
  };

  // layer = {code, name, kind?, layer_id?}; payload — сырой GeoJSON слоя целиком
  function importGisogdExtent(payload = {}, layer = {}, bbox = []) {
    if (!payload || !Array.isArray(payload.features))
      throw new Error(`ГИС ОГД: слой ${layer.code} — не FeatureCollection`);
    const name = layer.name || layer.code || "";
    let kind = layer.kind, layerId = layer.layer_id;
    if (!layerId) [kind, layerId] = gisogdRoute(name);
    if (!layerId) { kind = "generic"; layerId = "source.gisogd.other"; }
    const styleId = gisogdStyle(name);
    const group = { source: `gisogd:${layer.code}`, title: name, layer_id: layerId,
                    kind, features: [], fields: [], count: 0 };
    let skipped = 0;
    payload.features.forEach((f, i) => {
      const fb = geomBbox(f && f.geometry);
      if (!fb || !bboxHit(fb, bbox)) return;
      let parts;
      try { parts = geometryParts(f.geometry); } catch (e) { skipped += 1; return; }
      const props = Object.fromEntries(Object.entries(f.properties || {})
        .filter(([, v]) => v !== null && v !== ""));
      const key = gisogdKey(f.properties || {}, f, i);
      parts.forEach((part, pi) => {
        const out = { kind, layer_id: layerId, ...part, props: { ...props },
                      srcKey: `${layerId}:${layer.code}:${key}#${pi}` };
        if (styleId) out.style_id = styleId;
        group.features.push(out);
        addFields(group, props);
      });
    });
    group.count = group.features.length;
    const manifest = snapshot("gisogd", `ГИС ОГД Москвы (gisogd.mos.ru), слой «${name}»`,
      group.features, { bbox, code: layer.code });
    const prov = provenance(manifest);
    group.features.forEach(f => { f.prov = { ...prov }; });
    return { groups: [group], notes: skipped ? [`пропущено повреждённых: ${skipped}`] : [],
             snapshots: [manifest] };
  }

  return { computeTep, preflightProject, webProject, importNspd, importGeoJson,
    gisogdCatalogUrl, gisogdLayerUrl, buildGisogdCatalog, importGisogdExtent,
    GISOGD_WEB_LAYERS,
    originWgs84: [...ORIGIN_WGS84],
    buildOsmExtentRequest, importOsmExtent, buildNspdExtentRequest, importNspdExtent };
});
