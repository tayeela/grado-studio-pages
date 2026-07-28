// ГРАДО Студия · часть 1 из 14 (первая часть).
// ядро: сообщения об ошибках, модель слоёв и стилей v2,
// пользовательские слои, свойства по выражению, выбор инструмента
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
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
// Цель отрисовки подменяется на время выпуска листа: тот же drawNow рисует и на
// экран, и в PDF (рекордер в app-pdf.js повторяет нужное подмножество Canvas 2D).
// Иначе для листа пришлось бы держать второй рендерер, а он неизбежно разошёлся
// бы с экраном.
let ctx = cv.getContext("2d");
let _renderTarget = null;          // { ctx, w, h } на время выпуска листа
const viewportW = () => _renderTarget ? _renderTarget.w : cv.clientWidth;
const viewportH = () => _renderTarget ? _renderTarget.h : cv.clientHeight;
// Рисует сцену в чужой контекст с чужим видом и размером «холста».
function renderSceneTo(target, width, height, view) {
  const savedCtx = ctx, savedView = state.view, savedSelected = state.selected;
  const savedIds = state.selectedIds, savedSnap = state.snapHit, savedGuides = state.guides;
  const savedReadable = state.lgrReadable;
  ctx = target;
  // «Читаемый ЛГР» — экранная поблажка: он держит знак разборчивым на любом
  // зуме (подпись фиксированного кегля, засечка и линия не тоньше пола) и тем
  // самым ЛОМАЕТ масштаб. В выпуск это уезжать не должно, и в коде это сказано
  // прямо — «лист всегда по эталону» рядом с самой настройкой, — но выключал
  // режим только DXF. Лист, альбом и печать шли через эту функцию с включённым
  // режимом, и подпись знака вставала 5 мм на бумаге при любом масштабе листа
  // вместо положенных 10 м местности: на 1:5000 это два с половиной размера.
  state.lgrReadable = false;
  _renderTarget = { ctx: target, w: width, h: height };
  state.view = { ...view };
  // выделение, привязки и направляющие — это экран, на листе им не место
  state.selected = null; state.selectedIds = new Set(); state.snapHit = null; state.guides = [];
  try { drawNow(); }
  finally {
    ctx = savedCtx; _renderTarget = null; state.view = savedView;
    state.selected = savedSelected; state.selectedIds = savedIds;
    state.snapHit = savedSnap; state.guides = savedGuides;
    state.lgrReadable = savedReadable;
  }
}

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
  "leader.line":        { stroke: "#44423c", width: 0.8 },
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
  // Выноска живёт по образцу размера: это ЛИНИЯ на служебном слое, а не новый
  // примитив. Текст хранится в props.text — так он попадает и в отмену, и в
  // сохранение, и в обмен, ничего не зная про отрисовку.
  { id: "annotation.leaders", title: "Выноска", kind: "leader",
    semantic_class: null, geometry_type: "polyline", style_id: "leader.line",
    annotation: true, tool: "leader",
    fields: [{ name: "text", label: "надпись", type: "text" }],
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
// Имя слоя, который заводится сам при выборе инструмента в пустом проекте.
const AUTO_LAYER_TITLE = { point: "Точки", polyline: "Линии", polygon: "Полигоны",
  arc: "Дуги", circle: "Окружности" };
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
  // встроенная библиотека (styles-lib.js) вливается сразу и без сети: у части
  // пользователей запрос styles.json блокируется, и знаки ЛГР не применялись
  if (window.GRADO_STYLES_LIB)
    for (const id of Object.keys(GRADO_STYLES_LIB)) STYLES_V2[id] = GRADO_STYLES_LIB[id];
  try {
    const r = await fetch("/api/styles");
    if (!r.ok) return;
    const lib = await r.json();
    for (const id of Object.keys(lib)) STYLES_V2[id] = lib[id];
    draw(); renderLayers();
  } catch (e) { /* сервер без /api/styles — холст на встроенной библиотеке */ }
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
// Правила-диапазоны слоя (градуированная символика). Отдельно от категорий:
// у них нет знака из библиотеки — только патч цвета поверх стиля слоя.
function rangeRulesOf(L) {
  if (!L || !Array.isArray(L.rules)) return [];
  return L.rules.filter(rule => rule && rule.patch && rule.min !== undefined && rule.max !== undefined);
}
// Строки легенды по диапазонам: один проход по объектам слоя на все классы.
function rangeLegendItems(L, ranges) {
  const SY = typeof window !== "undefined" && window.GRADO_SYMBOLOGY;
  const counts = new Array(ranges.length).fill(0);
  if (SY) for (const f of state.features) {
    if (layerOf(f) !== L) continue;
    const value = (f.props || {})[ranges[0].field];
    for (let i = 0; i < ranges.length; i++)
      if (SY.ruleMatchesValue(ranges[i], value)) { counts[i] += 1; break; }
  }
  const base = layerStyle(L) || {};
  return ranges.map((rule, i) => ({ title: rule.title || `${rule.min} – ${rule.max}`,
    count: counts[i], style: { ...base, ...rule.patch } }));
}

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
// Кэш готовых строк панели. Обработчики строки (их около тринадцати) замыкают
// САМ объект слоя, а не значения момента отрисовки, поэтому узел можно
// переиспользовать, пока его видимое содержимое не изменилось: appendChild
// просто переносит его в новое место вместе со слушателями. Без этого панель
// перестраивалась целиком на каждую правку — при 400 слоях-приёмниках это
// сотни миллисекунд на каждый добавленный объект.
const _layerRowCache = new Map();   // layer.id -> { sig, nodes: [строка, ...категории] }
function layerRowSignature(layer, view) {
  const catsOff = (layer.fmt && layer.fmt.cats_off) || [];
  return [
    layer.title, layer.visible, layer.locked, layer.geometry_type, layer.source_kind,
    layer.import_only, (layer.rules || []).length,
    layer.fmt ? Object.keys(layer.fmt).length : 0,
    view.count, view.isActive, view.catOpen, view.swSvg,
    view.cats.map(c => `${c.id}:${c.count}:${catsOff.includes(c.id) ? 0 : 1}`).join("|"),
  ].join("");
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
 *   1. ruleStyleFor (первое совпадение правил-ЗНАКОВ слоя) → библиотека
 *   2. f.style_id (если есть) → библиотека
 *   3. layerStyle (base style_id слоя + layer.fmt)
 *   4. + rulePatchFor (правила-ДИАПАЗОНЫ: патч поверх выбранного знака)
 *   5. + f.fmt (поверх всего)
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

// Знак, которым слой НАРИСОВАН, — в отличие от layerStyle, который отдаёт
// только знак, записанный НА СЛОЕ.
//
// У слоёв ГИС ОГД знак живёт на ОБЪЕКТАХ: он выбирается по коду ЛГР при
// импорте и лежит в f.style_id, а на слое не записан ничего. Всё, что
// спрашивало layerStyle напрямую, получало для таких слоёв пустоту и молча
// подставляло запасное: окно оформления показывало серый вместо красного,
// выгрузка QML отдавала слой БЕЗ ОФОРМЛЕНИЯ, таблица слоёв в DXF уезжала с
// цветом 7 у всех подряд. Легенда листа и панель слоёв делали правильно —
// смотрели на образцовый объект; теперь так делают все.
//
// Образец берём по возможности без личной правки объекта (f.fmt), иначе за
// весь слой отвечало бы оформление одного-единственного объекта.
function layerShownStyle(L) {
  if (!L) return {};
  const образец = Array.isArray(state.features)
    ? (state.features.find(f => layerOf(f) === L && !f.fmt)
      || state.features.find(f => layerOf(f) === L))
    : null;
  return образец ? styleOf(образец) : (layerStyle(L) || {});
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
// ---------- свойства по выражению (data-defined в QGIS) ----------
// Толщина линии по интенсивности, размер знака по ёмкости, кегль подписи по
// значимости: fmt.width_expr / fmt.size_expr / fmt.label_size_expr. Выражение —
// тот же безопасный вычислитель, что у калькулятора полей и отбора.
//
// Считается ОДИН раз на объект и живёт до следующей правки: на 20 000 объектов
// пересчёт каждый кадр — это десятки миллисекунд впустую, значения меняются
// только вместе с атрибутами.
let _dataVersion = 0;
const _ddCache = new WeakMap();
const DD_KEYS = [["width_expr", "width", 0.1, 20], ["size_expr", "marker_size", 0.5, 40],
                 ["label_size_expr", "label_size", 6, 72]];

function dataDefinedPatch(L, f) {
  const fmt = L && L.fmt;
  if (!fmt || !DD_KEYS.some(([key]) => fmt[key])) return null;
  const hit = _ddCache.get(f);
  if (hit && hit.v === _dataVersion && hit.owner === L) return hit.patch;
  const patch = {};
  for (const [key, target, low, high] of DD_KEYS) {
    const expression = fmt[key];
    if (!expression) continue;
    let value = null;
    try { value = parseFloat(evalFieldExpr(expression, f)); } catch (error) { value = null; }
    if (Number.isFinite(value)) patch[target] = Math.max(low, Math.min(high, value));
  }
  const result = Object.keys(patch).length ? patch : null;
  _ddCache.set(f, { v: _dataVersion, owner: L, patch: result });
  return result;
}

// патч ложится на готовый стиль: размер знака и кегль подписи лежат глубже
function applyDataDefined(style, patch) {
  if (!patch) return style;
  const out = { ...style };
  if (patch.width != null) out.width = patch.width;
  if (patch.marker_size != null) out.marker = { ...(out.marker || {}), size: patch.marker_size };
  if (patch.label_size != null) out.label_font = { ...(out.label_font || {}), size: patch.label_size };
  return out;
}

function ruleStyleFor(L, f) {
  if (!L || !Array.isArray(L.rules)) return null;
  const props = f.props || {};
  const SY = typeof window !== "undefined" && window.GRADO_SYMBOLOGY;
  for (const r of L.rules) {
    // правила-ДИАПАЗОНЫ разбирает rulePatchFor: они несут не знак, а патч
    // оформления, и накладываются поверх уже выбранного знака
    if (r.patch && r.min !== undefined && r.max !== undefined) continue;
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
// Градуированная символика: патч оформления, посчитанный по данным слоя
// (цветов диапазонов в библиотеке знаков нет и быть не может). Возвращает
// именно ПАТЧ, а не готовый стиль: накладывать его нужно поверх того знака,
// который объект уже получил, каким бы путём он ни был выбран.
function rulePatchFor(L, f) {
  if (!L || !Array.isArray(L.rules)) return null;
  const SY = typeof window !== "undefined" && window.GRADO_SYMBOLOGY;
  if (!SY) return null;
  const props = f.props || {};
  for (const r of L.rules) {
    if (!r.patch || !r.field || r.min === undefined || r.max === undefined) continue;
    if (SY.ruleMatchesValue(r, props[r.field])) return r.patch;
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
  // Условное оформление слоя стоит ВПЕРЕДИ знака объекта. У импортированных
  // слоёв (ГИС ОГД, шейпы) знак живёт на объекте — он проставлен при импорте по
  // коду ЛГР, а не выбран человеком. Пока f.style_id был выше правил, правила
  // на такие слои не действовали ВООБЩЕ: окно оформления считало классы,
  // легенда листа их рисовала, выгрузка QML писала graduatedSymbol — а холст
  // оставался прежним. Человек настраивает раскраску и не видит отклика.
  let base = ruleStyleFor(L, f) || (sid && (state.projectStyles[sid] || STYLES_V2[sid]))
    || (gsid && STYLES_V2[gsid]) || layerStyle(L) || {};
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
  // диапазоны — патч поверх любого знака, каким бы путём он ни был выбран
  const rangePatch = rulePatchFor(L, f);
  if (rangePatch) base = { ...base, ...rangePatch };
  const withData = applyDataDefined(base, dataDefinedPatch(L, f));
  return f.fmt ? { ...withData, ...f.fmt } : withData;   // f.fmt — оформление отдельного объекта
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
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Знак проекта</span><span id="project-styles-title">Стили проекта</span></div>
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
  window.dockOverlay?.(overlay, { title: "Знаки проекта" });
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
  // В образце нет полигона, значит нет и «внутрь»: одиночный ряд всегда вверх,
  // «в обе» — вверх и вниз. Прежде здесь стояла тройная развилка, у которой обе
  // ветви давали −1: «наружу» и «внутрь» рисовались одинаково, а вид кода
  // обещал разницу.
  const dirs = mk.dir === "both" ? [-1, 1] : [-1];
  // Хотя бы ОДИН маркер даже в узком свотче (40px): раньше n=floor(28/26)=0 и
  // засечки не рисовались вовсе — знак ООЗТ/ПК выглядел как голая линия.
  const usable = x1 - x0, step = 26;
  const n = Math.max(1, Math.round(usable / step));
  const gap = usable / (n + 1);
  let out = "";
  for (let i = 1; i <= n; i++) {
    for (const d of dirs) {
      // Ряды «в обе стороны» ЧЕРЕДУЮТСЯ вдоль линии — как два MarkerLine
      // эталона со сдвигом offset_along_line на полшага. Обе засечки в одной
      // точке давали «бабочку», и образец врал про знак на карте.
      const x = x0 + gap * i + (dirs.length > 1 && d < 0 ? gap / 2 : 0);
      if (x > x1) continue;
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
// «Разрезать» собирает ломаную тем же черчением, но объекта не создаёт —
// поэтому он в TOOL_GEOM (сбор точек), но НЕ в GEOM_OF_TOOL (создание слоя
// под геометрию и переключение активного слоя ему не нужны).
const TOOL_GEOM = { ...GEOM_OF_TOOL, dim: "polyline", leader: "polyline", split: "polyline", reshape: "polyline" };

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
  if (f.kind === "building") {
    // Этажность вне 1..75 (пусто, 0, текст, мусор из импорта) подставляется
    // девяткой. Само по себе это разумный планировочный дефолт, но он МОЛЧА
    // попадал в «СПП факт» и «Плотность факт»: у выгрузки НСПД поле opt_floors
    // часто пустое, и каждое такое здание считалось девятиэтажным. Помечаем
    // допущение, чтобы ТЭП мог о нём сказать, а атрибутивная таблица — показать.
    const raw = f.props.floors;
    f.props.floors = normalizedFloorCount(raw);
    const known = Math.trunc(Number(raw));
    if (Number.isFinite(known) && known >= 1 && known <= 75) delete f.props.floors_assumed;
    else f.props.floors_assumed = true;
  }
  f.geometry_type = f.point ? "point" : f.line ? "polyline" : f.arc ? "arc" : f.circle ? "circle" : "polygon";
  return roundCoords(f);
}

