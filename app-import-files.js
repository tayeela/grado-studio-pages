"use strict";
// ---------- единый импорт файлов: SHP / TAB / MIF / GeoJSON ----------
// Одна кнопка и перетаскивание на холст. Пользователь кидает что есть:
// шейп пачкой (.shp+.dbf+.prj+.cpg) или ZIP-ом, MapInfo комплектом
// (.tab/.dat/.map/.id) или MIF/MID, GeoJSON. Файлы группируются по имени,
// система координат берётся из файла (.prj, CoordSys, заголовок .map);
// если файл молчит — метры проверяются по известным российским СК
// (Гаусса-Крюгера СК-42, UTM, МСК Москвы) на попадание в область карты,
// в крайнем случае СК спрашивается у человека. Дальше всё едет тем же
// конвейером, что GeoJSON ГИС ОГД: слой на файл, поля, знаки.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  if (typeof document === "undefined") return;

  const EXTS = ["zip", "shp", "dbf", "prj", "cpg", "shx", "qix",
    "tab", "dat", "map", "id", "ind", "mif", "mid", "geojson", "json"];
  const splitName = name => {
    const m = String(name).match(/^(.*)\.([^.]+)$/);
    return m ? [m[1], m[2].toLowerCase()] : [name, ""];
  };

  // группировка по основе имени: zones.shp + zones.dbf + … = один набор
  function groupFiles(entries) {
    const groups = new Map();
    for (const { name, buffer } of entries) {
      const [stem, ext] = splitName(name.split(/[\\/]/).pop());
      if (!EXTS.includes(ext)) continue;
      const key = stem.toLowerCase();
      if (!groups.has(key)) groups.set(key, { stem, files: {} });
      groups.get(key).files[ext] = buffer;
    }
    return [...groups.values()];
  }

  function reprojectGeometry(geometry, def) {
    const C = root.GRADO_CRS_RU;
    const conv = pt => {
      const [lon, lat] = C.toWgs84(pt[0], pt[1], def);
      return [lon, lat];
    };
    const walk = coords => Array.isArray(coords[0]) ? coords.map(walk) : conv(coords);
    return { ...geometry, coordinates: walk(geometry.coordinates) };
  }
  function firstCoordinate(fc) {
    for (const f of fc.features) {
      if (!f || !f.geometry || !f.geometry.coordinates) continue;
      let c = f.geometry.coordinates;
      while (Array.isArray(c[0])) c = c[0];
      if (c.length >= 2) return c;
    }
    return null;
  }

  // ---------- выбор СК руками, когда автоматика не справилась ----------
  function askCrs(stem, point) {
    const C = root.GRADO_CRS_RU;
    return new Promise(resolve => {
      closePopups();
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `<div class="modal find-modal" role="dialog" aria-modal="true" aria-labelledby="crs-title">
        <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Импорт</span><span id="crs-title">Система координат «${escHtml(stem)}»</span></div>
          <button class="modal-x" aria-label="Закрыть выбор системы координат"><svg class="ic"><use href="#ic-close"/></svg></button></div>
        <div class="modal-body select-body">
          <p class="vector-intro">Файл не назвал свою систему координат, а по попаданию в область
            карты она не угадалась. Первая точка файла: ${escHtml(point ? point.map(v => v.toFixed(2)).join("; ") : "—")}.</p>
          <label class="select-row">Система координат<select id="crs-pick">
            ${C.KNOWN.map((k, i) => `<option value="${i}">${escHtml(k.title)}</option>`).join("")}
          </select></label>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button type="button" id="crs-cancel">Пропустить файл</button>
          <button type="button" id="crs-ok" class="primary">Импортировать</button></div>
      </div>`;
      document.body.appendChild(overlay);
      const done = value => { overlay.remove(); resolve(value); };
      overlay.querySelector("#crs-ok").addEventListener("click", () =>
        done(C.KNOWN[+overlay.querySelector("#crs-pick").value].def));
      overlay.querySelector("#crs-cancel").addEventListener("click", () => done(null));
      overlay.querySelector(".modal-x").addEventListener("click", () => done(null));
      overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(null); });
    });
  }

  async function resolveCrs(fc, stem) {
    const C = root.GRADO_CRS_RU;
    if (fc.crsDef) return fc.crsDef;
    const point = firstCoordinate(fc);
    if (!point) return null;
    if (C.looksLikeDegrees(point)) return { kind: "geographic", ell: C.ELLIPSOIDS.wgs84 };
    let view = [37.62, 55.75];
    try { view = localToLonLat(...s2w(viewportW() / 2, viewportH() / 2)); } catch {}
    const hit = C.detectByFit(point, view);
    if (hit) {
      toast(`«${stem}»: система координат определена как ${hit.title}`);
      return hit.def;
    }
    return askCrs(stem, point);
  }

  // ---------- один набор файлов → импорт через общий конвейер ----------
  async function importDataset(group) {
    const { stem, files } = group;
    let fc;
    if (files.shp) {
      fc = GRADO_SHP.readShapefile(files);
      if (fc.prjUnparsed) toast(`«${stem}»: .prj не распознан — система координат подбирается`, "warn");
    } else if (files.tab) {
      fc = GRADO_MAPINFO.readTab({
        tab: GRADO_SHP.decodeText(new Uint8Array(files.tab), null),
        dat: files.dat, map: files.map, id: files.id });
      for (const note of fc.notes || []) toast(`«${stem}»: ${note}`, "warn");
    } else if (files.mif) {
      fc = GRADO_MAPINFO.parseMif(
        GRADO_SHP.decodeText(new Uint8Array(files.mif), null), files.mid);
    } else if (files.geojson || files.json) {
      const text = new TextDecoder().decode(files.geojson || files.json);
      fc = JSON.parse(text);
      fc.crsDef = null;
    } else {
      return { stem, skipped: "нет основного файла (.shp, .tab, .mif или .geojson)" };
    }
    if (!fc.features || !fc.features.length) return { stem, skipped: "файл пуст" };
    const def = await resolveCrs(fc, stem);
    if (def === null && !GRADO_CRS_RU.looksLikeDegrees(firstCoordinate(fc) || [999, 999]))
      return { stem, skipped: "система координат не выбрана" };
    const wgs = def && def.kind !== "geographic" || (def && def.towgs84)
      ? fc.features.map(f => ({ ...f, geometry: reprojectGeometry(f.geometry, def) }))
      : fc.features;
    const payload = { type: "FeatureCollection",
      features: wgs.map(f => ({ type: "Feature", geometry: f.geometry,
        properties: f.properties || {} })) };
    const r = await fetch("/api/import-gisogd", { method: "POST",
      headers: { "Content-Type": "application/geo+json",
        "X-Grado-Filename": encodeURIComponent(stem + ".geojson"),
        "X-Grado-Source-Title": encodeURIComponent(stem) },
      body: JSON.stringify(payload) });
    if (!r.ok) {
      let msg = await r.text();
      try { msg = JSON.parse(msg).error || msg; } catch {}
      throw new Error(msg);
    }
    const ok = await applyGisogdData(await r.json(), `Импортировать «${stem}» (${payload.features.length} объектов)?`);
    return { stem, imported: ok ? payload.features.length : 0, cancelled: !ok };
  }

  async function importPickedFiles(fileList) {
    const done = typeof beginBusy === "function" ? beginBusy("Разбор файлов…") : () => {};
    try {
      const entries = [];
      for (const file of fileList) {
        const buffer = await file.arrayBuffer();
        const [, ext] = splitName(file.name);
        if (ext === "zip") {
          const inner = await GRADO_SHP.unzip(buffer);
          for (const [name, innerBuffer] of Object.entries(inner))
            entries.push({ name, buffer: innerBuffer });
        } else entries.push({ name: file.name, buffer });
      }
      const groups = groupFiles(entries);
      if (!groups.length) { toast("Не нашлось файлов SHP, TAB, MIF или GeoJSON", "warn"); return; }
      const summary = [];
      for (const group of groups) {
        try {
          const res = await importDataset(group);
          if (res.skipped) summary.push(`«${res.stem}» пропущен: ${res.skipped}`);
        } catch (error) {
          summary.push(`«${group.stem}»: ${String(error.message || error).slice(0, 120)}`);
        }
      }
      for (const line of summary) toast(line, "warn");
    } finally { done(); }
  }
  root.importPickedFiles = importPickedFiles;

  // ---------- проводка: кнопка и перетаскивание ----------
  const input = document.getElementById("anyimport-file");
  const trigger = document.getElementById("btn-import-files");
  if (trigger && input) {
    trigger.addEventListener("click", () => input.click());
    input.addEventListener("change", async event => {
      const files = [...event.target.files];
      event.target.value = "";
      if (files.length) await importPickedFiles(files);
    });
  }
  // перетаскивание: на весь документ, чтобы не целиться в холст
  document.addEventListener("dragover", event => {
    if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", async event => {
    const files = [...(event.dataTransfer?.files || [])];
    const [, ext] = files.length ? splitName(files[0].name) : [null, ""];
    if (!files.length || !EXTS.includes(ext)) return;   // чужие перетаскивания не трогаем
    event.preventDefault();
    await importPickedFiles(files);
  });
})();
