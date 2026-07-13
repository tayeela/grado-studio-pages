/* GitHub Pages edition: local browser storage + lightweight client API.
   Loaded only by packaging/build_pages.py, before the regular Studio scripts. */
(function () {
  "use strict";

  window.GRADO_STATIC = true;
  const nativeFetch = window.fetch.bind(window);
  const AUTOSAVE_KEY = "grado_pages_autosave_v1";
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
    return text ? JSON.parse(text) : {};
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
    if (path === "/api/styles") return json({});
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
    if (path === "/api/autosave/backups") return json({ backups: [] });
    if (path.startsWith("/api/autosave/backups/")) return json(null, 404);
    if (path === "/api/autosave") {
      if (method === "POST") {
        const state = await bodyJson(input, options);
        const savedAt = new Date().toISOString();
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ state, saved_at: savedAt }));
        return json({ ok: true, saved_at: savedAt });
      }
      try { return json(JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null")); }
      catch (error) { return json(null); }
    }
    if (path === "/api/style-overrides") {
      if (method === "POST") {
        localStorage.setItem(OVERRIDES_KEY, await bodyText(input, options));
        return json({ ok: true });
      }
      try { return json(JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}")); }
      catch (error) { return json({}); }
    }
    if (path === "/api/tep") return json(browserTep(await bodyJson(input, options)));
    if (path === "/api/preflight") {
      const payload = await bodyJson(input, options);
      return json(pagesCore.preflightProject(payload));
    }
    if (path === "/api/grado") {
      const project = webProject(await bodyJson(input, options));
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
