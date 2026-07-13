// ============================================================================
//  app-style-ui.js — UI оформления слоя: диалог «Оформление слоя»
//  (openLayerStyle: единый стиль / по значению поля), библиотека знаков
//  (openStyleLibrary), выбор стиля (stylePickerOptions), цвет-хелперы
//  (toHexColor/normHex/hexToCmyk/cmykToHex/COLOR_PALETTE/makeColorField),
//  loadStyleOverrides. Вынесено из монолита app.js (P0-разрез). Классический
//  скрипт, общий global-scope, грузится ПЕРЕД app.js (on("btn-style-lib")
//  ссылается на openStyleLibrary; renderLayers передаёт openLayerStyle).
//  Только определения. Общие примитивы (escHtml/uiPrompt/uiConfirm), рендер и
//  styleOf/layerStyle — остаются в app.js, вызываются runtime кросс-файлово.
// ============================================================================

// ---------- выбор стиля из системной библиотеки (default + Эталон ЛГР) ----------
// Опции сгруппированы по group из библиотеки; value = style_id.
function stylePickerOptions(selectedId) {
  const groups = new Map();
  for (const [sid, s] of Object.entries(STYLES_V2)) {
    if (!s.title) continue;              // безымянные/служебные не предлагаем
    const g = s.group || "Базовые";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([sid, s.title]);
  }
  // Стили проекта — своя группа, полностью кастомные внутри проекта
  const proj = state.projectStyles || {};
  if (Object.keys(proj).length) {
    const items = [];
    for (const [sid, s] of Object.entries(proj)) {
      items.push([sid, s.title || sid]);
    }
    if (items.length) groups.set("Стили этого проекта", items);
  }
  let html = `<option value=""${!selectedId ? " selected" : ""}>— по умолчанию —</option>`;
  for (const [g, items] of groups) {
    html += `<optgroup label="${g}">`;
    for (const [sid, title] of items.sort((a, b) => a[1].localeCompare(b[1], "ru")))
      html += `<option value="${sid}"${sid === selectedId ? " selected" : ""}>${title}</option>`;
    html += `</optgroup>`;
  }
  // опция создания нового (будет обработана в onchange если нужно)
  html += `<option value="__create_project_style__">+ Создать свой стиль…</option>`;
  return html;
}

// ---------- форматирование слоя ----------
function toHexColor(c, fallback) {
  if (!c) return fallback;
  if (c[0] === "#") return c.slice(0, 7);
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map(x => parseInt(x.trim()));
    return "#" + [r, g, b].map(v => (v || 0).toString(16).padStart(2, "0")).join("");
  }
  return fallback;
}

// ---------- выбор цвета: палитра + HEX + CMYK (взамен нативного input) ----------
// кураторская палитра планировочных / ЛГР-цветов (Эталон приказа №65) + базовые
const COLOR_PALETTE = [
  ["Красный (КЛ/ЗОУИТ)", "#df0024"], ["Пурпурный", "#e3007b"], ["Сиреневый", "#b18dbe"],
  ["Синий (вода)", "#0669b2"], ["Голубой", "#20e6f2"], ["Голубой (затоп.)", "#8cbeff"],
  ["Светло-синий", "#94c5ff"], ["Зелёный (ООЗТ)", "#009f3c"], ["Салатовый (СЗЗ)", "#7cc623"],
  ["Мятный", "#abe6d2"], ["Жёлтый (ООПТ)", "#f8f400"], ["Бежевый (зона)", "#faf0bf"],
  ["Оранжевый", "#eb880e"], ["Коричневый", "#694720"], ["Фиолетовый", "#3d107b"],
  ["Чёрный", "#1c1c1a"], ["Тёмно-серый", "#4a4a4a"], ["Серый", "#888888"],
  ["Св.-серый", "#c8c8c8"], ["Белый", "#ffffff"],
];
function normHex(h) {
  h = (h || "").trim(); if (h[0] !== "#") h = "#" + h;
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}
function hexToCmyk(hex) {
  const h = normHex(hex) || "#000000";
  const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255,
        b = parseInt(h.slice(5, 7), 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.9999) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
    .map(v => Math.round(v * 100));
}
function cmykToHex(c, m, y, k) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  const ch = v => Math.max(0, Math.min(255, Math.round(255 * (1 - v) * (1 - k))))
    .toString(16).padStart(2, "0");
  return "#" + ch(c) + ch(m) + ch(y);
}
// host — контейнер; onChange(hex) при смене. Возвращает {get,set,close}.
function makeColorField(host, initial, onChange) {
  let value = normHex(initial) || "#888888", pop = null, onDoc = null, onViewport = null;
  host.classList.add("cfield");
  host.innerHTML = `<button type="button" class="cfield-btn">
    <span class="cfield-sw"></span><span class="cfield-hex"></span>
    <svg class="ic cfield-caret"><use href="#ic-chevron"/></svg></button>`;
  const btn = host.querySelector(".cfield-btn");
  const sw = host.querySelector(".cfield-sw"), hexLbl = host.querySelector(".cfield-hex");
  const paint = () => { sw.style.background = value; hexLbl.textContent = value; };
  const setValue = (hex, fire = true) => {
    const h = normHex(hex); if (!h) return;
    value = h; paint(); if (pop) syncPop(); if (fire) onChange(h);
  };
  function syncPop() {
    if (!pop) return;
    const [c, m, y, k] = hexToCmyk(value);
    pop.querySelector(".cf-hexin").value = value;
    for (const [key, v] of [["c", c], ["m", m], ["y", y], ["k", k]])
      pop.querySelector(`[data-k="${key}"]`).value = v;
    pop.querySelectorAll(".cf-swatch").forEach(s =>
      s.classList.toggle("sel", s.dataset.hex === value));
  }
  function close() {
    if (!pop) return;
    pop.remove(); pop = null; btn.classList.remove("open");
    document.removeEventListener("mousedown", onDoc, true);
    window.removeEventListener("resize", onViewport);
    window.removeEventListener("scroll", onViewport, true);
  }
  function open() {
    if (pop) { close(); return; }
    pop = document.createElement("div");
    pop.className = "cfield-pop";
    pop.innerHTML = `<div class="cf-grid">${COLOR_PALETTE.map(([n, h]) =>
      `<button type="button" class="cf-swatch" data-hex="${h}" title="${n}" style="background:${h}"></button>`).join("")}</div>
      <label class="cf-row cf-hex-row"><span>HEX</span><input class="cf-hexin" type="text" maxlength="7" spellcheck="false"></label>
      <div class="cf-cmyk"><span>CMYK</span>
        <label>C<input type="number" data-k="c" min="0" max="100" title="Cyan"></label>
        <label>M<input type="number" data-k="m" min="0" max="100" title="Magenta"></label>
        <label>Y<input type="number" data-k="y" min="0" max="100" title="Yellow"></label>
        <label>K<input type="number" data-k="k" min="0" max="100" title="Key/чёрный"></label></div>`;
    pop.classList.add("cfield-pop-portal");
    document.body.appendChild(pop);
    btn.classList.add("open");
    pop.querySelectorAll(".cf-swatch").forEach(s =>
      s.addEventListener("click", () => { setValue(s.dataset.hex); close(); }));
    pop.querySelector(".cf-hexin").addEventListener("input", e => {
      const h = normHex(e.target.value); if (h) setValue(h);
    });
    pop.querySelectorAll(".cf-cmyk input").forEach(inp =>
      inp.addEventListener("input", () => {
        const g = key => Math.max(0, Math.min(100, +pop.querySelector(`[data-k="${key}"]`).value || 0));
        setValue(cmykToHex(g("c"), g("m"), g("y"), g("k")));
      }));
    syncPop();
    const positionPop = () => {
      if (!pop) return;
      const r = btn.getBoundingClientRect();
      const width = Math.min(336, window.innerWidth - 24);
      pop.style.width = `${width}px`;
      pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
      const h = pop.offsetHeight;
      const below = window.innerHeight - r.bottom;
      pop.style.top = below >= h + 10 ? `${r.bottom + 6}px` : `${Math.max(12, r.top - h - 6)}px`;
    };
    positionPop();
    // закрытие по клику вне поля; capture — минует stopPropagation модалки.
    // Регистрируем сразу: открывающий mousedown кнопки уже прошёл (open() —
    // из обработчика click), поэтому само-закрытия не будет.
    onDoc = e => { if (!host.contains(e.target) && !(pop && pop.contains(e.target))) close(); };
    onViewport = () => close();
    document.addEventListener("mousedown", onDoc, true);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
  }
  btn.addEventListener("click", e => { e.preventDefault(); open(); });
  paint();
  return { get: () => value, set: h => setValue(h, false), close };
}

