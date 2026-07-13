// ============================================================================
//  app-import.js — импорт данных: мост/inbox (pollInbox), захват НСПД (файл),
//  ГИС ОГД (ZIP: файл/ссылка/автоподхват из «Загрузок»), вахта downloadsWatch.
//  Вынесено из монолита app.js (P0-разрез). Классический скрипт, общий
//  global-scope. ВНИМАНИЕ: грузится ПОСЛЕ app.js (в отличие от прочих модулей),
//  т.к. блок содержит top-level исполнение (setInterval(pollInbox), pollInbox(),
//  on()-биндинги, st-core.onclick), которому нужны on/state/importSourceFeatures
//  из app.js. Общий импортёр importSourceFeatures и журнал recordSource/
//  fetchSources/renderSources остались в app.js (используются и app-data.js).
// ============================================================================

let serverDown = false;
async function pollInbox() {
  try {
    const r = await fetch("/api/inbox");
    const data = await r.json();
    if (serverDown) {
      // сервер был недоступен (перезапуск/сон) и снова ответил — досасываем
      // то, что могло устареть за это время, без ручного F5
      serverDown = false;
      initStyles(); fetchSources(); refreshTep();
      toast("Связь с сервером восстановлена");
    }
    // приём данных от браузерного расширения GRADO: в норме молчим,
    // сообщаем только когда канал занят (в QGIS открыт тот же порт)
    document.getElementById("st-bridge").textContent =
      data.bridge ? "" : "приём данных из браузера занят (закрыт в QGIS?)";
    let added = 0, dup = 0, snapped = false;
    for (const item of data.items) {
      if (!item.features.length) continue;
      if (!snapped) { snapshot(); snapped = true; }
      const r = importSourceFeatures(item.features);
      added += r.added; dup += r.dup;
      recordSource(item.snapshot, item.diff);   // снимок моста → журнал
    }
    if (added || dup) {
      afterChange();
      fitView();
      const src = data.items[0].source === "fgis_tp" ? "ФГИС ТП" : "НСПД";
      toast(`Получено из браузера: +${plObjects(added)} (${src})` + (dup ? ` · ${dup} уже были` : ""));
    }
  } catch (e) {
    if (!serverDown) {
      serverDown = true;
      document.getElementById("st-core").textContent = "⚠ нет связи с сервером — переподключение…";
    }
  }
}
setInterval(pollInbox, 2500);
pollInbox();
document.getElementById("st-core").onclick = () => {
  serverDown = false;
  document.getElementById("st-core").textContent = "";
  pollInbox();
  refreshTep();
  toast("Переподключение к серверу...");
};

// импорт захвата НСПД (JSON браузерного моста GRADO)
on("btn-nspd", "click", () => document.getElementById("nspd-file").click());
on("nspd-file", "change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  try {
    const payload = JSON.parse(await file.text());
    const r = await fetch("/api/import-nspd", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }) });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (!data.features.length) { toast("В захвате нет полигонов НСПД", "warn"); return; }
    snapshot();
    const { added, dup } = importSourceFeatures(data.features);
    state.selected = null;
    recordSource(data.snapshot, data.diff);   // снимок импорта → журнал
    afterChange();
    fitView();
    if (dup) toast(`НСПД: +${added} · ${dup} уже были (пропущены)`);
  } catch (err) {
    toast("Не удалось импортировать захват: " + String(err).slice(0, 200), "error");
  }
});

