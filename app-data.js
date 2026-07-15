// ============================================================================
//  app-data.js — диалог «Данные по области» (прямая выгрузка OSM/НСПД по
//  видимому экстенту). Вынесено из монолита app.js (P0-разрез). Классический
//  скрипт, общий global-scope, грузится ПЕРЕД app.js (on("btn-data") ссылается
//  на openDataFetch при загрузке). Только определения — top-level исполнения нет.
//  Runtime-зависимости из app.js: importSourceFeatures, recordSource,
//  startDownloadsWatch, zoomBy, snapshot, afterChange, LAYER_BY_ID, attrColumns,
//  toast, closePopups, escHtml, plObjects, initBasemap, basemap, cv, s2w,
//  localToLonLat. Биндинг on("btn-data") и остальной импорт (мост/inbox/ГИС ОГД/
//  панель источников) ОСТАЛИСЬ в app.js (сцеплены с top-level init).
// ============================================================================

// ---------- «Данные» — прямые открытые источники по видимой области ----------
// Без браузерного моста и без порталов: сервер сам ходит в OSM (Overpass)
// и НСПД (intersects-API геопортала), объекты раскладываются по слоям-
// приёмникам source.* строго по layer_id (правило 7) — слои появляются
// в панели автоматически, как только в них попадают данные.
const DATA_SOURCE_GROUPS = [
  { title: "OpenStreetMap", hint: "справочный контекст",
    maxKm2: 60, items: [
      { key: "osm.roads", label: "Дороги и улицы", def: true },
      { key: "osm.buildings", label: "Здания", def: true },
      { key: "osm.landuse", label: "Землепользование (парки, лес…)", def: false },
      { key: "osm.water", label: "Вода", def: false },
      { key: "osm.boundaries", label: "Административные границы (районы/поселения)", def: false },
    ]},
  { title: "НСПД — Росреестр", hint: "официальные границы ЕГРН",
    maxKm2: 12, items: [
      { key: "nspd.parcels", label: "Земельные участки", def: true },
      { key: "nspd.buildings", label: "Здания (ОКС)", def: false },
      { key: "nspd.constructions", label: "Сооружения", def: false },
      { key: "nspd.zouit", label: "ЗОУИТ (все виды)", def: false },
    ]},
  { title: "Рельеф", hint: "горизонтали из открытого DEM (SRTM)", web: false,
    maxKm2: 80, webNote: "В веб-версии рельеф пока недоступен", items: [
      { key: "terrain.contours", label: "Горизонтали (сечение авто)", def: false },
    ]},
  // ОГД по области: портал не фильтрует по bbox — слой качается целиком один
  // раз в кэш сервера (функц. зоны Москвы ≈15 МБ), дальше режется локально.
  { title: "ГИС ОГД Москвы", hint: "Генплан и ЗОУИТ · первая загрузка слоя дольше",
    web: false, maxKm2: 80, picker: true,
    webNote: "В веб-версии слои ОГД по области недоступны — нужна настольная версия",
    items: [
      { key: "gisogd.func_zones", label: "Функц. зоны Генплана (старая Москва)", def: false },
      { key: "gisogd.func_zones_tinao", label: "Функц. зоны (Новая Москва, ТиНАО)", def: false },
      { key: "gisogd.szz", label: "Санитарно-защитные зоны", def: false },
      { key: "gisogd.vodookhr", label: "Водоохранные зоны", def: false },
    ]},
];

// Слои портала ОГД, добавленные пользователем через каталог (кроме кураторских):
// ключ «gisogd:{code}» — сервер сам определит маршрут и знак по имени слоя.
const GISOGD_EXTRA_KEY = "grado_gisogd_extra";
function gisogdExtras() {
  try {
    const arr = JSON.parse(localStorage.getItem(GISOGD_EXTRA_KEY) || "[]");
    return arr.filter(x => x && x.code).map(x =>
      ({ key: `gisogd:${x.code}`, label: x.name || x.code, def: false }));
  } catch (e) { return []; }
}
function gisogdAddExtra(code, name) {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(GISOGD_EXTRA_KEY) || "[]"); } catch (e) {}
  if (!arr.some(x => x.code === code)) arr.push({ code, name });
  localStorage.setItem(GISOGD_EXTRA_KEY, JSON.stringify(arr));
}

