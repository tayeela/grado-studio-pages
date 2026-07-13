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
  { title: "Рельеф", hint: "горизонтали из открытого DEM (SRTM)",
    maxKm2: 80, items: [
      { key: "terrain.contours", label: "Горизонтали (сечение авто)", def: false },
    ]},
];

function viewExtentBbox() {
  // текущий видимый прямоугольник холста → [west, south, east, north] WGS84
  const w = cv.clientWidth, h = cv.clientHeight;
  const p0 = s2w(0, h), p1 = s2w(w, 0);
  const [lon0, lat0] = localToLonLat(p0[0], p0[1]);
  const [lon1, lat1] = localToLonLat(p1[0], p1[1]);
  return [Math.min(lon0, lon1), Math.min(lat0, lat1),
          Math.max(lon0, lon1), Math.max(lat0, lat1)];
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
    const over = km2 > g.maxKm2;
    const rows = g.items.map(it => {
      const checked = (saved[it.key] ?? it.def) && !over;
      return `<label class="data-src${over ? " disabled" : ""}">
        <input type="checkbox" data-src="${it.key}" data-gi="${gi}"${checked ? " checked" : ""}${over ? " disabled" : ""}>
        <span>${escHtml(it.label)}</span></label>`;
    }).join("");
    return `<div class="data-card" data-gi="${gi}">
      <div class="data-card-head">
        <div class="data-card-title">${escHtml(g.title)}
          <span class="data-card-sub">${escHtml(g.hint)} · до ${g.maxKm2} км²</span></div>
        <button class="data-all" data-gi="${gi}"${over ? " disabled" : ""}>все</button>
      </div>
      ${over ? `<div class="data-over">Область ${areaTxt} км² больше лимита ${g.maxKm2} км²
        <button class="data-zoom" data-target="${g.maxKm2}">Приблизить</button></div>` : ""}
      <div class="data-rows">${rows}</div>
    </div>`;
  }).join("");
  overlay.innerHTML = `<div class="modal fmt-modal data-modal">
    <div class="modal-head">Данные по области
      <button class="modal-x" aria-label="Закрыть данные по области"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="data-area-bar"><span>Видимая область</span><b>${areaTxt} км²</b></div>
      ${cardsHtml}
      <div class="data-card data-card-ogd">
        <div class="data-card-head">
          <div class="data-card-title">ГИС ОГД Москвы
            <span class="data-card-sub">официальные слои · портал mos.ru</span></div>
        </div>
        <div class="data-ogd-row">
          <button class="data-ogd-portal">Открыть портал</button>
          <span class="data-watch-status muted">скачайте выгрузку — студия подхватит её из «Загрузок» сама</span>
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
      toast(`Данные: +${plObjects(addedAll)} (${parts.join(" · ")})${dupNote}${invalidNote}`,
        invalidAll ? "warn" : undefined);
      if (data.notes && data.notes.length)
        console.info("Данные по области:", data.notes.join("\n"));
    } catch (err) {
      status.textContent = "";
      loadBtn.classList.remove("loading");
      boxes.forEach(b => b.disabled = false);
      refreshUI();
      toast("Не удалось загрузить: " + String(err.message || err).slice(0, 180), "error");
    }
  });
}
