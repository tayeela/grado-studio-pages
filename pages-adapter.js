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

  function browserTep(payload) {
    return pagesCore.computeTep(payload);
  }

  function webProject(payload) {
    return pagesCore.webProject(payload);
  }

  window.gradoTileUrl = (z, x, y, source) => source === "osm"
    ? `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  window.fetch = async function (input, options = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, window.location.href);
    const path = url.pathname;
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

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
      return nativeFetch(stylesUrl, options);
    }
    if (path === "/api/basemap-info") return json({
      origin_lon: 37.6176, origin_lat: 55.7558,
      attribution: "© OpenStreetMap contributors",
      attributions: {
        osm: "© OpenStreetMap contributors",
        sat: "Tiles © Esri",
        s2: "Tiles © Esri",
      },
    });
    if (path === "/api/initial-grado") return json(null);
    if (path === "/api/autosave/backups") {
      try {
        const backup = readStoredJson(AUTOSAVE_BACKUP_KEY);
        const meta = backupMeta(backup);
        return json({ backups: meta ? [meta] : [] });
      } catch (error) {
        return json({ backups: [] });
      }
    }
    if (path === "/api/autosave/backups/1") {
      try {
        const backup = readStoredJson(AUTOSAVE_BACKUP_KEY);
        return backupMeta(backup) ? json(backup) : json({ error: "Копия не найдена" }, 404);
      } catch (error) {
        return json({ error: "Копия повреждена" }, 500);
      }
    }
    if (path.startsWith("/api/autosave/backups/")) return json(null, 404);
    if (path === "/api/autosave") {
      if (method === "POST") {
        const state = await bodyJson(input, options);
        if (!isRecord(state) || !Array.isArray(state.features))
          return json({ error: "Некорректное состояние автосохранения" }, 400);
        const savedAt = new Date().toISOString();
        const envelope = { state, saved_at: savedAt };
        try {
          // Контрольная копия создаётся только перед заменой проекта. Обычный
          // автосейв хранит одну версию и не расходует квоту браузера вдвое.
          if (requestHeader(input, options, "X-Grado-Checkpoint") === "1")
            localStorage.setItem(AUTOSAVE_BACKUP_KEY, JSON.stringify(envelope));
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(envelope));
          if (typeof localStorage.removeItem === "function")
            localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
        } catch (error) {
          return json({ error: "Недостаточно места для автосохранения" }, 507);
        }
        return json({ ok: true, saved_at: savedAt });
      }
      try {
        const current = readStoredJson(AUTOSAVE_KEY);
        if (current) return json(current);
        // Однократная миграция проектов, созданных до единого хранилища.
        const legacy = readStoredJson(LEGACY_AUTOSAVE_KEY);
        return legacy ? json({ state: legacy, saved_at: null }) : json(null);
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
      return error ? json({ error }, 400) : json(browserTep(payload));
    }
    if (path === "/api/preflight") {
      const payload = await bodyJson(input, options);
      const error = projectBodyError(payload);
      if (error) return json({ error }, 400);
      return json(pagesCore.preflightProject(payload));
    }
    if (path === "/api/grado") {
      const payload = await bodyJson(input, options);
      const error = projectBodyError(payload);
      if (error) return json({ error }, 400);
      const report = pagesCore.preflightProject({ ...payload, target: "grado" });
      if (!report.can_export)
        return json({ error: "project preflight failed", report }, 400);
      const project = webProject(payload);
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

  const blocked = new Set(["btn-album", "btn-dxf", "btn-print", "btn-data",
    "btn-nspd", "btn-gisogd", "btn-buffer-open"]);
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
    if (logo) logo.insertAdjacentHTML("beforeend", '<b class="web-badge">Веб</b>');
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
    addMenuNote("menu-data", "Импорт НСПД, ГИС ОГД и данных по области доступен в настольной версии.");
    addMenuNote("menu-out", "DXF и печать в масштабе доступны в настольной версии.");
    const style = document.createElement("style");
    style.textContent = `.web-badge{margin-left:7px;padding:2px 6px;border-radius:6px;background:var(--accent-weak);color:var(--accent);font-size:9px;letter-spacing:.04em}.web-disabled{opacity:.46;cursor:default}.web-disabled:hover,.web-disabled:focus{background:transparent;color:var(--text)}.web-menu-note{max-width:250px;margin:6px 4px 2px;padding:8px 9px;border-radius:8px;background:var(--field-bg);color:var(--text-2);font-size:11px;line-height:1.35}.pages-mode #st-bridge{display:none!important}`;
    document.head.appendChild(style);
  });
})();
