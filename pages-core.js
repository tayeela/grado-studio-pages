/* Pure computation and project validation for the static browser edition.
   Kept separate from the fetch adapter so the same fixtures can verify the
   browser and desktop engines without a DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GRADO_PAGES_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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
    const density = bounded(params.density, 0, 1000, 25);
    const ratioZh = bounded(params.ratio_zh, 0, 100, 80);
    const percentVpp = bounded(params.percent_vpp, 0, 100, 6);
    const educationZone = number(params.education_zone, 1) === 2 ? 2 : 1;
    const territoryMode = number(params.territory_mode, 1) === 2 ? 2 : 1;
    const kRail = bounded(params.k_rail, 0, 10, 1);
    const kBa = bounded(params.k_ba, 0, 10, 0.5);
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

  return { computeTep, preflightProject, webProject };
});