// Каталог слоёв портала (≈660): поиск по названию/пути, выбранный слой
// добавляется в группу «ГИС ОГД Москвы» как обычный источник.
async function openGisogdPicker(onPick) {
  let layers = [];
  try {
    const r = await fetch("/api/gisogd-catalog");
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    layers = d.layers || [];
  } catch (e) { toast(`Каталог ГИС ОГД недоступен: ${e.message}`, "warn"); return; }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal fmt-modal" role="dialog" aria-modal="true" aria-labelledby="ogdc-title">
    <div class="modal-head"><span id="ogdc-title">Слои ГИС ОГД</span>
      <button class="modal-x" aria-label="Закрыть каталог слоёв"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <label class="cf-row"><span>Поиск</span><input id="ogdc-q" type="search" placeholder="например, красные линии" autocomplete="off"></label>
      <div class="fc-help">Всего слоёв на портале: ${layers.length}. Слой ляжет в слой-приёмник по своему названию.</div>
      <div id="ogdc-list" class="ogdc-list"></div>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button class="ogdc-cancel">Закрыть</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector("#ogdc-list");
  const render = q => {
    const low = q.trim().toLowerCase();
    const hit = (low ? layers.filter(l =>
      (l.name || "").toLowerCase().includes(low) ||
      (l.path || "").toLowerCase().includes(low)) : layers).slice(0, 200);
    list.innerHTML = hit.length ? hit.map(l => `<button class="ogdc-row" data-code="${escHtml(l.code)}"
      data-name="${escHtml(l.name || l.code)}"><b>${escHtml(l.name || l.code)}</b>
      <span>${escHtml(l.path || "")}</span></button>`).join("")
      : `<div class="fc-help">Ничего не найдено</div>`;
  };
  render("");
  overlay.querySelector("#ogdc-q").addEventListener("input", e => render(e.target.value));
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.querySelector(".ogdc-cancel").addEventListener("click", close);
  overlay.addEventListener("click", e => {
    const row = e.target.closest(".ogdc-row");
    if (!row) return;
    gisogdAddExtra(row.dataset.code, row.dataset.name);
    close();
    onPick && onPick();
  });
}

function viewExtentBbox() {
  // текущий видимый прямоугольник холста → [west, south, east, north] WGS84
  const w = cv.clientWidth, h = cv.clientHeight;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]]
    .map(([sx, sy]) => localToLonLat(...s2w(sx, sy)));
  const lons = corners.map(point => point[0]);
  const lats = corners.map(point => point[1]);
  return [Math.min(...lons), Math.min(...lats),
          Math.max(...lons), Math.max(...lats)];
}
function bboxKm2([west, south, east, north]) {
  const latMid = (south + north) / 2 * Math.PI / 180;
  return (north - south) * 111.32 * (east - west) * 111.32 * Math.cos(latMid);
}

