// Растровая подложка для листа: сшивка тайлов под рамку и вставка в PDF.
//
// Лист требует не меньше 300 dpi, а плотность снимка задаёт источник, а не мы:
// на широте Москвы ESRI отдаёт около 0,17 м на точку (зум 19), Яндекс — 0,084
// (зум 20) и 0,042 (зум 21), Sentinel — 10 м в любой год. Поэтому модуль
// считает фактическую плотность и говорит её вслух: молча выдавать
// увеличенный снимок за 300 dpi нельзя.
//
// Отдельная тонкость — проекция. OSM, ESRI и EOX работают в сферическом
// Меркаторе, Яндекс — в эллиптическом (EPSG:3395), и номер тайла по широте
// у них считается иначе. Перепутать их — значит сдвинуть снимок на десятки
// метров, чего на чертеже в 1:1000 не заметить нельзя.
(function (root) {
  "use strict";

  // ESRI Clarity в списке нет намеренно: он отвечает редиректом на другой
  // сервис (wayback), а это второй хост, второй набор правил безопасности и
  // номер релиза в пути. Высокую детализацию по Москве закрывает Яндекс.
  const SOURCES = {
    esri: {
      title: "ESRI World Imagery", kind: "sat", maxZoom: 19, projection: "spherical",
      url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
    yandex: {
      title: "Яндекс Спутник", kind: "sat", maxZoom: 21, projection: "elliptical", unofficial: true,
      url: (z, x, y) => `https://core-sat.maps.yandex.net/tiles?l=sat&v=3.1024.0&x=${x}&y=${y}&z=${z}&lang=ru_RU`,
      attribution: "Яндекс Спутник",
    },
    osm: {
      title: "Карта OSM", kind: "map", maxZoom: 19, projection: "spherical",
      url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      attribution: "© участники OpenStreetMap",
    },
    // Квартальные безоблачные мозаики Copernicus: свежие (мозаика выходит
    // в течение месяца после квартала), глобальные, 10 м на точку. Анонимного
    // доступа нет — коллекция лежит в Sentinel Hub, и ключ (client_id/secret)
    // человек заводит в своём личном кабинете. Ключ хранится в браузере.
    cdse: {
      title: "Copernicus, квартальная мозаика", kind: "overview", maxZoom: 15,
      projection: "spherical", needsKey: true,
      collection: "5460de54-082e-473a-b6ea-d5cbe3c17cca",
      url: (z, x, y, options = {}) => {
        const id = options.instance || "";
        return `https://sh.dataspace.copernicus.eu/ogc/wmts/${id}?service=WMTS&request=GetTile` +
          `&version=1.0.0&layer=${encodeURIComponent(options.layer || "QUARTERLY-MOSAIC")}` +
          `&style=default&format=image/jpeg&tilematrixset=PopularWebMercator256` +
          `&tilematrix=${z}&tilecol=${x}&tilerow=${y}` +
          (options.time ? `&time=${encodeURIComponent(options.time)}` : "");
      },
      attribution: "Copernicus Sentinel-2, квартальная мозаика (CDSE)",
    },
    eox: {
      title: "Sentinel-2 cloudless 2025", kind: "overview", maxZoom: 15, projection: "spherical",
      url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`,
      attribution: "Sentinel-2 cloudless 2025 by EOX (CC BY-NC-SA 4.0)",
      // 10 м на точку: честен только на обзорных листах
      groundLimit: 10,
    },
  };

  const TILE = 256;
  const EARTH = 6378137;
  const ECC = 0.0818191908426;                 // эксцентриситет WGS84 — для Яндекса

  // номер тайла по долготе одинаков во всех источниках
  const lonToTileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
  // сферический Меркатор (OSM, ESRI, EOX)
  const latToTileYSpherical = (lat, z) => {
    const rad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z;
  };
  // эллиптический Меркатор (Яндекс): та же формула с поправкой на сжатие Земли
  const latToTileYElliptical = (lat, z) => {
    const rad = lat * Math.PI / 180;
    const sin = Math.sin(rad);
    const adjusted = Math.tan(Math.PI / 4 + rad / 2) * Math.pow((1 - ECC * sin) / (1 + ECC * sin), ECC / 2);
    return (1 - Math.log(adjusted) / Math.PI) / 2 * 2 ** z;
  };
  const latToTileY = (lat, z, projection) => projection === "elliptical"
    ? latToTileYElliptical(lat, z) : latToTileYSpherical(lat, z);

  // метры на точку тайла на данной широте
  const groundResolution = (lat, z) =>
    Math.cos(lat * Math.PI / 180) * 2 * Math.PI * EARTH / (TILE * 2 ** z);

  // Плотность листа: сколько метров местности приходится на точку растра при
  // заданных масштабе и dpi. При 1:2000 и 300 dpi это 0,169 м.
  const metresPerDot = (scale, dpi) => scale * 25.4 / 1000 / dpi;

  // Подбор зума: берём первый, который даёт плотность не хуже требуемой, но не
  // выше предела источника. Возвращаем и фактическую плотность — её показывают
  // человеку.
  function pickZoom({ source, lat, scale, dpi = 300 }) {
    const spec = SOURCES[source] || SOURCES.esri;
    const needed = metresPerDot(scale, dpi);
    let zoom = spec.maxZoom;
    for (let z = 1; z <= spec.maxZoom; z++)
      if (groundResolution(lat, z) <= needed) { zoom = z; break; }
    const actual = groundResolution(lat, zoom);
    const actualDpi = scale * 25.4 / 1000 / actual;
    return { zoom, actual, actualDpi, needed, enough: actual <= needed + 1e-9,
      spec, upscaled: actual > needed };
  }

  // Прямоугольник тайлов, накрывающий градусный охват
  function tileRange({ source, bbox, zoom }) {
    const spec = SOURCES[source] || SOURCES.esri;
    const [west, south, east, north] = bbox;
    const x0 = Math.floor(lonToTileX(west, zoom));
    const x1 = Math.ceil(lonToTileX(east, zoom));
    const y0 = Math.floor(latToTileY(north, zoom, spec.projection));
    const y1 = Math.ceil(latToTileY(south, zoom, spec.projection));
    return { x0, x1, y0, y1, count: Math.max(0, (x1 - x0) * (y1 - y0)),
      width: (x1 - x0) * TILE, height: (y1 - y0) * TILE };
  }

  root.GRADO_TILES = { SOURCES, TILE, lonToTileX, latToTileY, groundResolution,
    metresPerDot, pickZoom, tileRange };

  if (typeof document === "undefined") return;

  // ---------- сшивка ----------
  // Тайлы качаются пачками: у источников есть предел одновременных запросов,
  // а лист A3 в 1:1000 — это несколько сотен тайлов.
  async function fetchTile(url, signal) {
    const response = await fetch(url, { signal, mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`тайл не отдан (${response.status})`);
    return createImageBitmap(await response.blob());
  }

  async function buildRaster({ source, bbox, scale, dpi = 300, signal, onProgress,
    sourceOptions } = {}) {
    const options = { sourceOptions };
    const spec = SOURCES[source] || SOURCES.esri;
    const [west, south, east, north] = bbox;
    const lat = (south + north) / 2;
    const choice = pickZoom({ source, lat, scale, dpi });
    if (spec.needsKey && !(options.sourceOptions && options.sourceOptions.instance))
      throw new Error("для этого источника нужен ваш ключ Copernicus — заведите его в настройках подложки");
    const range = tileRange({ source, bbox, zoom: choice.zoom });
    if (!range.count) throw new Error("рамка листа не накрывает ни одного тайла");
    if (range.count > 1200) throw new Error(`нужно ${range.count} тайлов — уменьшите масштаб или формат`);

    const canvas = document.createElement("canvas");
    canvas.width = range.width;
    canvas.height = range.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const jobs = [];
    for (let x = range.x0; x < range.x1; x++)
      for (let y = range.y0; y < range.y1; y++) jobs.push([x, y]);
    let done = 0, failed = 0;
    const batch = 12;
    for (let i = 0; i < jobs.length; i += batch) {
      if (signal?.aborted) throw new Error("Сборка подложки отменена");
      await Promise.all(jobs.slice(i, i + batch).map(async ([x, y]) => {
        try {
          const bitmap = await fetchTile(spec.url(choice.zoom, x, y, options.sourceOptions || {}), signal);
          context.drawImage(bitmap, (x - range.x0) * TILE, (y - range.y0) * TILE);
          bitmap.close?.();
        } catch (error) { failed += 1; }
        done += 1;
        onProgress?.({ done, total: jobs.length, failed });
      }));
    }

    // Обрезаем сшитое полотно ровно по рамке листа: тайлы кратны 256 точкам и
    // всегда шире охвата.
    const pxWest = lonToTileX(west, choice.zoom) * TILE - range.x0 * TILE;
    const pxEast = lonToTileX(east, choice.zoom) * TILE - range.x0 * TILE;
    const pxNorth = latToTileY(north, choice.zoom, spec.projection) * TILE - range.y0 * TILE;
    const pxSouth = latToTileY(south, choice.zoom, spec.projection) * TILE - range.y0 * TILE;
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(pxEast - pxWest));
    cropped.height = Math.max(1, Math.round(pxSouth - pxNorth));
    cropped.getContext("2d").drawImage(canvas, pxWest, pxNorth, pxEast - pxWest, pxSouth - pxNorth,
      0, 0, cropped.width, cropped.height);

    const blob = await new Promise(resolve => cropped.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("не удалось собрать растр");
    return { bytes: new Uint8Array(await blob.arrayBuffer()),
      width: cropped.width, height: cropped.height,
      zoom: choice.zoom, actual: choice.actual, actualDpi: choice.actualDpi,
      upscaled: choice.upscaled, failed, tiles: jobs.length, attribution: spec.attribution,
      unofficial: !!spec.unofficial };
  }

  root.buildSheetRaster = buildRaster;
})(typeof window !== "undefined" ? window : globalThis);
