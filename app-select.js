// Отбор объектов — «Выбрать по выражению» и «Выбрать по расположению» из QGIS.
//
// Зачем. Набрать все здания внутри границы разработки, все ЗОУИТ, задевающие
// территорию, все зоны определённого вида — руками по чертежу это неделя, а
// через выборку секунда. Отсюда же считается ТЭП по набранному.
//
// Ядро — чистые функции над нормализованной геометрией: работают в Node и
// покрыты тестом. Предикаты те же, что в QGIS: пересекает, внутри, содержит,
// касается, в радиусе.
(function (root) {
  "use strict";

  const EPS = 1e-9;

  const PREDICATES = {
    intersects: { label: "пересекает", help: "Любое касание или наложение." },
    within: { label: "внутри", help: "Объект целиком лежит в объекте-образце." },
    contains: { label: "содержит", help: "Объект целиком содержит объект-образец." },
    disjoint: { label: "не касается", help: "Ни касания, ни наложения." },
    distance: { label: "в радиусе", help: "Ближе заданного расстояния (в метрах)." },
  };

  // ---------- нормализация ----------
  // Дуги и окружности берём через featurePts приложения: там уже есть разбивка
  // на точки с учётом направления обхода.
  function geometryOf(feature) {
    if (!feature) return null;
    if (Array.isArray(feature.ring)) {
      const rings = [feature.ring, ...(feature.holes || [])].filter(r => Array.isArray(r) && r.length > 2);
      return { kind: "polygon", rings, chains: rings.map(closeRing), points: rings.flat(),
        bounds: boundsOf(rings.flat()) };
    }
    if (Array.isArray(feature.line) && feature.line.length > 1)
      return { kind: "line", rings: [], chains: [feature.line], points: feature.line,
        bounds: boundsOf(feature.line) };
    if (Array.isArray(feature.point))
      return { kind: "point", rings: [], chains: [], points: [feature.point],
        bounds: boundsOf([feature.point]) };
    const sampler = root.featurePts;
    if ((feature.arc || feature.circle) && typeof sampler === "function") {
      const pts = sampler(feature);
      if (pts && pts.length > 1) {
        const closed = !!feature.circle;
        return { kind: closed ? "polygon" : "line", rings: closed ? [pts] : [],
          chains: [closed ? closeRing(pts) : pts], points: pts, bounds: boundsOf(pts) };
      }
    }
    return null;
  }

  const closeRing = ring => (ring.length > 2 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]))
    ? [...ring, ring[0]] : ring;

  function boundsOf(points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }
  const boundsHit = (a, b, pad = 0) =>
    !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);

  // ---------- элементарные проверки ----------
  function pointInRings(x, y, rings) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) &&
            x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
    }
    return inside;   // дыры переворачивают признак — выколотая часть считается снаружи
  }

  const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

  function segmentsCross(p1, p2, p3, p4) {
    const d1 = side(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1]);
    const d2 = side(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1]);
    const d3 = side(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    const d4 = side(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1]);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    // касание концом — тоже пересечение: «пересекает» в QGIS включает касание
    return segmentDistance(p1, p2, p3, p4) <= EPS;
  }

  function pointSegmentDistance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  }

  function segmentDistance(p1, p2, p3, p4) {
    return Math.min(pointSegmentDistance(p1, p3, p4), pointSegmentDistance(p2, p3, p4),
                    pointSegmentDistance(p3, p1, p2), pointSegmentDistance(p4, p1, p2));
  }

  function* segments(geometry) {
    for (const chain of geometry.chains)
      for (let i = 1; i < chain.length; i++) yield [chain[i - 1], chain[i]];
  }

  // ---------- предикаты ----------
  function intersects(a, b) {
    if (!a || !b || !boundsHit(a.bounds, b.bounds)) return false;
    for (const s1 of segments(a))
      for (const s2 of segments(b))
        if (segmentsCross(s1[0], s1[1], s2[0], s2[1])) return true;
    if (b.kind === "polygon" && a.points.some(p => pointInRings(p[0], p[1], b.rings))) return true;
    if (a.kind === "polygon" && b.points.some(p => pointInRings(p[0], p[1], a.rings))) return true;
    return false;
  }

  // «внутри»: все точки объекта в образце и ни одного прокола границы. Точка на
  // самой границе считается внутри — иначе участок, стыкующийся с границей
  // разработки, из выборки выпадал бы.
  function within(a, b) {
    if (!a || !b || b.kind !== "polygon") return false;
    if (!boundsHit(a.bounds, b.bounds)) return false;
    for (const p of a.points)
      if (!pointInRings(p[0], p[1], b.rings) && !onBoundary(p, b)) return false;
    for (const s1 of segments(a))
      for (const s2 of segments(b))
        if (properCross(s1[0], s1[1], s2[0], s2[1])) return false;
    return true;
  }

  function onBoundary(point, geometry) {
    for (const [a, b] of segments(geometry))
      if (pointSegmentDistance(point, a, b) <= 1e-6) return true;
    return false;
  }

  function properCross(p1, p2, p3, p4) {
    const d1 = side(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1]);
    const d2 = side(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1]);
    const d3 = side(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    const d4 = side(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1]);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function withinDistance(a, b, distance) {
    if (!a || !b) return false;
    if (!boundsHit(a.bounds, b.bounds, distance)) return false;
    if (intersects(a, b)) return true;
    let best = Infinity;
    for (const s1 of segments(a))
      for (const s2 of segments(b)) {
        best = Math.min(best, segmentDistance(s1[0], s1[1], s2[0], s2[1]));
        if (best <= distance) return true;
      }
    // точечные объекты рёбер не имеют
    for (const p of a.points) {
      for (const [c, d] of segments(b)) best = Math.min(best, pointSegmentDistance(p, c, d));
      for (const q of b.points) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
      if (best <= distance) return true;
    }
    return best <= distance;
  }

  function testPredicate(predicate, a, b, distance) {
    if (predicate === "intersects") return intersects(a, b);
    if (predicate === "within") return within(a, b);
    if (predicate === "contains") return within(b, a);
    if (predicate === "disjoint") return !intersects(a, b);
    if (predicate === "distance") return withinDistance(a, b, distance || 0);
    return false;
  }

  // ---------- отбор ----------
  // Образцов бывает много (все красные линии района), поэтому они раскладываются
  // по сетке габаритов: без неё отбор — произведение двух городских слоёв.
  function buildIndex(references) {
    const items = references.map(geometryOf).filter(Boolean);
    if (!items.length) return { items, query: () => [] };
    let span = 0;
    for (const item of items) span += (item.bounds[2] - item.bounds[0]) + (item.bounds[3] - item.bounds[1]);
    const cellSize = Math.max(span / (2 * items.length), 1e-6);
    const cells = new Map();
    const big = [];
    items.forEach((item, index) => {
      const cx0 = Math.floor(item.bounds[0] / cellSize), cx1 = Math.floor(item.bounds[2] / cellSize);
      const cy0 = Math.floor(item.bounds[1] / cellSize), cy1 = Math.floor(item.bounds[3] / cellSize);
      if ((cx1 - cx0) > 64 || (cy1 - cy0) > 64) { big.push(index); return; }
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cx + "_" + cy;
          let bucket = cells.get(key); if (!bucket) cells.set(key, bucket = []);
          bucket.push(index);
        }
    });
    return {
      items,
      query: (bounds, pad = 0) => {
        const found = new Set(big);
        const cx0 = Math.floor((bounds[0] - pad) / cellSize), cx1 = Math.floor((bounds[2] + pad) / cellSize);
        const cy0 = Math.floor((bounds[1] - pad) / cellSize), cy1 = Math.floor((bounds[3] + pad) / cellSize);
        for (let cx = cx0; cx <= cx1; cx++)
          for (let cy = cy0; cy <= cy1; cy++) {
            const bucket = cells.get(cx + "_" + cy);
            if (bucket) for (const index of bucket) found.add(index);
          }
        return [...found].map(index => items[index]);
      },
    };
  }

  function selectByLocation({ features = [], references = [], predicate = "intersects", distance = 0 } = {}) {
    const index = buildIndex(references);
    if (!index.items.length) return predicate === "disjoint" ? features.slice() : [];
    const pad = predicate === "distance" ? distance : 0;
    const out = [];
    for (const feature of features) {
      const geometry = geometryOf(feature);
      if (!geometry) continue;
      const candidates = index.query(geometry.bounds, pad);
      if (predicate === "disjoint") {
        // «не касается» обязано проверяться по ВСЕМ образцам, а не по соседям
        if (!candidates.some(other => intersects(geometry, other))) out.push(feature);
        continue;
      }
      if (candidates.some(other => testPredicate(predicate, geometry, other, distance))) out.push(feature);
    }
    return out;
  }

  function selectByExpression({ features = [], expression = "", evaluate } = {}) {
    const run = evaluate || root.evalFieldExpr;
    if (typeof run !== "function") throw new Error("вычислитель выражений недоступен");
    const out = [];
    let failed = 0, firstError = null;
    for (const feature of features) {
      let value;
      try { value = run(expression, feature); }
      catch (error) { failed += 1; if (!firstError) firstError = error; continue; }
      // строка «0» и пустая строка — это «нет», как в QGIS
      if (value === true || (value !== false && value !== 0 && value !== "" &&
          value !== null && value !== undefined && String(value).trim() !== "0")) out.push(feature);
    }
    if (firstError && !out.length && failed === features.length) throw firstError;
    return out;
  }

  // как выборка соединяется с уже набранной: те же режимы, что в QGIS
  function combine(mode, current, found) {
    const ids = new Set(found.map(f => f.id));
    if (mode === "add") return new Set([...current, ...ids]);
    if (mode === "subtract") return new Set([...current].filter(id => !ids.has(id)));
    if (mode === "intersect") return new Set([...current].filter(id => ids.has(id)));
    return ids;
  }

  root.GRADO_SELECT = { PREDICATES, geometryOf, intersects, within, withinDistance,
    testPredicate, buildIndex, selectByLocation, selectByExpression, combine };

  if (typeof document === "undefined") return;

  // ---------- окно отбора ----------
  const $ = id => document.getElementById(id);
  const MODES = {
    replace: "новая выборка", add: "добавить к выборке",
    subtract: "убрать из выборки", intersect: "оставить общее",
  };

  const layerItems = () => LAYERS_V2.map(layer => ({
    layer, features: state.features.filter(feature => layerOf(feature) === layer),
  })).filter(item => item.features.length);

  function openSelectBy(tab = "expression") {
    closePopups();
    const items = layerItems();
    if (!items.length) { toast("Нет объектов для отбора"); return; }
    const active = LAYERS_V2.find(layer => layer.id === state.activeLayerId);
    const target = items.find(item => item.layer === active)?.layer.id || items[0].layer.id;
    const reference = items.find(item => item.layer.id !== target)?.layer.id || target;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal select-modal" role="dialog" aria-modal="true" aria-labelledby="select-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Отбор объектов</span><span id="select-title">Выбрать</span></div>
        <button class="modal-x" aria-label="Закрыть отбор"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body select-body">
        <div class="select-tabs" role="tablist">
          <button type="button" role="tab" data-select-tab="expression" aria-selected="${tab === "expression"}">По выражению</button>
          <button type="button" role="tab" data-select-tab="location" aria-selected="${tab === "location"}">По расположению</button>
        </div>
        <label class="select-row">Слой<select id="select-layer">${items.map(({ layer, features }) =>
          `<option value="${escHtml(layer.id)}"${layer.id === target ? " selected" : ""}>${escHtml(layer.title)} · ${features.length}</option>`).join("")}</select></label>
        <div id="select-pane-expression" class="select-pane">
          <label class="select-row">Условие<input type="text" id="select-expr" placeholder="этажность >= 5 и зона like 'Ж%'" autocomplete="off"></label>
          <div class="select-fields" id="select-fields"></div>
          <p class="select-hint">Поля пишутся именем, значения в кавычках. Доступны <b>= != &lt; &gt;</b>, <b>и</b>, <b>или</b>, <b>не</b>, <b>like</b>, <b>$area</b>, <b>$length</b>.</p>
        </div>
        <div id="select-pane-location" class="select-pane">
          <label class="select-row">Условие<select id="select-predicate">${Object.entries(PREDICATES).map(([key, meta]) =>
            `<option value="${key}">${meta.label}</option>`).join("")}</select></label>
          <label class="select-row">Объекты слоя<select id="select-reference">${items.map(({ layer, features }) =>
            `<option value="${escHtml(layer.id)}"${layer.id === reference ? " selected" : ""}>${escHtml(layer.title)} · ${features.length}</option>`).join("")}</select></label>
          <label class="chk"><input type="checkbox" id="select-reference-selected">Только выделенные объекты этого слоя <span id="select-reference-count"></span></label>
          <label class="select-row" id="select-distance-row" hidden>Расстояние, м<input type="number" id="select-distance" min="0" step="1" value="50"></label>
        </div>
        <label class="select-row">Что делать с выборкой<select id="select-mode">${Object.entries(MODES).map(([key, label]) =>
          `<option value="${key}">${label}</option>`).join("")}</select></label>
        <div class="select-summary" id="select-summary" role="status" aria-live="polite"></div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" id="select-cancel">Закрыть</button><button type="button" id="select-run" class="primary">Выбрать</button></div>
    </div>`;
    document.body.appendChild(overlay);

    let current = tab;
    const summary = overlay.querySelector("#select-summary");
    const layerSelect = $("select-layer");
    const item = id => items.find(entry => entry.layer.id === id);

    const renderFields = () => {
      const layer = item(layerSelect.value)?.layer;
      const columns = typeof attrColumns === "function" ? attrColumns(layer).filter(c => !c.virtual) : [];
      $("select-fields").innerHTML = columns.slice(0, 12).map(column =>
        `<button type="button" class="select-field" data-field="${escHtml(column.name)}">${escHtml(column.label || column.name)}</button>`).join("");
      $("select-fields").querySelectorAll(".select-field").forEach(button =>
        button.addEventListener("click", () => {
          const input = $("select-expr");
          const at = input.selectionStart ?? input.value.length;
          input.value = input.value.slice(0, at) + button.dataset.field + input.value.slice(at);
          input.focus();
          input.selectionStart = input.selectionEnd = at + button.dataset.field.length;
          update();
        }));
    };

    const update = () => {
      overlay.querySelectorAll("[data-select-tab]").forEach(button => {
        const on = button.dataset.selectTab === current;
        button.setAttribute("aria-selected", String(on));
        button.classList.toggle("active", on);
      });
      $("select-pane-expression").hidden = current !== "expression";
      $("select-pane-location").hidden = current !== "location";
      $("select-distance-row").hidden = $("select-predicate").value !== "distance";
      const referenceLayer = item($("select-reference").value)?.layer;
      const selectedInReference = referenceLayer
        ? state.features.filter(f => layerOf(f) === referenceLayer && state.selectedIds.has(f.id)).length : 0;
      $("select-reference-selected").disabled = !selectedInReference;
      if (!selectedInReference) $("select-reference-selected").checked = false;
      $("select-reference-count").textContent = selectedInReference ? `(${selectedInReference})` : "";
      const layer = item(layerSelect.value);
      summary.classList.remove("error");
      summary.innerHTML = `<b>${escHtml(layer?.layer.title || "")}</b><span>${layer?.features.length || 0} объектов в слое · выбрано сейчас ${state.selectedIds.size}</span>`;
    };

    overlay.querySelectorAll("[data-select-tab]").forEach(button =>
      button.addEventListener("click", () => { current = button.dataset.selectTab; update(); }));
    layerSelect.addEventListener("change", () => { renderFields(); update(); });
    $("select-predicate").addEventListener("change", update);
    $("select-reference").addEventListener("change", update);
    $("select-expr").addEventListener("input", update);

    const close = () => overlay.remove();
    $("select-cancel").addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
      if (event.key === "Enter" && event.target.id === "select-expr") $("select-run").click();
    });

    $("select-run").addEventListener("click", () => {
      const layer = item(layerSelect.value);
      if (!layer) return;
      const mode = $("select-mode").value;
      let found = [];
      try {
        if (current === "expression") {
          const expression = $("select-expr").value.trim();
          if (!expression) {
            summary.classList.add("error");
            summary.innerHTML = `<b>Условие пустое.</b><span>Например: этажность >= 5</span>`;
            return;
          }
          found = selectByExpression({ features: layer.features, expression });
        } else {
          const referenceLayer = item($("select-reference").value);
          if (!referenceLayer) return;
          const onlySelected = $("select-reference-selected").checked;
          const references = onlySelected
            ? referenceLayer.features.filter(f => state.selectedIds.has(f.id))
            : referenceLayer.features;
          found = selectByLocation({ features: layer.features, references,
            predicate: $("select-predicate").value,
            distance: Math.max(0, Number($("select-distance").value) || 0) });
        }
      } catch (error) {
        summary.classList.add("error");
        summary.innerHTML = `<b>Не удалось разобрать условие.</b><span>${escHtml(String(error.message || error).slice(0, 160))}</span>`;
        return;
      }
      const ids = combine(mode, state.selectedIds, found);
      setSelection([...ids]);
      draw();
      summary.classList.toggle("error", !ids.size);
      summary.innerHTML = ids.size
        ? `<b>Найдено ${found.length}.</b><span>Выбрано ${ids.size} — ${MODES[mode]}</span>`
        : `<b>Ничего не выбрано.</b><span>Проверьте условие и слой</span>`;
    });

    renderFields();
    update();
    // фокус отложен на кадр, а окно к тому моменту могли уже закрыть (Escape
    // сразу после открытия) — тогда элемента нет, и без проверки это вылезало
    // человеку красной полосой «Ошибка интерфейса»
    setTimeout(() => {
      const first = overlay.querySelector(current === "expression" ? "#select-expr" : "#select-predicate");
      if (first && first.isConnected) first.focus();
    }, 0);
  }

  root.openSelectBy = openSelectBy;
  const trigger = $("btn-select-by");
  if (trigger) trigger.addEventListener("click", () => openSelectBy("expression"));
})(typeof window !== "undefined" ? window : globalThis);
