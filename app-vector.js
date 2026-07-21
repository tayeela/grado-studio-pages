(function (root) {
  "use strict";

  const pc = root.polygonClipping;
  const EPS = 1e-8;
  const META = {
    clip: { label: "Обрезка", short: "Обрезка", help: "Оставляет части исходных полигонов внутри слоя-маски." },
    difference: { label: "Вычитание", short: "Разность", help: "Удаляет из исходных полигонов все части, покрытые маской." },
    intersection: { label: "Пересечение", short: "Пересечение", help: "Создаёт зоны пересечения и добавляет атрибуты маски с префиксом mask_." },
    xor: { label: "Симметричная разность", short: "Симм. разность", help: "Оставляет части обоих слоёв, которые не пересекаются." },
    union: { label: "Объединение", short: "Объединение", help: "Собирает общий контур двух слоёв без внутренних границ." },
    dissolve: { label: "Слияние границ", short: "Слияние", help: "Убирает внутренние границы между полигонами одного слоя." },
  };
  const ICON = { clip: "i-trim", difference: "i-trim", intersection: "i-poly",
    xor: "i-mirror", union: "i-join", dissolve: "i-layers" };

  function cloneValue(value) {
    if (!value || typeof value !== "object") return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function samePoint(a, b) {
    return !!a && !!b && Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
  }

  function cleanRing(points, close = true) {
    if (!Array.isArray(points)) return [];
    const out = [];
    for (const point of points) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const x = Number(point[0]), y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!samePoint(out[out.length - 1], [x, y])) out.push([x, y]);
    }
    if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
    if (out.length < 3 || Math.abs(ringArea(out)) <= EPS) return [];
    if (close) out.push([...out[0]]);
    return out;
  }

  function ringArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
  }

  function featureGeometry(feature) {
    if (!feature || !Array.isArray(feature.ring)) return null;
    const outer = cleanRing(feature.ring);
    if (!outer.length) return null;
    const holes = (feature.holes || []).map(ring => cleanRing(ring)).filter(ring => ring.length);
    return [[outer, ...holes]];
  }

  function normalizeMultiPolygon(value) {
    if (!Array.isArray(value)) return [];
    return value.map(polygon => {
      if (!Array.isArray(polygon) || !polygon.length) return null;
      const rings = polygon.map(ring => cleanRing(ring, false)).filter(ring => ring.length);
      return rings.length ? rings : null;
    }).filter(Boolean);
  }

  function geometryArea(multiPolygon) {
    return normalizeMultiPolygon(multiPolygon).reduce((total, polygon) => {
      const outer = Math.abs(ringArea(polygon[0]));
      const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
      return total + Math.max(0, outer - holes);
    }, 0);
  }

  function geometryParts(multiPolygon) {
    return normalizeMultiPolygon(multiPolygon).filter(polygon => {
      const area = Math.abs(ringArea(polygon[0])) - polygon.slice(1)
        .reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
      return area > EPS;
    }).map(polygon => ({
      ring: polygon[0].map(point => [...point]),
      holes: polygon.slice(1).map(ring => ring.map(point => [...point])),
    }));
  }

  function requireEngine() {
    if (!pc || typeof pc.union !== "function") throw new Error("Модуль полигональных операций не загружен");
  }

  function unionMany(geometries) {
    requireEngine();
    const items = geometries.filter(geometry => geometry && geometry.length);
    if (!items.length) return [];
    let result = items[0];
    for (let offset = 1; offset < items.length; offset += 100) {
      const batch = items.slice(offset, offset + 100);
      result = pc.union(result, ...batch);
    }
    return result || [];
  }

  function maskProps(inputProps, overlayProps) {
    const props = cloneValue(inputProps || {}) || {};
    for (const [key, value] of Object.entries(overlayProps || {})) {
      let name = `mask_${key}`;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(props, name)) name = `mask_${key}_${suffix++}`;
      props[name] = cloneValue(value);
    }
    return props;
  }

  function abortError() {
    const error = new Error("Операция отменена");
    error.name = "AbortError";
    return error;
  }

  async function yieldFrame() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  async function computeOperation({ operation, inputFeatures, overlayFeatures = [], signal, onProgress }) {
    requireEngine();
    if (!META[operation]) throw new Error("Неизвестная векторная операция");
    const inputs = inputFeatures.map(feature => ({ feature, geometry: featureGeometry(feature) }))
      .filter(item => item.geometry);
    const overlays = overlayFeatures.map(feature => ({ feature, geometry: featureGeometry(feature) }))
      .filter(item => item.geometry);
    if (!inputs.length) return [];
    if (operation !== "dissolve" && !overlays.length) return [];
    if (signal?.aborted) throw abortError();

    const specs = [];
    const add = (geometry, feature, props, source) => {
      if (!geometry || geometryArea(geometry) <= EPS) return;
      specs.push({ geometry, props: cloneValue(props || {}), style_id: feature?.style_id || null,
        source: source || "input" });
    };
    const report = (done, total, phase) => onProgress?.({ done, total, phase });

    if (operation === "dissolve") {
      report(0, inputs.length, "Слияние контуров");
      add(unionMany(inputs.map(item => item.geometry)), inputs[0].feature,
        inputs[0].feature.props, "input");
      report(inputs.length, inputs.length, "Слияние контуров");
      return specs;
    }

    if (operation === "union" || operation === "xor") {
      report(0, inputs.length + overlays.length, "Подготовка контуров");
      const inputUnion = unionMany(inputs.map(item => item.geometry));
      if (signal?.aborted) throw abortError();
      await yieldFrame();
      const overlayUnion = unionMany(overlays.map(item => item.geometry));
      if (signal?.aborted) throw abortError();
      const geometry = operation === "union"
        ? pc.union(inputUnion, overlayUnion)
        : pc.xor(inputUnion, overlayUnion);
      add(geometry, inputs[0].feature,
        { operation: operation === "union" ? "union" : "symmetric_difference" }, "combined");
      report(inputs.length + overlays.length, inputs.length + overlays.length, "Готово");
      return specs;
    }

    if (operation === "intersection") {
      for (let i = 0; i < inputs.length; i++) {
        if (signal?.aborted) throw abortError();
        const input = inputs[i];
        for (const overlay of overlays) {
          const geometry = pc.intersection(input.geometry, overlay.geometry);
          add(geometry, input.feature, maskProps(input.feature.props, overlay.feature.props), "both");
        }
        report(i + 1, inputs.length, "Поиск пересечений");
        if (i % 12 === 11) await yieldFrame();
      }
      return specs;
    }

    report(0, inputs.length, "Подготовка маски");
    const mask = unionMany(overlays.map(item => item.geometry));
    if (signal?.aborted) throw abortError();
    for (let i = 0; i < inputs.length; i++) {
      if (signal?.aborted) throw abortError();
      const item = inputs[i];
      const geometry = operation === "clip"
        ? pc.intersection(item.geometry, mask)
        : pc.difference(item.geometry, mask);
      add(geometry, item.feature, item.feature.props, "input");
      report(i + 1, inputs.length, operation === "clip" ? "Обрезка" : "Вычитание");
      if (i % 12 === 11) await yieldFrame();
    }
    return specs;
  }

  const api = { META, cleanRing, ringArea, featureGeometry, normalizeMultiPolygon,
    geometryArea, geometryParts, unionMany, computeOperation };
  root.GRADO_VECTOR = api;

  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const polygonLayers = () => LAYERS_V2.map(layer => ({
    layer,
    features: state.features.filter(feature => layerOf(feature) === layer && Array.isArray(feature.ring)),
  })).filter(item => item.features.length);

  function optionHtml(items, selectedId) {
    return items.map(({ layer, features }) =>
      `<option value="${escHtml(layer.id)}"${layer.id === selectedId ? " selected" : ""}>${escHtml(layer.title)} · ${features.length}</option>`).join("");
  }

  function outputFields(inputLayer, overlayLayer, operation) {
    const fields = cloneValue(inputLayer?.fields || []) || [];
    if (operation === "intersection") {
      const used = new Set(fields.map(field => field.name));
      for (const field of overlayLayer?.fields || []) {
        let name = `mask_${field.name}`;
        let suffix = 2;
        while (used.has(name)) name = `mask_${field.name}_${suffix++}`;
        used.add(name);
        fields.push({ ...cloneValue(field), name, label: `Маска · ${field.label || field.name}` });
      }
    }
    if (["union", "xor"].includes(operation) && !fields.some(field => field.name === "operation"))
      fields.push({ name: "operation", label: "Операция", type: "text" });
    return fields;
  }

  function commitResult({ operation, inputLayer, overlayLayer, specs, title, hideSources }) {
    const prepared = specs.flatMap(spec => geometryParts(spec.geometry).map(part => ({ spec, part })));
    if (!prepared.length) return { count: 0, area: 0 };
    const featureLength = state.features.length;
    const layerLength = LAYERS_V2.length;
    const nextId = state.nextId;
    const selected = state.selected;
    const selectedIds = new Set(state.selectedIds || []);
    const visibility = new Map([inputLayer, overlayLayer].filter(Boolean).map(layer => [layer, layer.visible]));
    snapshot();
    try {
      const resultLayer = createGenericLayer({ title, geometry_type: "polygon", styleId: inputLayer.style_id });
      resultLayer.fields = outputFields(inputLayer, overlayLayer, operation);
      resultLayer.source_operation = operation;
      resultLayer.source_layer_ids = [inputLayer.id, overlayLayer?.id].filter(Boolean);
      const ids = [];
      let area = 0;
      for (const { spec, part } of prepared) {
        const feature = {
          id: state.nextId++, layer_id: resultLayer.id,
          props: cloneValue(spec.props || {}), ring: part.ring, holes: part.holes,
        };
        if (spec.style_id) feature.style_id = spec.style_id;
        upgradeFeature(feature, () => resultLayer);
        area += geometryArea([[part.ring, ...(part.holes || [])]]);
        state.features.push(feature); ids.push(feature.id);
      }
      if (hideSources) {
        inputLayer.visible = false;
        if (overlayLayer) overlayLayer.visible = false;
      }
      state.activeLayerId = resultLayer.id;
      if (ids.length <= 500) setSelection(ids); else clearSelection();
      afterChange();
      return { count: ids.length, area, layer: resultLayer };
    } catch (error) {
      state.features.length = featureLength;
      state.nextId = nextId;
      LAYERS_V2.length = layerLength;
      rebuildLayerIndexes();
      for (const [layer, visible] of visibility) layer.visible = visible;
      state.selected = selected;
      state.selectedIds = selectedIds;
      state.undo.pop();
      syncHistoryControls();
      renderLayers(); renderProps(); draw();
      throw error;
    }
  }

  function openVectorGeoprocessing() {
    closePopups();
    const items = polygonLayers();
    const selectedPolygonFeatures = selectionFeatures().filter(feature => Array.isArray(feature.ring));
    const preferredInput = selectedPolygonFeatures[0] ? layerOf(selectedPolygonFeatures[0])?.id : items[0]?.layer.id;
    const preferredOverlay = selectedPolygonFeatures.find(feature => layerOf(feature)?.id !== preferredInput);
    const overlayId = preferredOverlay ? layerOf(preferredOverlay)?.id
      : items.find(item => item.layer.id !== preferredInput)?.layer.id;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal vector-modal" role="dialog" aria-modal="true" aria-labelledby="vector-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Векторные операции</span><span id="vector-title">Геообработка полигонов</span></div>
        <button class="modal-x" aria-label="Закрыть геообработку"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body vector-body">
        <p class="vector-intro">Исходные слои не меняются: результат создаётся в новом слое и целиком отменяется через Undo.</p>
        <div class="vector-op-grid" role="radiogroup" aria-label="Операция">
          ${Object.entries(META).map(([key, meta], index) => `<button type="button" class="vector-op${index === 0 ? " active" : ""}" data-vector-op="${key}" role="radio" aria-checked="${index === 0}" tabindex="${index === 0 ? 0 : -1}">
            <svg class="ic"><use href="#${ICON[key]}"/></svg>
            <span><b>${meta.label}</b><small>${meta.help}</small></span></button>`).join("")}
        </div>
        <div class="vector-flow">
          <section class="vector-source-card"><span class="vector-step">1</span><label>Исходный слой<select id="vector-input">${optionHtml(items, preferredInput)}</select></label>
            <label class="chk vector-selection"><input id="vector-input-selected" type="checkbox">Только выделенные <span id="vector-input-selected-count"></span></label></section>
          <div class="vector-flow-arrow" aria-hidden="true"><svg class="ic"><use href="#ic-chevron"/></svg></div>
          <section class="vector-source-card" id="vector-mask-card"><span class="vector-step">2</span><label>Слой-маска<select id="vector-overlay">${optionHtml(items, overlayId)}</select></label>
            <label class="chk vector-selection"><input id="vector-overlay-selected" type="checkbox">Только выделенные <span id="vector-overlay-selected-count"></span></label></section>
        </div>
        <div class="vector-output-card"><span class="vector-step">3</span><label>Новый слой результата<input id="vector-output" type="text" maxlength="100"></label>
          <label class="chk"><input id="vector-hide-sources" type="checkbox">Скрыть исходные слои после выполнения</label></div>
        <div class="vector-summary" id="vector-summary" role="status" aria-live="polite"></div>
        <div class="vector-progress" id="vector-progress" hidden><div><span id="vector-progress-label">Подготовка…</span><b id="vector-progress-value">0%</b></div><progress id="vector-progress-bar" max="100" value="0"></progress></div>
      </div>
      <div class="modal-actions"><button type="button" id="vector-docs" class="vector-help">Как это работает</button><span class="spacer"></span>
        <button type="button" id="vector-cancel">Отмена</button><button type="button" id="vector-run" class="primary">Выполнить</button></div>
    </div>`;
    document.body.appendChild(overlay);

    let operation = "clip";
    let outputTouched = false;
    let controller = null;
    const inputSelect = overlay.querySelector("#vector-input");
    const overlaySelect = overlay.querySelector("#vector-overlay");
    const inputOnly = overlay.querySelector("#vector-input-selected");
    const overlayOnly = overlay.querySelector("#vector-overlay-selected");
    const output = overlay.querySelector("#vector-output");
    const runButton = overlay.querySelector("#vector-run");
    const cancelButton = overlay.querySelector("#vector-cancel");
    const summary = overlay.querySelector("#vector-summary");

    const layerItem = id => items.find(item => item.layer.id === id);
    const selectedCount = id => {
      const layer = layerItem(id)?.layer;
      return layer ? selectedPolygonFeatures.filter(feature => layerOf(feature) === layer).length : 0;
    };
    const generatedTitle = () => {
      const input = layerItem(inputSelect.value)?.layer;
      return `${META[operation].short} · ${input?.title || "слой"}`.slice(0, 100);
    };
    const update = () => {
      const inputItem = layerItem(inputSelect.value);
      const maskItem = layerItem(overlaySelect.value);
      const needsMask = operation !== "dissolve";
      overlay.querySelector("#vector-mask-card").hidden = !needsMask;
      overlay.querySelector(".vector-flow-arrow").hidden = !needsMask;
      const inputSelected = selectedCount(inputSelect.value);
      const maskSelected = selectedCount(overlaySelect.value);
      inputOnly.disabled = !inputSelected;
      overlayOnly.disabled = !maskSelected;
      if (!inputSelected) inputOnly.checked = false;
      if (!maskSelected) overlayOnly.checked = false;
      overlay.querySelector("#vector-input-selected-count").textContent = inputSelected ? `(${inputSelected})` : "";
      overlay.querySelector("#vector-overlay-selected-count").textContent = maskSelected ? `(${maskSelected})` : "";
      const inputCount = inputOnly.checked ? inputSelected : (inputItem?.features.length || 0);
      const maskCount = overlayOnly.checked ? maskSelected : (maskItem?.features.length || 0);
      const invalid = !inputItem || (needsMask && (!maskItem || inputItem.layer === maskItem.layer));
      runButton.disabled = invalid || !inputCount || (needsMask && !maskCount);
      summary.classList.toggle("error", invalid && !!inputItem);
      summary.innerHTML = !items.length ? `<b>Нет полигональных слоёв.</b><span>Создайте или импортируйте слой с полигонами.</span>`
        : invalid && needsMask ? `<b>Выберите другой слой-маску.</b><span>Исходный слой и маска должны различаться.</span>`
        : `<b>${META[operation].label}</b><span>${inputCount} исходн. ${needsMask ? `· ${maskCount} в маске · ` : "· "}результат появится в новом слое</span>`;
      if (!outputTouched) output.value = generatedTitle();
    };
    const setBusy = busy => {
      overlay.querySelectorAll("select,input,.vector-op,#vector-docs").forEach(element => element.disabled = busy);
      runButton.disabled = busy;
      cancelButton.textContent = busy ? "Остановить" : "Отмена";
      overlay.querySelector(".modal-x").disabled = busy;
      overlay.querySelector("#vector-progress").hidden = !busy;
    };
    const close = () => {
      if (controller) { controller.abort(); return; }
      overlay.remove();
    };

    overlay.querySelectorAll(".vector-op").forEach(button => button.addEventListener("click", () => {
      operation = button.dataset.vectorOp;
      overlay.querySelectorAll(".vector-op").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-checked", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      update();
    }));
    overlay.querySelector(".vector-op-grid").addEventListener("keydown", event => {
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
      const buttons = [...overlay.querySelectorAll(".vector-op")];
      const current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const next = buttons[(current + delta + buttons.length) % buttons.length];
      next.focus(); next.click();
    });
    [inputSelect, overlaySelect, inputOnly, overlayOnly].forEach(control => control.addEventListener("change", update));
    output.addEventListener("input", () => { outputTouched = true; });
    overlay.querySelector("#vector-hide-sources").addEventListener("change", update);
    overlay.querySelector("#vector-docs").addEventListener("click", () => {
      summary.classList.remove("error");
      summary.innerHTML = `<b>Логика как в QGIS</b><span>«Обрезка» сохраняет атрибуты исходного слоя; «Пересечение» добавляет атрибуты маски. Все операции создают новый слой.</span>`;
    });
    cancelButton.addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    runButton.addEventListener("click", async () => {
      const inputItem = layerItem(inputSelect.value);
      const maskItem = layerItem(overlaySelect.value);
      if (!inputItem || (operation !== "dissolve" && (!maskItem || inputItem.layer === maskItem.layer))) return;
      const inputFeatures = inputOnly.checked
        ? inputItem.features.filter(feature => state.selectedIds.has(feature.id)) : inputItem.features;
      const overlayFeatures = operation === "dissolve" ? [] : (overlayOnly.checked
        ? maskItem.features.filter(feature => state.selectedIds.has(feature.id)) : maskItem.features);
      controller = new AbortController();
      setBusy(true);
      summary.innerHTML = `<b>Выполняется ${META[operation].label.toLowerCase()}…</b><span>Проект изменится только после полной подготовки результата.</span>`;
      try {
        const specs = await computeOperation({ operation, inputFeatures, overlayFeatures,
          signal: controller.signal, onProgress: ({ done, total, phase }) => {
            const value = total ? Math.round(done / total * 100) : 0;
            overlay.querySelector("#vector-progress-label").textContent = phase;
            overlay.querySelector("#vector-progress-value").textContent = `${value}%`;
            overlay.querySelector("#vector-progress-bar").value = value;
          } });
        if (controller.signal.aborted) throw abortError();
        const result = commitResult({ operation, inputLayer: inputItem.layer,
          overlayLayer: operation === "dissolve" ? null : maskItem.layer,
          specs, title: output.value.trim() || generatedTitle(),
          hideSources: overlay.querySelector("#vector-hide-sources").checked });
        if (!result.count) {
          summary.classList.add("error");
          summary.innerHTML = `<b>Результат пуст.</b><span>Полигоны не образуют частей для выбранной операции.</span>`;
          controller = null; setBusy(false); update(); return;
        }
        controller = null;
        overlay.remove();
        toast(`${META[operation].label}: ${ruCount(result.count, "полигон", "полигона", "полигонов")} · новый слой «${result.layer.title}»`);
      } catch (error) {
        const cancelled = error?.name === "AbortError";
        controller = null; setBusy(false); update();
        summary.classList.toggle("error", !cancelled);
        summary.innerHTML = cancelled
          ? `<b>Операция остановлена.</b><span>Проект не изменён.</span>`
          : `<b>Не удалось обработать геометрию.</b><span>${escHtml(String(error.message || error).slice(0, 180))}</span>`;
      }
    });
    update();
    setTimeout(() => inputSelect.focus(), 0);
  }

  root.openVectorGeoprocessing = openVectorGeoprocessing;
  const trigger = $("btn-vector-open");
  if (trigger) trigger.addEventListener("click", openVectorGeoprocessing);
})(typeof window !== "undefined" ? window : globalThis);
