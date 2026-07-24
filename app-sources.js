// ГРАДО Студия · часть 2 из 14 (грузится после app.js).
// транзакционный импорт источников: подготовка, слияние,
// единый commit — частично импортированного проекта не бывает
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- транзакционный импорт источников --------------------------------
// Разбор API/файла не имеет права менять живой проект. Сначала строим план:
// проверяем идентичность слоёв, srcKey, геометрию и поля, присваиваем id во
// временном массиве. Только полностью подготовленный план применяется одним
// commit; при исключении состояние возвращается к исходному снимку.
function importedLayerGeometry(spec) {
  if (["point", "polyline", "polygon", "arc", "circle"].includes(spec.geometry_type))
    return spec.geometry_type;
  if (CODE_TO_GEOM[spec.code]) return CODE_TO_GEOM[spec.code];
  if (spec.kind === "social") return "point";
  if (spec.kind === "redline") return "polyline";
  return "polygon";
}
function importedLayerFromSpec(spec) {
  if (!spec || typeof spec.id !== "string" || !/^[a-z0-9._:-]{3,180}$/i.test(spec.id))
    throw new Error("Импорт содержит некорректный layer_id");
  const geometryType = importedLayerGeometry(spec);
  const L = {
    id: spec.id,
    title: typeof spec.title === "string" && spec.title.trim() ? spec.title.trim() : spec.id,
    kind: spec.kind || "generic",
    semantic_class: spec.code || GENERIC_CODE[geometryType] || "generic.line",
    geometry_type: geometryType,
    style_id: spec.style_id || null,
    stage: spec.stage || "existing",
    source_kind: spec.source_kind || null,
    source_code: spec.source_code || null,
    source_name: spec.source_name || spec.title || null,
    import_only: true,
    visible: true,
    defaults: () => ({}),
  };
  if (["boundary", "restrict", "zone"].includes(L.kind)) L.topology = "coverage";
  return L;
}
function assertCompatibleImportedLayer(existing, incoming) {
  if (!existing) return;
  if (existing.source_kind && incoming.source_kind && existing.source_kind !== incoming.source_kind)
    throw new Error(`Коллизия слоя «${incoming.id}»: разные источники данных`);
  const sameSourceCode = existing.source_code && incoming.source_code &&
    existing.source_code === incoming.source_code;
  if (existing.source_code && incoming.source_code && !sameSourceCode)
    throw new Error(`Коллизия слоя «${incoming.id}»: ${existing.source_code} ≠ ${incoming.source_code}`);
  if (!sameSourceCode && existing.source_name && incoming.source_name &&
      existing.source_name !== incoming.source_name)
    throw new Error(`Коллизия layer_id «${incoming.id}»: «${existing.source_name}» и «${incoming.source_name}»`);
  if (!sameSourceCode && existing.import_only && incoming.import_only && existing.title !== incoming.title)
    throw new Error(`Коллизия layer_id «${incoming.id}»: разные названия слоёв`);
  if (existing.kind && incoming.kind && existing.kind !== incoming.kind)
    throw new Error(`Коллизия слоя «${incoming.id}»: разные назначения слоёв`);
  if (existing.geometry_type && incoming.geometry_type && existing.geometry_type !== incoming.geometry_type)
    throw new Error(`Коллизия слоя «${incoming.id}»: разные типы геометрии`);
}
// Портал отдаёт красную линию НАРЕЗАННОЙ: медиана — 3 точки на объект, один
// проезд превращается в сотни записей. Работать с этим нельзя: выбрать линию,
// посмотреть её длину, обрезать по ней — всё рассыпается на куски, а
// атрибутивная таблица идёт на десятки тысяч строк.
// Склеиваем цепочки: соседние отрезки соединяются, только если у них совпадают
// слой, знак и ВСЕ атрибуты (иначе склеим линии разных документов и режимов).
// Через перекрёсток (в узле сходятся 3+ конца) цепочка не идёт — выбор
// продолжения там произволен, а произвол в чертеже хуже дробности.
// Даты правки записи линию не различают: один и тот же проезд по одному
// документу портал правил в разные дни, и отрезки расходились по группам
// (в тестовой площадке 63 группы вместо 130). Цепочку они не рвут, но и
// выдумывать общую дату нельзя: разошлись — поля у склеенной линии не будет.
const JOIN_SOFT_PROPS = new Set(["createdate", "changedate"]);
// Номер документа тоже НЕ различает линию как объект чертежа. На площадке в
// Медведково 3231 отрезок КЛ УДС: перекрёстков нет вовсе (все узлы степени 2),
// но по номеру документа отрезки расходятся на 246 групп — и красная линия
// одного проезда рассыпается на сотни кусков. Линию склеиваем, а номера
// собираем списком: длинная линия и вправду задана несколькими документами.
const JOIN_LIST_PROPS = new Set(["linerhanum"]);
const JOIN_LIST_MAX = 4;
const JOIN_LIST_EMPTY = new Set(["not_found", "none", "null", "-", "0"]);
const joinNodeKey = p => `${Math.round(p[0] * 1e3)}|${Math.round(p[1] * 1e3)}`;
function joinImportedRuns(features) {
  const runs = new Map();
  const out = [];
  for (const f of features) {
    if (!f.joinable || !Array.isArray(f.line) || f.line.length < 2) { out.push(f); continue; }
    const identity = Object.entries(f.props || {})
      .filter(([k]) => !JOIN_SOFT_PROPS.has(k) && !JOIN_LIST_PROPS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : 1));
    const key = [f.layer_id, f.kind, f.style_id || "", JSON.stringify(identity)].join("\u0000");
    const list = runs.get(key) || runs.set(key, []).get(key);
    list.push(f);
  }
  for (const segments of runs.values()) {
    const ends = new Map();
    for (const s of segments) {
      const a = joinNodeKey(s.line[0]), b = joinNodeKey(s.line[s.line.length - 1]);
      if (a === b) continue;                      // замкнутый контур — цепочка уже целая
      (ends.get(a) || ends.set(a, []).get(a)).push([s, 0]);
      (ends.get(b) || ends.set(b, []).get(b)).push([s, 1]);
    }
    const used = new Set();
    // продолжение есть только в узле РОВНО с двумя концами: один конец — тупик,
    // три и больше — перекрёсток
    const nextAt = node => {
      const list = ends.get(node) || [];
      if (list.length !== 2) return null;
      for (const [s, end] of list) if (!used.has(s)) return [s, end];
      return null;
    };
    for (const seed of segments) {
      if (used.has(seed)) continue;
      used.add(seed);
      let pts = seed.line;
      const members = [seed];
      for (;;) {
        const next = nextAt(joinNodeKey(pts[pts.length - 1]));
        if (!next) break;
        const [s, end] = next; used.add(s); members.push(s);
        pts = pts.concat(end === 0 ? s.line.slice(1) : s.line.slice(0, -1).reverse());
      }
      for (;;) {
        const prev = nextAt(joinNodeKey(pts[0]));
        if (!prev) break;
        const [s, end] = prev; used.add(s); members.push(s);
        pts = (end === 1 ? s.line.slice(0, -1) : s.line.slice(1).reverse()).concat(pts);
      }
      delete seed.joinable;
      if (members.length > 1) {
        seed.line = pts;
        // дата правки у отрезков разная — общей у линии нет, и придумывать её
        // (взять первую попавшуюся) значит соврать в атрибуте
        for (const k of JOIN_SOFT_PROPS)
          if (members.some(m => (m.props || {})[k] !== seed.props[k])) delete seed.props[k];
        // номера документов собираем списком: это не выдумка, а перечисление
        for (const k of JOIN_LIST_PROPS) {
          // у части отрезков портала в поле лежит СПИСОК со своими заглушками
          // («П206,NOT_FOUND,NOT_FOUND») — разбираем его, иначе номера склеенной
          // линии выглядят как мусор
          const values = [...new Set(members.flatMap(m => String((m.props || {})[k] ?? "")
            .split(",").map(v => v.trim())
            .filter(v => v && !JOIN_LIST_EMPTY.has(v.toLowerCase()))))];
          if (!values.length) { delete seed.props[k]; continue; }
          seed.props[k] = values.length <= JOIN_LIST_MAX
            ? values.join(", ")
            : `${values.slice(0, JOIN_LIST_MAX).join(", ")} и ещё ${values.length - JOIN_LIST_MAX}`;
        }
        // ключи ВСЕХ склеенных отрезков остаются на объекте: по ним повторная
        // выгрузка той же территории узнаёт, что эти отрезки уже в проекте
        seed.srcKeys = members.flatMap(m => m.srcKeys || (m.srcKey ? [m.srcKey] : []));
      }
      out.push(seed);
    }
  }
  // порядок объектов в подборке — порядок выдачи источника; склейка его не меняет
  return out.sort((a, b) => a.id - b.id);
}
function normalizeImportFields(fieldsByLayer) {
  const normalized = {};
  for (const [layerId, fields] of Object.entries(fieldsByLayer || {})) {
    if (!Array.isArray(fields)) throw new Error(`Некорректная схема полей слоя «${layerId}»`);
    const seen = new Set();
    normalized[layerId] = [];
    for (const field of fields) {
      if (!field || typeof field.name !== "string" || !field.name.trim()) continue;
      const name = field.name.trim();
      if (seen.has(name)) continue;
      seen.add(name);
      normalized[layerId].push({ ...field, name });
    }
  }
  return normalized;
}
function prepareSourceImport(input = {}) {
  const incomingFeatures = Array.isArray(input.features) ? input.features : [];
  const incomingLayers = Array.isArray(input.layers) ? input.layers : [];
  const stagedLayerById = new Map();
  for (const raw of incomingLayers) {
    const layer = importedLayerFromSpec(raw);
    const duplicate = stagedLayerById.get(layer.id);
    if (duplicate) {
      assertCompatibleImportedLayer(duplicate, layer);
      continue;
    }
    assertCompatibleImportedLayer(LAYER_BY_ID[layer.id], layer);
    stagedLayerById.set(layer.id, layer);
  }
  // Встроенный приёмник данных («Здания (ЕГРН)», «Дороги OSM» и прочие) можно
  // удалить из панели слоёв — он такой же слой. После этого источник становился
  // непригоден НАВСЕГДА: следующая выгрузка падала с «Схема полей ссылается на
  // неизвестный слой». Приёмник — часть модели, а не пользовательский слой,
  // поэтому заводим его заново по встроенной спецификации и продолжаем.
  const reviveBuiltinLayer = layerId => {
    const spec = _BUILTIN_LAYER_SPECS.find(item => item.id === layerId);
    if (!spec) return null;
    const layer = cloneLayerSpec(spec);
    layer.visible = true;
    stagedLayerById.set(layerId, layer);
    return layer;
  };
  const fieldsByLayer = normalizeImportFields(input.fieldsByLayer || input.fields);
  for (const layerId of Object.keys(fieldsByLayer))
    if (!LAYER_BY_ID[layerId] && !stagedLayerById.has(layerId) && !reviveBuiltinLayer(layerId))
      throw new Error(`Схема полей ссылается на неизвестный слой «${layerId}»`);

  const existingKeys = new Set();
  // у склеенной линии ключи всех её отрезков — иначе повторная выгрузка той же
  // территории посчитала бы их новыми и положила поверх
  for (const feature of state.features) {
    if (feature.srcKey) existingKeys.add(feature.srcKey);
    for (const key of feature.srcKeys || []) existingKeys.add(key);
  }
  const batchKeys = new Set();
  const stagedFeatures = [];
  const addedByLayer = Object.create(null);
  const touchedLayerIds = new Set(Object.keys(fieldsByLayer));
  let nextId = state.nextId, dup = 0, invalid = 0;
  const invalidDetails = [];
  const resolveImportLayer = feature => {
    if (feature.layer_id)
      return stagedLayerById.get(feature.layer_id) || LAYER_BY_ID[feature.layer_id]
        || reviveBuiltinLayer(feature.layer_id) || null;
    return LAYER_BY_KIND[feature.kind] || null;
  };
  for (const raw of incomingFeatures) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalid++; invalidDetails.push("объект не является записью"); continue;
    }
    if (raw.srcKey && (existingKeys.has(raw.srcKey) || batchKeys.has(raw.srcKey))) {
      dup++;
      continue;
    }
    const targetLayer = resolveImportLayer(raw);
    if (!targetLayer)
      throw new Error(`Объект импорта ссылается на неизвестный слой «${raw.layer_id || raw.kind || "—"}»`);
    let upgraded;
    try {
      upgraded = upgradeFeature({ id: nextId, ...raw }, resolveImportLayer);
    } catch (error) {
      invalid++;
      if (invalidDetails.length < 5) invalidDetails.push(error.message || String(error));
      continue;
    }
    if (targetLayer.geometry_type && upgraded.geometry_type !== targetLayer.geometry_type)
      throw new Error(`Слой «${targetLayer.title}» ожидает ${targetLayer.geometry_type}, получено ${upgraded.geometry_type}`);
    if (upgraded.srcKey) batchKeys.add(upgraded.srcKey);
    touchedLayerIds.add(targetLayer.id);
    stagedFeatures.push(upgraded);
    nextId++;
  }
  const joined = joinImportedRuns(stagedFeatures);
  const segments = stagedFeatures.length;
  stagedFeatures.length = 0;
  stagedFeatures.push(...joined);
  for (const feature of stagedFeatures) {
    const layer = resolveImportLayer(feature);
    if (layer) addedByLayer[layer.id] = (addedByLayer[layer.id] || 0) + 1;
  }
  const newLayers = [...stagedLayerById.values()].filter(layer => !LAYER_BY_ID[layer.id]);
  return {
    baseFeatures: state.features,
    baseFeatureCount: state.features.length,
    baseNextId: state.nextId,
    baseLayerIds: LAYERS_V2.map(layer => layer.id).join("\u0000"),
    features: stagedFeatures,
    nextId,
    newLayers,
    addedByLayer,
    fieldsByLayer,
    touchedLayerIds,
    snapshots: Array.isArray(input.snapshots) ? input.snapshots : [],
    added: stagedFeatures.length,
    joinedFrom: segments > stagedFeatures.length ? segments : 0,
    dup,
    invalid,
    invalidDetails,
  };
}
function commitPreparedSourceImport(plan) {
  if (!plan || state.features !== plan.baseFeatures || state.features.length !== plan.baseFeatureCount ||
      state.nextId !== plan.baseNextId || LAYERS_V2.map(layer => layer.id).join("\u0000") !== plan.baseLayerIds)
    throw new Error("Проект изменился во время подготовки импорта — повторите операцию");

  const featureLength = state.features.length;
  const layerLength = LAYERS_V2.length;
  const nextId = state.nextId;
  const sources = state.sources.slice();
  const undo = state.undo.slice();
  const redo = state.redo.slice();
  const selected = state.selected;
  const layerBackups = new Map();
  for (const layerId of plan.touchedLayerIds) {
    const layer = LAYER_BY_ID[layerId];
    if (layer) layerBackups.set(layerId, {
      visible: layer.visible, fields: layer.fields ? JSON.parse(JSON.stringify(layer.fields)) : undefined,
      fmt: layer.fmt ? JSON.parse(JSON.stringify(layer.fmt)) : undefined,
      fmtInit: layer._fmtInit,
    });
  }
  snapshot();
  try {
    for (const layer of plan.newLayers) {
      LAYERS_V2.push(layer);
      LAYER_BY_ID[layer.id] = layer;
    }
    state.features.push(...plan.features);
    state.nextId = plan.nextId;
    for (const [layerId, fields] of Object.entries(plan.fieldsByLayer)) {
      const layer = LAYER_BY_ID[layerId];
      if (!layer) throw new Error(`Не удалось зарегистрировать слой «${layerId}»`);
      layer.fields = layer.fields || [];
      const taken = new Set(layer.fields.map(field => field.name));
      for (const field of fields)
        if (!taken.has(field.name)) { layer.fields.push(field); taken.add(field.name); }
    }
    for (const layerId of plan.touchedLayerIds) {
      const layer = LAYER_BY_ID[layerId];
      if (!layer) throw new Error(`Не удалось применить слой «${layerId}»`);
      layer.visible = true;
      if ((layerId.startsWith("source.gisogd.") || layerId.startsWith("source.fgistp.")) && !layer._fmtInit) {
        layer._fmtInit = true;
        layer.fmt = { hatch: false, line_label: null, ...(layer.fmt || {}) };
      }
    }
    for (const entry of plan.snapshots)
      recordSource(entry && entry.snapshot !== undefined ? entry.snapshot : entry,
        entry && entry.diff, { defer: true });
    state.selected = null;
    renderSources();
    afterChange();
    // первая геоданная в проекте с СК «авто» выбирает местную систему
    // территории (guard: vm-вырезки тестов зовут commit без окружения)
    if (typeof resolveAutoProjectCrs === "function") resolveAutoProjectCrs();
    return { added: plan.added, dup: plan.dup, invalid: plan.invalid, joinedFrom: plan.joinedFrom || 0 };
  } catch (error) {
    state.features.length = featureLength;
    state.nextId = nextId;
    LAYERS_V2.length = layerLength;
    rebuildLayerIndexes();
    for (const [layerId, backup] of layerBackups) {
      const layer = LAYER_BY_ID[layerId];
      if (!layer) continue;
      layer.visible = backup.visible;
      if (backup.fields === undefined) delete layer.fields; else layer.fields = backup.fields;
      if (backup.fmt === undefined) delete layer.fmt; else layer.fmt = backup.fmt;
      if (backup.fmtInit === undefined) delete layer._fmtInit; else layer._fmtInit = backup.fmtInit;
    }
    state.sources = sources;
    state.undo.length = 0;
    state.undo.push(...undo);
    state.redo = redo;
    state.selected = selected;
    state._ix = null; state._snapIndex = null;
    syncHistoryControls();
    renderSources(); renderLayers(); renderProps(); draw();
    throw error;
  }
}

