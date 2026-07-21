/* GitHub Pages edition: local browser storage + lightweight client API.
   Loaded only by packaging/build_pages.py, before the regular Studio scripts. */
(function () {
  "use strict";

  window.GRADO_STATIC = true;
  const nativeFetch = window.fetch.bind(window);
  const AUTOSAVE_KEY = "grado_pages_autosave_v1";
  const AUTOSAVE_BACKUP_KEY = "grado_pages_autosave_checkpoint_v1";
  const LEGACY_AUTOSAVE_KEY = "grado_studio_v1";
  const OVERRIDES_KEY = "grado_pages_style_overrides_v1";
  const DB_NAME = "grado-studio-pages";
  const DB_STORE = "project-state";
  const MAX_BROWSER_IMPORT_CHARS = 64 * 1024 * 1024;
  let databasePromise = null;
  let autosaveWriteQueue = Promise.resolve();

  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
  const pagesCore = window.GRADO_PAGES_CORE;
  if (!pagesCore) throw new Error("Не загружено вычислительное ядро браузерной версии");
  const bodyText = async (input, options) => {
    const body = options && options.body;
    if (typeof body === "string") return body;
    if (body && typeof body.text === "function") return body.text();
    if (input instanceof Request) return input.clone().text();
    return "";
  };
  const bodyJson = async (input, options) => {
    const text = await bodyText(input, options);
    if (!text) return {};
    try { return JSON.parse(text); }
    catch (error) { return null; }
  };
  const abortError = () => {
    const error = new Error("Загрузка отменена");
    error.name = "AbortError";
    return error;
  };
  const throwIfAborted = signal => {
    if (signal?.aborted) throw abortError();
  };
  const requestHeader = (input, options, name) => {
    const headers = (options && options.headers) ||
      (input instanceof Request ? input.headers : null);
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    if (Array.isArray(headers)) {
      const item = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
      return item ? item[1] : null;
    }
    const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  };
  const readStoredJson = key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  };
  const openDatabase = () => {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    let guardedOpening;
    const opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE))
          request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        const release = () => {
          if (databasePromise === guardedOpening) databasePromise = null;
        };
        database.onversionchange = () => { database.close(); release(); };
        database.onclose = release;
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
    // Заблокированное обновление или временный сбой не должны навсегда
    // приклеивать вкладку к отклонённому Promise. Следующий автосейв попробует
    // открыть IndexedDB снова, что особенно важно для больших проектов.
    guardedOpening = opening.catch(error => {
      if (databasePromise === guardedOpening) databasePromise = null;
      throw error;
    });
    databasePromise = guardedOpening;
    return databasePromise;
  };
  const databaseRequest = async (mode, action) => {
    const database = await openDatabase();
    if (!database) throw new Error("IndexedDB unavailable");
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, mode);
      const request = action(transaction.objectStore(DB_STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  };
  const databaseGet = key => databaseRequest("readonly", store => store.get(key));
  const databaseSet = (key, value) =>
    databaseRequest("readwrite", store => store.put(value, key));
  const storedProjectGet = async key => {
    if (typeof indexedDB !== "undefined") {
      try {
        const value = await databaseGet(key);
        if (value !== undefined) return value;
        const legacy = readStoredJson(key);
        if (legacy !== null) {
          await databaseSet(key, legacy);
          localStorage.removeItem?.(key);
        }
        return legacy;
      } catch (error) {
        // Safari private mode and locked-down corporate browsers may expose
        // IndexedDB but reject its first transaction. Keep the old fallback.
      }
    }
    return readStoredJson(key);
  };
  const storedProjectSet = async (key, value) => {
    if (typeof indexedDB !== "undefined") {
      try {
        await databaseSet(key, value);
        localStorage.removeItem?.(key);
        return;
      } catch (error) {
        // Fall through to localStorage only when the durable database cannot
        // be opened. This preserves compatibility with private mode.
      }
    }
    localStorage.setItem(key, JSON.stringify(value));
  };
  const queueAutosaveWrite = action => {
    // Порядок берём в момент вызова fetch, до чтения body. Иначе более старый
    // медленный запрос способен завершиться после нового и затереть его.
    const pending = autosaveWriteQueue.then(action, action);
    autosaveWriteQueue = pending.catch(() => {});
    return pending;
  };
  const backupMeta = payload => {
    const state = isRecord(payload && payload.state) ? payload.state : payload;
    if (!isRecord(state) || !Array.isArray(state.features)) return null;
    return {
      id: 1,
      saved_at: payload && payload.saved_at || null,
      name: typeof state.name === "string" && state.name.trim() ? state.name : "Без названия",
      feature_count: state.features.length,
      size: JSON.stringify(payload).length,
    };
  };
  const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
  const projectBodyError = payload => {
    if (!isRecord(payload)) return "Тело запроса должно быть объектом";
    if (!Array.isArray(payload.features)) return "features должно быть массивом";
    if (payload.params != null && !isRecord(payload.params)) return "params должно быть объектом";
    if (payload.layers != null && (!Array.isArray(payload.layers) ||
        payload.layers.some(layer => !isRecord(layer)))) return "layers должно быть массивом объектов";
    return null;
  };

  const OVERPASS_URLS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  const NSPD_EXTENT_URL = "https://nspd.gov.ru/api/geoportal/v1/intersects?typeIntersect=fullObject";
  const bboxKm2 = bbox => {
    const [west, south, east, north] = bbox.map(Number);
    return Math.abs(north - south) * 111.32 * Math.abs(east - west) * 111.32 *
      Math.cos((south + north) / 2 * Math.PI / 180);
  };
  const mergeExtent = (target, part) => {
    target.groups.push(...(part.groups || []));
    target.notes.push(...(part.notes || []));
    target.snapshots.push(...(part.snapshots || []));
    // слои-приёмники (source.gisogd.zouit.* по LineCode) — фронт их регистрирует;
    // без этого объект молча уедет в общий слой по ВИДУ (правило 7)
    for (const L of (part.layers || []))
      if (!(target.layers || (target.layers = [])).some(x => x.id === L.id))
        target.layers.push(L);
  };
  const fetchOverpass = async (query, signal) => {
    let lastError = null;
    for (const url of OVERPASS_URLS) {
      throwIfAborted(signal);
      try {
        const response = await nativeFetch(url, { method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(), signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw abortError();
        lastError = error;
      }
    }
    throw new Error(`Overpass недоступен: ${lastError?.message || lastError || "нет ответа"}`);
  };
  // ---- ГИС ОГД: слой качается целиком (портал не фильтрует по bbox) и живёт
  // в IndexedDB; повторная выгрузка любой площадки берёт его из кэша.
  const GISOGD_TTL_MS = 7 * 24 * 3600 * 1000;
  const gisogdCacheKey = code => `gisogd_layer_${code}`;
  async function gisogdLayerJson(code, notes, signal) {
    throwIfAborted(signal);
    try {
      const hit = await databaseGet(gisogdCacheKey(code));
      throwIfAborted(signal);
      if (hit && hit.at && (Date.now() - hit.at) < GISOGD_TTL_MS) return hit.data;
    } catch (error) { /* кэш недоступен — тянем из сети */ }
    throwIfAborted(signal);
    const response = await nativeFetch(pagesCore.gisogdLayerUrl(code), { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    throwIfAborted(signal);
    notes.push(`слой ${code} загружен целиком (${(data.features || []).length} об.) — `
      + "портал не фильтрует по области; дальше берётся из кэша браузера");
    try { await databaseSet(gisogdCacheKey(code), { at: Date.now(), data }); }
    catch (error) { notes.push(`слой ${code} не поместился в кэш — будет качаться заново`); }
    throwIfAborted(signal);
    return data;
  }
  let gisogdCatalogCache = null;
  async function gisogdCatalog(signal) {
    throwIfAborted(signal);
    if (gisogdCatalogCache) return gisogdCatalogCache;
    const response = await nativeFetch(pagesCore.gisogdCatalogUrl(), { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    gisogdCatalogCache = pagesCore.buildGisogdCatalog(await response.json());
    throwIfAborted(signal);
    return gisogdCatalogCache;
  }
  // ключ источника → {code, name}: кураторские (gisogd.func_zones…) и любой
  // слой портала (gisogd:{code}); имя берём из каталога — по нему идёт маршрут
  async function gisogdLayersFor(key, signal) {
    const curated = pagesCore.GISOGD_WEB_LAYERS[key];
    if (curated) return curated;
    if (!key.startsWith("gisogd:")) return [];
    const code = key.slice("gisogd:".length);
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(code)) return [];
    const row = (await gisogdCatalog(signal)).find(l => l.code === code);
    return row ? [{ code, name: row.name }] : [];
  }

  async function browserFetchExtent(payload, signal) {
    throwIfAborted(signal);
    const bbox = payload && payload.bbox;
    const sources = [...new Set(Array.isArray(payload && payload.sources) ? payload.sources : [])];
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(value => Number.isFinite(Number(value))))
      throw new Error("Некорректная видимая область");
    const area = bboxKm2(bbox);
    const result = { groups: [], notes: [], snapshots: [], layers: [] };
    const failures = [];
    const osmSources = sources.filter(source => source.startsWith("osm."));
    const nspdSources = sources.filter(source => source.startsWith("nspd."));
    if (osmSources.length) {
      if (area > 60) throw new Error(`Область ${area.toFixed(1)} км² больше предела 60 км² для OSM — приблизьте вид`);
      try {
        const query = pagesCore.buildOsmExtentRequest(bbox, osmSources);
        mergeExtent(result, pagesCore.importOsmExtent(await fetchOverpass(query, signal), osmSources, bbox));
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw abortError();
        failures.push(`OSM: ${error.message || error}`);
      }
    }
    if (nspdSources.length) {
      if (area > 12) throw new Error(`Область ${area.toFixed(1)} км² больше предела 12 км² для НСПД — приблизьте вид`);
      for (const source of nspdSources) {
        try {
          const response = await nativeFetch(NSPD_EXTENT_URL, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pagesCore.buildNspdExtentRequest(bbox, source)), signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          mergeExtent(result, pagesCore.importNspdExtent(await response.json(), source, bbox));
        } catch (error) {
          if (error?.name === "AbortError" || signal?.aborted) throw abortError();
          failures.push(`${source}: ${error.message || error}`);
        }
      }
    }
    // ГИС ОГД: кураторские наборы (gisogd.*) и любой слой портала (gisogd:{code}).
    // Один источник может быть несколькими слоями портала (ТиНАО), но каждая
    // группа обязана сохранить собственные layer_id/title/fields до commit.
    const ogdSources = sources.filter(s => s.startsWith("gisogd.") || s.startsWith("gisogd:"));
    if (ogdSources.length) {
      if (area > 80) throw new Error(`Область ${area.toFixed(1)} км² больше предела 80 км² для ГИС ОГД — приблизьте вид`);
      for (const source of ogdSources) {
        throwIfAborted(signal);
        const sourceLayers = await gisogdLayersFor(source, signal);
        if (!sourceLayers.length) {
          failures.push(`${source}: слой не найден в каталоге портала`);
          continue;
        }
        for (const layer of sourceLayers) {
          try {
            const raw = await gisogdLayerJson(layer.code, result.notes, signal);
            const part = pagesCore.importGisogdExtent(raw, layer, bbox);
            for (const group of (part.groups || [])) group.request_source = source;
            mergeExtent(result, part);
          } catch (error) {
            if (error?.name === "AbortError" || signal?.aborted) throw abortError();
            failures.push(`ГИС ОГД [${layer.code}]: ${error.message || error}`);
          }
        }
      }
    }
    if (sources.includes("terrain.contours"))
      result.notes.push("Рельеф по области пока требует настольную версию");
    const gisogdPicked = sources.some(s => s.startsWith("gisogd"));
    if (!osmSources.length && !nspdSources.length && !gisogdPicked
        && !sources.includes("terrain.contours"))
      failures.push("Не выбраны поддерживаемые источники");
    // Ответ либо содержит весь выбранный набор, либо не содержит ничего:
    // фронт не должен применить «успешную половину» и потерять сведения о сбое.
    if (failures.length)
      throw new Error(`Импорт отменён: не все выбранные источники загружены. ${failures.join(" · ")}`);
    return result;
  }

  window.gradoTileUrl = (z, x, y, source) => source === "osm"
    ? `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  window.fetch = async function (input, options = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, window.location.href);
    const path = url.pathname;
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const signal = options.signal || (input instanceof Request ? input.signal : null);
    throwIfAborted(signal);

    if (path === "/version.json" || path.endsWith("/version.json")) {
      const versionUrl = new URL("./version.json", window.location.href);
      const release = window.__GRADO_ASSET_VERSION__;
      if (release) versionUrl.searchParams.set("v", release);
      return nativeFetch(versionUrl, options);
    }
    if (!path.startsWith("/api/")) return nativeFetch(input, options);

    if (path === "/api/hub") return json({ hub: false });
    if (path === "/api/inbox") return json({ bridge: true, items: [] });
    if (path === "/api/sources") return json([]);
    if (path === "/api/styles") {
      const stylesUrl = new URL("./styles.json", window.location.href);
      const release = window.__GRADO_ASSET_VERSION__;
      if (release) stylesUrl.searchParams.set("v", release);
      const response = await nativeFetch(stylesUrl, options);
      // Таблица «код ЛГР → знак» для маршрутизации по LineCode строится из самой
      // библиотеки знаков — не дублируем её в коде (источник: moscow_lgr.json).
      try { pagesCore.setLgrCodeStyles(await response.clone().json()); }
      catch (e) { /* без библиотеки останется маршрут по имени слоя */ }
      return response;
    }
    if (path === "/api/basemap-info") return json({
      origin_lon: pagesCore.originWgs84[0], origin_lat: pagesCore.originWgs84[1],
      attribution: "© OpenStreetMap contributors",
      attributions: {
        osm: "© OpenStreetMap contributors",
        sat: "Tiles © Esri",
        s2: "Tiles © Esri",
      },
    });
    if (path === "/api/gisogd-catalog") {
      // портал отдаёт CORS (Access-Control-Allow-Origin) → браузеру можно
      try { return json({ layers: await gisogdCatalog(signal) }); }
      catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw abortError();
        return json({ error: `каталог ГИС ОГД недоступен: ${error.message || error}` }, 502);
      }
    }
    if (path === "/api/initial-grado") return json(null);
    if (path === "/api/autosave/backups") {
      try {
        const backup = await storedProjectGet(AUTOSAVE_BACKUP_KEY);
        const meta = backupMeta(backup);
        return json({ backups: meta ? [meta] : [] });
      } catch (error) {
        return json({ backups: [] });
      }
    }
    if (path === "/api/autosave/backups/1") {
      try {
        const backup = await storedProjectGet(AUTOSAVE_BACKUP_KEY);
        return backupMeta(backup) ? json(backup) : json({ error: "Копия не найдена" }, 404);
      } catch (error) {
        return json({ error: "Копия повреждена" }, 500);
      }
    }
    if (path.startsWith("/api/autosave/backups/")) return json(null, 404);
    if (path === "/api/autosave") {
      if (method === "POST") {
        return queueAutosaveWrite(async () => {
          const state = await bodyJson(input, options);
          if (!isRecord(state) || !Array.isArray(state.features))
            return json({ error: "Некорректное состояние автосохранения" }, 400);
          const savedAt = new Date().toISOString();
          const envelope = { state, saved_at: savedAt };
          try {
            // Контрольная копия создаётся только перед заменой проекта. Обычный
            // автосейв хранит одну версию. IndexedDB не ограничивает рабочий
            // проект крошечной синхронной квотой localStorage.
            if (requestHeader(input, options, "X-Grado-Checkpoint") === "1")
              await storedProjectSet(AUTOSAVE_BACKUP_KEY, envelope);
            await storedProjectSet(AUTOSAVE_KEY, envelope);
            if (typeof localStorage.removeItem === "function")
              localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
          } catch (error) {
            return json({ error: "Недостаточно места для автосохранения" }, 507);
          }
          return json({ ok: true, saved_at: savedAt });
        });
      }
      try {
        const current = await storedProjectGet(AUTOSAVE_KEY);
        if (current) return json(current);
        // Однократная миграция проектов, созданных до единого хранилища.
        const legacy = readStoredJson(LEGACY_AUTOSAVE_KEY);
        if (legacy) {
          const envelope = { state: legacy, saved_at: null };
          try {
            await storedProjectSet(AUTOSAVE_KEY, envelope);
            localStorage.removeItem?.(LEGACY_AUTOSAVE_KEY);
          } catch (error) { /* старый снимок всё равно можно открыть */ }
          return json(envelope);
        }
        return json(null);
      } catch (error) { return json(null); }
    }
    if (path === "/api/style-overrides") {
      if (method === "POST") {
        const text = await bodyText(input, options);
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch (error) {
          return json({ error: "Некорректные стили" }, 400);
        }
        if (!isRecord(parsed)) return json({ error: "Некорректные стили" }, 400);
        try {
          localStorage.setItem(OVERRIDES_KEY, JSON.stringify(parsed));
        } catch (error) {
          return json({ error: "Не удалось сохранить стили" }, 507);
        }
        return json({ ok: true });
      }
      try { return json(JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}")); }
      catch (error) { return json({}); }
    }
    if (path === "/api/tep") {
      const payload = await bodyJson(input, options);
      const error = projectBodyError(payload);
      return error ? json({ error }, 400) : json(pagesCore.computeTep(payload));
    }
    if (path === "/api/preflight") {
      const payload = await bodyJson(input, options);
      const error = projectBodyError(payload);
      if (error) return json({ error }, 400);
      return json(pagesCore.preflightProject(payload));
    }
    if (path === "/api/fetch-extent") {
      if (method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
      const payload = await bodyJson(input, options);
      if (!isRecord(payload)) return json({ error: "Некорректный запрос области" }, 400);
      try { return json(await browserFetchExtent(payload, signal)); }
      catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw abortError();
        return json({ error: error.message || "Не удалось загрузить область" }, 400);
      }
    }
    if (path === "/api/import-nspd") {
      if (method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
      const text = await bodyText(input, options);
      if (text.length > MAX_BROWSER_IMPORT_CHARS)
        return json({ error: "Файл НСПД больше 64 МБ" }, 413);
      let body;
      try { body = text ? JSON.parse(text) : null; }
      catch (error) { return json({ error: "Файл НСПД содержит некорректный JSON" }, 400); }
      if (!isRecord(body) || !isRecord(body.payload))
        return json({ error: "Не передан корректный JSON-захват НСПД" }, 400);
      try { return json(pagesCore.importNspd(body.payload)); }
      catch (error) { return json({ error: error.message || "Не удалось разобрать захват НСПД" }, 400); }
    }
    if (path === "/api/import-gisogd") {
      if (method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
      let filename = requestHeader(input, options, "X-Grado-Filename") || "layer.geojson";
      try { filename = decodeURIComponent(filename); } catch (error) { /* оставляем безопасное исходное имя */ }
      if (/\.zip$/i.test(filename))
        return json({ error: "ZIP-выгрузки требуют настольную версию; в браузере выберите отдельный GeoJSON" }, 415);
      if (!/\.(geojson|json)$/i.test(filename))
        return json({ error: "В браузерной версии поддерживаются файлы .geojson и .json" }, 415);
      const text = await bodyText(input, options);
      if (text.length > MAX_BROWSER_IMPORT_CHARS)
        return json({ error: "GeoJSON больше 64 МБ" }, 413);
      let payload;
      try { payload = JSON.parse(text); }
      catch (error) { return json({ error: "Файл не является корректным GeoJSON" }, 400); }
      try { return json(pagesCore.importGeoJson(payload, filename)); }
      catch (error) { return json({ error: error.message || "Не удалось разобрать GeoJSON" }, 400); }
    }
    if (path === "/api/grado") {
      const payload = await bodyJson(input, options);
      const error = projectBodyError(payload);
      if (error) return json({ error }, 400);
      const report = pagesCore.preflightProject({ ...payload, target: "grado" });
      if (!report.can_export)
        return json({ error: "project preflight failed", report }, 400);
      const project = pagesCore.webProject(payload);
      return new Response(JSON.stringify(project, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (path === "/api/open-grado") {
      try {
        const project = JSON.parse(await bodyText(input, options));
        if (project.format !== "grado-web" || !Array.isArray(project.features)
            || !project.features.every(feature => feature && typeof feature === "object" && !Array.isArray(feature)))
          return json({ error: "Это не проект браузерной версии ГРАДО" }, 400);
        return json(project);
      } catch (error) {
        return json({ error: "Файл проекта повреждён или имеет другой формат" }, 400);
      }
    }
    return json({ error: "Эта функция требует настольную версию ГРАДО Студии" }, 501);
  };

  const blocked = new Set(["btn-album", "btn-dxf", "btn-print",
    "btn-buffer-open"]);
  document.addEventListener("click", event => {
    const target = event.target.closest("[data-click],button");
    const id = target && (target.dataset.click || target.id);
    if (!blocked.has(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (id === "btn-album") {
      document.getElementById("btn-album-config")?.click();
      return;
    }
    if (window.toast) window.toast("Функция требует настольную версию с сервером", "warn");
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("pages-mode");
    const logo = document.getElementById("logo");
    if (logo) {
      logo.insertAdjacentHTML("beforeend", '<b class="web-badge">Веб</b>');
      // Номер ЗАГРУЖЕННОГО кода (из __GRADO_ASSET_VERSION__ — печётся в index.html
      // в связке с app.js?v=, поэтому НЕ врёт как version.json, который грузится
      // отдельно и может обновиться, пока код в кэше старый). Если после
      // обновления число не сменилось — страница из кэша браузера.
      var bv = window.__GRADO_ASSET_VERSION__;
      if (bv) logo.insertAdjacentHTML("beforeend",
        '<b class="build-badge" title="Номер загруженного кода. Если после обновления он не сменился — страница открыта из кэша браузера (жёсткая перезагрузка или новый адрес со ?смена-номера).">b' + bv + '</b>');
    }
    const album = document.getElementById("btn-album");
    if (album) { album.textContent = "Альбом"; album.title = "Настроить состав альбома"; }
    const buffer = document.getElementById("btn-buffer-open");
    if (buffer) {
      buffer.dataset.webUnavailable = "true";
      buffer.disabled = true;
      buffer.title = "Буферизация доступна в настольной версии";
      buffer.setAttribute("aria-label", "Буферизация — доступна в настольной версии");
    }
    document.querySelectorAll("[data-click]").forEach(row => {
      if (blocked.has(row.dataset.click)) {
        row.classList.add("web-disabled");
        row.setAttribute("aria-disabled", "true");
        if (row.matches(".menu-row")) row.hidden = true;
      }
    });
    const addMenuNote = (menuId, text) => {
      const menu = document.getElementById(menuId);
      if (!menu || menu.querySelector(".web-menu-note")) return;
      const note = document.createElement("div");
      note.className = "web-menu-note";
      note.setAttribute("role", "note");
      note.textContent = text;
      menu.appendChild(note);
    };
    const gisogdInput = document.getElementById("gisogd-file");
    if (gisogdInput) gisogdInput.accept = ".geojson,.json,application/geo+json,application/json";
    const gisogdRow = document.querySelector('[data-click="btn-gisogd"]');
    if (gisogdRow) gisogdRow.textContent = "ГИС ОГД — GeoJSON";
    // ФГИС ТП — только через сервер (портал Минэка не отдаёт CORS): в
    // браузерной редакции пункт скрываем честно, а не оставляем сломанным
    const fgistpRow = document.querySelector('[data-click="btn-fgistp"]');
    if (fgistpRow) fgistpRow.remove();
    addMenuNote("menu-data", "В веб-версии доступны OSM и НСПД по видимой области, а также файлы НСПД и GeoJSON. ZIP и прямые ссылки требуют настольную версию.");
    addMenuNote("menu-out", "DXF и печать в масштабе доступны в настольной версии.");
    const style = document.createElement("style");
    style.textContent = `.web-badge{margin-left:7px;padding:2px 6px;border-radius:6px;background:var(--accent-weak);color:var(--accent);font-size:9px;letter-spacing:.04em}.build-badge{margin-left:5px;padding:2px 6px;border-radius:6px;background:var(--field-bg);color:var(--text-2);font-size:9px;letter-spacing:.03em;font-weight:600;opacity:.7;cursor:help}.web-disabled{opacity:.46;cursor:default}.web-disabled:hover,.web-disabled:focus{background:transparent;color:var(--text)}.web-menu-note{max-width:250px;margin:6px 4px 2px;padding:8px 9px;border-radius:8px;background:var(--field-bg);color:var(--text-2);font-size:11px;line-height:1.35}.pages-mode #st-bridge{display:none!important}`;
    document.head.appendChild(style);
  });
})();