// ---------- оформление слоя: единый стиль ИЛИ по значению поля ------------
// Объединяет прежние «Форматирование» и «Условное форматирование» в одну
// модалку с переключателем режима — как символика слоя в QGIS (single symbol
// / categorized). «Единый стиль» пишет layer.fmt и очищает правила; «По
// значению поля» сохраняет layer.rules (категории) поверх layer.fmt, который
// служит стилем по умолчанию для объектов без совпадения.
function openLayerStyle(layer, opts = {}) {
  closePopups();
  const historyBefore = window.captureHistoryState ? window.captureHistoryState() : null;
  const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const origFmt = clone(layer.fmt);   // для отмены
  const origRules = clone(layer.rules);
  let mode = opts.mode || (origRules && origRules.length ? "rules" : "single");
  const cur = layerStyle(layer);
  const hasFill = cur.fill != null && cur.fill !== "transparent";
  const opacity = Math.round((cur.fillOpacity != null ? cur.fillOpacity : 1) * 100);
  const dp = dashPresetOf(cur.dash);
  const hObj = cur.hatch && typeof cur.hatch === "object" ? cur.hatch : null;
  const hAngle = hObj ? (hObj.cross ? "cross" : String(hObj.angle ?? 45)) : "45";
  const hDens = hObj ? hatchDensOf(hObj.spacing_px || 9) : "normal";
  let baseMarker = cur.line_marker || null, baseLabel = cur.line_label || null,
      baseDouble = cur.double || null;
  const targets = LAYERS_V2.filter(l => l !== layer && !l.annotation && !l.import_only);
  const targetOriginals = new Map(targets.map(target => [target, clone(target.fmt)]));
  const copiedTargets = new Set();
  const opt = (sel, v, lbl) => `<option value="${v}"${sel === v ? " selected" : ""}>${lbl}</option>`;
  // рабочая копия правил для режима «по значению поля»
  const fieldCols = attrColumns(layer).filter(c => !c.virtual);
  // подпись объектов: поле + шрифт (кегль/цвет/семейство). Холст подписывает
  // полигоны по центроиду (label_field), поэтому секция только для них.
  const isPoly = layer.geometry_type === "polygon";
  const curLF = cur.label_field || "";
  const lfFont = cur.label_font || {};
  const labelCols = fieldCols.slice();
  if (curLF && !labelCols.some(c => c.name === curLF))
    labelCols.push({ name: curLF, label: curLF });
  let work = (layer.rules || []).map(r => ({ op: "=", ...r }));
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal fmt-modal fmt-modal-lg style-editor-modal" role="dialog" aria-modal="true" aria-labelledby="style-editor-title">
    <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Стиль слоя</span><span id="style-editor-title">Оформление · ${escHtml(layer.title)}</span></span>
      <button class="modal-x" aria-label="Закрыть оформление слоя"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact style-editor-body">
    <div class="seg" id="ls-mode" role="tablist" aria-label="Режим оформления">
      <button type="button" role="tab" aria-selected="${mode === "single"}" class="seg-btn${mode === "single" ? " active" : ""}" data-mode="single">Единый стиль</button>
      <button type="button" role="tab" aria-selected="${mode === "rules"}" class="seg-btn${mode === "rules" ? " active" : ""}" data-mode="rules">По значению поля</button>
    </div>
    <div id="ls-single" style="display:${mode === "single" ? "" : "none"}">
      <label class="style-preset-label"><span>Базовый знак</span><select id="fmt-preset">${stylePickerOptions(layer.fmt && layer.fmt.style_ref)}</select></label>
      <div class="style-editor-grid">
        <div class="style-controls">
          <section class="style-section">
            <div class="style-section-head"><span><b>Заливка</b><small>Цвет и прозрачность полигона</small></span><label class="switch-control" title="Включить заливку"><input type="checkbox" id="fmt-hasfill" aria-label="Включить заливку" ${hasFill ? "checked" : ""}><span></span></label></div>
            <div class="fmt-body" id="fmt-fill-body" style="display:${hasFill ? "" : "none"}"><div class="fmt-row">
              <label>Цвет<div id="fmt-fill"></div></label>
              <label>Непрозрачность<input type="range" id="fmt-opacity" min="10" max="100" step="5" value="${opacity}"></label>
            </div></div>
          </section>
          <section class="style-section">
            <div class="style-section-head"><span><b>Обводка</b><small>Контур, толщина и тип линии</small></span></div>
            <div class="fmt-row"><label>Цвет<div id="fmt-stroke"></div></label>
              <label>Толщина, px<input type="number" id="fmt-width" value="${cur.width ?? 1}" min="0.2" max="8" step="0.1"></label></div>
            <div class="fmt-row"><label>Тип линии<select id="fmt-dashp">${
              opt(dp, "solid", "Сплошная") + opt(dp, "dash", "Штрих") +
              opt(dp, "dashdot", "Штрих-пунктир") + opt(dp, "dashdotdot", "Штрих — две точки") +
              opt(dp, "custom", "Свой шаблон…")}</select></label>
              <label id="fmt-dash-custom-wrap" style="display:${dp === "custom" ? "" : "none"}">Шаблон, px
                <input type="text" id="fmt-dash-custom" placeholder="8, 3, 2, 3" value="${escHtml(dashToStr(dp === "custom" ? cur.dash : null))}"></label></div>
          </section>
          <section class="style-section">
            <div class="style-section-head"><span><b>Штриховка</b><small>Дополнительный рисунок зоны</small></span><label class="switch-control" title="Включить штриховку"><input type="checkbox" id="fmt-hatch" aria-label="Включить штриховку" ${cur.hatch ? "checked" : ""}><span></span></label></div>
            <div class="fmt-body" id="fmt-hatch-body" style="display:${cur.hatch ? "" : "none"}"><div class="fmt-row">
              <label>Угол<select id="fmt-hangle">${
                opt(hAngle, "0", "0° —") + opt(hAngle, "45", "45° ╱") + opt(hAngle, "90", "90° │") +
                opt(hAngle, "135", "135° ╲") + opt(hAngle, "cross", "Сетка ✕")}</select></label>
              <label>Плотность<select id="fmt-hdens">${
                opt(hDens, "sparse", "Редкая") + opt(hDens, "normal", "Обычная") + opt(hDens, "dense", "Плотная")}</select></label>
            </div></div>
          </section>
          <section class="style-section">
            <div class="style-section-head"><span><b>Маркеры линии</b><small>Засечки и направление границы</small></span><label class="switch-control" title="Включить маркеры"><input type="checkbox" id="fmt-marker" aria-label="Включить маркеры линии" ${baseMarker ? "checked" : ""}><span></span></label></div>
            <div class="fmt-body" id="fmt-marker-fields" style="display:${baseMarker ? "" : "none"}">
              <div class="fmt-row"><label>Форма<select id="fmt-marker-shape">${MARKER_SHAPES.map(([v, lbl]) => opt((baseMarker && baseMarker.shape) || "tick", v, lbl)).join("")}</select></label>
                <label>Направление<select id="fmt-marker-dir">${opt((baseMarker && baseMarker.dir) || "in", "in", "Внутрь зоны") + opt((baseMarker && baseMarker.dir) || "in", "out", "Наружу")}</select></label></div>
              <div class="fmt-row"><label>Шаг, px<input type="number" id="fmt-marker-period" value="${(baseMarker && baseMarker.period) || 40}" min="6" max="200" step="1"></label>
                <label>Размер, px<input type="number" id="fmt-marker-size" value="${(baseMarker && baseMarker.size) || 4}" min="1" max="40" step="0.5"></label></div>
            </div>
          </section>
          <section class="style-section style-section-compact"><label class="style-check"><input type="checkbox" id="fmt-label" ${baseLabel ? "checked" : ""}><span><b>Подпись линии</b><small>Использовать подпись из знака ЛГР</small></span></label></section>
          ${isPoly ? `<section class="style-section"><div class="style-section-head"><span><b>Подпись объектов</b><small>Поле и параметры текста</small></span></div>
            <label>Поле подписи<select id="fmt-labelf"><option value="">— без подписи —</option>${labelCols.map(c => opt(curLF, c.name, c.label || c.name)).join("")}</select></label>
            <div class="fmt-body" id="fmt-labelf-fields" style="display:${curLF ? "" : "none"}"><div class="fmt-row">
              <label>Кегль, px<input type="number" id="fmt-lsize" value="${lfFont.size || 11}" min="6" max="72" step="0.5"></label>
              <label>Шрифт<select id="fmt-lfamily">${opt(lfFont.family || "ui", "ui", "Системный") + opt(lfFont.family || "ui", "serif", "С засечками") + opt(lfFont.family || "ui", "mono", "Моноширинный")}</select></label>
            </div><label>Цвет<div id="fmt-lcolor"></div></label></div>
          </section>` : ""}
          ${targets.length ? `<section class="style-section"><div class="style-section-head"><span><b>Применить к другим слоям</b><small>Копирует текущие настройки оформления</small></span></div>
            <div class="fmt-row fmt-copy-row"><label>Слой<select id="fmt-copy-to"><option value="__all__">— все слои —</option>${targets.map(l => `<option value="${l.id}">${escHtml(l.title)}</option>`).join("")}</select></label>
              <button id="fmt-copy" class="fmt-copy-btn">Скопировать</button></div>
          </section>` : ""}
        </div>
        <aside class="style-preview-panel" aria-label="Предпросмотр оформления">
          <span class="style-preview-kicker">Предпросмотр</span>
          <div class="style-preview-canvas"><div id="fmt-preview-shape" class="style-preview-shape"></div></div>
          <div class="line-preview" id="fmt-dash-preview"></div>
          <p>Изменения сразу отображаются на холсте. «Отмена» вернёт исходный стиль.</p>
        </aside>
      </div>
    </div>
    <div id="ls-rules" style="display:${mode === "rules" ? "" : "none"}">
      <div class="fc-help" id="cr-help">${fieldCols.length
        ? "Знак объекта выбирается по значению его атрибута. Первое совпавшее правило побеждает; объекты без совпадения рисуются единым стилем слоя (вкладка слева)."
        : "В этом слое пока нет полей. Сначала добавьте поле через таблицу атрибутов слоя — после этого здесь можно будет создать правило."}</div>
      <div class="mf-table-wrap"><table class="attr-table mf-table"><thead><tr><th>Поле</th><th>Оп</th><th>Значение</th><th>Знак</th><th></th></tr></thead>
        <tbody id="cr-body"></tbody></table></div>
      <button id="cr-add" class="fmt-copy-btn" aria-describedby="cr-help"${fieldCols.length ? "" : " disabled"}>+ правило</button>
    </div>
    </div>
    <div class="modal-actions">
      <button id="ls-reset">Сбросить</button>
      <span class="spacer"></span>
      <button id="ls-cancel">Отмена</button>
      <button id="ls-apply" class="primary">Применить стиль</button>
    </div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const $ = id => overlay.querySelector("#" + id);

  // ----- режим «Единый стиль» -----
  const onColor = () => { $("fmt-preset").value = ""; layer.fmt = collect(); draw(); updateDashPreview(); };
  const fillCF = makeColorField($("fmt-fill"), toHexColor(cur.fill, "#faf0bf"), onColor);
  const strokeCF = makeColorField($("fmt-stroke"), toHexColor(cur.stroke, "#888888"), onColor);
  const lcolorCF = $("fmt-lcolor")
    ? makeColorField($("fmt-lcolor"), toHexColor(lfFont.color, "#5c5a54"), onColor) : null;
  const closeColorFields = () => { fillCF.close(); strokeCF.close(); if (lcolorCF) lcolorCF.close(); };
  if ($("fmt-labelf")) $("fmt-labelf").addEventListener("change", () => {
    $("fmt-labelf-fields").style.display = $("fmt-labelf").value ? "" : "none";
  });
  const currentDash = () => $("fmt-dashp").value === "custom"
    ? parseDashStr($("fmt-dash-custom").value)
    : (DASH_PRESETS[$("fmt-dashp").value] ?? null);
  const updateDashPreview = () => {
    const wv = Math.max(0.2, parseFloat($("fmt-width").value) || 1);
    $("fmt-dash-preview").innerHTML = lineSampleSVG(currentDash(), strokeCF.get(), wv);
    const shape = $("fmt-preview-shape");
    const alpha = Math.round(((parseInt($("fmt-opacity").value) || 100) / 100) * 255)
      .toString(16).padStart(2, "0");
    shape.style.background = $("fmt-hasfill").checked ? fillCF.get() + alpha : "transparent";
    shape.style.borderColor = strokeCF.get();
    shape.style.borderWidth = `${Math.min(8, wv)}px`;
    shape.style.borderStyle = $("fmt-dashp").value === "solid" ? "solid" : "dashed";
    shape.classList.toggle("hatched", $("fmt-hatch").checked);
  };
  updateDashPreview();
  const setDashFields = dash => {
    const preset = dashPresetOf(dash);
    $("fmt-dashp").value = preset;
    $("fmt-dash-custom").value = preset === "custom" ? dashToStr(dash) : "";
    $("fmt-dash-custom-wrap").style.display = preset === "custom" ? "" : "none";
  };
  const setMarkerFields = m => {
    baseMarker = m || null;
    $("fmt-marker").checked = !!m;
    $("fmt-marker-fields").style.display = m ? "" : "none";
    $("fmt-marker-shape").value = (m && m.shape) || "tick";
    $("fmt-marker-period").value = (m && m.period) || 40;
    $("fmt-marker-size").value = (m && m.size) || 4;
    $("fmt-marker-dir").value = (m && m.dir) || "in";
  };
  $("fmt-dashp").addEventListener("change", () => {
    $("fmt-dash-custom-wrap").style.display = $("fmt-dashp").value === "custom" ? "" : "none";
  });
  $("fmt-marker").addEventListener("change", () => {
    $("fmt-marker-fields").style.display = $("fmt-marker").checked ? "" : "none";
  });
  // тумблеры секций: тело показывается только когда секция включена
  const syncBodies = () => {
    $("fmt-fill-body").style.display = $("fmt-hasfill").checked ? "" : "none";
    $("fmt-hatch-body").style.display = $("fmt-hatch").checked ? "" : "none";
  };
  $("fmt-hasfill").addEventListener("change", syncBodies);
  $("fmt-hatch").addEventListener("change", syncBodies);
  const collect = () => {
    const fmt = {
      stroke: strokeCF.get(),
      width: Math.max(0.2, parseFloat($("fmt-width").value) || 1),
      fill: $("fmt-hasfill").checked ? fillCF.get() : null,
      fillOpacity: (parseInt($("fmt-opacity").value) || 100) / 100,
      dash: currentDash(),
    };
    if ($("fmt-hatch").checked) {
      const av = $("fmt-hangle").value;
      fmt.hatch = { angle: av === "cross" ? 45 : +av, cross: av === "cross",
                    spacing_px: HATCH_DENS[$("fmt-hdens").value] || 9,
                    color: strokeCF.get() };
    } else fmt.hatch = false;
    if ($("fmt-marker").checked) {
      fmt.line_marker = {
        shape: $("fmt-marker-shape").value || "tick",
        period: Math.max(4, parseFloat($("fmt-marker-period").value) || 40),
        size: Math.max(0.5, parseFloat($("fmt-marker-size").value) || 4),
        dir: $("fmt-marker-dir").value === "out" ? "out" : "in",
      };
    } else fmt.line_marker = null;
    if ($("fmt-label").checked) { if (baseLabel) fmt.line_label = baseLabel; }
    else fmt.line_label = null;
    if ($("fmt-labelf")) {
      const lff = $("fmt-labelf").value;
      fmt.label_field = lff || null;   // null явно глушит подпись знака (напр. этажность)
      fmt.label_font = lff ? {
        size: Math.min(72, Math.max(6, parseFloat($("fmt-lsize").value) || 11)),
        color: lcolorCF.get(),
        family: $("fmt-lfamily").value || "ui",
      } : null;
    }
    if (baseDouble) fmt.double = baseDouble;
    const ref = $("fmt-preset").value;
    if (ref) fmt.style_ref = ref;
    return fmt;
  };
  $("fmt-preset").addEventListener("change", async () => {
    const ref = $("fmt-preset").value;
    if (ref === "__create_project_style__") {
      const newId = await createProjectStyle();
      if (newId) {
        const sel = $("fmt-preset");
        sel.innerHTML = stylePickerOptions(newId);
        sel.value = newId;
        if (!layer.fmt) layer.fmt = {};
        layer.fmt.style_ref = newId;
        draw();
      } else {
        $("fmt-preset").value = (layer.fmt && layer.fmt.style_ref) || "";
      }
      return;
    }
    if (ref && (state.projectStyles[ref] || STYLES_V2[ref])) {
      const p = state.projectStyles[ref] || STYLES_V2[ref];
      $("fmt-hasfill").checked = !!p.fill;
      if (p.fill) fillCF.set(toHexColor(p.fill, "#faf0bf"));
      strokeCF.set(toHexColor(p.stroke, "#888888"));
      $("fmt-width").value = p.width ?? 1;
      setDashFields(p.dash);
      const ph = p.hatch && typeof p.hatch === "object" ? p.hatch : null;
      $("fmt-hatch").checked = !!p.hatch;
      $("fmt-hangle").value = ph ? (ph.cross ? "cross" : String(ph.angle ?? 45)) : "45";
      $("fmt-hdens").value = ph ? hatchDensOf(ph.spacing_px || 9) : "normal";
      setMarkerFields(p.line_marker || null);
      baseLabel = p.line_label || null; baseDouble = p.double || null;
      $("fmt-label").checked = !!baseLabel;
      if ($("fmt-labelf")) {   // подпись — из знака-пресета, шрифт к дефолту
        const plf = p.label_field || "";
        if (plf && ![...$("fmt-labelf").options].some(o => o.value === plf)) {
          const o = document.createElement("option");
          o.value = plf; o.textContent = plf;
          $("fmt-labelf").appendChild(o);
        }
        $("fmt-labelf").value = plf;
        $("fmt-labelf-fields").style.display = plf ? "" : "none";
        $("fmt-lsize").value = 11; $("fmt-lfamily").value = "ui";
        lcolorCF.set("#5c5a54");
      }
      syncBodies();
    }
    layer.fmt = collect(); draw(); updateDashPreview();
  });
  $("ls-single").querySelectorAll("input, select").forEach(el => {
    if (el.id === "fmt-preset" || el.id === "fmt-copy-to") return;
    for (const ev of ["input", "change"])
      el.addEventListener(ev, () => {
        $("fmt-preset").value = ""; layer.fmt = collect(); draw(); updateDashPreview();
      });
  });
  if ($("fmt-copy")) $("fmt-copy").addEventListener("click", () => {
    const fmt = collect(); layer.fmt = fmt;
    const to = $("fmt-copy-to").value;
    const dest = to === "__all__" ? targets : targets.filter(l => l.id === to);
    for (const l of dest) { l.fmt = clone(fmt); copiedTargets.add(l); }
    renderLayers(); draw();
    toast(`Оформление скопировано на ${dest.length} слой(ёв)`);
  });

  // ----- режим «По значению поля» -----
  const fieldOpts = sel => fieldCols.length
    ? fieldCols.map(c => `<option value="${escHtml(c.name)}"${c.name === sel ? " selected" : ""}>${escHtml(c.label)}</option>`).join("")
    : `<option value="">— нет полей —</option>`;
  const ops = ["=", ">", "<", ">=", "<=", "contains", "starts"];
  const opOpts = (cur) => ops.map(o => `<option value="${o}"${o === (cur || "=") ? " selected" : ""}>${o}</option>`).join("");
  const rulesRowsHtml = () => work.length ? work.map((r, i) => `<tr>
      <td><select class="cr-field" data-i="${i}" aria-label="Поле правила ${i + 1}">${fieldOpts(r.field)}</select></td>
      <td><select class="cr-op" data-i="${i}" aria-label="Оператор правила ${i + 1}">${opOpts(r.op)}</select></td>
      <td><input class="cr-value" data-i="${i}" aria-label="Значение правила ${i + 1}" value="${escHtml(r.value ?? "")}" placeholder="значение"></td>
      <td><select class="cr-style" data-i="${i}" aria-label="Стиль правила ${i + 1}">${stylePickerOptions(r.style_id)}</select></td>
      <td class="mf-ord"><button class="mf-del cr-del" data-i="${i}" aria-label="Удалить правило ${i + 1}">✕</button></td>
    </tr>`).join("")
    : `<tr><td colspan="5" class="muted" style="padding:10px">${fieldCols.length
      ? "Правил пока нет — добавьте первое правило."
      : "Нет доступных полей для правил."}</td></tr>`;
  const syncRules = () => {
    overlay.querySelectorAll(".cr-field").forEach(el => { work[+el.dataset.i].field = el.value; });
    overlay.querySelectorAll(".cr-op").forEach(el => { work[+el.dataset.i].op = el.value; });
    overlay.querySelectorAll(".cr-value").forEach(el => { work[+el.dataset.i].value = el.value; });
    overlay.querySelectorAll(".cr-style").forEach(el => { work[+el.dataset.i].style_id = el.value; });
  };
  const liveRules = () => {   // живой предпросмотр правил на холсте
    const clean = work.filter(r => r.field && r.value !== "" && r.style_id);
    if (clean.length) layer.rules = clean; else delete layer.rules;
    draw();
  };
  const renderRules = () => {
    $("cr-body").innerHTML = rulesRowsHtml();
    overlay.querySelectorAll(".cr-field").forEach(el => el.onchange = () => { work[+el.dataset.i].field = el.value; liveRules(); });
    overlay.querySelectorAll(".cr-value").forEach(el => el.oninput = () => { work[+el.dataset.i].value = el.value; liveRules(); });
    overlay.querySelectorAll(".cr-style").forEach(el => el.onchange = async () => {
      let val = el.value;
      if (val === "__create_project_style__") {
        const newId = await createProjectStyle();
        if (newId) {
          val = newId;
          el.innerHTML = stylePickerOptions(newId);
          el.value = newId;
        } else {
          val = work[+el.dataset.i].style_id || "";
          el.value = val;
        }
      }
      work[+el.dataset.i].style_id = val;
      liveRules();
    });
    overlay.querySelectorAll(".cr-del").forEach(el => el.onclick = () => { syncRules(); work.splice(+el.dataset.i, 1); renderRules(); liveRules(); });
  };
  renderRules();
  $("cr-add").addEventListener("click", () => {
    if (!fieldCols.length) return;
    syncRules();
    work.push({ field: fieldCols[0] ? fieldCols[0].name : "", op: "=", value: "", style_id: "" });
    renderRules();
  });

  // ----- переключение режима -----
  const setMode = m => {
    mode = m;
    $("ls-single").style.display = m === "single" ? "" : "none";
    $("ls-rules").style.display = m === "rules" ? "" : "none";
    overlay.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
    overlay.querySelectorAll(".seg-btn").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    // живой предпросмотр текущего режима
    if (m === "single") { delete layer.rules; layer.fmt = collect(); }
    else liveRules();
    draw();
  };
  overlay.querySelectorAll(".seg-btn").forEach(b =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));

  // ----- применить / отмена / сброс -----
  const restore = () => {
    closeColorFields();
    if (origFmt) layer.fmt = origFmt; else delete layer.fmt;
    if (origRules) layer.rules = origRules; else delete layer.rules;
    for (const target of copiedTargets) {
      const original = targetOriginals.get(target);
      if (original) target.fmt = original; else delete target.fmt;
    }
    closePopups(); renderLayers(); draw();
  };
  $("ls-apply").addEventListener("click", () => {
    closeColorFields();
    layer.fmt = collect();
    if (mode === "rules") {
      syncRules();
      const clean = work.filter(r => r.field && r.value !== "" && r.style_id);
      if (clean.length) layer.rules = clean; else delete layer.rules;
    } else {
      delete layer.rules;
    }
    if (window.commitHistoryFrom) window.commitHistoryFrom(historyBefore);
    closePopups(); renderLayers(); draw(); persist();
    toast(mode === "rules" && layer.rules ? `Оформление по значению поля: ${layer.rules.length} правил(о)` : "Оформление слоя применено");
  });
  $("ls-cancel").addEventListener("click", restore);
  overlay.querySelector(".modal-x").addEventListener("click", restore);
  $("ls-reset").addEventListener("click", () => {
    closeColorFields();
    delete layer.fmt; delete layer.rules;
    if (window.commitHistoryFrom) window.commitHistoryFrom(historyBefore);
    closePopups(); renderLayers(); draw(); persist();
    toast("Оформление сброшено к стандартному");
  });
  overlay.addEventListener("click", ev => { if (ev.target === overlay) restore(); });
}