// ---------- импорт выгрузки ГИС ОГД (ZIP с портала) ----------
// Три пути к одному результату: файл с диска, прямая ссылка, автоподхват
// из «Загрузок» (см. вахту watchDownloads ниже). Разбор и раскладка по
// слоям общие — applyGisogdData.
async function applyGisogdData(data, askText) {
  if (!data.features || !data.features.length) {
    toast("В выгрузке не нашлось распознанных слоёв", "warn");
    return false;
  }
  const summary = data.notes && data.notes.length ? data.notes.join("; ") : "слои распознаны";
  const ok = await uiConfirm(
    `${askText}\n+${data.features.length} объектов.\n${summary}\n(Данные добавятся к текущему проекту.)`,
    { ok: "Импортировать", cancel: "Отмена" });
  if (!ok) return false;
  snapshot();
  const { added, dup } = importSourceFeatures(data.features);
  state.selected = null;
  recordSource(data.snapshot, data.diff);
  // атрибуты ОГД → колонки таблицы соответствующих слоёв (как в «Данных»)
  if (data.fields) {
    for (const [lid, flds] of Object.entries(data.fields)) {
      const L = LAYER_BY_ID[lid]; if (!L) continue;
      L.fields = L.fields || [];
      const taken = new Set(L.fields.map(fd => fd.name));
      for (const fd of flds)
        if (!taken.has(fd.name)) { L.fields.push(fd); taken.add(fd.name); }
    }
  }
  ["source.gisogd.func_zones", "source.gisogd.red_lines", "source.gisogd.restrict",
   "source.gisogd.other"].forEach(id => {
    const L = LAYER_BY_ID[id]; if (L) L.visible = true;
  });
  afterChange();
  fitView();
  renderLayers();
  const dupNote = dup ? ` · ${dup} уже были (пропущены)` : "";
  toast(`ОГД: +${added} объектов${dupNote}` +
        (data.notes && data.notes.length ? ` · ${data.notes.join("; ")}` : ""));
  return true;
}
async function importGisogd(fetchArgs, askText, errText) {
  try {
    const r = await fetch(...fetchArgs);
    if (!r.ok) {
      let msg = await r.text();
      try { msg = JSON.parse(msg).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return await applyGisogdData(await r.json(), askText);
  } catch (err) {
    toast(errText + ": " + String(err.message || err).slice(0, 200), "error");
    return false;
  }
}
on("btn-gisogd", "click", async () => {
  const useFile = await uiConfirm("Загрузить ГИС ОГД:\n- Файл (ZIP с портала или отдельный GeoJSON, напр. экспорт из QGIS)\n- По прямой ссылке (сгенерированной на gisogd.mos.ru)", { ok: "Файл", cancel: "По ссылке" });
  if (useFile) {
    document.getElementById("gisogd-file").click();
  } else {
    const url = await uiPrompt(
      "Прямая ссылка на ZIP-выгрузку ГИС ОГД\n(на gisogd.mos.ru выберите слои, сгенерируйте выгрузку и скопируйте ссылку скачивания):",
      "", { ok: "Загрузить", placeholder: "https://gisogd.mos.ru/…" });
    if (!url || !url.trim()) return;
    await importGisogd(
      ["/api/import-gisogd-url", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }) }],
      "Импортировать ГИС ОГД по ссылке?",
      "Не удалось импортировать по ссылке");
  }
});
on("gisogd-file", "change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  await importGisogd(
    ["/api/import-gisogd", { method: "POST",
      headers: { "Content-Type": "application/octet-stream",
        // имя файла — для маршрутизации одиночного GeoJSON в нужный слой
        // (URL-энкод: заголовок обязан быть ASCII); ZIP имя игнорирует
        "X-Grado-Filename": encodeURIComponent(file.name) },
      body: await file.arrayBuffer() }],
    "Импортировать выгрузку ГИС ОГД (ZIP или GeoJSON)?",
    "Не удалось импортировать выгрузку ОГД");
});

// ---------- вахта за «Загрузками»: автоподхват выгрузки ГИС ОГД ----------
// «Открыть портал» в окне «Данные» открывает gisogd.mos.ru и армирует
// слежение: как только в ~/Downloads появляется свежий ZIP — студия сама
// предлагает импорт. Никаких «сохранить, найти файл, выбрать в диалоге».
const downloadsWatch = { timer: null, since: 0, until: 0, offered: new Set() };
function stopDownloadsWatch(msg) {
  if (downloadsWatch.timer) { clearInterval(downloadsWatch.timer); downloadsWatch.timer = null; }
  const el = document.querySelector(".data-watch-status");
  if (el && msg) el.textContent = msg;
}
function startDownloadsWatch() {
  stopDownloadsWatch();
  downloadsWatch.since = Date.now() / 1000;
  downloadsWatch.until = Date.now() + 15 * 60 * 1000;   // вахта 15 минут
  downloadsWatch.timer = setInterval(async () => {
    if (Date.now() > downloadsWatch.until) { stopDownloadsWatch("время вышло — нажмите ещё раз"); return; }
    let files;
    try {
      const r = await fetch(`/api/downloads-scan?since=${downloadsWatch.since}`);
      if (!r.ok) return;
      files = (await r.json()).files || [];
    } catch (e) { return; }
    for (const f of files) {
      if (downloadsWatch.offered.has(f.path)) continue;
      downloadsWatch.offered.add(f.path);
      stopDownloadsWatch();
      const mb = (f.size / 1048576).toFixed(1);
      const imported = await importGisogd(
        ["/api/import-gisogd-path", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: f.path }) }],
        `В «Загрузках» появилась выгрузка «${f.name}» (${mb} МБ). Импортировать?`,
        "Не удалось импортировать " + f.name);
      if (!imported) startDownloadsWatch();   // не тот файл — ждём дальше
      return;
    }
  }, 3000);
}