async function openDataFetch() {
  if (!basemap.originLon) { try { await initBasemap(); } catch (e) {} }
  if (!basemap.originLon) { toast("Нет системы координат — включите подложку", "warn"); return; }
  closePopups();
  const bbox = viewExtentBbox();
  const km2 = bboxKm2(bbox);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("grado_data_sources") || "{}"); } catch (e) {}

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const areaTxt = km2 < 1 ? km2.toFixed(2) : km2.toFixed(1);
  const cardsHtml = DATA_SOURCE_GROUPS.map((g, gi) => {
    const unavailable = !!window.GRADO_STATIC && g.web === false;
    const over = km2 > g.maxKm2;
    const disabled = unavailable || over;
    const items = g.picker ? g.items.concat(gisogdExtras()) : g.items;
    const rows = items.map(it => {
      const checked = (saved[it.key] ?? it.def) && !disabled;
      return `<label class="data-src${disabled ? " disabled" : ""}">
        <input type="checkbox" data-src="${it.key}" data-gi="${gi}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>
        <span>${escHtml(it.label)}</span></label>`;
    }).join("");
    return `<div class="data-card" data-gi="${gi}">
      <div class="data-card-head">
        <div class="data-card-title">${escHtml(g.title)}
          <span class="data-card-sub">${escHtml(g.hint)} · до ${g.maxKm2} км²</span></div>
        ${g.picker && !unavailable ? `<button class="data-ogd-more" data-gi="${gi}">+ слой портала…</button>` : ""}
        <button class="data-all" data-gi="${gi}"${disabled ? " disabled" : ""}>все</button>
      </div>
      ${unavailable ? `<div class="data-over">${escHtml(g.webNote || "В веб-версии источник недоступен")}</div>` : over ? `<div class="data-over">Область ${areaTxt} км² больше лимита ${g.maxKm2} км²
        <button class="data-zoom" data-target="${g.maxKm2}">Приблизить</button></div>` : ""}
      <div class="data-rows">${rows}</div>
    </div>`;
  }).join("");
  const ogdAction = window.GRADO_STATIC ? "Импортировать GeoJSON" : "Открыть портал";
  const ogdHint = window.GRADO_STATIC
    ? "выберите ранее скачанный слой с портала"
    : "скачайте выгрузку — студия подхватит её из «Загрузок» сама";
  overlay.innerHTML = `<div class="modal fmt-modal data-modal" role="dialog" aria-modal="true" aria-labelledby="data-modal-title">
    <div class="modal-head"><span id="data-modal-title">Данные по области</span>
      <button class="modal-x" aria-label="Закрыть данные по области"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="data-area-bar"><span>Видимая область</span><b>${areaTxt} км²</b></div>
      ${cardsHtml}
      <div class="data-card data-card-ogd">
        <div class="data-card-head">
          <div class="data-card-title">ГИС ОГД — другие слои
            <span class="data-card-sub">ZIP/GeoJSON с портала mos.ru</span></div>
        </div>
        <div class="data-ogd-row">
          <button class="data-ogd-portal">${ogdAction}</button>
          <span class="data-watch-status muted">${ogdHint}</span>
        </div>
      </div>
      <div class="data-note muted">Объекты лягут в отдельные слои-источники (появятся в «Слоях»)
      и не смешаются с вашим проектом. Повторная загрузка той же области не создаёт дубликатов.</div>
    </div>
    <div class="modal-actions"><span class="data-status muted"></span><span class="spacer"></span>
      <button class="data-cancel">Отмена</button>
      <button class="data-load primary">Загрузить</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.querySelector(".data-cancel").addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
  overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") close(); });
  // каталог портала: выбранный слой добавляется в группу — переоткрываем диалог,
  // чтобы он появился обычным чекбоксом (галочки текущей сессии уже сохранены)
  const moreBtn = overlay.querySelector(".data-ogd-more");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    const sel = {};
    allBoxes().forEach(b => { if (!b.disabled) sel[b.dataset.src] = b.checked; });
    try { localStorage.setItem("grado_data_sources", JSON.stringify(sel)); } catch (e) {}
    openGisogdPicker(() => { close(); openDataFetch(); });
  });

  const loadBtn = overlay.querySelector(".data-load");
  const status = overlay.querySelector(".data-status");
  const allBoxes = () => [...overlay.querySelectorAll("input[data-src]")];
  // счётчик выбранного на кнопке + подпись «все/ничего» по каждой карточке
  function refreshUI() {
    const n = allBoxes().filter(b => b.checked).length;
    loadBtn.textContent = n ? `Загрузить (${n})` : "Загрузить";
    loadBtn.disabled = !n;
    overlay.querySelectorAll(".data-all").forEach(btn => {
      const boxes = allBoxes().filter(b => b.dataset.gi === btn.dataset.gi && !b.disabled);
      btn.textContent = (boxes.length && boxes.every(b => b.checked)) ? "ничего" : "все";
    });
  }
  overlay.addEventListener("change", ev => { if (ev.target.matches("input[data-src]")) refreshUI(); });
  overlay.querySelectorAll(".data-all").forEach(btn => btn.addEventListener("click", () => {
    const boxes = allBoxes().filter(b => b.dataset.gi === btn.dataset.gi && !b.disabled);
    const turnOn = !(boxes.length && boxes.every(b => b.checked));
    boxes.forEach(b => b.checked = turnOn);
    refreshUI();
  }));
  // «Приблизить»: вписать вид под лимит источника и переоткрыть диалог по новой
  // области (агентность/прощение — не «идите сами зумьте», а один клик)
  overlay.querySelectorAll(".data-zoom").forEach(btn => btn.addEventListener("click", () => {
    const target = parseFloat(btn.dataset.target);
    const sel = {};
    allBoxes().forEach(b => { if (!b.disabled) sel[b.dataset.src] = b.checked; });
    try { localStorage.setItem("grado_data_sources", JSON.stringify(sel)); } catch (e) {}
    if (km2 > target) zoomBy(Math.sqrt(km2 / (target * 0.9)));   // с запасом под лимит
    close();
    openDataFetch();
  }));

  // ГИС ОГД: открыть портал + армировать вахту за «Загрузками» (работает
  // и после закрытия окна — пока пользователь выбирает слои на портале)
  overlay.querySelector(".data-ogd-portal").addEventListener("click", () => {
    if (window.GRADO_STATIC) {
      close();
      document.getElementById("btn-gisogd")?.click();
      return;
    }
    window.open("https://gisogd.mos.ru/", "_blank");
    startDownloadsWatch();
    overlay.querySelector(".data-watch-status").textContent =
      "жду выгрузку в «Загрузках»… (15 мин)";
    toast("Скачайте выгрузку на портале — студия предложит импорт сама");
  });

  refreshUI();

  loadBtn.addEventListener("click", async () => {
    const boxes = allBoxes();
    const sources = boxes.filter(b => b.checked).map(b => b.dataset.src);
    // выбор запоминается (и невыбор тоже) — в следующий раз диалог как оставили
    const sel = {};
    boxes.forEach(b => { if (!b.disabled) sel[b.dataset.src] = b.checked; });
    try { localStorage.setItem("grado_data_sources", JSON.stringify(sel)); } catch (e) {}
    if (!sources.length) { status.textContent = "Выберите хотя бы один источник"; return; }
    loadBtn.disabled = true; loadBtn.classList.add("loading");
    boxes.forEach(b => b.disabled = true);
    status.textContent = "Загрузка… НСПД может занять ~10 с";
    try {
      const r = await fetch("/api/fetch-extent", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox, sources }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
      const groups = (data.groups || []).filter(g => g.count > 0);
      const total = groups.reduce((s, g) => s + g.count, 0);
      if (!total) {
        status.textContent = "В этой области выбранных данных нет — сместите вид или добавьте источник";
        if (data.notes && data.notes.length) toast(data.notes.join(" · "), "warn");
        loadBtn.classList.remove("loading");
        boxes.forEach(b => b.disabled = false);
        refreshUI();
        return;
      }
      snapshot();
      let addedAll = 0, dupAll = 0, invalidAll = 0;
      const parts = [];
      for (const g of groups) {
        const { added, dup, invalid } = importSourceFeatures(g.features);  // дедуп + валидация
        addedAll += added; dupAll += dup; invalidAll += invalid;
        parts.push(`${g.title} ${added}`);
        const L = LAYER_BY_ID[g.layer_id];
        if (!L) continue;
        L.visible = true;          // слой-приёмник сразу виден в панели
        // полная атрибуция источника → колонки таблицы атрибутов
        // (и .grado через манифест); существующие поля не трогаем
        if (g.fields && g.fields.length) {
          L.fields = L.fields || [];
          const taken = new Set(attrColumns(L).map(c => c.name));
          for (const fd of g.fields)
            if (!taken.has(fd.name)) { L.fields.push(fd); taken.add(fd.name); }
        }
      }
      (data.snapshots || []).forEach(m => recordSource(m));
      state.selected = null;
      afterChange();               // вид не трогаем: данные пришли по нему же
      close();
      if (!addedAll && dupAll) { toast(`Данные: всё уже загружено (${dupAll} объектов — без дубликатов)`); return; }
      const dupNote = dupAll ? ` · ${dupAll} уже были` : "";
      const invalidNote = invalidAll ? ` · ${invalidAll} поврежд. пропущено` : "";
      const sourceNotes = (data.notes || []).filter(Boolean);
      const note = sourceNotes.length ? ` · ${sourceNotes.join(" · ")}` : "";
      toast(`Данные: +${plObjects(addedAll)} (${parts.join(" · ")})${dupNote}${invalidNote}${note}`,
        invalidAll || sourceNotes.length ? "warn" : undefined);
      if (sourceNotes.length) console.info("Данные по области:", sourceNotes.join("\n"));
    } catch (err) {
      status.textContent = "";
      loadBtn.classList.remove("loading");
      boxes.forEach(b => b.disabled = false);
      refreshUI();
      toast("Не удалось загрузить: " + String(err.message || err).slice(0, 180), "error");
    }
  });
}
