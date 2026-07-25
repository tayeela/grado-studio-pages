// ГРАДО Студия · часть 14 из 14 (грузится после app-input.js).
// инструменты и панели, индикатор занятости, старт приложения
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
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
    // в неинтерактивном состоянии чип — обычная подпись, из табуляции убираем
    chip.removeAttribute("role"); chip.removeAttribute("tabindex");
    chip.removeAttribute("aria-label"); chip.onkeydown = null;
    chip.innerHTML = `<span class="al-dot" style="background:${escHtml(col)}"></span>` +
                     `<span class="al-cap">черчу в:</span>&nbsp;${escHtml(L.title)}`;
  } else {
    chip.className = "cv-activelayer empty";
    // Пустое состояние делает чип КНОПКОЙ (клик создаёт слой), но он оставался
    // обычным div: с клавиатуры и из скринридера действие было недостижимо.
    chip.onclick = () => openNewLayerDialog();
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("aria-label", "Нет активного слоя — создать слой");
    chip.onkeydown = event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openNewLayerDialog();
    };
    chip.innerHTML = `<span class="al-dot" style="background:var(--warning)"></span>` +
                     `нет активного слоя — создайте (+)`;
  }
}
function setTool(tool, opts = {}) {
  state.tool = tool; state.drawing = null; state.drag = null;
  state.edit = null; state.typed = "";
  if (tool !== "layeralign") state.layerAlign = null;
  if (tool !== "measure") state.measure = null;
  if (tool !== "marea") state.measureArea = null;
  // Подсказка режима видна в статус-строке, пока режим активен: тост исчезает
  // через 5 секунд, а режим остаётся. Пустая строка — обычные инструменты.
  const hintEl = document.getElementById("st-hint");
  const setHint = text => { if (hintEl) hintEl.textContent = text; };
  if (tool === "trim" || tool === "extend") {
    state.trimCtx = { boundary: new Set(), ready: false };
    // в интерфейсе инструменты называются по-русски — внутренний id наружу не выносим
    const ru = tool === "trim" ? "Обрезать" : "Продлить";
    const what = tool === "trim" ? "обрезки" : "продления";
    toast(`Режим «${ru}»: клик по границам, Enter — готово, затем клик по цели для ${what}. Границы подсвечены.`);
    setHint(`«${ru}»: выберите границы → Enter → клик по лишней части`);
  } else {
    state.trimCtx = null;
    setHint("");
  }
  if (tool === "marea") {
    toast("Измерение площади: кликайте контур, Enter — замкнуть, Esc — убрать");
    setHint("«Площадь»: клики по контуру → Enter");
  }
  if (tool === "reshape") {
    toast(state.selectedIds.size
      ? "Режим «Изменить форму»: чертите новую форму через выбранный объект, Enter — применить"
      : "Режим «Изменить форму»: ломаная должна дважды пересечь контур, Enter — применить");
    setHint("«Изменить форму»: ломаная через контур → Enter");
  }
  if (tool === "offset") {
    promptOffsetDistance();
    setHint("«Эквидистанта»: клик по линии — параллельная копия, сторона по клику");
  }
  if (tool === "identify") {
    toast("Режим «Определить»: клик по чертежу покажет все объекты под курсором, сверху вниз");
    setHint("«Определить»: клик — список объектов под курсором");
  }
  if (tool === "split") {
    toast(state.selectedIds.size
      ? `Режим «Разрезать»: чертите линию через выбранное (${state.selectedIds.size}), Enter — разрезать`
      : "Режим «Разрезать»: чертите линию через объекты, Enter — разрезать. Выделите объекты, чтобы резать только их.");
    setHint("«Разрезать»: линия через объекты → Enter");
  }
  if (tool === "fillet") {
    promptFilletRadius();   // задать радиус при входе в инструмент
    // раньше инструкция уходила ТОЛЬКО в скрытый #st-hint: после диалога радиуса
    // пользователь оставался без единой подсказки, что делать дальше
    toast("Режим «Сопрячь»: клик по углу линии или контура — угол скругляется дугой");
    setHint("«Сопрячь»: клик по углу — скругление дугой заданного радиуса");
  }
  if (tool === "rotate" || tool === "scale" || tool === "mirror") xfStart(tool);
  else state.xf = null;
  // геом-инструмент против несовместимого слоя — слой переключается сам
  if (!opts.keepLayer && GEOM_OF_TOOL[tool] && !toolFitsLayer(tool, activeLayer())) {
    // подходящий слой рисуемой геометрии — но не приёмник импорта и не аннотация
    const fit = LAYERS_V2.find(l => isDrawableLayer(l) &&
                                    l.geometry_type === GEOM_OF_TOOL[tool]);
    if (fit) { state.activeLayerId = fit.id; renderLayers(); }
    else {
      // Пустой проект больше не тупик: слой под нужную геометрию заводится сам.
      // Раньше здесь был тост «Создайте слой» и выключенные инструменты —
      // человек упирался в экран-гид вместо того, чтобы чертить.
      const geom = GEOM_OF_TOOL[tool];
      const layer = createGenericLayer({ geometry_type: geom, title: AUTO_LAYER_TITLE[geom] });
      if (layer) {
        state.activeLayerId = layer.id;
        renderLayers();
        toast(`Слой «${layer.title}» создан — чертите`);
      }
    }
  }
  updateLayerStatus();
  document.querySelectorAll("#toolbar button[data-tool]").forEach(
    b => {
      const active = b.dataset.tool === tool;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  cv.style.cursor = tool === "select" ? "default" : "crosshair";
  // Режим работы обязан догонять инструмент. Инструмент включается не только
  // кнопкой: горячая клавиша, кнопка «Повернуть» в панели свойств, восстановление
  // сеанса. Если при этом режим остаётся прежним, кнопка инструмента спрятана
  // правилом режима — включённый инструмент есть, а нажатой кнопки нет, и человек
  // чертит вслепую. Слушателя ставит redesign/workspace.js: он знает раскладку
  // режимов, а этот файл — нет.
  document.dispatchEvent(new CustomEvent("grado:tool", { detail: { tool } }));
  draw();
}
function setActiveLayer(id) {
  const L = LAYER_BY_ID[id];
  if (!L) return;
  // import-only (источник) и аннотационные слои — не цели рисования: иначе
  // объект молча уходил бы в проектный слой (LAYER_BY_KIND по kind)
  if (L.import_only || L.annotation) {
    toast(`Слой «${L.title}» заполняется только импортом — рисовать в него нельзя. `
      + `Создайте свой слой: «Слой / знак» → «Новый слой»`);
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
on("btn-merge", "click", () => mergeSelectedPolygons());

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
function setTopoEdit(v, quiet = false) {
  state.topoEdit = !!v;
  const button = document.getElementById("btn-topo");
  if (button) {
    button.classList.toggle("active", state.topoEdit);
    button.setAttribute("aria-pressed", String(state.topoEdit));
  }
  if (!quiet)
    toast(state.topoEdit
      ? "Общие границы: вершины соседних зон двигаются вместе"
      : "Общие границы выключены: объекты двигаются по отдельности");
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
on("btn-topo", "click", () => setTopoEdit(!state.topoEdit));
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
on("btn-array", "click", openArrayDialog);
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
    overlay.innerHTML = `<div class="modal preflight-modal" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Выпуск</span><span id="preflight-title">Проверка перед выпуском</span></div></div>
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
  // Сохранение проекта — не выпуск документа. Проверка перед выпуском следит
  // за качеством ЧЕРТЕЖА, и её ошибки запирали ещё и .grado: когда с проектом
  // что-то не так, пользователь не мог даже сохранить работу — резервный канал
  // отказывал ровно тогда, когда нужнее всего. .grado идёт мимо проверки.
  const isProjectFile = url === "/api/grado";
  downloadInProgress = true;
  exportButtons.forEach(button => { button.disabled = true; });
  toast(isProjectFile ? action : "Проверяю проект перед выпуском…");
  try {
    if (!isProjectFile) {
      const target = url.replace("/api/", "");
      // Недоступная проверка тоже запирала выпуск. Проверка — помощник, а не
      // страж: не ответила — предупреждаем и выпускаем.
      let report = null;
      try {
        const checkResponse = await fetch("/api/preflight", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ features, layers: payload.layers, target }),
        });
        if (checkResponse.ok) report = await checkResponse.json();
      } catch (error) { report = null; }
      if (!report) toast("Проверка недоступна — выпускаю без неё", "warn");
      else if (!(await showPreflightReport(report))) {
        if (report.errors.length) toast("Исправьте замечания перед выпуском", "warn");
        else toast("Выпуск отменён");
        return;
      }
      toast(action);
    }
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
    toast("Не удалось собрать файл: " + String(error.message || error).slice(0, 180)
      + ". Сохраните проект файлом и повторите", "error");
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
on("btn-dxf", "click", () => {
  // В браузере DXF собирается на месте (app-dxf.js); с сервером — как раньше.
  if (typeof exportDxf === "function") { exportDxf(); return; }
  download("/api/dxf", ".dxf");
});
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
      if (isSafeDictionaryKey(id) && isRecord(style)) projectStyles[id] = sanitizeProjectStyle(style);
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
    topoEdit: restored.topoEdit === true,
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
  // schema_version штамповался при сохранении, но при восстановлении не
  // читался вовсе. Опасная комбинация с кэшем GitHub Pages: старый
  // закэшированный код открывал снимок НОВОЙ схемы, collectState пересобирал
  // его по своему белому списку полей — и первый же автосейв записывал
  // усечённую версию. Данные новых полей терялись необратимо. Предупреждаем.
  const snapshotSchema = Number((d && d.state && d.state.schema_version)
    ?? (d && d.schema_version));
  if (Number.isFinite(snapshotSchema) && snapshotSchema > STATE_SCHEMA_VERSION) {
    toast(`Проект сохранён более новой версией приложения (схема ${snapshotSchema} `
      + `против ${STATE_SCHEMA_VERSION}). Обновите страницу с Ctrl+F5 — иначе часть `
      + "данных не будет понята и может пропасть при сохранении", "error");
  }
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
  state.sheetLegend = isRecord(d.sheetLegend) && Array.isArray(d.sheetLegend.groups)
    ? d.sheetLegend : null;
  // координаты в файле уже в СК проекта — только включаем преобразования
  state.projectCrsId = typeof d.projectCrsId === "string" ? d.projectCrsId : "utm37-legacy";
  state.alignOgd = d.alignOgd !== false;
  if (state.projectCrsId !== "auto")
    applyProjectCrs(state.projectCrsId, { reproject: false, silent: true });
  state.osnap = d.osnap !== false;
  setTopoEdit(d.topoEdit === true, true);
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

// Ширину тянут ОБЕ боковые панели: правая (инспектор) и левая (слои). Раньше
// левая была намертво 320px, хотя именно в ней списки слоёв с длинными
// названиями выгрузок портала. Логика одна, отличается сторона: у панели
// слева перетаскивание вправо РАСШИРЯЕТ её, у панели справа — сужает.
function initSidePanelResizer(config) {
  const resizer = document.getElementById(config.resizerId);
  const panel = document.getElementById(config.panelId);
  if (!resizer || !panel) return;
  const toolbar = document.getElementById('toolbar');
  const other = config.otherPanelId ? document.getElementById(config.otherPanelId) : null;
  const MIN_WIDTH = config.min, MAX_WIDTH = config.max, MIN_STAGE_WIDTH = 420;
  let preferredWidth = config.def;
  try {
    const saved = localStorage.getItem(config.storageKey);
    if (saved) preferredWidth = parseInt(saved, 10) || preferredWidth;
  } catch (e) {}

  const effectiveMaxWidth = () => {
    const railWidth = toolbar?.offsetWidth || 76;
    const otherWidth = other && getComputedStyle(other).visibility !== 'hidden' ? other.offsetWidth : 0;
    const available = window.innerWidth - railWidth - otherWidth - resizer.offsetWidth - MIN_STAGE_WIDTH;
    const viewportShare = Math.floor(window.innerWidth * 0.48);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportShare, Math.max(MIN_WIDTH, available)));
  };
  const setWidth = (width, remember = false) => {
    const maxWidth = effectiveMaxWidth();
    const value = Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(width)));
    if (remember) preferredWidth = value;
    panel.style.flexBasis = value + 'px';
    // Переменную ставим на КОРЕНЬ документа, а не на саму панель: её читает
    // панель инструментов (#toolbar стоит на left:calc(var(--layer-panel-width)
    // + 12px)), а она панели не потомок — при расширении слоёв рельс оставался
    // на месте и налезал на список.
    if (config.side === 'left')
      document.documentElement.style.setProperty('--layer-panel-width', value + 'px');
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
    // захват указателя — удобство (курсор не теряется за краем), но не условие:
    // если браузер его не даёт, тянуть панель всё равно должно быть можно
    try { resizer.setPointerCapture(e.pointerId); } catch (error) {}
    document.body.classList.add('panel-resizing');
    const pointerId = e.pointerId;
    const move = ev => {
      const dx = ev.clientX - startX;
      setWidth(config.side === 'left' ? startW + dx : startW - dx, true);
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
      try { if (resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId); } catch (error) {}
      document.body.classList.remove('panel-resizing');
      try { localStorage.setItem(config.storageKey, preferredWidth); } catch (e) {}
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
    const grow = config.side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = config.side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === grow) width += 20;
    else if (e.key === shrink) width -= 20;
    else if (e.key === 'Home') width = MIN_WIDTH;
    else if (e.key === 'End') width = effectiveMaxWidth();
    else return;
    e.preventDefault();
    width = setWidth(width, true);
    try { localStorage.setItem(config.storageKey, width); } catch (error) {}
  });
  window.addEventListener('resize', () => setWidth(preferredWidth));
}
function initPanelResizer() {
  initSidePanelResizer({ resizerId: 'panel-resizer', panelId: 'panel', otherPanelId: 'layers-panel',
    side: 'right', min: 300, max: 640, def: 312, storageKey: 'grado_panel_width' });
  initSidePanelResizer({ resizerId: 'layers-resizer', panelId: 'layers-panel', otherPanelId: 'panel',
    side: 'left', min: 240, max: 520, def: 320, storageKey: 'grado_layers_width' });
}

// ---------- целостность загрузки ----------
//
// Приложение собрано из четырёх десятков отдельных файлов. Любой может не
// прийти: сеть, обновление сайта (на проде поймали 503 ровно в момент подмены
// файлов). Тогда половина функций просто отсутствует, а человек видит
// невнятную «Ошибку интерфейса» и не понимает, что делать.
//
// Проверяем по одному опорному имени на файл — не всё подряд, а то, без чего
// файл бесполезен. Список нарочно короткий: он должен пережить переименования
// внутри файлов, но поймать «файл не загрузился вовсе».
const ОПОРНЫЕ_ИМЕНА = [
  ["drawChain", "отрисовка"], ["drawNow", "подписи и сцена"], ["refreshTep", "ТЭП"],
  ["renderLayers", "панель слоёв"], ["hitTest", "правка геометрии"],
  ["cursorPoint", "привязки"], ["openLayerStyle", "оформление слоёв"],
  ["openDataFetch", "данные по области"], ["openAttributeTable", "таблица атрибутов"],
  ["exportDxf", "выгрузка DXF"], ["parseInputLine", "точный ввод"],
];
function checkBundleIntegrity() {
  const нет = ОПОРНЫЕ_ИМЕНА.filter(([имя]) => typeof window[имя] !== "function");
  if (!нет.length) return true;
  const бар = document.getElementById("errbar");
  if (!бар) return false;
  const текст = document.createElement("span");
  текст.textContent = "Часть приложения не загрузилась (" +
    нет.map(([, что]) => что).join(", ") + "). Обычно это обрыв сети или " +
    "обновление сайта прямо сейчас. Обновите страницу — проект сохранён.";
  const кнопка = document.createElement("button");
  кнопка.type = "button";
  кнопка.className = "errbar-close";
  кнопка.textContent = "Обновить";
  кнопка.onclick = () => location.reload();
  бар.replaceChildren(текст, кнопка);
  бар.hidden = false;
  бар.style.display = "flex";
  console.error("не загрузились части:", нет.map(([имя]) => имя));
  return false;
}
// После полной загрузки: раньше проверять нельзя — отложенные файлы ещё идут.
window.addEventListener("load", () => setTimeout(checkBundleIntegrity, 0));
