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
  const round = (value, digits = 2) => Number((Number(value) || 0).toFixed(digits));
  const ringArea = ring => {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += (Number(a[0]) || 0) * (Number(b[1]) || 0) -
              (Number(b[0]) || 0) * (Number(a[1]) || 0);
    }
    return Math.abs(area) / 2;
  };
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
    const features = Array.isArray(payload.features) ? payload.features : [];
    const params = payload.params || {};
    const boundaries = features.filter(f => f.kind === "boundary" && f.ring);
    const hasTerritory = boundaries.length > 0;
    const terrHa = boundaries.reduce((sum, f) => sum + ringArea(f.ring), 0) / 10000;
    const restrictHa = features.filter(f => f.kind === "restrict" && f.ring)
      .reduce((sum, f) => sum + ringArea(f.ring), 0) / 10000;
    const calcHa = Math.max(0, terrHa - restrictHa);
    const factSpp = features.filter(f => f.kind === "building" && f.ring)
      .reduce((sum, f) => sum + ringArea(f.ring) * Math.max(1, Number(f.props && f.props.floors) || 9) / 1000, 0);
    const factDensity = calcHa > 0 ? factSpp / calcHa : 0;
    const targetDensity = Number(params.density) || 25;
    const targetSpp = calcHa * targetDensity;
    const housing = targetSpp * (Number(params.ratio_zh) || 80) / 100;
    const residentialSpp = housing * 0.94;
    const apartmentArea = residentialSpp * 0.65;
    const population = apartmentArea * 1000 / 33;
    const educationZone = Number(params.education_zone) === 2 ? 2 : 1;
    const territoryMode = Number(params.territory_mode) === 2 ? 2 : 1;
    const dooPerThousand = educationZone === 2 ? 63 : 44;
    const schoolPerThousand = educationZone === 2 ? 124 : 90;
    const zonesHa = features.filter(f => f.kind === "zone" && f.ring)
      .reduce((sum, f) => sum + ringArea(f.ring), 0) / 10000;
    const results = [
      { id: "terr_area", group: "Площади", title: "Территория", value: round(terrHa), unit: "га" },
      { id: "restrict_area", group: "Площади", title: "Ограничения", value: round(restrictHa), unit: "га" },
      { id: "calc_area", group: "Площади", title: "Расчётная территория", value: round(calcHa), unit: "га" },
      { id: "target_spp", group: "Застройка", title: "СПП по нормативной плотности", value: round(targetSpp, 1), unit: "тыс. м²" },
      { id: "population", group: "Население", title: "Расчётное население", value: Math.round(population), unit: "чел." },
      { id: "doo_places", group: "Социальная инфраструктура", title: "Места в ДОО (2151-ПП)", value: Math.round(population * dooPerThousand / 1000), unit: "мест" },
      { id: "school_places", group: "Социальная инфраструктура", title: "Места в школах (2151-ПП)", value: Math.round(population * schoolPerThousand / 1000), unit: "мест" },
      { id: "retail_nnp_required", group: "Обслуживание", title: "Торговля к размещению (2152-ПП)", value: Math.round(population * 270 / 1000), unit: "м² ННП" },
      { id: "services_nnp_required", group: "Обслуживание", title: "Бытовое обслуживание (2152-ПП)", value: Math.round(population * 100 / 1000), unit: "м² ННП" },
      { id: "green_area_required", group: "Жилые территории", title: "Озеленённая территория по режиму 2152-ПП", value: Math.round(territoryMode === 2 ? calcHa * 10000 * 0.25 : population * 5), unit: "м²" },
      { id: "playground_area_required", group: "Жилые территории", title: "Детские площадки при реконструкции", value: Math.round(territoryMode === 2 ? population * 0.5 : 0), unit: "м²" },
      { id: "adult_recreation_area_required", group: "Жилые территории", title: "Площадки отдыха взрослых при реконструкции", value: Math.round(territoryMode === 2 ? population * 0.1 : 0), unit: "м²" },
    ];
    const checks = [{
      title: "Нормативный профиль Москвы", ok: true,
      msg: `2151-ПП: образовательная зона ${educationZone}; 2152-ПП: ${territoryMode === 2 ? "реконструкция" : "преобразование"}`,
    }];
    if (factDensity > 0) checks.push({ title: "Плотность по ПЗЗ/ГПЗУ", ok: false, msg: `Факт ${round(factDensity)} тыс. м²/га — требуется сверка с параметрами участка` });
    if (population > 0) checks.push({ title: "Транспорт · 945-ПП", ok: false, msg: "Расчёт парковок требует ВРИ, территориальной зоны и типов объектов" });
    return {
      inputs: { terr_area: round(terrHa, 4), restrict_area: round(restrictHa, 4) },
      results,
      fact: { spp: round(factSpp, 1), density: round(factDensity) },
      zones: { ok: true, total_ha: round(zonesHa), shared_edges: 0 },
      checks,
      regulatory_profile: { id: "moscow_urban_planning_2026_07", checked_at: "2026-07-13" },
      has_territory: hasTerritory,
    };
  }

  function webProject(payload) {
    return {
      format: "grado-web",
      version: 1,
      name: payload.name || "Проект",
      features: payload.features || [],
      userLayers: payload.layers || [],
      projectStyles: payload.projectStyles || {},
      projectCustomKinds: payload.projectCustomKinds || [],
      undo_stack: payload.undo_stack || [],
      redo_stack: payload.redo_stack || [],
      studioState: payload.studioState || {},
    };
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
      const features = Array.isArray(payload.features) ? payload.features : [];
      return json({ errors: [], warnings: [], summary: {
        total: features.length, exportable: features.length, annotations: 0,
      }});
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
        if (project.format !== "grado-web" || !Array.isArray(project.features))
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
        row.title = "Требуется настольная версия";
      }
    });
    const style = document.createElement("style");
    style.textContent = `.web-badge{margin-left:7px;padding:2px 6px;border-radius:6px;background:var(--accent-weak);color:var(--accent);font-size:9px;letter-spacing:.04em}.web-disabled{opacity:.45}.pages-mode #st-bridge{display:none!important}`;
    document.head.appendChild(style);
  });
})();
