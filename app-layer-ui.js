// ГРАДО Студия · часть 10 из 14 (грузится после app-layer-panel.js).
// новый слой, варианты концепции со сравнением ТЭП, массив копий
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
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
      updateStartExperience();
      toast("Слой границы заблокирован — сначала разблокируйте его", "warn");
      return;
    }
    setActiveLayer(existing.id);
    setTool(naturalToolFor(existing), { keepLayer: true });
    toast("Слой границы активен. Поставьте первую точку на холсте.");
    return;
  }
  quickLayerByKind("boundary");
  toast("Слой границы готов. Поставьте первую точку на холсте.");
}
function updateStartExperience() {
  const active = activeLayer();
  const canDraw = isDrawableLayer(active);
  const drawBlockReason = !active ? "Сначала создайте слой"
    : active.locked ? "Активный слой заблокирован"
      : (active.import_only || active.annotation) ? "Выберите проектный слой" : "Сначала создайте слой";
  const drawingTools = new Set(["point", "polyline", "polygon", "rect", "arc", "circle"]);
  const editingTools = new Set(["trim", "extend", "fillet", "rotate", "scale", "mirror", "split", "identify", "offset", "reshape"]);
  document.querySelectorAll("#toolbar button[data-tool]").forEach(button => {
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
    if (drawingTools.has(button.dataset.tool)) {
      // Инструмент черчения гасим ТОЛЬКО когда слой есть, но чертить в него
      // нельзя (заблокирован или он импортный). Пустой проект больше не тупик:
      // выбор инструмента сам заводит слой под нужную геометрию.
      const blocked = !!active && !canDraw;
      button.disabled = blocked;
      button.title = blocked ? drawBlockReason : button.dataset.defaultTitle;
    } else if (editingTools.has(button.dataset.tool)) {
      button.disabled = !state.features.length;
      button.title = !state.features.length ? "Сначала добавьте объект" : button.dataset.defaultTitle;
    }
  });
  ["btn-join", "btn-buffer-open", "btn-merge", "btn-simplify", "btn-array", "btn-find"].forEach(id => {
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
  overlay.innerHTML = `<div class="modal new-layer-modal" role="dialog" aria-modal="true" aria-labelledby="new-layer-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Структура проекта</span><span id="new-layer-title">Новый слой</span></div>
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
  state.sheetLegend = null;
  state.projectCrsId = "auto";
  exactCrs.setProjectCrs(null);
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
    // значения приходят из открытого файла проекта — в style="…" пускаем только
    // проверенный цвет (см. safeCssColor), иначе тут был бы вектор XSS
    const fill = safeCssColor(st.fill);
    if (fill) return fill;
    const hatch = st.hatch && safeCssColor(st.hatch.color);
    if (hatch) return `repeating-linear-gradient(45deg, ${hatch} 0 1px, transparent 1px 4px)`;
    return "transparent";
  };
  function rowHtml(k) {
    const custom = isCustomKind(k);
    const cov = k.topology === "coverage" ? ` · покрытие` : "";
    return `<div class="mk-item" data-kind="${escHtml(k.kind)}">
      <span class="mk-sw" style="background:${swatchOf(k.style_id)}"></span>
      <span class="mk-nm">${escHtml(k.label || k.kind)}</span>
      <span class="mk-meta">${GEOM_LABEL[k.geometry_type] || k.geometry_type}${cov}</span>
      <button class="mk-edit" data-kind="${escHtml(k.kind)}" title="Изменить"><svg class="ic"><use href="#ic-format"/></svg></button>
      <button class="mk-del" data-kind="${escHtml(k.kind)}" title="Удалить"><svg class="ic"><use href="#ic-trash"/></svg></button>
    </div>`;
  }
  function renderList() {
    // Список встроенных ролей отсюда убран: менять их нельзя, а стоял он первым
    // и занимал весь экран. Роль слоя выбирается при его создании; здесь —
    // только СВОИ типы, ради которых окно и открывают.
    const customs = BASE_KINDS.filter(isCustomKind);
    $("mk-list").innerHTML = customs.length
      ? customs.map(rowHtml).join("")
      : `<div class="muted" style="padding:4px var(--sp-4)">Пока нет ни одного своего типа — заполните форму ниже и «Добавить».</div>`;
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
  overlay.innerHTML = `<div class="modal fmt-modal-lg mk-modal" role="dialog" aria-modal="true" aria-labelledby="mk-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Структура проекта</span><span id="mk-title">Свои типы слоёв</span></div>
      <button class="modal-x" aria-label="Закрыть свои типы слоёв"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="lib-hint">Свой тип слоя — это роль в расчёте и знак по умолчанию. Готовые роли (граница, зона, здание, ограничение и прочие) выбираются прямо при создании слоя, отдельного списка для них не нужно.</div>
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
// ---- Разметка окна вариантов ----------------------------------------------
// Строители вынесены из openVariants: они не трогают состояние окна и читаются
// сами по себе. Единственная связь с окном — набор отмеченных для сравнения id,
// он передаётся параметром.
function variantMetricHtml(value, unit) {
  const shown = value == null || value === "" ? "—" : escHtml(String(value));
  return `<span class="var-metric"><b>${shown}</b><small>${escHtml(unit)}</small></span>`;
}

function variantSummaryHtml(summary) {
  if (!summary) return `<div class="var-summary loading">Рассчитываю паспорт ТЭП…</div>`;
  if (!summary.hasTerritory) return `<div class="var-summary missing">Для расчёта нужна граница территории</div>`;
  const status = summary.warnings
    ? `<span class="var-health warning">Проверок: ${summary.warnings}</span>`
    : `<span class="var-health ok">Без предупреждений</span>`;
  return `<div class="var-summary">${variantMetricHtml(summary.spp, "тыс. м² СПП")}${
    variantMetricHtml(summary.density, "тыс. м²/га")}${
    variantMetricHtml(summary.population, "чел.")}${status}</div>`;
}

function variantCurrentHtml(currentSummary) {
  const p = params();
  return `<div class="var-current-copy"><span class="var-eyebrow">Рабочее состояние</span><b>Текущий сценарий</b>
      <small>Целевая плотность ${escHtml(String(p.density))} тыс. м²/га · жильё ${escHtml(String(p.ratio_zh))}%</small></div>
      ${variantSummaryHtml(currentSummary)}`;
}

function variantRowsHtml(sel) {
  const vs = state.variants || [];
  if (!vs.length) return `<div class="var-empty"><b>Сохранённых вариантов пока нет</b><span>Зафиксируйте текущую посадку или создайте три сценария плотности для первого сравнения.</span></div>`;
  return vs.map(v => `<article class="var-item${v.baseline ? " baseline" : ""}" data-id="${escHtml(v.id)}">
      <label class="var-select" title="Добавить в сравнение"><input type="checkbox" class="var-cmp" data-id="${escHtml(v.id)}" aria-label="Добавить вариант ${escHtml(v.name)} в сравнение" ${sel.has(v.id) ? "checked" : ""}><span></span></label>
      <div class="var-card-main"><div class="var-title-row"><span class="var-nm">${escHtml(v.name)}</span>${v.baseline ? '<span class="var-baseline-badge">Базовый</span>' : ""}</div>
        <span class="var-meta">${v.source === "generator" ? `Сценарий плотности · цель ${escHtml(String(v.params?.density ?? "—"))} тыс. м²/га` : "Снимок проекта"} · ${v.features.length} объектов · ${escHtml(v.createdAt || "")}</span>
        ${variantSummaryHtml(v.tepSummary)}</div>
      <div class="var-card-actions">
        <button class="var-base" data-id="${escHtml(v.id)}" aria-label="${v.baseline ? "Базовый вариант" : "Сделать базовым"}: ${escHtml(v.name)}">${v.baseline ? "Базовый вариант" : "Сделать базовым"}</button>
        <button class="var-load" data-id="${escHtml(v.id)}" aria-label="Загрузить вариант ${escHtml(v.name)}">Загрузить</button>
        <button class="var-del" data-id="${escHtml(v.id)}" aria-label="Удалить вариант ${escHtml(v.name)}" title="Удалить вариант"><svg class="ic"><use href="#ic-trash"/></svg></button>
      </div>
    </article>`).join("");
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
  function render() {
    $("var-current").innerHTML = variantCurrentHtml(currentSummary);
    $("var-list").innerHTML = variantRowsHtml(sel);
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
  window.dockOverlay?.(overlay, { title: "Варианты проекта" });
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
  let html = `<div class="modal fmt-modal album-modal" role="dialog" aria-modal="true" aria-labelledby="album-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Выпуск</span><span id="album-title">Состав альбома</span></div>
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

// ---------- массив копий (array из AutoCAD) ----------
// Прямоугольный: сетка N×M с шагами по осям. Полярный: N копий по кругу
// вокруг центра выделения, с поворотом самих копий или без. Ряды парковок,
// опоры освещения, секции застройки — руками это не размножают.
let _arrayPreview = null;                      // [{chains:[[..pts..]], closed}]

function arrayDrawOverlay(context) {
  if (!_arrayPreview || !_arrayPreview.length) return;
  context.save();
  context.strokeStyle = cvColor("selection", "#2f6fde");
  context.lineWidth = 1.2;
  context.setLineDash([5, 4]);
  for (const item of _arrayPreview)
    for (const chain of item.chains) {
      context.beginPath();
      chain.forEach((p, i) => {
        const [sx, sy] = w2s(p[0], p[1]);
        if (i) context.lineTo(sx, sy); else context.moveTo(sx, sy);
      });
      if (item.closed) context.closePath();
      context.stroke();
    }
  context.restore();
}

// копия геометрии со сдвигом и (для полярного) поворотом вокруг центра
function arrayTransformed(f, dx, dy, rotation) {
  const move = p => {
    let x = p[0], y = p[1];
    if (rotation) {
      const cos = Math.cos(rotation.ang), sin = Math.sin(rotation.ang);
      const rx = x - rotation.cx, ry = y - rotation.cy;
      x = rotation.cx + rx * cos - ry * sin;
      y = rotation.cy + rx * sin + ry * cos;
    }
    return [x + dx, y + dy];
  };
  if (f.point) return { point: move(f.point) };
  if (f.line) return { line: f.line.map(move) };
  if (f.ring) return { ring: f.ring.map(move),
    holes: f.holes && f.holes.length ? f.holes.map(h => h.map(move)) : undefined };
  if (f.circle) { const c = move([f.circle.cx, f.circle.cy]);
    return { circle: { cx: c[0], cy: c[1], r: f.circle.r } }; }
  if (f.arc) { const c = move([f.arc.cx, f.arc.cy]);
    return { arc: { ...f.arc, cx: c[0], cy: c[1],
      a0: f.arc.a0 + (rotation ? rotation.ang : 0) } }; }
  return null;
}

// позиции копий (без исходной)
function arrayPlacements(mode, opts, center) {
  const out = [];
  if (mode === "rect") {
    for (let row = 0; row < opts.rows; row++)
      for (let col = 0; col < opts.cols; col++) {
        if (!row && !col) continue;            // исходное место
        out.push({ dx: col * opts.stepX, dy: row * opts.stepY, rotation: null });
      }
  } else {
    // полный круг делится на count, у неполной дуги последняя копия ложится
    // ровно на её конец
    const closed = Math.abs(opts.sweep) >= 360;
    const copies = Math.max(1, opts.count);
    const step = (opts.sweep * Math.PI / 180) / (closed ? copies : Math.max(1, copies));
    for (let i = 1; i <= (closed ? copies - 1 : copies); i++)
      out.push({ dx: 0, dy: 0, rotation: { cx: center[0], cy: center[1], ang: step * i } });
  }
  return out;
}

function openArrayDialog() {
  closePopups();
  const targets = selectionFeatures().filter(f => editableFeature(f));
  if (!targets.length) { toast("Выберите объекты для массива", "warn"); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of targets) for (const p of featurePts(f)) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const center = [(x0 + x1) / 2, (y0 + y1) / 2];

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal fmt-modal array-modal" role="dialog" aria-modal="true" aria-labelledby="ar-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Правка</span><span id="ar-title">Массив копий</span></div>
      <button class="modal-x" aria-label="Закрыть массив"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body vector-body">
      <p class="vector-intro">Выбрано объектов: ${targets.length}. Пунктир — предпросмотр копий; проект меняется по кнопке.</p>
      <div class="fmt-row"><label>Вид<select id="ar-mode">
        <option value="rect">Прямоугольный</option><option value="polar">Полярный</option></select></label></div>
      <div class="fmt-row" id="ar-rect">
        <label>Столбцов<input id="ar-cols" type="number" min="1" max="50" step="1" value="3"></label>
        <label>Рядов<input id="ar-rows" type="number" min="1" max="50" step="1" value="2"></label>
        <label>Шаг X, м<input id="ar-stepx" type="number" step="1" value="${Math.max(10, Math.round(x1 - x0 + 5))}"></label>
        <label>Шаг Y, м<input id="ar-stepy" type="number" step="1" value="${Math.max(10, Math.round(y1 - y0 + 5))}"></label>
      </div>
      <div class="fmt-row" id="ar-polar" hidden>
        <label>Копий<input id="ar-count" type="number" min="1" max="60" step="1" value="6"></label>
        <label>Дуга, град<input id="ar-sweep" type="number" min="10" max="360" step="10" value="360"></label>
        <label class="chk"><input id="ar-rotate" type="checkbox" checked>Поворачивать копии</label>
        <label>Центр X, м<input id="ar-cx" type="number" step="1" value="${Math.round(center[0])}"></label>
        <label>Центр Y, м<input id="ar-cy" type="number" step="1" value="${Math.round(center[1] - Math.max(20, y1 - y0 + 20))}"></label>
      </div>
      <div class="vector-summary" id="ar-summary" role="status" aria-live="polite"></div>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button type="button" id="ar-cancel">Отмена</button>
      <button type="button" id="ar-apply" class="primary">Создать</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const $a = id => overlay.querySelector("#" + id);
  let placements = [];

  const rebuild = () => {
    const mode = $a("ar-mode").value;
    $a("ar-rect").hidden = mode !== "rect";
    $a("ar-polar").hidden = mode !== "polar";
    const opts = mode === "rect"
      ? { cols: Math.max(1, +$a("ar-cols").value || 1), rows: Math.max(1, +$a("ar-rows").value || 1),
          stepX: +$a("ar-stepx").value || 0, stepY: +$a("ar-stepy").value || 0 }
      : { count: Math.max(1, +$a("ar-count").value || 1),
          sweep: Math.max(10, Math.min(360, +$a("ar-sweep").value || 360)),
          rotate: $a("ar-rotate").checked };
    // Центр полярного — из полей: вокруг центра САМОГО объекта крутить
    // бессмысленно, все копии совпали бы с исходной. По умолчанию центр
    // сдвинут вниз от выделения — сразу видно круг.
    const pivot = mode === "polar"
      ? [Number($a("ar-cx").value) || center[0], Number($a("ar-cy").value) || center[1]]
      : center;
    placements = arrayPlacements(mode, opts, pivot);
    // «не поворачивать» в полярном: геометрия копии остаётся в исходной
    // ориентации, на круг едет только её центр
    if (mode === "polar" && !opts.rotate)
      placements = placements.map(place => ({ ...place, keepUpright: true }));
    // предел: сетка 50×50 на пачке выделенных объектов — это тысячи копий,
    // живой предпросмотр такого подвешивает вкладку, а проекту столько не надо
    const totalPlanned = placements.length * targets.length;
    if (totalPlanned > 1000) {
      _arrayPreview = null;
      $a("ar-summary").innerHTML = `<b>Слишком много копий: ${totalPlanned.toLocaleString("ru-RU")}</b>` +
        `<span>предел 1000 — уменьшите сетку, число копий или выделение</span>`;
      $a("ar-apply").disabled = true;
      placements = [];
      draw();
      return;
    }
    _arrayPreview = [];
    for (const place of placements)
      for (const f of targets) {
        const g = arrayCopyGeometry(f, place);
        if (!g) continue;
        const chains = g.ring ? [g.ring, ...(g.holes || [])]
          : g.line ? [g.line]
          : g.point ? [[g.point]]
          : [featurePts({ ...f, ...g })];
        _arrayPreview.push({ chains, closed: !!g.ring });
      }
    const total = placements.length * targets.length;
    $a("ar-summary").innerHTML = `<b>Будет создано: ${ruCount(total, "копия", "копии", "копий")}</b>` +
      `<span>${mode === "rect" ? "сетка со сдвигом по осям" : "по кругу вокруг центра выделения"}</span>`;
    $a("ar-apply").disabled = !total;
    draw();
  };
  overlay.querySelectorAll("select,input").forEach(el => {
    el.addEventListener("change", rebuild);
    el.addEventListener("input", rebuild);
  });
  const close = () => { _arrayPreview = null; overlay.remove(); draw(); };
  $a("ar-cancel").addEventListener("click", close);
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  $a("ar-apply").addEventListener("click", () => {
    if (!placements.length) return;
    snapshot();
    const ids = [];
    for (const place of placements)
      for (const f of targets) {
        const g = arrayCopyGeometry(f, place);
        if (!g) continue;
        const nf = { id: state.nextId++, layer_id: f.layer_id,
          props: cloneVariantValue(f.props || {}), ...g };
        if (f.style_id) nf.style_id = f.style_id;
        if (f.kind) nf.kind = f.kind;
        upgradeFeature(nf);
        state.features.push(nf);
        ids.push(nf.id);
      }
    close();
    setSelection(ids);
    afterChange();
    toast(`Массив: ${ruCount(ids.length, "копия", "копии", "копий")}`);
  });
  rebuild();
}

// геометрия одной копии: поворотная — вращением вокруг центра; «не
// поворачивать» — центр объекта едет по кругу, сама геометрия только сдвигается
function arrayCopyGeometry(f, place) {
  if (!place.keepUpright) return arrayTransformed(f, place.dx, place.dy, place.rotation);
  const pts = featurePts(f);
  let ox = 0, oy = 0, n = 0;
  for (const p of pts) { ox += p[0]; oy += p[1]; n += 1; }
  ox /= n || 1; oy /= n || 1;
  const ang = place.rotation.ang;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const rx = ox - place.rotation.cx, ry = oy - place.rotation.cy;
  const nx = place.rotation.cx + rx * cos - ry * sin;
  const ny = place.rotation.cy + rx * sin + ry * cos;
  return arrayTransformed(f, nx - ox, ny - oy, null);
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
  overlay.innerHTML = `<div class="modal fmt-modal buffer-modal" role="dialog" aria-modal="true" aria-labelledby="buffer-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Инструменты</span><span id="buffer-title">Создать буфер</span></div>
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

