/* =============================================================================
   ГРАДО Студия — командная палитра ⌘K (Фаза 3).
   Грузится ПОСЛЕ движка: команды привязаны к реальным функциям/кнопкам
   (setTool, openDataFetch, openLayerStyle, openAlbumConfig, btn-*).
   Движок гуардит свои хоткеи при фокусе в INPUT/SELECT — набор в палитре
   инструменты не дёргает. app.js не меняется.
   ============================================================================= */
(function () {
  const $ = id => document.getElementById(id);
  const click = id => { const e = $(id); if (e) e.click(); };
  const has = fn => typeof window[fn] === "function";
  const call = (fn, ...a) => { if (has(fn)) try { window[fn](...a); } catch (e) { console.warn(fn, e); } };
  const tool = t => () => { if (has("setTool")) setTool(t); };
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
  const modKey = key => `${/Mac|iPhone|iPad|iPod/.test(navigator.platform || "") ? "⌘" : "Ctrl+"}${key}`;

  const COMMANDS = [
    { sec: "Инструменты", items: [
      { t: "Выбор и правка объектов", k: "V", run: tool("select") },
      { t: "Точка", run: tool("point") },
      { t: "Линия", run: tool("polyline") },
      { t: "Полигон", run: tool("polygon") },
      { t: "Прямоугольник", run: tool("rect") },
      { t: "Дуга по трём точкам", run: tool("arc") },
      { t: "Окружность", run: tool("circle") },
      { t: "Обрезать по границе", k: "T", run: tool("trim") },
      { t: "Продлить до границы", k: "E", run: tool("extend") },
      { t: "Сопрячь угол (fillet)", run: tool("fillet") },
      { t: "Буфер вокруг выбранных объектов…", run: () => click("btn-buffer-open") },
      { t: "Поворот выделения", k: "R", run: tool("rotate") },
      { t: "Масштаб выделения", run: tool("scale") },
      { t: "Зеркало", run: tool("mirror") },
      { t: "Размерная линия", k: "D", run: tool("dim") },
      { t: "Измерение расстояния", k: "M", run: tool("measure") },
    ]},
    { sec: "Данные", items: [
      { t: "Данные по видимой области…", run: () => call("openDataFetch") },
      { t: "Импорт ГИС ОГД (ZIP / GeoJSON / папка)", run: () => click("btn-gisogd") },
      { t: "Импорт НСПД (файл расширения)", run: () => click("btn-nspd") },
      { t: "Заполнить примером (демо)", run: () => click("btn-demo") },
      { t: "Подложка: спутник Sentinel-2 (Copernicus)", run: setBasemap("s2") },
      { t: "Подложка: спутник ESRI (высокое разрешение)", run: setBasemap("sat") },
      { t: "Подложка: карта OpenStreetMap", run: setBasemap("osm") },
      { t: "Показать / скрыть подложку", run: toggleBasemap },
    ]},
    { sec: "Слои", items: [
      { t: "Новый слой", run: () => click("btn-new-layer") },
      { t: "Оформление активного слоя…", run: styleActive },
      { t: "Библиотека знаков", run: () => click("btn-style-lib") },
      { t: "Типы слоёв", run: () => click("btn-manage-kinds") },
      { t: "Варианты концепции", run: () => click("btn-variants") },
    ]},
    { sec: "Вид и проект", items: [
      { t: "Вписать всё в экран", k: "F", run: fitAll },
      { t: "Переключить тему (свет / тёмная)", run: () => click("btn-theme") },
      { t: "Параметры расчёта ТЭП…", run: () => click("btn-tep-editor") },
      { t: "Отменить", k: modKey("Z"), run: () => click("btn-undo") },
      { t: "Вернуть", k: modKey("Shift+Z"), run: () => click("btn-redo") },
      { t: "Открыть проект…", run: () => click("btn-open") },
      { t: "Сохранить .grado", run: () => click("btn-grado") },
      { t: "Горячие клавиши", run: () => click("btn-shortcuts") },
    ]},
    { sec: "Выпуск", items: [
      { t: "Экспорт чертежа (DXF)", run: () => click("btn-dxf") },
      { t: "Печать в масштабе (PDF)", run: () => click("btn-print") },
      { t: "Собрать альбом АГК (PDF)", run: () => click("btn-album") },
      { t: "Состав альбома…", run: () => call("openAlbumConfig") },
    ]},
  ];

  const cmdk = $("cmdk"), q = $("cmdk-q"), list = $("cmdk-list");
  if (!cmdk || !q || !list) return;
  let flat = [], sel = 0, previousFocus = null;

  function render(query) {
    query = (query || "").trim().toLowerCase();
    flat = []; let html = "";
    for (const g of COMMANDS) {
      const items = g.items.filter(i => !query || i.t.toLowerCase().includes(query));
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
  function open() { previousFocus = document.activeElement; cmdk.hidden = false; q.value = ""; render(""); q.focus(); }
  function close() { cmdk.hidden = true; q.removeAttribute("aria-activedescendant"); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); }

  $("open-cmdk") && $("open-cmdk").addEventListener("click", open);
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
