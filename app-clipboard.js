"use strict";
// ---------- копирование объектов через системный буфер обмена ----------
// Ctrl+C / Ctrl+V между проектами и вкладками: объект едет в буфер как JSON
// со своей геометрией, атрибутами и описанием слоя. В другом проекте слой
// восстанавливается (встроенный — по спецификации, пользовательский — по
// увезённому описанию), координаты сохраняются — геопривязка не ломается.
// Вставка в тот же проект кладёт копию со сдвигом на шаг сетки, как Ctrl+D:
// копия точно поверх оригинала неотличима от него и теряется.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const FORMAT = "grado-studio/features";
  const GEOM_KEYS = ["point", "line", "ring", "holes", "circle", "arc"];
  const CARRY_KEYS = [...GEOM_KEYS, "props", "style_id", "kind", "layer_id", "label_offset"];

  const isNum = v => typeof v === "number" && isFinite(v);
  const isPt = p => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
  const isChain = (c, min) => Array.isArray(c) && c.length >= min && c.every(isPt);

  // геометрия из буфера — недоверенный ввод: чужая вкладка, чужая программа,
  // руки. Битые координаты уронили бы отрисовку всего проекта.
  function validGeometry(f) {
    const present = GEOM_KEYS.filter(key => key !== "holes" && f[key] !== undefined);
    if (present.length !== 1) return false;
    if (f.point) return isPt(f.point);
    if (f.line) return isChain(f.line, 2);
    if (f.ring) return isChain(f.ring, 3) &&
      (f.holes === undefined || (Array.isArray(f.holes) && f.holes.every(h => isChain(h, 3))));
    if (f.circle) return isNum(f.circle.cx) && isNum(f.circle.cy) && isNum(f.circle.r) && f.circle.r > 0;
    if (f.arc) return ["cx", "cy", "r", "a0", "sweep"].every(key => isNum(f.arc[key])) && f.arc.r > 0;
    return false;
  }

  // сериализация выделения: объекты + описания их слоёв (чтобы на другой
  // стороне слой можно было завести заново)
  function serializeFeatures(features, resolveLayer) {
    const layers = new Map();
    const out = [];
    for (const f of features) {
      const copy = {};
      for (const key of CARRY_KEYS)
        if (f[key] !== undefined && f[key] !== null)
          copy[key] = JSON.parse(JSON.stringify(f[key]));
      if (!validGeometry(copy)) continue;
      out.push(copy);
      const L = resolveLayer ? resolveLayer(f) : null;
      if (!L || layers.has(L.id)) continue;
      const meta = { id: L.id, title: L.title, kind: L.kind,
        geometry_type: L.geometry_type, style_id: L.style_id };
      if (L.generic) meta.generic = true;
      if (L.semantic_class) meta.semantic_class = L.semantic_class;
      if (L.fields && L.fields.length) meta.fields = JSON.parse(JSON.stringify(L.fields));
      if (L.fmt) meta.fmt = JSON.parse(JSON.stringify(L.fmt));
      layers.set(L.id, meta);
    }
    if (!out.length) return null;
    return { format: FORMAT, version: 1, features: out, layers: [...layers.values()] };
  }

  // разбор буфера: не наш формат — null (обычный текст в буфере — не ошибка),
  // наш, но с битыми объектами — битые молча отбрасываются
  function parsePayload(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch { return null; }
    if (!data || data.format !== FORMAT || !Array.isArray(data.features)) return null;
    const features = [];
    for (const item of data.features) {
      if (!item || typeof item !== "object") continue;
      const copy = {};
      for (const key of CARRY_KEYS)
        if (item[key] !== undefined && item[key] !== null) copy[key] = item[key];
      if (!validGeometry(copy)) continue;
      if (copy.props && typeof copy.props !== "object") delete copy.props;
      features.push(copy);
    }
    if (!features.length) return null;
    const layers = Array.isArray(data.layers)
      ? data.layers.filter(meta => meta && typeof meta.id === "string" && meta.id)
      : [];
    return { features, layers };
  }

  root.GRADO_CLIPBOARD = { FORMAT, serializeFeatures, parsePayload, validGeometry };
  if (typeof document === "undefined") return;   // ядро тестируется в Node

  // ---------- проводка в приложение ----------
  const geomKey = f => JSON.stringify(GEOM_KEYS.map(key => f[key]));

  function shiftFeature(f, dx, dy) {
    if (f.circle) { f.circle.cx += dx; f.circle.cy += dy; return; }
    if (f.arc) { f.arc.cx += dx; f.arc.cy += dy; return; }
    for (const p of featureMovablePts(f)) { p[0] += dx; p[1] += dy; }
  }

  const geometryTypeOf = f =>
    f.ring ? "polygon" : f.line ? "polyline" : f.point ? "point"
      : f.circle ? "circle" : "arc";

  // слой для вставляемого объекта: существующий → встроенная спецификация →
  // увезённое описание → свежий generic-слой по геометрии
  function ensurePasteLayer(item, metaById, cache) {
    const wanted = item.layer_id;
    if (wanted && cache.has(wanted)) return cache.get(wanted);
    let L = wanted ? LAYER_BY_ID[wanted] : null;
    if (!L && wanted) {
      const spec = _BUILTIN_LAYER_SPECS.find(s => s.id === wanted);
      if (spec) {
        L = cloneLayerSpec(spec);
        L.visible = true;
        LAYERS_V2.push(L);
        LAYER_BY_ID[L.id] = L;
      }
    }
    if (!L && wanted) {
      const meta = metaById.get(wanted);
      if (meta) {
        try {
          L = meta.generic || !BASE_KIND_BY_KIND[meta.kind]
            ? createGenericLayer({ id: wanted, title: meta.title || "Вставленные",
                geometry_type: meta.geometry_type || geometryTypeOf(item), styleId: meta.style_id })
            : createUserLayer({ id: wanted, kind: meta.kind, title: meta.title || "Вставленные",
                styleId: meta.style_id });
          if (meta.fields && meta.fields.length) L.fields = meta.fields;
          if (meta.fmt) L.fmt = meta.fmt;
        } catch { L = null; }
      }
    }
    if (!L) L = createGenericLayer({ title: "Вставленные",
      geometry_type: geometryTypeOf(item) });
    if (wanted) cache.set(wanted, L);
    return L;
  }

  async function copySelectedFeatures() {
    const features = selectionFeatures();
    if (!features.length) { toast("Нечего копировать — выберите объекты", "warn"); return false; }
    const payload = serializeFeatures(features, layerOf);
    if (!payload) { toast("Выделение не содержит геометрии", "warn"); return false; }
    try { await navigator.clipboard.writeText(JSON.stringify(payload)); }
    catch { toast("Браузер не дал записать в буфер обмена", "warn"); return false; }
    toast(`В буфер: ${ruCount(payload.features.length, "объект", "объекта", "объектов")}`);
    return true;
  }

  async function pasteFeatures() {
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch { toast("Браузер не дал прочитать буфер обмена", "warn"); return false; }
    const payload = parsePayload(text);
    if (!payload) { toast("В буфере нет объектов Студии", "warn"); return false; }
    const metaById = new Map(payload.layers.map(meta => [meta.id, meta]));
    const cache = new Map();
    // вставка поверх самих себя (тот же проект) — сдвиг на шаг сетки;
    // в чужом проекте координаты не трогаются, геопривязка важнее
    const existing = new Set(state.features.map(geomKey));
    const step = gridStep();
    snapshot();
    const ids = [];
    for (const item of payload.features) {
      const L = ensurePasteLayer(item, metaById, cache);
      const nf = { ...item, id: state.nextId++, layer_id: L.id };
      if (existing.has(geomKey(nf))) shiftFeature(nf, step, -step);
      upgradeFeature(nf);
      state.features.push(nf);
      ids.push(nf.id);
    }
    setSelection(ids);
    renderLayers();
    afterChange();
    toast(`Вставлено: ${ruCount(ids.length, "объект", "объекта", "объектов")}`);
    return true;
  }
  root.copySelectedFeatures = copySelectedFeatures;
  root.pasteFeatures = pasteFeatures;

  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    const t = event.target;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"
        || t.isContentEditable) return;
    if (event.code === "KeyC") {
      // выделен текст на странице — это обычное копирование текста, не наше
      const textSelection = root.getSelection && String(root.getSelection());
      if (textSelection) return;
      if (!selectionFeatures().length) return;
      event.preventDefault();
      copySelectedFeatures();
    } else if (event.code === "KeyV") {
      event.preventDefault();
      pasteFeatures();
    }
  });
})();
