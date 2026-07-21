/* =============================================================================
   ГРАДО Студия — командная палитра ⌘K (Фаза 3).
   Грузится ПОСЛЕ движка: команды привязаны к реальным функциям/кнопкам
   (setTool, openDataFetch, openLayerStyle, openAlbumConfig, btn-*).
   Движок гуардит свои хоткеи при фокусе в INPUT/SELECT — набор в палитре
   инструменты не дёргает. app.js не меняется.
   ============================================================================= */
(function () {
  const $ = id => document.getElementById(id);
  const isWeb = !!window.GRADO_STATIC;
  const buttonEnabled = id => {
    const element = $(id);
    return !!element && !element.disabled && !element.hidden &&
      element.getAttribute("aria-disabled") !== "true";
  };
  const toolEnabled = name => {
    const element = document.querySelector(`#toolbar button[data-tool="${name}"]`);
    return !!element && !element.disabled;
  };
  const click = id => {
    const e = $(id);
    if (!e) return;
    if (e.disabled) {
      if (typeof window.toast === "function") window.toast(e.title || "Команда сейчас недоступна", "warn");
      return;
    }
    e.click();
  };
  const has = fn => typeof window[fn] === "function";
  const call = (fn, ...a) => { if (has(fn)) try { window[fn](...a); } catch (e) { console.warn(fn, e); } };
  const tool = t => () => { if (has("setTool") && toolEnabled(t)) setTool(t); };
  const setBasemap = src => () => {
    const sel = $("basemap-source"), show = $("basemap-show");
    if (show && !show.checked) { show.checked = true; show.dispatchEvent(new Event("change", { bubbles: true })); }
    if (sel) { sel.value = src; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const toggleBasemap = () => {
    const s = $("basemap-show");
    if (s) { s.checked = !s.checked; s.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const styleActive = () => { if (has("openLayerStyle") && has("activeLayer")) { const L = activeLayer(); if (L) openLayerStyle(L); } };
  const fitAll = () => { if (has("fitView")) fitView(); else click("btn-zoom-fit"); if (has("draw")) draw(); };
  const openPanelView = view => () => {
    if (document.body.classList.contains("panel-hidden")) click("btn-panel-visibility");
    click(view === "tep" ? "panel-tab-tep" : "panel-tab-project");
  };
  const modKey = key => `${/Mac|iPhone|iPad|iPod/.test(navigator.platform || "") ? "⌘" : "Ctrl+"}${key}`;

  const COMMANDS = [
    { sec: "Инструменты", items: [
      { t: "Выбор и правка объектов", k: "V", run: tool("select"), available: () => toolEnabled("select") },
      { t: "Точка", run: tool("point"), available: () => toolEnabled("point") },
      { t: "Линия", run: tool("polyline"), available: () => toolEnabled("polyline") },
      { t: "Полигон", run: tool("polygon"), available: () => toolEnabled("polygon") },
      { t: "Прямоугольник", run: tool("rect"), available: () => toolEnabled("rect") },
      { t: "Дуга по трём точкам", run: tool("arc"), available: () => toolEnabled("arc") },
      { t: "Окружность", run: tool("circle"), available: () => toolEnabled("circle") },
      { t: "Обрезать по границе", k: "T", run: tool("trim"), available: () => toolEnabled("trim") },
      { t: "Продлить до границы", k: "E", run: tool("extend"), available: () => toolEnabled("extend") },
      { t: "Сопрячь угол (fillet)", run: tool("fillet"), available: () => toolEnabled("fillet") },
      { t: "Буфер вокруг выбранных объектов…", run: () => click("btn-buffer-open"), desktop: true, available: () => buttonEnabled("btn-buffer-open") },
      { t: "Геообработка полигонов…", run: () => click("btn-vector-open"), available: () => buttonEnabled("btn-vector-open") },
      { t: "Поворот выделения", k: "R", run: tool("rotate"), available: () => toolEnabled("rotate") },
      { t: "Масштаб выделения", run: tool("scale"), available: () => toolEnabled("scale") },
      { t: "Зеркало", run: tool("mirror"), available: () => toolEnabled("mirror") },
      { t: "Размерная линия", k: "D", run: tool("dim"), available: () => toolEnabled("dim") },
      { t: "Измерение расстояния", k: "M", run: tool("measure"), available: () => toolEnabled("measure") },
    ]},
    { sec: "Данные", items: [
      { t: "Данные по видимой области…", run: () => call("openDataFetch"), desktop: true },
      { t: isWeb ? "Импорт ГИС ОГД (GeoJSON)" : "Импорт ГИС ОГД (ZIP / GeoJSON / папка)", run: () => click("btn-gisogd") },
      { t: "Импорт НСПД (файл расширения)", run: () => click("btn-nspd") },
      { t: "Заполнить примером (демо)", run: () => click("btn-demo") },
      { t: "Подложка: спутник Sentinel-2 (Copernicus)", run: setBasemap("s2") },
      { t: "Подложка: спутник ESRI (высокое разрешение)", run: setBasemap("sat") },
      { t: "Подложка: карта OpenStreetMap", run: setBasemap("osm") },
      { t: "Показать / скрыть подложку", run: toggleBasemap },
    ]},
    { sec: "Слои", items: [
      { t: "Новый слой", run: () => click("btn-new-layer") },
      { t: "Оформление активного слоя…", run: styleActive, available: () => has("activeLayer") && !!activeLayer() },
      { t: "Библиотека знаков", run: () => click("btn-style-lib") },
      { t: "Типы слоёв", run: () => click("btn-manage-kinds") },
      { t: "Варианты концепции", run: () => click("btn-variants") },
    ]},
    { sec: "Вид и проект", items: [
      { t: "Вписать всё в экран", k: "F", run: fitAll },
      { t: "Открыть инспектор проекта", run: openPanelView("project") },
      { t: "Открыть расчёты ТЭП", run: openPanelView("tep") },
      { t: "Показать / скрыть инспектор", run: () => click("btn-panel-visibility") },
      { t: "Переключить тему (свет / тёмная)", run: () => click("btn-theme") },
      { t: "Параметры расчёта ТЭП…", run: () => click("btn-tep-editor") },
      { t: "Отменить", k: modKey("Z"), run: () => click("btn-undo"), available: () => buttonEnabled("btn-undo") },
      { t: "Вернуть", k: modKey("Shift+Z"), run: () => click("btn-redo"), available: () => buttonEnabled("btn-redo") },
      { t: "Открыть проект…", run: () => click("btn-open") },
      { t: isWeb ? "Сохранить проект (.grado-web.json)" : "Сохранить .grado", run: () => click("btn-grado") },
      { t: "Горячие клавиши", run: () => click("btn-shortcuts") },
    ]},
    { sec: "Выпуск", items: [
      { t: "Экспорт чертежа (DXF)", run: () => click("btn-dxf"), desktop: true },
      { t: "Печать в масштабе (PDF)", run: () => click("btn-print"), desktop: true },
      { t: "Собрать альбом АГК (PDF)", run: () => click("btn-album"), desktop: true },
      { t: "Состав альбома…", run: () => call("openAlbumConfig") },
    ]},
  ];

  const cmdk = $("cmdk"), q = $("cmdk-q"), list = $("cmdk-list"), trigger = $("open-cmdk");
  if (!cmdk || !q || !list) return;
  let flat = [], sel = 0, previousFocus = null;

  function render(query) {
    query = (query || "").trim().toLowerCase();
    flat = []; let html = "";
    for (const g of COMMANDS) {
      const items = g.items.filter(i => (!isWeb || !i.desktop) &&
        (!i.available || i.available()) && (!query || i.t.toLowerCase().includes(query)));
      if (!items.length) continue;
      html += `<div class="cmdk-sec">${g.sec}</div>`;
      for (const i of items) {
        const idx = flat.push(i) - 1;
        html += `<div class="cmdk-row" role="option" aria-selected="false" data-i="${idx}"><svg class="ic"><use href="#i-search"/></svg>${i.t}${i.k ? `<span class="hint">${i.k}</span>` : ""}</div>`;
      }
    }
    list.innerHTML = html || '<div class="cmdk-empty">Ничего не найдено</div>';
    sel = 0; hi();
    list.querySelectorAll(".cmdk-row").forEach(r => {
      r.addEventListener("mousemove", () => { sel = +r.dataset.i; hi(); });
      r.addEventListener("click", () => run(+r.dataset.i));
    });
  }
  function hi() {
    list.querySelectorAll(".cmdk-row").forEach(r => {
      const selected = +r.dataset.i === sel;
      r.classList.toggle("sel", selected);
      r.setAttribute("aria-selected", String(selected));
      if (selected) {
        if (!r.id) r.id = `cmdk-option-${r.dataset.i}`;
        q.setAttribute("aria-activedescendant", r.id);
      }
    });
  }
  function scrollSel() { const r = list.querySelector(`.cmdk-row[data-i="${sel}"]`); if (r) r.scrollIntoView({ block: "nearest" }); }
  function run(i) { const c = flat[i]; close(); if (c) setTimeout(() => c.run(), 0); }
  function open() {
    previousFocus = document.activeElement;
    cmdk.hidden = false;
    trigger?.setAttribute("aria-expanded", "true");
    q.value = "";
    render("");
    q.focus();
  }
  function close() {
    cmdk.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    q.removeAttribute("aria-activedescendant");
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }

  trigger?.addEventListener("click", open);
  q.addEventListener("input", () => render(q.value));
  q.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(flat.length - 1, sel + 1); hi(); scrollSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); hi(); scrollSel(); }
    else if (e.key === "Enter") { e.preventDefault(); run(sel); }
  });
  cmdk.addEventListener("click", e => { if (e.target === cmdk) close(); });
  addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); cmdk.hidden ? open() : close(); }
    else if (e.key === "Escape" && !cmdk.hidden) { close(); }
  });
})();
