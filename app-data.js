// ============================================================================
//  app-data.js — диалог «Данные по области» (прямая выгрузка OSM/НСПД по
//  видимому экстенту). Вынесено из монолита app.js (P0-разрез). Классический
//  скрипт, общий global-scope, грузится ПЕРЕД app.js (on("btn-data") ссылается
//  на openDataFetch при загрузке). Только определения — top-level исполнения нет.
//  Runtime-зависимости из app.js: prepareSourceImport/commitPreparedSourceImport,
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
    maxKm2: 80, picker: true, items: [
      { key: "gisogd.func_zones", label: "Функц. зоны Генплана (старая Москва)", def: false },
      { key: "gisogd.func_zones_tinao", label: "Функц. зоны (Новая Москва, ТиНАО)", def: false },
      { key: "gisogd.szz", label: "Санитарно-защитные зоны", def: false },
      { key: "gisogd.vodookhr", label: "Водоохранные зоны", def: false },
    ]},
];

// Весь каталог ОГД теперь виден деревом прямо в окне выгрузки (см. ogdTreeHtml).
// Прежний механизм «добавленных через каталог» слоёв (localStorage-extras +
// модалка-picker) убран за ненадобностью.

// Каталог слоёв портала (≈660) деревом ПРЯМО в окне выгрузки (не отдельной
// модалкой): путь слоя («Слои / Генплан / …») — ветка дерева, последний сегмент
// — сам слой. Лист = чекбокс-источник data-src="gisogd:<код>" (fetch_extent
// резолвит его в свой слой source.gisogd.<код>). Прежняя кнопка «+ слой
// портала…» и localStorage-extras убраны — весь каталог виден сразу.
function ogdBuildTree(items) {
  const root = { kids: new Map(), layers: [] };
  items.forEach(l => {
    const parts = (l.path || "").split(" / ").filter(Boolean).slice(0, -1);
    let node = root;
    parts.forEach(p => {
      if (!node.kids.has(p)) node.kids.set(p, { kids: new Map(), layers: [] });
      node = node.kids.get(p);
    });
    node.layers.push(l);
  });
  return root;
}
function ogdCountOf(n) {
  return n.layers.length + [...n.kids.values()].reduce((s, k) => s + ogdCountOf(k), 0);
}
// depth: отступ обычным padding'ом (направляющие линии рвутся на стыках строк).
function ogdTreeHtml(node, gi, saved, disabled, open, depth = 0) {
  const p = 12 + depth * 16;
  const folders = [...node.kids].map(([name, kid]) => `<details class="ogdc-folder"${open ? " open" : ""}>
    <summary style="padding-left:${p}px"><span class="ogdc-tw">▶</span><span class="ogdc-fname">${escHtml(name)}</span>
      <span class="ogdc-fcount">${ogdCountOf(kid)}</span></summary>
    ${ogdTreeHtml(kid, gi, saved, disabled, open, depth + 1)}</details>`).join("");
  const rows = node.layers.map(l => {
    const src = `gisogd:${l.code}`;
    const on = !!saved[src] && !disabled;
    return `<label class="data-src ogdc-leaf${disabled ? " disabled" : ""}" style="padding-left:${p + 19}px">
      <input type="checkbox" data-src="${escHtml(src)}" data-gi="${gi}"${on ? " checked" : ""}${disabled ? " disabled" : ""}>
      <span style="white-space:normal">${escHtml(l.name || l.code)}</span></label>`;
  }).join("");
  return folders + rows;
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

  // Каталог портала (для группы ГИС ОГД — дерево прямо в окне). Тянем заранее;
  // при ошибке группа покажет только сообщение, остальные источники работают.
  let ogdCatalog = [], ogdError = null;
  const catBusy = beginBusy("Каталог слоёв ГИС ОГД…");
  try {
    const r = await fetch("/api/gisogd-catalog");
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    ogdCatalog = d.layers || [];
  } catch (e) { ogdError = e.message; } finally { catBusy(); }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const areaTxt = km2 < 1 ? km2.toFixed(2) : km2.toFixed(1);
  const cardsHtml = DATA_SOURCE_GROUPS.map((g, gi) => {
    const unavailable = !!window.GRADO_STATIC && g.web === false;
    const over = km2 > g.maxKm2;
    const disabled = unavailable || over;
    // Группа ГИС ОГД — весь каталог портала деревом (папки → слои-чекбоксы).
    let body;
    if (g.picker) {
      body = unavailable
        ? ""
        : ogdError
          ? `<div class="data-over">Каталог портала недоступен: ${escHtml(ogdError)}</div>`
          : `<label class="ogdc-search" data-gi="${gi}"><span class="sr-only">Поиск слоя</span>
               <input class="ogd-tree-q" type="search" placeholder="поиск слоя — например, красные линии" autocomplete="off"></label>
             <div class="ogdc-list ogd-tree" data-gi="${gi}">${
               ogdTreeHtml(ogdBuildTree(ogdCatalog), gi, saved, disabled, false)}</div>`;
    } else {
      const rows = g.items.map(it => {
        const checked = (saved[it.key] ?? it.def) && !disabled;
        return `<label class="data-src${disabled ? " disabled" : ""}">
          <input type="checkbox" data-src="${it.key}" data-gi="${gi}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>
          <span>${escHtml(it.label)}</span></label>`;
      }).join("");
      body = `<div class="data-rows">${rows}</div>`;
    }
    const sub = g.picker && !ogdError && !unavailable
      ? `${escHtml(g.hint)} · ${ogdCatalog.length} слоёв · до ${g.maxKm2} км²`
      : `${escHtml(g.hint)} · до ${g.maxKm2} км²`;
    return `<div class="data-card${g.picker ? " data-card-tree" : ""}" data-gi="${gi}">
      <div class="data-card-head">
        <div class="data-card-title">${escHtml(g.title)}
          <span class="data-card-sub">${sub}</span></div>
        ${g.picker ? "" : `<button class="data-all" data-gi="${gi}"${disabled ? " disabled" : ""}>все</button>`}
      </div>
      ${unavailable ? `<div class="data-over">${escHtml(g.webNote || "В веб-версии источник недоступен")}</div>` : over ? `<div class="data-over">Область ${areaTxt} км² больше лимита ${g.maxKm2} км²
        <button class="data-zoom" data-target="${g.maxKm2}">Приблизить</button></div>` : ""}
      ${body}
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
  // Поиск по дереву каталога ОГД: фильтруем по имени/пути, найденное — с
  // раскрытыми ветками (видно, что нашлось), пустой запрос — свёрнутое дерево.
  // Чек-состояния при перерисовке восстанавливаем из уже отмеченных чекбоксов.
  const treeInput = overlay.querySelector(".ogd-tree-q");
  const treeBox = overlay.querySelector(".ogd-tree");
  if (treeInput && treeBox) {
    const gi = treeBox.dataset.gi;
    const disabledTree = km2 > DATA_SOURCE_GROUPS[+gi].maxKm2;
    treeInput.addEventListener("input", () => {
      const low = treeInput.value.trim().toLowerCase();
      const hit = low ? ogdCatalog.filter(l =>
        (l.name || "").toLowerCase().includes(low) ||
        (l.path || "").toLowerCase().includes(low)) : ogdCatalog;
      // галочки — из ogdSel (источник истины), а не из DOM: под фильтром
      // отмеченные-скрытые листья в DOM отсутствуют и потерялись бы
      treeBox.innerHTML = hit.length
        ? ogdTreeHtml(ogdBuildTree(hit), gi, ogdSel, disabledTree, !!low)
        : `<div class="fc-help">Ничего не найдено</div>`;
      refreshUI();
    });
  }

  const loadBtn = overlay.querySelector(".data-load");
  const status = overlay.querySelector(".data-status");
  const allBoxes = () => [...overlay.querySelectorAll("input[data-src]")];
  // счётчик выбранного на кнопке + подпись «все/ничего» по каждой карточке
  // Выбор в дереве ОГД живёт в ogdSel, а НЕ в DOM: под поисковым фильтром
  // отмеченные, но не совпавшие с запросом листья выпадают из DOM, и сбор
  // выбора по чекбоксам молча терял их (отметил 5 слоёв → поискал 6-й →
  // «Загрузить» грузил только видимые). ogdSel — источник истины для gisogd:*.
  const ogdSel = {};
  Object.keys(saved).forEach(k => { if (k.startsWith("gisogd:") && saved[k]) ogdSel[k] = true; });
  const ogdChecked = () => Object.keys(ogdSel).filter(k => ogdSel[k]);
  function refreshUI() {
    const plain = allBoxes().filter(b => b.checked && !b.dataset.src.startsWith("gisogd:")).length;
    const n = plain + ogdChecked().length;
    loadBtn.textContent = n ? `Загрузить (${n})` : "Загрузить";
    loadBtn.disabled = !n;
    overlay.querySelectorAll(".data-all").forEach(btn => {
      const boxes = allBoxes().filter(b => b.dataset.gi === btn.dataset.gi && !b.disabled);
      btn.textContent = (boxes.length && boxes.every(b => b.checked)) ? "ничего" : "все";
    });
  }
  overlay.addEventListener("change", ev => {
    if (!ev.target.matches("input[data-src]")) return;
    const src = ev.target.dataset.src;
    if (src.startsWith("gisogd:")) {
      if (ev.target.checked) ogdSel[src] = true; else delete ogdSel[src];
    }
    refreshUI();
  });
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
    allBoxes().forEach(b => {
      if (!b.disabled && !b.dataset.src.startsWith("gisogd:")) sel[b.dataset.src] = b.checked;
    });
    ogdChecked().forEach(k => { sel[k] = true; });   // выбор дерева переживает фильтр
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
    // gisogd:* — из ogdSel (переживает поисковый фильтр), остальное — из DOM
    const plain = boxes.filter(b => b.checked && !b.dataset.src.startsWith("gisogd:"))
      .map(b => b.dataset.src);
    const sources = plain.concat(ogdChecked());
    // выбор запоминается (и невыбор тоже) — в следующий раз диалог как оставили
    const sel = {};
    boxes.forEach(b => {
      if (!b.disabled && !b.dataset.src.startsWith("gisogd:")) sel[b.dataset.src] = b.checked;
    });
    ogdChecked().forEach(k => { sel[k] = true; });
    try { localStorage.setItem("grado_data_sources", JSON.stringify(sel)); } catch (e) {}
    if (!sources.length) { status.textContent = "Выберите хотя бы один источник"; return; }
    loadBtn.disabled = true; loadBtn.classList.add("loading");
    boxes.forEach(b => b.disabled = true);
    status.textContent = "Загрузка… НСПД может занять ~10 с";
    const busyDone = beginBusy("Загрузка данных по области…");
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
      const fieldsByLayer = {};
      for (const g of groups) {
        if (!g.layer_id || !Array.isArray(g.fields)) continue;
        fieldsByLayer[g.layer_id] = [
          ...(fieldsByLayer[g.layer_id] || []),
          ...g.fields,
        ];
      }
      const plan = prepareSourceImport({
        features: groups.flatMap(g => g.features || []),
        layers: data.layers || [],
        fieldsByLayer,
        snapshots: (data.snapshots || []).map(snapshot => ({ snapshot })),
      });
      if (!plan.added && plan.dup) {
        close();
        toast(`Данные: всё уже загружено (${plan.dup} объектов — без дубликатов)`);
        return;
      }
      if (!plan.added) throw new Error("Нет корректных объектов для импорта");
      const { added: addedAll, dup: dupAll, invalid: invalidAll } = commitPreparedSourceImport(plan);
      const parts = groups.map(g => `${g.title} ${plan.addedByLayer[g.layer_id] || 0}`);
      close();
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
    } finally {
      busyDone();          // гасим глобальный индикатор на любом исходе
    }
  });
}

// ---------- ФГИС ТП: прямой импорт векторных слоёв документа ----------
// Портал Минэка (mnp.economy.gov.ru) отдаёт документы терпланирования всей РФ
// БЕЗ авторизации (протокол v2, JSP; прежний WFS мёртв). CORS портал не даёт,
// поэтому путь только серверный (desktop) — в браузерной редакции пункт скрыт.
// Два шага в одном окне: поиск документа по названию (кэш каталога ~27 000
// записей на сервере) → чекбоксы слоёв документа → «Загрузить (N)».
let _fgCatalog = null;              // каталог документов [{uin, name}] (на сессию)
async function openFgistpDialog() {
  if (typeof closePopups === "function") closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal fmt-modal" role="dialog" aria-modal="true" aria-labelledby="fg-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy">
      <span class="modal-kicker">ФГИС ТП</span>
      <span id="fg-title">Документы терпланирования</span></div>
      <button class="modal-x" aria-label="Закрыть ФГИС ТП"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div id="fg-step-doc">
        <input id="fg-search" class="ogdc-search" type="search"
          placeholder="Название документа: Химки, генеральный план…" autocomplete="off">
        <div class="ogdc-hint">Вся Россия. Генпланы, СТП и их изменения — данные официального портала Минэкономразвития.</div>
        <div id="fg-docs" class="ogdc-list" aria-label="Найденные документы"></div>
      </div>
      <div id="fg-step-layers" hidden>
        <button id="fg-back" class="fmt-copy-btn">← К поиску документа</button>
        <div id="fg-doc-name" class="ogdc-hint"></div>
        <div id="fg-layers" class="ogdc-list" aria-label="Слои документа"></div>
      </div>
    </div>
    <div class="modal-actions"><span id="fg-status" class="muted"></span><span class="spacer"></span>
      <button id="fg-cancel">Отмена</button>
      <button id="fg-load" class="primary" disabled>Загрузить</button></div></div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector("#" + id);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").addEventListener("click", close);
  $("fg-cancel").addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
  overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") close(); });

  const status = $("fg-status");
  let currentDoc = null;            // {uin, name}

  // --- шаг 1: поиск документа ---
  const renderDocs = q => {
    const box = $("fg-docs");
    if (!_fgCatalog) { box.innerHTML = ""; return; }
    const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е");
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) {
      box.innerHTML = `<div class="ogdc-hint" style="padding:10px 12px">Введите название муниципалитета или документа — например «Химки».</div>`;
      return;
    }
    const hits = [];
    for (const d of _fgCatalog) {
      const n = norm(d.name);
      if (words.every(w => n.includes(w))) {
        hits.push(d);
        if (hits.length >= 50) break;
      }
    }
    box.innerHTML = hits.map(d =>
      `<button type="button" class="ogdc-row fg-doc" data-uin="${escHtml(d.uin)}" title="${escHtml(d.name)}">${escHtml(d.name)}</button>`
    ).join("") || `<div class="ogdc-hint" style="padding:10px 12px">Ничего не найдено.</div>`;
    box.querySelectorAll(".fg-doc").forEach(b => b.addEventListener("click", () =>
      pickDoc({ uin: b.dataset.uin, name: b.title })));
  };
  $("fg-search").addEventListener("input", () => renderDocs($("fg-search").value));

  // --- шаг 2: слои документа ---
  const GEOM_GROUPS = [["100", "Зоны и территории (полигоны)"],
                       ["010", "Линейные объекты"], ["001", "Точечные объекты"]];
  const refreshCount = () => {
    const n = overlay.querySelectorAll(".fg-cls:checked").length;
    $("fg-load").textContent = n ? `Загрузить (${n})` : "Загрузить";
    $("fg-load").disabled = !n;
  };
  async function pickDoc(doc) {
    currentDoc = doc;
    status.className = "fg-loading"; status.textContent = "Состав документа…";
    const done = beginBusy("Состав документа…");
    try {
      const r = await fetch(`/api/fgistp-layers?uin=${encodeURIComponent(doc.uin)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      const layers = (await r.json()).layers || [];
      status.className = "muted"; status.textContent = "";
      $("fg-step-doc").hidden = true;
      $("fg-step-layers").hidden = false;
      $("fg-doc-name").textContent = doc.name;
      $("fg-layers").innerHTML = GEOM_GROUPS.map(([gt, label]) => {
        const rows = layers.filter(l => l.geom_type === gt);
        if (!rows.length) return "";
        return `<div class="fg-group"><b>${escHtml(label)}</b> (${rows.length})</div>` +
          rows.map(l =>
            `<label class="fg-row" title="${escHtml(l.name || l.classid)}">
               <input type="checkbox" class="fg-cls" value="${escHtml(l.classid)}" data-gt="${gt}">
               <span class="fg-name">${escHtml(l.name || l.classid)}</span>
             </label>`).join("");
      }).join("");
      overlay.querySelectorAll(".fg-cls").forEach(cb =>
        cb.addEventListener("change", refreshCount));
      refreshCount();
    } catch (err) {
      status.className = "muted"; status.textContent = "";
      toast("Состав документа недоступен: " + String(err.message || err).slice(0, 140), "error");
    } finally {
      done();
    }
  }
  $("fg-back").addEventListener("click", () => {
    $("fg-step-layers").hidden = true;
    $("fg-step-doc").hidden = false;
    $("fg-load").disabled = true;
    $("fg-load").textContent = "Загрузить";
  });

  // --- загрузка выбранных слоёв ---
  $("fg-load").addEventListener("click", async () => {
    if (!currentDoc) return;
    const classids = [...overlay.querySelectorAll(".fg-cls:checked")].map(c => c.value);
    if (!classids.length) return;
    $("fg-load").disabled = true;
    status.className = "fg-loading";
    status.textContent = "Загрузка слоёв с портала…";
    const ok = await importGisogd(
      ["/api/import-fgistp-doc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uin: currentDoc.uin, classids }),
      }],
      `ФГИС ТП: «${currentDoc.name.slice(0, 80)}»`,
      "Импорт из ФГИС ТП не удался");
    status.className = "muted"; status.textContent = "";
    if (ok) close(); else refreshCount();
  });

  // каталог: грузим один раз на сессию (на сервере — кэш 7 суток). Каталог
  // большой (~10 МБ), поэтому показываем реальный процент загрузки байтов
  // (fetchJsonProgress читает поток и делит на Content-Length).
  if (!_fgCatalog) {
    const done = beginBusy("Каталог документов ФГИС ТП…");
    $("fg-docs").innerHTML =
      `<div class="fg-loading" style="padding:14px 12px">Загрузка каталога документов (вся Россия)…</div>`;
    const setPct = frac => {
      if (frac == null) { status.className = "fg-loading"; status.textContent = "Каталог документов…"; return; }
      const pct = Math.round(frac * 100);
      status.className = "muted"; status.textContent = `Каталог документов… ${pct}%`;
      setBusyProgress(frac, `Каталог документов ФГИС ТП… ${pct}%`);
    };
    try {
      const data = await fetchJsonProgress("/api/fgistp-catalog", undefined, setPct);
      _fgCatalog = data.docs || [];
      status.className = "muted"; status.textContent = "";
    } catch (err) {
      status.className = "muted"; status.textContent = "";
      toast("Каталог ФГИС ТП недоступен: " + String(err.message || err).slice(0, 140), "error");
      close();
      return;
    } finally {
      done();
    }
  }
  renderDocs("");
  $("fg-search").focus();
}
