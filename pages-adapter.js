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
  const databaseDelete = key => databaseRequest("readwrite", store => store.delete(key));
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
  const storedProjectDelete = async key => {
    if (typeof indexedDB !== "undefined") {
      try { await databaseDelete(key); } catch (error) { /* нет базы — чистим ниже */ }
    }
    try { localStorage.removeItem?.(key); } catch (error) { /* приватный режим */ }
  };
  // Контрольных копий держим НЕСКОЛЬКО. Один слот означал, что откатиться
  // можно ровно на один шаг: следующая же контрольная точка затирала
  // единственный путь назад, и на больших проектах это единственный путь
  // назад вообще (глубина отмены урезается по памяти).
  const BACKUP_SLOTS = 5;
  const BACKUP_INDEX_KEY = "grado_pages_backup_index_v1";
  const backupSlotKey = id => `grado_pages_backup_${id}`;
  const readBackupIndex = async () => {
    try {
      const index = await storedProjectGet(BACKUP_INDEX_KEY);
      return Array.isArray(index) ? index.filter(isRecord) : [];
    } catch (error) { return []; }
  };
  // Копия не должна ронять сам автосейв: не поместилась — освобождаем место
  // самой старой и пробуем ещё раз, не вышло — сохраняем проект без копии.
  const pushBackup = async envelope => {
    const meta = backupMeta(envelope);
    if (!meta) return;
    let index = await readBackupIndex();
    const id = index.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    const write = async () => { await storedProjectSet(backupSlotKey(id), envelope); };
    try {
      await write();
    } catch (error) {
      const oldest = index[index.length - 1];
      if (!oldest) return;
      await storedProjectDelete(backupSlotKey(oldest.id));
      index = index.slice(0, -1);
      try { await write(); } catch (retryError) { return; }
    }
    index = [{ ...meta, id }, ...index];
    const dropped = index.slice(BACKUP_SLOTS);
    index = index.slice(0, BACKUP_SLOTS);
    try { await storedProjectSet(BACKUP_INDEX_KEY, index); }
    catch (error) { await storedProjectDelete(backupSlotKey(id)); return; }
    for (const item of dropped) await storedProjectDelete(backupSlotKey(item.id));
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

  // Внешний хост из RU-сети может не просто отказать, а ПОВИСНУТЬ: без
  // таймаута диалог «Данные» ждал бы вечно. Каждый внешний запрос идёт через
  // эту обёртку: таймаут, имя источника в ошибке и человеческое «недоступен
  // из вашей сети» вместо технического «Failed to fetch».
  const EXTERNAL_TIMEOUT_MS = 45000;
  async function externalFetch(sourceName, url, options = {}, timeoutMs = EXTERNAL_TIMEOUT_MS) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = options.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([options.signal, timeout.signal])
      : (options.signal || timeout.signal);
    try {
      const response = await nativeFetch(url, { ...options, signal });
      if (!response.ok)
        throw new Error(`${sourceName}: сервер ответил HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (timeout.signal.aborted && !(options.signal && options.signal.aborted))
        throw new Error(`${sourceName} не ответил за ${Math.round(timeoutMs / 1000)} с — попробуйте позже`);
      if (options.signal && options.signal.aborted) throw error;   // отмена пользователя
      if (error instanceof TypeError)
        throw new Error(`${sourceName} недоступен из вашей сети (блокировка или нет соединения)`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

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
        const mirror = url.includes("mail.ru") ? "Overpass (maps.mail.ru)" : "Overpass (kumi.systems)";
        const response = await externalFetch(mirror, url, { method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(), signal });
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
  const GISOGD_KEY_PREFIX = "gisogd_layer_";
  const GISOGD_META_PREFIX = "gisogd_meta_";
  const gisogdCacheKey = code => `${GISOGD_KEY_PREFIX}${code}`;
  const gisogdMetaKey = code => `${GISOGD_META_PREFIX}${code}`;
  // Слой качается целиком и это ДОЛГО (у красных линий УДС — сотня мегабайт).
  // Молчащий индикатор на такой загрузке неотличим от зависшего приложения,
  // поэтому читаем поток и сообщаем байты наверх. Портал отдаёт Content-Length
  // не всегда — тогда показываем сколько скачано, без процентов.
  const gisogdProgress = (code, name, loaded, total) => {
    if (typeof window === "undefined" || typeof CustomEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("grado-source-progress", {
      detail: { source: "gisogd", code, name, loaded, total: total || null },
    }));
  };
  const readWithProgress = async (response, code, name, signal) => {
    const total = Number(response.headers.get("Content-Length")) || 0;
    if (!response.body || typeof response.body.getReader !== "function")
      return { text: await response.text(), bytes: total };
    const reader = response.body.getReader();
    // Расшифровываем по мере чтения. Копить куски и склеивать их в конце — это
    // три копии слоя в памяти разом (куски, Blob, буфер), а слой бывает на сто
    // мегабайт: на слабой машине вкладка этого не переживёт.
    const decoder = new TextDecoder();
    let text = "", loaded = 0, ping = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal && signal.aborted) { reader.cancel().catch(() => {}); throwIfAborted(signal); }
      text += decoder.decode(value, { stream: true });
      loaded += value.length;
      // не чаще чем раз в четверть мегабайта: событие на каждый кусок — это
      // тысячи перерисовок индикатора на одном слое
      if (loaded - ping >= 262144) { ping = loaded; gisogdProgress(code, name, loaded, total); }
    }
    text += decoder.decode();   // хвост многобайтового символа на границе кусков
    gisogdProgress(code, name, loaded, total || loaded);
    return { text, bytes: loaded };
  };
  async function gisogdLayerJson(code, notes, signal, name) {
    throwIfAborted(signal);
    try {
      const hit = await databaseGet(gisogdCacheKey(code));
      throwIfAborted(signal);
      if (hit && hit.at && (Date.now() - hit.at) < GISOGD_TTL_MS) return hit.data;
    } catch (error) { /* кэш недоступен — тянем из сети */ }
    throwIfAborted(signal);
    const response = await externalFetch(`ГИС ОГД (слой ${code})`, pagesCore.gisogdLayerUrl(code), { signal }, 120000);
    const { text, bytes } = await readWithProgress(response, code, name || code, signal);
    throwIfAborted(signal);
    const data = JSON.parse(text);
    throwIfAborted(signal);
    notes.push(`слой ${code} загружен целиком (${(data.features || []).length} об., `
      + `${formatBytes(bytes)}) — портал не фильтрует по области; дальше берётся из кэша браузера`);
    // Рядом со слоем кладём КРОШЕЧНУЮ запись о нём. Без неё список кэша
    // разворачивал каждый слой целиком, чтобы посчитать объекты: пять слоёв —
    // 162 МБ чтения и секунда с лишним на каждое открытие окна выгрузки.
    const at = Date.now();
    try {
      await databaseSet(gisogdCacheKey(code), { at, bytes, name: name || null, data });
      await databaseSet(gisogdMetaKey(code),
        { at, bytes, name: name || null, features: (data.features || []).length });
    }
    catch (error) { notes.push(`слой ${code} не поместился в кэш — будет качаться заново`); }
    throwIfAborted(signal);
    return data;
  }
  const formatBytes = bytes => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 МБ";
    if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
    return `${(bytes / 1048576).toFixed(1)} МБ`;
  };
  // Что лежит в кэше и сколько занимает — без этого единственный способ
  // освободить место или обновить устаревший слой был «почистить браузер».
  const gisogdCacheList = async () => {
    const keys = await databaseRequest("readonly", store => store.getAllKeys());
    const out = [];
    for (const key of keys || []) {
      if (typeof key !== "string" || !key.startsWith(GISOGD_KEY_PREFIX)) continue;
      const code = key.slice(GISOGD_KEY_PREFIX.length);
      // читаем ТОЛЬКО запись о слое: сам слой — это до сотни мегабайт
      const meta = await databaseGet(gisogdMetaKey(code)).catch(() => null);
      const at = meta && meta.at || 0;
      out.push({ code, name: meta && meta.name || null, at: at || null,
        bytes: meta ? Number(meta.bytes) || null : null,
        features: meta ? Number(meta.features) || null : null,
        // Слой, скачанный прежней сборкой, записи о себе не оставил. Он ЖИВОЙ —
        // срок годности проверяется по самому слою; неизвестен только его вес.
        // Назвать его устаревшим значило бы соврать: перекачки не будет.
        unknown: !meta,
        stale: !!at && (Date.now() - at) >= GISOGD_TTL_MS });
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  };
  // Каталог — 663 слоя портала; в памяти он жил до первой перезагрузки страницы,
  // и окно выгрузки каждый раз ждало сеть. Держим его рядом со слоями, в IndexedDB.
  const GISOGD_CATALOG_KEY = "gisogd_catalog";
  const GISOGD_CATALOG_TTL_MS = 7 * 24 * 3600 * 1000;
  let gisogdCatalogCache = null;
  async function gisogdCatalog(signal) {
    throwIfAborted(signal);
    if (gisogdCatalogCache) return gisogdCatalogCache;
    try {
      const hit = await databaseGet(GISOGD_CATALOG_KEY);
      throwIfAborted(signal);
      if (hit && hit.at && Array.isArray(hit.data) && hit.data.length
          && (Date.now() - hit.at) < GISOGD_CATALOG_TTL_MS)
        return (gisogdCatalogCache = hit.data);
    } catch (error) { /* кэш недоступен — тянем из сети */ }
    throwIfAborted(signal);
    const response = await externalFetch("ГИС ОГД (каталог)", pagesCore.gisogdCatalogUrl(), { signal });
    const catalog = pagesCore.buildGisogdCatalog(await response.json());
    throwIfAborted(signal);
    gisogdCatalogCache = catalog;
    try { await databaseSet(GISOGD_CATALOG_KEY, { at: Date.now(), data: catalog }); }
    catch (error) { /* не влез — просто останемся с кэшем в памяти */ }
    return catalog;
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

  // Библиотека знаков (styles.json) — источник таблицы «код ЛГР → знак».
  // Раньше она наполнялась только когда фронт сам запрашивал /api/styles, и
  // выгрузка каталога из КЭША успевала раньше: красные линии приезжали без
  // style_id и рисовались чёрными. Теперь любой импорт ГИС ОГД сначала ждёт
  // библиотеку; промис один на страницу, при ошибке сбрасывается для повтора.
  let lgrStylesPromise = null;
  function ensureLgrStyles() {
    // встроенная библиотека — мгновенно и без сети; сетевой styles.json нужен
    // только как источник обновлений поверх (и для десктопного сервера)
    if (window.GRADO_STYLES_LIB && !lgrStylesPromise) {
      pagesCore.setLgrCodeStyles(window.GRADO_STYLES_LIB);
      lgrStylesPromise = Promise.resolve(window.GRADO_STYLES_LIB);
      return lgrStylesPromise;
    }
    if (!lgrStylesPromise) lgrStylesPromise = (async () => {
      const stylesUrl = new URL("./styles.json", window.location.href);
      const release = window.__GRADO_ASSET_VERSION__;
      if (release) stylesUrl.searchParams.set("v", release);
      const response = await nativeFetch(stylesUrl);
      if (!response.ok) throw new Error(`styles.json: HTTP ${response.status}`);
      const styles = await response.json();
      pagesCore.setLgrCodeStyles(styles);
      return styles;
    })().catch(error => { lgrStylesPromise = null; throw error; });
    return lgrStylesPromise;
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
          const response = await externalFetch("НСПД", NSPD_EXTENT_URL, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pagesCore.buildNspdExtentRequest(bbox, source)), signal });
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
      // без библиотеки знаков LineCode не превратится в style_id — линии
      // будут чёрными; при недоступной библиотеке остаётся маршрут по имени
      try { await ensureLgrStyles(); } catch (error) {
        result.notes.push("Библиотека знаков не загрузилась — объекты без знаков");
      }
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
            const raw = await gisogdLayerJson(layer.code, result.notes, signal, layer.name);
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
    // ---- автопривязка выгрузки ГИС ОГД к ЕГРН ----
    // Оцифровка портала по районам гуляет на 1–3 м ЛОКАЛЬНО (в центре — на
    // сантиметры, датум ни при чём — сверено по городу). Якорь — границы
    // участков ЕГРН этой же области: из этой же выгрузки или тихим запросом.
    const ogdGroups = (result.groups || []).filter(g => String(g.source || "").startsWith("gisogd"));
    if (ogdGroups.length && payload.alignOgd !== false) {
      try {
        let parcels = (result.groups || [])
          .filter(g => String(g.layer_id || "") === "source.nspd.parcels")
          .flatMap(g => g.features || []);
        if (!parcels.length && bboxKm2(bbox) <= 12) {
          const response = await externalFetch("НСПД", NSPD_EXTENT_URL, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pagesCore.buildNspdExtentRequest(bbox, "nspd.parcels")), signal });
          const part = pagesCore.importNspdExtent(await response.json(), "nspd.parcels", bbox);
          parcels = (part.groups || []).flatMap(g => g.features || []);
        }
        if (parcels.length) {
          const ogdFeatures = ogdGroups.flatMap(g => g.features || []);
          const fit = pagesCore.computeEgrnAlign(ogdFeatures, parcels, { minPairs: 15 });
          if (fit.ok) {
            for (const group of ogdGroups) pagesCore.shiftFeaturesInPlace(group.features || [], fit.dx, fit.dy);
            result.notes.push(`ГИС ОГД посажен на ЕГРН: сдвиг ${Math.hypot(fit.dx, fit.dy).toFixed(2)} м ` +
              `(${fit.pairs} опорных границ, расхождение ${fit.medBefore.toFixed(2)} → ${fit.medAfter.toFixed(2)} м)`);
          } else if (fit.reason === "сдвиг не подтверждён остатками" && fit.medBefore > 1.2) {
            // заметное расхождение есть, но оно разнонаправленное — честно
            // говорим; при согласованных данных (центр города) молчим
            result.notes.push(`ГИС ОГД: расхождение с ЕГРН не подтвердилось как систематическое — координаты не тронуты`);
          }
        }
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw abortError();
        // автопривязка — улучшение, а не условие выгрузки
      }
    }
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

    // Буфер считается прямо в браузере (app-buffer.js): модуль загружается
    // после адаптера, но К МОМЕНТУ КЛИКА он уже есть — проверяем при вызове.
    if (path === "/api/buffer") {
      const engine = window.GRADO_BUFFER;
      if (!engine) return json({ error: "Модуль буфера ещё не загружен — обновите страницу" }, 503);
      try {
        const payload = await bodyJson(input, options);
        const result = engine.bufferFeatures(payload || {});
        if (!result.features.length && result.notes.length)
          return json({ error: result.notes[0] }, 400);
        return json(result);
      } catch (error) {
        return json({ error: error.message || "Не удалось построить буфер" }, 400);
      }
    }
    if (path === "/api/hub") return json({ hub: false });
    if (path === "/api/inbox") return json({ bridge: true, items: [] });
    if (path === "/api/sources") return json([]);
    if (path === "/api/styles") {
      // тот же одноразовый загрузчик, что и у импорта: таблица «код ЛГР → знак»
      // наполняется здесь же (источник правды — moscow_lgr.json)
      const styles = await ensureLgrStyles();
      return json(styles);
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
    // Кэш слоёв портала: посмотреть, что занимает место, и убрать лишнее.
    // Раньше единственным способом освободить его было «почистить браузер» —
    // вместе с проектом и контрольными копиями.
    if (path === "/api/gisogd-cache") {
      if (method === "DELETE") {
        try {
          const keys = await databaseRequest("readonly", store => store.getAllKeys());
          let removed = 0;
          for (const key of keys || []) {
            if (typeof key !== "string") continue;
            // запись о слое уходит вместе со слоем, иначе список покажет то, чего нет
            if (key.startsWith(GISOGD_KEY_PREFIX)) { await databaseDelete(key); removed += 1; }
            else if (key.startsWith(GISOGD_META_PREFIX)) await databaseDelete(key);
          }
          return json({ removed });
        } catch (error) { return json({ error: `кэш недоступен: ${error.message || error}` }, 500); }
      }
      try { return json({ layers: await gisogdCacheList(), ttl_days: GISOGD_TTL_MS / 86400000 }); }
      catch (error) { return json({ layers: [], error: String(error.message || error) }); }
    }
    if (path.startsWith("/api/gisogd-cache/") && method === "DELETE") {
      const code = decodeURIComponent(path.slice("/api/gisogd-cache/".length));
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(code)) return json({ error: "некорректный код слоя" }, 400);
      try {
        await databaseDelete(gisogdCacheKey(code));
        await databaseDelete(gisogdMetaKey(code));
        return json({ removed: 1, code });
      }
      catch (error) { return json({ error: `кэш недоступен: ${error.message || error}` }, 500); }
    }
    if (path === "/api/initial-grado") return json(null);
    if (path === "/api/autosave/backups") {
      try {
        const index = await readBackupIndex();
        // копия прежнего единственного слота — самая старая в списке
        const legacy = backupMeta(await storedProjectGet(AUTOSAVE_BACKUP_KEY));
        const backups = legacy ? [...index, { ...legacy, id: "legacy" }] : index;
        return json({ backups });
      } catch (error) {
        return json({ backups: [] });
      }
    }
    if (path.startsWith("/api/autosave/backups/")) {
      const id = decodeURIComponent(path.slice("/api/autosave/backups/".length));
      try {
        // сначала слот, потом прежний единственный: id=1 существует в обеих
        // схемах, и слот новее
        const slot = id === "legacy" ? null : await storedProjectGet(backupSlotKey(id));
        const backup = backupMeta(slot) ? slot
          : (id === "legacy" || id === "1" ? await storedProjectGet(AUTOSAVE_BACKUP_KEY) : null);
        return backupMeta(backup) ? json(backup) : json({ error: "Копия не найдена" }, 404);
      } catch (error) {
        return json({ error: "Копия повреждена" }, 500);
      }
    }
    if (path === "/api/autosave") {
      if (method === "POST") {
        return queueAutosaveWrite(async () => {
          const state = await bodyJson(input, options);
          if (!isRecord(state) || !Array.isArray(state.features))
            return json({ error: "Некорректное состояние автосохранения" }, 400);
          // Оптимистичная блокировка: клиент присылает версию, поверх которой
          // пишет. Разошлась с хранилищем — значит, другая вкладка сохранила
          // раньше, и слепая перезапись стёрла бы её работу. Без базы (первая
          // запись вкладки, старый клиент) проверку не делаем.
          const base = requestHeader(input, options, "X-Grado-Base");
          if (base) {
            const current = await storedProjectGet(AUTOSAVE_KEY).catch(() => null);
            if (current && current.saved_at && current.saved_at !== base)
              return json({ error: "Проект изменён в другой вкладке",
                saved_at: current.saved_at }, 409);
          }
          const savedAt = new Date().toISOString();
          const envelope = { state, saved_at: savedAt };
          // Контрольная копия создаётся только перед заменой проекта. Обычный
          // автосейв хранит одну версию. IndexedDB не ограничивает рабочий
          // проект крошечной синхронной квотой localStorage.
          // Копия идёт в свой слот и НЕ мешает сохранению проекта: её отказ
          // (нет места) не должен превращаться в отказ автосейва.
          if (requestHeader(input, options, "X-Grado-Checkpoint") === "1")
            await pushBackup(envelope).catch(() => {});
          try {
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
      try { await ensureLgrStyles(); } catch (error) { /* фолбэк по имени слоя */ }
      let sourceTitle = requestHeader(input, options, "X-Grado-Source-Title") || null;
      if (sourceTitle) { try { sourceTitle = decodeURIComponent(sourceTitle); } catch (error) { sourceTitle = null; } }
      try { return json(pagesCore.importGeoJson(payload, filename, sourceTitle)); }
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

  // DXF и лист PDF собираются прямо в браузере (app-dxf.js, app-pdf.js),
  // поэтому в списке недоступного их больше нет.
  // Буфер тоже считается здесь (app-buffer.js + маршрут /api/buffer выше).
  const blocked = new Set(["btn-album", "btn-print"]);
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
    // Печать в масштабе в браузере ЕСТЬ — это лист PDF (app-sheet.js). Тупика
    // с «требует настольную версию» здесь быть не должно.
    if (id === "btn-print" && typeof window.openSheetDialog === "function") {
      window.openSheetDialog();
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
      // В шапке — версия приложения; номер сборки уходит в подсказку. Раньше
      // рядом с названием стояло «b10000» — это диагностика разработчика, а не
      // то, что человек ищет глазами в рабочем окне.
      var bv = window.__GRADO_ASSET_VERSION__;
      if (bv) {
        logo.insertAdjacentHTML("beforeend",
          '<b class="build-badge" title="Версия приложения. Номер загруженного кода: b' + bv
          + '. Если после обновления он не сменился — страница открыта из кэша браузера '
          + '(жёсткая перезагрузка или новый адрес со ?смена-номера).">…</b>');
        var badge = logo.querySelector(".build-badge");
        nativeFetch(new URL("./version.json", window.location.href).href, { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (info) { badge.textContent = info && info.version ? "v" + info.version : "b" + bv; })
          .catch(function () { badge.textContent = "b" + bv; });
      }
    }
    // «Альбом» главной кнопкой обещал документ, а печать в масштабе — настольная:
    // в браузере эта кнопка правит только СОСТАВ листов. Называем ровно то, что
    // она делает, и снимаем с неё вид главного действия.
    const album = document.getElementById("btn-album");
    if (album) {
      album.textContent = "Состав альбома";
      album.title = "Состав листов альбома. Печать в масштабе (PDF) — в настольной версии";
      album.setAttribute("aria-label", "Состав листов альбома; печать PDF доступна в настольной версии");
      album.classList.remove("primary");
    }
    // Буфер работает: считается в браузере через маршрут /api/buffer.
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
    addMenuNote("menu-out", "Лист PDF, альбом и DXF собираются прямо здесь. Сборка альбома АГК по шаблонам — в настольной версии.");
    const style = document.createElement("style");
    style.textContent = `.web-badge{margin-left:7px;padding:2px 6px;border-radius:6px;background:var(--accent-weak);color:var(--accent);font-size:9px;letter-spacing:.04em}.build-badge{margin-left:5px;padding:2px 6px;border-radius:6px;background:var(--field-bg);color:var(--text-2);font-size:9px;letter-spacing:.03em;font-weight:600;opacity:.7;cursor:help}.web-disabled{opacity:.46;cursor:default}.web-disabled:hover,.web-disabled:focus{background:transparent;color:var(--text)}.web-menu-note{max-width:250px;margin:6px 4px 2px;padding:8px 9px;border-radius:8px;background:var(--field-bg);color:var(--text-2);font-size:11px;line-height:1.35}.pages-mode #st-bridge{display:none!important}`;
    document.head.appendChild(style);
  });
})();