// ---------- библиотека знаков: редактор эталонных знаков ЛГР/базовых -------
// Правит САМ знак в библиотеке (глобально, во всех проектах, и на холсте, и
// на печати) — в отличие от «Оформление слоя», которое кладёт правку только
// на конкретный слой. Хранится в style_overrides.json на сервере поверх
// сгенерированного эталона (генератор ЛГР не трогается). Правки применяются
// на «Сохранить» (перечитывается вся библиотека — initStyles).
async function loadStyleOverrides() {
  try {
    const r = await fetch("/api/style-overrides");
    if (r.ok) state.styleOverrides = await r.json() || {};
  } catch (e) { /* сервер без endpoint — правок нет */ }
}
// текущие px-поля знака из STYLES_V2 (уже с применёнными правками) → объект
// для редактора; правка кладётся обратно в STYLES_V2 через canvasStyleToBackend
function openStyleLibrary() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  // знаки с названием, сгруппированы (как в пикере)
  const groups = new Map();
  for (const [sid, s] of Object.entries(STYLES_V2)) {
    if (!s.title) continue;
    const g = s.group || "Базовые";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(sid);
  }
  for (const arr of groups.values())
    arr.sort((a, b) => (STYLES_V2[a].title || "").localeCompare(STYLES_V2[b].title || "", "ru"));
  // изменённые в этой сессии (px-стиль) и помеченные на сброс к эталону
  const edited = {}, resetSet = new Set();
  const overridden = new Set(Object.keys(state.styleOverrides || {}));
  let sel = null;
  const listHtml = [...groups.entries()].map(([g, ids]) => `<div class="lib-group">
    <div class="lib-group-title">${escHtml(g)}</div>
    ${ids.map(sid => `<div class="lib-item" data-sid="${escHtml(sid)}">
      <span class="lib-sw" style="background:${swatchOf(sid)};border-color:${STYLES_V2[sid].stroke || "#999"}"></span>
      <span class="lib-nm">${escHtml(STYLES_V2[sid].title)}</span>
      <span class="lib-dot${overridden.has(sid) ? " on" : ""}" title="изменён"></span></div>`).join("")}
  </div>`).join("");
  overlay.innerHTML = `<div class="modal lib-modal">
    <div class="modal-head">Библиотека знаков
      <button class="modal-x" aria-label="Закрыть библиотеку знаков"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="lib-hint">Правка меняет сам эталонный знак — во всех проектах, на холсте и на печати. Синяя точка — знак изменён.</div>
      <div class="lib-body">
        <div class="lib-list">${listHtml}</div>
        <div class="lib-edit" id="lib-edit"><div class="muted" style="padding:var(--sp-4)">Выберите знак слева</div></div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="lib-reset-all">Сбросить все к эталону</button>
      <span class="spacer"></span>
      <button id="lib-cancel">Отмена</button>
      <button id="lib-save" class="primary">Сохранить</button>
    </div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const $ = id => overlay.querySelector("#" + id);

  function swatchOf(sid) {
    const st = STYLES_V2[sid];
    if (st.fill) return st.fill;
    if (st.hatch && st.hatch.color) {
      const a = st.hatch.cross ? 45 : (st.hatch.angle ?? 45);
      return `repeating-linear-gradient(${90 - a}deg, ${st.hatch.color} 0 1px, transparent 1px 4px)`;
    }
    return "transparent";
  }
  const opt = (sel, v, lbl) => `<option value="${v}"${sel === v ? " selected" : ""}>${lbl}</option>`;
  function renderEditor(sid) {
    sel = sid;
    overlay.querySelectorAll(".lib-item").forEach(el =>
      el.classList.toggle("active", el.dataset.sid === sid));
    const st = edited[sid] || STYLES_V2[sid];
    const hasFill = st.fill != null && st.fill !== "transparent";
    const op = Math.round((st.fillOpacity != null ? st.fillOpacity : 1) * 100);
    const dp = dashPresetOf(st.dash);
    const hObj = st.hatch && typeof st.hatch === "object" ? st.hatch : null;
    const hAngle = hObj ? (hObj.cross ? "cross" : String(hObj.angle ?? 45)) : "45";
    const hDens = hObj ? hatchDensOf(hObj.spacing_px || 9) : "normal";
    const mk = st.line_marker || null;
    const ed = $("lib-edit");
    ed.innerHTML = `<div class="lib-edit-head">${escHtml(STYLES_V2[sid].title)}
      <button class="lib-reset-one" title="Сбросить этот знак к эталону">↺ эталон</button></div>
      <div class="line-preview" id="lib-prev"></div>
      <div class="fmt-sub">Заливка</div>
      <label class="chk"><input type="checkbox" id="lib-hasfill" ${hasFill ? "checked" : ""}> заливка цветом</label>
      <label>Цвет<div id="lib-fill"></div></label>
      <label>Прозрачность, %<input type="range" id="lib-op" min="10" max="100" step="5" value="${op}"></label>
      <div class="fmt-sub">Линия</div>
      <label>Цвет<div id="lib-stroke"></div></label>
      <label>Толщина<input type="number" id="lib-width" value="${st.width ?? 1}" min="0.2" max="8" step="0.1"></label>
      <label>Пунктир<select id="lib-dashp">${
        opt(dp, "solid", "сплошная") + opt(dp, "dash", "штрих") + opt(dp, "dashdot", "штрих-пунктир") +
        opt(dp, "dashdotdot", "штрих-2 точки") + opt(dp, "custom", "свой…")}</select></label>
      <label id="lib-dashcw" style="display:${dp === "custom" ? "" : "none"}">Свой пунктир, px
        <input type="text" id="lib-dashc" placeholder="8, 3, 2, 3" value="${escHtml(dashToStr(dp === "custom" ? st.dash : null))}"></label>
      <div class="fmt-sub">Штриховка</div>
      <label class="chk"><input type="checkbox" id="lib-hatch" ${st.hatch ? "checked" : ""}> штриховка</label>
      <label>Угол<select id="lib-hangle">${
        opt(hAngle, "0", "0° —") + opt(hAngle, "45", "45° ╱") + opt(hAngle, "90", "90° │") +
        opt(hAngle, "135", "135° ╲") + opt(hAngle, "cross", "сетка ✕")}</select></label>
      <label>Плотность<select id="lib-hdens">${
        opt(hDens, "sparse", "реже") + opt(hDens, "normal", "обычно") + opt(hDens, "dense", "чаще")}</select></label>
      <div class="fmt-sub">Засечки-маркеры</div>
      <label class="chk"><input type="checkbox" id="lib-marker" ${mk ? "checked" : ""}> маркеры</label>
      <div id="lib-mfields" style="display:${mk ? "" : "none"}">
        <label>Форма<select id="lib-mshape">${MARKER_SHAPES.map(([v, l]) => opt((mk && mk.shape) || "tick", v, l)).join("")}</select></label>
        <label>Шаг, px<input type="number" id="lib-mperiod" value="${(mk && mk.period) || 40}" min="6" max="200"></label>
        <label>Размер, px<input type="number" id="lib-msize" value="${(mk && mk.size) || 4}" min="1" max="40" step="0.5"></label>
        <label>Остриё<select id="lib-mdir">${opt((mk && mk.dir) || "in", "in", "внутрь") + opt((mk && mk.dir) || "in", "out", "наружу")}</select></label>
      </div>`;
    const fillCF = makeColorField($("lib-fill"), toHexColor(st.fill, "#faf0bf"), onEdit);
    const strokeCF = makeColorField($("lib-stroke"), toHexColor(st.stroke, "#888888"), onEdit);
    ed._fillCF = fillCF; ed._strokeCF = strokeCF;
    $("lib-dashp").addEventListener("change", () => {
      $("lib-dashcw").style.display = $("lib-dashp").value === "custom" ? "" : "none"; onEdit();
    });
    $("lib-marker").addEventListener("change", () => {
      $("lib-mfields").style.display = $("lib-marker").checked ? "" : "none"; onEdit();
    });
    ed.querySelectorAll("input, select").forEach(el => {
      if (el.id === "lib-dashp" || el.id === "lib-marker") return;
      for (const e of ["input", "change"]) el.addEventListener(e, onEdit);
    });
    overlay.querySelector(".lib-reset-one").addEventListener("click", () => {
      resetSet.add(sid); delete edited[sid]; overridden.delete(sid);
      const dot = overlay.querySelector(`.lib-item[data-sid="${CSS.escape(sid)}"] .lib-dot`);
      if (dot) dot.classList.remove("on");
      toast("Знак помечен на сброс к эталону — «Сохранить», чтобы применить");
      renderEditor(sid);
    });
    updatePreview();
  }
  function collectPx() {
    const ed = $("lib-edit");
    const dash = $("lib-dashp").value === "custom" ? parseDashStr($("lib-dashc").value)
                 : (DASH_PRESETS[$("lib-dashp").value] ?? null);
    const st = {
      stroke: ed._strokeCF.get(), width: Math.max(0.2, parseFloat($("lib-width").value) || 1),
      fill: $("lib-hasfill").checked ? ed._fillCF.get() : null,
      fillOpacity: (parseInt($("lib-op").value) || 100) / 100, dash,
    };
    if ($("lib-hatch").checked) {
      const av = $("lib-hangle").value;
      st.hatch = { angle: av === "cross" ? 45 : +av, cross: av === "cross",
                   spacing_px: HATCH_DENS[$("lib-hdens").value] || 9, color: ed._strokeCF.get() };
    }
    if ($("lib-marker").checked) st.line_marker = {
      shape: $("lib-mshape").value, period: Math.max(4, parseFloat($("lib-mperiod").value) || 40),
      size: Math.max(0.5, parseFloat($("lib-msize").value) || 4),
      dir: $("lib-mdir").value === "out" ? "out" : "in" };
    if (STYLES_V2[sel].line_label) st.line_label = STYLES_V2[sel].line_label;
    if (STYLES_V2[sel].label_field) st.label_field = STYLES_V2[sel].label_field;
    return st;
  }
  function updatePreview() {
    const st = edited[sel] || STYLES_V2[sel];
    const p = $("lib-prev");
    if (p) p.innerHTML = lineSampleSVG(st.dash, st.stroke, st.width || 1);
  }
  function onEdit() {
    const px = collectPx();
    edited[sel] = px; resetSet.delete(sel);
    STYLES_V2[sel] = { ...STYLES_V2[sel], ...px };   // живой предпросмотр в списке/на холсте
    const dot = overlay.querySelector(`.lib-item[data-sid="${CSS.escape(sel)}"] .lib-dot`);
    if (dot) dot.classList.add("on");
    const sw = overlay.querySelector(`.lib-item[data-sid="${CSS.escape(sel)}"] .lib-sw`);
    if (sw) { sw.style.background = swatchOf(sel); sw.style.borderColor = STYLES_V2[sel].stroke || "#999"; }
    updatePreview(); draw();
  }
  overlay.querySelectorAll(".lib-item").forEach(el =>
    el.addEventListener("click", () => renderEditor(el.dataset.sid)));

  const close = () => { overlay.remove(); initStyles(); };   // отмена → перечитать эталон+сохранённое
  overlay.querySelector(".modal-x").addEventListener("click", close);
  $("lib-cancel").addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
  $("lib-reset-all").addEventListener("click", async () => {
    if (!(await uiConfirm("Сбросить ВСЕ знаки к эталону? Ваши правки библиотеки удалятся.",
                          { ok: "Сбросить", danger: true }))) return;
    await saveOverrides({});
    overlay.remove();
    toast("Все знаки сброшены к эталону");
  });
  $("lib-save").addEventListener("click", async () => {
    // новый словарь правок: прежние + отредактированные − сброшенные
    const ov = { ...(state.styleOverrides || {}) };
    for (const [sid, px] of Object.entries(edited)) ov[sid] = signOverridePatch(px);
    for (const sid of resetSet) delete ov[sid];
    await saveOverrides(ov);
    overlay.remove();
    const n = Object.keys(edited).length + resetSet.size;
    toast(`Библиотека знаков обновлена (${n} знак(ов))`);
  });
  async function saveOverrides(ov) {
    try {
      const r = await fetch("/api/style-overrides", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(ov) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      state.styleOverrides = ov;
      await initStyles();   // перечитать всю библиотеку с применёнными правками
      renderLayers(); draw();
    } catch (e) {
      toast("Не удалось сохранить знаки: " + String(e).slice(0, 120), "error");
    }
  }
}
