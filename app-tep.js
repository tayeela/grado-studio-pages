// ГРАДО Студия · часть 8 из 14 (грузится после app-history.js).
// ТЭП, панель свойств объекта вместе с блоком стиля
// оформления, обзор объектов с клавиатуры
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
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
// Бейдж «живой расчёт» и зелёная точка на вкладке — статическая разметка,
// которая не менялась при потере связи: панель одновременно показывала «живой
// расчёт» и «нет связи с расчётом». Режим вешаем на #panel — он содержит и
// вкладку, и карточку.
function setTepMode(mode) {
  const panel = document.getElementById("panel");
  if (panel) panel.dataset.tepMode = mode;
}
function refreshTep(force) {
  clearTimeout(tepTimer);
  const requestVersion = ++tepRequestVersion;
  const st = document.getElementById("tep-status");
  if (state.features.length > TEP_AUTO_MAX && !force) {
    tepAbortController?.abort();
    if (st) {
      setTepMode("manual");
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
      setTepMode("live");
    } catch (e) {
      if (e?.name === "AbortError" || requestVersion !== tepRequestVersion) return;
      document.getElementById("tep-status").textContent = "нет связи с расчётом";
      // #st-core с текстом «клик для reconnect» был скрыт инлайн-стилем и не имел
      // обработчика клика — обещание без исполнения; удалён вместе с записью.
      setTepMode("error");
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
      `<div class="tep-empty-actions"><button type="button" id="tep-start-boundary">Создать границу</button></div></div>`;
    bodyEl.querySelector("#tep-start-boundary")?.addEventListener("click", startBoundaryFlow);
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
    toast("Не удалось построить буфер: " + String(err).slice(0, 150)
      + ". Попробуйте другое расстояние или упростите геометрию", "error");
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

// Озвучивание выделения: холст — canvas, для скринридера он немой, и смена
// выбранного объекта не сообщалась никак. Пишем краткое описание в живую
// область; повтор того же текста подавляем, иначе AT тараторит на каждый кадр.
let _srLastSelection = "";
// Обзор объектов (см. cvReader ниже) говорит подробнее и с номером позиции:
// пока ведёт он, обычное озвучивание выделения молчит, иначе живая область
// получает две записи подряд и скринридер читает объект дважды.
let _srSuppress = false;
function announceSelection() {
  const node = document.getElementById("sr-selection");
  if (!node || _srSuppress) return;
  const ids = selectionIds();
  let text;
  if (!ids.length) text = "";
  else if (ids.length > 1) text = `Выбрано объектов: ${ids.length}`;
  else {
    const f = selectedFeature();
    if (!f) text = "";
    else {
      const layer = layerOf(f);
      // слой пользователь узнаёт лучше внутреннего kind: «Здание», «Граница
      // территории» — это и есть названия слоёв
      const parts = [layer ? `объект слоя «${layer.title}»` : "объект"];
      if (f.ring) parts.push(`площадь ${fmtAreaHa(featureArea(f))}`);
      else if (f.line) parts.push(`длина ${fmtLen(lineLen(f.line))}`);
      else if (f.circle) parts.push(`окружность радиусом ${fmtLen(f.circle.r)}`);
      else if (f.arc) parts.push(`дуга радиусом ${fmtLen(f.arc.r)}`);
      text = `Выбран ${parts.join(", ")}`;
    }
  }
  if (text === _srLastSelection) return;
  _srLastSelection = text;
  node.textContent = text;
}
function srSay(text) {
  const node = document.getElementById("sr-selection");
  if (!node) return;
  _srLastSelection = text;
  node.textContent = text;
}

// ---------- обзор объектов холста с клавиатуры ----------
// Чертёж живёт в canvas: без указателя объектов нет вовсе — ни в дереве
// доступности, ни в порядке обхода. Живая область (announceSelection) сообщала
// только о том, что уже выбрано мышью; здесь появляется сама навигация.
// Списком в DOM это не делается: городская выгрузка — десятки тысяч объектов,
// столько узлов убьют и скринридер, и вкладку. Поэтому в разметке одна
// строка-курсор, а порядок объектов считается одним проходом и кэшируется.
const cvReader = { order: null, pos: -1 };
function cvReaderOrder() {
  if (cvReader.order) return cvReader.order;
  const byLayer = new Map();
  for (const f of state.features) {
    const L = layerOf(f);
    if (!L || !layerDrawable(L)) continue; // скрытое и вне масштаба не читаем
    let bucket = byLayer.get(L.id);
    if (!bucket) byLayer.set(L.id, bucket = []);
    bucket.push(f.id);
  }
  // порядок как в панели слоёв — сверху вниз, внутри слоя порядок черчения
  const order = [];
  for (const L of layerRowsTopFirst(new Set(byLayer.keys()))) {
    const bucket = byLayer.get(L.id);
    if (!bucket) continue;
    for (const id of bucket) order.push({ id, layerId: L.id, layerTitle: L.title });
  }
  return (cvReader.order = order);
}
function featureAttrText(f) {
  const L = layerOf(f);
  const out = [];
  for (const field of (L && ATTR_FIELDS[L.semantic_class]) || []) {
    if (field.type === "computed") { out.push(field.compute(f)); continue; }
    if (!field.key) continue;
    const v = f.props ? f.props[field.key] : undefined;
    if (v === undefined || v === "" || v === null) continue;
    out.push(`${field.title}: ${v}`);
  }
  for (const cf of (L && L.fields) || []) {
    const v = f.props ? f.props[cf.name] : undefined;
    if (v === undefined || v === "" || v === null) continue;
    out.push(`${cf.name}: ${cf.type === "bool" ? (v ? "да" : "нет") : v}`);
  }
  if (f.prov) out.push(`источник: ${f.prov.source}`);
  return out;
}
// Название слоя не повторяем: оно уже прозвучало в строке позиции.
function featureReadText(f, withAttrs) {
  const parts = [];
  if (f.ring) parts.push(`площадь ${fmtAreaHa(featureArea(f))}`);
  else if (f.circle) parts.push(`окружность радиусом ${fmtLen(f.circle.r)}`);
  else if (f.arc) parts.push(`дуга радиусом ${fmtLen(f.arc.r)}`);
  else if (f.line) parts.push(`длина ${fmtLen(lineLen(f.line))}`);
  else if (f.point) parts.push("точка");
  if (withAttrs) parts.push(...featureAttrText(f));
  return parts.length ? parts.join(", ") : "объект";
}
// Объект, до которого дошёл курсор, обязан быть виден: иначе зрячий с
// клавиатуры слышит выбор, но не видит его. Масштаб не трогаем, пока объект
// в него вписывается — прыгающий зум теряет контекст квартала.
function cvReaderReveal(f) {
  const box = featureViewBox(f);
  const cv = document.getElementById("cv");
  if (!box || !cv) return;
  const w = viewportW(), h = viewportH();
  const [x1, y1] = w2s(box.minx, box.maxy);
  const [x2, y2] = w2s(box.maxx, box.miny);
  if (x1 >= 0 && y1 >= 0 && x2 <= w && y2 <= h) return;
  if (x2 - x1 > w * 0.9 || y2 - y1 > h * 0.9) { zoomToFeature(f); return; }
  const [cxs, cys] = w2s(box.cx, box.cy);
  state.view.tx += w / 2 - cxs;
  state.view.ty += h / 2 - cys;
}
function cvReaderStatus(head, body) {
  const posNode = document.getElementById("cv-reader-pos");
  const textNode = document.getElementById("cv-reader-text");
  if (posNode) posNode.textContent = head;
  if (textNode) textNode.textContent = body;
}
function cvReaderGoto(pos, withAttrs) {
  const order = cvReaderOrder();
  if (!order.length) {
    cvReader.pos = -1;
    cvReaderStatus("Обзор объектов", "На видимых слоях нет объектов");
    srSay("На видимых слоях нет объектов");
    return;
  }
  const next = Math.min(order.length - 1, Math.max(0, pos));
  const entry = order[next];
  const f = state.features.find(x => x.id === entry.id);
  if (!f) { cvReader.order = null; return; } // список устарел — пересоберём
  cvReader.pos = next;
  selectOne(f.id);
  cvReaderReveal(f);
  // renderProps сам объявляет выделение; здесь текст подробнее и с позицией,
  // поэтому обычное объявление на время правки панели молчит
  _srSuppress = true;
  try { draw(); renderProps(); } finally { _srSuppress = false; }
  const head = `${next + 1} из ${order.length} · ${entry.layerTitle}`;
  const body = featureReadText(f, withAttrs);
  cvReaderStatus(head, body);
  srSay(`${head}. ${body}`);
}
function cvReaderStep(delta, withAttrs) {
  const order = cvReaderOrder();
  if (!order.length) return cvReaderGoto(0, false);
  // курсор мог отстать от выделения мышью — подхватываем выбранный объект
  let from = cvReader.pos;
  if (state.selected != null) {
    const at = order.findIndex(e => e.id === state.selected);
    if (at >= 0) from = at;
  }
  if (from < 0) return cvReaderGoto(delta > 0 ? 0 : order.length - 1, withAttrs);
  const next = from + delta;
  if (next < 0 || next >= order.length) {
    srSay(next < 0 ? "Это первый объект" : "Это последний объект");
    return;
  }
  cvReaderGoto(next, withAttrs);
}
// PageUp/PageDown — к первому объекту соседнего слоя: на выгрузке в тысячи
// объектов перебирать их по одному бессмысленно
function cvReaderLayerStep(delta) {
  const order = cvReaderOrder();
  if (!order.length) return cvReaderGoto(0, false);
  const from = Math.max(0, cvReader.pos);
  const layerId = order[from].layerId;
  let i = from;
  if (delta > 0) {
    while (i < order.length && order[i].layerId === layerId) i++;
    if (i >= order.length) { srSay("Это последний слой с объектами"); return; }
  } else {
    while (i >= 0 && order[i].layerId === layerId) i--;
    if (i < 0) { srSay("Это первый слой с объектами"); return; }
    const prevId = order[i].layerId;
    while (i > 0 && order[i - 1].layerId === prevId) i--;
  }
  cvReaderGoto(i, false);
}
{
  const reader = document.getElementById("cv-reader");
  if (reader) {
    reader.addEventListener("focus", () => {
      const order = cvReaderOrder();
      if (!order.length) {
        cvReaderStatus("Обзор объектов", "На видимых слоях нет объектов");
        return;
      }
      cvReaderStatus(`Обзор объектов: ${order.length}`,
        "↑↓ объекты · PgUp/PgDn слои · Enter атрибуты · Esc на холст");
    });
    // Обработчик свой, не общий по документу: там стрелки двигают выделенные
    // объекты, а Delete их удаляет — в режиме чтения это недопустимо.
    reader.addEventListener("keydown", event => {
      const key = event.key;
      const handled = {
        ArrowDown: () => cvReaderStep(1, false),
        ArrowUp: () => cvReaderStep(-1, false),
        PageDown: () => cvReaderLayerStep(1),
        PageUp: () => cvReaderLayerStep(-1),
        Home: () => cvReaderGoto(0, false),
        End: () => cvReaderGoto(cvReaderOrder().length - 1, false),
        Enter: () => cvReaderGoto(Math.max(0, cvReader.pos), true),
      }[key];
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        handled();
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById("cv")?.focus();
      }
      // остальные клавиши уходят наверх: Tab обязан выводить из обзора,
      // иначе это ловушка фокуса (WCAG 2.1.2)
    });
  }
}
function renderProps() {
  announceSelection();
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