const DEFAULT_ALBUM_CONFIG = {
  sheets: ["title", "location", "base", "apo", "tep"],
  title: { org: "ГРАДО", city_year: "Москва / 2026" },
};

const state = {
  features: [], tool: "select", selected: null, selectedIds: new Set(),
  drawing: null, drag: null, pan: null, edit: null, measure: null,
  snapHit: null, guides: [], typed: "", mouse: null,
  view: { k: 1.1, tx: 120, ty: 0 },
  // Читаемые знаки ЛГР — настройка ЭКРАНА (не проекта), см. groundFactor.
  // По умолчанию ВКЛЮЧЕНО (решение юзера): по эталону засечка на рабочих
  // 1:4000+ ~3 px, чертить неудобно. Печать этим режимом не затрагивается —
  // лист всегда по эталону (Style.for_scale про режим не знает).
  // null (настройку не трогали) → дефолт ВКЛ; "0" → осознанно выключено.
  lgrReadable: (() => {
    try {
      const v = localStorage.getItem("grado_lgr_readable");
      return v === null ? true : v === "1";
    } catch (_) { return true; }
  })(),
  undo: [], redo: [], nextId: 1,
  trimCtx: null,                  // { boundary: Set(id), ready: bool } — режимы «Обрезать»/«Продлить»
  xf: null,                       // { kind:'rotate'|'scale'|'mirror', phase:'base'|'act', pivot, orig, ref, val, p2 } — интерактивные преобразования
  hoverLayerId: null,             // ховер строки в панели «Слои» — подсветка объектов на холсте
  gridShow: true, gridSnap: true, osnap: true, gridMode: "auto",
  // Совместная правка общих границ (см. isCoverageFeature). По умолчанию
  // ВЫКЛЮЧЕНА: пока её не ждут, перемещение зоны утаскивает соседнюю за
  // совпадающие вершины, и это читается как поломка, а не как помощь.
  topoEdit: false,
  accessRadii: { on: false, r: 300 },        // радиусы доступности соцобъектов (визуальная помощь)
  layers: LAYER_BY_ID, styles: STYLES_V2,   // модель v2 (видимость — layer.visible)
  activeLayerId: null,            // куда чертят геом-инструменты (L2b: пусто до создания слоя)
  sources: [],                    // журнал источников (снимки НСПД/ФГИС ТП)
  styleOverrides: {},             // правки эталонных знаков (глобальные, с сервера)
  variants: [],                   // варианты концепции: снимки {id,name,features,params,createdAt}
  projectStyles: {},              // свои стили проекта: { "my_id": {fill, stroke, width, ... , title? } }
  projectCustomKinds: [],         // пользовательские роли/типы слоёв для этого проекта
  albumConfig: JSON.parse(JSON.stringify(DEFAULT_ALBUM_CONFIG)),
  sheetLegend: null,              // группы легенды листа: { groups: [{title, layers:[id]}] }
  projectCrsId: "auto",           // местная СК проекта; auto — подобрать по территории
  alignOgd: true,                 // сажать выгрузки ГИС ОГД на границы участков ЕГРН
  _fitted: false, _ix: null,
};

function isHidden(f) { const L = layerOf(f); return L ? !L.visible : false; }
function isLocked(f) { const L = layerOf(f); return !!L && !!L.locked; }

let shiftDown = false, spaceDown = false;

