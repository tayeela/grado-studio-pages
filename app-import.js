// ============================================================================
//  app-import.js — импорт данных: мост/inbox (pollInbox), захват НСПД (файл),
//  ГИС ОГД (ZIP: файл/ссылка/автоподхват из «Загрузок»), вахта downloadsWatch.
//  Вынесено из монолита app.js (P0-разрез). Классический скрипт, общий
//  global-scope. ВНИМАНИЕ: грузится ПОСЛЕ app.js (в отличие от прочих модулей),
//  т.к. блок содержит top-level исполнение (setInterval(pollInbox), pollInbox(),
//  on()-биндинги, st-core.onclick), которому нужны on/state и транзакционный
//  импортёр prepareSourceImport/commitPreparedSourceImport из app.js. Журнал recordSource/
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
    const items = (data.items || []).filter(item => Array.isArray(item.features) && item.features.length);
    let added = 0, dup = 0, invalid = 0;
    if (items.length) {
      const fieldsByLayer = {};
      for (const item of items) {
        for (const [layerId, fields] of Object.entries(item.fields || {}))
          fieldsByLayer[layerId] = [...(fieldsByLayer[layerId] || []), ...(fields || [])];
      }
      const plan = prepareSourceImport({
        features: items.flatMap(item => item.features),
        layers: items.flatMap(item => item.layers || []),
        fieldsByLayer,
        snapshots: items.map(item => ({ snapshot: item.snapshot, diff: item.diff })),
      });
      ({ added, dup, invalid } = plan.added ? commitPreparedSourceImport(plan) : plan);
    }
    if (added || dup || invalid) {
      afterChange();
      fitView();
      const src = items[0]?.source === "fgis_tp" ? "ФГИС ТП" : "НСПД";
      toast(`Получено из браузера: +${plObjects(added)} (${src})` +
        (dup ? ` · ${dup} уже были` : "") +
        (invalid ? ` · ${invalid} поврежд. пропущено` : ""), invalid ? "warn" : undefined);
    }
  } catch (e) {
    if (!serverDown) {
      serverDown = true;
      // Раньше сообщение уходило в #st-core — скрытый инлайн-стилем узел,
      // который никто не видел; он удалён. Пишем в статус-строку.
      toast("Нет связи с сервером — переподключение…", "warn");
    }
  }
}
setInterval(pollInbox, 2500);
pollInbox();
// Ручного «переподключиться» больше нет: опрос и так повторяется каждые 2.5 с,
// а восстановление связи обрабатывается выше по ветке serverDown — с
// досасыванием стилей, источников и ТЭП. Прежний обработчик висел на #st-core,
// невидимом узле, и после его удаления падал ПРИ ЗАГРУЗКЕ, обрывая файл: ниже
// объявлены привязки кнопок НСПД и ФГИС ТП, и они переставали работать.

