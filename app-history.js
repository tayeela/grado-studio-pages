// ГРАДО Студия · часть 7 из 14 (грузится после app-labels-place.js).
// вид, история отмен, сохранение и автосохранение
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
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
  const w = viewportW(), h = viewportH();
  const [wx, wy] = s2w(w / 2, h / 2);        // мировая точка под центром экрана
  state.view.k = clampK(state.view.k * factor);
  state.view.tx = w / 2 - wx * state.view.k;
  state.view.ty = h / 2 + wy * state.view.k;
  draw();
}
function fitBox(x0, y0, x1, y1, pad = 0.82) {
  const w = viewportW(), h = viewportH();
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
  delete saved.sheetLegend;
  delete saved.projectCrsId;
  delete saved.alignOgd;
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

  // Что historySmallState намеренно НЕ кладёт в снимок, то приходится
  // придержать здесь. Восстановление — общее с открытием файла, а там
  // отсутствующее поле означает «старый проект» и подменяется значением по
  // умолчанию: СК становится исторической UTM 37N, легенда листа — пустой,
  // выравнивание ОГД — включённым. Для отмены чертежа это не умолчание, а
  // потеря: система координат менялась БЕЗ пересчёта координат (reproject:
  // false), то есть выгрузка уезжала в чужую СК с прежними числами.
  const personal = {
    name: document.getElementById("project-name").value,
    variants: state.variants,
    accessRadii: state.accessRadii,
    albumConfig: state.albumConfig,
    projectCrsId: state.projectCrsId,
    sheetLegend: state.sheetLegend,
    alignOgd: state.alignOgd,
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
  state.sheetLegend = personal.sheetLegend;
  state.alignOgd = personal.alignOgd;
  state.projectCrsId = personal.projectCrsId;
  // СК возвращаем и в сам преобразователь: applyRestoredState уже переключил
  // его на историческую
  if (personal.projectCrsId && personal.projectCrsId !== "auto")
    applyProjectCrs(personal.projectCrsId, { reproject: false, silent: true });
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
// Историю здесь НЕ материализуем: collectState() зовётся на каждую правку
// (persist → afterChange), а превращение записей отмены в строки стоит дорого.
// Её подшивает saveStateNow() — единственная точка реальной записи.
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
    undo: [], redo: [],
    projectCustomKinds: state.projectCustomKinds || [],
    variants: state.variants || [],
    accessRadii: state.accessRadii,
    albumConfig: state.albumConfig,
    sheetLegend: state.sheetLegend || null,
    projectCrsId: state.projectCrsId || "utm37-legacy",
    alignOgd: state.alignOgd !== false,
    // Режимы привязки и топоправки читались при восстановлении
    // (applyRestoredState) и нормализовались (normalizeRestoredState), но
    // сюда их никто не клал — то есть в файл и в автосейв они не попадали
    // вовсе. Топорежим и привязки приходилось включать заново после каждой
    // перезагрузки, хотя весь путь чтения был готов.
    osnap: state.osnap !== false,
    topoEdit: state.topoEdit === true,
    gridSnap: state.gridSnap !== false,
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
  // История отмен сериализуется здесь, а не в collectState(): запись дебаунсится
  // (1.5 с), а collectState() выполняется на каждую правку. Порог 8000 объектов
  // прежний — у больших выгрузок историю на диск не пишем вовсе.
  if (payload && typeof payload === "object" && Array.isArray(payload.features)) {
    const heavy = payload.features.length > 8000;
    payload.undo = heavy ? [] : historyStackToStrings(state.undo);
    payload.redo = heavy ? [] : historyStackToStrings(state.redo);
  }
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
  state._ix = null; state._snapIndex = null; cvReader.order = null;
  _dataVersion += 1;                       // кеш свойств по выражению устарел
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

