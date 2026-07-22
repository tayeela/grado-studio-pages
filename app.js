// ГРАДО Студия — холст черчения. Мир: метры, ось Y вверх.

let VERSION = "—";
let STATE_SCHEMA_VERSION = 1;
fetch("/version.json").then(r => r.ok ? r.json() : null).then(info => {
  if (!info) return;
  VERSION = info.version || VERSION;
  STATE_SCHEMA_VERSION = info.state_schema_version || STATE_SCHEMA_VERSION;
  const logo = document.getElementById("logo");
  if (logo) logo.title = `ГРАДО Студия · v${VERSION}`;
}).catch(() => {});

// Ошибка не должна превращаться в техническую красную полосу от края до края.
// Показываем человеку короткий план восстановления, а технические детали
// оставляем только в console для диагностики и отчёта об ошибке.
function reportUiError(error, context = "Ошибка интерфейса") {
  console.error(context, error);
  const el = document.getElementById("errbar");
  if (!el) return;
  const message = document.createElement("span");
  message.textContent = `${context}. Повторите действие; если ошибка повторится — сохраните проект и перезагрузите страницу.`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "errbar-close";
  close.setAttribute("aria-label", "Закрыть сообщение об ошибке");
  close.textContent = "×";
  close.onclick = () => { el.hidden = true; el.style.display = "none"; };
  el.replaceChildren(message, close);
  el.dataset.errorVersion = VERSION;
  el.hidden = false;
  el.style.display = "flex";
}
window.addEventListener("error", event => {
  if (/ResizeObserver loop/.test(event.message || "")) return;
  reportUiError(event.error || event.message);
});
window.addEventListener("unhandledrejection", event => {
  reportUiError(event.reason, "Не удалось завершить действие");
});

function on(id, event, fn) {
  const el = document.getElementById(id);
  if (!el) { console.warn("нет элемента #" + id); return; }
  el.addEventListener(event, fn);
}

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

// Цвет отрисовки холста из палитры темы (canvas-theme.js). Fallback — если
// tokens/canvas-theme не загрузились (оффлайн-надёжность): прежние значения.
function cvColor(key, fallback) {
  const v = (window.CANVAS_THEME || {})[key];
  return v || fallback;
}

// ---------- модель v2: слои и стили (docs/fixes-geometry-layout.md, шаг 1) ----------
// Стиль — данные (JSON-совместимые): подпись задаётся именем поля, не функцией.
const STYLES_V2 = {
  "func_zone.fill":     { fill: "#faf0bf", stroke: "#b89e59", width: 1,   label_field: "zone_title" },
  "public_zone.fill":   { fill: "#f7c2c9", stroke: "#bf596b", width: 1.2, label_field: "purpose" },
  "restrict.hatch":     { fill: "rgba(245,219,219,.85)", stroke: "#bf5959", width: 1.2, dash: [8, 4], hatch: true },
  "parcel.line":        { stroke: "#8a7a5c", width: 0.8, label_field: "cad_num" },
  "building.fill":      { fill: "#f5c76b", stroke: "#8c6626", width: 1,   label_field: "floors" },
  "red.line.projected": { stroke: "#d91a1a", width: 2.5 },
  "boundary.line":      { stroke: "#1c1c1a", width: 2.5, dash: [14, 5, 4, 5] },
  "social.point":       { fill: "#2f6fde", stroke: "#1d4a9e", width: 1.2 },
  "dimension.line":     { stroke: "#44423c", width: 1 },
};

// Слой — главный объект управления (MODEL-01): id (идентичность) отделён
// от semantic_class (класс классификатора). Порядок массива = порядок
// отрисовки (первый — самый нижний). kind — транспорт схемы атрибутов до
// полного снятия. import_only — слой не выбирается инструментами и не
// перехватывает kind (объекты попадают в него только импортом по layer_id).
//
// L2b «пустой старт»: предустановленных РИСУЕМЫХ слоёв больше нет — новый
// проект открывается с пустой панелью слоёв, пользователь заводит слои сам
// (кнопка «+», геометрия-first). Здесь остаются только инфраструктурные
// слои, невидимые в панели пока пусты: приёмники импорта (import_only,
// бэкенд назначает их layer_id) и аннотационный слой размеров.
const LAYERS_V2 = [
  { id: "source.fgistp.func_zones", title: "ФГИС ТП: функц. зоны", kind: "zone",
    semantic_class: "tp.func_zone", geometry_type: "polygon",
    style_id: "func_zone.fill", stage: "existing", source_kind: "fgistp",
    import_only: true, defaults: () => ({}) },
  { id: "source.nspd.parcels", title: "Земельный участок (ЕГРН)", kind: "parcel",
    semantic_class: "cad.parcel", geometry_type: "polygon",
    style_id: "parcel.line", stage: "existing", source_kind: "nspd",
    import_only: true,
    // выгрузка по области даёт сотни участков — подписи кадномеров по
    // умолчанию выключены (каша на холсте); включаются «Оформлением слоя»
    fmt: { label_field: null },
    defaults: () => ({}) },
  { id: "source.gisogd.func_zones", title: "ГИС ОГД: функц. зоны", kind: "zone",
    semantic_class: "tp.func_zone", geometry_type: "polygon",
    style_id: "func_zone.fill", stage: "existing", source_kind: "gisogd",
    import_only: true, defaults: () => ({}) },
  { id: "source.gisogd.red_lines", title: "ГИС ОГД: красные линии", kind: "redline",
    semantic_class: "pp.red_line", geometry_type: "polyline",
    style_id: "red.line.projected", stage: "existing", source_kind: "gisogd",
    import_only: true, defaults: () => ({}) },
  { id: "source.gisogd.restrict", title: "ГИС ОГД: зоны с особыми условиями", kind: "restrict",
    semantic_class: "terr.restrict", geometry_type: "polygon",
    style_id: "restrict.hatch", stage: "existing", source_kind: "gisogd",
    import_only: true, defaults: () => ({}) },
  // «Прочие слои» ОГД: всё, что портал отдал сверх зон/красных линий/ЗОУИТ
  // (кадастр, ОКС, инженерия, транспорт, смежные территории) — чтобы ничего
  // из выгрузки не терялось; нейтральный серый, любая геометрия.
  { id: "source.gisogd.other", title: "ГИС ОГД: прочие слои", kind: "generic",
    semantic_class: "generic.polygon", geometry_type: "polygon",
    style_id: "boundary.line", stage: "existing", source_kind: "gisogd",
    import_only: true, generic: true, fields: [],
    fmt: { fill: "rgba(150,150,160,0.14)", stroke: "#8a8a94", width: 0.8 },
    defaults: () => ({}) },
  // приёмники «Данных по области» (кнопка «Данные»: OSM + НСПД по экстенту).
  // fmt — мягкие подложечные цвета, чтобы контекст не спорил с проектом;
  // это layer.fmt (пер-слойное оформление), эталонные знаки не трогаются.
  { id: "source.nspd.buildings", title: "Здания (ЕГРН)", kind: "building",
    semantic_class: "oks.building", geometry_type: "polygon",
    style_id: "building.fill", stage: "existing", source_kind: "nspd",
    import_only: true, defaults: () => ({}) },
  { id: "source.nspd.constructions", title: "Сооружения (ЕГРН)", kind: "generic",
    semantic_class: "generic.line", geometry_type: "polyline",
    style_id: "boundary.line", stage: "existing", source_kind: "nspd",
    import_only: true, generic: true, fields: [],
    fmt: { stroke: "#8c7a5e", width: 1.2, dash: [6, 3] },
    defaults: () => ({}) },
  { id: "source.nspd.zouit", title: "ЗОУИТ (НСПД)", kind: "restrict",
    semantic_class: "terr.restrict", geometry_type: "polygon",
    style_id: "restrict.hatch", stage: "existing", source_kind: "nspd",
    import_only: true, defaults: () => ({}) },
  { id: "source.osm.roads", title: "Дороги и улицы (OSM)", kind: "generic",
    semantic_class: "generic.line", geometry_type: "polyline",
    style_id: "boundary.line", stage: "existing", source_kind: "osm",
    import_only: true, generic: true, fields: [],
    // Оформления слоя тут НЕТ намеренно: класс дороги приходит из самих данных
    // OSM (тег highway) и несёт СВОЙ знак (osm.hw.* по рабочим QML юзера:
    // магистраль 1.6 мм … тротуар 0.26 мм). Прежнее зашитое
    // fmt {stroke:"#9a938a", width:1} перекрывало знак (порядок: знак →
    // оформление слоя → оформление объекта) и делало все дороги одинаковыми
    // серыми волосками. Цвет по-прежнему переключается через «Оформление
    // слоя» — оба варианта QML есть в палитре (песочный/серый).
    defaults: () => ({}) },
  { id: "source.osm.buildings", title: "Здания (OSM)", kind: "building",
    semantic_class: "oks.building", geometry_type: "polygon",
    style_id: "building.fill", stage: "existing", source_kind: "osm",
    import_only: true,
    fmt: { fill: "rgba(176,170,160,0.35)", stroke: "#8f887e", width: 0.8 },
    defaults: () => ({}) },
  { id: "source.osm.landuse", title: "Землепользование (OSM)", kind: "generic",
    semantic_class: "generic.polygon", geometry_type: "polygon",
    style_id: "func_zone.fill", stage: "existing", source_kind: "osm",
    import_only: true, generic: true, fields: [],
    fmt: { fill: "rgba(140,180,120,0.18)", stroke: "#94ac84", width: 0.7 },
    defaults: () => ({}) },
  { id: "source.osm.water", title: "Вода (OSM)", kind: "generic",
    semantic_class: "generic.polygon", geometry_type: "polygon",
    style_id: "func_zone.fill", stage: "existing", source_kind: "osm",
    import_only: true, generic: true, fields: [],
    fmt: { fill: "rgba(120,160,205,0.30)", stroke: "#7fa3c8", width: 0.7 },
    defaults: () => ({}) },
  // Административные границы (районы/поселения) из OSM. Приходят кольцами, но
  // рисуются БЕЗ заливки — пунктирный контур как знак адм. границы (незалитый
  // полигон выбирается по обводке). Поля: наименование + уровень.
  { id: "source.osm.boundaries", title: "Адм. границы (OSM)", kind: "generic",
    semantic_class: "generic.polygon", geometry_type: "polygon",
    style_id: "boundary.line", stage: "existing", source_kind: "osm",
    import_only: true, generic: true,
    fields: [{ name: "name", label: "наименование", type: "text" },
             { name: "level", label: "уровень", type: "text" }],
    fmt: { stroke: "#b0674f", width: 1.3, dash: [7, 4] },
    defaults: () => ({}) },
  // Рельеф: горизонтали (изолинии высот) по видимой области — из открытого
  // тайлового DEM (AWS Terrain Tiles / SRTM). Тонкая коричневая линия «как на
  // топооснове»; подписи высот по умолчанию выключены (сотни линий = каша),
  // включаются «Оформлением слоя». Поле elev несёт высоту в метрах.
  { id: "source.terrain.contours", title: "Рельеф: горизонтали", kind: "generic",
    semantic_class: "generic.line", geometry_type: "polyline",
    style_id: "boundary.line", stage: "existing", source_kind: "terrain",
    import_only: true, generic: true,
    fields: [{ name: "elev", label: "высота, м", type: "real" }],
    fmt: { stroke: "#a9784e", width: 0.7, dash: null, label_field: null },
    defaults: () => ({}) },
  { id: "annotation.dimensions", title: "Размер", kind: "dim",
    semantic_class: null, geometry_type: "polyline", style_id: "dimension.line",
    annotation: true, tool: "dim", defaults: () => ({}) },
];
// Индексы могут получать ключи из импортированного проекта. Null-prototype
// исключает служебные ключи вроде __proto__/constructor и делает lookup
// обычной проверкой идентификатора, а не доступом к прототипу Object.
const LAYER_BY_ID = Object.create(null), LAYER_BY_KIND = Object.create(null);
function rebuildLayerIndexes() {
  for (const id of Object.keys(LAYER_BY_ID)) delete LAYER_BY_ID[id];
  for (const kind of Object.keys(LAYER_BY_KIND)) delete LAYER_BY_KIND[kind];
  for (const L of LAYERS_V2) {
    if (L.visible == null) L.visible = true;
    LAYER_BY_ID[L.id] = L;
    // import-only слои не становятся дефолтом для kind (иначе нарисованная
    // вручную зона ушла бы в ФГИС-ТП-слой): первый не-import_only выигрывает
    if (!L.import_only && !(L.kind in LAYER_BY_KIND)) LAYER_BY_KIND[L.kind] = L;
  }
}
function cloneLayerSpec(layer) {
  const copy = { ...layer };
  for (const key of ["fmt", "fields", "rules"])
    if (layer[key] != null) copy[key] = JSON.parse(JSON.stringify(layer[key]));
  return copy;
}
rebuildLayerIndexes();
// Новый/открываемый проект должен начинаться с чистой исходной модели, даже
// если в текущем проекте удаляли встроенные приёмники или меняли их поля.
const _BUILTIN_LAYER_SPECS = LAYERS_V2.map(cloneLayerSpec);
function resetLayerModel() {
  LAYERS_V2.splice(0, LAYERS_V2.length,
                   ..._BUILTIN_LAYER_SPECS.map(cloneLayerSpec));
  rebuildLayerIndexes();
}
// инструмент «размер» жёстко пишет в этот слой (LAYER_BY_KIND["dim"]) —
// если он когда-нибудь исчезнет из LAYERS_V2, простановка размеров упадёт
if (!LAYER_BY_KIND["dim"]) console.error("L2b: слой annotation.dimensions отсутствует — инструмент размеров не будет работать");

// ---------- пользовательские слои («+ слой» в панели) ----------
// Роли (семантические классы), доступные при заведении именованного слоя.
// L2b: пресетов больше нет, поэтому «Граница территории» тоже здесь — иначе
// пользователь не смог бы создать слой границы, а его площадь — главный вход
// ТЭП (terr_area). Участки ЕГРН по-прежнему не hand-draw роль: они приходят
// только импортом НСПД в приёмник source.nspd.parcels.
const BASE_KINDS = [
  { kind: "boundary", semantic_class: "terr.boundary", geometry_type: "polygon",
    style_id: "boundary.line", label: "Граница территории" },
  { kind: "zone", semantic_class: "tp.func_zone", geometry_type: "polygon",
    style_id: "func_zone.fill", label: "Функциональная зона / территория" },
  { kind: "restrict", semantic_class: "terr.restrict", geometry_type: "polygon",
    style_id: "restrict.hatch", label: "Ограничение (ЗОУИТ)" },
  { kind: "building", semantic_class: "oks.building", geometry_type: "polygon",
    style_id: "building.fill", label: "Здание" },
  { kind: "redline", semantic_class: "pp.red_line", geometry_type: "polyline",
    style_id: "red.line.projected", label: "Линия (красная/иная)" },
  { kind: "public", semantic_class: "pp.placement_zone", geometry_type: "polygon",
    style_id: "public_zone.fill", label: "Зона размещения ОКС" },
  { kind: "social", semantic_class: "social.object", geometry_type: "point",
    style_id: "social.point", label: "Точечный объект" },
];
const BASE_KIND_BY_KIND = Object.assign(Object.create(null),
  Object.fromEntries(BASE_KINDS.map(b => [b.kind, b])));
// semantic_class → kind, для восстановления пользовательских слоёв с диска
// (манифест для бэкенда несёт code, не kind — см. userLayersManifest)
const KIND_BY_SEMANTIC_CLASS = Object.assign(Object.create(null),
  Object.fromEntries(BASE_KINDS.map(b => [b.semantic_class, b.kind])));

// prop-дефолты нового объекта — та же логика, что у встроенных слоёв,
// но переиспользуемая (нужна и при создании слоя, и при восстановлении
// после перезагрузки, когда defaults() нельзя было сохранить как функцию)
function defaultsForKind(layerId, kind) {
  switch (kind) {
    case "zone": return { zone_title: "З-" + (featuresOnLayer(layerId).length + 1) };
    case "restrict": return { kind: "ограничение" };
    case "building": return { floors: 9, purpose: "МКД" };
    case "redline": return { radius: 0 };
    case "public": return { purpose: "Общественный центр" };
    case "social": return { kind: "ОО+ДОО", capacity: 750 };
    default: return {};
  }
}

const RU_TO_LAT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
  ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch",
  ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
function slugify(s) {
  const translit = [...s.toLowerCase()].map(ch => RU_TO_LAT[ch] ?? ch).join("");
  return translit.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sloi";
}
function uniqueLayerId(title) {
  const base = "user." + slugify(title);
  if (!LAYER_BY_ID[base]) return base;
  let n = 2;
  while (LAYER_BY_ID[`${base}-${n}`]) n++;
  return `${base}-${n}`;
}

// создаёт слой в LAYERS_V2/LAYER_BY_ID (id задаётся явно при восстановлении
// с диска — тогда он уже уникален и известен; при создании из UI — null)
function createUserLayer({ kind, title, styleId, id = null }) {
  const base = BASE_KIND_BY_KIND[kind];
  if (!base) throw new Error("неизвестный тип слоя: " + kind);
  const layerId = id || uniqueLayerId(title);
  const L = {
    id: layerId, title, kind: base.kind, semantic_class: base.semantic_class,
    geometry_type: base.geometry_type, style_id: styleId || base.style_id,
    stage: "project", user_created: true, visible: true,
    defaults: () => defaultsForKind(layerId, base.kind),
  };
  // топология покрытия (общие границы, Etap 2): у кастомного вида берётся из
  // его спецификации, у встроенных — по фикс-списку зон/ограничений/границ
  if (base.topology) L.topology = base.topology;
  else if (["boundary", "restrict", "zone"].includes(base.kind)) L.topology = "coverage";
  LAYERS_V2.push(L);
  LAYER_BY_ID[L.id] = L;
  return L;
}

// обычный (generic) слой — задаётся геометрией, без семантической роли.
// code = generic.<geom> (есть в классификаторе, экспортируется как чистая
// геометрия), в ТЭП не идёт; свои поля добавляются в атрибутивной таблице.
const GENERIC_CODE = { point: "generic.point", polyline: "generic.line", polygon: "generic.polygon", arc: "generic.arc", circle: "generic.circle" };
const CODE_TO_GEOM = Object.assign(Object.create(null),
  Object.fromEntries(Object.entries(GENERIC_CODE).map(([g, c]) => [c, g])));
const GENERIC_STYLE = { point: "social.point", polyline: "boundary.line", polygon: "func_zone.fill", arc: "red.line.projected", circle: "red.line.projected" };
function createGenericLayer({ title, geometry_type, styleId, id = null }) {
  const layerId = id || uniqueLayerId(title);
  const L = {
    id: layerId, title, kind: "generic", semantic_class: GENERIC_CODE[geometry_type],
    geometry_type, style_id: styleId || GENERIC_STYLE[geometry_type],
    stage: "project", user_created: true, generic: true, visible: true, fields: [],
    defaults: () => ({}),
  };
  LAYERS_V2.push(L);
  LAYER_BY_ID[L.id] = L;
  return L;
}

// манифест пользовательских слоёв для бэкенда (маршрутизация build_project
// не знает layer_id, придуманный на холсте, без этого списка). Встроенные
// слои-приёмники с СВОИМИ полями (полная атрибуция НСПД из «Данных») тоже
// идут в манифест — бэкенд мержит из него только fields, code/title builtin
function userLayersManifest() {
  return LAYERS_V2.filter(L => L.user_created || L.import_only || (L.fields && L.fields.length))
    .map(L => ({
      layer_id: L.id,
      // custom.* не входит в классификатор GeoPackage: внутри .grado такой
      // слой хранится как generic-геометрия, а исходная роль едет рядом и
      // восстанавливается Студией без потери.
      code: String(L.semantic_class || "").startsWith("custom.")
        ? GENERIC_CODE[L.geometry_type] : L.semantic_class,
      studio_code: String(L.semantic_class || "").startsWith("custom.")
        ? L.semantic_class : undefined,
      title: L.title,
      kind: L.kind, geometry_type: L.geometry_type,
      stage: L.stage, style_id: L.style_id,
      import_only: !!L.import_only,
      source_kind: L.source_kind || undefined,
      source_code: L.source_code || undefined,
      source_name: L.source_name || undefined,
      fields: L.fields || [],   // произвольные поля атрибутивной таблицы → колонки .grado
    }));
}

async function deleteLayer(layer) {
  // Гибкость: теперь можно удалять и импортные/встроенные слои (с подтверждением).
  // Это позволяет пользователю убирать ненужные приёмники данных (НСПД/ФГИС ТП и т.д.).
  // Если слой важен для провенанса — лучше просто скрыть чекбоксом.
  const isBuiltin = !layer.user_created;
  const count = featuresOnLayer(layer.id).length;
  const msg = count
    ? `В слое «${layer.title}» ${ruCount(count, "объект", "объекта", "объектов")}.${isBuiltin ? " Это встроенный/импортный слой." : ""} Удалить вместе с объектами?`
    : `Удалить слой «${layer.title}»?${isBuiltin ? " (встроенный/импортный)" : ""}`;
  if (count && !(await uiConfirm(msg, { ok: "Удалить", danger: true }))) return;
  if (!count && isBuiltin && !(await uiConfirm(`Удалить встроенный слой «${layer.title}»?`, { ok: "Удалить", danger: true }))) return;
  snapshot();
  state.features = state.features.filter(f => layerOf(f) !== layer);
  LAYERS_V2.splice(LAYERS_V2.indexOf(layer), 1);
  delete LAYER_BY_ID[layer.id];
  if (state.activeLayerId === layer.id) {
    const fallback = LAYERS_V2.find(l => !l.annotation && !l.import_only);
    if (fallback) setActiveLayer(fallback.id);
    else { state.activeLayerId = null; updateLayerStatus(); }  // удалили последний слой
  }
  if (selectedFeature() && layerOf(selectedFeature()) == null) clearSelection();
  afterChange();
}

async function renameLayer(layer) {
  const next = await uiPrompt("Новое имя слоя:", layer.title, { ok: "Переименовать" });
  if (next == null) return;                 // отмена
  const title = next.trim();
  if (!title) return;
  snapshot();
  layer.title = title;
  renderLayers(); renderProps(); persist();
}

// блокировка слоя (только просмотр): нельзя выбрать/подвинуть/удалить его
// объекты и нельзя сделать слой активным для черчения
function toggleLayerLock(layer) {
  snapshot();
  layer.locked = !layer.locked;
  let fallback = null;
  if (layer.locked) {
    // снять выделение с уже выбранных объектов этого слоя — иначе их
    // можно было бы двигать стрелками/Delete в обход блокировки
    const stale = selectionIds().filter(id => {
      const f = state.features.find(x => x.id === id);
      return f && layerOf(f) === layer;
    });
    if (stale.length) {
      for (const id of stale) state.selectedIds.delete(id);
      if (state.selected != null && stale.includes(state.selected)) state.selected = null;
    }
    if (state.activeLayerId === layer.id) {
      fallback = LAYERS_V2.find(item => item !== layer && isDrawableLayer(item)) || null;
      state.activeLayerId = fallback?.id || null;
      state.drawing = null;
      state.typed = "";
      if (!fallback) startGuideDismissed = false;
    }
  }
  if (fallback && GEOM_OF_TOOL[state.tool] && !toolFitsLayer(state.tool, fallback))
    setTool(naturalToolFor(fallback), { keepLayer: true });
  else if (layer.locked && !fallback)
    setTool("select", { keepLayer: true });
  renderLayers(); renderProps(); updateLayerStatus(); updateStartExperience();
  syncHistoryControls(); draw(); persist();
}

// Стили выше — встроенный fallback; на старте они переопределяются из
// /api/styles (единый источник styles/default.json — тот же, что PDF и DXF).
async function initStyles() {
  try {
    const r = await fetch("/api/styles");
    if (!r.ok) return;
    const lib = await r.json();
    for (const id of Object.keys(lib)) STYLES_V2[id] = lib[id];
    draw(); renderLayers();
  } catch (e) { /* сервер без /api/styles — холст на встроенных стилях */ }
}

function layerOf(f) { return LAYER_BY_ID[f.layer_id] || LAYER_BY_KIND[f.kind] || null; }

// Категории ВНУТРИ слоя. Слой теперь повторяет слой-источник (требование юзера:
// «Зоны береговых полос» портала → свой слой, а не общий ЗОУИТ), поэтому классы
// объектов живут в ОДНОМ слое и различаются знаком: дороги OSM — по тегу highway
// (osm.hw.*), ОГД — по LineCode/имени (lgr.*). Без переключателя категорий,
// убрав слои-знаки, мы отняли бы возможность гасить отдельные классы — поэтому
// выключенные категории храним в оформлении слоя (fmt.cats_off = [style_id]).
function featCat(f) { return (f && f.style_id) || null; }
// Объекты БЕЗ скрытых категорией: пользователь выключил класс — он не должен
// ни считаться в ТЭП, ни попадать в ВЫПУСК (печать/DXF/альбом). Это то же, что
// он видит на холсте. Сохранение .grado НЕ фильтруем — это данные проекта, а
// cats_off хранится в fmt и восстанавливает скрытое состояние при открытии.
function catVisibleFeatures() {
  return state.features.filter(f => !catOff(layerOf(f), f));
}
function tepFeatures() { return catVisibleFeatures(); }
function catOff(L, f) {
  const off = L && L.fmt && L.fmt.cats_off;
  if (!off || !off.length) return false;
  const c = featCat(f);
  return !!c && off.includes(c);
}
// Категории, реально присутствующие в слое → для списка галочек в «Оформлении
// слоя». Считаем по объектам, а не по библиотеке: показывать 26 классов дорог,
// когда выгружены три, — мусор.
function layerCats(L) {
  const seen = new Map();
  for (const f of state.features) {
    if (layerOf(f) !== L) continue;
    const c = featCat(f);
    if (!c || seen.has(c)) continue;
    const st = STYLES_V2[c];
    seen.set(c, (st && st.title) || c);
  }
  return [...seen].map(([id, title]) => ({ id, title }))
                  .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}
// QGIS-подобная легенда: категории слоя со счётчиком и представителем. sample —
// первый объект категории; styleOf(sample) = ровно то, что нарисовано на холсте
// (с учётом оформления слоя), поэтому образец в подпункте совпадает с картой.
function layerCatStats(L) {
  const m = new Map();
  for (const f of state.features) {
    if (layerOf(f) !== L) continue;
    const c = featCat(f);
    if (!c) continue;
    let e = m.get(c);
    if (!e) { e = { id: c, title: (STYLES_V2[c] && STYLES_V2[c].title) || c, count: 0, sample: f }; m.set(c, e); }
    e.count++;
  }
  return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
}
// раскрытые слои (показ подпунктов-категорий) — по id, переживает reload
const _catOpen = (() => {
  try { return new Set(JSON.parse(localStorage.getItem("grado_cat_open") || "[]")); }
  catch (e) { return new Set(); }
})();
function saveCatOpen() {
  try { localStorage.setItem("grado_cat_open", JSON.stringify([..._catOpen])); } catch (e) {}
}
// Видимость категории слоя (галка подпункта) — через тот же fmt.cats_off, что и
// секция «Категории слоя» в оформлении. afterChange = холст+ТЭП+привязки+сохран.
function toggleCategoryVisible(layer, catId, visible) {
  snapshot();
  const off = new Set((layer.fmt && layer.fmt.cats_off) || []);
  if (visible) off.delete(catId); else off.add(catId);
  layer.fmt = { ...(layer.fmt || {}) };
  if (off.size) layer.fmt.cats_off = [...off]; else delete layer.fmt.cats_off;
  afterChange();
}

/*
 * === ЛОГИКА СЛОЁВ И ФОРМАТИРОВАНИЯ (цель: логично + гибко) ===
 *
 * Слой (L) = контекст рисования + семантика (для ТЭП) + визуальные правила по умолчанию.
 *   - role / semantic_class / kind — для расчёта ТЭП, классификации, импорта.
 *   - style_id + layer.fmt — базовый знак + переопределения отображения для всего слоя.
 *   - layer.rules — условное: по значению атрибута объекта выбирается другой знак (или патч).
 *
 * Объект (f) наследует от слоя.
 *   - f.style_id — явный выбор знака из библиотеки (перекрывает layer + rules; уходит в .grado / стандартный PDF).
 *   - f.fmt — локальные правки отображения (только холст + режим «как на холсте» в альбоме).
 *
 * Порядок разрешения styleOf(f):
 *   1. f.style_id (если есть) → библиотека
 *   2. ruleStyleFor (первое совпадение rules слоя) → библиотека
 *   3. layerStyle (base style_id слоя + layer.fmt)
 *   4. + f.fmt (поверх всего)
 *
 * «Библиотека знаков» правит глобальные эталоны (через style_overrides.json).
 * «Оформление слоя» — это кастомизация именно для данного слоя/проекта.
 *
 * Гибкость:
 *   - Можно переопределять стиль импортированных слоёв через fmt/rules, не трогая данные.
 *   - Правила позволяют категории иметь разный вид без новых style_id.
 *   - «как на холсте» позволяет вынести все кастомизации в PDF.
 *
 * Упрощение в UI (объект + слой): избегаем двух отдельных «стиль» и «оформление» в свойствах объекта.
 */

function layerStyle(L) {
  if (!L) return {};
  const sid = L.style_id;
  const base = (sid && (state.projectStyles[sid] || STYLES_V2[sid])) || {};
  return L.fmt ? { ...base, ...L.fmt } : base;
}

function layerVisualFormat(L) {
  const fmt = { ...((L && L.fmt) || {}) };
  delete fmt.cats_off;
  delete fmt.cat_styles;
  delete fmt.uniform_style;
  return fmt;
}

// Категории импортированного слоя уже несут собственные библиотечные знаки.
// Как только появляются точечные правки категорий, старый layer.fmt без
// явного флага uniform_style считаем служебным наследием редактора, а не
// намерением перекрасить все категории одинаково. Явная правка блока
// «Единый стиль» ставит uniform_style=true и снова применяет общий формат.
function categoryLayerVisualFormat(L) {
  if (!L || !L.fmt) return {};
  const hasCategoryOverrides = !!(L.fmt.cat_styles &&
    Object.keys(L.fmt.cat_styles).length);
  return hasCategoryOverrides && L.fmt.uniform_style !== true
    ? {} : layerVisualFormat(L);
}

// условное форматирование: первое правило слоя, чьё поле совпадает со
// значением атрибута объекта, отдаёт свой библиотечный стиль.
// Поддержка ops для более мощных правил (fmt-патчи): = > < >= <= contains starts
function ruleStyleFor(L, f) {
  if (!L || !Array.isArray(L.rules)) return null;
  const props = f.props || {};
  for (const r of L.rules) {
    if (!r.field || r.value === undefined || r.value === "") continue;
    const v = props[r.field] ?? "";
    const rv = r.value;
    const op = r.op || "=";
    let match = false;
    if (op === "=") match = String(v) === String(rv);
    else if (op === ">") match = parseFloat(v) > parseFloat(rv);
    else if (op === "<") match = parseFloat(v) < parseFloat(rv);
    else if (op === ">=") match = parseFloat(v) >= parseFloat(rv);
    else if (op === "<=") match = parseFloat(v) <= parseFloat(rv);
    else if (op === "contains") match = String(v).toLowerCase().includes(String(rv).toLowerCase());
    else if (op === "starts") match = String(v).toLowerCase().startsWith(String(rv).toLowerCase());
    if (match) return (r.style_id && (state.projectStyles[r.style_id] || STYLES_V2[r.style_id])) || null;
  }
  return null;
}
// Функц. зона БЕЗ назначенного знака (проект загружен старой веб-редакцией,
// которая не красила зоны): подбираем цвет Генплана по ТИПУ зоны из атрибутов
// объекта — те же baked-правила (window.__GRADO_GP_ZONE_RULES__), что у импорта.
// На десктопе правил нет (там цвет ставит сервер при импорте) → null, no-op.
// Мемоизация в WeakMap — не пишется в объект, не попадает в .grado/автосейв.
const _gpSidCache = new WeakMap();
function gpZoneSid(f) {
  if (!f || f.kind !== "zone" || f.style_id) return null;
  if (_gpSidCache.has(f)) return _gpSidCache.get(f);
  const R = typeof window !== "undefined" && window.__GRADO_GP_ZONE_RULES__;
  const p = f.props;
  let sid = null;
  if (R && p) {
    const norm = s => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
    sid = R.name_to_style[norm(p.naimfunkzony || p.naimfunkzo || p.fz_name
      || p.funct_zon || p.class_name || p.name)] || null;
    if (!sid) {
      const c = String(p.fztip || p.fztype || p.fz_type || "").split(".")[0];
      const z = R.code_to_zone[c];
      if (z) sid = R.name_to_style[z] || null;
    }
  }
  _gpSidCache.set(f, sid);
  return sid;
}

// Знак СЛОЯ-источника ОГД по его названию (те же baked-правила, что импорт):
// проект, загруженный старой веб-редакцией, мог не назначить знак объектам
// слоя (напр. «Природные и озеленённые территории» = природный комплекс шёл
// голым контуром). Знак слоя красит их при открытии БЕЗ переимпорта. На
// десктопе правил в window нет → берётся L.style_id (сервер уже проставил).
const _layerSignCache = new Map();   // layer.id → style_id | null
function layerSignSid(L) {
  if (!L || typeof L.id !== "string" || !L.id.startsWith("source.gisogd.")) return null;
  if (_layerSignCache.has(L.id)) return _layerSignCache.get(L.id);
  let sid = L.style_id || null;
  const R = typeof window !== "undefined" && window.__GRADO_GISOGD_RULES__;
  if (!sid && R && L.title) {
    const low = String(L.title).toLowerCase().replace(/ё/g, "е");
    if (!(R.doc_markers || []).some(m => low.includes(m))) {
      const hit = (R.style_rules || []).find(r => r.keys.some(k => low.includes(k)));
      if (hit) sid = hit.style_id;
    }
  }
  _layerSignCache.set(L.id, sid);
  return sid;
}

function styleOf(f) {
  const L = layerOf(f);
  const sid = f.style_id;
  // знак для объекта без style_id: цвет зоны по типу ИЛИ знак слоя по имени
  const gsid = sid ? null : (gpZoneSid(f) || layerSignSid(L));
  let base = (sid && (state.projectStyles[sid] || STYLES_V2[sid]))
    || (gsid && STYLES_V2[gsid]) || ruleStyleFor(L, f) || layerStyle(L) || {};
  // «Оформление слоя» действует и на объекты со СВОИМ знаком. Раньше явный
  // f.style_id забирал стиль прямо из библиотеки, минуя L.fmt: правки слоя
  // (напр. выключить штриховку/подпись у импортированных зон ОГД) просто не
  // применялись — объект молча оставался с библиотечным знаком.
  // Порядок остаётся: знак → оформление слоя → оформление объекта.
  if ((sid || gsid) && L && L.fmt) base = { ...base, ...categoryLayerVisualFormat(L) };
  const categoryId = sid || gsid;
  const categoryPatch = categoryId && L && L.fmt && L.fmt.cat_styles
    ? L.fmt.cat_styles[categoryId] : null;
  if (categoryPatch) {
    const refId = categoryPatch.style_ref;
    const refStyle = refId && (state.projectStyles[refId] || STYLES_V2[refId]);
    base = { ...(refStyle || base), ...categoryLayerVisualFormat(L), ...categoryPatch };
  }
  return f.fmt ? { ...base, ...f.fmt } : base;   // f.fmt — оформление отдельного объекта
}

// Эталонный тёмный штрих границы (#1c1c1a) корректен для печати и светлого
// холста, но почти исчезает на тёмной теме. На экране семантический базовый
// стиль берёт контрастный токен темы; явную правку цвета пользователем не
// трогаем — она должна оставаться точной.
function canvasStrokeOf(f, st) {
  const L = layerOf(f);
  const objectOverride = f.fmt && Object.prototype.hasOwnProperty.call(f.fmt, "stroke");
  const layerOverride = L && L.fmt && Object.prototype.hasOwnProperty.call(L.fmt, "stroke");
  const styleId = f.style_id || (L && L.style_id);
  if (!objectOverride && !layerOverride && styleId === "boundary.line")
    return cvColor("boundary", st.stroke || "#1c1c1a");
  return st.stroke || cvColor("boundary", "#000");
}

async function createProjectStyle() {
  const translit = { а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z",
    и:"i", й:"y", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t",
    у:"u", ф:"f", х:"h", ц:"c", ч:"ch", ш:"sh", щ:"sch", ъ:"", ы:"y", ь:"",
    э:"e", ю:"yu", я:"ya" };
  const slugOf = value => {
    const latin = String(value || "").toLowerCase().replace(/[а-яё]/g, char => translit[char] ?? char);
    const slug = latin.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
    return `project.${slug || "custom_sign"}`;
  };
  const created = await new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay project-style-create-overlay";
    overlay.innerHTML = `<div class="modal project-style-create" role="dialog" aria-modal="true" aria-labelledby="project-style-create-title">
      <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Знак проекта</span><span id="project-style-create-title">Новый пользовательский знак</span></span>
        <button class="modal-x" aria-label="Закрыть создание знака"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body project-style-create-body">
        <section class="project-style-create-preview" aria-label="Предпросмотр знака">
          <div class="project-style-preview-kicker">Предпросмотр</div>
          <div id="psc-preview" class="project-style-preview-canvas"></div>
          <p>Знак сохранится только в этом проекте и появится в библиотеке оформления.</p>
        </section>
        <form id="psc-form" class="project-style-create-form" novalidate>
          <label class="project-style-field project-style-field-wide"><span>Название знака</span>
            <input id="psc-title" autocomplete="off" maxlength="120" placeholder="Например, Проектируемая велодорожка" required></label>
          <label class="project-style-field"><span>Тип геометрии</span>
            <select id="psc-geometry"><option value="polygon">Полигон</option><option value="polyline">Линия</option><option value="point">Точка</option><option value="all">Любая геометрия</option></select></label>
          <label class="project-style-field"><span>Идентификатор</span>
            <input id="psc-id" autocomplete="off" maxlength="64" placeholder="project.custom_sign" required pattern="[A-Za-z][A-Za-z0-9_.-]{0,63}"></label>
          <label class="project-style-color"><span>Заливка</span><input type="color" id="psc-fill" value="#dbe8ff"></label>
          <label class="project-style-color"><span>Обводка</span><input type="color" id="psc-stroke" value="#2358c9"></label>
          <label class="project-style-field"><span>Толщина линии</span><input type="number" id="psc-width" value="1.5" step="0.1" min="0.2" max="8" required></label>
          <div class="project-style-id-hint">ID формируется автоматически, но его можно уточнить до создания.</div>
          <div class="form-error" id="psc-error" role="alert" hidden></div>
        </form>
      </div>
      <div class="modal-actions"><button type="button" id="psc-cancel">Отмена</button><span class="spacer"></span><button type="submit" form="psc-form" id="psc-create" class="primary">Создать знак</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const $c = id => overlay.querySelector("#" + id);
    let idTouched = false;
    let settled = false;
    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const styleFromForm = () => ({
      title: $c("psc-title").value.trim() || "Новый знак",
      geometry_type: $c("psc-geometry").value,
      fill: $c("psc-fill").value,
      stroke: $c("psc-stroke").value,
      width: boundedNumber($c("psc-width").value, 0.2, 8, 1.5)
    });
    const updatePreview = () => {
      const geometry = $c("psc-geometry").value;
      const style = styleFromForm();
      if (geometry === "point") style.marker = { shape: "circle", size: 7, fill: style.fill, stroke: style.stroke };
      $c("psc-preview").innerHTML = styleSampleSVG(style, { w: 190, h: 74 });
    };
    const clearError = () => {
      $c("psc-error").hidden = true;
      $c("psc-error").textContent = "";
      overlay.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute("aria-invalid"));
    };
    $c("psc-title").addEventListener("input", () => {
      clearError();
      if (!idTouched) $c("psc-id").value = slugOf($c("psc-title").value);
    });
    $c("psc-id").addEventListener("input", () => { idTouched = true; clearError(); });
    ["psc-geometry", "psc-fill", "psc-stroke", "psc-width"].forEach(id =>
      $c(id).addEventListener("input", () => { clearError(); updatePreview(); }));
    $c("psc-form").addEventListener("submit", event => {
      event.preventDefault();
      clearError();
      const title = $c("psc-title").value.trim();
      const id = $c("psc-id").value.trim();
      let invalid = null, message = "";
      if (!title) { invalid = $c("psc-title"); message = "Введите понятное название знака."; }
      else if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(id)) {
        invalid = $c("psc-id"); message = "ID должен начинаться с латинской буквы и содержать только латиницу, цифры, точку, дефис или подчёркивание.";
      } else if (state.projectStyles[id] || STYLES_V2[id]) {
        invalid = $c("psc-id"); message = "Такой ID уже занят. Измените идентификатор знака.";
      } else if (!$c("psc-width").checkValidity()) {
        invalid = $c("psc-width"); message = "Укажите толщину линии от 0,2 до 8 px.";
      }
      if (invalid) {
        invalid.setAttribute("aria-invalid", "true");
        $c("psc-error").textContent = message;
        $c("psc-error").hidden = false;
        invalid.focus({ preventScroll: true });
        return;
      }
      close({ id, style: { ...styleFromForm(), title } });
    });
    const onKeyDown = event => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKeyDown);
    overlay.querySelector(".modal-x").onclick = () => close(null);
    $c("psc-cancel").onclick = () => close(null);
    overlay.onclick = event => { if (event.target === overlay) close(null); };
    $c("psc-id").value = slugOf("");
    updatePreview();
    requestAnimationFrame(() => $c("psc-title").focus());
  });
  if (!created) return null;
  snapshot();
  state.projectStyles[created.id] = created.style;
  persist();
  draw();
  renderLayers();
  toast(`Создан проектный знак «${created.style.title}». Он уже доступен в библиотеке.`);
  return created.id;
}

// менеджер своих стилей проекта (по плану: "свои стили в проекте")
function openProjectStyles() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal fmt-modal" role="dialog" aria-modal="true" aria-labelledby="project-styles-title">
    <div class="modal-head"><span id="project-styles-title">Стили проекта</span>
      <button class="modal-x" aria-label="Закрыть стили проекта"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body">
      <div class="ps-note">Собственные знаки хранятся вместе с проектом и доступны при оформлении слоёв и объектов.</div>
      <div id="ps-list" class="ps-list"></div>
      <button id="ps-create" class="fmt-copy-btn">+ Создать новый стиль проекта</button>
    </div>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button id="ps-close">Закрыть</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector("#" + id);
  function renderList() {
    const cont = $("ps-list");
    cont.innerHTML = "";
    const ps = state.projectStyles || {};
    if (Object.keys(ps).length === 0) {
      cont.innerHTML = '<div class="ps-empty">Собственных знаков пока нет.<br>Создайте первый знак для этого проекта.</div>';
      return;
    }
    Object.entries(ps).forEach(([id, st]) => {
      const row = document.createElement("div");
      row.className = "ps-row";
      const sw = document.createElement("span");
      sw.className = "ps-swatch";
      sw.innerHTML = styleSampleSVG(st, { w: 60, h: 24 });
      const nm = document.createElement("span");
      nm.innerHTML = `<strong>${escHtml(st.title || id)}</strong><small>${escHtml(id)}</small>`;
      nm.className = "ps-name";
      const geometry = document.createElement("span");
      geometry.className = "ps-geometry";
      geometry.textContent = ({ polygon:"Полигон", polyline:"Линия", point:"Точка", all:"Любая" })[st.geometry_type] || "Любая";
      const ed = document.createElement("button");
      ed.className = "ps-icon";
      ed.innerHTML = '<svg class="ic"><use href="#ic-format"/></svg>';
      ed.title = "Редактировать";
      ed.onclick = () => editPS(id, st, renderList);
      const dl = document.createElement("button");
      dl.className = "ps-icon danger";
      dl.innerHTML = '<svg class="ic"><use href="#ic-trash"/></svg>';
      dl.title = "Удалить";
      dl.onclick = async () => {
        if (await uiConfirm(`Удалить стиль проекта «${id}»?`)) {
          snapshot();
          delete state.projectStyles[id];
          renderList();
          afterChange();
        }
      };
      row.append(sw, nm, geometry, ed, dl);
      cont.append(row);
    });
  }
  async function editPS(id, st, onDone) {
    const ed = document.createElement("div");
    ed.className = "modal-overlay";
    const f = toHexColor(st.fill, "#f0e8d8");
    const s = toHexColor(st.stroke, "#5c4630");
    ed.innerHTML = `<div class="modal ask-modal" style="width:280px" role="dialog" aria-modal="true" aria-labelledby="project-style-edit-title">
      <div class="modal-head"><span id="project-style-edit-title">Редактировать «${escHtml(id)}»</span>
        <button class="modal-x" aria-label="Закрыть редактирование стиля"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body">
        <label>Название<input id="ps-t" value="${escHtml(st.title || id)}" maxlength="120" required></label>
        <label>Заливка<input type="color" id="ps-f" value="${f}"></label>
        <label>Обводка<input type="color" id="ps-s" value="${s}"></label>
        <label>Толщина<input type="number" id="ps-w" value="${boundedNumber(st.width, 0.2, 8, 1.5)}" step="0.1" min="0.2" max="8" required></label>
        <div class="form-error" id="ps-error" role="alert" hidden></div>
      </div>
      <div class="modal-actions">
        <button id="ps-ok">Сохранить</button>
        <span class="spacer"></span>
        <button id="ps-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(ed);
    const $e = id => ed.querySelector("#" + id);
    const clearError = () => {
      $e("ps-error").hidden = true;
      $e("ps-error").textContent = "";
      [$e("ps-t"), $e("ps-w")].forEach(input => input.removeAttribute("aria-invalid"));
    };
    [$e("ps-t"), $e("ps-w")].forEach(input => input.addEventListener("input", clearError));
    $e("ps-ok").onclick = () => {
      const invalid = !$e("ps-t").checkValidity() ? $e("ps-t")
        : !$e("ps-w").checkValidity() ? $e("ps-w") : null;
      if (invalid) {
        clearError();
        invalid.setAttribute("aria-invalid", "true");
        $e("ps-error").textContent = invalid === $e("ps-t")
          ? "Введите название стиля."
          : "Укажите толщину линии от 0,2 до 8 px.";
        $e("ps-error").hidden = false;
        invalid.focus({ preventScroll: true });
        return;
      }
      snapshot();
      st.title = $e("ps-t").value.trim() || id;
      st.fill = $e("ps-f").value;
      st.stroke = $e("ps-s").value;
      st.width = boundedNumber($e("ps-w").value, 0.2, 8, 1.5);
      ed.remove();
      onDone();
      afterChange();
    };
    $e("ps-cancel").onclick = () => ed.remove();
    ed.querySelector(".modal-x").onclick = () => ed.remove();
    ed.onclick = e => { if (e.target === ed) ed.remove(); };
  }
  $("ps-create").onclick = async () => {
    const nid = await createProjectStyle();
    if (nid) renderList();
  };
  $("ps-close").onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  renderList();
}
// пресеты пунктира и плотности штриховки для модалки формата
const DASH_PRESETS = { solid: null, dash: [6, 4], dashdot: [10, 4, 2, 4],
                       dashdotdot: [10, 4, 2, 4, 2, 4] };
function dashPresetOf(dash) {
  if (!dash) return "solid";
  for (const [k, v] of Object.entries(DASH_PRESETS))
    if (v && v.length === dash.length && v.every((n, i) => n === dash[i])) return k;
  return "custom";     // точный паттерн (напр. из QML) не совпал ни с одним пресетом
}
function dashToStr(dash) { return Array.isArray(dash) ? dash.join(",") : ""; }
function boundedNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
// «8, 3, 2, 3» → [8,3,2,3]; мусор/пусто — null (сплошная).
// Ограничиваем и длину, и отдельные интервалы: значение приходит из проекта
// или ручного ввода и не должно превращать canvas setLineDash в дорогую
// операцию с тысячами элементов.
function parseDashStr(s) {
  const nums = String(s || "").split(/[,\s]+/).map(Number)
    .filter(n => Number.isFinite(n) && n > 0)
    .slice(0, 32).map(n => Math.min(1000, Math.max(0.1, n)));
  return nums.length ? nums : null;
}
// формы засечек-маркеров линии — см. drawMarkerGlyph (ниже) за геометрией
const MARKER_SHAPES = [
  ["tick", "засечка ⊢"], ["tee", "тавр ⊥"], ["corner", "уголок"], ["chevron", "галка ∨"],
  ["chevron_dot", "галка с точкой"], ["triangle", "треугольник ▼"],
  ["triangle2", "двойной треугольник"], ["dot", "точка ●"], ["square", "квадрат ■"],
  ["diamond", "ромб ◇"], ["slashes", "двойной штрих ⫽"],
];
const HATCH_DENS = { sparse: 14, normal: 9, dense: 5 };
function hatchDensOf(px) { return px <= 6 ? "dense" : px >= 13 ? "sparse" : "normal"; }
// маленькое условное обозначение линии: как выглядит выбранный стиль (цвет,
// толщина, пунктир) — образец рядом с выпадашкой стиля в форматировании слоя

// Полный образец ЗНАКА для превью (список слоёв, библиотека, диалог): линия со
// штрихом + засечки всех форм + заливка/штриховка зоны. В превью размеры засечек
// НЕ эталонные, а разборчиво-крупные (это легенда — знак должен читаться), но
// форма/направление/контурность/цвет — как у знака. st — фронт-стиль
// {stroke, fill, dash, width, hatch, line_marker}.
function styleSampleSVG(st, opts) {
  st = st || {};
  const W = (opts && opts.w) || 200, H = (opts && opts.h) || 22;
  const midY = H / 2, x0 = 6, x1 = W - 6;
  const stroke = escHtml(st.stroke || "#888");
  const filled = st.fill && st.fill !== "transparent";
  const hatched = st.hatch;
  const dotted = st.dots && st.dots.color;
  let defs = "", bg = "";
  if (filled || hatched || dotted) {
    // зона: заливка + штриховка + точки + рамка
    if (filled) bg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="${escHtml(st.fill)}"/>`;
    if (hatched) {
      const h = (st.hatch === true) ? { angle: 45, spacing_px: 6, color: st.stroke } : st.hatch;
      const col = escHtml(h.color || st.stroke || "#888");
      const gap = Math.max(3, (h.spacing_px || 6));
      const ang = h.cross ? 45 : (h.angle == null ? 45 : h.angle);
      defs += `<pattern id="hp${styleSampleSVG._n = (styleSampleSVG._n || 0) + 1}" patternUnits="userSpaceOnUse" width="${gap}" height="${gap}" patternTransform="rotate(${90 - ang})"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${col}" stroke-width="0.8"/></pattern>`;
      bg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="url(#hp${styleSampleSVG._n})"/>`;
      if (h.cross) {
        defs += `<pattern id="hp${styleSampleSVG._n}b" patternUnits="userSpaceOnUse" width="${gap}" height="${gap}" patternTransform="rotate(${135})"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${col}" stroke-width="0.8"/></pattern>`;
        bg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="url(#hp${styleSampleSVG._n}b)"/>`;
      }
    }
    if (dotted) {
      const dcol = escHtml(st.dots.color);
      const dgap = Math.max(4, Math.min(9, st.dots.spacing_px || 8));
      const dr = Math.max(0.8, Math.min(2, (st.dots.size_px || 2) / 2));
      const idn = `dp${styleSampleSVG._n = (styleSampleSVG._n || 0) + 1}`;
      defs += `<pattern id="${idn}" patternUnits="userSpaceOnUse" width="${dgap}" height="${dgap}"><circle cx="${dgap / 2}" cy="${dgap / 2}" r="${dr}" fill="${dcol}"/></pattern>`;
      bg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="url(#${idn})"/>`;
    }
    bg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
    // знак-зона может нести засечки по контуру (напр. ПК-18: штриховка + красные
    // треугольники) — показываем их поверх, иначе превью «теряет» половину знака
    const zmk = st.line_marker;
    if (zmk && zmk.shape) bg += _markerGlyphsSVG(zmk, x0, x1, midY, stroke);
    bg += _sampleLabelSVG(st.line_label, W, midY, H, stroke);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${defs}${bg}</svg>`;
  }
  // линия: штрих + засечки
  const lw = Math.max(0.8, Math.min(3, (st.width || 1) * 1.2));
  const da = (st.dash && st.dash.length) ? st.dash.map(n => (n * 1.4).toFixed(1)).join(",") : "";
  let parts = `<line x1="${x0}" y1="${midY}" x2="${x1}" y2="${midY}" stroke="${stroke}" stroke-width="${lw}" stroke-linecap="butt"${da ? ` stroke-dasharray="${da}"` : ""}/>`;
  const mk = st.line_marker;
  if (mk && mk.shape) parts += _markerGlyphsSVG(mk, x0, x1, midY, stroke);
  parts += _sampleLabelSVG(st.line_label, W, midY, H, stroke);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${parts}</svg>`;
}
// Подпись знака в образце (как повторяющаяся подпись вдоль линии на карте):
// малый текст по центру с фоном-гало под тему, чтобы читался поверх линии.
// Пусто, если у стиля подписи нет (у слоёв-источников она по умолчанию выкл —
// как и на холсте).
function _sampleLabelSVG(label, W, midY, H, stroke) {
  const t = String(label == null ? "" : label).trim();
  if (!t) return "";
  const txt = t.length > 6 ? t.slice(0, 5) + "…" : t;
  const fs = Math.min(9, Math.round(H * 0.62));
  const w = txt.length * fs * 0.62 + 4;
  return `<rect x="${(W - w) / 2}" y="${midY - fs * 0.75}" width="${w}" height="${fs * 1.5}" rx="2" fill="var(--panel, #fff)" opacity="0.9"/>` +
    `<text x="${W / 2}" y="${midY}" font-size="${fs}" fill="${stroke}" text-anchor="middle" dominant-baseline="central" font-family="var(--font-ui, sans-serif)">${escHtml(txt)}</text>`;
}
// Засечки знака вдоль образца линии — крупно и разборчиво (легенда).
function _markerGlyphsSVG(mk, x0, x1, midY, stroke) {
  const s = 7, w2 = 4, ow = Math.max(1, mk.ow ? mk.ow * 0.7 : 1.1);
  const filled = mk.filled !== false;
  const dirs = mk.dir === "both" ? [-1, 1] : [mk.dir === "out" ? -1 : -1];  // вверх (и вниз для both)
  // Хотя бы ОДИН маркер даже в узком свотче (40px): раньше n=floor(28/26)=0 и
  // засечки не рисовались вовсе — знак ООЗТ/ПК выглядел как голая линия.
  const usable = x1 - x0, step = 26;
  const n = Math.max(1, Math.round(usable / step));
  const gap = usable / (n + 1);
  let out = "";
  for (let i = 1; i <= n; i++) {
    const x = x0 + gap * i;
    for (const d of dirs) {
      const ny = d * -1;                 // экранная нормаль (up при d=1)
      const apexY = midY + ny * s;
      const glyph = (fillMode) => {
        switch (mk.shape) {
          case "chevron": case "chevron_dot":
            return `<path d="M ${x - w2} ${apexY} L ${x} ${midY} L ${x + w2} ${apexY}" fill="none" stroke="${stroke}" stroke-width="${ow}"/>`;
          case "triangle": {
            // вершина НА линии (midY), основание смещено по нормали (apexY)
            const base = 3;
            const p = `M ${x} ${midY} L ${x - base} ${apexY} L ${x + base} ${apexY} Z`;
            return fillMode ? `<path d="${p}" fill="${stroke}"/>` : `<path d="${p}" fill="none" stroke="${stroke}" stroke-width="${ow}"/>`;
          }
          case "triangle2": {
            // два треугольника со сдвигом вверх (к apex), не вбок
            const base = 2.6, h = midY - apexY, sh = h * 0.38;
            const tri = (dy) => {
              const y0 = midY - dy, y1 = apexY - dy;
              return `M ${x - base} ${y0} L ${x + base} ${y0} L ${x} ${y1} Z`;
            };
            return [0, sh].map(dy => fillMode
              ? `<path d="${tri(dy)}" fill="${stroke}"/>`
              : `<path d="${tri(dy)}" fill="none" stroke="${stroke}" stroke-width="${ow}"/>`).join("");
          }
          case "tick":
            return `<line x1="${x}" y1="${midY}" x2="${x}" y2="${apexY}" stroke="${stroke}" stroke-width="${ow}"/>`;
          case "tee":
            return `<line x1="${x}" y1="${midY}" x2="${x}" y2="${apexY}" stroke="${stroke}" stroke-width="${ow}"/>` +
                   `<line x1="${x - w2}" y1="${apexY}" x2="${x + w2}" y2="${apexY}" stroke="${stroke}" stroke-width="${ow}"/>`;
          case "diamond": {
            const p = `M ${x} ${midY - s / 2} L ${x + s / 2} ${midY} L ${x} ${midY + s / 2} L ${x - s / 2} ${midY} Z`;
            return fillMode ? `<path d="${p}" fill="${stroke}"/>` : `<path d="${p}" fill="none" stroke="${stroke}" stroke-width="${ow}"/>`;
          }
          case "dot":
            return `<circle cx="${x}" cy="${midY}" r="2" fill="${stroke}"/>`;
          default:
            return "";
        }
      };
      out += glyph(filled);
      if (mk.shape === "triangle" && !filled) continue;   // контурный уже нарисован
    }
  }
  return out;
}
// ---------- инструменты: геометрия отдельно, слой отдельно (шаг 2) ----------
// Инструмент создаёт только геометрию; слой и стиль назначает активный слой.
const GEOM_OF_TOOL = { point: "point", polyline: "polyline",
                       polygon: "polygon", rect: "polygon", arc: "arc", circle: "circle" };
// какую геометрию собирает черчение (rect кликами = контур-полигон, dim — линия)
const TOOL_GEOM = { ...GEOM_OF_TOOL, dim: "polyline" };

function activeLayer() { return LAYER_BY_ID[state.activeLayerId] || null; }

function isDrawableLayer(layer) {
  return !!layer && !layer.annotation && !layer.import_only && !layer.locked;
}

function toolFitsLayer(tool, L) {
  const g = GEOM_OF_TOOL[tool];
  if (!g) return true;
  if (!isDrawableLayer(L)) return false;
  if (g === 'circle') return true; // все слои теперь поддерживают окружности
  return L.geometry_type === g;
}

function naturalToolFor(L) {
  return L.tool ||
    ({ point: "point", polyline: "polyline", polygon: "polygon", arc: "arc", circle: "circle" })[L.geometry_type];
}

function styleForDrawing() {
  if (state.tool === "dim") return STYLES_V2["dimension.line"];
  return layerStyle(activeLayer());
}
// семейства для подписи объектов (label_font.family слоя/объекта)
const LABEL_FONTS = {
  ui: "system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Menlo, monospace",
};
function labelOf(f) {
  const st = styleOf(f);
  return st.label_field ? f.props[st.label_field] : undefined;
}
function featuresOnLayer(id) {
  return state.features.filter(f => (layerOf(f) || {}).id === id);
}
// объект → формат v2: слой и тип геометрии явно; kind дописывается
// обратно для legacy-объектов (мигратор старых сцен и выгрузок ядра)
// координаты хранились с ~13 знаками после запятой (шум float-арифметики
// UTM−ORIGIN); реальная точность ≤ мм. Округляем до 4 знаков (0.1 мм) —
// геометрически lossless, но проект ужимается ~вдвое (меньше памяти, снимков
// отмены, автосейва). Применяется на всех загрузках/импортах через upgradeFeature.
const MAX_PROJECT_COORDINATE = 1e9;
const MAX_PROJECT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_JSON_IMPORT_BYTES = 64 * 1024 * 1024;
function isProjectCoordinate(value) {
  if (value === null || value === undefined ||
      (typeof value === "string" && !value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= MAX_PROJECT_COORDINATE;
}
function normalizedFloorCount(value) {
  const floors = Math.trunc(Number(value));
  return Number.isFinite(floors) && floors >= 1 && floors <= 75 ? floors : 9;
}
function roundCoords(f) {
  const r = n => {
    if (!isProjectCoordinate(n))
      throw new RangeError("coordinate outside supported range");
    const value = Number(n);
    return Math.round(value * 1e4) / 1e4;
  };
  const pts = f.ring || f.line || (f.point ? [f.point] : null);
  if (pts) for (const p of pts) { p[0] = r(p[0]); p[1] = r(p[1]); }
  if (f.arc) { f.arc.cx = r(f.arc.cx); f.arc.cy = r(f.arc.cy); f.arc.r = r(f.arc.r); }
  if (f.circle) { f.circle.cx = r(f.circle.cx); f.circle.cy = r(f.circle.cy); f.circle.r = r(f.circle.r); }
  return f;
}
function upgradeFeature(f, resolveLayer = layerOf) {
  const L = resolveLayer(f);
  if (L) { f.layer_id = L.id; if (!f.kind) f.kind = L.kind; }
  if (!f.props || typeof f.props !== "object" || Array.isArray(f.props)) f.props = {};
  if (f.kind === "building") f.props.floors = normalizedFloorCount(f.props.floors);
  f.geometry_type = f.point ? "point" : f.line ? "polyline" : f.arc ? "arc" : f.circle ? "circle" : "polygon";
  return roundCoords(f);
}

// импорт объектов из источника (НСПД / OSM / ГИС ОГД) с дедупликацией:
// каждый объект-источник несёт стабильный srcKey; повторная выгрузка той же
// территории пропускает уже присутствующие (не плодит дубликаты). Возвращает
// {added, dup, invalid}. Объекты без srcKey (напр. ручной импорт) добавляются
// всегда, а одна повреждённая геометрия не прерывает импорт всей подборки.
function importSourceFeatures(features) {
  const seen = new Set();
  for (const f of state.features) if (f.srcKey) seen.add(f.srcKey);
  let added = 0, dup = 0, invalid = 0;
  for (const f of features) {
    if (f.srcKey && seen.has(f.srcKey)) { dup++; continue; }
    let upgraded;
    try {
      upgraded = upgradeFeature({ id: state.nextId, ...f });
    } catch (error) {
      invalid++;
      console.warn("Пропущен объект с некорректной геометрией", error, f);
      continue;
    }
    if (f.srcKey) seen.add(f.srcKey);
    state.nextId++;
    state.features.push(upgraded);
    added++;
  }
  return { added, dup, invalid };
}

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
  const fieldsByLayer = normalizeImportFields(input.fieldsByLayer || input.fields);
  for (const layerId of Object.keys(fieldsByLayer))
    if (!LAYER_BY_ID[layerId] && !stagedLayerById.has(layerId))
      throw new Error(`Схема полей ссылается на неизвестный слой «${layerId}»`);

  const existingKeys = new Set();
  for (const feature of state.features) if (feature.srcKey) existingKeys.add(feature.srcKey);
  const batchKeys = new Set();
  const stagedFeatures = [];
  const addedByLayer = Object.create(null);
  const touchedLayerIds = new Set(Object.keys(fieldsByLayer));
  let nextId = state.nextId, dup = 0, invalid = 0;
  const invalidDetails = [];
  const resolveImportLayer = feature => {
    if (feature.layer_id)
      return stagedLayerById.get(feature.layer_id) || LAYER_BY_ID[feature.layer_id] || null;
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
    addedByLayer[targetLayer.id] = (addedByLayer[targetLayer.id] || 0) + 1;
    nextId++;
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
    return { added: plan.added, dup: plan.dup, invalid: plan.invalid };
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
  accessRadii: { on: false, r: 300 },        // радиусы доступности соцобъектов (визуальная помощь)
  layers: LAYER_BY_ID, styles: STYLES_V2,   // модель v2 (видимость — layer.visible)
  activeLayerId: null,            // куда чертят геом-инструменты (L2b: пусто до создания слоя)
  sources: [],                    // журнал источников (снимки НСПД/ФГИС ТП)
  styleOverrides: {},             // правки эталонных знаков (глобальные, с сервера)
  variants: [],                   // варианты концепции: снимки {id,name,features,params,createdAt}
  projectStyles: {},              // свои стили проекта: { "my_id": {fill, stroke, width, ... , title? } }
  projectCustomKinds: [],         // пользовательские роли/типы слоёв для этого проекта
  albumConfig: JSON.parse(JSON.stringify(DEFAULT_ALBUM_CONFIG)),
  _fitted: false, _ix: null,
};

function isHidden(f) { const L = layerOf(f); return L ? !L.visible : false; }
function isLocked(f) { const L = layerOf(f); return !!L && !!L.locked; }

let shiftDown = false, spaceDown = false;

// ---------- координаты ----------
function w2s(x, y) { return [state.view.tx + x * state.view.k, state.view.ty - y * state.view.k]; }
function s2w(sx, sy) { return [(sx - state.view.tx) / state.view.k, (state.view.ty - sy) / state.view.k]; }
// Все кольца объекта РЕФЕРЕНСАМИ (мутация на месте работает): у полигона —
// внешний контур + дыры, у линии — сама линия. Нужно, чтобы дыры участвовали
// в редактировании (ручки, перетаскивание вершин, перемещение/трансформации):
// раньше вся правка шла по featurePts = только внешнее кольцо, и у выколотого
// полигона вершины дыр не выделялись, а при перемещении дыры оставались на месте.
function featureRings(f) {
  if (f.ring) return f.holes && f.holes.length ? [f.ring, ...f.holes] : [f.ring];
  if (f.line) return [f.line];
  return [];
}
// Адрес плоского индекса вершины (0..внешнее−1, дальше дыры) → {arr, i}.
function vertexRef(f, vi) {
  for (const r of featureRings(f)) {
    if (vi < r.length) return { arr: r, i: vi };
    vi -= r.length;
  }
  return null;
}
// Все редактируемые точки объекта РЕФЕРЕНСАМИ плоским списком (внешний контур +
// дыры). flat() поверхностный — элементы те же ссылки на точки, поэтому мутация
// доходит до колец. Для дуги/окружности — featurePts (как было). Нужно, чтобы
// перемещение/трансформации двигали и дыры, а не только внешний контур.
function featureMovablePts(f) {
  const rings = featureRings(f);
  return rings.length ? rings.flat() : featurePts(f);
}
function featurePts(f) {
  if (f.ring || f.line) return f.ring || f.line;
  if (f.arc) {
    const a = f.arc; const n=8; const pts=[];
    for(let i=0;i<=n;i++){ const ang=a.a0 + a.sweep*i/n; pts.push([a.cx + a.r*Math.cos(ang), a.cy + a.r*Math.sin(ang)]); }
    return pts;
  }
  if (f.circle) {
    const c = f.circle;
    // center + cardinal points for handles (esp east for radius)
    return [
      [c.cx, c.cy],
      [c.cx + c.r, c.cy],
      [c.cx, c.cy + c.r],
      [c.cx - c.r, c.cy],
      [c.cx, c.cy - c.r]
    ];
  }
  return f.point ? [f.point] : [];
}
// экранные углы дуги для ctx.arc: мир Y-вверх, canvas Y-вниз → углы негируются,
// направление обхода инвертируется (мировой sweep>0 = anticlockwise на экране).
// Без этого дуга рисовалась зеркально (выгибалась не туда, мимо средней точки).
function arcScreenArgs(a) { return [-a.a0, -(a.a0 + a.sweep), a.sweep > 0]; }
function selectedFeature() { return state.features.find(x => x.id === state.selected); }
// множественное выделение: selectedIds — источник истины, selected — «первичный»
// (одиночный) объект для правки вершин и детальной панели свойств.
function selectionIds() { return [...(state.selectedIds || [])]; }
function selectionFeatures() {
  const s = state.selectedIds || new Set();
  return state.features.filter(f => s.has(f.id));
}
function selectOne(id) {
  state.selected = id;
  state.selectedIds = id == null ? new Set() : new Set([id]);
}
function clearSelection() { state.selected = null; state.selectedIds = new Set(); }
function setSelection(ids) {
  state.selectedIds = new Set(ids);
  state.selected = ids.length === 1 ? ids[0] : null;
}
function toggleSelection(id) {
  const s = state.selectedIds = new Set(state.selectedIds || []);
  if (s.has(id)) s.delete(id); else s.add(id);
  state.selected = s.size === 1 ? [...s][0] : null;
}
function vertexAt(f, wx, wy) {
  const tolW = 8 / state.view.k;
  if (f.arc) {
    const a = f.arc;
    const s = [a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)];
    const e = [a.cx + a.r * Math.cos(a.a0 + a.sweep), a.cy + a.r * Math.sin(a.a0 + a.sweep)];
    if (Math.hypot(s[0] - wx, s[1] - wy) < tolW) return 0; // start
    if (Math.hypot(e[0] - wx, e[1] - wy) < tolW) return 1; // end
    // center
    if (Math.hypot(a.cx - wx, a.cy - wy) < tolW) return 2;
    // любая точка на дуге — редактирование радиуса (логика редактирования дуг)
    const pts = featurePts(f);
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - wx, pts[i][1] - wy) < tolW) return 3;
    }
    return null;
  }
  if (f.circle) {
    const c = f.circle;
    if (Math.hypot(c.cx - wx, c.cy - wy) < tolW) return 0; // center
    // radius handle point (east)
    const rp = [c.cx + c.r, c.cy];
    if (Math.hypot(rp[0] - wx, rp[1] - wy) < tolW) return 1;
    return null;
  }
  // все кольца (внешний контур + дыры) плоским индексом: 0..внешнее−1, затем
  // вершины дыр — так вершину дыры можно схватить и тянуть/удалить
  let flat = 0;
  for (const ring of featureRings(f)) {
    for (let i = 0; i < ring.length; i++) {
      if (Math.hypot(ring[i][0] - wx, ring[i][1] - wy) < tolW) return flat + i;
    }
    flat += ring.length;
  }
  return null;
}

// Совместное редактирование границ покрытия: вершины других зон,
// совпадающие с данной, двигаются вместе с ней — общая граница остаётся
// общей, дырки и нахлёсты не возникают (инвариант coverage ядра).
// Кто участвует — решает флаг слоя topology="coverage", не тип объекта.
function isCoverageFeature(f) {
  const L = layerOf(f);
  return !!L && L.topology === "coverage";
}
function sharedCompanions(f, vi) {
  if (!isCoverageFeature(f)) return [];
  // общие границы — только у ВНЕШНЕГО контура; вершина дыры компаньонов не имеет
  const outer = featurePts(f);
  if (!outer || vi >= outer.length) return [];
  const [x, y] = outer[vi];
  const out = [];
  for (const other of state.features) {
    if (other.id === f.id || !isCoverageFeature(other) || isHidden(other)) continue;
    const pts = featurePts(other);
    for (let i = 0; i < pts.length; i++)
      if (Math.abs(pts[i][0] - x) < 1e-6 && Math.abs(pts[i][1] - y) < 1e-6)
        out.push({ f: other, vi: i });
  }
  return out;
}

// тянем ребро целиком (общая граница): оба конца на общий офсет от захвата +
// совпадающие вершины соседних coverage-зон (companions) следом
function applyEdgeDrag(ed, wx, wy) {
  const raw = ed.f.ring || ed.f.line;
  const ox = wx - ed.grab[0], oy = wy - ed.grab[1];
  raw[ed.i0][0] = ed.orig0[0] + ox; raw[ed.i0][1] = ed.orig0[1] + oy;
  raw[ed.i1][0] = ed.orig1[0] + ox; raw[ed.i1][1] = ed.orig1[1] + oy;
  for (const c of ed.comps0) { const cp = featurePts(c.f); cp[c.vi][0] = raw[ed.i0][0]; cp[c.vi][1] = raw[ed.i0][1]; }
  for (const c of ed.comps1) { const cp = featurePts(c.f); cp[c.vi][0] = raw[ed.i1][0]; cp[c.vi][1] = raw[ed.i1][1]; }
}
function sharedVertexSet(f) {
  const shared = new Set();
  if (!isCoverageFeature(f)) return shared;
  const pts = featurePts(f);
  for (let i = 0; i < pts.length; i++)
    if (sharedCompanions(f, i).length) shared.add(i);
  return shared;
}

// Safari отмечен глюками ResizeObserver + <canvas>: назначение canvas.width
// сбрасывает битмап, и если наблюдатель перевызывает resize() синхронно
// в цикле (даже когда CSS-размер элемента фактически не изменился),
// холст может гаситься быстрее, чем успевает перерисоваться — экран
// «на секунду показывает точки сетки и белеет». Защита: (1) менять
// битмап только когда размер реально изменился; (2) события наблюдателя
// схлопывать через requestAnimationFrame, чтобы разорвать возможный
// синхронный цикл переисчисления layout.
let lastBufW = 0, lastBufH = 0;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (w === lastBufW && h === lastBufH) { draw(); return; }
  lastBufW = w; lastBufH = h;
  cv.width = w; cv.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.features.length && !state._fitted) {
    state._fitted = true;
    fitView();
    return;
  }
  draw();
}
window.addEventListener("resize", resize);
let roPending = false;
new ResizeObserver(() => {
  if (roPending) return;
  roPending = true;
  requestAnimationFrame(() => { roPending = false; resize(); });
}).observe(cv);

// ---------- сетка ----------
// Авто-шаг: первый из ряда, дающий на экране >= 22 px. Ряд расширен в обе
// стороны под новые пределы зума (K_MIN/K_MAX): без мелких ступеней сетка на
// приближении застревала на 1 м (одна линия через пол-экрана), без крупных —
// на отдалении вырождалась в сплошную кашу с шагом 10 px. На привычных зумах
// выбор не изменился (напр. k≈1 → по-прежнему 50 м).
function gridStep() {
  if (state.gridMode !== "auto") return +state.gridMode;
  for (const g of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000])
    if (g * state.view.k >= 22) return g;
  return 10000;
}

// ---------- подложка (тайлы XYZ) ----------
// Геометрия проекта хранится в точных метрах EPSG:32637−ORIGIN. Подложка,
// экстент и импорты обязаны использовать ту же проекцию: линейное
// «метров на градус» не учитывает сближение меридианов и сдвигает тайлы
// по востоку/западу при удалении от точки ORIGIN.
const exactCrs = window.GRADO_CRS;
if (!exactCrs) throw new Error("Не загружен модуль точных преобразований координат");
const basemap = {
  on: false, source: "osm", opacity: 0.85, originLon: null, originLat: null,
  attribution: "", attributions: {},
  cache: new Map(),   // "src/z/x/y" -> {img, loaded, failed}
};

async function initBasemap() {
  try {
    const r = await fetch("/api/basemap-info");
    const d = await r.json();
    basemap.originLon = d.origin_lon;
    basemap.originLat = d.origin_lat;
    basemap.attributions = d.attributions || { osm: d.attribution };
    basemap.attribution = basemap.attributions[basemap.source] || d.attribution;
  } catch (e) { /* сервер без /api/basemap-info — подложка недоступна */ }
}

// переключение источника подложки (карта OSM ↔ спутник ESRI): чужие тайлы
// из кэша убираем, подпись — по источнику
function setBasemapSource(src) {
  basemap.source = src;
  basemap.attribution = basemap.attributions[src] || basemap.attribution;
  basemap.cache.clear();
  draw();
}

function localToLonLat(x, y) {
  return exactCrs.localToWgs84([x, y]);
}
function lonLatToLocal(lon, lat) {
  return exactCrs.wgs84ToLocal([lon, lat]);
}
function lonToTileX(lon, z) { return (lon + 180) / 360 * 2 ** z; }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
}
function tileXToLon(tx, z) { return tx / 2 ** z * 360 - 180; }
function tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileImage(z, x, y) {
  const key = `${basemap.source}/${z}/${x}/${y}`;
  let e = basemap.cache.get(key);
  if (!e) {
    e = { img: new Image(), loaded: false, failed: false };
    e.img.onload = () => { e.loaded = true; draw(); };
    e.img.onerror = () => { e.failed = true; };
    e.img.src = window.gradoTileUrl
      ? window.gradoTileUrl(z, x, y, basemap.source)
      : `/api/tiles/${z}/${x}/${y}.png?src=${basemap.source}`;
    basemap.cache.set(key, e);
  }
  return e;
}

function drawBasemap(w, h) {
  if (!basemap.on || basemap.originLon == null) return;
  const geoCorners = [[0, 0], [w, 0], [w, h], [0, h]]
    .map(([sx, sy]) => localToLonLat(...s2w(sx, sy)));
  const lons = geoCorners.map(point => point[0]);
  const lats = geoCorners.map(point => point[1]);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  // подбор зума: метры на тайл-пиксель ≈ метры на экранный пиксель
  const mppTile0 = 156543.03392804097 * Math.cos(basemap.originLat * Math.PI / 180);
  let z = Math.round(Math.log2(mppTile0 * state.view.k));
  z = Math.max(1, Math.min(19, z));

  const txMin = Math.floor(lonToTileX(lonMin, z));
  const txMax = Math.floor(lonToTileX(lonMax, z));
  const tyMin = Math.floor(latToTileY(latMax, z));
  const tyMax = Math.floor(latToTileY(latMin, z));
  const maxTiles = 2 ** z;
  const budget = 300;  // защита от случайного запроса тысяч тайлов при рывке зума
  let drawn = 0;
  ctx.save();
  ctx.globalAlpha = basemap.opacity;
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (++drawn > budget) break;
      const cx = ((tx % maxTiles) + maxTiles) % maxTiles;
      if (ty < 0 || ty >= maxTiles) continue;
      const e = tileImage(z, cx, ty);
      if (!e.loaded) continue;
      const nw = lonLatToLocal(tileXToLon(tx, z), tileYToLat(ty, z));
      const ne = lonLatToLocal(tileXToLon(tx + 1, z), tileYToLat(ty, z));
      const sw = lonLatToLocal(tileXToLon(tx, z), tileYToLat(ty + 1, z));
      const p00 = w2s(...nw), p10 = w2s(...ne), p01 = w2s(...sw);
      const iw = e.img.naturalWidth || 256, ih = e.img.naturalHeight || 256;
      // UTM grid north is rotated against geographic north. Three projected
      // corners define the tile affine transform and preserve that convergence.
      ctx.save();
      ctx.transform((p10[0] - p00[0]) / iw, (p10[1] - p00[1]) / iw,
        (p01[0] - p00[0]) / ih, (p01[1] - p00[1]) / ih, p00[0], p00[1]);
      // half-source-pixel bleed hides antialiasing seams between neighbours.
      ctx.drawImage(e.img, -0.5, -0.5, iw + 1, ih + 1);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.fillRect(6, h - 18, ctx.measureText(basemap.attribution).width + 14, 14);
  ctx.fillStyle = "#5c5a54"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(basemap.attribution, 10, h - 7);
}

// ---------- геометрия ----------
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
// Площадь полигона С УЧЁТОМ дыр: выколотая часть не принадлежит объекту, иначе
// ТЭП считал бы её как зону (выколотые полигоны ОГД). Знак обхода колец в
// данных портала не гарантирован, поэтому вычитаем модуль площади каждой дыры.
function featureArea(f) {
  if (!f || !f.ring) return 0;
  let a = ringArea(f.ring);
  for (const h of f.holes || []) {
    if (h && h.length >= 3) a -= ringArea(h);
  }
  return Math.max(0, a);
}
function lineLen(line) {
  let s = 0;
  for (let i = 0; i + 1 < line.length; i++)
    s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return s;
}
// единые форматтеры отображения — одна точность везде (длины/координаты 1 знак,
// площади в гектарах 2 знака). Возвращают строку без хвостовой единицы там,
// где единица дописывается на месте (fmtCoord), и с единицей — где удобно.
function fmtLen(m) { return (+m).toFixed(1) + " м"; }
function fmtCoord(m) { return (+m).toFixed(1); }
function fmtAreaHa(m2) { return (m2 / 10000).toFixed(2) + " га"; }
// Точка внутри полигона С УЧЁТОМ дыр: в выколотой части объекта нет, поэтому
// клик там не должен его выбирать (и «Данные по области» не должны считать её
// своей). Границу дыры ловит отдельно nearRing — за контур схватить можно.
function pointInPolygon(x, y, f) {
  if (!f.ring || !pointInRing(x, y, f.ring)) return false;
  for (const h of f.holes || []) {
    if (h && h.length >= 3 && pointInRing(x, y, h)) return false;
  }
  return true;
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}
function nearChain(x, y, chain, tolW) {
  for (let i = 0; i + 1 < chain.length; i++) {
    const q = nearestOnSeg([x, y], chain[i], chain[i + 1]);
    if (Math.hypot(x - q[0], y - q[1]) < tolW) return i;
  }
  return null;
}
function segIntersect(a0, a1, b0, b1) {
  const d0 = [a1[0] - a0[0], a1[1] - a0[1]], d1 = [b1[0] - b0[0], b1[1] - b0[1]];
  const det = d0[0] * d1[1] - d0[1] * d1[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * d1[1] - (b0[1] - a0[1]) * d1[0]) / det;
  const u = ((b0[0] - a0[0]) * d0[1] - (b0[1] - a0[1]) * d0[0]) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a0[0] + d0[0] * t, a0[1] + d0[1] * t];
}
// параметр t точки p на прямой a-b (0 = a, 1 = b), без ограничения диапазона
function paramOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
}
// пересечение луча a→b, продолженного ЗА b (t>=1), с ограниченным отрезком c-d
// (u в [0,1]) — для продления линии до границы
function rayIntersect(a, b, c, d) {
  const d0 = [b[0] - a[0], b[1] - a[1]], d1 = [d[0] - c[0], d[1] - c[1]];
  const det = d0[0] * d1[1] - d0[1] * d1[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((c[0] - a[0]) * d1[1] - (c[1] - a[1]) * d1[0]) / det;
  const u = ((c[0] - a[0]) * d0[1] - (c[1] - a[1]) * d0[0]) / det;
  if (t < 1 - 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + d0[0] * t, a[1] + d0[1] * t];
}

// пересечение отрезка a-b с окружностью (c,r) — возвращает точки на отрезке
function circleIntersect(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c[0], fy = a[1] - c[1];
  const aa = dx*dx + dy*dy;
  const bb = 2 * (fx*dx + fy*dy);
  const cc = fx*fx + fy*fy - r*r;
  const disc = bb*bb - 4*aa*cc;
  if (disc < 0) return [];
  const sd = Math.sqrt(disc);
  const t1 = (-bb - sd) / (2*aa);
  const t2 = (-bb + sd) / (2*aa);
  const res = [];
  if (t1 >= 0 && t1 <= 1) res.push([a[0] + t1*dx, a[1] + t1*dy]);
  if (t2 >= 0 && t2 <= 1 && Math.abs(t2-t1) > 1e-9) res.push([a[0] + t2*dx, a[1] + t2*dy]);
  return res;
}

// Доп. утилиты для точной работы окружностей как границ (trim/extend)
function circleCircleIntersections(cx1, cy1, r1, cx2, cy2, r2) {
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d + 1e-9 < Math.abs(r1 - r2) || d < 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hh = r1 * r1 - a * a;
  if (hh < 0) return [];
  const h = Math.sqrt(hh);
  const xm = cx1 + a * dx / d;
  const ym = cy1 + a * dy / d;
  const res = [[xm + h * dy / d, ym - h * dx / d]];
  if (h > 1e-9) res.push([xm - h * dy / d, ym + h * dx / d]);
  return res;
}
// пересечения отрезка [a,b] с окружностью (cx,cy,r) — точки в пределах отрезка
function segCircleIntersections(a, b, cx, cy, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - cx, fy = a[1] - cy;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  disc = Math.sqrt(disc);
  const out = [];
  for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)])
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push([a[0] + t * dx, a[1] + t * dy]);
  return out;
}
function isAngleInSweep(ang, a0, sweep) {
  if (Math.abs(sweep) < 1e-9) return false;
  const PI2 = 2 * Math.PI;
  let d = ((ang - a0) % PI2 + PI2) % PI2;
  if (sweep > 0) {
    return d >= -1e-9 && d <= sweep + 1e-9;
  } else {
    let dd = ((a0 - ang) % PI2 + PI2) % PI2;
    return dd >= -1e-9 && dd <= (-sweep) + 1e-9;
  }
}
function locateOnChain(chain, q) {
  if (!chain || chain.length < 2) return { i: -1, t: 0, d: 1e9 };
  let best = { i: 0, t: 0, d: 1e9 };
  for (let i = 0; i + 1 < chain.length; i++) {
    const proj = nearestOnSeg(q, chain[i], chain[i + 1]);
    const d = Math.hypot(proj[0] - q[0], proj[1] - q[1]);
    if (d < best.d) {
      const t = paramOnSeg(proj, chain[i], chain[i + 1]);
      best = { i, t, d };
    }
  }
  return best;
}

// Полноценный trim/ extend для дуг с сохранением arc-параметров (cx,cy,r,a0,sweep)
function trimArcAt(f, wx, wy, boundaryIds) {
  const arc = f.arc;
  const chain = featurePts(f);
  const tolW = 10 / state.view.k;
  const si = nearChain(wx, wy, chain, tolW);
  if (si == null) return false;
  const sa = chain[si], sb = chain[si+1];
  const tClick = paramOnSeg(nearestOnSeg([wx, wy], sa, sb), sa, sb);
  let bestP = null;
  let bestT = 1e9;
  let bestDistCircle = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle;
      let cands = [];
      // точные пересечения двух окружностей + фильтр по дуге
      try {
        const ints = circleCircleIntersections(arc.cx, arc.cy, arc.r, cs.cx, cs.cy, cs.r);
        for (let pt of ints) {
          const ang = Math.atan2(pt[1] - arc.cy, pt[0] - arc.cx);
          if (isAngleInSweep(ang, arc.a0, arc.sweep)) cands.push(pt);
        }
      } catch (e) {}
      if (cands.length === 0) {
        // fallback: по всем сегментам сэмпла
        for (let j = 0; j + 1 < chain.length; j++) {
          const ps = circleIntersect(chain[j], chain[j + 1], [cs.cx, cs.cy], cs.r);
          cands.push(...ps);
        }
      }
      for (let p of cands) {
        const d = Math.hypot(p[0] - wx, p[1] - wy);
        if (bestP == null || d < bestDistCircle) {
          bestDistCircle = d;
          bestP = p;
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf)) {
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = segIntersect(sa, sb, bchain[j], bchain[j+1]);
        if (!p) continue;
        const t = paramOnSeg(p, sa, sb);
        if (Math.abs(t - tClick) < Math.abs(bestT - tClick)) {
          bestP = p;
          bestT = t;
        }
      }
    }
  }
  if (!bestP) return false;
  snapshot();
  const pAng = Math.atan2(bestP[1] - arc.cy, bestP[0] - arc.cx);
  const a0 = arc.a0;
  const sw = arc.sweep;
  const eAng = a0 + sw;
  // для circle-boundary используем closest к клику + проверка углов для выбора стороны
  // (глобальный поиск позволяет кликать не точно на сэмпл-сегменте)
  if (bestDistCircle != null) {
    const cAng = Math.atan2(wy - arc.cy, wx - arc.cx);
    const cand1 = { a0: a0, sw: pAng - a0 }; // keep start..p
    const cand2 = { a0: pAng, sw: eAng - pAng }; // keep p..end
    const n1 = (cand1.sw > Math.PI ? cand1.sw - 2*Math.PI : (cand1.sw < -Math.PI ? cand1.sw + 2*Math.PI : cand1.sw));
    const n2 = (cand2.sw > Math.PI ? cand2.sw - 2*Math.PI : (cand2.sw < -Math.PI ? cand2.sw + 2*Math.PI : cand2.sw));
    const in1 = isAngleInSweep(cAng, cand1.a0, n1);
    const in2 = isAngleInSweep(cAng, cand2.a0, n2);
    if (in1 && !in2) {
      arc.a0 = pAng; arc.sweep = eAng - pAng;
    } else if (in2 && !in1) {
      arc.a0 = a0; arc.sweep = pAng - a0;
    } else {
      // fallback по углам
      if ((cAng - a0) > (pAng - a0)) arc.sweep = pAng - a0; else { arc.a0 = pAng; arc.sweep = eAng - pAng; }
    }
  } else if (tClick > bestT) {
    arc.sweep = pAng - a0;
  } else {
    arc.a0 = pAng;
    arc.sweep = eAng - pAng;
  }
  arc.sweep = sweepLike(arc.sweep, sw);
  afterChange();
  return true;
}

// Развёртка после обрезки/продления. Зажимать сырую разность atan2-углов в
// ±180° нельзя: дуга больше полуокружности (arcFrom3Pts строит такие намеренно)
// превращалась в своё дополнение с ДРУГОЙ стороны окружности — оставался не тот
// кусок, по которому кликнули. Приводим к направлению исходного обхода,
// сохраняя величину вплоть до полного круга.
function sweepLike(sweep, ref) {
  if (!Number.isFinite(sweep)) return sweep;
  const TAU = 2 * Math.PI;
  let s = sweep % TAU;
  if (Math.abs(s) < 1e-9) return 0;
  if (ref >= 0 && s < 0) s += TAU;
  if (ref < 0 && s > 0) s -= TAU;
  return s;
}

function extendArcAt(f, wx, wy, boundaryIds) {
  const arc = f.arc;
  const chain = featurePts(f);
  const tolW = 14 / state.view.k;
  const n = chain.length;
  const dStart = Math.hypot(wx - chain[0][0], wy - chain[0][1]);
  const dEnd = Math.hypot(wx - chain[n-1][0], wy - chain[n-1][1]);
  if (dStart >= tolW && dEnd >= tolW) return false;
  const extEnd = dEnd <= dStart;
  const idxA = extEnd ? n-2 : 1;
  const idxB = extEnd ? n-1 : 0;
  const aa = chain[idxA], bb = chain[idxB];
  let bestP = null;
  let minDist = 1e9;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      const dx = bb[0]-aa[0], dy = bb[1]-aa[1];
      const fx = aa[0]-cc[0], fy = aa[1]-cc[1];
      const aa_ = dx*dx + dy*dy;
      const bb_ = 2*(fx*dx + fy*dy);
      const cc_ = fx*fx + fy*fy - rr*rr;
      const disc = bb_*bb_ - 4*aa_*cc_;
      if (disc >= 0) {
        const sd = Math.sqrt(disc);
        const t1 = (-bb_ - sd)/(2*aa_);
        const t2 = (-bb_ + sd)/(2*aa_);
        for (let t of [t1, t2]) {
          if (t >= 1 - 1e-9) {
            const p = [aa[0] + t*dx, aa[1] + t*dy];
            const dist = Math.hypot(p[0] - bb[0], p[1] - bb[1]);
            if (dist < minDist) {
              minDist = dist;
              bestP = p;
            }
          }
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf)) {
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = rayIntersect(aa, bb, bchain[j], bchain[j+1]);
        if (!p) continue;
        const dist = Math.hypot(p[0] - bb[0], p[1] - bb[1]);
        if (dist < minDist) {
          minDist = dist;
          bestP = p;
        }
      }
    }
  }
  if (!bestP) return false;
  snapshot();
  const pAng = Math.atan2(bestP[1] - arc.cy, bestP[0] - arc.cx);
  const sw0 = arc.sweep;
  if (extEnd) {
    arc.sweep = pAng - arc.a0;
  } else {
    const eAng = arc.a0 + arc.sweep;
    arc.a0 = pAng;
    arc.sweep = eAng - pAng;
  }
  arc.sweep = sweepLike(arc.sweep, sw0);
  afterChange();
  return true;
}

// обрезка: si — сегмент клика на f.line, boundaryIds — выбранные линии-границы.
// Отсекается та часть сегмента, где был клик, вплоть до ближайшего пересечения.
function trimLineAt(f, wx, wy, boundaryIds) {
  let chain = f.line;
  if (!chain || chain.length < 2) return false;
  const tolW = 10 / state.view.k;
  const si = nearChain(wx, wy, chain, tolW);
  if (si == null) return false;
  const a = chain[si], b = chain[si + 1];
  const tClick = paramOnSeg(nearestOnSeg([wx, wy], a, b), a, b);
  let best = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      // глобальный поиск по всей линии (не только клик-сегмент) — клик в "лишний кусок" находит ближайшее пересечение с окружностью
      for (let j = 0; j + 1 < chain.length; j++) {
        const ps = circleIntersect(chain[j], chain[j + 1], cc, rr);
        for (let p of ps) {
          const dd = Math.hypot(p[0] - wx, p[1] - wy);
          if (!best || (best.dd != null ? dd < best.dd : true)) {
            best = { p, dd, fromCircle: true };
          }
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf))
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = segIntersect(a, b, bchain[j], bchain[j + 1]);
        if (!p) continue;
        const t = paramOnSeg(p, a, b);
        if (!best || Math.abs(t - tClick) < Math.abs(best.t - tClick)) best = { t, p };
      }
  }
  if (!best) return false;
  snapshot();
  if (best.fromCircle || best.dd != null) {
    // обобщённое решение стороны по позиции клика и p на всей цепочке
    const locC = locateOnChain(chain, [wx, wy]);
    const locP = locateOnChain(chain, best.p);
    const clickAfter = (locC.i > locP.i) || (locC.i === locP.i && locC.t > locP.t + 1e-9);
    const k = locP.i >= 0 ? locP.i : si;
    f.line = clickAfter
      ? [...chain.slice(0, k + 1), best.p]
      : [best.p, ...chain.slice(k + 1)];
  } else {
    const newChain = tClick > best.t
      ? [...chain.slice(0, si + 1), best.p]
      : [best.p, ...chain.slice(si + 1)];
    f.line = newChain;
  }
  afterChange();
  return true;
}
// продление: клик у открытого конца f.line — тянем его до пересечения с
// ближайшей выбранной границей (не заходя ЗА границу, u в [0,1] на ней)
function extendLineAt(f, wx, wy, boundaryIds) {
  let chain = f.line;
  if (!chain || chain.length < 2 || !chain[0] || !chain[chain.length-1]) return false;
  const tolW = 14 / state.view.k, n = chain.length;
  const dStart = Math.hypot(wx - chain[0][0], wy - chain[0][1]);
  const dEnd = Math.hypot(wx - chain[n - 1][0], wy - chain[n - 1][1]);
  if (dStart >= tolW && dEnd >= tolW) return false;
  const end = dEnd <= dStart;
  const a = end ? chain[n - 2] : chain[1];
  const b = end ? chain[n - 1] : chain[0];
  let best = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      const dx = b[0]-a[0], dy = b[1]-a[1];
      const fx = a[0]-cc[0], fy = a[1]-cc[1];
      const aa = dx*dx + dy*dy;
      const bb = 2*(fx*dx + fy*dy);
      const cc_ = fx*fx + fy*fy - rr*rr;
      const disc = bb*bb - 4*aa*cc_;
      if (disc < 0) { /* no */ } else {
        const sd = Math.sqrt(disc);
        const t1 = (-bb - sd)/(2*aa);
        const t2 = (-bb + sd)/(2*aa);
        for (let t of [t1,t2]) {
          if (t >= 1 - 1e-9) {
            const p = [a[0] + t*dx, a[1] + t*dy];
            const dist = Math.hypot(p[0] - b[0], p[1] - b[1]);
            if (!best || dist < best.dist) best = { p, dist };
          }
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf))
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = rayIntersect(a, b, bchain[j], bchain[j + 1]);
        if (!p) continue;
        const dist = Math.hypot(p[0] - b[0], p[1] - b[1]);
        if (!best || dist < best.dist) best = { p, dist };
      }
  }
  if (!best) return false;
  snapshot();
  if (end) chain[n - 1] = best.p; else chain[0] = best.p;
  afterChange();
  return true;
}
// клик в режиме trim/extend: пока границы не подтверждены (Enter) — клик по
// линии переключает её как границу; после подтверждения — клик режет/тянет цель
function handleTrimExtendClick(wx, wy) {
  const ctx2 = state.trimCtx;
  if (!ctx2) return;
  const f = hitTest(wx, wy);
  if (!ctx2.ready) {
    if (!f || (!f.line && !f.ring && !f.arc && !f.circle)) return;
    if (ctx2.boundary.has(f.id)) ctx2.boundary.delete(f.id); else ctx2.boundary.add(f.id);
    draw();
    toast(`Границы: ${ctx2.boundary.size}. Enter — дальше, ${state.tool === "trim" ? "клик по лишнему куску" : "клик у открытого конца"}`);
    return;
  }
  if (!f || (!f.line && !f.arc)) { toast("Цель должна быть полилинией или дугой (не границей)", "warn"); return; }
  if (ctx2.boundary.has(f.id)) { toast("Это выбрано как граница", "warn"); return; }
  const ok = f.arc
    ? (state.tool === "trim" ? trimArcAt(f, wx, wy, ctx2.boundary) : extendArcAt(f, wx, wy, ctx2.boundary))
    : (state.tool === "trim" ? trimLineAt(f, wx, wy, ctx2.boundary) : extendLineAt(f, wx, wy, ctx2.boundary));
  if (ok) {
    setSelection([f.id]);
    draw();
    renderProps();
  } else {
    toast("Нет пересечения с границей рядом с этой точкой", "warn");
  }
}
// склейка выбранных линий в одну — цепочкой по совпадающим (с допуском)
// концам; конец «подтягивается» к точке уже собранной цепочки (снап впритык)
function joinSelected() {
  const feats = selectionFeatures().filter(f => (f.line && f.line.length >= 2) || f.arc);
  if (feats.length < 2) { toast("Выберите минимум 2 линии/дуги для склейки", "warn"); return; }
  // дугу аппроксимируем точками БЕЗ мутации оригинала — иначе при неудачной
  // склейке (ранний выход ниже) у дуги остался бы паразитный f.line + флаг
  const tol = 10 / state.view.k;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const ptsOf = f => (f.line && f.line.length) ? f.line.map(p => [...p]) : featurePts(f).map(p => [...p]);
  const items = feats.map(f => ({ id: f.id, pts: ptsOf(f) }));
  let chainPts = items[0].pts;
  const mergedIds = new Set([items[0].id]);
  const remaining = items.slice(1);
  let progress = true;
  while (progress && remaining.length) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i].pts;
      const cs = chainPts[0], ce = chainPts[chainPts.length - 1];
      const ps = p[0], pe = p[p.length - 1];
      let next = null;
      if (dist(ce, ps) < tol) next = chainPts.concat(p.slice(1));
      else if (dist(ce, pe) < tol) next = chainPts.concat([...p].reverse().slice(1));
      else if (dist(cs, pe) < tol) next = p.slice(0, -1).concat(chainPts);
      else if (dist(cs, ps) < tol) next = [...p].reverse().slice(0, -1).concat(chainPts);
      if (next) { chainPts = next; mergedIds.add(remaining[i].id); remaining.splice(i, 1); progress = true; break; }
    }
  }
  if (mergedIds.size < 2) { toast("Концы линий/дуг не совпадают в пределах допуска", "warn"); return; }
  snapshot();
  const keep = feats.find(f => f.id === items[0].id);
  keep.line = chainPts;
  delete keep.arc;
  keep.geometry_type = "polyline";   // дуга склеилась в полилинию
  // improve join per plan: carry over radius (fillet) from originals so new join corner gets filleted in draw (generalized now)
  const maxR = Math.max(0, ...feats.map(f => (f.props && f.props.radius) || 0));
  if (maxR > 0) {
    if (!keep.props) keep.props = {};
    keep.props.radius = maxR;
  }
  state.features = state.features.filter(f => !mergedIds.has(f.id) || f.id === keep.id);
  setSelection([keep.id]);
  afterChange();
  toast(mergedIds.size < feats.length
    ? `Склеено ${mergedIds.size} из ${feats.length} линий — остальные не касаются концами`
    : "Линии склеены");
}

// fillet polyline at corners with radius r, sampling arcs. For "полные сопряжения"
function filletLine(pts, r) {
  if (!pts || pts.length < 3 || !(r > 0)) return pts;
  const res = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i-1], p1 = pts[i], p2 = pts[i+1];
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]];
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    if (l1 < 1e-6 || l2 < 1e-6) { res.push(p1); continue; }
    const u1 = [v1[0]/l1, v1[1]/l1];
    const u2 = [v2[0]/l2, v2[1]/l2];
    let dot = u1[0]*u2[0] + u1[1]*u2[1];
    dot = Math.max(-1, Math.min(1, dot));
    let ang = Math.acos(dot);
    if (ang < 1e-4 || ang > Math.PI - 1e-4) { res.push(p1); continue; }
    const d = r / Math.tan(ang / 2);
    if (d > l1 || d > l2) { res.push(p1); continue; }
    const q1 = [p1[0] - u1[0]*d, p1[1] - u1[1]*d];
    const q2 = [p1[0] + u2[0]*d, p1[1] + u2[1]*d];   // вперёд по исходящему ребру (был баг знака)
    res.push(q1);
    // center using perps
    const perp1 = [-u1[1], u1[0]];
    const perp2 = [-u2[1], u2[0]];
    const dx = q2[0] - q1[0], dy = q2[1] - q1[1];
    const det = perp1[0]*perp2[1] - perp1[1]*perp2[0];
    if (Math.abs(det) < 1e-9) { res.push(q2); continue; }
    const t = (dx * perp2[1] - dy * perp2[0]) / det;
    const cx = q1[0] + t * perp1[0];
    const cy = q1[1] + t * perp1[1];
    let a0 = Math.atan2(q1[1] - cy, q1[0] - cx);
    let a1 = Math.atan2(q2[1] - cy, q2[0] - cx);
    let sw = a1 - a0;
    const cross = v1[0]*v2[1] - v1[1]*v2[0];
    if (cross < 0) {
      if (sw > 0) sw -= 2 * Math.PI;
    } else {
      if (sw < 0) sw += 2 * Math.PI;
    }
    const n = 6;
    for (let k = 1; k < n; k++) {
      const aa = a0 + sw * (k / n);
      res.push([cx + r * Math.cos(aa), cy + r * Math.sin(aa)]);
    }
    res.push(q2);
  }
  res.push(pts[pts.length - 1]);
  return res;
}

function applyFillet(f) {
  if (!f || !f.line || !(f.props.radius > 0)) return;
  snapshot();
  f.line = filletLine(f.line, f.props.radius);
  f.props.radius = 0;
  afterChange();
  renderProps();
}

// дуга скругления ОДНОГО угла p0-p1-p2 радиусом r: массив точек, заменяющих
// вершину p1 (без неё самой). null — угол прямой/вырожденный. Радиус ужимается,
// если не помещается в короткое ребро. Число сегментов адаптивно к длине дуги.
function cornerArcPoints(p0, p1, p2, r) {
  const v1 = [p1[0] - p0[0], p1[1] - p0[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
  const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
  if (l1 < 1e-6 || l2 < 1e-6) return null;
  const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
  const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const ang = Math.acos(dot);
  if (ang < 1e-3 || ang > Math.PI - 1e-3) return null;   // прямая — скруглять нечего
  let d = r / Math.tan(ang / 2);
  d = Math.min(d, l1 * 0.999, l2 * 0.999);               // не длиннее рёбер
  const rEff = d * Math.tan(ang / 2);                    // реальный радиус (если ужали)
  // касательные точки: q1 назад по входящему ребру (к p0), q2 вперёд по
  // исходящему (к p2). Оба на расстоянии d от угла p1.
  const q1 = [p1[0] - u1[0] * d, p1[1] - u1[1] * d], q2 = [p1[0] + u2[0] * d, p1[1] + u2[1] * d];
  const perp1 = [-u1[1], u1[0]], perp2 = [-u2[1], u2[0]];
  const det = perp1[0] * perp2[1] - perp1[1] * perp2[0];
  if (Math.abs(det) < 1e-9) return null;
  const dx = q2[0] - q1[0], dy = q2[1] - q1[1];
  const t = (dx * perp2[1] - dy * perp2[0]) / det;
  const cx = q1[0] + t * perp1[0], cy = q1[1] + t * perp1[1];
  const a0 = Math.atan2(q1[1] - cy, q1[0] - cx), a1 = Math.atan2(q2[1] - cy, q2[0] - cx);
  let sw = a1 - a0;
  const cross = v1[0] * v2[1] - v1[1] * v2[0];
  if (cross < 0) { if (sw > 0) sw -= 2 * Math.PI; } else { if (sw < 0) sw += 2 * Math.PI; }
  const n = Math.max(4, Math.min(48, Math.ceil(Math.abs(sw) * rEff / 2)));
  const out = [q1];
  for (let k = 1; k < n; k++) {
    const aa = a0 + sw * (k / n);
    out.push([cx + rEff * Math.cos(aa), cy + rEff * Math.sin(aa)]);
  }
  out.push(q2);
  return out;
}
// сопрячь угол, ближайший к (wx,wy), у линии/кольца f радиусом r
function filletCornerAt(f, wx, wy, r) {
  const closed = !!f.ring;
  const chain = f.ring || f.line;
  if (!chain || chain.length < 3) return false;
  const tolW = 14 / state.view.k;
  // eligible corners: для линии — внутренние (1..n-2); для кольца — все (wrap)
  let best = null;
  const n = chain.length;
  const lo = closed ? 0 : 1, hi = closed ? n : n - 1;
  for (let i = lo; i < hi; i++) {
    const d = Math.hypot(chain[i][0] - wx, chain[i][1] - wy);
    if (d < tolW && (!best || d < best.d)) best = { i, d };
  }
  if (!best) return false;
  const i = best.i;
  const p0 = chain[(i - 1 + n) % n], p1 = chain[i], p2 = chain[(i + 1) % n];
  const arc = cornerArcPoints(p0, p1, p2, r);
  if (!arc) { toast("Этот угол не скруглить (прямой или радиус слишком мал)", "warn"); return false; }
  snapshot();
  chain.splice(i, 1, ...arc);   // заменить вершину дугой
  afterChange();
  return true;
}
function handleFilletClick(wx, wy) {
  const f = hitTest(wx, wy);
  if (!f || !(f.line || f.ring)) { toast("Кликните по углу линии или контура", "warn"); return; }
  const r = state.filletRadius > 0 ? state.filletRadius : 10;
  if (!filletCornerAt(f, wx, wy, r))
    toast("Наведите точнее на угол (вершину) линии/контура", "warn");
}
async function promptFilletRadius() {
  const cur = state.filletRadius > 0 ? state.filletRadius : 10;
  const v = await uiPrompt("Радиус сопряжения, м:", String(cur), { ok: "OK", placeholder: "10" });
  if (v == null) return;
  const r = Math.max(0.1, parseFloat(String(v).replace(",", ".")) || cur);
  state.filletRadius = r;
  toast(`Сопряжение R=${r} м — кликайте по углам линий`);
}


function lastDrawingPt() {
  if (!state.drawing) return null;
  const pts = state.drawing.pts;
  if (Array.isArray(pts) && pts.length > 0) {
    return pts[pts.length - 1];
  }
  if (state.drawing.center) {
    return state.drawing.center;
  }
  return null;
}


// ---------- отрисовка ----------
function drawChain(chain, close) {
  if (!chain || !chain.length || !chain[0]) return;
  ctx.beginPath();
  ctx.moveTo(...w2s(...chain[0]));
  for (let i = 1; i < chain.length; i++) ctx.lineTo(...w2s(...chain[i]));
  if (close) ctx.closePath();
}

// Дыры полигона (выколотые полигоны ОГД). Внутренние кольца добавляются
// ПОДПУТЯМИ в уже начатый путь (beginPath сделал drawChain) — заливка по
// "evenodd" тогда оставляет дыру дырой независимо от направления обхода
// кольца (в данных портала оно не гарантировано, на nonzero дыра пропала бы).
// Обводка идёт по всем кольцам — контур дыры виден, как и должен.
function addHoleSubpaths(holes) {
  if (!holes || !holes.length) return false;
  let added = false;
  for (const h of holes) {
    if (!h || h.length < 3) continue;
    ctx.moveTo(...w2s(...h[0]));
    for (let i = 1; i < h.length; i++) ctx.lineTo(...w2s(...h[i]));
    ctx.closePath();
    added = true;
  }
  return added;
}

function drawGrid(w, h) {
  if (!state.gridShow) return;
  const g = gridStep();
  const [wx0, wy1] = s2w(0, 0), [wx1, wy0] = s2w(w, h);
  const px = g * state.view.k;
  // крупные линии каждые 5 шагов
  ctx.lineWidth = 1;
  const gridAxis = cvColor("label", "#d5d2ca"), gridLine = cvColor("grid", "#eceae5");
  for (let x = Math.floor(wx0 / (g * 5)) * g * 5; x <= wx1; x += g * 5) {
    ctx.strokeStyle = x === 0 ? gridAxis : gridLine;
    ctx.beginPath(); ctx.moveTo(...w2s(x, wy0)); ctx.lineTo(...w2s(x, wy1)); ctx.stroke();
  }
  for (let y = Math.floor(wy0 / (g * 5)) * g * 5; y <= wy1; y += g * 5) {
    ctx.strokeStyle = y === 0 ? gridAxis : gridLine;
    ctx.beginPath(); ctx.moveTo(...w2s(wx0, y)); ctx.lineTo(...w2s(wx1, y)); ctx.stroke();
  }
  // точки в узлах мелкого шага (как в Rayon)
  if (px >= 11) {
    ctx.fillStyle = cvColor("grid", "#c9c6bd");
    for (let x = Math.floor(wx0 / g) * g; x <= wx1; x += g)
      for (let y = Math.floor(wy0 / g) * g; y <= wy1; y += g) {
        const [sx, sy] = w2s(x, y);
        ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
      }
  }
  document.getElementById("st-grid").textContent =
    `сетка ${g} м${state.gridSnap ? "" : " (без привязки)"}`;
}


// Штриховка зоны по Эталону ЛГР: hatch = true (легаси 45° цветом обводки)
// или {angle: 0|45|90|135, cross, spacing_px, color}. Рисуется в клипе контура.
function drawHatch(ring, hatch, strokeColor, holes) {
  const spec = hatch === true
    ? { angle: 45, spacing_px: 9, color: strokeColor }
    : hatch;
  ctx.save();
  drawChain(ring, true);
  // дыры исключаются и из штриховки: клип по even-odd (иначе штрих зашёл бы
  // внутрь выколотой части и дыра читалась бы как обычная зона)
  const hasHoles = addHoleSubpaths(holes);
  ctx.clip(hasHoles ? "evenodd" : "nonzero");
  const ss = ring.map(p => w2s(...p));
  // экранный bbox кольца ОДНИМ проходом (без Math.min(...spread) — медленно/краш
  // на больших кольцах), ЗАЖАТЫЙ по видимому холсту: штрих-линии за экраном
  // невидимы под clip, а без зажима крупный полигон при зуме давал миллионы
  // итераций цикла ниже → полный фриз интерфейса на большом проекте.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ss) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const _m = (spec.spacing_px || 9) * 2;
  x0 = Math.max(x0, -_m); x1 = Math.min(x1, cv.clientWidth + _m);
  y0 = Math.max(y0, -_m); y1 = Math.min(y1, cv.clientHeight + _m);
  if (x1 <= x0 || y1 <= y0) { ctx.restore(); return; }
  ctx.strokeStyle = spec.color || strokeColor;
  ctx.lineWidth = 1.0;
  ctx.setLineDash([]);
  const step = Math.max(3, spec.spacing_px || 9);
  const angles = spec.cross ? [45, 135] : [spec.angle ?? 45];
  for (const a of angles) {
    ctx.beginPath();
    if (a === 0) {                       // горизонтальные
      for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    } else if (a === 90) {               // вертикальные
      for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    } else if (a === 45) {               // «///» (вверх слева направо на экране)
      const d = step * Math.SQRT2;
      for (let c = x0 - (y1 - y0); c < x1; c += d) {
        ctx.moveTo(c, y1); ctx.lineTo(c + (y1 - y0), y0);
      }
    } else {                             // 135°: «\\\»
      const d = step * Math.SQRT2;
      for (let c = x0 - (y1 - y0); c < x1; c += d) {
        ctx.moveTo(c + (y1 - y0), y1); ctx.lineTo(c, y0);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Точечный узор ПОВЕРХ заливки (PointPatternFill эталона): сетка кружков внутри
// полигона. Зоны «в составе ООПТ» отличаются от базовых именно точками. Клип по
// even-odd (дыры исключены), шаг/размер — экранные px (как штриховка), стабильны
// при зуме — texture, а не геометрия местности.
function drawDots(ring, dots, holes) {
  ctx.save();
  drawChain(ring, true);
  const hasHoles = addHoleSubpaths(holes);
  ctx.clip(hasHoles ? "evenodd" : "nonzero");
  const ss = ring.map(p => w2s(...p));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ss) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const step = Math.max(4, dots.spacing_px || 8);
  const r = Math.max(0.6, (dots.size_px || 2) / 2);
  x0 = Math.max(x0, -step); x1 = Math.min(x1, cv.clientWidth + step);
  y0 = Math.max(y0, -step); y1 = Math.min(y1, cv.clientHeight + step);
  if (x1 <= x0 || y1 <= y0) { ctx.restore(); return; }
  ctx.fillStyle = dots.color;
  const sx = Math.floor(x0 / step) * step, sy = Math.floor(y0 / step) * step;
  ctx.beginPath();
  for (let y = sy; y <= y1; y += step)
    for (let x = sx; x <= x1; x += step) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7); }
  ctx.fill();
  ctx.restore();
}

// Штрих засечки-маркера чуть тоньше самой линии (см. drawLineMarkers).
// Единая величина с scene.py MARKER_WIDTH_RATIO — холст и печать не должны
// расходиться по толщине галок.
const MARKER_WIDTH_RATIO = 0.65;

// Одна засечка в экранной точке (px,py): касательная (tx,ty), нормаль
// внутрь (nx,ny). Формы: tick ⊢, tee ⊥, corner Г, chevron ∨, chevron_dot ∨.,
// triangle ▼, dot ●, square ■, diamond ◇.
function drawMarkerGlyph(mk, px, py, tx, ty, nx, ny, s, period) {
  const shape = mk.shape;
  // Толщина штриха маркера = его собственная (mk.ow из QML outline_width),
  // а не толщина линии — иначе засечки-штрихи выходят волоском и не читаются
  // (код 9 при этом вообще исчезал). Залитые формы (▼/●) ow не используют.
  if (mk.ow) ctx.lineWidth = mk.ow;
  ctx.beginPath();
  switch (shape) {
    case "tee":
      ctx.moveTo(px, py); ctx.lineTo(px + nx * s, py + ny * s);
      ctx.moveTo(px - tx * s * 0.5, py - ty * s * 0.5);
      ctx.lineTo(px + tx * s * 0.5, py + ty * s * 0.5);
      ctx.stroke(); break;
    case "corner":
      ctx.moveTo(px, py); ctx.lineTo(px + nx * s, py + ny * s);
      ctx.lineTo(px + nx * s + tx * s, py + ny * s + ty * s);
      ctx.stroke(); break;
    case "chevron": case "chevron_dot": {
      // Галка-стрелка: УЗКИЙ конец (остриё) НА линии, плечи раскрываются по
      // нормали. Раньше остриё уходило ОТ линии, а плечи стояли на черте —
      // выглядело как «▽», а не как галка, направленная в линию (правка юзера:
      // «узким концом повёрнуты к линии»). Теперь apex = (px,py) на линии.
      const w2 = s * 0.5;
      ctx.moveTo(px + nx * s - tx * w2, py + ny * s - ty * w2);
      ctx.lineTo(px, py);
      ctx.lineTo(px + nx * s + tx * w2, py + ny * s + ty * w2);
      ctx.stroke();
      if (shape === "chevron_dot") {
        ctx.beginPath();
        ctx.arc(px + tx * period / 2 + nx * s * 0.5,
                py + ty * period / 2 + ny * s * 0.5, s * 0.15, 0, 7);
        ctx.fill();
      }
      break;
    }
    case "triangle": {
      // ВЕРШИНА (остриё) НА линии, ОСНОВАНИЕ смещено по нормали внутрь зоны —
      // ровно как на кадре портала gisogd.mos.ru «Границы территорий ПК»
      // (правка юзера: «вершина обращена к линии, а не основание»). Прежде было
      // наоборот (основание на линии, вершина внутрь) — это была ошибка.
      // filled===false → КОНТУРНЫЙ (в QML fill alpha=0: коды 11/18/50).
      const b = s * 0.5;
      ctx.moveTo(px, py);                                    // остриё на линии
      ctx.lineTo(px + nx * s - tx * b, py + ny * s - ty * b);  // угол основания
      ctx.lineTo(px + nx * s + tx * b, py + ny * s + ty * b);  // угол основания
      ctx.closePath();
      if (mk.filled === false) ctx.stroke(); else ctx.fill();
      break;
    }
    case "triangle2": {
      // ООЗТ (код 47) — как ООПТ на эталоне: два залитых треугольника,
      // наложенных со сдвигом «вверх» (по нормали внутрь зоны), не ▲▲ вдоль линии.
      const b = s * 0.5, shift = s * 0.38;
      for (const o of [0, shift]) {
        const cx = px + nx * o, cy = py + ny * o;
        ctx.beginPath();
        ctx.moveTo(cx - tx * b, cy - ty * b);
        ctx.lineTo(cx + tx * b, cy + ty * b);
        ctx.lineTo(cx + nx * s, cy + ny * s);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case "dot":
      ctx.arc(px, py, s / 2, 0, 7); ctx.fill(); break;
    case "square": {
      const b = s / 2;
      ctx.fillRect(px - b, py - b, s, s); break;
    }
    case "diamond": {
      const b = s / 2;
      ctx.moveTo(px - b, py); ctx.lineTo(px, py - b);
      ctx.lineTo(px + b, py); ctx.lineTo(px, py + b);
      ctx.closePath(); ctx.stroke(); break;
    }
    case "slashes": {
      // две параллельные косые засечки «⫽» поперёк линии (Эталон: зоны
      // затопления/подтопления). Наклон по (касательная − нормаль внутрь).
      const dx = tx - nx, dy = ty - ny, dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl, h = s * 0.6, sep = s * 0.45;
      for (const o of [-sep / 2, sep / 2]) {
        const cx = px + tx * o, cy = py + ty * o;
        ctx.moveTo(cx - ux * h, cy - uy * h);
        ctx.lineTo(cx + ux * h, cy + uy * h);
      }
      ctx.stroke(); break;
    }
    default: {  // tick — перпендикулярный штрих
      // Видимый РАЗМАХ засечки = бо́льшая из (длина size, толщина ow), толщина
      // штриха = меньшая. Иначе код 9 (size 0.25px, ow 7px) вырождался в
      // невидимый смаз вдоль линии — жалоба «маркеры не видно».
      const ext = Math.max(s, mk.ow || 0);
      if (mk.ow) ctx.lineWidth = Math.max(0.4, Math.min(s, mk.ow));
      ctx.moveTo(px, py); ctx.lineTo(px + nx * ext, py + ny * ext);
      ctx.stroke();
      break;
    }
  }
}

// ---------- размещение подписей объектов ----------
// Занятость мест — ГРИД, а не список. Раньше каждая подпись сверялась ЛИНЕЙНЫМ
// перебором со всеми уже поставленными (`_placed.some(...)`): на городском слое
// в 30 000 зданий с ~3 800 поставленными подписями это ~113 млн проверок
// прямоугольников ЗА КАДР — 93% времени отрисовки (замер: 386 мс с перебором
// против 27 мс без него). Правило размещения не изменилось: greedy, побеждает
// первый занявший место; подпись задевает 1-4 ячейки и сравнивается только с
// соседями по этим ячейкам — результат тот же, что у полного перебора.
const LABEL_CELL = 64;               // px экрана; подпись заведомо мельче
function labelGrid() {
  const cells = new Map();
  const each = (b, fn) => {
    for (let cx = Math.floor(b[0] / LABEL_CELL); cx <= Math.floor(b[2] / LABEL_CELL); cx++)
      for (let cy = Math.floor(b[1] / LABEL_CELL); cy <= Math.floor(b[3] / LABEL_CELL); cy++)
        if (fn(cx + "_" + cy)) return true;
    return false;
  };
  return {
    hits: b => each(b, k => {
      const a = cells.get(k);
      return a ? a.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) : false;
    }),
    add: b => { each(b, k => { let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(b); }); },
  };
}
// Ширина текста: measureText дорогой, а на городском слое подписи повторяются
// (этажность «5» у тысяч зданий) — ключ «шрифт + строка» даёт высокий процент
// попаданий. Сам ctx.font при этом ставится ВСЕГДА: его меняют и соседние
// рисовалки того же кадра (подпись линии, размерная линия), поэтому кешировать
// шрифт нельзя — кеш разъехался бы с фактическим состоянием холста, и подпись
// уехала бы чужим шрифтом.
const _measCache = new Map();
function measureLabel(s, font) {
  const key = font + " " + s;
  let w = _measCache.get(key);
  if (w === undefined) {
    if (_measCache.size > 4000) _measCache.clear();   // страховка от роста
    _measCache.set(key, w = ctx.measureText(s).width);
  }
  return w;
}

// Знаки ЛГР: в рабочих QML Москвы штрих (customdash_unit=MapUnit) и маркеры
// (interval_unit/size_unit=MapUnit) заданы в МЕТРАХ НА МЕСТНОСТИ, а не в мм
// листа. В библиотеке они записаны в px для опорного 1:2000, поэтому на холсте
// домножаем на зум относительно опорного — тогда плотность рисунка совпадает с
// эталоном на ЛЮБОМ масштабе, а не только на 1:2000 (прежде всё было
// фиксировано в экранных px: на 1:4451 рисунок выходил вдвое реже эталона).
// Штрих и маркер ОБЯЗАНЫ множиться на один и тот же коэффициент, иначе засечка
// уедет с черты. Нижний предел — чтобы на обзорных масштабах не слиплось.
// Пользовательских/проектных стилей не касается (у них нет ground_units).
// QML: у spritlines minScale=10000 при hasScaleBasedVisibilityFlag=1 — детальный
// знак ЛГР виден ТОЛЬКО до 1:10000, дальше QGIS показывает spritlines_uds, где
// MarkerLine нет вовсе. Поэтому за этим пределом засечки не рисуем: иначе на
// обзоре выходил «пунктир с узкими галками» (правка юзера).
const LGR_DETAIL_MAX_DENOM = 10000;
function lgrDenom() { return 3779.5 / state.view.k; }
// Масштабная видимость слоя — как «Видимость слоёв» во FlexGIS и
// scale-dependent visibility в QGIS. Выгрузка ОГД/ОСМ по городу — это десятки
// тысяч объектов, которые на обзорном масштабе не нужны и только жгут кадр.
// Порог живёт в fmt слоя (там же, где cats_off), поэтому сохраняется с проектом.
// Скрываем при ОТДАЛЕНИИ: знаменатель масштаба больше порога.
function layerInScale(L) {
  const max = L && L.fmt && L.fmt.scale_max;
  return !(max > 0) || lgrDenom() <= max;
}
// Рисуем/ловим курсором только то, что и видно, и попадает в масштаб.
// layer.visible остаётся «сырым» для панели, экспорта и «Вписать всё».
function layerDrawable(L) { return !!L && L.visible && layerInScale(L); }
// «Читаемый режим» (переключатель в «Сетка и привязки») — ТОЛЬКО для экрана.
// По эталону знак задан в метрах, поэтому на рабочих 1:4000+ засечка ~3 px:
// в QGIS так же, но чертить неудобно. В читаемом режиме коэффициент = 1, т.е.
// знак всегда выглядит как на опорном 1:2000: постоянный разборчивый размер,
// шаг заведомо крупнее засечки (37.8 px против 6.6) — вплотную не встают.
// Печать/выпуск читаемый режим НЕ трогает: Style.for_scale в scene.py про него
// не знает, лист всегда по эталону.
function lgrReadable() { return !!(state.view && state.lgrReadable); }
// Толщина линии знака в читаемом режиме. По QML она 1 px (line_width_unit=
// Pixel — единица УСТРОЙСТВА, зумом не масштабируется), это волосок. Здесь
// поднимаем до разборчивой, но НЕ переворачиваем пропорцию эталона: штрих
// засечки на опорном 1:2000 = 2.34 px, поэтому линия остаётся тоньше него.
// Только экран: печать берёт ширину из стиля как есть (Style.for_scale ширину
// не трогает — Pixel не масштабируется).
const LGR_READABLE_WIDTH_PX = 2;
const LGR_READABLE_MARKER_PX = 7;
function lgrWidth(st) {
  return (st && st.ground_units && lgrReadable())
    ? Math.max(st.width || 1, LGR_READABLE_WIDTH_PX)
    : (st ? st.width : 1);
}
function groundFactor(st) {
  if (!st || !st.ground_units) return 1;
  if (lgrReadable()) return 1;
  const refK = 3779.5 / (st.ref_scale || 2000);
  return state.view.k / refK;          // ровно по QML: без искусственного пола
}
function lgrDetailVisible(st) {
  if (!st || !st.ground_units) return true;
  if (lgrReadable()) return true;      // в читаемом знак виден на любом зуме
  return lgrDenom() <= LGR_DETAIL_MAX_DENOM;
}
function scaledDash(st) {
  const f = groundFactor(st);
  if (!st.dash || f === 1) return st.dash || null;
  const d = st.dash.map(x => x * f);
  // суб-пиксельный штрих не рисуем пунктиром: он вырождается в смаз, а
  // setLineDash с десятками тысяч сегментов на длинной линии роняет холст.
  // QML на таких масштабах знак и так прячет (minScale=10000).
  return d.reduce((a, b) => a + b, 0) < 1.5 ? null : d;
}
// Ровно по QML: и шаг (interval_unit=MapUnit), и РАЗМЕР (size_unit=MapUnit)
// засечки заданы в метрах на местности → множим оба на один коэффициент.
// Прежде размер держался постоянным на экране — из-за этого на отдалении
// галки выходили крупными относительно ужавшегося штриха и стояли вплотную
// («пунктир с узкими галками»). Теперь знак ужимается целиком, пропорционально,
// а за пределом 1:10000 не рисуется вовсе (lgrDetailVisible) — как в QGIS.
function scaledMarker(st) {
  const mk = st.line_marker;
  if (!mk) return mk;
  const f = groundFactor(st);
  if (f === 1) {
    // Читаемый режим: держим засечку разборчивой. По эталону размер маркера в
    // метрах, и на опорном 1:2000 мелкие треугольники (ПК-18, ООПТ-8, ландшафт-11)
    // — всего ~3.8 px, вырождаются в точку. Поднимаем размер до читаемого пола,
    // толщину штриха масштабируем тем же коэффициентом (сохраняя пропорцию
    // контура). ТОЛЬКО экран — печать/выпуск всегда по эталону (scaledMarker в
    // scene.py про режим не знает).
    if (st.ground_units && lgrReadable() && (mk.size || 0) < LGR_READABLE_MARKER_PX) {
      const g = LGR_READABLE_MARKER_PX / (mk.size || LGR_READABLE_MARKER_PX);
      const out = { ...mk, size: LGR_READABLE_MARKER_PX };
      if (mk.ow) out.ow = mk.ow * g;
      return out;
    }
    return mk;
  }
  // ow (толщина штриха засечки) в QML тоже MapUnit (outline_width_unit) — метры.
  // Без масштабирования глиф ужимался, а штрих оставался прежним: на 1:4451
  // засечка 3 px со штрихом 2.34 px вырождалась в кляксу. Масштабируем ВСЁ
  // одним коэффициентом; нижняя отсечка 0.4 px — чтобы штрих не исчез совсем.
  const out = { ...mk, period: (mk.period || 40) * f, size: (mk.size || 4) * f };
  if (mk.ow) out.ow = Math.max(0.4, mk.ow * f);
  return out;
}

// Засечки вдоль линии/контура. Размещение ПОСЕГМЕНТНОЕ: на каждом прямом
// ребре засечки распределяются равномерно с отступом от вершин, а не
// непрерывно по периметру — иначе на углах засечки соседних рёбер
// сходятся вплотную (в Эталоне углы свободны). mk={shape,period,size} px.
function drawLineMarkers(pts, mk, color, closed, inward, width, dash) {
  const chain = closed ? [...pts, pts[0]] : pts;
  const scr = chain.map(p => w2s(...p));
  const period = mk.period || 40, s = mk.size || 4;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  // штрих засечки — чуть ТОНЬШЕ линии (правка юзера): галка на толщине линии
  // читалась грубовато. MARKER_WIDTH_RATIO держим единым с scene.py (печать),
  // иначе холст и PDF разойдутся.
  ctx.lineWidth = Math.max(0.4, (width || 1) * MARKER_WIDTH_RATIO);
  const dashArr = (dash && dash.length) ? dash : null;
  if (dashArr) {
    // Линия штриховая → засечка стоит ТОЛЬКО на черте, не в разрыве (правка
    // юзера). Привязываемся к центру самого длинного «штриха» в цикле dash и
    // ставим засечку на каждом k-м штрихе (k≈period/цикл, минимум 1). Фаза
    // dash отсчитывается от начала цепочки — как её рисует ctx.
    const cycle = dashArr.reduce((a, b) => a + b, 0) || period;
    let bestLen = -1, bestOff = 0, run = 0;
    for (let i = 0; i < dashArr.length; i++) {
      if (i % 2 === 0 && dashArr[i] > bestLen) { bestLen = dashArr[i]; bestOff = run + dashArr[i] / 2; }
      run += dashArr[i];
    }
    const k = Math.max(1, Math.round(period / cycle));
    let acc = 0;
    for (let i = 1; i < scr.length; i++) {
      const [x1, y1] = scr[i - 1], [x2, y2] = scr[i];
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 1e-6) continue;
      const tx = (x2 - x1) / d, ty = (y2 - y1) / d;
      const nx = -ty * inward, ny = tx * inward;
      let j = Math.ceil((acc - bestOff) / cycle);
      for (; ; j++) {
        const L = j * cycle + bestOff;      // глобальная длина центра j-го штриха
        if (L > acc + d) break;
        if (L < acc || ((j % k) + k) % k !== 0) continue;
        const t = (L - acc) / d;
        drawMarkerGlyph(mk, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t,
                        tx, ty, nx, ny, s, period);
      }
      acc += d;
    }
  } else {
    // Сплошная линия — засечки НЕПРЕРЫВНО по длине всей цепочки единым шагом
    // period (как MarkerLine в QGIS). Прежде каждое ребро делилось на метки
    // ОТДЕЛЬНО: короткие рёбра (< period/2) пропускались, а шаг d/n у каждого
    // сегмента свой — отсюда неравномерность (жалоба юзера). Теперь шаг один
    // на весь контур, вершины его не сбивают.
    let acc = 0, next = period * 0.5;
    for (let i = 1; i < scr.length; i++) {
      const [x1, y1] = scr[i - 1], [x2, y2] = scr[i];
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 1e-6) continue;
      const tx = (x2 - x1) / d, ty = (y2 - y1) / d;
      const nx = -ty * inward, ny = tx * inward;
      while (next <= acc + d) {
        const t = (next - acc) / d;
        drawMarkerGlyph(mk, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t,
                        tx, ty, nx, ny, s, period);
        next += period;
      }
      acc += d;
    }
  }
  ctx.restore();
}

// Знак засечки направлен внутрь зоны: выясняем сторону по центроиду кольца
function inwardSign(ring) {
  const [x1, y1] = ring[0], [x2, y2] = ring[1];
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  // экранные нормали: w2s инвертирует y, поэтому знак согласован с canvas
  const [sx1, sy1] = w2s(x1, y1), [sx2, sy2] = w2s(x2, y2);
  const sd = Math.hypot(sx2 - sx1, sy2 - sy1) || 1;
  const nx = -(sy2 - sy1) / sd, ny = (sx2 - sx1) / sd;
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0] / ring.length; cy += p[1] / ring.length; }
  const [scx, scy] = w2s(cx, cy);
  const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2;
  return (scx - mx) * nx + (scy - my) * ny > 0 ? 1 : -1;
}

// Двойная параллельная линия (защитные зоны ОКН): смещение по нормалям
function drawDoubleLine(pts, gap, closed) {
  const chain = closed ? [...pts, pts[0]] : pts;
  const scr = chain.map(p => w2s(...p));
  ctx.beginPath();
  for (let i = 0; i < scr.length; i++) {
    const prev = scr[Math.max(0, i - 1)], next = scr[Math.min(scr.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const d = Math.hypot(dx, dy) || 1;
    const x = scr[i][0] - dy / d * gap, y = scr[i][1] + dx / d * gap;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

// Повторяющаяся подпись вдоль линии (условный знак ЛГР: «кл топ» и т.п.)
// Подпись линии (условный знак ЛГР: «кл топ», «водоохранная» и т.п.) —
// ОДНА на объект, на самом длинном отрезке контура/линии. Раньше подпись
// повторялась через каждые ~180px по всему периметру, что на компактных
// прямоугольниках сажало её на 3-4 стороны разом (в т.ч. вертикально на
// боковые рёбра) — нечитаемо и выглядело как баг. Один подписанный отрезок
// на самой длинной стороне — то, что реально нужно для типового объекта;
// для по-настоящему длинных линий (через весь чертёж) метки видно, пока
// видна сама протяжённая сторона.
// Повторяющаяся подпись линии/контура (красные линии, ЗОУИТ): как в эталоне
// и в QGIS-символике «line pattern», надпись повторяется вдоль линии с
// оптимальным шагом. Раньше ставилась ОДНА на самом длинном отрезке — на
// длинной красной линии терялась, на длинном контуре ЗОУИТ была одинока.
function drawLineLabel(pts, text, color) {
  const scr = pts.map(p => w2s(...p));
  if (scr.length < 2) return;
  ctx.save();
  ctx.font = "600 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;
  const half = textW / 2 + 3;                  // полуширина строки + зазор
  // отрезки в экранных пикселях + суммарная длина (параметризация по дуге)
  const segs = [];
  let total = 0;
  for (let i = 1; i < scr.length; i++) {
    const [ax, ay] = scr[i - 1], [bx, by] = scr[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    segs.push({ ax, ay, bx, by, len, s0: total });
    total += len;
  }
  if (!segs.length || total < textW + 20) { ctx.restore(); return; }
  const step = Math.max(textW + 60, total / Math.max(1, Math.round(total / 320)));
  // размещаем подпись ТОЛЬКО там, где строка целиком помещается на ОДНОМ
  // прямом отрезке (не заходя за угол) — иначе текст вылезал за контур и
  // ломался на изгибах звёздчатого контура
  const places = [];
  for (let s = step / 2; s < total; s += step) {
    const seg = segs.find(sg => s >= sg.s0 && s <= sg.s0 + sg.len);
    if (!seg) continue;
    const local = s - seg.s0;
    if (local < half || local > seg.len - half) continue;
    const t = local / seg.len;
    let ang = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    places.push({ x: seg.ax + (seg.bx - seg.ax) * t, y: seg.ay + (seg.by - seg.ay) * t, ang });
  }
  if (!places.length) {                        // ни один отрезок не вместил — хотя бы одна на самом длинном
    const seg = segs.reduce((m, sg) => sg.len > m.len ? sg : m, segs[0]);
    if (seg.len >= textW + 4) {
      let ang = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      places.push({ x: (seg.ax + seg.bx) / 2, y: (seg.ay + seg.by) / 2, ang });
    }
  }
  // ДВА ПРОХОДА: сперва все гало, потом все заливки — иначе белое гало
  // следующей подписи «съедает» буквы предыдущей (пропадали части букв)
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
  for (const p of places) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.strokeText(text, 0, 0); ctx.restore(); }
  ctx.fillStyle = color;
  for (const p of places) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.fillText(text, 0, 0); ctx.restore(); }
  ctx.restore();
}

// Перерисовка схлопывается в один кадр. draw() звали синхронно из ~80 мест:
// каждое событие колеса (на тачпаде их несколько за кадр), КАЖДЫЙ загрузившийся
// тайл подложки (30-50 при старте) и наведение на строку слоя запускали полный
// проход по всем объектам. Планировщик здесь, а не в 80 местах вызова: все они
// идут через эту функцию. drawNow() остаётся для случая, когда нужен кадр
// немедленно. Ничто не читает канву синхронно после draw() (ни toDataURL, ни
// getImageData), поэтому отложить на кадр безопасно.
let _drawPending = 0;
function draw() {
  if (_drawPending) return;
  _drawPending = requestAnimationFrame(() => { _drawPending = 0; drawNow(); });
}
function drawNow() {
  const w = cv.clientWidth, h = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawBasemap(w, h);
  drawGrid(w, h);

  // видимый мировой прямоугольник (+ поле) для отсечения объектов за экраном
  const _vpad = 40 / state.view.k;
  const _p0 = s2w(0, h), _p1 = s2w(w, 0);
  const vMinX = Math.min(_p0[0], _p1[0]) - _vpad, vMaxX = Math.max(_p0[0], _p1[0]) + _vpad;
  const vMinY = Math.min(_p0[1], _p1[1]) - _vpad, vMaxY = Math.max(_p0[1], _p1[1]) + _vpad;
  const _cull = f => {
    if (f.point) return f.point[0] < vMinX || f.point[0] > vMaxX || f.point[1] < vMinY || f.point[1] > vMaxY;
    if (f.circle) { const c = f.circle; return c.cx + c.r < vMinX || c.cx - c.r > vMaxX || c.cy + c.r < vMinY || c.cy - c.r > vMaxY; }
    if (f.arc) { const a = f.arc; return a.cx + a.r < vMinX || a.cx - a.r > vMaxX || a.cy + a.r < vMinY || a.cy - a.r > vMaxY; }
    const pts = f.ring || f.line; if (!pts || !pts.length) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return x1 < vMinX || x0 > vMaxX || y1 < vMinY || y0 > vMaxY;
  };
  // бакет объектов по слою ОДИН раз (было O(слои×объекты): каждый объект
  // перебирался заново на каждый слой) + отсечение по видимой области.
  const _byLayer = new Map();
  for (const f of state.features) {
    const L = layerOf(f);
    if (!layerDrawable(L) || _cull(f) || catOff(L, f)) continue;
    let arr = _byLayer.get(L); if (!arr) _byLayer.set(L, arr = []); arr.push(f);
  }
  // занятые экранные bbox уже отрисованных подписей этого слоя за проход —
  // greedy-фильтр наложения (простой вариант, не полноценный label placement)
  const _placedLabels = new Map();
  for (const layer of LAYERS_V2) {
    if (!layer.visible) continue;
    const _feats = _byLayer.get(layer); if (!_feats) continue;
    for (const f of _feats) {
      const st = styleOf(f);
      // ЛГР: штрих в метрах местности → px по текущему зуму (см. groundFactor).
      // Этот же массив уходит в drawLineMarkers — фаза засечки обязана
      // считаться по ТОМУ ЖЕ штриху, которым рисуется линия.
      const stDash = scaledDash(st);
      ctx.setLineDash(stDash || []);
      // читаемый режим поднимает волосок 1 px до разборчивого (см. lgrWidth)
      const stWidth = lgrWidth(st);
      ctx.lineWidth = stWidth; ctx.strokeStyle = canvasStrokeOf(f, st);
      if (layer.kind === "dim" && f.line) {
        // размерная линия: засечки 45° на концах + длина вдоль линии
        const [ax, ay] = w2s(...f.line[0]);
        const [bx, by] = w2s(...f.line[f.line.length - 1]);
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        for (const [px, py] of [[ax, ay], [bx, by]]) {
          ctx.moveTo(px - 5 * Math.cos(ang + Math.PI / 4), py - 5 * Math.sin(ang + Math.PI / 4));
          ctx.lineTo(px + 5 * Math.cos(ang + Math.PI / 4), py + 5 * Math.sin(ang + Math.PI / 4));
        }
        ctx.stroke();
        const lenM = Math.hypot(f.line[1][0] - f.line[0][0], f.line[1][1] - f.line[0][1]);
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        let ta = ang;
        if (ta > Math.PI / 2 || ta < -Math.PI / 2) ta += Math.PI;  // текст не вверх ногами
        ctx.rotate(ta);
        ctx.fillStyle = st.stroke; ctx.font = "600 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(fmtLen(lenM), 0, -5);
        ctx.restore();
        ctx.setLineDash([]);
      } else if (f.point) {
        const [sx, sy] = w2s(...f.point);
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fillStyle = st.fill; ctx.fill(); ctx.stroke();
        // радиус доступности соцобъекта (визуальная помощь, вкл/выкл + настройка
        // радиуса в «Сетка и привязки»); радиус на объекте (props.access_r)
        // перекрывает общий — у разных служб он разный (ДОО/школа/поликлиника)
        if (f.kind === "social" && state.accessRadii && state.accessRadii.on) {
          const rMeters = f.props && f.props.access_r > 0 ? f.props.access_r : (state.accessRadii.r || 300);
          const rr = rMeters * state.view.k;
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = cvColor("accent", "#2f6fde");
          ctx.globalAlpha = 0.22;
          ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.stroke();
          ctx.globalAlpha = 0.5; ctx.setLineDash([]);
          ctx.font = "10px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = cvColor("accent", "#2f6fde");
          ctx.fillText(`R ${rMeters} м`, sx, sy - rr - 3);
          ctx.restore();
        }
      } else if (f.arc) {
        const a = f.arc;
        const k = state.view.k;
        const cx = state.view.tx + a.cx * k;
        const cy = state.view.ty - a.cy * k;
        const r = a.r * k;
        ctx.beginPath();
        ctx.arc(cx, cy, r, ...arcScreenArgs(a));
        ctx.stroke();
      } else if (f.circle) {
        const c = f.circle;
        const k = state.view.k;
        const cx = state.view.tx + c.cx * k;
        const cy = state.view.ty - c.cy * k;
        ctx.beginPath();
        ctx.arc(cx, cy, c.r * k, 0, 2 * Math.PI);
        ctx.stroke();
      } else {
        if ((f.props.radius || 0) > 0 && f.line && f.line.length > 2) {
          ctx.beginPath();
          ctx.moveTo(...w2s(...f.line[0]));
          for (let i = 1; i < f.line.length - 1; i++)
            ctx.arcTo(...w2s(...f.line[i]), ...w2s(...f.line[i + 1]),
                      f.props.radius * state.view.k);
          ctx.lineTo(...w2s(...f.line[f.line.length - 1]));
        } else {
          drawChain(f.ring || f.line, !!f.ring);
        }
        // дыры — подпути в том же пути (см. addHoleSubpaths)
        const hasHoles = f.ring ? addHoleSubpaths(f.holes) : false;
        if (st.fill && f.ring) {
          ctx.save();
          if (st.fillOpacity != null) ctx.globalAlpha = st.fillOpacity;
          ctx.fillStyle = st.fill;
          ctx.fill(hasHoles ? "evenodd" : "nonzero");
          ctx.restore();
        }
        ctx.stroke();
        if (st.hatch && f.ring) drawHatch(f.ring, st.hatch, st.stroke, f.holes);
        if (st.dots && f.ring) drawDots(f.ring, st.dots, f.holes);
        if (st.double) drawDoubleLine(f.ring || f.line, st.double, !!f.ring);
        if (st.line_marker && (f.ring || f.line) && lgrDetailVisible(st)) {
          // направление засечки по знаку Эталона: по умолчанию остриём ВНУТРЬ
          // зоны, dir "out" — наружу (ООПТ/ландшафт ОКН/водоохранная/прибрежная),
          // dir "both" — по ОБЕ стороны линии (в QML это два под-маркера с
          // углами 0 и 180: 8 ООПТ, 18 ПК, 55 памятник природы)
          // Сторона из ДАННЫХ важнее знака: у объектов ОГД она задана знаком
          // LineCode («1» и «-1» — одна линия, зона с разных сторон), и это
          // точнее, чем наша догадка по центроиду. inwardSign остаётся для
          // объектов без LineCode (начерченных вручную).
          const side0 = f.props && f.props.line_side;
          const mkColor = st.stroke || cvColor("redline", "#df0024");
          const mkScaled = scaledMarker(st), mkDir = st.line_marker.dir;
          const ringMarkers = (ring, baseInw, closed) => {
            const sides = mkDir === "both" ? [baseInw, -baseInw]
                        : (!side0 && mkDir === "out") ? [-baseInw] : [baseInw];
            for (const side of sides)
              drawLineMarkers(ring, mkScaled, mkColor, closed, side, stWidth, stDash);
          };
          if (f.ring) {
            const inw = side0 ? side0
                      : f.ring.length > 2 ? inwardSign(f.ring) : 1;
            ringMarkers(f.ring, inw, true);
            // Дыры выколотого полигона: засечки смотрят В ПОЛИГОН = ИЗ дыры
            // (инверсия относительно внешней границы, -inwardSign) — метки
            // окантовывают материал полигона, а не пустоту (просьба юзера).
            for (const hole of f.holes || [])
              if (hole.length > 2) ringMarkers(hole, -inwardSign(hole), true);
          } else if (f.line) {
            ringMarkers(f.line, side0 || 1, false);
          }
        }
        if (st.line_label) {
          const pts = f.ring ? [...f.ring, f.ring[0]] : f.line;
          drawLineLabel(pts, st.line_label, st.stroke || cvColor("redline", "#d91a1a"));
        }
      }
      ctx.setLineDash([]);
      if (st.label_field && f.ring) {
        // центр кольца без reduce: тот возвращал НОВЫЙ массив на каждую вершину
        let _cx = 0, _cy = 0;
        for (const p of f.ring) { _cx += p[0]; _cy += p[1]; }
        _cx /= f.ring.length; _cy /= f.ring.length;
        const v = labelOf(f);
        if (v !== undefined && v !== "" && v !== null) {
          const lf = st.label_font || {};
          const fsize = Math.min(72, Math.max(6, lf.size || 11));
          const _font = `${fsize}px ${LABEL_FONTS[lf.family] || "sans-serif"}`;
          ctx.font = _font;
          const [sx, sy] = w2s(_cx, _cy);
          const _s = String(v);
          const tw = measureLabel(_s, _font);
          const bbox = [sx - tw / 2, sy - fsize, sx + tw / 2, sy + fsize * 0.25];
          let _placed = _placedLabels.get(layer);
          if (!_placed) _placedLabels.set(layer, _placed = labelGrid());
          if (!_placed.hits(bbox)) {
            _placed.add(bbox);
            ctx.fillStyle = lf.color || cvColor("label", "#5c5a54");
            ctx.textAlign = "center";
            ctx.fillText(_s, sx, sy);
          }
        }
      }
      if (state.selectedIds.has(f.id)) {
        ctx.strokeStyle = cvColor("selection", "#2f6fde");
        ctx.lineWidth = state.trimCtx ? 2.8 : 1.5;
        ctx.setLineDash([4, 3]);
        if (f.point) { const [sx, sy] = w2s(...f.point); ctx.strokeRect(sx - 9, sy - 9, 18, 18); }
        else if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        }
        else if (f.arc) {
          const a = f.arc;
          const k = state.view.k;
          const cx = state.view.tx + a.cx * k;
          const cy = state.view.ty - a.cy * k;
          ctx.beginPath();
          ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a));
          ctx.stroke();
        } else { drawChain(f.ring || f.line, !!f.ring); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // граница для обрезки/продления — выбрана в 1-м шаге инструмента
      if (state.trimCtx && state.trimCtx.boundary.has(f.id)) {
        // сильный визуал: halo + толстая пунктирная
        ctx.save();
        ctx.strokeStyle = "rgba(224, 138, 30, 0.3)";
        ctx.lineWidth = 7;
        ctx.setLineDash([]);
        if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        } else {
          const ch = f.ring || f.line || (f.arc ? featurePts(f) : null);
          if (ch) { drawChain(ch, !!f.ring); ctx.stroke(); }
        }
        ctx.restore();
        ctx.strokeStyle = cvColor("warning", "#e08a1e"); ctx.lineWidth = 4; ctx.setLineDash([2, 3]);
        if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        } else {
          const ch = f.ring || f.line || (f.arc ? featurePts(f) : null);
          if (ch) { drawChain(ch, !!f.ring); ctx.stroke(); }
        }
        ctx.setLineDash([]);
      }
      // когда готов к обрезке, подсвечиваем возможные цели (не границы)
      if (state.trimCtx && state.trimCtx.ready && !state.trimCtx.boundary.has(f.id) && (f.line || f.arc)) {
        ctx.save();
        ctx.strokeStyle = cvColor("accent", "#3b63f6"); ctx.lineWidth = 2.0; ctx.setLineDash([2, 2]);
        if (f.line) {
          drawChain(f.line, false); ctx.stroke();
        } else if (f.arc) {
          const a = f.arc; const k = state.view.k;
          const cx = state.view.tx + a.cx * k; const cy = state.view.ty - a.cy * k;
          ctx.beginPath(); ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a)); ctx.stroke();
        }
        ctx.restore();
      }
      // ховер строки слоя в панели — мягкая подсветка его объектов на холсте
      if (state.hoverLayerId === layer.id) {
        ctx.save();
        ctx.strokeStyle = cvColor("accent", "#2f6fde"); ctx.lineWidth = 4;
        ctx.globalAlpha = 0.35; ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (f.point) { const [sx, sy] = w2s(...f.point); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.stroke(); }
        else if (f.circle) { const [sx, sy] = w2s(f.circle.cx, f.circle.cy); ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2*Math.PI); ctx.stroke(); }
        else { drawChain(f.ring || f.line, !!f.ring); ctx.stroke(); }
        ctx.restore();
      }
      // ручки вершин — только у первичного (одиночного) выбора
      if (f.id === state.selected) {
        const shared = sharedVertexSet(f);
        const shFill = cvColor("shared", "#12a150"), vxStroke = cvColor("vertex", "#2f6fde");
        const handleBg = cvColor("bg", "#fff");
        // ручки по ВСЕМ кольцам (внешний контур + дыры): у выколотого полигона
        // вершины дыр теперь тоже выделяются и редактируются. shared (общая
        // граница coverage-зон) — только у внешнего кольца (ri===0).
        const rings = featureRings(f);
        if (rings.length) {
          rings.forEach((ring, ri) => {
            ring.forEach((p, li) => {
              const [sx, sy] = w2s(...p);
              const isShared = ri === 0 && shared.has(li);
              ctx.fillStyle = isShared ? shFill : handleBg;
              ctx.strokeStyle = isShared ? shFill : vxStroke;
              ctx.lineWidth = 1.2;
              ctx.fillRect(sx - 3, sy - 3, 6, 6); ctx.strokeRect(sx - 3, sy - 3, 6, 6);
            });
          });
        } else {
          featurePts(f).forEach((p, i) => {   // дуга/окружность — как было
            const [sx, sy] = w2s(...p);
            const isShared = shared.has(i);
            ctx.fillStyle = isShared ? shFill : handleBg;
            ctx.strokeStyle = isShared ? shFill : vxStroke;
            ctx.lineWidth = 1.2;
            ctx.fillRect(sx - 3, sy - 3, 6, 6); ctx.strokeRect(sx - 3, sy - 3, 6, 6);
          });
        }
      }
    }
  }

  // пикетаж красных линий: засечки поперёк + подписи ПК
  for (const f of state.features) {
    if (f.kind !== "redline" || !(f.props.pk_step > 0) || !f.props._stations) continue;
    if (isHidden(f)) continue;
    ctx.strokeStyle = cvColor("redline", "#d91a1a"); ctx.lineWidth = 1;
    ctx.fillStyle = cvColor("redline", "#8c1414"); ctx.font = "600 10px sans-serif"; ctx.textAlign = "center";
    for (const st of f.props._stations) {
      const [sx, sy] = w2s(st.x, st.y);
      const nx = -Math.sin(st.a), ny = Math.cos(st.a);   // нормаль к касательной
      ctx.beginPath();
      ctx.moveTo(sx - nx * 5, sy + ny * 5);
      ctx.lineTo(sx + nx * 5, sy - ny * 5);
      ctx.stroke();
      const pk = `ПК${Math.floor(st.s / 100)}+${String(Math.round(st.s % 100)).padStart(2, "0")}`;
      ctx.fillText(pk, sx + nx * 16, sy - ny * 16 + 3);
    }
  }

  // направляющие выравнивания
  if (state.guides.length) {
    ctx.strokeStyle = cvColor("shared", "#12a150"); ctx.lineWidth = 0.8; ctx.setLineDash([4, 4]);
    for (const [a, b] of state.guides) { drawChain([a, b], false); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // наглядность для склейки: пунктир между близкими концами выбранных
  if (!state.trimCtx && state.selectedIds.size > 1) {
    const sels = selectionFeatures().filter(f => f.line || f.arc);
    if (sels.length > 1) {
      const tol = 15 / state.view.k;
      ctx.strokeStyle = cvColor("accent", "#2f6fde");
      ctx.lineWidth = 1;
      ctx.setLineDash([3,2]);
      for (let i=0; i<sels.length; i++) {
        for (let j=i+1; j<sels.length; j++) {
          const c1 = sels[i].line || (sels[i].arc ? featurePts(sels[i]) : null);
          const c2 = sels[j].line || (sels[j].arc ? featurePts(sels[j]) : null);
          if (!c1 || !c2 || c1.length<2 || c2.length<2) continue;
          const ends1 = [c1[0], c1[c1.length-1]];
          const ends2 = [c2[0], c2[c2.length-1]];
          for (let e1 of ends1) for (let e2 of ends2) {
            if (Math.hypot(e1[0]-e2[0], e1[1]-e2[1]) < tol) {
              ctx.beginPath();
              ctx.moveTo(...w2s(...e1));
              ctx.lineTo(...w2s(...e2));
              ctx.stroke();
            }
          }
        }
      }
      ctx.setLineDash([]);
    }
  }

  // черчение в процессе + живой размер
  if (state.drawing && Array.isArray(state.drawing.pts) && state.drawing.pts.length) {
    const st = styleForDrawing();
    ctx.strokeStyle = st.stroke || cvColor("boundary", "#000"); ctx.lineWidth = st.width || 1; ctx.setLineDash([5, 4]);
    const pts = state.mouse ? [...state.drawing.pts, state.mouse] : state.drawing.pts;
    drawChain(pts, false); ctx.stroke(); ctx.setLineDash([]);
    const base = lastDrawingPt();
    if (base && state.mouse) {
      const len = Math.hypot(state.mouse[0] - base[0], state.mouse[1] - base[1]);
      const [mx, my] = w2s(...state.mouse);
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
      if (state.typed) {
        // подпись по формату ввода: длина «N м», абсолют «X,Y», полярно «L<A°»
        const label = /[<>]/.test(state.typed) ? state.typed.replace(/[<>]/, " < ") + "°"
          : /[;\s]/.test(state.typed) ? "X,Y: " + state.typed.trim()
          : state.typed + " м";
        ctx.fillStyle = cvColor("selection", "#1c1c1a");
        ctx.fillRect(mx + 10, my - 24, ctx.measureText(label).width + 12, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, mx + 16, my - 11);
      } else {
        ctx.fillStyle = cvColor("label", "#8b8a85");
        ctx.fillText(fmtLen(len), mx + 12, my - 10);
      }
    }
    // замыкание: подсветка первой точки
    const drawingPts = state.drawing.pts;
    if (TOOL_GEOM[state.tool] === "polygon" && Array.isArray(drawingPts) && drawingPts.length > 2 && state.mouse) {
      const first = drawingPts[0];
      if (Math.hypot(first[0] - state.mouse[0], first[1] - state.mouse[1]) < 12 / state.view.k) {
        const [fx, fy] = w2s(...first);
        ctx.strokeStyle = cvColor("shared", "#12a150"); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(fx, fy, 8, 0, 7); ctx.stroke();
      }
    }
    // превью дуги
    if (state.tool === "arc" && Array.isArray(drawingPts) && drawingPts.length >= 2 && state.mouse) {
      const pts = [...drawingPts, state.mouse];
      if (pts.length >= 3) {
        const a = arcFrom3Pts(pts[0], pts[1], pts[2]);
        if (a) {
          const k = state.view.k;
          const cx = state.view.tx + a.cx * k;
          const cy = state.view.ty - a.cy * k;
          ctx.beginPath();
          ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a));
          ctx.stroke();
          // visual center cross for arc
          ctx.beginPath();
          ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
          ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
          ctx.stroke();
          // больше визуалов: показываем радиус 3-point дуги
          ctx.fillStyle = cvColor("label", "#8b8a85");
          ctx.fillText(`r=${fmtLen(a.r)}`, cx + 8, cy - 8);
        }
      } else {
        drawChain(pts, false); ctx.stroke();
      }
    }
  }

  // превью окружности вне блока pts (отдельное состояние drawing для circle)
  if (state.tool === "circle" && state.drawing && state.drawing.center) {
    const st = styleForDrawing();
    ctx.strokeStyle = st.stroke || cvColor("boundary", "#000"); ctx.lineWidth = st.width || 1;
    const k = state.view.k;
    const cx = state.view.tx + state.drawing.center[0] * k;
    const cy = state.view.ty - state.drawing.center[1] * k;
    let r;
    if (state.typed) {
      const tr = parseFloat(state.typed.replace(",", "."));
      if (isFinite(tr) && tr > 0) r = tr * k;
    }
    if (!r && state.mouse) {
      r = Math.hypot(state.mouse[0] - state.drawing.center[0], state.mouse[1] - state.drawing.center[1]) * k;
    }
    if (r && r > 2) {
      ctx.save();
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
      const [mx, my] = state.mouse ? w2s(...state.mouse) : [cx + r, cy];
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
      ctx.fillStyle = state.typed ? cvColor("selection", "#1c1c1a") : cvColor("label", "#8b8a85");
      const txt = (state.typed || (r/k).toFixed(1)) + " м";
      if (state.typed) {
        ctx.fillRect(mx + 10, my - 24, ctx.measureText(txt).width + 12, 18);
        ctx.fillStyle = "#fff";
      }
      ctx.fillText(txt, mx + 16, my - 11);
    }
  }

  if (state.drag && state.drag.rect) {
    const { a, b } = state.drag;
    const [sx1, sy1] = w2s(...a), [sx2, sy2] = w2s(...b);
    const bst = styleForDrawing();
    ctx.strokeStyle = bst.stroke || cvColor("label", "#888");
    ctx.fillStyle = (bst.fill || cvColor("zoneB", "#cccccc")) + (bst.fill ? "88" : "");
    ctx.fillRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
    ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
    ctx.fillStyle = cvColor("label", "#5c5a54"); ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(`${fmtCoord(Math.abs(b[0] - a[0]))} × ${fmtCoord(Math.abs(b[1] - a[1]))} м`,
                 Math.max(sx1, sx2) + 8, Math.min(sy1, sy2) - 6);
  }
  // рамка выделения (мультивыбор инструментом «Выбор»)
  if (state.drag && state.drag.marquee) {
    const { a, b } = state.drag;
    const [sx1, sy1] = w2s(...a), [sx2, sy2] = w2s(...b);
    const x = Math.min(sx1, sx2), y = Math.min(sy1, sy2);
    const w = Math.abs(sx2 - sx1), h = Math.abs(sy2 - sy1);
    ctx.save();
    ctx.strokeStyle = cvColor("selection", "#2f6fde");
    ctx.fillStyle = cvColor("selection", "#2f6fde") + "18";
    ctx.lineWidth = 1; ctx.setLineDash([5, 3]);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  // измерение
  if (state.measure) {
    const a = state.measure.a;
    const b = state.measure.b || state.mouse;
    if (b) {
      ctx.strokeStyle = cvColor("selection", "#2f6fde"); ctx.lineWidth = 1.2; ctx.setLineDash([6, 3]);
      drawChain([a, b], false); ctx.stroke(); ctx.setLineDash([]);
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [mx, my] = w2s((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.fillStyle = cvColor("selection", "#2f6fde"); ctx.font = "600 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(fmtLen(dist), mx, my - 6);
    }
  }
  xfDrawOverlay(ctx);
  drawSnapMarker();
  updateOverlay();
}

// масштабная линейка + компас + онбординг поверх холста
function niceRound(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}
function updateOverlay() {
  const bar = document.getElementById("cv-scale-bar");
  const lab = document.getElementById("cv-scale-label");
  if (!bar || !lab) return;
  const mpp = 1 / state.view.k;              // метров мира на экранный пиксель
  const bm = niceRound(90 * mpp);            // «круглая» длина ~90 px
  bar.style.width = Math.round(bm * state.view.k) + "px";
  const dist = bm >= 1000 ? (bm / 1000) + " км" : bm + " м";
  // ~1:N — приблизительно (экранный пиксель ≈ 1/96 дюйма), потому с тильдой
  const denom = Math.round(mpp * 3779.5);
  lab.textContent = `${dist} · ~1:${denom.toLocaleString("ru-RU")}`;
}

// ---------- вид ----------
// Пределы зума (k — экранных пикселей на метр мира). Прежде было [0.05, 40]:
// приближение упиралось в ~1:95, где один пиксель = 2.5 см, — в 250 раз грубее
// точности самой модели (координаты хранятся до 0.1 мм), поэтому вычертить и
// проверить узел/сопряжение было нечем. Сейчас:
//   K_MAX 2000 → ~1:1.9  (пиксель ≈ 0.5 мм — предел осмысленного черчения)
//   K_MIN 0.01 → ~1:378 000 (~160 км по ширине холста — регион целиком)
// Знаменатель ≈ 3779.5 / k (см. подпись масштабной линейки).
const K_MIN = 0.01, K_MAX = 2000;
const clampK = k => Math.min(K_MAX, Math.max(K_MIN, k));
function zoomBy(factor) {
  const w = cv.clientWidth, h = cv.clientHeight;
  const [wx, wy] = s2w(w / 2, h / 2);        // мировая точка под центром экрана
  state.view.k = clampK(state.view.k * factor);
  state.view.tx = w / 2 - wx * state.view.k;
  state.view.ty = h / 2 + wy * state.view.k;
  draw();
}
function fitBox(x0, y0, x1, y1, pad = 0.82) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (w < 2 || h < 2) return;
  const dx = Math.max(x1 - x0, 10), dy = Math.max(y1 - y0, 10);
  state.view.k = clampK(Math.min(w / dx, h / dy) * pad);
  state.view.tx = w / 2 - (x0 + dx / 2) * state.view.k;
  state.view.ty = h / 2 + (y0 + dy / 2) * state.view.k;
  draw();
}
function fitPoints(pts, pad = 0.82) {
  if (!pts.length) return;
  // однопроходный bbox: спред Math.max(...xs) переполняет стек на больших
  // проектах (>~125k точек — лимит числа аргументов V8; у юзера 600k+ → краш)
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  fitBox(minx, miny, maxx, maxy, pad);
}
function featureViewBox(f) {
  const pts = featurePts(f);
  if (!pts.length) return null;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  if (!Number.isFinite(minx)) return null;
  return { minx, maxx, miny, maxy,
    cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
}
function unionViewBoxes(boxes) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const b of boxes) {
    if (b.minx < minx) minx = b.minx; if (b.maxx > maxx) maxx = b.maxx;
    if (b.miny < miny) miny = b.miny; if (b.maxy > maxy) maxy = b.maxy;
  }
  return { minx, maxx, miny, maxy };
}
// «Вписать всё» учитывает ПОЛНЫЕ габариты видимых объектов. Для небольшого
// проекта это точный bbox: один большой контур больше не раздувается до 40×
// по единственной точке-центроиду и не исчезает за краями экрана. На больших
// сценах сохраняем защиту от далёких выбросов: выбираем центральные 90%
// объектов по центрам, но вписываем уже их реальные габариты, а не центры.
// Данные не удаляются; скрытые слои закономерно не влияют на текущий обзор.
function fitView() {
  const boxes = [];
  for (const f of state.features) {
    const layer = layerOf(f);
    if (layer && !layer.visible) continue;
    const box = featureViewBox(f);
    if (box) boxes.push(box);
  }
  if (!boxes.length) { toast("Нет видимых объектов для вписывания"); return; }
  let fitted = boxes;
  if (boxes.length > 4) {
    const cxs = boxes.map(b => b.cx).sort((a, b) => a - b);
    const cys = boxes.map(b => b.cy).sort((a, b) => a - b);
    const q = (a, t) => a[Math.min(a.length - 1,
      Math.max(0, Math.round(t * (a.length - 1))))];
    const minCx = q(cxs, 0.05), maxCx = q(cxs, 0.95);
    const minCy = q(cys, 0.05), maxCy = q(cys, 0.95);
    const central = boxes.filter(b => b.cx >= minCx && b.cx <= maxCx &&
      b.cy >= minCy && b.cy <= maxCy);
    if (central.length) fitted = central;
  }
  const b = unionViewBoxes(fitted);
  fitBox(b.minx, b.miny, b.maxx, b.maxy);
}
function zoomToLayer(id) {
  const pts = [];
  for (const f of featuresOnLayer(id)) for (const p of featurePts(f)) pts.push(p);
  if (!pts.length) { toast("В слое нет объектов"); return; }
  fitPoints(pts, 0.6);
}
function zoomToFeature(f) { fitPoints(featurePts(f), 0.5); }

// ---------- история и сохранение ----------
// глубина истории отмены адаптивна к размеру: снимок = JSON всего проекта, у
// больших выгрузок это десятки МБ на уровень — 100 уровней съели бы гигабайты
// памяти и раздували автосейв. Малые проекты — как прежде (100).
function undoDepth() {
  const n = state.features.length;
  return n > 20000 ? 5 : n > 8000 ? 15 : 100;
}
// Состояние истории БЕЗ объектов: слои, их оформление, поля, порядок, источники.
// Мало по объёму и меняется редко, поэтому хранится строкой целиком.
function historySmallState() {
  const saved = collectState({ skipHistory: true });
  delete saved.undo;
  delete saved.redo;
  delete saved.features;
  // Эти настройки не принадлежат геометрической истории: пользователь не
  // ожидает, что Undo чертежа переключит подложку, состав альбома или вариант.
  delete saved.name;
  delete saved.basemapSource;
  delete saved.exportStyle;
  delete saved.variants;
  delete saved.accessRadii;
  delete saved.albumConfig;
  return JSON.stringify({ history_version: 2, ...saved });
}
// ---------------------------------------------------------------------------
// Инкрементальные снимки отмены.
//
// Раньше каждый шаг истории хранил JSON всего проекта целиком. На реальной
// выгрузке ОГД (20 000 объектов) один снимок весит ~13 МБ, а глубина истории —
// до 100 шагов: больше гигабайта строк в памяти, хотя соседние шаги отличаются
// парой объектов.
//
// Теперь запись хранит объекты ПООБЪЕКТНО, и неизменившиеся объекты
// переиспользуют ТУ ЖЕ строку, что и в предыдущей записи. Строки в JS
// неизменяемы и хранятся по ссылке, поэтому сто шагов держат один экземпляр
// содержимого и сто массивов указателей. Замерено на 20 000 объектов:
// пообъектная сериализация стоит столько же, что и целиком (186 против 187 мс),
// сравнение с предыдущим шагом добавляет ~7 %.
//
// Записи остаются САМОДОСТАТОЧНЫМИ (без цепочки ключевых кадров): стеки в
// остальном коде режут через slice/shift/pop, и любая цепочка сломалась бы.
function historySnapshot(prev = null) {
  const ids = [], jsons = [];
  const prevById = prev ? prev.byId : null;
  let freshBytes = 0;
  for (const feature of state.features) {
    const id = feature.id;
    const json = JSON.stringify(feature);
    const before = prevById ? prevById.get(id) : undefined;
    // тот же контент — кладём ТУ ЖЕ строку, память не дублируется
    if (before === json) { ids.push(id); jsons.push(before); continue; }
    ids.push(id); jsons.push(json);
    freshBytes += json.length;
  }
  const small = historySmallState();
  const smallShared = prev && prev.small === small ? prev.small : small;
  if (smallShared !== (prev && prev.small)) freshBytes += small.length;
  const byId = new Map();
  for (let i = 0; i < ids.length; i++) byId.set(ids[i], jsons[i]);
  return { small: smallShared, ids, jsons, byId, freshBytes };
}
// объявлением, а не const: используется в значении по умолчанию pushHistoryEntry
function historyTail(stack) {
  return stack && stack.length ? stack[stack.length - 1] : null;
}
// Снимок → прежний формат v2 (файл проекта, автосейв, отчёт об ошибке)
function historyEntryToString(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || !Array.isArray(entry.jsons)) return null;
  return `${entry.small.slice(0, -1)},"features":[${entry.jsons.join(",")}]}`;
}
// Прежний формат v2 → снимок (открытие проекта, восстановление автосейва)
function historyEntryFromString(serialized) {
  if (typeof serialized !== "string") return null;
  let parsed;
  try { parsed = JSON.parse(serialized); } catch (error) { return null; }
  if (!isRecord(parsed) || !Array.isArray(parsed.features)) return null;
  const features = parsed.features;
  delete parsed.features;
  const ids = [], jsons = [], byId = new Map();
  let freshBytes = 0;
  for (const feature of features) {
    const json = JSON.stringify(feature);
    ids.push(feature.id); jsons.push(json); byId.set(feature.id, json);
    freshBytes += json.length;
  }
  const small = JSON.stringify(parsed);
  return { small, ids, jsons, byId, freshBytes: freshBytes + small.length };
}
// В файл и автосейв кладём прежний строковый формат, но только последние шаги:
// глубокая история на диске не нужна, а сериализация стоит дорого.
const HISTORY_PERSIST_MAX = 10;
function historyStackToStrings(stack) {
  if (!Array.isArray(stack)) return [];
  return stack.slice(-HISTORY_PERSIST_MAX).map(historyEntryToString).filter(Boolean);
}
function historyStackFromStrings(list) {
  if (!Array.isArray(list)) return [];
  return list.map(historyEntryFromString).filter(Boolean);
}
function syncHistoryControls() {
  const undoButton = document.getElementById("btn-undo");
  const redoButton = document.getElementById("btn-redo");
  if (undoButton) undoButton.disabled = !state.undo.length;
  if (redoButton) redoButton.disabled = !state.redo.length;
}
// Потолок по ОБЪЁМУ вдобавок к числу шагов. Считаем только НОВОЕ содержимое
// (freshBytes): объекты, унаследованные от предыдущего шага, лежат в памяти
// одним экземпляром и повторно место не занимают.
const HISTORY_BYTE_BUDGET = 64 * 1024 * 1024;
function trimHistoryToBudget(stack) {
  let bytes = 0;
  for (const entry of stack) bytes += (entry && entry.freshBytes) || 0;
  while (stack.length > 1 && bytes > HISTORY_BYTE_BUDGET)
    bytes -= (stack.shift().freshBytes) || 0;
}
function pushHistoryEntry(entry = historySnapshot(historyTail(state.undo))) {
  state.undo.push(entry);
  const max = undoDepth();
  while (state.undo.length > max) state.undo.shift();
  trimHistoryToBudget(state.undo);
  state.redo = [];
  syncHistoryControls();
}
function snapshot() {
  pushHistoryEntry();
}
// Снимки равны, если совпадают «мелкое» состояние и ПОСТРОЧНО объекты. Строки
// неизменившихся объектов переиспользуются, поэтому сравнение обычно сводится к
// сравнению ссылок и не стоит ничего.
function historySameSnapshot(a, b) {
  if (!a || !b || a.small !== b.small || a.jsons.length !== b.jsons.length) return false;
  for (let i = 0; i < a.jsons.length; i++)
    if (a.ids[i] !== b.ids[i] || a.jsons[i] !== b.jsons[i]) return false;
  return true;
}
function commitHistoryFrom(before) {
  if (!before) return;
  if (!historySameSnapshot(before, historySnapshot(before))) pushHistoryEntry(before);
}
function restoreHistoryEntry(entry) {
  const serialized = historyEntryToString(entry);
  if (serialized == null) throw new Error("unsupported history entry");
  const restored = JSON.parse(serialized);
  if (Array.isArray(restored)) {
    state.features = normalizeFeatureList(restored).map(feature => upgradeFeature(feature));
    syncNextId();
    return;
  }
  if (!isRecord(restored) || restored.history_version !== 2 || !Array.isArray(restored.features))
    throw new Error("unsupported history entry");

  const personal = {
    name: document.getElementById("project-name").value,
    variants: state.variants,
    accessRadii: state.accessRadii,
    albumConfig: state.albumConfig,
    osnap: state.osnap,
    gridSnap: state.gridSnap,
    basemapSource: basemap.source,
    exportStyle: exportStyleMode(),
  };
  state.projectCustomKinds = [];
  rebuildKinds();
  resetLayerModel();
  if (!applyRestoredState(restored)) throw new Error("invalid history entry");

  // layerOrder в истории — также точный список слоёв. Это позволяет корректно
  // отменять создание/удаление, включая встроенные импортные слои.
  const desiredIds = new Set(restored.layerOrder || []);
  if (Array.isArray(restored.layerOrder)) {
    const kept = LAYERS_V2.filter(layer => desiredIds.has(layer.id));
    LAYERS_V2.splice(0, LAYERS_V2.length, ...kept);
    rebuildLayerIndexes();
  }
  if (!LAYER_BY_ID[state.activeLayerId]) {
    const fallback = LAYERS_V2.find(layer => !layer.annotation && !layer.import_only);
    state.activeLayerId = fallback?.id || null;
  }
  document.getElementById("project-name").value = personal.name;
  state.variants = personal.variants;
  state.accessRadii = personal.accessRadii;
  state.albumConfig = personal.albumConfig;
  if (basemap.source !== personal.basemapSource) setBasemapSource(personal.basemapSource);
  const exportSelect = document.getElementById("export-style");
  if (exportSelect) exportSelect.value = personal.exportStyle;
  syncProjectControls();
  syncNextId();
}
function syncNextId() {
  const maxId = state.features.reduce((max, feature) =>
    Number.isFinite(+feature.id) ? Math.max(max, +feature.id) : max, 0);
  state.nextId = Math.max(state.nextId || 1, maxId + 1);
}
function undo() {
  if (!state.undo.length) return;
  const entry = state.undo.pop();
  const current = historySnapshot(historyTail(state.redo));
  state.redo.push(current);
  while (state.redo.length > undoDepth()) state.redo.shift();
  try {
    restoreHistoryEntry(entry);
  } catch (error) {
    state.redo.pop();
    state.undo.push(entry);
    reportUiError(error, "Не удалось отменить действие");
    syncHistoryControls();
    return;
  }
  clearSelection(); syncHistoryControls(); afterChange();
}
function redo() {
  if (!state.redo.length) return;
  const entry = state.redo.pop();
  const current = historySnapshot(historyTail(state.undo));
  state.undo.push(current);
  while (state.undo.length > undoDepth()) state.undo.shift();
  try {
    restoreHistoryEntry(entry);
  } catch (error) {
    state.undo.pop();
    state.redo.push(entry);
    reportUiError(error, "Не удалось вернуть действие");
    syncHistoryControls();
    return;
  }
  clearSelection(); syncHistoryControls(); afterChange();
}
window.captureHistoryState = () => historySnapshot(historyTail(state.undo));
window.commitHistoryFrom = commitHistoryFrom;
let autosaveTimer = null;
let saveStateQueue = Promise.resolve();
let pendingAutosavePayload = null;
const PENDING_PROJECT_NAME_KEY = "grado_pages_pending_project_name_v1";
function readPendingProjectName() {
  if (!window.GRADO_STATIC) return null;
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_PROJECT_NAME_KEY) || "null");
    return value && typeof value.name === "string"
      ? { name: value.name.slice(0, 240), savedAt: Number(value.savedAt) || 0 } : null;
  } catch (error) { return null; }
}
function rememberPendingProjectName(name) {
  if (!window.GRADO_STATIC) return;
  try {
    localStorage.setItem(PENDING_PROJECT_NAME_KEY, JSON.stringify({
      name: String(name).slice(0, 240), savedAt: Date.now(),
    }));
  } catch (error) { /* маленький аварийный ключ не обязателен в private mode */ }
}
function clearPendingProjectName(savedName = null) {
  if (!window.GRADO_STATIC) return;
  const pending = readPendingProjectName();
  if (savedName === null || (pending && pending.name === savedName)) {
    try { localStorage.removeItem(PENDING_PROJECT_NAME_KEY); } catch (error) {}
  }
}
function applyPendingProjectName() {
  const pending = readPendingProjectName();
  if (!pending) return false;
  document.getElementById("project-name").value = pending.name;
  return true;
}
// полный снимок состояния студии (общий проектный + личный вид). Один
// источник и для localStorage/autosave, и для веб-синхронизации (collab.js
// берёт из него только «общие» ключи проекта).
// skipHistory — для historySmallState(): иначе каждый снимок отмены заново
// материализовал бы десяток записей истории в строки (O(10n) на жест).
function collectState(opts = {}) {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    features: state.features, nextId: state.nextId,
    name: document.getElementById("project-name").value,
    density: document.getElementById("p-density").value,
    ratio: document.getElementById("p-ratio").value,
    educationZone: document.getElementById("p-education-zone").value,
    territoryMode: document.getElementById("p-territory-mode").value,
    krail: document.getElementById("p-krail").value,
    kba: document.getElementById("p-kba").value,
    layersVisible: Object.fromEntries(LAYERS_V2.map(L => [L.id, L.visible])),
    layerLocked: Object.fromEntries(
      LAYERS_V2.filter(L => L.locked).map(L => [L.id, true])),
    layerRules: Object.fromEntries(               // условное форматирование: атрибут → стиль
      LAYERS_V2.filter(L => L.rules && L.rules.length).map(L => [L.id, L.rules])),
    layerOrder: LAYERS_V2.map(L => L.id),           // порядок отрисовки (QGIS-панель)
    layerFmt: Object.fromEntries(                    // пер-слойное оформление холста
      LAYERS_V2.filter(L => L.fmt).map(L => [L.id, L.fmt])),
    layerFields: Object.fromEntries(                 // произвольные поля слоя (атрибутивная таблица)
      LAYERS_V2.filter(L => L.fields && L.fields.length).map(L => [L.id, L.fields])),
    layerTitles: Object.fromEntries(LAYERS_V2.map(L => [L.id, L.title])),
    userLayers: userLayersManifest(),                // созданные в UI слои — пережить перезагрузку
    activeLayerId: state.activeLayerId,
    sources: state.sources,
    basemapSource: basemap.source,
    exportStyle: exportStyleMode(),
    projectStyles: state.projectStyles || {},
    // undo/redo — снимки всего проекта; у больших выгрузок их сериализация в
    // автосейв = главный фриз. Для них историю не персистим (в сессии undo
    // работает, после перезагрузки — сбрасывается). Малые — как прежде.
    undo: opts.skipHistory || state.features.length > 8000 ? [] : historyStackToStrings(state.undo),
    redo: opts.skipHistory || state.features.length > 8000 ? [] : historyStackToStrings(state.redo),
    projectCustomKinds: state.projectCustomKinds || [],
    variants: state.variants || [],
    accessRadii: state.accessRadii,
    albumConfig: state.albumConfig,
  };
}
// Настройки, которые должны ехать внутри .grado вместе с геометрией. Без
// features и истории: они уже хранятся в собственных таблицах/метаданных
// файла и не должны дублироваться в один огромный JSON.
function collectProjectSettings() {
  const saved = { ...collectState() };
  delete saved.features;
  delete saved.nextId;
  delete saved.undo;
  delete saved.redo;
  return saved;
}
// личное (не отправляется коллегам): вид/выделение здесь не хранятся в payload
// вовсе, а активный слой/подложка/undo — да; collab.js накладывает их поверх
// общего состояния при приёме чужих правок, чтобы у каждого свой вид.
function collectPersonal() {
  return {
    activeLayerId: state.activeLayerId, basemapSource: basemap.source,
    exportStyle: exportStyleMode(),
    undo: historyStackToStrings(state.undo), redo: historyStackToStrings(state.redo),
    variants: state.variants || [], accessRadii: state.accessRadii,
    layersVisible: Object.fromEntries(LAYERS_V2.map(L => [L.id, L.visible])),
  };
}
window.collectState = collectState;
window.collectPersonal = collectPersonal;
let _lsOverflow = false;   // большой проект не влезает в localStorage (~5 МБ):
                           // после первого QuotaExceeded НЕ стрингифаем впустую
                           // 100 МБ на каждую правку (главный источник фризов)
function setSaveStatus(text, kind = "") {
  const el = document.getElementById("st-save");
  if (!el) return;
  el.textContent = text;
  el.className = kind ? `save-${kind}` : "";
}
// Отказ автосохранения раньше было видно только по мелкой надписи «Не сохранено»
// в статус-строке: оба вызывающих места глушат ошибку через .catch(() => {}).
// Можно было часами работать с неработающим автосейвом и потерять всё при
// закрытии вкладки. Теперь — заметное сообщение (один раз на серию неудач)
// и предупреждение браузера при попытке уйти.
let autosaveFailed = false;
function noteAutosaveResult(ok) {
  if (ok === autosaveFailed) {   // состояние сменилось
    autosaveFailed = !ok;
    if (!ok) toast("Автосохранение не работает — сохраните проект файлом "
      + "(Проект → Сохранить .grado-web.json), иначе правки пропадут", "error");
  }
}
// Версия автосейва, поверх которой пишет ЭТА вкладка. Хранилище одно на origin,
// и раньше каждая вкладка перезаписывала его целиком без сверки: вторая вкладка,
// открытая час назад, одной правкой затирала свежую работу первой — молча и
// невосстановимо. Теперь пишем «поверх известной версии» (семантика If-Match):
// разошлись — сервер отвечает 409, и мы НЕ затираем чужое.
let autosaveBase = null;
let autosaveConflict = false;
function noteAutosaveConflict() {
  if (autosaveConflict) return;
  autosaveConflict = true;
  toast("Проект изменён в другой вкладке. Чтобы не затереть те правки, "
    + "автосохранение здесь остановлено — сохраните эту версию файлом "
    + "(Проект → Сохранить .grado-web.json) или перезагрузите страницу", "error");
}
window.addEventListener("beforeunload", event => {
  if (!autosaveFailed && !autosaveConflict) return;
  event.preventDefault();
  event.returnValue = "";   // требуется частью браузеров для показа диалога
});

async function saveStateRequest(payload, options = {}) {
  setSaveStatus("Сохранение…", "busy");
  try {
    if (autosaveConflict) throw new Error("Автосохранение остановлено из-за конфликта вкладок");
    const headers = { "Content-Type": "application/json" };
    if (options.checkpoint) headers["X-Grado-Checkpoint"] = "1";
    if (autosaveBase) headers["X-Grado-Base"] = autosaveBase;
    const response = await fetch("/api/autosave", {
      method: "POST", headers,
      body: JSON.stringify(payload),
    });
    if (response.status === 409) {
      setSaveStatus("Не сохранено", "error");
      noteAutosaveConflict();
      throw new Error("Проект изменён в другой вкладке");
    }
    if (!response.ok) {
      const issue = await response.json().catch(() => ({}));
      throw new Error(issue.error || `HTTP ${response.status}`);
    }
    const result = await response.json();
    clearPendingProjectName(payload && payload.name);
    const savedAt = result && result.saved_at ? new Date(result.saved_at) : new Date();
    const time = Number.isNaN(savedAt.getTime()) ? "" :
      ` ${savedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    setSaveStatus(`Сохранено${time}`, "ok");
    if (result && result.saved_at) autosaveBase = result.saved_at;
    noteAutosaveResult(true);
    return result;
  } catch (error) {
    setSaveStatus("Не сохранено", "error");
    noteAutosaveResult(false);
    throw error;
  }
}
function saveStateNow(payload, options = {}) {
  // Автосейв, контрольная копия и замена проекта обязаны завершаться в том
  // же порядке, в котором пользователь их запустил. ThreadingHTTPServer и
  // IndexedDB иначе могут последними записать более старый снимок.
  const pending = saveStateQueue.then(
    () => saveStateRequest(payload, options),
    () => saveStateRequest(payload, options),
  );
  saveStateQueue = pending.catch(() => {});
  return pending;
}
function persist(delay = 1500) {
  const payload = collectState();
  // В статической браузерной версии единственный источник автосохранения —
  // pages-adapter. Раньше тот же JSON одновременно занимал два localStorage-
  // ключа и крупный проект упирался в квоту вдвое раньше.
  if (!_lsOverflow && !window.GRADO_STATIC) {
    try { localStorage.setItem("grado_studio_v1", JSON.stringify(payload)); }
    catch (e) {
      // QuotaExceeded (проект > лимита) → больше не пытаемся; приватный режим —
      // тоже деградация. Файловый автосейв ниже всё равно сохранит.
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) _lsOverflow = true;
    }
  }
  // веб-режим совместной работы: правки уходят на сервер (collab.js),
  // общий файловый autosave не используем (его затирали бы разные юзеры)
  if (window.Collab && window.Collab.active) {
    setSaveStatus("");
    if (window.hubSchedulePush) window.hubSchedulePush();
    return;
  }
  // файловый бэкап на диске сервера: переживает чистку данных сайта и смену
  // браузера, чего localStorage не гарантирует. Дебаунс — не пишем на диск
  // на каждое перемещение мыши при afterChange().
  clearTimeout(autosaveTimer);
  pendingAutosavePayload = payload;
  setSaveStatus("Есть изменения", "busy");
  autosaveTimer = setTimeout(() => {
    const latest = pendingAutosavePayload;
    pendingAutosavePayload = null;
    if (latest) saveStateNow(latest).catch(() => {});
  }, delay);
}
function flushPendingAutosave() {
  if (!pendingAutosavePayload || (window.Collab && window.Collab.active)) return;
  clearTimeout(autosaveTimer);
  const latest = pendingAutosavePayload;
  pendingAutosavePayload = null;
  // Запускаем запись до ухода страницы. Desktop уже синхронно обновил
  // localStorage; Pages дополнительно начинает IndexedDB-транзакцию.
  saveStateNow(latest).catch(() => {});
}
window.addEventListener("pagehide", flushPendingAutosave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingAutosave();
});
// пикетаж: подтягиваем расчёт ядра, кэш по ключу геометрии. Запросы могут
// завершиться не по порядку, поэтому ответ применяется только к тому же
// живому объекту и только пока его геометрия/настройки не изменились.
const stationRequests = new Map();
function stationRequestKey(f) {
  return JSON.stringify(f.line) + "|" + (f.props.radius || 0) + "|" + f.props.pk_step;
}
function cancelStaleStationRequests() {
  const liveById = new Map(state.features.map(feature => [feature.id, feature]));
  for (const [id, request] of stationRequests) {
    const live = liveById.get(id);
    if (live !== request.feature || !(live.props.pk_step > 0)) {
      request.controller.abort();
      stationRequests.delete(id);
    }
  }
}
async function refreshStations(f) {
  const key = stationRequestKey(f);
  if (f.props._stations_key === key) return;
  const previous = stationRequests.get(f.id);
  previous?.controller.abort();
  const controller = new AbortController();
  const request = { feature: f, key, controller };
  stationRequests.set(f.id, request);
  try {
    const r = await fetch("/api/redline-stations", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: f.line, radius: f.props.radius || 0,
                             step: f.props.pk_step }), signal: controller.signal });
    if (!r.ok) return;
    const data = await r.json();
    if (stationRequests.get(f.id) !== request) return;
    if (state.features.find(feature => feature.id === f.id) !== f) return;
    if (stationRequestKey(f) !== key || !Array.isArray(data.stations)) return;
    f.props._stations = data.stations;
    f.props._stations_key = key;
    draw();
  } catch (e) {
    if (e?.name !== "AbortError") {
      /* ядро недоступно — пикетаж просто не обновится */
    }
  } finally {
    if (stationRequests.get(f.id) === request) stationRequests.delete(f.id);
  }
}
function maybeRefreshStations() {
  cancelStaleStationRequests();
  for (const f of state.features)
    if (f.kind === "redline" && (f.props.pk_step || 0) > 0) refreshStations(f);
}

function afterChange() {
  state._ix = null; state._snapIndex = null;
  syncHistoryControls();
  // страховка: убрать из выделения id несуществующих объектов (после
  // импорта/очистки/undo, где features заменяются целиком)
  if (state.selectedIds && state.selectedIds.size) {
    const live = new Set(state.features.map(f => f.id));
    for (const id of [...state.selectedIds]) if (!live.has(id)) state.selectedIds.delete(id);
    if (state.selected != null && !live.has(state.selected)) state.selected = null;
  }
  draw(); renderProps(); renderLayers(); refreshTep(); persist();
  maybeRefreshStations();
}

// ---------- ТЭП ----------
let tepTimer = null;
let tepRequestVersion = 0;
let tepAbortController = null;
// «+value || fallback» подменял ЛЮБОЙ falsy результат, в том числе легитимный
// ноль: «доля жилья 0 %» (полностью нежилая застройка — редактор её разрешает,
// min="0") молча превращалась в 80 %, и ТЭП считал население, ДОО, школы и
// парковки для несуществующих жителей. Ядро ноль принимает корректно
// (bounded(params.ratio_zh, 0, 100, 80)), поэтому фолбэк нужен только для
// пустого/нечислового поля.
function numParam(id, fallback) {
  const el = document.getElementById(id);
  const value = el ? Number.parseFloat(el.value) : NaN;
  return Number.isFinite(value) ? value : fallback;
}
function params() {
  return { density: numParam("p-density", 25),
           ratio_zh: numParam("p-ratio", 80),
           education_zone: numParam("p-education-zone", 1) === 2 ? 2 : 1,
           territory_mode: numParam("p-territory-mode", 1) === 2 ? 2 : 1,
           k_rail: numParam("p-krail", 1),
           k_ba: numParam("p-kba", 0.5) };
}
const TEP_AUTO_MAX = 8000;   // выше — авто-ТЭП выключен: иначе на КАЖДУЮ правку
                             // стрингуется и уходит на сервер весь проект (десятки
                             // МБ) → фриз. Для больших выгрузок пересчёт по кнопке.
function refreshTep(force) {
  clearTimeout(tepTimer);
  const requestVersion = ++tepRequestVersion;
  const st = document.getElementById("tep-status");
  if (state.features.length > TEP_AUTO_MAX && !force) {
    tepAbortController?.abort();
    if (st) {
      st.innerHTML = 'большой проект · <a href="#" id="tep-manual">пересчитать</a>';
      const a = document.getElementById("tep-manual");
      if (a) a.onclick = ev => { ev.preventDefault(); refreshTep(true); };
    }
    return;
  }
  if (st) st.textContent = "…";
  tepTimer = setTimeout(async () => {
    tepAbortController?.abort();
    const controller = new AbortController();
    tepAbortController = controller;
    const requestBody = JSON.stringify({ features: tepFeatures(), params: params() });
    try {
      const r = await fetch("/api/tep", { method: "POST", headers: { "Content-Type": "application/json" },
        body: requestBody, signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (requestVersion !== tepRequestVersion) return;
      if (!data || !Array.isArray(data.results) || !data.fact)
        throw new Error("invalid calculation response");
      renderTep(data);
      window.lastTepData = data;
      window.lastTepSignature = requestBody;
      document.getElementById("tep-status").textContent = "";
      // в норме статус чистый — техническое «ядро: ок» пользователю не нужно
      document.getElementById("st-core").textContent = "";
    } catch (e) {
      if (e?.name === "AbortError" || requestVersion !== tepRequestVersion) return;
      document.getElementById("tep-status").textContent = "нет связи с расчётом";
      document.getElementById("st-core").textContent = "⚠ расчёт недоступен (клик для reconnect)";
      if (window.lastTepData && window.lastTepSignature === requestBody) {
        renderTep(window.lastTepData);
      } else {
        renderTepUnavailable();
      }
    } finally {
      if (tepAbortController === controller) tepAbortController = null;
    }
  }, 250);
}
function renderTepUnavailable() {
  const fact = document.getElementById("tep-fact");
  const body = document.getElementById("tep-body");
  fact.innerHTML = "";
  body.classList.add("muted");
  body.innerHTML = `<div class="tep-empty"><b>Расчёт временно недоступен</b>` +
    `Проект не изменён. Проверьте соединение и повторите расчёт.` +
    `<div class="tep-empty-actions"><button type="button" id="tep-retry">Повторить расчёт</button></div></div>`;
  body.querySelector("#tep-retry")?.addEventListener("click", () => refreshTep(true));
}
function renderTep(data) {
  const fact = document.getElementById("tep-fact");
  const bodyEl = document.getElementById("tep-body");
  // Без границы территории разработки ТЭП не считается: цифры «по всей карте»
  // вводят в заблуждение (площадь = дефолт пресета). Показываем призыв начертить.
  if (data && data.has_territory === false) {
    fact.innerHTML = "";
    bodyEl.classList.add("muted");
    bodyEl.innerHTML = `<div class="tep-empty"><b>Нет границы территории</b>` +
      `ТЭП считается только внутри расчётного контура.` +
      `<div class="tep-empty-actions"><button type="button" id="tep-start-boundary">Создать границу</button>` +
      `<button type="button" id="tep-open-demo">Открыть пример</button></div></div>`;
    bodyEl.querySelector("#tep-start-boundary")?.addEventListener("click", startBoundaryFlow);
    bodyEl.querySelector("#tep-open-demo")?.addEventListener("click", () => document.getElementById("btn-demo")?.click());
    return;
  }
  let zonesHtml = "";
  if (data.zones) {
    zonesHtml = data.zones.ok
      ? `<div class="tep-zone-status ok" role="status">
           <span class="tep-zone-title">Покрытие функциональных зон корректно</span>
           <span class="tep-zone-meta"><b>${escHtml(data.zones.total_ha)} га</b><small>Общих границ: ${escHtml(data.zones.shared_edges)}</small></span>
         </div>`
      : `<div class="tep-zone-status warning" role="status">
           <span class="tep-zone-title">Требуется проверить зонирование</span>
           <span class="tep-zone-error">${escHtml(data.zones.error)}</span>
         </div>`;
  }
  fact.innerHTML = `<div class="tep-fact-head"><b>Фактическая посадка</b><small>по объектам на холсте</small></div>
    <div class="tep-row"><span>СПП факт</span><span class="v">${data.fact.spp} <small>тыс. м²</small></span></div>
    <div class="tep-row"><span>Плотность факт</span><span class="v">${data.fact.density} <small>тыс. м²/га</small></span></div>
    ${zonesHtml}
    <div class="tep-context-note">Ниже — расчётный потенциал по заданной нормативной плотности, а не уже размещённые здания.</div>`;
  const body = document.getElementById("tep-body");
  body.classList.remove("muted");
  let html = "", group = null;
  const duplicateNeeds = new Set(["doo_places", "school_places", "policlinic_places"]);
  for (const r of data.results.filter(row => !duplicateNeeds.has(row.id))) {
    if (r.group !== group) {
      group = r.group;
      const groupTitle = group === "Застройка" ? "Расчётный потенциал" : group;
      html += `<div class="tep-group">${groupTitle}</div>`;
    }
    html += `<div class="tep-row"><span>${escHtml(r.title)}</span><span class="v">${escHtml(r.value)} <small>${escHtml(r.unit)}</small></span></div>`;
  }
  if (data.checks && data.checks.length) {
    html += `<div class="tep-group">Проверки</div>`;
    for (const c of data.checks) {
      const stateClass = c.ok ? "ok" : "warning";
      html += `<div class="tep-check ${stateClass}">
        <span class="tep-check-mark" aria-hidden="true"></span>
        <span class="tep-check-copy"><b>${escHtml(c.title)}</b><span>${escHtml(c.msg)}</span></span>
      </div>`;
    }
  }
  body.innerHTML = html;
}

// ---------- свойства (UI-03: поля из схемы semantic_class слоя, не из kind) ----------
// Поле появляется потому, что у активного слоя такой semantic_class, а не
// потому, что где-то в коде проверяется f.kind === "building". Добавление
// атрибута новому слою — правка этой таблицы, а не новая ветка в renderProps.
const ATTR_FIELDS = {
  "oks.building": [
    { key: "floors", title: "Этажность", type: "number", min: 1, max: 75,
      cast: v => Math.min(75, Math.max(1, parseInt(v) || 9)) },
    { type: "computed",
      compute: f => `СПП: ${(featureArea(f) * (f.props.floors || 1) / 1000).toFixed(1)} тыс. м²` },
  ],
  "pp.red_line": [
    { key: "radius", title: "Радиус сопряжения, м", type: "number", min: 0, max: 500, step: 5,
      cast: v => Math.min(500, Math.max(0, parseFloat(v) || 0)) },
    { key: "pk_step", title: "Пикетаж, шаг м (0 — выкл)", type: "number", min: 0, max: 500, step: 10,
      cast: v => Math.min(500, Math.max(0, parseFloat(v) || 0)) },
    { type: "offset" },
  ],
  "tp.func_zone": [
    { key: "zone_title", title: "Наименование зоны", type: "text" },
  ],
  "pp.placement_zone": [
    { key: "purpose", title: "Назначение", type: "text" },
  ],
};

function fieldHtml(field, f) {
  if (field.type === "offset") {
    return `<label>Офсет, м<input type="number" id="f-offdist" value="${boundedNumber(f.props._offdist, 0.5, 200, 15)}" min="0.5" max="200" step="0.5" required></label>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button id="f-offset-l" style="flex:1">⇐ влево</button>
        <button id="f-offset-r" style="flex:1">вправо ⇒</button>
      </div>`;
  }
  const val = f.props[field.key] ?? (field.key === "radius" ? 0 : "");
  return `<label>${escHtml(field.title)}<input type="${field.type}" id="f-${field.key}" value="${escHtml(val)}"${
    field.min != null ? ` min="${field.min}"` : ""}${
    field.max != null ? ` max="${field.max}"` : ""}${
    field.step != null ? ` step="${field.step}"` : ""}${
    field.type === "number" ? " required" : ""}></label>`;
}

let propertyErrorSeq = 0;
function clearPropertyFieldError(input) {
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  input.closest("#props-body")?.querySelectorAll(".property-field-error")
    .forEach(error => error.remove());
}
function showPropertyFieldError(input, message) {
  clearPropertyFieldError(input);
  const error = document.createElement("div");
  error.id = `property-field-error-${++propertyErrorSeq}`;
  error.className = "form-error property-field-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  (input.closest("label") || input).insertAdjacentElement("afterend", error);
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", error.id);
  input.focus({ preventScroll: true });
  return false;
}
function validatePropertyNumber(input, label) {
  if (input.value.trim() && input.checkValidity()) {
    clearPropertyFieldError(input);
    return true;
  }
  const range = input.min && input.max ? ` от ${input.min} до ${input.max}` : "";
  return showPropertyFieldError(input, `${label}: введите значение${range}.`);
}

// поле произвольного атрибута слоя (из атрибутивной таблицы) в форме объекта —
// как форма объекта в QGIS: правишь значение прямо в панели «Свойства».
// id по индексу (имя поля бывает кириллицей/с пробелами — не годится в id)
function userFieldHtml(cf, f, i) {
  const id = `fu-${i}`;
  const v = f.props ? f.props[cf.name] : undefined;
  if (cf.type === "bool")
    return `<label class="chk"><input type="checkbox" id="${id}"${v ? " checked" : ""}> ${escHtml(cf.name)}</label>`;
  const itype = (cf.type === "int" || cf.type === "real") ? "number"
              : (cf.type === "date" ? "date" : "text");
  const step = cf.type === "real" ? ' step="any"' : (cf.type === "int" ? ' step="1"' : "");
  return `<label>${escHtml(cf.name)}<input type="${itype}"${step} id="${id}" value="${escHtml(v ?? "")}"></label>`;
}

const offsetRequests = new WeakSet();
async function runOffset(f, sign, buttons = []) {
  if (offsetRequests.has(f)) return false;
  const distanceInput = document.getElementById("f-offdist");
  if (!validatePropertyNumber(distanceInput, "Офсет")) return false;
  const dist = Math.abs(Number(distanceInput.value));
  f.props._offdist = dist;
  offsetRequests.add(f);
  buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  try {
    const r = await fetch("/api/redline-offset", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: f.line, radius: f.props.radius || 0,
                             dist: sign * dist }) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || ("HTTP " + r.status));
    }
    const data = await r.json();
    snapshot();
    // сопряжение уже вшито в геометрию офсета — radius обнуляем;
    // офсет остаётся на слое исходной линии, а не «слое по умолчанию» —
    // иначе на пользовательском слое линий копия тихо ушла бы не туда
    const copy = upgradeFeature({ id: state.nextId++, layer_id: f.layer_id,
                                  line: data.line, props: { radius: 0 } });
    state.features.push(copy);
    selectOne(copy.id);
    afterChange();
    return true;
  } catch (err) {
    toast("Офсет не построился: " + String(err).slice(0, 160) +
          " (обычно радиус/офсет не помещается в геометрию)", "error");
    return false;
  } finally {
    offsetRequests.delete(f);
    buttons.forEach(button => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
  }
}

let bufferRequestPending = false;
async function generateBuffers(selectedIds, dist, sides = "both") {
  if (bufferRequestPending) return false;
  if (!selectedIds || !selectedIds.length) {
    const s = selectionIds();
    if (!s.length) { toast("Выберите объекты для буфера", "warn"); return false; }
    selectedIds = s;
  }
  dist = Number(dist);
  if (!Number.isFinite(dist) || dist < 1 || dist > 2000) {
    toast("Укажите расстояние от 1 до 2000 м", "warn");
    return false;
  }
  sides = ["both", "outer", "inner"].includes(sides) ? sides : "both";
  const selFeats = state.features.filter(f => selectedIds.includes(f.id));
  if (!selFeats.length) return false;

  bufferRequestPending = true;
  document.querySelectorAll("#btn-buffer, #btn-buffer-open, #buffer-create").forEach(button => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  try {
    const r = await fetch("/api/buffer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        features: selFeats.map(f => ({ ...f, point: f.point, line: f.line, ring: f.ring, arc: f.arc, circle: f.circle, props: f.props, kind: f.kind, layer_id: f.layer_id })),
        dist,
        sides,
        fillet: 0
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (!data.features || !data.features.length) {
      toast("Буфер пуст (возможно слишком большой радиус)", "warn");
      return false;
    }
    snapshot();
    const L = activeLayer();
    for (const bf of data.features) {
      const nf = upgradeFeature({ id: state.nextId++, ...(bf), layer_id: (L && L.id) || bf.layer_id });
      state.features.push(nf);
    }
    afterChange();
    toast(`Создано буферов: ${data.features.length}`);
    return true;
  } catch (err) {
    toast("Не удалось сгенерировать буфер: " + String(err).slice(0, 150), "error");
    return false;
  } finally {
    bufferRequestPending = false;
    document.querySelectorAll("#btn-buffer, #btn-buffer-open, #buffer-create").forEach(button => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
  }
}

function geomType(f) { return f.ring ? "polygon" : f.line ? "polyline" : "point"; }

// редактируемые атрибуты слоя: семантические (ATTR_FIELDS, без computed/offset)
// + произвольные поля (атрибутивная таблица) — общий список для формы/масс-правки
function editableAttrs(L) {
  if (!L) return [];
  const sem = (ATTR_FIELDS[L.semantic_class] || [])
    .filter(fl => fl.type !== "computed" && fl.type !== "offset")
    .map(fl => ({ key: fl.key, title: fl.title, type: fl.type, cast: fl.cast }));
  const usr = (L.fields || []).map(cf => ({ key: cf.name, title: cf.name, type: cf.type }));
  return [...sem, ...usr];
}

// панель для группового выделения (несколько объектов)
function renderGroupProps(el, ids) {
  el.className = "";
  const feats = selectionFeatures();
  const types = new Set(feats.map(geomType));
  const gt = types.size === 1 ? [...types][0] : null;
  const targets = gt ? LAYERS_V2.filter(L => !L.annotation && !L.import_only &&
                                             L.geometry_type === gt) : [];
  const moveHtml = targets.length ? `<div class="prop-sub">Групповые операции</div>
    <label>Переместить на слой<select id="g-layer">${
      targets.map(L => `<option value="${L.id}">${escHtml(L.title)}</option>`).join("")}</select></label>
    <button id="g-move" class="fmt-copy-btn" style="margin-left:0">Переместить</button>` : "";
  // масс-правка атрибута: поля, общие ВСЕМ выделенным (по слоям объектов)
  const perFeat = feats.map(f => editableAttrs(layerOf(f)));
  const common = perFeat.length
    ? perFeat[0].filter(a => perFeat.every(list => list.some(b => b.key === a.key)))
    : [];
  const attrHtml = common.length ? `<div class="prop-sub">Массовая правка атрибута</div>
    <label>Поле<select id="g-attr">${
      common.map((a, i) => `<option value="${i}">${escHtml(a.title)}</option>`).join("")}</select></label>
    <label>Значение<input type="text" id="g-attr-val" placeholder="записать во все выделенные"></label>
    <button id="g-attr-apply" class="fmt-copy-btn" style="margin-left:0">Записать во все ${ids.length}</button>` : "";
  el.innerHTML = `<div class="kind">Выделено объектов: ${ids.length}</div>
    <div class="metric">перетаскивание — двигать группой · Shift+клик — добавить/убрать · Del — удалить</div>
    ${moveHtml}${attrHtml}
    ${transformControlsHtml()}
    <button class="danger" id="g-del" style="margin-top:8px">Удалить выделенные (Del)</button>`;
  const gm = document.getElementById("g-move");
  if (gm) gm.onclick = () => {
    const tid = document.getElementById("g-layer").value;
    const L = LAYER_BY_ID[tid];
    snapshot();
    for (const f of selectionFeatures()) { f.layer_id = tid; if (L) f.kind = L.kind; }
    afterChange();
    toast(`Перемещено ${ruCount(ids.length, "объект", "объекта", "объектов")} на «${L.title}»`);
  };
  const ga = document.getElementById("g-attr-apply");
  if (ga) ga.onclick = () => {
    const a = common[+document.getElementById("g-attr").value];
    const raw = document.getElementById("g-attr-val").value;
    snapshot();
    for (const f of selectionFeatures()) {
      const v = a.cast ? a.cast(raw)
                       : castField(a.type === "number" ? "real" : a.type, raw);
      if (v === "" || v === null || v === undefined) delete f.props[a.key];
      else f.props[a.key] = v;
    }
    afterChange();
    toast(`Записано «${a.title}» в ${ruCount(ids.length, "объект", "объекта", "объектов")}`);
  };
  document.getElementById("g-del").onclick = deleteSelected;
  bindTransformControls();
}

function renderProps() {
  const el = document.getElementById("props-body");
  const selIds = selectionIds();
  if (selIds.length > 1) { renderGroupProps(el, selIds); return; }
  const f = selectedFeature();
  if (!f) {
    el.className = "muted";
    const L = activeLayer();
    if (L) {
      el.innerHTML = `Активный слой: <b>${escHtml(L.title)}</b><br>Выберите инструмент слева и чертите — объекты попадут сюда.<br>` +
        `<button class="small" style="margin-top:6px" id="props-goto-layer">Оформление слоя…</button>`;
      const btn = el.querySelector("#props-goto-layer");
      if (btn) btn.onclick = () => openLayerStyle(L);
    } else {
      el.textContent = "Нет активного слоя. Создайте слой в панели «Слои» справа.";
    }
    return;
  }
  el.className = "";
  const L = layerOf(f);
  const cur = styleOf(f);
  let fields = (L && ATTR_FIELDS[L.semantic_class]) || [];
  // generalize fillet (radius) to any polyline, not only redline kind — per Etap 2 roadmap "сопряжения на любых линиях"
  if (f.line && !f.arc && !f.ring && fields.length === 0) {
    fields = [
      { key: "radius", title: "Радиус сопряжения, м", type: "number", min: 0, max: 500, step: 5,
        cast: v => Math.min(500, Math.max(0, parseFloat(v) || 0)) }
    ];
  }
  let metric = "";
  if (f.ring) metric = `площадь: ${fmtAreaHa(featureArea(f))}`;
  if (f.line) metric = `длина: ${fmtLen(lineLen(f.line))}`;
  if (f.arc) metric = `дуга: R ${fmtLen(f.arc.r)}, длина ${fmtLen(Math.abs(f.arc.sweep) * f.arc.r)}`;
  if (f.circle) metric = `окружность: R ${fmtLen(f.circle.r)}`;
  for (const field of fields)
    if (field.type === "computed") metric += ` · ${field.compute(f)}`;
  const extra = fields.filter(fl => fl.type !== "computed").map(fl => fieldHtml(fl, f)).join("\n");
  // произвольные поля слоя (атрибутивная таблица) — редактируемы в форме объекта
  const userFields = (L && L.fields) || [];
  const userFieldsHtml = userFields.length
    ? `<div class="prop-sub">Атрибуты</div>` +
      userFields.map((cf, i) => userFieldHtml(cf, f, i)).join("\n")
    : "";
  const prov = f.prov
    ? `<div class="metric prov">источник: ${escHtml(f.prov.source)}${f.prov.source_date ? " · " + escHtml(f.prov.source_date) : ""}</div>`
    : "";
  // === Унифицированный блок "Стиль и оформление объекта" ===
  // Цель: одна понятная секция вместо двух дублирующих ("Стиль (библиотека)" + "Оформление объекта").
  // - Выбор знака из библиотеки (влияет на .grado и стандартный экспорт).
  // - Дополнительные правки только для отображения (холст + режим "как на холсте").
  // "Как у слоя" = не переопределять f.style_id.
  let styleHtml = "";
  if (L && !L.annotation) {
    const curStyle = f.style_id || "";
    const opts = stylePickerOptions(curStyle);
    styleHtml = `
    <div class="prop-sub">Стиль и оформление</div>
    <label>Знак из библиотеки
      <select id="f-style">
        <option value="">как у слоя</option>
        ${opts}
      </select>
    </label>
    <label class="chk"><input type="checkbox" id="f-fmt-on" ${f.fmt ? "checked" : ""}> дополнительные правки отображения (холст)</label>
    ${f.fmt ? `<label>Заливка<div id="f-fmt-fill"></div></label>
      <label>Обводка<div id="f-fmt-stroke"></div></label>
      <label>Прозрачность, %<input type="range" id="f-fmt-op" min="10" max="100" step="5" value="${Math.round((f.fmt.fillOpacity ?? cur.fillOpacity ?? 1) * 100)}"></label>` : ""}
    <div class="metric" style="font-size:11px;color:var(--muted);margin-top:2px">Правки влияют только на экран и «знаки: как на холсте». Для стандартного PDF — используйте «Знак из библиотеки» или правила слоя.</div>`;
  }
  const onlyBoundary = f.kind === "boundary" && state.features.every(item =>
    item && (item.kind === "boundary" || item.kind === "dim"));
  const nextStepHtml = onlyBoundary ? `<div class="props-next-step" role="region" aria-label="Следующий шаг проекта">
    <span>Следующий шаг</span><b>Добавьте проектные объекты</b>
    <p>Граница задаёт расчётную площадь. Теперь разместите здания или функциональные зоны — фактические показатели появятся в ТЭП.</p>
    <div><button type="button" id="props-add-building">Добавить здание</button><button type="button" id="props-add-zone">Добавить зону</button></div>
  </div>` : "";
  el.innerHTML = `<div class="kind">${escHtml((L || {}).title || f.kind)}</div>
    <div class="metric">${metric}</div>${prov}${nextStepHtml}${extra}${userFieldsHtml}${styleHtml}
    ${f.point ? "" : transformControlsHtml()}
    <div class="metric" style="margin-top:6px">двойной клик по ребру — вершина,<br>Alt+клик по вершине — удалить,<br>R — поворот, ${modKeyLabel("D")} — дубликат</div>
    <button class="danger" id="f-del">Удалить (Del)</button>`;
  const startNextLayer = kind => {
    state.selected = null;
    quickLayerByKind(kind);
    renderProps();
  };
  el.querySelector("#props-add-building")?.addEventListener("click", () => startNextLayer("building"));
  el.querySelector("#props-add-zone")?.addEventListener("click", () => startNextLayer("zone"));
  if (f.line && (f.props.radius || 0) > 0) {
    const b = document.createElement("button");
    b.textContent = "Применить сопряжение";
    b.title = "Bake fillet into geometry points (set radius=0)";
    b.style.marginTop = "4px";
    b.onclick = () => applyFillet(f);
    el.appendChild(b);
  }
  // Обработчики унифицированного блока стиля/оформления объекта
  const styleSel = document.getElementById("f-style");
  if (styleSel) styleSel.addEventListener("change", async () => {
    if (styleSel.value === "__create_project_style__") {
      const newId = await createProjectStyle();
      if (newId) {
        f.style_id = newId;
        renderProps(); // refresh to show new
      } else {
        styleSel.value = f.style_id || "";
      }
      return;
    }
    snapshot();
    if (styleSel.value) f.style_id = styleSel.value;
    else delete f.style_id;
    afterChange(); draw();
  });
  const bind = (id, key, cast) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener("input", () => clearPropertyFieldError(inp));
    inp.addEventListener("change", () => {
      const field = fields.find(item => item.key === key);
      if (inp.type === "number" &&
          !validatePropertyNumber(inp, field?.title || "Числовое значение")) return;
      snapshot(); f.props[key] = cast ? cast(inp.value) : inp.value; afterChange();
    });
  };
  for (const field of fields) {
    if (field.type === "computed") continue;
    if (field.type === "offset") {
      const offL = document.getElementById("f-offset-l");
      const offR = document.getElementById("f-offset-r");
      if (offL) offL.onclick = () => runOffset(f, 1, [offL, offR]);
      if (offR) offR.onclick = () => runOffset(f, -1, [offL, offR]);
      continue;
    }
    bind(`f-${field.key}`, field.key, field.cast);
  }
  // произвольные поля слоя — правка значения прямо в форме объекта
  userFields.forEach((cf, i) => {
    const inp = document.getElementById(`fu-${i}`);
    if (!inp) return;
    inp.addEventListener("change", () => {
      snapshot();
      const v = cf.type === "bool" ? inp.checked : castField(cf.type, inp.value);
      if (v === "" || v === null || v === undefined) delete f.props[cf.name];
      else f.props[cf.name] = v;
      afterChange();
    });
  });
  // Дополнительные правки отображения (f.fmt)
  const fmtOn = document.getElementById("f-fmt-on");
  if (fmtOn) fmtOn.addEventListener("change", () => {
    snapshot();
    if (fmtOn.checked) {
      const c = styleOf(f);
      f.fmt = { fill: toHexColor(c.fill, "#faf0bf"),
                stroke: toHexColor(c.stroke, "#888888"),
                fillOpacity: c.fillOpacity ?? 1 };
    } else delete f.fmt;
    afterChange(); renderProps();
  });
  if (f.fmt) {
    const host = k => document.getElementById(k);
    if (host("f-fmt-fill"))
      makeColorField(host("f-fmt-fill"), toHexColor(f.fmt.fill || cur.fill, "#faf0bf"),
                     h => { if (f.fmt) { f.fmt.fill = h; draw(); persist(); } });
    if (host("f-fmt-stroke"))
      makeColorField(host("f-fmt-stroke"), toHexColor(f.fmt.stroke || cur.stroke, "#888888"),
                     h => { if (f.fmt) { f.fmt.stroke = h; draw(); persist(); } });
    const op = host("f-fmt-op");
    if (op) {
      op.addEventListener("input", () => { if (f.fmt) { f.fmt.fillOpacity = (parseInt(op.value) || 100) / 100; draw(); } });
      op.addEventListener("change", persist);
    }
  }
  document.getElementById("f-del").onclick = deleteSelected;
  bindTransformControls();
}
// Порядок панели — как в QGIS: верхняя строка рисуется ПОВЕРХ. В draw()
// массив идёт снизу вверх (индекс 0 = низ), поэтому список = обратный массив.
function layerRowsTopFirst() {
  // Приёмники импорта и размеры показываем только если в них уже есть объекты
  // (меньше захламления). Но теперь их можно явно удалить или переоформить —
  // система стала гибче (см. resetLayerFormatting и deleteLayer).
  return [...LAYERS_V2].reverse()
    .filter(L => !((L.import_only || L.annotation) && !featuresOnLayer(L.id).length));
}

// Перетаскивание строки src к строке target меняет порядок отрисовки.
// before=true — встать над target (рисоваться поверх него).
function reorderLayer(srcId, targetId, before) {
  if (srcId === targetId) return;
  const disp = [...LAYERS_V2].reverse();      // порядок показа (сверху вниз)
  const from = disp.findIndex(L => L.id === srcId);
  if (from < 0) return;
  const moved = disp.splice(from, 1)[0];
  let to = disp.findIndex(L => L.id === targetId);
  if (to < 0) return;
  if (!before) to += 1;
  snapshot();
  disp.splice(to, 0, moved);
  LAYERS_V2.splice(0, LAYERS_V2.length, ...disp.reverse());  // обратно в порядок отрисовки
  renderLayers(); draw(); persist();
}

const LAYER_GROUPS = {
  project: { title: "Проектирование", icon: "i-poly" },
  constraints: { title: "Ограничения", icon: "i-layers" },
  sources: { title: "Подложки и данные", icon: "i-map" },
};

function layerGroupKey(layer) {
  const title = String(layer.title || "").toLocaleLowerCase("ru");
  if (layer.import_only || layer.source_kind || layer.id.startsWith("source.")) return "sources";
  if (["restrict", "redline", "boundary"].includes(layer.kind)
      || /огранич|зоуит|охран|красн|границ|санитар|затоп/.test(title)) return "constraints";
  return "project";
}

function layerGeometryMeta(layer) {
  const type = layer.geometry_type || "polygon";
  if (type === "point") return { icon: "i-dot", label: "Точки" };
  if (type === "polyline" || type === "line") return { icon: "i-line", label: "Линии" };
  return { icon: "i-poly", label: "Полигоны" };
}

function renderLayerLegend(sampleByLayer = {}) {
  const host = document.getElementById("layers-legend-body");
  if (!host) return;
  host.innerHTML = "";
  const visibleLayers = layerRowsTopFirst().filter(layer => layer.visible);
  if (!visibleLayers.length) {
    host.innerHTML = '<div class="legend-empty">Включите видимость слоя — его знак появится здесь.</div>';
    return;
  }
  const groupHosts = new Map();
  const groupForKey = key => {
    if (groupHosts.has(key)) return groupHosts.get(key);
    const section = document.createElement("section");
    section.className = "legend-group";
    section.innerHTML = `<h3>${escHtml(LAYER_GROUPS[key].title)}</h3><div></div>`;
    host.appendChild(section);
    const body = section.lastElementChild;
    groupHosts.set(key, body);
    return body;
  };
  const presentGroups = new Set(visibleLayers.map(layerGroupKey));
  Object.keys(LAYER_GROUPS).filter(key => presentGroups.has(key)).forEach(groupForKey);
  visibleLayers.forEach(layer => {
    const group = groupForKey(layerGroupKey(layer));
    const cats = layerCatStats(layer).filter(cat => !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id));
    const items = cats.length > 1 ? cats : [{
      title: layer.title,
      count: featuresOnLayer(layer.id).length,
      sample: sampleByLayer[layer.id],
    }];
    items.forEach(item => {
      const style = item.sample ? styleOf(item.sample) : layerStyle(layer);
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="legend-sample" aria-hidden="true">${styleSampleSVG(style, { w: 54, h: 20 })}</span>
        <span class="legend-name">${escHtml(item.title || layer.title)}</span>
        <span class="legend-count">${item.count || ""}</span>`;
      group.appendChild(row);
    });
  });
}

function renderLayers() {
  const el = document.getElementById("layers-body");
  if (!el) return;
  el.innerHTML = "";
  // Знак-образец для свотча берём у ПЕРВОГО объекта слоя, а не из стиля слоя:
  // у слоёв-источников (ГИС ОГД) объекты несут свой знак (style_id), а стиль
  // слоя — общий контур, и превью рисовалось чёрной линией вместо знака (ООЗТ,
  // функц. зоны и т.п.). styleOf(объект) = ровно то, что нарисовано на холсте.
  const sampleByLayer = {};
  for (const f of state.features) {
    const lid = f.layer_id;
    if (!lid) continue;
    // предпочитаем объект СО знаком (style_id): в слое-источнике часть объектов
    // может быть без знака, и первый попавшийся дал бы пустой свотч
    const cur = sampleByLayer[lid];
    if (!cur || (!cur.style_id && f.style_id)) sampleByLayer[lid] = f;
  }
  const groupHosts = new Map();
  let groupState = {};
  try { groupState = JSON.parse(localStorage.getItem("grado_layer_groups") || "{}"); } catch (_) {}
  const groupHostForKey = key => {
    if (groupHosts.has(key)) return groupHosts.get(key);
    const meta = LAYER_GROUPS[key];
    const section = document.createElement("section");
    section.className = "layer-stack-group";
    section.dataset.group = key;
    const open = groupState[key] !== false;
    const groupLayers = LAYERS_V2.filter(layer => layerGroupKey(layer) === key);
    const allVisible = groupLayers.length > 0 && groupLayers.every(layer => layer.visible);
    section.classList.toggle("collapsed", !open);
    section.innerHTML = `<div class="layer-group-head-row"><button type="button" class="layer-group-head" aria-expanded="${open}">
      <svg class="ic"><use href="#ic-chevron"/></svg><span>${escHtml(meta.title)}</span><span class="layer-group-count"></span></button>
      <button type="button" class="layer-group-visibility${allVisible ? "" : " is-off"}" aria-label="${allVisible ? "Скрыть" : "Показать"} все слои группы «${escHtml(meta.title)}»" title="${allVisible ? "Скрыть" : "Показать"} все слои группы"><svg class="ic"><use href="#ic-eye"/></svg></button></div>
      <div class="layer-group-body"></div>`;
    const head = section.querySelector(".layer-group-head");
    head.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
      groupState[key] = !collapsed;
      try { localStorage.setItem("grado_layer_groups", JSON.stringify(groupState)); } catch (_) {}
    });
    section.querySelector(".layer-group-visibility").addEventListener("click", () => {
      snapshot();
      const nextVisible = !allVisible;
      groupLayers.forEach(layer => { layer.visible = nextVisible; });
      if (!nextVisible) {
        const selected = selectedFeature();
        if (selected && groupLayers.includes(layerOf(selected))) {
          state.selected = null;
          renderProps();
        }
      }
      state._ix = null; state._snapIndex = null;
      persist();
      draw();
      renderLayers();
      toast(`${nextVisible ? "Показаны" : "Скрыты"} все слои группы «${meta.title}»`);
    });
    el.appendChild(section);
    const body = section.querySelector(".layer-group-body");
    groupHosts.set(key, body);
    return body;
  };
  const displayedLayers = layerRowsTopFirst();
  const presentGroups = new Set(displayedLayers.map(layerGroupKey));
  Object.keys(LAYER_GROUPS).filter(key => presentGroups.has(key)).forEach(groupHostForKey);
  for (const layer of displayedLayers) {
    const groupHost = groupHostForKey(layerGroupKey(layer));
    const count = featuresOnLayer(layer.id).length;
    // QGIS-логика: если в слое объекты с РАЗНЫМИ знаками — показываем подпункты
    // по каждому форматированию (функц. зоны → производственные/многофункц./…).
    const cats = layerCatStats(layer);
    const multiCat = cats.length > 1;
    const catOpen = multiCat && _catOpen.has(layer.id);
    const sample = sampleByLayer[layer.id];
    const st = sample ? styleOf(sample) : layerStyle(layer);
    // Свотч в списке — ПОЛНЫЙ образец знака (штрих + засечки для линий, заливка +
    // штриховка + рамка для зон), а не просто цветной квадрат: правка юзера
    // «превью должны полностью отображать стиль». styleSampleSVG — из app.js.
    const swSvg = styleSampleSVG(st, { w: 54, h: 20 });
    const row = document.createElement("div");
    const isActive = layer.id === state.activeLayerId;
    row.className = "layer-row" + (isActive ? " active" : "") +
                    (layer.locked ? " locked" : "");
    row.draggable = true;
    row.dataset.lid = layer.id;
    row.dataset.visible = String(layer.visible);
    row.dataset.modified = String(!!((layer.rules && layer.rules.length) || (layer.fmt && Object.keys(layer.fmt).length)));
    row.dataset.geometry = layer.geometry_type || "polygon";
    // Индикаторы кастомизации — чтобы сразу видеть, где нестандартное оформление
    let badges = "";
    if (layer.rules && layer.rules.length) {
      badges += `<span class="lrow-badge" title="условное форматирование: ${layer.rules.length} правил">правила</span>`;
    }
    if (layer.fmt && Object.keys(layer.fmt).length > 0) {
      badges += `<span class="lrow-badge" title="есть переопределения оформления слоя">стиль</span>`;
    }
    const layerTitle = escHtml(layer.title);
    const geometry = layerGeometryMeta(layer);
    const sourceLabel = layer.source_kind ? String(layer.source_kind).toUpperCase()
      : (layer.import_only ? "Данные" : "Проект");
    const discHtml = multiCat
      ? `<button type="button" class="layer-disc${catOpen ? " open" : ""}" aria-expanded="${catOpen}" aria-label="Показать знаки слоя «${layerTitle}» (${cats.length})" title="знаки слоя (${cats.length}) — раскрыть/свернуть">▸</button>`
      : `<span class="layer-disc-sp" aria-hidden="true"></span>`;
    row.innerHTML = `${discHtml}<span class="grip" aria-hidden="true" title="перетащить — порядок отрисовки"><svg class="ic"><use href="#ic-grip"/></svg></span>
      <label class="layer-vis-toggle" title="видимость слоя «${layerTitle}»"><input type="checkbox" aria-label="Показывать слой «${layerTitle}»" ${layer.visible ? "checked" : ""}><svg class="ic" aria-hidden="true"><use href="#ic-eye"/></svg></label>
      <button type="button" class="layer-select" aria-pressed="${isActive}"
        aria-label="Выбрать слой «${layerTitle}» для рисования"
        title="${layerTitle} — сделать активным слоем для рисования">
        <span class="sw-svg" aria-hidden="true">${swSvg}</span>
        <span class="layer-copy"><span class="layer-title-line"><span class="nm">${layerTitle}</span><span class="cnt">${count || ""}</span></span>
          <span class="layer-meta"><span class="layer-geometry"><svg class="ic"><use href="#${geometry.icon}"/></svg>${geometry.label}</span><span>${escHtml(sourceLabel)}</span>${badges}</span></span>
      </button>
      <button class="lrow-lock" aria-label="${layer.locked ? "Разблокировать" : "Заблокировать"} слой «${layerTitle}»" title="${layer.locked ? "разблокировать" : "заблокировать"} слой «${layerTitle}»">
        <svg class="ic"><use href="#${layer.locked ? "ic-lock" : "ic-unlock"}"/></svg></button>
      <button class="lrow-style" aria-label="Оформление слоя «${layerTitle}»" title="знак и оформление слоя «${layerTitle}»"><svg class="ic"><use href="#ic-format"/></svg></button>
      <button class="lrow-menu" aria-label="Действия со слоем «${layerTitle}»" title="действия со слоем «${layerTitle}»"><svg class="ic"><use href="#ic-menu-dots"/></svg></button>`;
    row.addEventListener("mouseenter", () => { state.hoverLayerId = layer.id; draw(); });
    row.addEventListener("mouseleave", () => { state.hoverLayerId = null; draw(); });
    row.querySelector(".lrow-lock").addEventListener("click", ev => {
      ev.stopPropagation(); toggleLayerLock(layer);
    });
    row.querySelector(".layer-vis-toggle input").addEventListener("change", ev => {
      snapshot();
      layer.visible = ev.target.checked;
      const sel = selectedFeature();
      if (!layer.visible && sel && layerOf(sel) === layer) {
        state.selected = null;
        renderProps();
      }
      state._ix = null; state._snapIndex = null;
      persist();
      draw();
      renderLayers();
    });
    // Отдельная кнопка делает выбор слоя доступным и мышью, и клавиатурой.
    // Чекбокс по-прежнему отвечает только за видимость.
    const selectButton = row.querySelector(".layer-select");
    const activateLayer = () => {
      setActiveLayer(layer.id);
      // setActiveLayer перерисовывает список. Возвращаем фокус на новую
      // кнопку той же строки, иначе после Enter/клика он проваливается в body.
      const freshRow = [...el.querySelectorAll(".layer-row")]
        .find(item => item.dataset.lid === layer.id);
      const freshButton = freshRow?.querySelector(".layer-select");
      if (freshButton && freshButton !== selectButton)
        freshButton.focus({ preventScroll: true });
    };
    selectButton.addEventListener("click", activateLayer);
    selectButton.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // Явная активация нужна и для браузеров/веб-вью, которые не порождают
      // click после синтетического клавиатурного события.
      event.preventDefault();
      activateLayer();
    });
    const menuBtn = row.querySelector(".lrow-menu");
    row.querySelector(".lrow-style").addEventListener("click", ev => {
      ev.stopPropagation();
      openLayerStyle(layer);
    });
    menuBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      openLayerMenu(layer, r.right, r.bottom);
    });
    row.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      openLayerMenu(layer, ev.clientX, ev.clientY);
    });
    // перетаскивание для смены порядка отрисовки
    row.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("text/plain", layer.id);
      ev.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      el.querySelectorAll(".layer-row").forEach(r =>
        r.classList.remove("drop-before", "drop-after"));
    });
    row.addEventListener("dragover", ev => {
      ev.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      row.classList.toggle("drop-before", before);
      row.classList.toggle("drop-after", !before);
    });
    row.addEventListener("dragleave", () =>
      row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", ev => {
      ev.preventDefault();
      const src = ev.dataTransfer.getData("text/plain");
      const rect = row.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      reorderLayer(src, layer.id, before);
    });
    const discBtn = row.querySelector(".layer-disc");
    if (discBtn) discBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      if (_catOpen.has(layer.id)) _catOpen.delete(layer.id); else _catOpen.add(layer.id);
      saveCatOpen();
      renderLayers();
    });
    groupHost.appendChild(row);
    // подпункты-категории (QGIS-легенда): образец знака + название + счётчик +
    // галка видимости (тот же fmt.cats_off). Скрытая категория — приглушена.
    if (catOpen) for (const cat of cats) {
      const visible = !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id);
      const cst = styleOf(cat.sample);
      const crow = document.createElement("div");
      crow.className = "layer-cat-row" + (visible ? "" : " cat-off");
      const catTitle = escHtml(cat.title);
      crow.innerHTML = `<input type="checkbox" ${visible ? "checked" : ""} aria-label="Показывать знак «${catTitle}» в слое «${layerTitle}»" title="видимость знака «${catTitle}»">
        <span class="sw-svg" aria-hidden="true">${styleSampleSVG(cst, { w: 34, h: 14 })}</span>
        <span class="nm" title="${catTitle}">${catTitle}</span><span class="cnt">${cat.count}</span>`;
      crow.querySelector("input").addEventListener("change", ev =>
        toggleCategoryVisible(layer, cat.id, ev.target.checked));
      groupHost.appendChild(crow);
    }
  }
  groupHosts.forEach(body => {
    const section = body.closest(".layer-stack-group");
    section.querySelector(".layer-group-count").textContent = body.querySelectorAll(":scope > .layer-row").length;
  });
  renderLayerLegend(sampleByLayer);
  updateLayerStatus();   // чип «куда я черчу» — синхрон с активным слоем
  updateStartExperience();
}

function initCollapsiblePanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;
  const sections = panel.querySelectorAll("section");
  // Восстанавливаем состояние из localStorage (простой ключ)
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem("grado_panel_collapsed") || "{}"); } catch(e){}

  // Разумные дефолты при первом запуске: фокус на черчении и ТЭП
  const defaultsCollapsed = ["Источники", "Параметры расчёта"];
  sections.forEach(sec => {
    const h = sec.querySelector("h3");
    if (!h) return;
    const key = h.textContent.trim();
    if (collapsed[key] === undefined && defaultsCollapsed.includes(key)) {
      collapsed[key] = true;
    }
    if (collapsed[key]) sec.classList.add("collapsed");

    h.addEventListener("click", (e) => {
      // не сворачивать если клик по кнопке внутри h3 (типа + или библиотека)
      if (e.target.closest("button")) return;
      sec.classList.toggle("collapsed");
      collapsed[key] = sec.classList.contains("collapsed");
      try { localStorage.setItem("grado_panel_collapsed", JSON.stringify(collapsed)); } catch(e){}
    });
  });
}

// ---------- справка «Горячие клавиши» (клавиша ?) -------------------------
// сгруппированный список — единственное полное место (строка-подсказка внизу
// физически вмещает лишь часть). Модификатор показываем по текущей ОС.
const modKeyLabel = key => `${/Mac|iPhone|iPad|iPod/.test(navigator.platform || "") ? "⌘" : "Ctrl+"}${key}`;
const SHORTCUTS = [
  ["Инструменты", [
    ["V", "Выбор и правка объектов"], ["A", "Дуга"],
    ["D", "Размерная линия"], ["M", "Измерение расстояния"],
    ["T", "Обрезать по границе"], ["E", "Продлить до границы"], ["J", "Склеить линии"],
  ]],
  ["Быстрый слой (создать/выбрать + чертить)", [
    ["G", "Граница территории"], ["Z", "Функциональная зона"], ["O", "Ограничение (ЗОУИТ)"],
    ["B", "Здание"], ["P", "Общественная зона"], ["L", "Красная линия"], ["S", "Соцобъект"],
  ]],
  ["Черчение", [
    ["A", "Дуга (3 точки)"],
    ["Shift", "Прямой угол (орто)"],
    ["50 ↵", "Длина отрезка вдоль курсора"],
    ["100 200 ↵", "Абсолютные координаты X Y"],
    ["50<30 ↵", "Полярно: длина < угол°"],
    ["Enter", "Завершить фигуру"], ["Esc", "Отменить действие"],
  ]],
  ["Правка объекта", [
    ["R", "Повернуть на 90°"], [modKeyLabel("D"), "Дубликат"], ["стрелки", "Сдвиг (с Shift — на 1 м)"],
    ["Delete", "Удалить"], ["двойной клик по ребру", "Добавить вершину"],
    ["Alt + клик по вершине", "Удалить вершину"],
  ]],
  ["Вид и привязки", [
    ["F", "Вписать всё в экран"], ["колесо мыши", "Масштаб"],
    ["пробел + тянуть", "Сдвинуть холст"], ["X", "Привязка к объектам"], ["C", "Привязка к сетке"],
  ]],
  ["История", [
    [modKeyLabel("Z"), "Отменить"], [modKeyLabel("Shift+Z"), "Вернуть"], ["?", "Эта справка"],
  ]],
  ["Проект", [
    [modKeyLabel("N"), "Новый проект"], [modKeyLabel("O"), "Открыть .grado"], [modKeyLabel("S"), "Сохранить .grado"],
  ]],
];
function openShortcuts() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const groups = SHORTCUTS.map(([title, rows]) => `
    <div class="sc-group"><div class="sc-group-title">${escHtml(title)}</div>
    ${rows.map(([k, d]) => `<div class="sc-row"><kbd>${escHtml(k)}</kbd><span>${escHtml(d)}</span></div>`).join("")}
    </div>`).join("");
  overlay.innerHTML = `<div class="modal fmt-modal-lg sc-modal">
    <div class="modal-head">Горячие клавиши
      <button class="modal-x" aria-label="Закрыть горячие клавиши"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body sc-body">${groups}</div>
    <div class="modal-actions"><span class="spacer"></span>
      <button class="primary" id="sc-close">Понятно</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.querySelector("#sc-close").addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
}

// ---------- контекстное меню слоя (логика QGIS) ----------
function closePopups() {
  document.querySelectorAll(".ctx-menu, .modal-overlay").forEach(n => n.remove());
}
function openLayerMenu(layer, x, y) {
  closePopups();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  const displayed = layerRowsTopFirst();
  const displayIndex = displayed.indexOf(layer);
  const items = [
    ["Сделать активным", () => setActiveLayer(layer.id)],
    ["Таблица атрибутов…", () => openAttributeTable(layer)],
    ["Оформление слоя…", () => openLayerStyle(layer)],
    ["Приблизить к слою", () => zoomToLayer(layer.id)],
    ...(displayIndex > 0 ? [["Переместить выше", () =>
      reorderLayer(layer.id, displayed[displayIndex - 1].id, true)]] : []),
    ...(displayIndex >= 0 && displayIndex < displayed.length - 1
      ? [["Переместить ниже", () =>
        reorderLayer(layer.id, displayed[displayIndex + 1].id, false)]] : []),
    ["Переименовать…", () => renameLayer(layer)],
    [layer.locked ? "Разблокировать слой" : "Заблокировать слой", () => toggleLayerLock(layer)],
    ["Сбросить оформление слоя", () => resetLayerFormatting(layer)],
    ["Применить стиль слоя ко всем объектам", () => applyLayerStyleToObjects(layer)],
  ];
  for (const [label, fn] of items) {
    const it = document.createElement("div");
    it.className = "ctx-item";
    it.textContent = label;
    it.addEventListener("click", ev => { ev.stopPropagation(); closePopups(); fn(); });
    menu.appendChild(it);
  }
  const del = document.createElement("div");
  del.className = "ctx-item danger";
  del.textContent = "Удалить слой…";
  del.addEventListener("click", ev => { ev.stopPropagation(); closePopups(); deleteLayer(layer); });
  menu.appendChild(del);
  document.body.appendChild(menu);
  // не вылезать за правый/нижний край
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 6) + "px";
  menu.style.top = Math.min(y, window.innerHeight - mh - 6) + "px";
  setTimeout(() => document.addEventListener("click", closePopups, { once: true }), 0);
}

function resetLayerFormatting(layer) {
  closePopups();
  snapshot();
  delete layer.fmt;
  delete layer.rules;
  // также сбрасываем per-object fmt на объектах этого слоя (style_id оставляем — это может быть классификация)
  const objs = featuresOnLayer(layer.id);
  for (const f of objs) {
    delete f.fmt;
  }
  renderLayers(); draw(); persist();
  toast(`Оформление слоя «${layer.title}» сброшено`);
}

function applyLayerStyleToObjects(layer) {
  // Гибкость: быстро привести все объекты слоя к текущему стилю слоя (очищает per-object переопределения)
  closePopups();
  const objs = featuresOnLayer(layer.id);
  if (!objs.length) { toast("В слое нет объектов"); return; }
  snapshot();
  for (const f of objs) {
    delete f.style_id;
    delete f.fmt;
  }
  renderLayers(); draw(); persist();
  toast(`Стиль слоя применён к ${objs.length} объектам`);
}

// ---------- новый слой («+» в панели «Слои») ----------
const GEOM_LABEL = { point: "точка", polyline: "полилиния", polygon: "полигон", arc: "дуга", circle: "окружность" };
function allRoleOptions(selected = "") {
  return BASE_KINDS.map(b => `<option value="${escHtml(b.kind)}"${b.kind === selected ? " selected" : ""}>${escHtml(b.label)}</option>`).join("") +
    `<option value=""${!selected ? " selected" : ""}>Обычный слой — без расчётной роли</option>`;
}
function startBoundaryFlow() {
  const existing = LAYERS_V2.find(layer => layer.kind === "boundary" && !layer.import_only && !layer.annotation);
  if (existing) {
    if (existing.locked) {
      startGuideDismissed = false;
      updateStartExperience();
      toast("Слой границы заблокирован — сначала разблокируйте его", "warn");
      return;
    }
    startGuideDismissed = true;
    setActiveLayer(existing.id);
    setTool(naturalToolFor(existing), { keepLayer: true });
    toast("Слой границы активен. Поставьте первую точку на холсте.");
    return;
  }
  startGuideDismissed = true;
  quickLayerByKind("boundary");
  toast("Слой границы готов. Поставьте первую точку на холсте.");
}
let startGuideDismissed = false;
function updateStartExperience() {
  const guide = document.getElementById("start-guide");
  const projectLayers = LAYERS_V2.filter(layer => layer.user_created && !layer.import_only && !layer.annotation);
  const drawableLayers = projectLayers.filter(isDrawableLayer);
  const hasLayer = projectLayers.length > 0;
  const hasFeatures = state.features.length > 0;
  const emptyLayer = hasLayer && !hasFeatures;
  if (guide) {
    guide.hidden = hasFeatures || (emptyLayer && startGuideDismissed);
    const current = activeLayer();
    const layer = isDrawableLayer(current) ? current : drawableLayers[0];
    const lockedLayer = !layer ? projectLayers.find(item => item.locked) : null;
    const kicker = document.getElementById("start-guide-kicker");
    const title = document.getElementById("start-guide-title");
    const copy = document.getElementById("start-guide-copy");
    const steps = document.getElementById("start-guide-steps");
    const boundaryButton = document.getElementById("start-boundary");
    const drawButton = document.getElementById("start-draw");
    const unlockButton = document.getElementById("start-unlock");
    const hint = document.getElementById("start-guide-hint");
    if (emptyLayer && layer) {
      if (kicker) kicker.textContent = "Проект готов к работе";
      if (title) title.textContent = "Начертите первый объект";
      if (copy) copy.textContent = `Активен слой «${layer.title}». Выберите инструмент и укажите точки на холсте — расчёты обновятся автоматически.`;
      if (steps) steps.hidden = true;
      if (boundaryButton) boundaryButton.hidden = true;
      if (drawButton) drawButton.hidden = false;
      if (unlockButton) unlockButton.hidden = true;
      if (hint) hint.textContent = `Тип геометрии слоя: ${GEOM_LABEL[layer.geometry_type] || layer.geometry_type}. Escape отменяет действие.`;
    } else if (emptyLayer && lockedLayer) {
      if (kicker) kicker.textContent = "Слой защищён";
      if (title) title.textContent = "Разблокируйте слой для рисования";
      if (copy) copy.textContent = `Слой «${lockedLayer.title}» защищён от изменений. Разблокируйте его или создайте другой слой.`;
      if (steps) steps.hidden = true;
      if (boundaryButton) boundaryButton.hidden = true;
      if (drawButton) drawButton.hidden = true;
      if (unlockButton) unlockButton.hidden = false;
      if (hint) hint.textContent = "После разблокировки Студия включит подходящий инструмент автоматически.";
    } else {
      if (kicker) kicker.textContent = "Новый проект";
      if (title) title.textContent = "Начните с границы территории";
      if (copy) copy.textContent = "Она задаёт расчётную площадь. После этого ТЭП будет обновляться автоматически по мере работы.";
      if (steps) steps.hidden = false;
      if (boundaryButton) boundaryButton.hidden = false;
      if (drawButton) drawButton.hidden = true;
      if (unlockButton) unlockButton.hidden = true;
      if (hint) hint.textContent = "Подсказка: клавиша G создаёт или выбирает слой границы.";
    }
  }
  const active = activeLayer();
  const canDraw = isDrawableLayer(active);
  const drawBlockReason = !active ? "Сначала создайте слой"
    : active.locked ? "Активный слой заблокирован"
      : (active.import_only || active.annotation) ? "Выберите проектный слой" : "Сначала создайте слой";
  const drawingTools = new Set(["point", "polyline", "polygon", "rect", "arc", "circle"]);
  const editingTools = new Set(["trim", "extend", "fillet", "rotate", "scale", "mirror"]);
  document.querySelectorAll("#toolbar button[data-tool]").forEach(button => {
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
    if (drawingTools.has(button.dataset.tool)) {
      button.disabled = !canDraw;
      button.title = !canDraw ? drawBlockReason : button.dataset.defaultTitle;
    } else if (editingTools.has(button.dataset.tool)) {
      button.disabled = !state.features.length;
      button.title = !state.features.length ? "Сначала добавьте объект" : button.dataset.defaultTitle;
    }
  });
  ["btn-join", "btn-buffer-open"].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
    const webUnavailable = button.dataset.webUnavailable === "true";
    button.disabled = webUnavailable || !state.features.length;
    button.title = webUnavailable
      ? "Доступно в настольной версии"
      : (!state.features.length ? "Сначала добавьте объект" : button.dataset.defaultTitle);
  });
}
function openNewLayerDialog(options = {}) {
  closePopups();
  const suggestedRole = options.role !== undefined
    ? options.role
    : (LAYERS_V2.some(layer => layer.kind === "boundary") ? "" : "boundary");
  const suggestedBase = BASE_KIND_BY_KIND[suggestedRole] || null;
  const suggestedGeom = suggestedBase?.geometry_type || "polygon";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal new-layer-modal">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Структура проекта</span><span>Новый слой</span></div>
      <button class="modal-x" aria-label="Закрыть создание слоя"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact new-layer-body">
      <p class="new-layer-intro">Выберите назначение — Студия подставит правильную геометрию и знак. После создания можно сразу чертить.</p>
      <div class="new-layer-purpose">
        <label><span>Назначение слоя</span><select id="nl-role">${allRoleOptions(suggestedRole)}</select></label>
        <label><span>Геометрия</span><select id="nl-geom">${
          Object.entries(GEOM_LABEL).map(([g, l]) => `<option value="${g}"${g === suggestedGeom ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="new-layer-role-hint" id="nl-role-hint"></div>
      </div>
      <div class="new-layer-details">
        <label class="wide"><span>Название</span><input type="text" id="nl-title" placeholder="${escHtml(suggestedBase?.label || "Например, озеленение")}" autofocus></label>
        <label class="wide"><span>Оформление</span><select id="nl-style">${stylePickerOptions(suggestedBase?.style_id)}</select></label>
      </div>
    </div>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button id="nl-cancel">Отмена</button>
      <button id="nl-create" class="primary">Создать и чертить</button>
    </div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const $ = id => overlay.querySelector("#" + id);
  $("nl-title").focus();
  let styleTouched = false;
  $("nl-style").addEventListener("change", () => { styleTouched = true; });
  const syncRole = () => {
    const base = BASE_KIND_BY_KIND[$("nl-role").value] || null;
    $("nl-geom").disabled = !!base;
    if (base) $("nl-geom").value = base.geometry_type;
    $("nl-role-hint").textContent = base
      ? `Участвует в расчётах и получает знак «${base.label}». Геометрия выбрана автоматически.`
      : "Обычный слой хранит геометрию и атрибуты, но не влияет на ТЭП.";
    $("nl-title").placeholder = base?.label || "Например, озеленение";
    if (base && !styleTouched) $("nl-style").innerHTML = stylePickerOptions(base.style_id);
  };
  $("nl-role").addEventListener("change", syncRole);
  syncRole();
  const create = async () => {
    const geom = $("nl-geom").value, role = $("nl-role").value;
    let styleRef = $("nl-style").value || null;
    if (styleRef === "__create_project_style__") {
      styleRef = await createProjectStyle();
    }
    const title = $("nl-title").value.trim() ||
      (role ? BASE_KIND_BY_KIND[role].label : GEOM_LABEL[geom] + " — слой");
    snapshot();
    const L = role
      ? createUserLayer({ kind: role, title, styleId: styleRef })
      : createGenericLayer({ title, geometry_type: geom, styleId: styleRef });
    closePopups();
    renderLayers();
    setActiveLayer(L.id);
    setTool(naturalToolFor(L), { keepLayer: true });
    persist();
    toast(`Слой «${title}» создан. Поставьте первую точку на холсте.`);
  };
  $("nl-title").addEventListener("keydown", ev => { if (ev.key === "Enter") create(); });
  $("nl-create").addEventListener("click", () => create());
  $("nl-cancel").addEventListener("click", closePopups);
  overlay.querySelector(".modal-x").addEventListener("click", closePopups);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) closePopups(); });
}

// kind (внутренний id) из названия: латиница/цифры, иначе type_N. Уникален
// в BASE_KIND_BY_KIND (свои + встроенные)
function kindIdFromLabel(label) {
  let s = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "type";
  let id = s, n = 2;
  while (BASE_KIND_BY_KIND[id]) id = `${s}_${n++}`;
  return id;
}
function isCustomKind(k) {
  return !!(state.projectCustomKinds || []).find(x => x.kind === k.kind);
}
// применить кастомные виды из projectCustomKinds к живым индексам (после
// правки/удаления) — BASE_KINDS/BY_KIND/BY_SEMANTIC пересобираются из
// встроенных (первые 7) + текущего списка своих
const _BUILTIN_KINDS = BASE_KINDS.slice();
function rebuildKinds() {
  const custom = state.projectCustomKinds || [];
  BASE_KINDS.length = 0;
  BASE_KINDS.push(..._BUILTIN_KINDS, ...custom);
  for (const k of Object.keys(BASE_KIND_BY_KIND)) delete BASE_KIND_BY_KIND[k];
  for (const b of BASE_KINDS) BASE_KIND_BY_KIND[b.kind] = b;
  for (const k of Object.keys(KIND_BY_SEMANTIC_CLASS)) delete KIND_BY_SEMANTIC_CLASS[k];
  for (const b of BASE_KINDS) KIND_BY_SEMANTIC_CLASS[b.semantic_class] = b.kind;
}

function resetProjectState(name = "Новый проект") {
  clearTimeout(autosaveTimer);
  clearTimeout(tepTimer);
  resetLayerModel();
  state.features = [];
  state.nextId = 1;
  state.undo = [];
  state.redo = [];
  state.sources = [];
  state.variants = [];
  state.projectStyles = {};
  state.projectCustomKinds = [];
  state.accessRadii = { on: false, r: 300 };
  state.albumConfig = JSON.parse(JSON.stringify(DEFAULT_ALBUM_CONFIG));
  state.activeLayerId = null;
  state.drawing = null;
  state.drag = null;
  state.pan = null;
  state.edit = null;
  state.measure = null;
  state.trimCtx = null;
  state.xf = null;
  state.view = { k: 1.1, tx: 120, ty: 0 };
  state._fitted = false;
  state._ix = null;
  state._snapIndex = null;
  startGuideDismissed = false;
  rebuildKinds();
  clearSelection();
  document.getElementById("project-name").value = name;
  document.getElementById("p-density").value = 25;
  document.getElementById("p-ratio").value = 80;
  document.getElementById("p-education-zone").value = 1;
  document.getElementById("p-territory-mode").value = 1;
  document.getElementById("p-krail").value = 1;
  document.getElementById("p-kba").value = 0.5;
  const exportSelect = document.getElementById("export-style");
  if (exportSelect) exportSelect.value = "standard";
  const accessShow = document.getElementById("access-show");
  const accessRadius = document.getElementById("access-r");
  const accessWrap = document.getElementById("access-r-wrap");
  if (accessShow) accessShow.checked = false;
  if (accessRadius) accessRadius.value = 300;
  if (accessWrap) accessWrap.style.display = "none";
  syncHistoryControls();
}
// Веб-хаб использует тот же полный сброс при переключении проектов. Без него
// пустой проект наследовал объекты и пользовательские слои предыдущего.
window.resetProjectForExternalState = resetProjectState;

function openManageKinds() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  let editing = null;   // kind, который правим (null — режим добавления)
  const $ = id => overlay.querySelector("#" + id);
  const swatchOf = sid => {
    const st = (state.projectStyles && state.projectStyles[sid]) || STYLES_V2[sid] || {};
    if (st.fill) return st.fill;
    if (st.hatch && st.hatch.color) return `repeating-linear-gradient(45deg, ${st.hatch.color} 0 1px, transparent 1px 4px)`;
    return "transparent";
  };
  function rowHtml(k) {
    const custom = isCustomKind(k);
    const cov = k.topology === "coverage" ? ` · покрытие` : "";
    return `<div class="mk-item" data-kind="${escHtml(k.kind)}">
      <span class="mk-sw" style="background:${swatchOf(k.style_id)}"></span>
      <span class="mk-nm">${escHtml(k.label || k.kind)}</span>
      <span class="mk-meta">${GEOM_LABEL[k.geometry_type] || k.geometry_type}${cov}</span>
      ${custom ? `<button class="mk-edit" data-kind="${escHtml(k.kind)}" title="Изменить"><svg class="ic"><use href="#ic-format"/></svg></button>
        <button class="mk-del" data-kind="${escHtml(k.kind)}" title="Удалить"><svg class="ic"><use href="#ic-trash"/></svg></button>`
      : `<span class="mk-builtin" title="встроенный тип — изменить нельзя">встроенный</span>`}
    </div>`;
  }
  function renderList() {
    const builtins = BASE_KINDS.filter(k => !isCustomKind(k));
    const customs = BASE_KINDS.filter(isCustomKind);
    $("mk-list").innerHTML =
      `<div class="mk-group-title">Встроенные</div>${builtins.map(rowHtml).join("")}` +
      (customs.length ? `<div class="mk-group-title">Свои типы</div>${customs.map(rowHtml).join("")}`
        : `<div class="mk-group-title">Свои типы</div><div class="muted" style="padding:4px var(--sp-4)">Пока нет — заполните форму ниже и «Добавить».</div>`);
    overlay.querySelectorAll(".mk-edit").forEach(b => b.onclick = () => startEdit(b.dataset.kind));
    overlay.querySelectorAll(".mk-del").forEach(b => b.onclick = () => delKind(b.dataset.kind));
  }
  function fillForm(spec) {
    $("mk-label").value = spec ? (spec.label || "") : "";
    $("mk-geom").value = spec ? spec.geometry_type : "polygon";
    $("mk-geom").disabled = !!spec;   // геометрию у существующего не меняем
    $("mk-topo").value = spec && spec.topology === "coverage" ? "coverage" : "flat";
    $("mk-style").innerHTML = stylePickerOptions(spec ? spec.style_id : "");
    $("mk-form-title").textContent = spec ? `Изменить: ${spec.label || spec.kind}` : "Новый тип слоя";
    $("mk-save").textContent = spec ? "Сохранить" : "Добавить";
    $("mk-cancel-edit").style.display = spec ? "" : "none";
  }
  function startEdit(kind) {
    editing = kind;
    fillForm(BASE_KIND_BY_KIND[kind]);
    $("mk-label").focus();
  }
  function resetForm() { editing = null; fillForm(null); }
  async function delKind(kind) {
    const inUse = LAYERS_V2.filter(l => l.kind === kind).length;
    const msg = inUse
      ? `Тип «${BASE_KIND_BY_KIND[kind].label}» используют ${inUse} слой(ёв). Удалить тип? Слои останутся, но новые слои этого типа создать будет нельзя.`
      : `Удалить тип «${BASE_KIND_BY_KIND[kind].label}»?`;
    if (!(await uiConfirm(msg, { ok: "Удалить", danger: true }))) return;
    state.projectCustomKinds = (state.projectCustomKinds || []).filter(x => x.kind !== kind);
    rebuildKinds();
    if (editing === kind) resetForm();
    persist(); renderList();
    toast("Тип слоя удалён");
  }
  function saveKind() {
    const label = $("mk-label").value.trim();
    if (!label) { toast("Введите название типа", "warn"); return; }
    const geom = $("mk-geom").value;
    const topo = $("mk-topo").value === "coverage" ? "coverage" : undefined;
    const styleId = $("mk-style").value ||
      (geom === "point" ? "social.point" : geom === "polyline" ? "boundary.line" : "func_zone.fill");
    state.projectCustomKinds = state.projectCustomKinds || [];
    if (editing) {
      const spec = state.projectCustomKinds.find(x => x.kind === editing);
      if (spec) { spec.label = label; spec.style_id = styleId; spec.topology = topo; }
    } else {
      const kind = kindIdFromLabel(label);
      state.projectCustomKinds.push({ kind, semantic_class: `custom.${kind}`,
        geometry_type: geom, style_id: styleId, label, topology: topo });
    }
    rebuildKinds();
    persist(); renderList(); resetForm();
    toast(editing ? "Тип слоя изменён" : "Тип слоя добавлен");
  }
  overlay.innerHTML = `<div class="modal fmt-modal-lg mk-modal">
    <div class="modal-head">Типы слоёв
      <button class="modal-x" aria-label="Закрыть типы слоёв"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="lib-hint">«Роль» нового слоя — считается в ТЭП и подхватывает знак. Встроенные типы менять нельзя, свои — добавляйте/правьте/удаляйте.</div>
      <div id="mk-list" class="mk-list"></div>
      <div class="mk-form">
        <div class="fmt-sub" id="mk-form-title">Новый тип слоя</div>
        <label>Название<input type="text" id="mk-label" placeholder="напр. Озеленение"></label>
        <label>Геометрия<select id="mk-geom">
          <option value="polygon">полигон</option><option value="polyline">линия</option>
          <option value="point">точка</option><option value="arc">дуга</option><option value="circle">круг</option></select></label>
        <label>Общие границы<select id="mk-topo">
          <option value="flat">обычный слой</option>
          <option value="coverage">покрытие (общие границы редактируются вместе)</option></select></label>
        <label>Знак по умолчанию<select id="mk-style"></select></label>
      </div>
    </div>
    <div class="modal-actions">
      <button id="mk-cancel-edit" style="display:none">Отмена правки</button>
      <button id="mk-save" class="primary">Добавить</button>
      <span class="spacer"></span>
      <button id="mk-close">Закрыть</button>
    </div></div>`;
  document.body.appendChild(overlay);
  renderList(); fillForm(null);
  $("mk-save").onclick = saveKind;
  $("mk-cancel-edit").onclick = resetForm;
  $("mk-close").onclick = () => overlay.remove();
  overlay.querySelector(".modal-x").onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

// ---------- варианты концепции: снимки проекта + сравнение ТЭП -------------
// Вариант — именованный снимок state.features + параметров. Хранится в проекте
// (persist). Позволяет пробовать альтернативы посадки/зонирования и сравнивать
// их ТЭП рядом, не теряя рабочее состояние.
let _variantSeq = 0;
function nextVariantId() {
  _variantSeq += 1;
  return `var-${Date.now().toString(36)}-${_variantSeq.toString(36)}`;
}
function cloneVariantValue(value) { return JSON.parse(JSON.stringify(value)); }
function tepResultValue(data, title) {
  const row = data && data.results && data.results.find(item => item.title === title);
  return row ? row.value : null;
}
function summarizeVariantTep(data) {
  if (!data) return null;
  const warnings = (data.checks || []).filter(check => !check.ok).length +
    (data.zones && !data.zones.ok ? 1 : 0);
  return {
    hasTerritory: data.has_territory !== false,
    spp: data.fact ? data.fact.spp : null,
    density: data.fact ? data.fact.density : null,
    population: tepResultValue(data, "Расчётное население"),
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
function saveCurrentAsVariant(name, options = {}) {
  state.variants = state.variants || [];
  const v = { id: nextVariantId(), name,
    features: cloneVariantValue(options.features || state.features),
    params: cloneVariantValue(options.params || params()),
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    source: options.source || "manual" };
  if (options.generator) v.generator = cloneVariantValue(options.generator);
  state.variants.push(v);
  persist();
  return v;
}
function setParamInputs(p) {
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  set("p-density", p.density); set("p-ratio", p.ratio_zh); set("p-education-zone", p.education_zone); set("p-territory-mode", p.territory_mode); set("p-krail", p.k_rail); set("p-kba", p.k_ba);
}
async function tepForVariant(features, prms) {
  try {
    const r = await fetch("/api/tep", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features, params: prms }) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
function openVariants() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const $ = id => overlay.querySelector("#" + id);
  const sel = new Set();   // id вариантов, отмеченных для сравнения
  let currentSummary = summarizeVariantTep(window.lastTepData);
  let calculating = false;
  let generating = false;
  function uniqueVariantName(base) {
    const names = new Set((state.variants || []).map(v => v.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }
  function metric(value, unit) {
    const shown = value == null || value === "" ? "—" : escHtml(String(value));
    return `<span class="var-metric"><b>${shown}</b><small>${escHtml(unit)}</small></span>`;
  }
  function summaryHtml(summary) {
    if (!summary) return `<div class="var-summary loading">Рассчитываю паспорт ТЭП…</div>`;
    if (!summary.hasTerritory) return `<div class="var-summary missing">Для расчёта нужна граница территории</div>`;
    const status = summary.warnings
      ? `<span class="var-health warning">Проверок: ${summary.warnings}</span>`
      : `<span class="var-health ok">Без предупреждений</span>`;
    return `<div class="var-summary">${metric(summary.spp, "тыс. м² СПП")}${metric(summary.density, "тыс. м²/га")}${
      metric(summary.population, "чел.")}${status}</div>`;
  }
  function currentHtml() {
    const p = params();
    return `<div class="var-current-copy"><span class="var-eyebrow">Рабочее состояние</span><b>Текущий сценарий</b>
      <small>Целевая плотность ${escHtml(String(p.density))} тыс. м²/га · жильё ${escHtml(String(p.ratio_zh))}%</small></div>
      ${summaryHtml(currentSummary)}`;
  }
  function rowsHtml() {
    const vs = state.variants || [];
    if (!vs.length) return `<div class="var-empty"><b>Сохранённых вариантов пока нет</b><span>Зафиксируйте текущую посадку или создайте три сценария плотности для первого сравнения.</span></div>`;
    return vs.map(v => `<article class="var-item${v.baseline ? " baseline" : ""}" data-id="${escHtml(v.id)}">
      <label class="var-select" title="Добавить в сравнение"><input type="checkbox" class="var-cmp" data-id="${escHtml(v.id)}" aria-label="Добавить вариант ${escHtml(v.name)} в сравнение" ${sel.has(v.id) ? "checked" : ""}><span></span></label>
      <div class="var-card-main"><div class="var-title-row"><span class="var-nm">${escHtml(v.name)}</span>${v.baseline ? '<span class="var-baseline-badge">Базовый</span>' : ""}</div>
        <span class="var-meta">${v.source === "generator" ? `Сценарий плотности · цель ${escHtml(String(v.params?.density ?? "—"))} тыс. м²/га` : "Снимок проекта"} · ${v.features.length} объектов · ${escHtml(v.createdAt || "")}</span>
        ${summaryHtml(v.tepSummary)}</div>
      <div class="var-card-actions">
        <button class="var-base" data-id="${escHtml(v.id)}" aria-label="${v.baseline ? "Базовый вариант" : "Сделать базовым"}: ${escHtml(v.name)}">${v.baseline ? "Базовый вариант" : "Сделать базовым"}</button>
        <button class="var-load" data-id="${escHtml(v.id)}" aria-label="Загрузить вариант ${escHtml(v.name)}">Загрузить</button>
        <button class="var-del" data-id="${escHtml(v.id)}" aria-label="Удалить вариант ${escHtml(v.name)}" title="Удалить вариант"><svg class="ic"><use href="#ic-trash"/></svg></button>
      </div>
    </article>`).join("");
  }
  function render() {
    $("var-current").innerHTML = currentHtml();
    $("var-list").innerHTML = rowsHtml();
    const generateButton = $("var-generate");
    if (generateButton) {
      generateButton.disabled = generating;
      generateButton.textContent = generating ? "Создаю сценарии…" : "Создать 3 сценария";
    }
    overlay.querySelectorAll(".var-cmp").forEach(el => el.onchange = () => {
      if (el.checked) sel.add(el.dataset.id); else sel.delete(el.dataset.id);
      updateCompareButton();
    });
    overlay.querySelectorAll(".var-base").forEach(el => el.onclick = () => setBaseline(el.dataset.id));
    overlay.querySelectorAll(".var-load").forEach(el => el.onclick = () => loadVariant(el.dataset.id));
    overlay.querySelectorAll(".var-del").forEach(el => el.onclick = () => delVariant(el.dataset.id));
    updateCompareButton();
  }
  function updateCompareButton() {
    const button = $("var-compare");
    if (button) {
      button.disabled = sel.size === 0 || calculating || generating;
      button.textContent = calculating ? "Считаю…" : sel.size ? `Сравнить · ${sel.size + 1}` : "Выберите варианты";
    }
  }
  function setBaseline(id) {
    const variants = state.variants || [];
    variants.forEach(v => { v.baseline = v.id === id; });
    persist(); render();
    toast("Базовый вариант обновлён");
  }
  async function loadVariant(id) {
    const v = (state.variants || []).find(x => x.id === id);
    if (!v) return;
    if (!(await uiConfirm(`Загрузить вариант «${v.name}»? Текущее состояние заменится. Сохраните его как вариант заранее, если нужно.`,
                          { ok: "Загрузить" }))) return;
    snapshot();
    state.features = JSON.parse(JSON.stringify(v.features)).map(feature => upgradeFeature(feature));
    setParamInputs(v.params);
    clearSelection(); afterChange(); fitView();
    overlay.remove();
    toast(`Загружен вариант «${v.name}»`);
  }
  async function delVariant(id) {
    const v = (state.variants || []).find(x => x.id === id);
    if (!v) return;
    if (!(await uiConfirm(`Удалить вариант «${v.name}»?`, { ok: "Удалить", danger: true }))) return;
    state.variants = state.variants.filter(x => x.id !== id);
    sel.delete(id); persist(); render();
    toast("Вариант удалён");
  }
  async function ensureSummary(v) {
    if (v.tepSummary) return v.tepSummary;
    const data = await tepForVariant(v.features, v.params);
    v.tepSummary = summarizeVariantTep(data);
    return v.tepSummary;
  }
  async function hydrateSummaries() {
    const tasks = [tepForVariant(state.features, params()).then(data => {
      currentSummary = summarizeVariantTep(data);
    })];
    for (const v of state.variants || []) if (!v.tepSummary) tasks.push(ensureSummary(v));
    await Promise.all(tasks);
    if (!overlay.isConnected) return;
    persist(); render();
  }
  async function compareSelected() {
    const chosen = (state.variants || []).filter(v => sel.has(v.id));
    if (!chosen.length) { toast("Отметьте вариант для сравнения", "warn"); return; }
    calculating = true; updateCompareButton();
    $("var-cmp-out").innerHTML = `<div class="var-calculating">Собираю подробное сравнение ТЭП…</div>`;
    const cols = [{ name: "Текущее", features: tepFeatures(), params: params(), current: true },
                  ...chosen.map(v => ({ name: v.name, features: v.features, params: v.params, baseline: v.baseline }))];
    const teps = await Promise.all(cols.map(c => tepForVariant(c.features, c.params)));
    const rowKeys = [];
    const add = (title, unit, vals, kind = "") => rowKeys.push({ title, unit, vals, kind });
    add("Целевая плотность", "тыс. м²/га", cols.map(c => c.params.density), "input");
    add("Доля жилья", "%", cols.map(c => c.params.ratio_zh), "input");
    add("СПП факт", "тыс. м²", teps.map(t => t && t.fact ? t.fact.spp : "—"));
    add("Плотность факт", "тыс. м²/га", teps.map(t => t && t.fact ? t.fact.density : "—"));
    add("Нормативные предупреждения", "", teps.map(t => t ? (t.checks || []).filter(c => !c.ok).length + (t.zones && !t.zones.ok ? 1 : 0) : "—"), "health");
    const resultTitles = [];
    for (const t of teps) if (t && t.results) for (const row of t.results)
      if (!resultTitles.find(item => item.title === row.title)) resultTitles.push({ title: row.title, unit: row.unit });
    for (const result of resultTitles) add(result.title, result.unit, teps.map(t => {
      const row = t && t.results && t.results.find(item => item.title === result.title);
      return row ? row.value : "—";
    }));
    const head = `<tr><th>Показатель</th>${cols.map(c => `<th class="${c.baseline ? "baseline" : ""}">${escHtml(c.name)}${c.baseline ? " · базовый" : ""}</th>`).join("")}</tr>`;
    const body = rowKeys.map(row => `<tr class="${row.kind}"><td>${escHtml(row.title)} <small>${escHtml(row.unit || "")}</small></td>${
      row.vals.map(value => `<td class="var-v">${escHtml(String(value))}</td>`).join("")}</tr>`).join("");
    $("var-cmp-out").innerHTML = `<section class="var-compare-section"><div class="var-compare-head"><span><b>Сравнение сценариев</b><small>Текущее состояние всегда остаётся первой колонкой</small></span></div>
      <div class="var-cmp-wrap"><table class="attr-table var-cmp-table"><thead>${head}</thead><tbody>${body}</tbody></table></div></section>`;
    calculating = false; updateCompareButton();
  }
  async function generateDensityScenarios() {
    if (generating) return;
    if (!currentSummary) currentSummary = summarizeVariantTep(
      await tepForVariant(state.features, params()));
    if (currentSummary && !currentSummary.hasTerritory) {
      toast("Сначала задайте границу территории", "warn"); return;
    }
    generating = true; render();
    const base = params();
    const density = Number(base.density) || 25;
    const profiles = [
      { name: "Плотность −15%", factor: .85 },
      { name: "Базовая плотность", factor: 1 },
      { name: "Плотность +15%", factor: 1.15 },
    ];
    const created = profiles.map(profile => saveCurrentAsVariant(uniqueVariantName(profile.name), {
      params: { ...base, density: Math.round(density * profile.factor * 10) / 10 },
      source: "generator", generator: { kind: "density_range", factor: profile.factor },
    }));
    created.forEach(v => sel.add(v.id));
    render();
    await Promise.all(created.map(ensureSummary));
    if (!overlay.isConnected) return;
    persist(); generating = false; render();
    toast("Созданы три сценария плотности");
    await compareSelected();
  }
  overlay.innerHTML = `<div class="modal var-modal" role="dialog" aria-modal="true" aria-labelledby="variants-title">
    <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Центр сценариев</span><span id="variants-title">Варианты концепции</span></span>
      <button class="modal-x" aria-label="Закрыть варианты концепции"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact var-body">
      <section id="var-current" class="var-current"></section>
      <div class="var-toolbar"><span><b>Сохранённые варианты</b><small>Снимки геометрии и расчётных параметров проекта</small></span>
        <button id="var-generate">Создать 3 сценария</button><button id="var-save" class="primary">Сохранить текущее</button></div>
      <div id="var-list" class="var-list"></div>
      <div id="var-cmp-out"></div>
    </div>
    <div class="modal-actions">
      <span class="modal-action-note">Базовый вариант выбирает проектировщик</span>
      <span class="spacer"></span>
      <button id="var-close">Закрыть</button><button id="var-compare" class="primary" disabled>Выберите варианты</button>
    </div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  render();
  $("var-save").onclick = async () => {
    const name = await uiPrompt("Название варианта:", `Вариант ${(state.variants || []).length + 1}`, { ok: "Сохранить" });
    if (name == null) return;
    const variant = saveCurrentAsVariant(name.trim() || `Вариант ${(state.variants || []).length + 1}`);
    render();
    await ensureSummary(variant);
    if (!overlay.isConnected) return;
    persist(); render();
    toast("Вариант сохранён");
  };
  $("var-generate").onclick = generateDensityScenarios;
  $("var-compare").onclick = compareSelected;
  $("var-close").onclick = () => overlay.remove();
  overlay.querySelector(".modal-x").onclick = () => overlay.remove();
  overlay.addEventListener("click", ev => { if (ev.target === overlay) overlay.remove(); });
  hydrateSummaries();
}

function openAlbumConfig() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const cfg = state.albumConfig || JSON.parse(JSON.stringify(DEFAULT_ALBUM_CONFIG));
  let sheets = [...(cfg.sheets || ['title','location','base','apo','tep'])];
  const allSheets = ['title','location','base','apo','tep','ortho','photo','parking','greenery'];
  const sheetLabels = {
    title: 'Титульный лист', location: 'Ситуационный план', base: 'Существующее положение',
    apo: 'Архитектурно-планировочная организация', tep: 'Технико-экономические показатели',
    ortho: 'Ортофотоплан', photo: 'Фотофиксация', parking: 'Парковки', greenery: 'Озеленение'
  };
  let html = `<div class="modal fmt-modal album-modal">
    <div class="modal-head">Состав альбома
      <button class="modal-x" aria-label="Закрыть состав альбома"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body album-body">
      <div class="album-section-title">Листы и порядок</div>
      <div class="album-hint">Расположите листы в нужной последовательности.</div>
      <div id="album-list"></div>
      <div class="album-add-row"><label>Добавить лист<select id="add-sheet">${allSheets.map(s=>`<option value="${s}">${sheetLabels[s]}</option>`).join('')}</select></label><button id="add-btn">Добавить</button></div>
      <div class="album-section-title">Титульный лист</div>
      <div class="album-title-fields">
        <label>Организация<input id="title-org" value="${escHtml(cfg.title && cfg.title.org || 'ГРАДО')}"></label>
        <label>Город и год<input id="title-year" value="${escHtml(cfg.title && cfg.title.city_year || 'Москва / 2026')}"></label>
      </div>
    </div>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button id="album-cancel">Отмена</button>
      <button id="album-apply" class="primary">Применить</button>
    </div>
  </div>`;
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('#album-list');
  function renderList() {
    listEl.innerHTML = sheets.map((s,i) => `<div class="album-sheet">
      <span class="album-sheet-name">${escHtml(sheetLabels[s] || s)}</span>
      <button data-i="${i}" class="up" title="Переместить выше" aria-label="Переместить «${escHtml(sheetLabels[s] || s)}» выше"${i === 0 ? ' disabled' : ''}><svg class="ic album-up-icon"><use href="#ic-chevron"/></svg></button>
      <button data-i="${i}" class="down" title="Переместить ниже" aria-label="Переместить «${escHtml(sheetLabels[s] || s)}» ниже"${i === sheets.length - 1 ? ' disabled' : ''}><svg class="ic album-down-icon"><use href="#ic-chevron"/></svg></button>
      <button data-i="${i}" class="rem" title="Убрать лист" aria-label="Убрать лист «${escHtml(sheetLabels[s] || s)}»"><svg class="ic"><use href="#ic-trash"/></svg></button>
    </div>`).join('');
    listEl.querySelectorAll('.up').forEach(b => b.onclick = () => { const i=+b.dataset.i; if(i>0){ [sheets[i-1],sheets[i]]=[sheets[i],sheets[i-1]]; renderList(); }});
    listEl.querySelectorAll('.down').forEach(b => b.onclick = () => { const i=+b.dataset.i; if(i<sheets.length-1){ [sheets[i],sheets[i+1]]=[sheets[i+1],sheets[i]]; renderList(); }});
    listEl.querySelectorAll('.rem').forEach(b => b.onclick = () => { sheets.splice(+b.dataset.i,1); renderList(); });
  }
  renderList();
  overlay.querySelector('#add-btn').onclick = () => {
    const s = overlay.querySelector('#add-sheet').value;
    if (!sheets.includes(s)) { sheets.push(s); renderList(); }
  };
  overlay.querySelector('#album-apply').onclick = () => {
    state.albumConfig = {
      sheets: sheets,
      title: {org: overlay.querySelector('#title-org').value, city_year: overlay.querySelector('#title-year').value}
    };
    persist();
    overlay.remove();
    toast('Конфигурация альбома сохранена');
  };
  overlay.querySelector('#album-cancel').onclick = () => overlay.remove();
  overlay.querySelector('.modal-x').onclick = () => overlay.remove();
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
}

function openTepPresetEditor() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const d = document.getElementById("p-density").value;
  const r = document.getElementById("p-ratio").value;
  const ez = document.getElementById("p-education-zone").value;
  const tm = document.getElementById("p-territory-mode").value;
  const kr = document.getElementById("p-krail").value;
  const kb = document.getElementById("p-kba").value;
  overlay.innerHTML = `<div class="modal fmt-modal tep-editor-modal" role="dialog" aria-modal="true" aria-labelledby="tep-editor-title">
    <div class="modal-head modal-head-rich">
      <span class="modal-head-copy"><span class="modal-kicker">Расчётный сценарий</span><span id="tep-editor-title">Параметры ТЭП</span></span>
      <button class="modal-x" aria-label="Закрыть параметры ТЭП"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body tep-editor-body">
      <div class="tep-editor-hint">Изменения применяются к текущему варианту и сразу пересчитывают показатели проекта.</div>
      <section class="form-section" aria-labelledby="tep-build-title">
        <div class="form-section-head"><span class="form-step">01</span><span><b id="tep-build-title">Застройка</b><small>Целевые параметры расчётной территории</small></span></div>
        <div class="form-grid">
          <label><span>Плотность застройки</span><span class="field-shell"><input id="ed-d" type="number" value="${d}" min="1" max="60" step="0.5" required><em>тыс. м²/га</em></span></label>
          <label><span>Доля жилья</span><span class="field-shell"><input id="ed-r" type="number" value="${r}" min="0" max="100" step="1" required><em>%</em></span></label>
        </div>
      </section>
      <section class="form-section" aria-labelledby="tep-norm-title">
        <div class="form-section-head"><span class="form-step">02</span><span><b id="tep-norm-title">Нормативный профиль</b><small>Москва · действующие 2151-ПП и 2152-ПП</small></span></div>
        <div class="form-grid">
          <label><span>Образовательная зона</span><select id="ed-ez"><option value="1"${ez === "1" ? " selected" : ""}>Зона 1 · ДОО 44 / школа 90</option><option value="2"${ez === "2" ? " selected" : ""}>Зона 2 · ДОО 63 / школа 124</option></select></label>
          <label><span>Режим территории</span><select id="ed-tm"><option value="1"${tm === "1" ? " selected" : ""}>Преобразование · 5 м²/чел.</option><option value="2"${tm === "2" ? " selected" : ""}>Реконструкция · 25%</option></select></label>
        </div>
      </section>
      <section class="form-section" aria-labelledby="tep-mobility-title">
        <div class="form-section-head"><span class="form-step">03</span><span><b id="tep-mobility-title">Транспортная доступность</b><small>Коэффициенты предварительного расчёта 945-ПП</small></span></div>
        <div class="form-grid">
          <label><span>Железнодорожная доступность</span><input id="ed-kr" type="number" value="${kr}" min="0.5" max="1" step="0.05" required></label>
          <label><span>Деловая активность</span><input id="ed-kb" type="number" value="${kb}" min="0.1" max="1" step="0.05" required></label>
        </div>
      </section>
      <div class="form-error" id="tep-form-error" role="alert" hidden></div>
    </div>
    <div class="modal-actions">
      <span class="modal-action-note">Параметры сохраняются в проекте</span><span class="spacer"></span>
      <button id="ed-close">Отмена</button>
      <button id="ed-apply" class="primary">Применить сценарий</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const numericInputs = [...overlay.querySelectorAll('input[type="number"]')];
  const formError = overlay.querySelector("#tep-form-error");
  const clearNumberError = input => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    if (formError) { formError.hidden = true; formError.textContent = ""; }
  };
  numericInputs.forEach(input => input.addEventListener("input", () => clearNumberError(input)));
  overlay.querySelector("#ed-apply").onclick = () => {
    const invalid = numericInputs.find(input => !input.value.trim() || !input.checkValidity());
    if (invalid) {
      const label = invalid.labels?.[0]?.querySelector("span")?.textContent?.trim()
        || invalid.getAttribute("aria-label") || "Числовое значение";
      const range = invalid.min && invalid.max ? ` от ${invalid.min} до ${invalid.max}` : "";
      formError.textContent = `${label}: введите значение${range}.`;
      formError.hidden = false;
      invalid.setAttribute("aria-invalid", "true");
      invalid.setAttribute("aria-describedby", formError.id);
      invalid.focus({ preventScroll: true });
      return;
    }
    snapshot();
    document.getElementById("p-density").value = overlay.querySelector("#ed-d").value;
    document.getElementById("p-ratio").value = overlay.querySelector("#ed-r").value;
    document.getElementById("p-education-zone").value = overlay.querySelector("#ed-ez").value;
    document.getElementById("p-territory-mode").value = overlay.querySelector("#ed-tm").value;
    document.getElementById("p-krail").value = overlay.querySelector("#ed-kr").value;
    document.getElementById("p-kba").value = overlay.querySelector("#ed-kb").value;
    persist();
    refreshTep();
    overlay.remove();
    toast("Параметры ТЭП обновлены");
  };
  overlay.querySelector("#ed-close").onclick = () => overlay.remove();
  overlay.querySelector(".modal-x").onclick = () => overlay.remove();
  overlay.onclick = e => { if(e.target === overlay) overlay.remove(); };
}

function openBufferDialog() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const currentDist = document.getElementById("buf-dist").value || "300";
  const currentSide = document.querySelector('input[name="buf-side"]:checked')?.value || "both";
  const sideOptions = [
    ["both", "С обеих сторон"], ["outer", "Снаружи"], ["inner", "Внутри"]
  ];
  overlay.innerHTML = `<div class="modal fmt-modal buffer-modal">
    <div class="modal-head">Создать буфер
      <button class="modal-x" aria-label="Закрыть создание буфера"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body">
      <div class="buffer-hint">Буфер строится вокруг выбранных объектов и добавляется в активный слой.</div>
      <div class="buffer-presets">
        <button type="button" data-dist="300">Детский сад · 300 м</button>
        <button type="button" data-dist="500">Школа · 500 м</button>
      </div>
      <label>Расстояние, м<input id="buffer-distance" type="number" min="1" max="2000" step="5" value="${escHtml(currentDist)}"></label>
      <fieldset class="buffer-sides">
        <legend>Направление</legend>
        ${sideOptions.map(([value, label]) => `<label class="chk"><input type="radio" name="buffer-dialog-side" value="${value}"${value === currentSide ? " checked" : ""}>${label}</label>`).join("")}
      </fieldset>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button id="buffer-cancel">Отмена</button>
      <button id="buffer-create" class="primary">Создать</button>
    </div></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-dist]").forEach(button => button.onclick = () => {
    overlay.querySelector("#buffer-distance").value = button.dataset.dist;
  });
  overlay.querySelector("#buffer-create").onclick = async () => {
    const createButton = overlay.querySelector("#buffer-create");
    const distance = overlay.querySelector("#buffer-distance").value;
    document.getElementById("buf-dist").value = distance;
    const side = overlay.querySelector('input[name="buffer-dialog-side"]:checked')?.value || "both";
    const hiddenSide = document.querySelector(`input[name="buf-side"][value="${side}"]`);
    if (hiddenSide) hiddenSide.checked = true;
    const originalText = createButton.textContent;
    createButton.textContent = "Создание…";
    const created = await generateBuffers(null, distance, side);
    if (created) close();
    else if (createButton.isConnected) createButton.textContent = originalText;
  };
  overlay.querySelector("#buffer-cancel").onclick = close;
  overlay.querySelector(".modal-x").onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
}

// ---------- встроенные диалоги (взамен браузерных alert/confirm/prompt) ----------
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function ruCount(value, one, few, many) {
  const number = Math.abs(Number(value)) || 0;
  const mod100 = number % 100;
  const mod10 = number % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? many
    : mod10 === 1 ? one
    : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${value} ${word}`;
}
// подтверждение: Promise<bool>. danger — красная кнопка для необратимого.
function uiConfirm(msg, { title = "", ok = "OK", cancel = "Отмена", danger = false } = {}) {
  return new Promise(resolve => {
    // do not close other modals — allow nested (e.g. create project style from inside layer style dialog)
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg">${escHtml(msg)}</div>
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">${escHtml(cancel)}</button>
        <button class="ask-ok ${danger ? "danger" : "primary"}">${escHtml(ok)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", ev => ev.stopPropagation());
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelector(".ask-ok").addEventListener("click", () => done(true));
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(false));
    overlay.addEventListener("click", ev => { if (ev.target === overlay) done(false); });
    overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") done(false); });
    overlay.querySelector(danger ? ".ask-cancel" : ".ask-ok").focus();
  });
}
// Явный выбор одного из нескольких действий: Promise<value|null>.
// В отличие от uiConfirm, «Отмена» и Escape всегда означают отсутствие
// выбора, а не неявный переход ко второму действию.
function uiChoice(msg, choices, { title = "", cancel = "Отмена" } = {}) {
  return new Promise(resolve => {
    const safeChoices = Array.isArray(choices)
      ? choices.filter(choice => choice && choice.value != null && choice.label) : [];
    if (!safeChoices.length) { resolve(null); return; }
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg">${escHtml(msg)}</div>
      <div class="modal-actions"><button class="ask-cancel">${escHtml(cancel)}</button>
        <span class="spacer"></span>${safeChoices.map((choice, index) =>
          `<button class="ask-choice${choice.primary ? " primary" : ""}" data-choice="${index}">${escHtml(choice.label)}</button>`
        ).join("")}
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };
    overlay.querySelectorAll(".ask-choice").forEach(button => {
      button.addEventListener("click", () => done(
        safeChoices[Number(button.dataset.choice)]?.value ?? null));
    });
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(null));
    overlay.addEventListener("click", event => { if (event.target === overlay) done(null); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(null); });
    (overlay.querySelector(".ask-choice.primary") ||
      overlay.querySelector(".ask-choice") || overlay.querySelector(".ask-cancel")).focus();
  });
}
// ввод строки: Promise<string|null> (null — отмена).
function uiPrompt(msg, def = "", { ok = "OK", placeholder = "" } = {}) {
  return new Promise(resolve => {
    // do not close other modals — allow nested (e.g. create project style from inside layer style dialog)
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal">
      <div class="ask-msg">${escHtml(msg)}</div>
      <input type="text" class="ask-input" placeholder="${escHtml(placeholder)}">
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">Отмена</button>
        <button class="ask-ok primary">${escHtml(ok)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", ev => ev.stopPropagation());
    const inp = overlay.querySelector(".ask-input");
    inp.value = def; inp.focus(); inp.select();
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelector(".ask-ok").addEventListener("click", () => done(inp.value));
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(null));
    inp.addEventListener("keydown", ev => {
      if (ev.key === "Enter") done(inp.value);
      if (ev.key === "Escape") done(null);
    });
    overlay.addEventListener("click", ev => { if (ev.target === overlay) done(null); });
  });
}
// Показывает значение для передачи коллеге без нативного prompt: поле сразу
// выделено, копирование работает и через Clipboard API, и в старых браузерах.
function uiCopyText(msg, value, { title = "", copy = "Скопировать" } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal" role="dialog" aria-modal="true">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg">${escHtml(msg)}</div>
      <input type="text" class="ask-input" readonly aria-label="Значение для копирования">
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">Закрыть</button>
        <button class="ask-copy primary">${escHtml(copy)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    const input = overlay.querySelector(".ask-input");
    input.value = String(value == null ? "" : value);
    const done = copied => { overlay.remove(); resolve(copied); };
    const select = () => { input.focus(); input.select(); };
    overlay.querySelector(".ask-copy").addEventListener("click", async () => {
      select();
      let copied = false;
      try { await navigator.clipboard.writeText(input.value); copied = true; }
      catch (error) {
        try { copied = document.execCommand("copy"); } catch (fallbackError) { copied = false; }
      }
      if (copied) { toast("Скопировано", "ok"); done(true); }
      else toast("Не удалось скопировать — выделите текст вручную", "error");
    });
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(false));
    overlay.addEventListener("click", event => { if (event.target === overlay) done(false); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(false); });
    select();
  });
}
window.uiConfirm = uiConfirm;
window.uiPrompt = uiPrompt;
window.uiCopyText = uiCopyText;

async function openAutosaveRecovery() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal recovery-modal" role="dialog" aria-modal="true" aria-label="Восстановление автосохранения">
    <div class="modal-head">Восстановление автосохранения
      <button class="modal-x" aria-label="Закрыть окно восстановления"><svg class="ic"><use href="#ic-close"/></svg></button>
    </div>
    <div class="modal-body recovery-body"><div class="recovery-empty">Загрузка копий…</div></div>
    <div class="modal-actions"><span class="muted">Перед восстановлением текущее состояние будет сохранено.</span><span class="spacer"></span><button class="recovery-close">Закрыть</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").onclick = close;
  overlay.querySelector(".recovery-close").onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  overlay.onkeydown = event => { if (event.key === "Escape") close(); };
  // Безопасное действие внизу окна заметнее и удобнее с клавиатуры, чем
  // маленький крестик в заголовке. Общий a11y-слой затем удерживает Tab внутри.
  overlay.querySelector(".recovery-close").focus();
  const body = overlay.querySelector(".recovery-body");
  try {
    const response = await fetch("/api/autosave/backups");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const backups = Array.isArray(data.backups) ? data.backups : [];
    if (!backups.length) {
      const emptyCopy = window.GRADO_STATIC
        ? "Контрольная копия появится перед созданием или открытием другого проекта."
        : "Предыдущих копий пока нет. Они появятся после нескольких изменений проекта.";
      body.innerHTML = `<div class="recovery-empty">${emptyCopy}</div>`;
      return;
    }
    body.innerHTML = backups.map(item => {
      const date = item.saved_at ? new Date(item.saved_at).toLocaleString("ru-RU", {
        dateStyle: "medium", timeStyle: "short",
      }) : "Старая копия";
      return `<div class="recovery-item">
        <div class="recovery-main"><strong>${escHtml(item.name)}</strong><span>${escHtml(date)} · ${ruCount(item.feature_count, "объект", "объекта", "объектов")}</span></div>
        <button data-recover="${item.id}">Восстановить</button>
      </div>`;
    }).join("");
    body.querySelectorAll("[data-recover]").forEach(button => {
      button.onclick = async () => {
        const item = backups.find(x => String(x.id) === button.dataset.recover);
        if (!item || !(await uiConfirm(
          `Восстановить копию «${item.name}»? Текущее состояние останется в резервных копиях.`,
          { ok: "Восстановить" }))) return;
        button.disabled = true;
        try {
          const backupResponse = await fetch(`/api/autosave/backups/${item.id}`);
          if (!backupResponse.ok) throw new Error(`HTTP ${backupResponse.status}`);
          const saved = await backupResponse.json();
          clearTimeout(autosaveTimer);
          await saveStateNow(collectState(), { checkpoint: true });
          const savedState = saved && saved.state && typeof saved.state === "object"
            ? saved.state : saved;
          resetProjectState(savedState && savedState.name || "Восстановленный проект");
          if (!applyRestoredState(saved)) throw new Error("invalid autosave state");
          const skipped = lastRestoreSkipped;
          syncProjectControls();
          close();
          afterChange(); fitView();
          toast(skipped
            ? `Восстановлена копия «${item.name}»; ${ruCount(skipped, "повреждённый объект пропущен", "повреждённых объекта пропущено", "повреждённых объектов пропущено")}`
            : `Восстановлена копия «${item.name}»`, skipped ? "warn" : "ok");
        } catch (error) {
          button.disabled = false;
          toast("Не удалось восстановить копию", "error");
        }
      };
    });
  } catch (error) {
    body.innerHTML = `<div class="recovery-empty error">Не удалось получить резервные копии.</div>`;
  }
}



// ---------- журнал источников (снимки НСПД/ФГИС ТП, шаг 6) ----------
// человекочитаемые имена источников (в данных — короткие коды коннекторов)
const SOURCE_LABELS = { fgistp: "ФГИС ТП", nspd: "НСПД", gisogd: "ГИС ОГД" };
// объектов → «N объектов» с правильным русским склонением
function plObjects(n) {
  const t = n % 10, h = n % 100;
  const w = (t === 1 && h !== 11) ? "объект"
          : (t >= 2 && t <= 4 && (h < 12 || h > 14)) ? "объекта" : "объектов";
  return `${n} ${w}`;
}
function renderSources() {
  const el = document.getElementById("sources-body");
  if (!el) return;
  if (!state.sources.length) {
    el.className = "muted"; el.textContent = "Пока не импортировано"; return;
  }
  el.className = "";
  el.innerHTML = state.sources.map(s => {
    // технический хеш снимка (670c6316) пользователю не нужен — прячем
    // в подсказку для диагностики, показываем дату и число объектов
    const sha = s.sha8 || (s.sha256 || "").slice(0, 8);
    const date = (s.fetched_at || "").slice(0, 10);
    const name = SOURCE_LABELS[s.source] || (s.source || "").toUpperCase();
    return `<div class="src-row" title="снимок ${escHtml(s.id)} · версия ${escHtml(sha)}">
      <span class="src-name">${escHtml(name)}</span>
      <span class="src-meta">${date} · ${plObjects(s.count)}</span></div>`;
  }).join("");
}

// снимок из ответа импорта → журнал; diff → тост «источник изменился»
function recordSource(snapshot, diff, options = {}) {
  if (!snapshot) return;
  if (!state.sources.some(s => s.id === snapshot.id)) {
    state.sources.unshift(snapshot);
    if (state.sources.length > 50) state.sources.pop();
  }
  if (!options.defer) { renderSources(); persist(); }
  if (diff && (diff.added.length || diff.removed.length || diff.changed.length))
    toast(`Источник изменился: +${diff.added.length} −${diff.removed.length} ~${diff.changed.length}`);
}

// журнал снимков сервера — источник истины (сливаем с локальным)
async function fetchSources() {
  try {
    const r = await fetch("/api/sources");
    if (!r.ok) return;
    const list = await r.json();
    const byId = new Map(state.sources.map(s => [s.id, s]));
    for (const s of list) byId.set(s.id, s);
    state.sources = [...byId.values()]
      .sort((a, b) => (b.fetched_at || "").localeCompare(a.fetched_at || ""));
    renderSources();
  } catch (e) { /* сервер без /api/sources — журнал только локальный */ }
}

function deleteSelected() {
  const ids = new Set(selectionIds());
  if (!ids.size) return;
  snapshot();
  state.features = state.features.filter(f => !ids.has(f.id));
  clearSelection(); afterChange();
}

// ---------- добавление и правка фигур ----------
// layerId (не kind!) — иначе при двух слоях одного вида (built-in + созданный
// в панели) объект всегда падал бы в первый слой этого kind, игнорируя
// реально активный слой (тот же класс бага, что был в MODEL-01 на бэкенде).
function addFeature(layerId, geom) {
  const L = LAYER_BY_ID[layerId];
  const dimensionLayer = L && L.kind === "dim" && L.annotation;
  if (!L || L.locked || L.import_only || (L.annotation && !dimensionLayer)) {
    toast(L?.locked ? `Слой «${L.title}» заблокирован — объект не создан`
      : "Выберите доступный проектный слой", "warn");
    return null;
  }
  snapshot();
  const f = { id: state.nextId++, layer_id: layerId,
             props: L ? L.defaults() : {}, ...geom };
  // значения по умолчанию произвольных полей слоя — на новый объект
  for (const cf of (L && L.fields) || [])
    if (cf.default != null && f.props[cf.name] == null) f.props[cf.name] = cf.default;
  upgradeFeature(f);
  state.features.push(f);
  selectOne(f.id);
  afterChange();
  return f;
}
// убрать подряд совпадающие точки (в пределах допуска) — защита от вырожденной
// геометрии: кольцо нулевой площади, линия из одинаковых точек, дубль конца/начала
function dedupePts(pts, closed) {
  const eps = 1e-6, out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push([p[0], p[1]]);
  }
  if (closed && out.length > 1 &&
      Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps)
    out.pop();
  return out;
}
function finishDrawing() {
  const d = state.drawing;
  const L = activeLayer();
  if (d && !isDrawableLayer(L)) toast(L?.locked
    ? `Слой «${L.title}» заблокирован — рисование отменено`
    : "Активный слой недоступен — создайте или выберите проектный слой", "warn");
  if (!d || !isDrawableLayer(L)) { state.drawing = null; return; }
  const geom = TOOL_GEOM[state.tool];
  const pts = Array.isArray(d.pts) ? d.pts : null;
  if (geom === "polygon" && pts) {
    const r = dedupePts(pts, true);
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e-6) addFeature(L.id, { ring: r });
    else { toast("Слишком мало различных точек для полигона", "warn"); state.drawing = null; draw(); return; }
  } else if (geom === "polyline" && state.tool !== "dim" && pts) {
    const ln = dedupePts(pts, false);
    if (ln.length >= 2) addFeature(L.id, { line: ln });
    else { toast("Линия из совпадающих точек — не создана", "warn"); state.drawing = null; draw(); return; }
  } else if (state.tool === "arc" && pts && pts.length >= 3) {
    const a = arcFrom3Pts(pts[0], pts[1], pts[2]);
    if (a) addFeature(L.id, { arc: a });
  } else if (state.tool === "circle" && d.center) {
    const r = d.r || (state.mouse ? Math.hypot(state.mouse[0] - d.center[0], state.mouse[1] - d.center[1]) : 0);
    if (r > 0.5) addFeature(L.id, { circle: { cx: d.center[0], cy: d.center[1], r } });
  }
  state.drawing = null; state.typed = "";
  draw();
}

// Простой порт Arc.from_3pts для фронтенда (храним параметры + для рендера)
function arcFrom3Pts(p0, pm, p1) {
  const [x0,y0] = p0, [x1,y1] = pm, [x2,y2] = p1;
  const d1 = (x0-x1)*(x0-x2) + (y0-y1)*(y0-y2);
  const d2 = (x1-x0)*(x1-x2) + (y1-y0)*(y1-y2);
  const d3 = (x2-x0)*(x2-x1) + (y2-y0)*(y2-y1);
  const c = 2 * (x0*(y1-y2) + x1*(y2-y0) + x2*(y0-y1));
  if (Math.abs(c) < 1e-6) return null; // коллинеарны
  const cx = ((x0*x0 + y0*y0)*(y1-y2) + (x1*x1 + y1*y1)*(y2-y0) + (x2*x2 + y2*y2)*(y0-y1)) / c;
  const cy = ((x0*x0 + y0*y0)*(x2-x1) + (x1*x1 + y1*y1)*(x0-x2) + (x2*x2 + y2*y2)*(x1-x0)) / c;
  const r = Math.hypot(cx-x0, cy-y0);
  // направление развёртки — ЧЕРЕЗ среднюю точку (как в ядре Arc.from_3pts):
  // если середина в пределах CCW-развёртки к концу — идём против часовой,
  // иначе по часовой (длинная дуга). Раньше JS брал короткую дугу, игнорируя
  // середину — дуга >180° строилась неверно (короткой стороной).
  const a0 = Math.atan2(y0-cy, x0-cx);
  const a1 = Math.atan2(y2-cy, x2-cx);
  const am = Math.atan2(y1-cy, x1-cx);
  const TAU = 2*Math.PI;
  const ccwSweep = ((a1 - a0) % TAU + TAU) % TAU;
  const ccwMid = ((am - a0) % TAU + TAU) % TAU;
  const sweep = ccwMid <= ccwSweep ? ccwSweep : ccwSweep - TAU;
  return { cx, cy, r, a0, sweep };
}
// ---------- трансформации выделения (подобия: дуги/окружности сохраняются) --
// центр (пивот) трансформаций — центр габаритов выделения
function selectionPivot() {
  const pts = [];
  for (const f of selectionFeatures()) {
    if (f.circle) { const c = f.circle; pts.push([c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]); }
    else if (f.arc) { for (const p of featurePts(f)) pts.push(p); pts.push([f.arc.cx, f.arc.cy]); }
    else for (const p of featurePts(f)) pts.push(p);
  }
  if (!pts.length) return null;
  // однопроходный центр bbox (без Math.min(...spread) — краш при выделении
  // многих тысяч объектов, тот же лимит аргументов V8, что в fitPoints)
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  return [(minx + maxx) / 2, (miny + maxy) / 2];
}
// применить преобразование к выделению: pt — маппер точки, arcFn/circleFn —
// правка параметров дуги/окружности (центр, радиус, углы). snapshot один раз.
function transformSelection(pt, arcFn, circleFn) {
  const feats = selectionFeatures();
  if (!feats.length) return false;
  snapshot();
  for (const f of feats) {
    if (f.circle) circleFn(f.circle);
    else if (f.arc) arcFn(f.arc);
    else for (const p of featureMovablePts(f)) { const q = pt(p); p[0] = q[0]; p[1] = q[1]; }  // + дыры
  }
  afterChange();
  return true;
}
function rotateSelectionBy(deg) {
  const P = selectionPivot(); if (!P) return;
  const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const rp = ([x, y]) => { const dx = x - P[0], dy = y - P[1]; return [P[0] + dx * c - dy * s, P[1] + dx * s + dy * c]; };
  transformSelection(rp,
    a => { const nc = rp([a.cx, a.cy]); a.cx = nc[0]; a.cy = nc[1]; a.a0 += th; },
    cc => { const nc = rp([cc.cx, cc.cy]); cc.cx = nc[0]; cc.cy = nc[1]; });
}
function mirrorSelection(axis) {   // 'h' — лево/право (ось вертикальна), 'v' — верх/низ
  const P = selectionPivot(); if (!P) return;
  if (axis === "h") {
    transformSelection(([x, y]) => [2 * P[0] - x, y],
      a => { a.cx = 2 * P[0] - a.cx; a.a0 = Math.PI - a.a0; a.sweep = -a.sweep; },
      cc => { cc.cx = 2 * P[0] - cc.cx; });
  } else {
    transformSelection(([x, y]) => [x, 2 * P[1] - y],
      a => { a.cy = 2 * P[1] - a.cy; a.a0 = -a.a0; a.sweep = -a.sweep; },
      cc => { cc.cy = 2 * P[1] - cc.cy; });
  }
}
function rotateSelected() { rotateSelectionBy(90); }   // R — быстрый поворот 90° (теперь и группа)


// кнопки преобразований для панели свойств (одиночной и групповой)
function transformControlsHtml() {
  return `<div class="prop-sub">Преобразовать</div>
    <div class="xf-row">
      <button id="xf-rot" title="Инструмент «Поворот»: опорная точка, затем мышь или ввод угла на холсте">↻ Повернуть</button>
      <button id="xf-scale" title="Инструмент «Масштаб»: опорная точка, затем мышь или ввод коэффициента на холсте">⤢ Масштаб</button>
    </div>
    <div class="xf-row">
      <button id="xf-mirror" title="Инструмент «Зеркало»: две точки оси симметрии на холсте">⇋ Отразить осью</button>
    </div>
    <div class="xf-row">
      <button id="xf-mh" title="Быстро отразить лево ↔ право (вокруг центра)">↔ Л/П</button>
      <button id="xf-mv" title="Быстро отразить верх ↕ низ (вокруг центра)">↕ В/Н</button>
    </div>`;
}
function bindTransformControls() {
  const g = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  g("xf-rot", () => setTool("rotate")); g("xf-scale", () => setTool("scale"));
  g("xf-mirror", () => setTool("mirror"));
  g("xf-mh", () => mirrorSelection("h")); g("xf-mv", () => mirrorSelection("v"));
}
function duplicateSelected() {
  const f = selectedFeature();
  if (!f) return;
  const g = gridStep();
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = state.nextId++;
  if (copy.circle) {
    copy.circle.cx += g; copy.circle.cy -= g;
  } else if (copy.arc) {
    copy.arc.cx += g; copy.arc.cy -= g;
  } else {
    for (const p of featureMovablePts(copy)) { p[0] += g; p[1] -= g; }  // + дыры
  }
  snapshot();
  state.features.push(copy);
  state.selected = copy.id;
  afterChange();
}
function nudgeSelected(dx, dy) {   // стрелки — сдвиг ВСЕГО выделения (группа тоже)
  transformSelection(
    ([x, y]) => [x + dx, y + dy],
    a => { a.cx += dx; a.cy += dy; },
    cc => { cc.cx += dx; cc.cy += dy; });
}
function placeTypedPoint() {
  if (state.drawing && state.drawing.center != null) {
    // typed radius for circle
    const r = parseFloat(state.typed.replace(",", "."));
    if (isFinite(r) && r > 0) {
      const c = state.drawing.center;
      const L = activeLayer();
      if (L) addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
      state.drawing = null;
    }
    state.typed = "";
    draw();
    return;
  }
  // 3-point радиус для дуг при рисовании: при 2 точках (start, mid) typed = r, mouse как end
  if (state.drawing && state.drawing.pts && state.drawing.pts.length === 2 && state.tool === "arc") {
    const r = parseFloat(state.typed.replace(",", "."));
    if (isFinite(r) && r > 0) {
      const p0 = state.drawing.pts[0];
      const p2 = state.mouse;
      if (p2) {
        const d = Math.hypot(p2[0]-p0[0], p2[1]-p0[1]);
        if (d > 0 && d < 2 * r) {
          const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
          const vx = (p2[0] - p0[0]) / d, vy = (p2[1] - p0[1]) / d;
          const h = Math.sqrt(r * r - (d / 2) * (d / 2));
          const px = -vy, py = vx;
          const c1 = [mx + h * px, my + h * py];
          const c2 = [mx - h * px, my - h * py];
          const mid = state.drawing.pts[1];
          const d1 = Math.hypot(mid[0] - c1[0], mid[1] - c1[1]);
          const d2 = Math.hypot(mid[0] - c2[0], mid[1] - c2[1]);
          const c = d1 < d2 ? c1 : c2;
          const aa0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
          const aa2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
          let sw = aa2 - aa0;
          if (sw > Math.PI) sw -= 2 * Math.PI;
          if (sw < -Math.PI) sw += 2 * Math.PI;
          snapshot();
          const L = activeLayer();
          if (L) addFeature(L.id, { arc: { cx: c[0], cy: c[1], r, a0: aa0, sweep: sw } });
          state.drawing = null;
          state.typed = "";
          draw();
          return;
        }
      }
    }
  }
  // ввод вершины числами: 3 формата
  //   «50»        — длина вдоль направления на курсор (как в CAD относительный);
  //   «100 200»   — абсолютные координаты X Y (разделитель — пробел или ;);
  //   «50<30»     — полярно: длина 50 под углом 30° (ПЧС от +X) от предыдущей точки.
  const base = lastDrawingPt();
  const t = state.typed.trim();
  const num = s => parseFloat(String(s).replace(",", "."));
  let pt = null;
  if (/[<>]/.test(t)) {                       // полярно
    const [ls, as] = t.split(/[<>]/);
    const len = num(ls), ang = num(as) * Math.PI / 180;
    if (base && isFinite(len) && len > 0 && isFinite(ang))
      pt = [base[0] + len * Math.cos(ang), base[1] + len * Math.sin(ang)];
  } else if (/[;\s]/.test(t)) {               // абсолют X Y
    const [xs, ys] = t.split(/[;\s]+/);
    const x = num(xs), y = num(ys);
    if (isFinite(x) && isFinite(y)) pt = [x, y];
  } else {                                    // длина вдоль курсора
    const dist = num(t);
    if (base && state.mouse && isFinite(dist) && dist > 0) {
      const a = Math.atan2(state.mouse[1] - base[1], state.mouse[0] - base[0]);
      pt = [base[0] + dist * Math.cos(a), base[1] + dist * Math.sin(a)];
    }
  }
  if (pt && Array.isArray(state.drawing.pts)) state.drawing.pts.push(pt);
  state.typed = "";
  draw();
}

// ---------- хит-тест ----------
// есть ли у полигона видимая заливка (иначе он выбирается только по обводке).
// границы (kind=boundary) — всегда по обводке, у них нет «тела».
function isFilled(f) {
  if (!f.ring) return false;
  const L = layerOf(f);
  if (L && L.kind === "boundary") return false;
  const st = styleOf(f) || {};
  if (!st.fill || st.fill === "transparent" || st.fill === "none") return false;
  if (st.fillOpacity != null && st.fillOpacity <= 0) return false;
  return true;
}
// ---------- пространственный индекс объектов (для выбора/наведения) ----------
// Грид по габаритам объектов. Кеш в state._ix — слот уже существовал и всюду
// инвалидировался (afterChange/live-edit), но индекс никогда не строился.
//
// Зачем: hitTest звался ПЕРЕБОРОМ «слои × объекты» — при 16 слоях и 20 000
// объектов это ~320 000 проверок, причём на КАЖДОЕ движение мыши (курсор в
// режиме «Выбор» выбирается через hitTest). Замерено: 21.7 мс на одно наведение
// — отсюда «тупит». В draw() эту же ошибку уже чинили бакетами по слоям.
//
// rank хранит приоритет объекта ОДНИМ числом, чтобы порядок выбора не изменился:
// сначала верхний слой (позже в LAYERS_V2), внутри слоя — объект, добавленный
// позже. Кандидаты сортируются по rank убыв. и проходят те же две фазы.
function featureIndex() {
  if (state._ix) return state._ix;
  const items = [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const layerRank = new Map(LAYERS_V2.map((l, i) => [l, i]));
  for (let i = 0; i < state.features.length; i++) {
    const f = state.features[i];
    const L = layerOf(f);
    if (!L) continue;                       // как раньше: объект вне реестра слоёв не ловится
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bump = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    if (f.point) bump(f.point[0], f.point[1]);
    const pts = f.ring || f.line;
    if (pts) for (const p of pts) bump(p[0], p[1]);
    const c = f.circle || f.arc;
    if (c) { bump(c.cx - c.r, c.cy - c.r); bump(c.cx + c.r, c.cy + c.r); }
    if (x0 === Infinity) continue;
    items.push({ f, L, x0, y0, x1, y1, rank: (layerRank.get(L) || 0) * 1e7 + i });
    if (x0 < minx) minx = x0; if (x1 > maxx) maxx = x1;
    if (y0 < miny) miny = y0; if (y1 > maxy) maxy = y1;
  }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 100;
  const cellSize = Math.max(diag / 160, 1e-6);
  const cellOf = v => Math.floor(v / cellSize);
  const cells = new Map();
  for (const it of items) {
    for (let cx = cellOf(it.x0); cx <= cellOf(it.x1); cx++)
      for (let cy = cellOf(it.y0); cy <= cellOf(it.y1); cy++) {
        const k = cx + "_" + cy;
        let a = cells.get(k); if (!a) cells.set(k, a = []);
        a.push(it);
      }
  }
  return (state._ix = { cells, cellOf });
}

// кандидаты рядом с точкой: объекты, чей габарит задет [wx±tol, wy±tol]
function hitCandidates(wx, wy, tolW) {
  const { cells, cellOf } = featureIndex();
  const seen = new Set(), out = [];
  for (let cx = cellOf(wx - tolW); cx <= cellOf(wx + tolW); cx++)
    for (let cy = cellOf(wy - tolW); cy <= cellOf(wy + tolW); cy++) {
      const a = cells.get(cx + "_" + cy);
      if (!a) continue;
      for (const it of a) {
        if (seen.has(it)) continue;         // объект лежит в нескольких ячейках
        seen.add(it);
        if (it.x1 < wx - tolW || it.x0 > wx + tolW ||
            it.y1 < wy - tolW || it.y0 > wy + tolW) continue;
        if (!layerDrawable(it.L) || it.L.locked || catOff(it.L, it.f)) continue;
        out.push(it);
      }
    }
  return out.sort((a, b) => b.rank - a.rank);
}

function hitTest(wx, wy) {
  const tolW = 7 / state.view.k;
  const cand = hitCandidates(wx, wy, tolW);
  // Проход 1 — по ОБВОДКЕ (штрихам): точки, линии, дуги, окружности и
  // полигоны БЕЗ заливки. Клик точно по контуру выбирает именно его объект,
  // даже если сверху лежит другой полигон — у незалитого нет «тела», ловим
  // за обводку (и она видна, т.к. заливкой сверху не перекрыта).
  for (const { f } of cand) {
    if (f.point && Math.hypot(f.point[0] - wx, f.point[1] - wy) < tolW + 4 / state.view.k) return f;
    if (f.line && nearChain(wx, wy, f.line, tolW) !== null) return f;
    if (f.ring && !isFilled(f) && (nearRing(wx, wy, f.ring, tolW)
        || (f.holes || []).some(h => nearRing(wx, wy, h, tolW)))) return f;
    if (f.arc) {
      const aa = f.arc; const dd = Math.hypot(aa.cx - wx, aa.cy - wy);
      if (Math.abs(dd - aa.r) < tolW) return f;
    }
    if (f.circle) {
      const cc = f.circle; const dd = Math.hypot(cc.cx - wx, cc.cy - wy);
      if (Math.abs(dd - cc.r) < tolW) return f;
    }
  }
  // Проход 2 — по ПЛОЩАДИ/контуру: полигон, содержащий точку ИЛИ задетый за
  // обводку (верхний побеждает). Залитый полигон ловится телом; допуск по
  // контуру даёт клик по самой границе (pointInRing ровно на грани неустойчив),
  // но порядок «сверху вниз» защищает от выбора скрытого под заливкой контура.
  for (const { f } of cand) {
    // тело считается БЕЗ выколотых частей (pointInPolygon), но за контур —
    // и внешний, и контур дыры — схватить можно
    if (f.ring && (pointInPolygon(wx, wy, f) || nearRing(wx, wy, f.ring, tolW)
                   || (f.holes || []).some(h => nearRing(wx, wy, h, tolW)))) return f;
  }
  return null;
}
// Замкнутый контур рядом с точкой. Раньше звалось как
// nearChain(wx, wy, [...ring, ring[0]], tolW) — копия всего кольца на КАЖДЫЙ
// объект и КАЖДЫЙ из двух проходов; на городском слое это десятки тысяч лишних
// массивов за одно движение мыши. Здесь замыкание берётся по модулю, без копии.
function nearRing(wx, wy, ring, tolW) {
  const n = ring.length, t2 = tolW * tolW;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const q = nearestOnSeg([wx, wy], a, b);
    const dx = wx - q[0], dy = wy - q[1];
    if (dx * dx + dy * dy < t2) return true;
  }
  return false;
}
// объекты, попавшие в рамку выделения [a,b] (любая вершина внутри), видимые слои
function marqueeHit(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const ids = [];
  for (const f of state.features) {
    if (isHidden(f) || isLocked(f) || catOff(layerOf(f), f)) continue;
    // featureMovablePts: рамка ловит объект и за вершину ДЫРЫ (не только внешнего кольца)
    if (featureMovablePts(f).some(p => p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1))
      ids.push(f.id);
  }
  return ids;
}

// ---------- события мыши ----------
cv.addEventListener("contextmenu", e => e.preventDefault());
// Холст на Pointer Events с захватом указателя: при перетаскивании (вершина,
// тело, рамка выделения, панорама) события продолжают приходить даже когда
// курсор ушёл за пределы холста — на тулбар/панель/шапку. На mousemove@cv
// трекинг рвался у кромки и объект замирал (apple §2/§3: 1:1 + capture).
// touch-action:none — чтобы касание-перетаскивание не конфликтовало со скроллом.
cv.style.touchAction = "none";
// Локальные координаты указателя в холсте из clientX/clientY (а не offsetX):
// у ЗАХВАЧЕННОГО указателя, ушедшего за пределы холста, offsetX в Chrome
// ненадёжен (relative к элементу под курсором), из-за чего перетаскивание
// «застревало» у кромки. clientX−rect надёжен всегда — так же считает ресайзер.
function evXY(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener("pointerdown", e => {
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  const [ex, ey] = evXY(e);
  const [wxr, wyr] = s2w(ex, ey);
  if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) {
    state.pan = { sx: ex, sy: ey, tx: state.view.tx, ty: state.view.ty };
    return;
  }
  if (e.button !== 0) return;
  const s = cursorPoint(wxr, wyr);
  if (state.tool === "select") {
    const cur = selectedFeature();
    if (cur) {
      const vi = vertexAt(cur, wxr, wyr);
      if (vi != null) {
        if (e.altKey) {   // Alt+клик — удалить вершину (в т.ч. дыры)
          const ref = vertexRef(cur, vi);
          if (cur.point || !ref) return;
          const isHole = cur.holes && cur.holes.includes(ref.arr);
          const min = cur.line ? 2 : 3;   // кольцо (внешнее/дыра) — минимум 3
          if (ref.arr.length > min) {
            snapshot(); ref.arr.splice(ref.i, 1); afterChange();
          } else if (isHole) {            // дыра выродилась — убираем её целиком
            snapshot();
            cur.holes = cur.holes.filter(h => h !== ref.arr);
            if (!cur.holes.length) delete cur.holes;
            afterChange();
          }
          return;
        }
        state.edit = { f: cur, vi, moved: false,
                       companions: sharedCompanions(cur, vi) };
        return;
      }
      // перетаскивание ОБЩЕЙ ГРАНИЦЫ ребром: у выбранной coverage-зоны клик по
      // ребру (не по вершине) тянет оба его конца + совпадающие вершины соседей
      // — общая граница остаётся общей, правится одной операцией
      if (isCoverageFeature(cur) && (cur.ring || cur.line)) {
        const raw = cur.ring || cur.line;
        const chain = cur.ring ? [...cur.ring, cur.ring[0]] : cur.line;
        const si = nearChain(wxr, wyr, chain, 7 / state.view.k);
        if (si != null) {
          const i0 = si % raw.length, i1 = (si + 1) % raw.length;
          state.edit = { edgeDrag: true, f: cur, i0, i1,
                         orig0: [...raw[i0]], orig1: [...raw[i1]],
                         comps0: sharedCompanions(cur, i0), comps1: sharedCompanions(cur, i1),
                         grab: [wxr, wyr], moved: false };
          return;
        }
      }
    }
    const f = hitTest(wxr, wyr);
    if (f) {
      if (e.shiftKey) {                        // Shift+клик — добавить/убрать из выделения
        toggleSelection(f.id); draw(); renderProps(); return;
      }
      if (!state.selectedIds.has(f.id)) selectOne(f.id);   // клик по невыделенному — выбрать один
      // клик по уже выделенному (в т.ч. в группе) — тянем всю группу.
      // Опорная точка привязки — ближайшая вершина к месту захвата: при
      // переносе именно она цепляется за вершину/середину/сетку (как в CAD)
      const movingIds = selectionIds();
      const feats = movingIds.map(id => state.features.find(x => x.id === id)).filter(Boolean);
      const primary = selectedFeature() || feats[0] || f;
      let refOrig = primary.point ? [...primary.point] : null;
      if (!refOrig) {
        let bd = Infinity;
        for (const p of featurePts(primary)) {
          const d = Math.hypot(p[0] - wxr, p[1] - wyr);
          if (d < bd) { bd = d; refOrig = [p[0], p[1]]; }
        }
      }
      const orig = feats.map(ff => featureMovablePts(ff).map(p => [p[0], p[1]]));
      state.edit = { vi: "body", ids: movingIds, feats, orig, refOrig,
                     grab: [wxr, wyr], moved: false };
      draw(); renderProps();
    } else {                                   // пустое место — рамка выделения
      if (!e.shiftKey) clearSelection();
      state.drag = { a: [wxr, wyr], b: [wxr, wyr], marquee: true, add: e.shiftKey, moved: false };
      draw(); renderProps();
    }
  } else if (state.tool === "measure") {
    if (!state.measure || state.measure.b) state.measure = { a: s.p, b: null };
    else state.measure.b = s.p;
    draw();
  } else if (state.tool === "trim" || state.tool === "extend") {
    handleTrimExtendClick(wxr, wyr);
  } else if (state.tool === "fillet") {
    handleFilletClick(wxr, wyr);
  } else if (state.tool === "rotate" || state.tool === "scale" || state.tool === "mirror") {
    xfClickBase(s.p);
  } else if (state.tool === "point") {
    const L = activeLayer();
    if (!isDrawableLayer(L)) {
      toast(L?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (L.geometry_type === "point") addFeature(L.id, { point: s.p });
  } else if (state.tool === "rect" && !state.drawing) {
    if (!isDrawableLayer(activeLayer())) {
      toast(activeLayer()?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    // протягивание — прямоугольник; одиночный клик — контур по точкам
    state.drag = { a: s.p, b: s.p, rect: true, moved: false };
  } else if (state.tool === "circle") {
    const L = activeLayer();
    if (!isDrawableLayer(L)) {
      toast(L?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (!toolFitsLayer("circle", L)) {
      toast("Этот слой не поддерживает окружности (выберите/создайте слой с геометрией окружность)", "warn");
      return;
    }
    // Второй клик по уже поставленному центру задаёт радиус и завершает
    // окружность; иначе он просто переставлял бы центр.
    if (state.drawing && state.drawing.center) {
      const c = state.drawing.center;
      const r = Math.hypot(s.p[0] - c[0], s.p[1] - c[1]);
      if (r > 0.5) {
        state.drawing = null; state.typed = "";
        addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
        return;
      }
    }
    state.drawing = { center: s.p, r: 0 };
    state.typed = "";
    draw();
  } else if (state.tool === "dim" || TOOL_GEOM[state.tool]) {
    // рисование геометрии требует активный слой; размеры пишутся в свой
    // аннотационный слой и активного слоя не требуют
    if (state.tool !== "dim" && !isDrawableLayer(activeLayer())) {
      toast(activeLayer()?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (!state.drawing) { state.drawing = { pts: [] }; state.typed = ""; }
    if (state.tool === "dim") {
      if (Array.isArray(state.drawing.pts)) state.drawing.pts.push(s.p);
      if (Array.isArray(state.drawing.pts) && state.drawing.pts.length === 2) {
        const pts = state.drawing.pts;
        state.drawing = null;
        const dim = LAYER_BY_KIND["dim"];
        if (!dim) { toast("Слой размеров недоступен", "warn"); return; }
        addFeature(dim.id, { line: pts });
      } else draw();
      return;
    }
    const ptsArr = state.drawing.pts;
    const first = Array.isArray(ptsArr) ? ptsArr[0] : null;
    if (first && TOOL_GEOM[state.tool] === "polygon" && Array.isArray(ptsArr) && ptsArr.length > 2 &&
        Math.hypot(first[0] - s.p[0], first[1] - s.p[1]) < 12 / state.view.k) {
      finishDrawing();
    } else {
      if (Array.isArray(ptsArr)) {
        ptsArr.push(s.p);
        state.typed = "";
        draw();
        if (state.tool === "arc" && ptsArr.length >= 3) {
          finishDrawing();
        }
      }
    }
  }
});
cv.addEventListener("pointermove", e => {
  const [ex, ey] = evXY(e);
  const [wx, wy] = s2w(ex, ey);
  document.getElementById("st-coords").textContent = `x: ${fmtCoord(wx)}  y: ${fmtCoord(wy)} м`;
  if (state.pan) {
    state.view.tx = state.pan.tx + (ex - state.pan.sx);
    state.view.ty = state.pan.ty + (ey - state.pan.sy);
    draw(); return;
  }
  if (state.drag && state.drag.marquee) {
    state.drag.b = [wx, wy];
    if (Math.hypot(wx - state.drag.a[0], wy - state.drag.a[1]) * state.view.k > 3)
      state.drag.moved = true;
    draw(); return;
  }
  if (state.edit) {
    const ed = state.edit;
    if (!ed.moved) { snapshot(); ed.moved = true; }
    if (ed.edgeDrag) {
      applyEdgeDrag(ed, wx, wy);
      state._ix = null; state._snapIndex = null; draw(); return;
    }
    if (ed.vi === "body") {
      // куда «хочет» уйти опорная вершина по курсору, затем привязка её к
      // вершинам/серединам/сетке чужих объектов; всю группу двигаем на тот же офсет
      const want = [ed.refOrig[0] + (wx - ed.grab[0]), ed.refOrig[1] + (wy - ed.grab[1])];
      const snapped = snapPoint(want[0], want[1], new Set(ed.ids));
      state.snapHit = snapped.kind ? snapped : null;
      const ox = snapped.p[0] - ed.refOrig[0], oy = snapped.p[1] - ed.refOrig[1];
      ed.feats.forEach((feat, fi) => {
        const pts = featureMovablePts(feat), o = ed.orig[fi];  // с дырами
        for (let i = 0; i < pts.length; i++) { pts[i][0] = o[i][0] + ox; pts[i][1] = o[i][1] + oy; }
      });
      // joint edit for shared boundaries on coverage layers — one operation for common edge
      ed.feats.forEach(feat => {
        if (!isCoverageFeature(feat)) return;
        const pts = featurePts(feat);
        for (let vi = 0; vi < pts.length; vi++) {
          const comps = sharedCompanions(feat, vi);
          for (const c of comps) {
            const cpts = featurePts(c.f);
            cpts[c.vi][0] = pts[vi][0];
            cpts[c.vi][1] = pts[vi][1];
          }
        }
      });
    } else {
      // исключаем из привязок свою фигуру и всех компаньонов общей вершины
      const ex = new Set([ed.f.id]);
      for (const c of (ed.companions || [])) ex.add(c.f.id);
      const s = snapPoint(wx, wy, ex);
      state.snapHit = s;
      if (ed.f.arc) {
        const a = ed.f.arc;
        // нормализация приращения угла в (−π,π] — движение конца следует за
        // курсором плавно, без скачка развёртки на ±2π при переходе границы
        const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
        if (ed.vi === 0) { // начало: двигаем начало, КОНЕЦ фиксируем (не вращаем всю дугу)
          const newA0 = Math.atan2(s.p[1] - a.cy, s.p[0] - a.cx);
          const end = a.a0 + a.sweep;       // текущий конец — держим на месте
          a.a0 += wrap(newA0 - a.a0);
          a.sweep = end - a.a0;
        } else if (ed.vi === 1) { // конец: плавно, начало фиксируем
          const newAng = Math.atan2(s.p[1] - a.cy, s.p[0] - a.cx);
          a.sweep += wrap(newAng - (a.a0 + a.sweep));
        } else if (ed.vi === 2) { // center
          a.cx = s.p[0]; a.cy = s.p[1];
        } else if (ed.vi === 3) { // radius (логика редактирования)
          const dx = s.p[0] - a.cx, dy = s.p[1] - a.cy;
          a.r = Math.hypot(dx, dy);
          if (a.r < 0.1) a.r = 0.1;
        }
      } else if (ed.f.circle) {
        const c = ed.f.circle;
        if (ed.vi === 0) { // center
          c.cx = s.p[0]; c.cy = s.p[1];
        } else if (ed.vi === 1) { // radius handle
          c.r = Math.hypot(s.p[0] - c.cx, s.p[1] - c.cy);
          if (c.r < 0.1) c.r = 0.1;
        }
      } else {
        // адресуемся по кольцам: вершина дыры тянется как обычная
        const ref = vertexRef(ed.f, ed.vi) || { arr: featurePts(ed.f), i: ed.vi };
        ref.arr[ref.i][0] = s.p[0]; ref.arr[ref.i][1] = s.p[1];
        for (const c of (ed.companions || [])) {
          const cpts = featurePts(c.f);
          cpts[c.vi][0] = s.p[0]; cpts[c.vi][1] = s.p[1];
        }
      }
    }
    state._ix = null; state._snapIndex = null;
    draw(); return;
  }
  const s = cursorPoint(wx, wy);
  state.snapHit = s;
  state.mouse = s.p;
  updateSnapStatus(s);
  if (state.xf && state.xf.phase === "act") {
    xfUpdatePreview(); draw(); return;
  }
  if (state.drag && state.drag.rect) {
    state.drag.b = s.p;
    if (Math.hypot(s.p[0] - state.drag.a[0], s.p[1] - state.drag.a[1]) * state.view.k > 4)
      state.drag.moved = true;
    draw(); return;
  }
  if (state.drawing && state.drawing.center != null && state.tool === "circle") {
    draw(); return;
  }
  if (state.tool === "select") {
    const cur = selectedFeature();
    const onCovEdge = cur && isCoverageFeature(cur) && (cur.ring || cur.line) &&
      nearChain(wx, wy, cur.ring ? [...cur.ring, cur.ring[0]] : cur.line, 7 / state.view.k) != null;
    cv.style.cursor = (cur && vertexAt(cur, wx, wy) != null) ? "move"
      : onCovEdge ? "move"
      : hitTest(wx, wy) ? "pointer" : "default";
    if (state.guides.length) draw();
  }
  if (state.drawing || state.tool !== "select") draw();
});
// Слушаем на window, а не на #cv: если отпустить кнопку за пределами
// холста (над панелью/тулбаром), локальный слушатель #cv это событие
// не увидит — pan/edit/drag «залипнут», и вид будет произвольно
// скакать при следующем движении мыши, создавая впечатление, что
// холст не реагирует на клики.
window.addEventListener("pointerup", e => {
  if (state.pan) { state.pan = null; return; }
  if (state.edit) {
    const moved = state.edit.moved;
    state.edit = null;
    if (moved) afterChange();
    return;
  }
  if (state.drag && state.drag.marquee) {
    const { a, b, add, moved } = state.drag;
    state.drag = null;
    if (moved) {
      const hits = marqueeHit(a, b);
      setSelection(add ? [...new Set([...selectionIds(), ...hits])] : hits);
    }
    draw(); renderProps(); return;
  }
  if (state.drag && state.drag.rect) {
    const { a, b, moved } = state.drag;
    state.drag = null;
    const L = activeLayer();
    if (moved && Math.abs(a[0] - b[0]) > 1 && Math.abs(a[1] - b[1]) > 1) {
      if (L && L.geometry_type === "polygon")
        addFeature(L.id, { ring: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] });
    } else if (!moved) {
      // клик без протягивания — произвольный контур по точкам
      state.drawing = { pts: [a] };
      state.typed = "";
      draw();
    } else draw();
  } else if (state.drawing && state.drawing.center != null && state.tool === "circle") {
    const c = state.drawing.center;
    const mp = state.mouse || [c[0], c[1]];
    const r = Math.hypot(mp[0] - c[0], mp[1] - c[1]);
    const L = activeLayer();
    if (L && r > 0.5) {
      state.drawing = null;
      addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
    } else {
      // Клик без протягивания: центр ОСТАЁТСЯ, радиус задаётся вторым кликом,
      // вводом числа или Enter. Раньше pointerup того же клика сбрасывал
      // drawing, и оба этих способа (стандартный приём САПР) были недостижимы —
      // окружность можно было построить только нажать-протянуть-отпустить.
      draw();
    }
  }
});
// потеря фокуса окна (alt-tab, системный диалог) посреди жеста —
// та же защита, чтобы состояние не осталось залипшим
window.addEventListener("blur", () => {
  state.pan = null;
  if (state.edit) { state.edit = null; }
  if (state.drag) { state.drag = null; }
  if (state.drawing) { state.drawing = null; draw(); }
});
cv.addEventListener("dblclick", e => {
  e.preventDefault();
  if (state.drawing) { finishDrawing(); return; }
  // двойной клик по ребру выбранной фигуры — вставка вершины
  if (state.tool === "select") {
    const f = selectedFeature();
    if (!f || f.point || f.arc || f.circle) return;
    const [wx, wy] = s2w(e.offsetX, e.offsetY);
    // ищем ближайшее ребро по ВСЕМ кольцам (внешний контур + дыры), вставляем
    // вершину в то кольцо, чьё ребро задето — двойной клик по краю дыры работает
    const tol = 7 / state.view.k;
    for (const ring of featureRings(f)) {
      const closed = f.ring ? [...ring, ring[0]] : ring;
      const i = nearChain(wx, wy, closed, tol);
      if (i !== null) {
        snapshot();
        const q = nearestOnSeg([wx, wy], closed[i], closed[i + 1]);
        ring.splice(i + 1, 0, q);
        afterChange();
        return;
      }
    }
  }
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  state.view.k = clampK(state.view.k * factor);
  state.view.tx = e.offsetX - wx * state.view.k;
  state.view.ty = e.offsetY + wy * state.view.k;
  draw();
}, { passive: false });

// ---------- клавиатура (по кодам клавиш — не зависит от раскладки) ----------
const TOOL_CODES = { KeyV: "select", KeyM: "measure", KeyD: "dim", KeyT: "trim", KeyE: "extend" };
// старые предметные клавиши — теперь «создать-или-выбрать слой этого вида»
// (L2b: пресетов нет, слой заводится по требованию) + естественный инструмент
const PRESET_KIND_CODES = {
  KeyG: "boundary", KeyZ: "zone", KeyO: "restrict", KeyB: "building",
  KeyP: "public", KeyL: "redline", KeyS: "social",
};
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
    e.preventDefault(); document.getElementById("btn-grado").click(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyO") {
    e.preventDefault(); document.getElementById("btn-open").click(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyN") {
    e.preventDefault(); document.getElementById("btn-new-project").click(); return;
  }
  // TEXTAREA и contenteditable раньше сюда проваливались: в редакторе формул
  // пробел не набирался (preventDefault ниже), а Backspace ПАРАЛЛЕЛЬНО удалял
  // выделенные объекты холста — правка текста молча уносила геометрию.
  // BUTTON: пробел обязан активировать кнопку (WCAG 2.1.1), а Delete при
  // фокусе на кнопке в модалке — не стирать объекты за её спиной.
  const t = e.target;
  if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"
      || t.isContentEditable) return;
  if (t.tagName === "BUTTON" &&
      (e.code === "Space" || e.key === "Enter" || e.key === "Delete" || e.key === "Backspace")) return;
  if (e.key === "Shift") { shiftDown = true; if (state.drawing) draw(); return; }
  if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
    e.preventDefault(); e.shiftKey ? redo() : undo(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") {
    e.preventDefault(); duplicateSelected(); return;
  }
  // ввод значения (угол/коэффициент) прямо на холсте (без всплывающего окна); зеркало — без ввода
  if (state.xf && state.xf.phase === "act" && state.xf.kind !== "mirror") {
    if (/^[0-9.,-]$/.test(e.key)) { state.typed += e.key; xfUpdatePreview(); draw(); return; }
    if (e.key === "Backspace") { state.typed = state.typed.slice(0, -1); xfUpdatePreview(); draw(); return; }
  }
  // набор при рисовании: длина (50), абсолют X Y (100 200 или 100;200),
  // полярно (длина<угол°). Разрешены цифры, разделители, знак, угол
  // Начало фигуры С КЛАВИАТУРЫ. Набор координат гейтился уже начатым
  // рисованием, а начиналось оно только в pointerdown холста — то есть первую
  // точку можно было поставить исключительно мышью, хотя подпись холста
  // обещает «Enter завершает фигуру» (WCAG 2.1.1 для основной функции
  // приложения). Цифра при активном инструменте геометрии открывает набор:
  // дальше работает уже существующий формат «100 200» (абсолютные X Y),
  // которому предыдущая точка не нужна. Окружность не сеем — ей сначала нужен
  // центр, а не радиус.
  if (!state.drawing && !state.xf && TOOL_GEOM[state.tool] && state.tool !== "circle"
      && /^[0-9]$/.test(e.key) && isDrawableLayer(activeLayer())) {
    state.drawing = { pts: [] };
    state.typed = e.key;
    toast("Введите координаты «X Y» и нажмите Enter", "info");
    draw();
    return;
  }
  if (state.drawing && /^[0-9.,;<> -]$/.test(e.key)) { state.typed += e.key; draw(); return; }
  if (state.drawing && e.key === "Backspace") {
    state.typed = state.typed.slice(0, -1); draw(); return;
  }
  if (e.key === "Enter") {
    if (state.xf && state.xf.phase === "act") { xfCommit(); return; }
    if (state.trimCtx && !state.trimCtx.ready) {
      if (!state.trimCtx.boundary.size) { toast("Выберите хотя бы одну границу", "warn"); return; }
      state.trimCtx.ready = true;
      toast(state.tool === "trim" ? "Кликните лишний кусок линии" : "Кликните открытый конец линии для продления");
      return;
    }
    if (state.drawing && state.typed) placeTypedPoint();
    else finishDrawing();
    return;
  }
  if (e.key === "Escape") {
    if (state.xf && state.xf.phase === "act") { xfCancel(); return; }
    if (state.typed) { state.typed = ""; draw(); return; }
    if (state.drawing) { state.drawing = null; draw(); return; }
    if (state.measure) { state.measure = null; draw(); return; }
    if (state.trimCtx && (state.trimCtx.boundary.size || state.trimCtx.ready)) {
      state.trimCtx = { boundary: new Set(), ready: false }; draw();
      toast("Выбор границ сброшен");
      return;
    }
    clearSelection(); draw(); renderProps(); return;
  }
  if (e.key === "Delete" || e.key === "Backspace") { deleteSelected(); return; }
  if (e.key.startsWith("Arrow")) {
    const step = e.shiftKey ? 1 : gridStep();
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d && selectionFeatures().length) { e.preventDefault(); nudgeSelected(...d); }
    return;
  }
  if (e.key === "?" || (e.shiftKey && e.code === "Slash")) { openShortcuts(); return; }
  if (e.code === "KeyX") { setOsnap(!state.osnap); return; }
  if (e.code === "KeyC" && !e.metaKey && !e.ctrlKey) { setGridSnap(!state.gridSnap); return; }
  if (e.code === "KeyF") { fitView(); return; }
  if (e.code === "KeyR") { rotateSelected(); return; }
  if (e.code === "KeyJ") { joinSelected(); return; }
  const tool = TOOL_CODES[e.code];
  if (tool) { setTool(tool); return; }
  const kind = PRESET_KIND_CODES[e.code];
  if (kind) quickLayerByKind(kind);
});
document.addEventListener("keyup", e => {
  if (e.key === "Shift") { shiftDown = false; if (state.drawing) draw(); }
  if (e.code === "Space") spaceDown = false;
});

// ---------- инструменты, сетка, кнопки ----------
function updateLayerStatus() {
  const L = activeLayer();
  const el = document.getElementById("st-layer");
  if (el) el.textContent = L ? `слой: ${L.title}` : "";
  // чип «куда я черчу» поверх холста — главный ориентир активного слоя
  const chip = document.getElementById("cv-activelayer");
  if (!chip) return;
  if (L) {
    const st = layerStyle(L) || {};
    const col = st.stroke || st.fill || cvColor("boundary", "#8a8a8a");
    chip.className = "cv-activelayer";
    chip.onclick = null;
    chip.innerHTML = `<span class="al-dot" style="background:${escHtml(col)}"></span>` +
                     `<span class="al-cap">черчу в:</span>&nbsp;${escHtml(L.title)}`;
  } else {
    chip.className = "cv-activelayer empty";
    chip.onclick = () => openNewLayerDialog();
    chip.innerHTML = `<span class="al-dot" style="background:var(--warning)"></span>` +
                     `нет активного слоя — создайте (+)`;
  }
}
function setTool(tool, opts = {}) {
  state.tool = tool; state.drawing = null; state.drag = null;
  state.edit = null; state.typed = "";
  if (tool !== "measure") state.measure = null;
  if (tool === "trim" || tool === "extend") {
    state.trimCtx = { boundary: new Set(), ready: false };
    toast(`Режим ${tool}: клик по границам (Enter), затем по цели для ${tool==='trim'?'обрезки':'продления'}. Границы подсвечены.`);
    document.getElementById('st-hint').textContent = `Режим ${tool}: выберите границы, Enter — готово, клик по цели`;
  } else {
    state.trimCtx = null;
  }
  if (tool === "fillet") {
    promptFilletRadius();   // задать радиус при входе в инструмент
    document.getElementById('st-hint').textContent = "Сопряжение: клик по углу линии/контура — скругляется дугой";
  }
  if (tool === "rotate" || tool === "scale" || tool === "mirror") xfStart(tool);
  else state.xf = null;
  // геом-инструмент против несовместимого слоя — слой переключается сам
  if (!opts.keepLayer && GEOM_OF_TOOL[tool] && !toolFitsLayer(tool, activeLayer())) {
    // подходящий слой рисуемой геометрии — но не приёмник импорта и не аннотация
    const fit = LAYERS_V2.find(l => isDrawableLayer(l) &&
                                    l.geometry_type === GEOM_OF_TOOL[tool]);
    if (fit) { state.activeLayerId = fit.id; renderLayers(); }
    else if (!activeLayer()) toast("Создайте слой для рисования", "warn");
  }
  updateLayerStatus();
  document.querySelectorAll("#toolbar button[data-tool]").forEach(
    b => {
      const active = b.dataset.tool === tool;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  cv.style.cursor = tool === "select" ? "default" : "crosshair";
  draw();
}
function setActiveLayer(id) {
  const L = LAYER_BY_ID[id];
  if (!L) return;
  // import-only (источник) и аннотационные слои — не цели рисования: иначе
  // объект молча уходил бы в проектный слой (LAYER_BY_KIND по kind)
  if (L.import_only || L.annotation) {
    toast(`Слой «${L.title}» заполняется только импортом — рисовать в него нельзя`);
    return;
  }
  if (L.locked) {
    toast(`Слой «${L.title}» заблокирован — снимите блокировку, чтобы рисовать`, "warn");
    return;
  }
  state.activeLayerId = id;
  state.drawing = null; state.typed = "";
  // несовместимый инструмент — переключается на естественный для слоя
  if (GEOM_OF_TOOL[state.tool] && !toolFitsLayer(state.tool, L))
    setTool(naturalToolFor(L), { keepLayer: true });
  renderLayers(); renderProps(); updateLayerStatus(); persist(); draw();
}
// быстрый слой по виду (клавиши G Z O B P L S): выбирает существующий слой
// этого вида или заводит новый, затем ставит естественный инструмент. L2b:
// пресетов нет — слой создаётся по требованию, повторное нажатие переиспользует
function quickLayerByKind(kind) {
  const base = BASE_KIND_BY_KIND[kind];
  if (!base) return;
  let L = LAYERS_V2.find(l => l.kind === kind && isDrawableLayer(l));
  if (!L) {
    const locked = LAYERS_V2.find(l => l.kind === kind && !l.import_only && !l.annotation && l.locked);
    if (locked) {
      toast(`Слой «${locked.title}» заблокирован — сначала разблокируйте его`, "warn");
      return;
    }
  }
  if (!L) {
    snapshot();
    L = createUserLayer({ kind, title: base.label });
    renderLayers(); persist();
    toast(`Слой «${base.label}» создан`);
  }
  state.activeLayerId = L.id;
  setTool(naturalToolFor(L), { keepLayer: true });
  renderLayers(); renderProps(); updateLayerStatus();
}
document.querySelectorAll("#toolbar button[data-tool]").forEach(
  b => b.addEventListener("click", () => setTool(b.dataset.tool)));
document.getElementById("btn-join").addEventListener("click", () => joinSelected());

function setOsnap(v) {
  state.osnap = !!v;
  const button = document.getElementById("btn-snap");
  button.classList.toggle("active", state.osnap);
  button.setAttribute("aria-pressed", String(state.osnap));
  const chk = document.getElementById("obj-snap");
  if (chk) chk.checked = state.osnap;
  updateSnapStatus();
  draw();
}
function updateSnapStatus(hit = null) {
  const status = document.getElementById("st-snap");
  if (!status) return;
  status.textContent = !state.osnap ? "объекты: выкл"
    : hit && hit.kind && hit.kind !== "сетка" ? `привязка: ${hit.kind}`
    : "объекты: вкл";
  status.classList.toggle("snap-active", !!(hit && hit.kind && hit.kind !== "сетка"));
}
function setGridSnap(v) {
  state.gridSnap = v;
  const chk = document.getElementById("grid-snap");
  if (chk) chk.checked = v;
  draw();
}
on("basemap-show", "change", e => {
  basemap.on = e.target.checked;
  if (basemap.on && basemap.originLon == null) initBasemap().then(draw);
  draw();
});
on("basemap-opacity", "input", e => {
  basemap.opacity = +e.target.value / 100;
  draw();
});
on("basemap-source", "change", e => {
  setBasemapSource(e.target.value);
  if (basemap.on && basemap.originLon == null) initBasemap().then(draw);
});
on("btn-snap", "click", () => setOsnap(!state.osnap));
on("btn-zoom-in", "click", () => zoomBy(1.25));
on("btn-zoom-out", "click", () => zoomBy(0.8));
on("btn-zoom-fit", "click", fitView);
on("obj-snap", "change", e => setOsnap(e.target.checked));
on("grid-snap", "change", e => setGridSnap(e.target.checked));
on("grid-show", "change", e => { state.gridShow = e.target.checked; draw(); });
// Читаемый режим знаков ЛГР — настройка ЭКРАНА, не проекта: живёт в
// localStorage (как выбор источников данных), а не в .grado, чтобы не менять
// файл проекта и не путать соседа по хабу. Печать не затрагивается.
on("lgr-readable", "change", e => {
  state.lgrReadable = e.target.checked;
  // "1"/"0", а не "1"/"" — пустая строка неотличима от «не трогали», и
  // осознанное выключение терялось бы при следующей загрузке (дефолт ВКЛ).
  try { localStorage.setItem("grado_lgr_readable", state.lgrReadable ? "1" : "0"); } catch (_) {}
  draw();
});
// галочка должна показывать сохранённый выбор, а не дефолт разметки
(() => {
  const el = document.getElementById("lgr-readable");
  if (el) el.checked = !!state.lgrReadable;
})();
on("access-show", "change", e => {
  state.accessRadii.on = e.target.checked;
  const w = document.getElementById("access-r-wrap");
  if (w) w.style.display = e.target.checked ? "" : "none";
  draw(); persist();
});
on("access-r", "change", e => {
  state.accessRadii.r = Math.max(50, parseFloat(e.target.value) || 300);
  draw(); persist();
});
on("grid-step", "change", e => { state.gridMode = e.target.value; draw(); });
on("btn-undo", "click", undo);
on("btn-redo", "click", redo);
on("btn-clear", "click", async () => {
  if (!state.features.length) { toast("Холст уже пуст"); return; }
  const count = state.features.length;
  if (!(await uiConfirm(
    `Очистить холст и удалить ${ruCount(count, "объект", "объекта", "объектов")}? Действие можно отменить сразу после очистки.`,
    { ok: "Очистить", danger: true }))) return;
  snapshot(); state.features = []; state.selected = null; afterChange();
});
on("p-density", "change", refreshTep);
on("p-ratio", "change", refreshTep);
on("p-education-zone", "change", refreshTep);
on("p-territory-mode", "change", refreshTep);
on("p-krail", "change", refreshTep);
on("p-kba", "change", refreshTep);
on("btn-tep-editor", "click", openTepPresetEditor);
const bufferOpen = document.getElementById("btn-buffer-open");
if (bufferOpen) bufferOpen.addEventListener("click", openBufferDialog);

on("btn-buffer", "click", () => {
  const dist = document.getElementById("buf-dist").value;
  const sideEl = document.querySelector('input[name="buf-side"]:checked');
  const sides = sideEl ? sideEl.value : "both";
  generateBuffers(null, dist, sides);
});

// wire TEP radius presets
const bufDoo = document.getElementById("buf-doo-preset");
if (bufDoo) bufDoo.onclick = () => { document.getElementById("buf-dist").value = 300; document.getElementById("btn-buffer").click(); };
const bufSch = document.getElementById("buf-school-preset");
if (bufSch) bufSch.onclick = () => { document.getElementById("buf-dist").value = 500; document.getElementById("btn-buffer").click(); };

// (presets wired directly via getElementById above to avoid ID mismatch)

// «#rrggbb» из hex/rgba (rgb-часть); alpha игнорируем — прозрачность живёт
// в fillOpacity/fill_opacity отдельно
function hexOf(c) { return toHexColor(c, "#000000"); }
// эффективный стиль объекта (styleOf, экранные px) → знак в формате бэкенда
// (styles/default.json: мм листа, fill+fill_opacity). Конвенция студии:
// px = мм × MM_PX (96 dpi / 25.4 = 3.7795 — тот же множитель, что в
// tools/gen_moscow_lgr.py и в подписи масштабной линейки), поэтому мм = px / MM_PX.
// Прежде здесь стояло деление на 2, а генератор умножал ширину на 3.2 и
// штриховку на 3.75 — round-trip портил знак (1.0 мм → 3.2 px → 1.6 мм).
const MM_PX = 96 / 25.4;
function canvasStyleToBackend(st) {
  const out = {};
  if (st.fill && st.fill !== "transparent") {
    out.fill = hexOf(st.fill);
    const op = st.fillOpacity != null ? st.fillOpacity : 1;
    if (op < 1) out.fill_opacity = op;
  } else out.fill = null;
  if (st.stroke) out.stroke = hexOf(st.stroke);
  out.width_mm = Math.max(0.05, (st.width || 1) / MM_PX);
  if (st.dash && st.dash.length) out.dash_mm = st.dash.map(v => v / MM_PX);
  if (st.hatch && typeof st.hatch === "object") {
    out.hatch = { angle: st.hatch.angle ?? 45, cross: !!st.hatch.cross,
                  spacing_mm: (st.hatch.spacing_px || 9) / MM_PX,
                  color: hexOf(st.hatch.color || st.stroke || "#888888") };
  } else if (st.hatch) out.hatch = true;
  if (st.line_marker) out.line_marker = {
    shape: st.line_marker.shape, dir: st.line_marker.dir || "in",
    period_mm: (st.line_marker.period || 40) / MM_PX,
    size_mm: (st.line_marker.size || 4) / MM_PX };
  if (st.double) out.double_mm = st.double / 2;
  if (st.line_label) out.line_label = st.line_label;
  if (st.label_field) {
    out.label_field = st.label_field;
    if (st.label_font) {   // кегль/цвет/семейство подписи в PDF
      if (st.label_font.size) out.label_size_mm = st.label_font.size / 2;
      if (st.label_font.color) out.label_color = hexOf(st.label_font.color);
      if (["ui", "serif", "mono"].includes(st.label_font.family))
        out.label_font_family = st.label_font.family;
    }
  }
  return out;
}
// правка эталонного знака в библиотеке (глобальный оверрайд) → патч с ОБОИМИ
// единицами: _px читает холст (frontend_styles), _mm — рендер PDF. Без пары
// правка применилась бы только к одному из выводов (рассинхрон холст/печать).
function signOverridePatch(st) {
  const out = {};
  if (st.fill && st.fill !== "transparent") {
    out.fill = hexOf(st.fill);
    out.fill_opacity = st.fillOpacity != null ? st.fillOpacity : 1;
  } else out.fill = null;
  if (st.stroke) out.stroke = hexOf(st.stroke);
  const wpx = Math.max(0.2, st.width || 1);
  out.width_px = wpx; out.width_mm = wpx / 2;
  if (st.dash && st.dash.length) { out.dash_px = st.dash.slice(); out.dash_mm = st.dash.map(v => v / 2); }
  else { out.dash_px = null; out.dash_mm = null; }
  if (st.hatch && typeof st.hatch === "object") {
    const sp = st.hatch.spacing_px || 9;
    out.hatch = { angle: st.hatch.angle ?? 45, cross: !!st.hatch.cross,
                  spacing_px: sp, spacing_mm: sp / 2, color: hexOf(st.hatch.color || st.stroke || "#888888") };
  } else out.hatch = false;
  if (st.line_marker) {
    const pp = st.line_marker.period || 40, sz = st.line_marker.size || 4;
    out.line_marker = { shape: st.line_marker.shape, dir: st.line_marker.dir || "in",
                        period_px: pp, period_mm: pp / 2, size_px: sz, size_mm: sz / 2 };
  } else out.line_marker = null;
  if (st.line_label) out.line_label = st.line_label;
  if (st.label_field) out.label_field = st.label_field;
  return out;
}
// клоны объектов с синтетическим style_id + словарь этих знаков — для
// выпуска «как на холсте». Одинаковые эффективные стили дедуплицируются
// (много объектов одного слоя → один синтетический знак).
function canvasStyleExport() {
  const styles = {}, cache = new Map();
  let n = 0;
  const features = catVisibleFeatures().map(f => {
    const js = JSON.stringify(canvasStyleToBackend(styleOf(f)));
    let sid = cache.get(js);
    if (!sid) { sid = "canvas." + (n++); cache.set(js, sid); styles[sid] = JSON.parse(js); }
    return { ...f, style_id: sid };
  });
  return { features, styles };
}
// режим выпуска знаков: стандарт ЛГР (по коду слоя) | как на холсте
function exportStyleMode() {
  const sel = document.getElementById("export-style");
  return sel && sel.value === "canvas" ? "canvas" : "standard";
}

let downloadInProgress = false;
function projectFileName(suffix) {
  const name = document.getElementById("project-name").value.trim() || "grado-project";
  return `${slugify(name)}${suffix}`;
}
function showPreflightReport(report) {
  if (!report.errors.length && !report.warnings.length) return Promise.resolve(true);
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const rows = [
      ...report.errors.map(item => ({ ...item, level: "error" })),
      ...report.warnings.map(item => ({ ...item, level: "warning" })),
    ].map(item => {
      const ids = item.feature_ids && item.feature_ids.length
        ? `<div class="preflight-ids">Объекты: ${item.feature_ids.map(escHtml).join(", ")}${item.count > item.feature_ids.length ? ` и ещё ${item.count - item.feature_ids.length}` : ""}</div>` : "";
      return `<div class="preflight-item ${item.level}">
        <div class="preflight-mark" aria-hidden="true">${item.level === "error" ? "!" : "i"}</div>
        <div><b>${escHtml(item.title)}</b><p>${escHtml(item.detail || "")}</p>${ids}</div>
      </div>`;
    }).join("");
    const blocked = report.errors.length > 0;
    overlay.innerHTML = `<div class="modal preflight-modal" role="dialog" aria-modal="true" aria-label="Проверка проекта перед выпуском">
      <div class="modal-head"><span>Проверка перед выпуском</span></div>
      <div class="modal-body">
        <div class="preflight-summary">Готово объектов: <b>${report.summary.exportable}</b> из ${report.summary.total}${report.summary.annotations ? ` · аннотаций на холсте: ${report.summary.annotations}` : ""}</div>
        <div class="preflight-list">${rows}</div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button class="preflight-cancel">${blocked ? "Вернуться к проекту" : "Отмена"}</button>
        ${blocked ? "" : '<button class="preflight-continue primary">Продолжить выпуск</button>'}
      </div></div>`;
    document.body.appendChild(overlay);
    const done = value => { overlay.remove(); resolve(value); };
    overlay.querySelector(".preflight-cancel").onclick = () => done(false);
    overlay.querySelector(".preflight-continue")?.addEventListener("click", () => done(true));
    overlay.onclick = event => { if (event.target === overlay) done(false); };
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(false); });
    overlay.querySelector(blocked ? ".preflight-cancel" : ".preflight-continue").focus();
  });
}
async function download(url, suffix) {
  if (downloadInProgress) { toast("Дождитесь завершения текущего файла", "warn"); return; }
  if (url !== "/api/grado" && !state.features.length) {
    toast("Проект пуст — сначала добавьте объекты", "warn"); return;
  }
  // «как на холсте» — только для PDF (печать/альбом): DXF и .grado —
  // обменные форматы, там осмысленные стандартные знаки важнее (QGIS/CAD
  // не знают наши инлайн-стили)
  const canvasMode = exportStyleMode() === "canvas" &&
                     (url === "/api/print" || url === "/api/album");
  // выпуск (печать/DXF/альбом) уважает скрытые категории — как холст и ТЭП
  // (правка юзера); .grado — это ДАННЫЕ проекта, сохраняется полным (cats_off
  // в fmt восстановит скрытое состояние при открытии)
  let features = url === "/api/grado" ? state.features : catVisibleFeatures();
  let canvasStyles = null;
  if (canvasMode) { const ex = canvasStyleExport(); features = ex.features; canvasStyles = ex.styles; }
  const payload = { features, params: params(),
                    basemap: basemap.on,  // подложка включена → ортофото в альбоме и на печити
                    basemapSource: basemap.source,  // osm | sat — какую именно вставить
                    name: document.getElementById("project-name").value,
                    layers: userLayersManifest(),
                    projectStyles: state.projectStyles || {},
                    projectCustomKinds: state.projectCustomKinds || [],
    variants: state.variants || [],
    accessRadii: state.accessRadii,
                    undo_stack: historyStackToStrings(state.undo),
                    redo_stack: historyStackToStrings(state.redo),
                    albumConfig: state.albumConfig || null,
                    studioState: collectProjectSettings() };
  if (canvasStyles) payload.canvasStyles = canvasStyles;
  const filename = projectFileName(suffix);
  const action = url === "/api/grado" ? "Сохраняю проект…" : "Собираю файл…";
  const exportButtons = ["btn-album", "btn-grado", "btn-dxf", "btn-print"]
    .map(id => document.getElementById(id)).filter(Boolean);
  downloadInProgress = true;
  exportButtons.forEach(button => { button.disabled = true; });
  toast("Проверяю проект перед выпуском…");
  try {
    const target = url.replace("/api/", "");
    const checkResponse = await fetch("/api/preflight", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features, layers: payload.layers, target }),
    });
    if (!checkResponse.ok) throw new Error("не удалось проверить проект");
    const report = await checkResponse.json();
    if (!(await showPreflightReport(report))) {
      if (report.errors.length) toast("Исправьте замечания перед выпуском", "warn");
      else toast("Выпуск отменён");
      return;
    }
    toast(action);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    if (suffix.endsWith(".pdf")) window.open(objectUrl, "_blank");
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    toast(url === "/api/grado" ? `Проект сохранён: ${filename}` : `Файл готов: ${filename}`);
  } catch (error) {
    toast("Не удалось собрать файл: " + String(error.message || error).slice(0, 180), "error");
  } finally {
    downloadInProgress = false;
    exportButtons.forEach(button => { button.disabled = false; });
  }
}
on("export-style", "change", () => { persist(); toast(exportStyleMode() === "canvas"
  ? "Печать и альбом — знаками как на холсте" : "Печать и альбом — по стандарту ЛГР"); });
on("btn-album", "click", () => download("/api/album", "-album.pdf"));
on("btn-album-config", "click", openAlbumConfig);
on("btn-grado", "click", () => download(
  "/api/grado", window.GRADO_STATIC ? ".grado-web.json" : ".grado"));
on("btn-dxf", "click", () => download("/api/dxf", ".dxf"));
on("btn-print", "click", () => download("/api/print", "-print.pdf"));

function hasProjectContent() {
  return state.features.length > 0 || LAYERS_V2.some(layer => layer.user_created) ||
    Object.keys(state.projectStyles || {}).length > 0 ||
    (state.projectCustomKinds || []).length > 0 || (state.variants || []).length > 0;
}
async function checkpointBeforeReplace() {
  if (window.Collab && window.Collab.active) return true;
  clearTimeout(autosaveTimer);
  try {
    await saveStateNow(collectState(), { checkpoint: true });
    return true;
  } catch (error) {
    toast("Не удалось сохранить текущий проект. Замена отменена.", "error");
    return false;
  }
}
function syncProjectControls() {
  const access = state.accessRadii || { on: false, r: 300 };
  const show = document.getElementById("access-show");
  const radius = document.getElementById("access-r");
  const wrap = document.getElementById("access-r-wrap");
  if (show) show.checked = !!access.on;
  if (radius) radius.value = access.r || 300;
  if (wrap) wrap.style.display = access.on ? "" : "none";
}

async function newProject() {
  if (window.Collab && window.Collab.active) {
    toast("Новый общий проект создаётся из списка совместной работы", "warn"); return;
  }
  if (hasProjectContent() && !(await uiConfirm(
    `Текущий проект содержит ${ruCount(state.features.length, "объект", "объекта", "объектов")}. Его копия останется в автосохранениях.`,
    { title: "Создать новый проект?", ok: "Новый проект" }))) return;
  if (!(await checkpointBeforeReplace())) return;
  resetProjectState();
  setTool("select");
  afterChange();
  toast("Создан новый пустой проект");
}
on("btn-new-project", "click", newProject);

// открытие проекта .grado (round-trip с QGIS)
on("btn-open", "click", () => document.getElementById("grado-file").click());
on("grado-file", "change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    toast("Файл проекта больше 256 МБ — разделите проект или удалите лишние данные", "error");
    return;
  }
  try {
    toast("Проверяю файл проекта…");
    const r = await fetch("/api/open-grado", { method: "POST",
      headers: { "Content-Type": "application/octet-stream" }, body: file });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (hasProjectContent() && !(await uiConfirm(
      `Открыть «${data.name || file.name}» и заменить текущий проект? Текущее состояние останется в автосохранениях.`,
      { ok: "Открыть" }))) return;
    if (!(await checkpointBeforeReplace())) return;
    loadProjectData(data);
  } catch (err) {
    toast("Не удалось открыть проект: " + String(err).slice(0, 200), "error");
  }
});

function loadProjectData(data) {
  if (!data || !Array.isArray(data.features)) return;
  const settings = data.studioState && typeof data.studioState === "object"
    ? data.studioState : {};
  const features = data.features.map((feature, index) =>
    ({ ...feature, id: index + 1 }));
  const restored = {
    ...settings,
    name: data.name || settings.name || "Проект",
    features,
    nextId: features.length + 1,
    userLayers: settings.userLayers || data.userLayers || [],
    projectStyles: settings.projectStyles || data.projectStyles || {},
    projectCustomKinds: settings.projectCustomKinds || data.projectCustomKinds || [],
    undo: Array.isArray(data.undo_stack) ? data.undo_stack : [],
    redo: Array.isArray(data.redo_stack) ? data.redo_stack : [],
  };
  resetProjectState(restored.name);
  if (!applyRestoredState(restored)) throw new Error("invalid project state");
  const skipped = lastRestoreSkipped;
  syncProjectControls();
  setTool("select", { keepLayer: true });
  afterChange();
  fitView();
  toast(skipped
    ? `Открыт проект: ${ruCount(state.features.length, "объект", "объекта", "объектов")}; ${ruCount(skipped, "повреждённый объект пропущен", "повреждённых объекта пропущено", "повреждённых объектов пропущено")}`
    : `Открыт проект: ${ruCount(state.features.length, "объект", "объекта", "объектов")}`,
    skipped ? "warn" : "ok");
}

// мост браузерного расширения: опрос входящих выгрузок
let toastTimer = null;
// kind: ok (зелёный) | warn (янтарный) | error (красный, дольше висит)
function toast(msg, kind = "ok") {
  const el = document.getElementById("st-toast");
  el.textContent = msg;
  el.className = "toast-" + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ""; el.className = ""; },
                          kind === "error" ? 8000 : 5000);
}
// ---------- глобальный индикатор занятости (загрузки данных) ----------
// Тонкая полоса сверху окна + подпись: показывается на ЛЮБОЙ сетевой загрузке,
// чтобы всегда было видно «процесс идёт» (правка юзера). Счётчик ссылок —
// параллельные загрузки не гасят полосу раньше времени. По умолчанию полоса
// «бегущая» (indeterminate); при известном размере (setBusyProgress) — реальный %.
let _busyCount = 0, _busyBar = null;
function _ensureBusyBar() {
  if (_busyBar) return _busyBar;
  const bar = document.createElement("div");
  bar.id = "global-busy";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = `<div class="gb-track"><div class="gb-fill"></div></div><div class="gb-label"></div>`;
  document.body.appendChild(bar);
  _busyBar = bar;
  return bar;
}
function beginBusy(label) {
  _busyCount++;
  const bar = _ensureBusyBar();
  if (label) bar.querySelector(".gb-label").textContent = label;
  bar.classList.remove("determinate");
  bar.classList.add("on");
  bar.querySelector(".gb-fill").style.width = "";
  let ended = false;
  return function done() {
    if (ended) return;
    ended = true;
    _busyCount = Math.max(0, _busyCount - 1);
    if (_busyCount === 0 && _busyBar) {
      _busyBar.classList.remove("on", "determinate");
      _busyBar.querySelector(".gb-label").textContent = "";
      _busyBar.querySelector(".gb-fill").style.width = "";
    }
  };
}
// перевод полосы в режим реального прогресса 0..1 (когда известен размер)
function setBusyProgress(frac, label) {
  const bar = _ensureBusyBar();
  bar.classList.add("determinate");
  bar.querySelector(".gb-fill").style.width =
    Math.max(2, Math.min(100, Math.round(frac * 100))) + "%";
  if (label != null) bar.querySelector(".gb-label").textContent = label;
}
// fetch JSON с реальным прогрессом байтов (если сервер отдал Content-Length),
// иначе просто indeterminate — onProgress(frac|null). Возвращает разобранный JSON.
async function fetchJsonProgress(url, opts, onProgress) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = await r.text();
    try { msg = JSON.parse(msg).error || msg; } catch (e) {}
    const e = new Error(msg || r.status); e.status = r.status; throw e;
  }
  const total = +(r.headers.get("Content-Length") || 0);
  if (!r.body || !total) {           // нет потока/размера — без процентов
    if (onProgress) onProgress(null);
    return await r.json();
  }
  const reader = r.body.getReader();
  const chunks = []; let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    if (onProgress) onProgress(received / total);
  }
  let at = 0; const merged = new Uint8Array(received);
  for (const c of chunks) { merged.set(c, at); at += c.length; }
  return JSON.parse(new TextDecoder("utf-8").decode(merged));
}

on("btn-data", "click", openDataFetch);

// ---------- демо-наполнение ----------
on("btn-demo", "click", () => {
  snapshot();
  const B = [[0, 0], [650, 0], [650, 180], [520, 180], [520, 420], [300, 420],
             [300, 560], [60, 560], [60, 300], [0, 300]];
  state.features = [];
  state.nextId = 1;
  // L2b: пресетов нет — демо само заводит нужные слои (создать-или-переиспользовать
  // слой этого вида), объекты уходят в них по явному layer_id
  const demoCache = {};
  const demoLayer = (kind) => {
    if (demoCache[kind]) return demoCache[kind];
    let L = LAYERS_V2.find(l => l.kind === kind && !l.import_only && !l.annotation);
    if (!L) L = createUserLayer({ kind, title: BASE_KIND_BY_KIND[kind].label });
    return (demoCache[kind] = L);
  };
  const add = (kind, geom, props = {}) => {
    const L = demoLayer(kind);
    state.features.push(upgradeFeature(
      { id: state.nextId++, layer_id: L.id, kind, props: { ...L.defaults(), ...props }, ...geom }));
  };
  add("boundary", { ring: B });
  add("zone", { ring: [[60, 180], [520, 180], [520, 420], [60, 420]] }, { zone_title: "Ж-1" });
  // вершина [60,180] делает границу с Ж-1 повершинно общей (покрытие)
  add("zone", { ring: [[0, 0], [520, 0], [520, 180], [60, 180], [0, 180]] }, { zone_title: "О-1" });
  add("restrict", { ring: [[520, 0], [650, 0], [650, 180], [520, 180]] });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++)
    add("building", { ring: [[90 + c * 82, 215 + r * 62], [120 + c * 82, 215 + r * 62],
                             [120 + c * 82, 232 + r * 62], [90 + c * 82, 232 + r * 62]] },
        { floors: [9, 12, 14, 12, 9][c] });
  add("public", { ring: [[90, 40], [220, 40], [220, 130], [90, 130]] });
  add("redline", { line: [[-30, 190], [400, 190], [400, 590]] }, { radius: 60 });
  add("social", { point: [470, 350] });
  state.selected = null;
  const bd = demoCache["boundary"];
  if (bd) state.activeLayerId = bd.id;   // после демо можно сразу чертить
  renderLayers();                        // созданные слои — в панель
  afterChange();
  fitView();
});

// ---------- старт ----------
const RESTORED_GEOMETRY_TYPES = new Set(["point", "polyline", "polygon", "arc", "circle"]);
let lastRestoreSkipped = 0;
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isSafeProjectKey(value, pattern) {
  return typeof value === "string" && pattern.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}
function isSafeDictionaryKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && !["__proto__", "prototype", "constructor"].includes(value);
}
function isFinitePoint(point) {
  return Array.isArray(point) && point.length >= 2
    && isProjectCoordinate(point[0]) && isProjectCoordinate(point[1]);
}
function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}
function hasValidGeometry(feature) {
  if (isFinitePoint(feature.point)) return true;
  if (Array.isArray(feature.line) && feature.line.length >= 2 && feature.line.every(isFinitePoint)) return true;
  if (Array.isArray(feature.ring) && feature.ring.length >= 3 && feature.ring.every(isFinitePoint)) return true;
  const circle = feature.circle;
  if (isRecord(circle) && ["cx", "cy", "r"].every(name => isProjectCoordinate(circle[name]))
      && Number(circle.r) > 0) return true;
  const arc = feature.arc;
  if (isRecord(arc) && ["cx", "cy", "r", "a0", "sweep"].every(name => isProjectCoordinate(arc[name]))
      && Number(arc.r) > 0) return true;
  return false;
}
function normalizeFeatureList(value) {
  if (!Array.isArray(value)) return [];
  const features = value.filter(feature => isRecord(feature) && hasValidGeometry(feature))
    .map(feature => {
      const clean = { ...feature, props: isRecord(feature.props) ? feature.props : {} };
      if (!isSafeDictionaryKey(clean.style_id)) delete clean.style_id;
      if (!isSafeProjectKey(clean.layer_id, /^[a-z0-9][a-z0-9._-]{0,127}$/i)) delete clean.layer_id;
      if (!isRecord(clean.fmt)) delete clean.fmt;
      return clean;
    });
  const usedIds = new Set();
  let nextId = 1;
  for (const feature of features) {
    const id = Number(feature.id);
    if (Number.isSafeInteger(id) && id > 0 && !usedIds.has(id)) {
      feature.id = id;
      usedIds.add(id);
      continue;
    }
    while (usedIds.has(nextId)) nextId += 1;
    feature.id = nextId;
    usedIds.add(nextId);
  }
  return features;
}
function safeHistoryStack(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(snapshot => {
    if (typeof snapshot !== "string") return [];
    try {
      const parsed = JSON.parse(snapshot);
      if (Array.isArray(parsed))
        return [JSON.stringify(normalizeFeatureList(parsed))];
      if (!isRecord(parsed) || parsed.history_version !== 2 || !Array.isArray(parsed.features))
        return [];
      return [JSON.stringify({ ...parsed, features: normalizeFeatureList(parsed.features) })];
    } catch (error) { return []; }
  });
}
function normalizeRestoredState(payload) {
  let restored = payload;
  if (isRecord(restored) && isRecord(restored.state)) restored = restored.state;
  if (!isRecord(restored) || !Array.isArray(restored.features)) return null;

  const features = normalizeFeatureList(restored.features);
  const userLayers = Array.isArray(restored.userLayers) ? restored.userLayers.filter(spec =>
    isRecord(spec) && isSafeProjectKey(spec.layer_id, /^[a-z0-9][a-z0-9._-]{0,127}$/i)
      && typeof spec.title === "string"
      && typeof (spec.studio_code || spec.code) === "string").map(spec => {
        const clean = { ...spec };
        if (!isSafeDictionaryKey(clean.style_id)) delete clean.style_id;
        if (Array.isArray(clean.fields)) clean.fields = clean.fields.filter(isRecord);
        return clean;
      }) : [];
  const projectCustomKinds = Array.isArray(restored.projectCustomKinds)
    ? restored.projectCustomKinds.filter(spec => isRecord(spec)
      && isSafeProjectKey(spec.kind, /^[a-z][a-z0-9_]{0,63}$/)
      && typeof spec.semantic_class === "string" && spec.semantic_class.startsWith("custom.")
      && RESTORED_GEOMETRY_TYPES.has(spec.geometry_type)
      && isSafeDictionaryKey(spec.style_id) && typeof spec.label === "string")
    : [];
  const projectStyles = Object.create(null);
  if (isRecord(restored.projectStyles)) {
    for (const [id, style] of Object.entries(restored.projectStyles))
      if (isSafeDictionaryKey(id) && isRecord(style)) projectStyles[id] = style;
  }
  const variants = Array.isArray(restored.variants) ? restored.variants.flatMap((variant, index) => {
    if (!isRecord(variant) || !Array.isArray(variant.features)) return [];
    const variantFeatures = normalizeFeatureList(variant.features);
    return [{ ...variant,
      id: isSafeDictionaryKey(variant.id) ? variant.id : `restored-${index + 1}`,
      name: typeof variant.name === "string" ? variant.name : `Вариант ${index + 1}`,
      features: variantFeatures,
      params: isRecord(variant.params) ? variant.params : {},
      tepSummary: isRecord(variant.tepSummary) ? variant.tepSummary : null,
    }];
  }) : [];
  const albumSheetIds = new Set(["title", "location", "base", "apo", "tep", "ortho", "photo", "parking", "greenery"]);
  const rawAlbum = isRecord(restored.albumConfig) ? restored.albumConfig : {};
  const albumSheets = Array.isArray(rawAlbum.sheets)
    ? [...new Set(rawAlbum.sheets.filter(sheet => albumSheetIds.has(sheet)))] : [];
  const albumConfig = {
    sheets: albumSheets.length ? albumSheets : [...DEFAULT_ALBUM_CONFIG.sheets],
    title: {
      org: typeof rawAlbum.title?.org === "string" ? rawAlbum.title.org : DEFAULT_ALBUM_CONFIG.title.org,
      city_year: typeof rawAlbum.title?.city_year === "string"
        ? rawAlbum.title.city_year : DEFAULT_ALBUM_CONFIG.title.city_year,
    },
  };
  const radius = Number(restored.accessRadii?.r);
  const accessRadii = {
    on: !!restored.accessRadii?.on,
    r: Number.isFinite(radius) && radius >= 1 && radius <= 100000 ? radius : 300,
  };
  const skipped = restored.features.length - features.length;
  if (skipped) console.warn(`Пропущено повреждённых объектов: ${skipped}`);
  const normalized = {
    ...restored,
    features,
    userLayers,
    projectCustomKinds,
    projectStyles,
    variants,
    albumConfig,
    accessRadii,
    osnap: restored.osnap !== false,
    gridSnap: restored.gridSnap !== false,
    name: typeof restored.name === "string" ? restored.name.slice(0, 240) : "Проект",
    density: numberInRange(restored.density, 0, 1000, 25),
    ratio: numberInRange(restored.ratio, 0, 100, 80),
    educationZone: [1, 2].includes(Number(restored.educationZone)) ? Number(restored.educationZone) : 1,
    territoryMode: [1, 2].includes(Number(restored.territoryMode)) ? Number(restored.territoryMode) : 1,
    krail: numberInRange(restored.krail, 0, 10, 1),
    kba: numberInRange(restored.kba, 0, 10, 0.5),
    basemapSource: ["osm", "sat", "s2"].includes(restored.basemapSource)
      ? restored.basemapSource : "osm",
    _skippedFeatures: skipped,
    nextId: Number.isSafeInteger(Number(restored.nextId)) && Number(restored.nextId) > 0
      ? Number(restored.nextId) : 1,
  };
  // Частичные payload (совместная работа, история) не должны стирать личную
  // историю. Полные автосейвы передают эти ключи явно и проходят валидацию.
  if (Array.isArray(restored.undo)) normalized.undo = safeHistoryStack(restored.undo);
  else delete normalized.undo;
  if (Array.isArray(restored.redo)) normalized.redo = safeHistoryStack(restored.redo);
  else delete normalized.redo;
  return normalized;
}

function applyRestoredState(d) {
  // Автосейв v1 хранится в проверяемой оболочке; старые снимки остаются
  // сырым состоянием и по-прежнему открываются без миграции на диске.
  d = normalizeRestoredState(d);
  lastRestoreSkipped = 0;
  if (!d) return false;
  lastRestoreSkipped = d._skippedFeatures || 0;
  // Свои типы нужны ДО восстановления слоёв: иначе слой пользовательского
  // типа неизвестен индексам и молча пропускается при открытии .grado.
  if (Array.isArray(d.projectCustomKinds)) {
    state.projectCustomKinds = d.projectCustomKinds;
    rebuildKinds();
  }
  // пользовательские слои — ДО остального восстановления: layersVisible/
  // layerOrder/layerFmt/activeLayerId ссылаются на их id по значению
  if (Array.isArray(d.userLayers)) {
    for (const spec of d.userLayers) {
      if (LAYER_BY_ID[spec.layer_id]) {
        const existing = LAYER_BY_ID[spec.layer_id];
        if (spec.import_only) {
          existing.import_only = true;
          existing.source_kind = spec.source_kind || existing.source_kind || null;
          existing.source_code = spec.source_code || existing.source_code || null;
          existing.source_name = spec.source_name || existing.source_name || spec.title;
        }
        if (Array.isArray(spec.fields) && spec.fields.length)
          existing.fields = spec.fields.filter(isRecord);
        continue;  // уже есть (встроенный или повторный restore)
      }
      let created = null;
      const semanticCode = spec.studio_code || spec.code;
      if (spec.import_only) {
        created = importedLayerFromSpec({
          id: spec.layer_id,
          title: spec.title,
          kind: spec.kind,
          code: semanticCode,
          geometry_type: spec.geometry_type,
          style_id: spec.style_id,
          stage: spec.stage,
          source_kind: spec.source_kind,
          source_code: spec.source_code,
          source_name: spec.source_name,
        });
        LAYERS_V2.push(created);
        LAYER_BY_ID[created.id] = created;
      } else if (CODE_TO_GEOM[semanticCode]) {          // обычный (generic) слой
        created = createGenericLayer({ title: spec.title,
          geometry_type: CODE_TO_GEOM[semanticCode], styleId: spec.style_id,
          id: spec.layer_id });
      } else {
        const kind = KIND_BY_SEMANTIC_CLASS[semanticCode];
        if (!kind) continue;  // неизвестный класс из будущей версии — не роняем
        created = createUserLayer({ kind, title: spec.title,
          styleId: spec.style_id, id: spec.layer_id });
      }
      if (created && Array.isArray(spec.fields)) created.fields = spec.fields.filter(isRecord);
    }
  }
  state.features = (d.features || []).map(feature => upgradeFeature(feature));  // legacy kind → слой v2
  // ограничиваем восстанавливаемую историю (старые автосейвы больших выгрузок
  // держали до 100 снимков всего проекта ≈ гигабайты в памяти)
  if (Array.isArray(d.undo)) state.undo = historyStackFromStrings(d.undo.slice(-undoDepth()));
  if (Array.isArray(d.redo)) state.redo = historyStackFromStrings(d.redo.slice(-undoDepth()));
  // L2b-миграция: старые проекты ссылались на удалённые пресет-слои
  // (project.territory.boundary и т.п.). Осиротевшие объекты переселяем в
  // воссозданные слои их вида, иначе они молча исчезли бы с холста.
  const migrated = {};
  for (const f of state.features) {
    if (layerOf(f)) continue;                       // слой резолвится (приёмник/пользовательский) — ок
    const base = BASE_KIND_BY_KIND[f.kind];
    if (!base) continue;                            // неизвестный вид — оставляем как есть, не роняем
    let L = migrated[f.kind] ||
            LAYERS_V2.find(l => l.kind === f.kind && l.user_created);
    if (!L) L = createUserLayer({ kind: f.kind, title: base.label });
    migrated[f.kind] = L;
    f.layer_id = L.id;
  }
  state.nextId = d.nextId || 1;
  syncNextId();
  if (d.layerTitles) {
    for (const [id, title] of Object.entries(d.layerTitles))
      if (LAYER_BY_ID[id] && typeof title === "string") LAYER_BY_ID[id].title = title;
  }
  if (d.layersVisible) {
    for (const [id, vis] of Object.entries(d.layersVisible))
      if (LAYER_BY_ID[id]) LAYER_BY_ID[id].visible = !!vis;
  } else if (d.hidden) {
    // сохранение старого формата: hidden было по kind
    for (const [kind, hid] of Object.entries(d.hidden))
      if (LAYER_BY_KIND[kind]) LAYER_BY_KIND[kind].visible = !hid;
  }
  if (Array.isArray(d.layerOrder)) {
    // восстановить порядок отрисовки; неизвестные (добавленные позже) — в конец
    const pos = new Map(d.layerOrder.map((id, i) => [id, i]));
    LAYERS_V2.sort((a, b) =>
      (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  }
  if (d.layerFmt) {
    for (const [id, fmt] of Object.entries(d.layerFmt))
      if (LAYER_BY_ID[id] && isRecord(fmt)) LAYER_BY_ID[id].fmt = fmt;
  }
  if (d.layerLocked) {
    for (const [id, locked] of Object.entries(d.layerLocked))
      if (LAYER_BY_ID[id] && locked) LAYER_BY_ID[id].locked = true;
  }
  if (d.layerRules) {
    for (const [id, rules] of Object.entries(d.layerRules))
      if (LAYER_BY_ID[id] && Array.isArray(rules) && rules.length)
        LAYER_BY_ID[id].rules = rules.filter(isRecord);
  }
  if (d.layerFields) {
    for (const [id, flds] of Object.entries(d.layerFields))
      if (LAYER_BY_ID[id] && Array.isArray(flds)) LAYER_BY_ID[id].fields = flds.filter(isRecord);
  }
  if (d.activeLayerId && LAYER_BY_ID[d.activeLayerId])
    state.activeLayerId = d.activeLayerId;
  else {
    // сохранённый активный слой удалён (старый пресет) — берём первый рисуемый
    const fb = LAYERS_V2.find(l => !l.annotation && !l.import_only);
    state.activeLayerId = fb ? fb.id : null;
  }
  if (Array.isArray(d.sources)) state.sources = d.sources.filter(isRecord);
  if (d.basemapSource && d.basemapSource !== basemap.source) {
    setBasemapSource(d.basemapSource);
    const sel = document.getElementById("basemap-source");
    if (sel) sel.value = d.basemapSource;
  }
  if (d.exportStyle) {
    const sel = document.getElementById("export-style");
    if (sel) sel.value = d.exportStyle === "canvas" ? "canvas" : "standard";
  }
  if (isRecord(d.projectStyles)) {
    state.projectStyles = d.projectStyles;
  }
  if (Array.isArray(d.variants)) state.variants = d.variants.filter(isRecord);
  if (isRecord(d.accessRadii)) state.accessRadii = d.accessRadii;
  if (isRecord(d.albumConfig)) {
    state.albumConfig = d.albumConfig;
  }
  state.osnap = d.osnap !== false;
  state.gridSnap = d.gridSnap !== false;
  const snapButton = document.getElementById("btn-snap");
  if (snapButton) {
    snapButton.classList.toggle("active", state.osnap);
    snapButton.setAttribute("aria-pressed", String(state.osnap));
  }
  const objectSnap = document.getElementById("obj-snap");
  if (objectSnap) objectSnap.checked = state.osnap;
  const gridSnap = document.getElementById("grid-snap");
  if (gridSnap) gridSnap.checked = state.gridSnap;
  updateSnapStatus();
  document.getElementById("project-name").value = d.name;
  document.getElementById("p-density").value = d.density;
  document.getElementById("p-ratio").value = d.ratio;
  document.getElementById("p-education-zone").value = d.educationZone;
  document.getElementById("p-territory-mode").value = d.territoryMode;
  document.getElementById("p-krail").value = d.krail;
  document.getElementById("p-kba").value = d.kba;
  syncHistoryControls();
  return true;
}
// применить состояние, пришедшее извне (веб-синхронизация): пересобрать
// сцену/панели, сохранив вид. В отличие от restore() — без fitView (у
// каждого свой вид) и без записи (иначе эхо-цикл персиста).
window.applyRestoredState = applyRestoredState;
window.afterExternalApply = function () {
  state._ix = null; state._snapIndex = null;
  draw(); renderProps(); renderLayers(); renderSources(); refreshTep();
  updateLayerStatus();
};
(function restore() {
  // веб-режим совместной работы: состояние приходит с сервера (collab.js),
  // локальные localStorage/autosave не восстанавливаем (это чужой/старый проект)
  if (document.body.classList.contains("hub-mode")) return;
  if (!window.GRADO_STATIC) {
    try {
      const raw = localStorage.getItem("grado_studio_v1");
      if (raw && applyRestoredState(JSON.parse(raw))) {
        if (lastRestoreSkipped) queueMicrotask(() => toast(
          `${ruCount(lastRestoreSkipped, "Повреждённый объект пропущен", "Повреждённых объекта пропущено", "Повреждённых объектов пропущено")} при восстановлении`, "warn"));
        return;
      }
    } catch (e) { /* повреждённое сохранение игнорируем, пробуем файловый автосейв ниже */ }
  }
  // localStorage пуст (новый браузер/профиль, приватный режим, чистка данных
  // сайта) — пробуем резервную копию на диске сервера
  applyPendingProjectName();
  fetch("/api/autosave").then(r => r.ok ? r.json() : null).then(d => {
    // Отметка версии, поверх которой эта вкладка будет писать (см. autosaveBase)
    if (d && d.saved_at) autosaveBase = d.saved_at;
    const saved = d && d.state && typeof d.state === "object" ? d.state : d;
    if (saved && Array.isArray(saved.features) && applyRestoredState(d)) {
      draw(); renderProps(); renderLayers(); renderSources(); refreshTep(); fitView();
      toast(lastRestoreSkipped
        ? `Восстановлено из автосохранения; ${ruCount(lastRestoreSkipped, "повреждённый объект пропущен", "повреждённых объекта пропущено", "повреждённых объектов пропущено")}`
        : "Восстановлено из файлового автосохранения", lastRestoreSkipped ? "warn" : "ok");
    }
    // Небольшой синхронный ключ переживает закрытие вкладки раньше debounce.
    // После применения полного снимка он имеет приоритет и сразу сливается в
    // обычный IndexedDB-автосейв.
    if (applyPendingProjectName()) persist(0);
  }).catch(() => {});
})();

// Авто-открытие .grado при запуске сервера с путём к файлу (packaging, двойной клик на проекте, file assoc).
// Выполняется после возможного restore из local/autosave; явный .grado arg имеет приоритет.
fetch("/api/initial-grado").then(r => r.ok ? r.json() : null).then(data => {
  if (data && Array.isArray(data.features) && data.features.length > 0) {
    loadProjectData(data);
  }
}).catch(() => {});
// Название — часть проекта, поэтому сохраняем его так же надёжно, как
// геометрию. `change` срабатывает только после потери фокуса: пользователь,
// который переименовал проект и сразу обновил/закрыл вкладку, терял ввод.
// persist уже имеет debounce, поэтому `input` не создаёт лишних записей.
on("project-name", "input", event => {
  rememberPendingProjectName(event.target.value);
  persist(250);
});
window.studio = { state, addFeature, refreshTep, fitView, snapPoint, gridStep,
                  layerOf, styleOf, layerStyle, upgradeFeature, LAYERS_V2, STYLES_V2,
                  setTool, setActiveLayer, quickLayerByKind, activeLayer,
                  reorderLayer, openLayerMenu, openAttributeTable, openLayerStyle,
                  zoomToLayer, renderLayers };
on("btn-refresh-src", "click", fetchSources);
on("btn-shortcuts", "click", openShortcuts);
on("btn-new-layer", "click", openNewLayerDialog);
on("start-boundary", "click", startBoundaryFlow);
on("start-draw", "click", () => {
  const current = activeLayer();
  const layer = isDrawableLayer(current) ? current
    : LAYERS_V2.find(item => item.user_created && isDrawableLayer(item));
  if (!layer) return startBoundaryFlow();
  startGuideDismissed = true;
  setActiveLayer(layer.id);
  setTool(naturalToolFor(layer), { keepLayer: true });
  document.getElementById("start-guide")?.setAttribute("hidden", "");
  document.getElementById("cv")?.focus();
  toast(`Слой «${layer.title}» активен. Поставьте первую точку на холсте.`);
});
on("start-unlock", "click", () => {
  const layer = LAYERS_V2.find(item => item.user_created && !item.import_only && !item.annotation && item.locked);
  if (!layer) return updateStartExperience();
  toggleLayerLock(layer);
  setActiveLayer(layer.id);
  startGuideDismissed = true;
  setTool(naturalToolFor(layer), { keepLayer: true });
  document.getElementById("start-guide")?.setAttribute("hidden", "");
  document.getElementById("cv")?.focus();
  toast(`Слой «${layer.title}» разблокирован. Поставьте первую точку на холсте.`);
});
on("start-demo", "click", () => {
  document.getElementById("btn-demo")?.click();
  if (window.matchMedia("(max-width: 900px)").matches && !document.body.classList.contains("panel-hidden")) {
    window.setTimeout(() => document.getElementById("btn-panel-visibility")?.click(), 60);
  }
});
on("btn-style-lib", "click", openStyleLibrary);
on("btn-project-styles", "click", openProjectStyles);
on("btn-recover", "click", openAutosaveRecovery);
on("btn-manage-kinds", "click", openManageKinds);
on("btn-variants", "click", openVariants);
// переключатель темы (canvas-theme.js): смена темы → перечитать палитру
// холста и перерисовать. Тема на <html> уже выставлена до загрузки app.js.
on("btn-theme", "click", () => { if (window.toggleTheme) window.toggleTheme(); });
window.onThemeChange = () => { draw(); renderLayers(); };
setTool("select");
updateSnapStatus();
syncHistoryControls();
renderLayers();
renderProps();
renderSources();
requestAnimationFrame(resize);
refreshTep();
initStyles();
fetchSources();
loadStyleOverrides();
initCollapsiblePanel();
initPanelResizer();
// синхронизировать UI радиусов доступности с восстановленным состоянием
{ const c = document.getElementById("access-show"), r = document.getElementById("access-r"),
      w = document.getElementById("access-r-wrap"), a = state.accessRadii || { on: false, r: 300 };
  if (c) c.checked = !!a.on; if (r) r.value = a.r || 300; if (w) w.style.display = a.on ? "" : "none"; }
// версия — в подсказке логотипа (для связи с поддержкой), не в статус-строке
{ const lg = document.getElementById("logo"); if (lg) lg.title = `ГРАДО Студия · v${VERSION}`; }

function initPanelResizer() {
  const resizer = document.getElementById('panel-resizer');
  const panel = document.getElementById('panel');
  if (!resizer || !panel) return;
  const toolbar = document.getElementById('toolbar');
  const layersPanel = document.getElementById('layers-panel');
  const MIN_PANEL_WIDTH = 300;
  const MAX_PANEL_WIDTH = 640;
  const MIN_STAGE_WIDTH = 480;
  let preferredWidth = 312;
  // Restore the user's preferred desktop width. The effective width is
  // clamped separately, so a temporarily narrow window does not destroy the
  // preference and a wider window can restore it later.
  try {
    const saved = localStorage.getItem('grado_panel_width');
    if (saved) preferredWidth = parseInt(saved, 10) || preferredWidth;
  } catch (e) {}

  const effectiveMaxWidth = () => {
    const railWidth = toolbar?.offsetWidth || 76;
    const layersWidth = layersPanel && getComputedStyle(layersPanel).visibility !== 'hidden'
      ? layersPanel.offsetWidth : 0;
    const available = window.innerWidth - railWidth - layersWidth - resizer.offsetWidth - MIN_STAGE_WIDTH;
    const viewportShare = Math.floor(window.innerWidth * 0.48);
    return Math.max(MIN_PANEL_WIDTH,
      Math.min(MAX_PANEL_WIDTH, viewportShare, Math.max(MIN_PANEL_WIDTH, available)));
  };
  const setWidth = (width, remember = false) => {
    const maxWidth = effectiveMaxWidth();
    const value = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, Math.round(width)));
    if (remember) preferredWidth = value;
    panel.style.flexBasis = value + 'px';
    resizer.setAttribute('aria-valuemax', String(maxWidth));
    resizer.setAttribute('aria-valuenow', String(value));
    resizer.setAttribute('aria-valuetext', `${value} пикселей`);
    resize();
    return value;
  };
  setWidth(preferredWidth);
  let startX = 0, startW = 0;
  resizer.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('panel-resizing');
    const pointerId = e.pointerId;
    const move = ev => {
      const dx = ev.clientX - startX;
      // panel on the right: drag resizer right (dx>0) → narrower panel
      setWidth(startW - dx, true);
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', finish);
      resizer.removeEventListener('pointercancel', finish);
      resizer.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('blur', finish);
      if (resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
      document.body.classList.remove('panel-resizing');
      try { localStorage.setItem('grado_panel_width', preferredWidth); } catch (e) {}
      resize();
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', finish);
    resizer.addEventListener('pointercancel', finish);
    resizer.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', finish, { once: true });
  });
  resizer.addEventListener('keydown', e => {
    let width = parseInt(panel.style.flexBasis) || panel.offsetWidth;
    if (e.key === 'ArrowLeft') width += 20;
    else if (e.key === 'ArrowRight') width -= 20;
    else if (e.key === 'Home') width = MIN_PANEL_WIDTH;
    else if (e.key === 'End') width = effectiveMaxWidth();
    else return;
    e.preventDefault();
    width = setWidth(width, true);
    try { localStorage.setItem('grado_panel_width', width); } catch (error) {}
  });
  window.addEventListener('resize', () => setWidth(preferredWidth));
}