// импорт захвата НСПД (JSON браузерного моста GRADO)
on("btn-nspd", "click", () => document.getElementById("nspd-file").click());
// ФГИС ТП — прямой импорт векторных слоёв документа по УИН (диалог в app-data.js)
on("btn-fgistp", "click", () => openFgistpDialog());
let nspdImportBusy = false;
on("nspd-file", "change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  if (nspdImportBusy) { toast("Импорт НСПД уже выполняется", "warn"); return; }
  if (file.size > MAX_JSON_IMPORT_BYTES) {
    toast("Файл НСПД больше 64 МБ — уменьшите область выгрузки", "error");
    return;
  }
  nspdImportBusy = true;
  const nspdBusy = beginBusy("Импорт НСПД…");
  try {
    const payload = JSON.parse(await file.text());
    const r = await fetch("/api/import-nspd", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }) });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (!data.features.length) { toast("В захвате нет полигонов НСПД", "warn"); return; }
    const plan = prepareSourceImport({ features: data.features,
      snapshots: [{ snapshot: data.snapshot, diff: data.diff }] });
    if (!plan.added && plan.dup) {
      toast(`НСПД: всё уже загружено (${plan.dup} объектов)`);
      return;
    }
    const { added, dup, invalid } = commitPreparedSourceImport(plan);
    fitView();
    if (dup || invalid) toast(`НСПД: +${added}` +
      (dup ? ` · ${dup} уже были` : "") +
      (invalid ? ` · ${invalid} поврежд. пропущено` : ""), invalid ? "warn" : undefined);
  } catch (err) {
    toast("Не удалось импортировать захват: " + String(err).slice(0, 200), "error");
  } finally {
    nspdImportBusy = false;
    nspdBusy();
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
  const plan = prepareSourceImport({
    features: data.features,
    layers: data.layers,
    fieldsByLayer: data.fields,
    snapshots: [{ snapshot: data.snapshot, diff: data.diff }],
  });
  if (!plan.added && plan.dup) {
    toast(`ОГД: всё уже загружено (${plan.dup} объектов)`);
    return true;
  }
  if (!plan.added && plan.invalid)
    throw new Error(`Все объекты выгрузки повреждены: ${plan.invalidDetails.join("; ")}`);
  const summary = data.notes && data.notes.length ? data.notes.join("; ") : "слои распознаны";
  const ok = await uiConfirm(
    `${askText}\nНовых объектов: ${plan.added}.` +
    (plan.dup ? ` Уже загружено: ${plan.dup}.` : "") +
    (plan.invalid ? ` Повреждено и будет пропущено: ${plan.invalid}.` : "") +
    `\n${summary}\nИзменения будут применены одной транзакцией.`,
    { ok: "Импортировать", cancel: "Отмена" });
  if (!ok) return false;
  const { added, dup, invalid } = commitPreparedSourceImport(plan);
  fitView();
  const dupNote = dup ? ` · ${dup} уже были (пропущены)` : "";
  const invalidNote = invalid ? ` · ${invalid} поврежд. пропущено` : "";
  toast(`ОГД: +${added} объектов${dupNote}` +
        invalidNote + (data.notes && data.notes.length ? ` · ${data.notes.join("; ")}` : ""),
        invalid ? "warn" : undefined);
  return true;
}
async function importGisogd(fetchArgs, askText, errText) {
  const done = beginBusy("Загрузка данных…");
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
  } finally {
    done();
  }
}
on("btn-gisogd", "click", async () => {
  if (window.GRADO_STATIC) {
    document.getElementById("gisogd-file").click();
    return;
  }
  const source = await uiChoice(
    "Выберите источник данных. Файл может быть ZIP-выгрузкой с портала или отдельным GeoJSON.",
    [
      { value: "url", label: "Вставить ссылку" },
      { value: "file", label: "Выбрать файл", primary: true },
    ],
    { title: "Импорт ГИС ОГД" });
  if (source === "file") {
    document.getElementById("gisogd-file").click();
  } else if (source === "url") {
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
let gisogdImportBusy = false;
on("gisogd-file", "change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  if (gisogdImportBusy) { toast("Импорт ГИС ОГД уже выполняется", "warn"); return; }
  if (window.GRADO_STATIC && !/\.(geojson|json)$/i.test(file.name)) {
    toast("В браузере можно импортировать отдельный GeoJSON. ZIP доступен в настольной версии", "warn");
    return;
  }
  const sizeLimit = window.GRADO_STATIC ? MAX_JSON_IMPORT_BYTES : MAX_PROJECT_FILE_BYTES;
  if (file.size > sizeLimit) {
    toast(window.GRADO_STATIC
      ? "GeoJSON больше 64 МБ — уменьшите область или используйте настольную версию"
      : "Выгрузка больше 256 МБ — уменьшите набор слоёв или область", "error");
    return;
  }
  gisogdImportBusy = true;
  try {
    await importGisogd(
      ["/api/import-gisogd", { method: "POST",
        headers: { "Content-Type": window.GRADO_STATIC ? "application/geo+json" : "application/octet-stream",
          // имя файла — для маршрутизации одиночного GeoJSON в нужный слой
          // (URL-энкод: заголовок обязан быть ASCII); ZIP имя игнорирует
          "X-Grado-Filename": encodeURIComponent(file.name) },
        body: window.GRADO_STATIC ? await file.text() : await file.arrayBuffer() }],
      window.GRADO_STATIC ? "Импортировать GeoJSON ГИС ОГД?" : "Импортировать выгрузку ГИС ОГД (ZIP или GeoJSON)?",
      "Не удалось импортировать выгрузку ОГД");
  } finally {
    gisogdImportBusy = false;
  }
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
