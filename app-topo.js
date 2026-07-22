// Проверка топологии — как «Топологический чекер» и «Проверка геометрии» в QGIS.
//
// Зачем. Функциональные зоны, границы и ограничения обязаны стыковаться без
// щелей и не залезать друг на друга: щель между зонами — это территория,
// которая не попала ни в один ТЭП, перекрытие — площадь, посчитанная дважды.
// Глазом на выгрузке в десятки тысяч объектов такое не находится.
//
// Устройство. Ядро (проверки) — чистые функции над списком объектов, работают
// в Node и покрыты тестом; интерфейс поднимается только в браузере. Тяжёлые
// операции разбиты на кадры и отменяются, как в геообработке.
(function (root) {
  "use strict";

  const V = root.GRADO_VECTOR || {};
  const pc = root.polygonClipping;
  const EPS = 1e-9;

  const KINDS = {
    overlap: { label: "Перекрытия", one: "перекрытие",
      help: "Полигоны одного слоя накладываются друг на друга — площадь считается дважды." },
    gap: { label: "Щели", one: "щель",
      help: "Между полигонами осталась незакрытая территория: она не попадёт ни в один ТЭП." },
    duplicate: { label: "Дубликаты", one: "дубликат",
      help: "Совпадающие контуры: чаще всего след повторного импорта." },
    self: { label: "Самопересечения", one: "самопересечение",
      help: "Контур пересекает сам себя — площадь и обрезка на таком объекте недостоверны." },
  };

  // площадь перекрытия ниже этой не считается ошибкой: у выгрузок портала
  // соседние зоны сходятся с расхождением в миллиметры
  const DEFAULTS = { overlapMinArea: 0.5, gapMaxArea: 1000, dupTol: 0.001, maxIssues: 500 };

  function abortError() {
    const error = new Error("Проверка остановлена");
    error.name = "AbortError";
    return error;
  }
  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

  function ringArea(ring) {
    if (typeof V.ringArea === "function") return V.ringArea(ring);
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
  }

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
  const boundsHit = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
  const boundsCenter = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

  // объект проверки: геометрия для polygon-clipping + габарит для отбора пар
  function prepare(features) {
    const items = [];
    for (const feature of features) {
      if (!feature || !Array.isArray(feature.ring) || feature.ring.length < 3) continue;
      const geometry = typeof V.featureGeometry === "function" ? V.featureGeometry(feature) : null;
      items.push({ feature, geometry, bounds: boundsOf(feature.ring) });
    }
    return items;
  }

  // Пары кандидатов берутся через сетку по габаритам: полный перебор на 20 тысяч
  // зон — это 200 млн пар, вкладка не доживает. Ячейка — по среднему габариту,
  // чтобы крупный объект не размазался на пол-сетки.
  function candidatePairs(items) {
    if (items.length < 2) return [];
    let sum = 0;
    for (const item of items) sum += (item.bounds[2] - item.bounds[0]) + (item.bounds[3] - item.bounds[1]);
    const cellSize = Math.max(sum / (2 * items.length), 1e-6);
    const cells = new Map();
    const key = (cx, cy) => cx + "_" + cy;
    items.forEach((item, index) => {
      const cx0 = Math.floor(item.bounds[0] / cellSize), cx1 = Math.floor(item.bounds[2] / cellSize);
      const cy0 = Math.floor(item.bounds[1] / cellSize), cy1 = Math.floor(item.bounds[3] / cellSize);
      // объект шире 64 ячеек по стороне кладём в общий «крупный» список: иначе
      // одна городская граница засеет всю сетку
      if ((cx1 - cx0) > 64 || (cy1 - cy0) > 64) {
        let big = cells.get("big"); if (!big) cells.set("big", big = []);
        big.push(index);
        return;
      }
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy);
          let bucket = cells.get(k); if (!bucket) cells.set(k, bucket = []);
          bucket.push(index);
        }
    });
    const big = cells.get("big") || [];
    const seen = new Set();
    const pairs = [];
    const add = (i, j) => {
      const a = Math.min(i, j), b = Math.max(i, j);
      const k = a * items.length + b;
      if (seen.has(k)) return;
      seen.add(k);
      if (boundsHit(items[a].bounds, items[b].bounds)) pairs.push([a, b]);
    };
    for (const [k, bucket] of cells) {
      if (k === "big") continue;
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++) add(bucket[i], bucket[j]);
    }
    for (const index of big)
      for (let other = 0; other < items.length; other++) if (other !== index) add(index, other);
    return pairs;
  }

  async function findOverlaps(items, { minArea = DEFAULTS.overlapMinArea, signal, onProgress } = {}) {
    if (!pc || typeof pc.intersection !== "function") throw new Error("Модуль полигональных операций не загружен");
    // фильтруем ОДИН раз и дальше живём в этом же списке: индексы пар приходят
    // из него. Раньше пары считались по отфильтрованному, а разыменовывались по
    // исходному — на слое с самопересечением (у восьмёрки нулевая площадь,
    // геометрии нет) индексы разъезжались и часть перекрытий терялась молча.
    const ready = items.filter(item => item.geometry);
    const pairs = candidatePairs(ready);
    const issues = [];
    for (let i = 0; i < pairs.length; i++) {
      if (signal?.aborted) throw abortError();
      const [a, b] = pairs[i];
      const first = ready[a], second = ready[b];
      // Отсев до тяжёлой операции: пересечение полигонов не может быть больше
      // пересечения их габаритов. В слое покрытия почти все пары — соседи по
      // общей границе, у них габариты пересекаются полоской нулевой площади.
      // Без этого 5000 стыкующихся зон считались минутами: каждая пара уходила
      // в polygon-clipping ради заведомого нуля.
      const boxWidth = Math.min(first.bounds[2], second.bounds[2]) - Math.max(first.bounds[0], second.bounds[0]);
      const boxHeight = Math.min(first.bounds[3], second.bounds[3]) - Math.max(first.bounds[1], second.bounds[1]);
      if (boxWidth <= 0 || boxHeight <= 0 || boxWidth * boxHeight <= minArea) {
        onProgress?.({ done: i + 1, total: pairs.length, phase: "Поиск перекрытий" });
        continue;
      }
      const parts = pc.intersection(first.geometry, second.geometry);
      const area = typeof V.geometryArea === "function" ? V.geometryArea(parts) : 0;
      if (area > minArea) {
        const rings = (typeof V.geometryParts === "function" ? V.geometryParts(parts) : []).map(part => part.ring);
        issues.push({ kind: "overlap", area, rings,
          featureIds: [first.feature.id, second.feature.id],
          at: rings.length ? boundsCenter(boundsOf(rings[0])) : boundsCenter(first.bounds) });
      }
      onProgress?.({ done: i + 1, total: pairs.length, phase: "Поиск перекрытий" });
      if (i % 200 === 199) await yieldFrame();
    }
    return issues;
  }

  // Щель — дыра в объединении слоя. Крупная дыра обычно законна (незастроенная
  // территория внутри квартала), поэтому есть порог площади.
  async function findGaps(items, { maxArea = DEFAULTS.gapMaxArea, signal, onProgress } = {}) {
    if (typeof V.unionMany !== "function") throw new Error("Модуль полигональных операций не загружен");
    const geometries = items.map(item => item.geometry).filter(Boolean);
    if (geometries.length < 2) return [];
    onProgress?.({ done: 0, total: 1, phase: "Объединение контуров" });
    const merged = V.unionMany(geometries);
    if (signal?.aborted) throw abortError();
    const issues = [];
    for (const polygon of merged || []) {
      for (let i = 1; i < polygon.length; i++) {
        const ring = polygon[i];
        const area = Math.abs(ringArea(ring));
        if (area <= EPS || area > maxArea) continue;
        issues.push({ kind: "gap", area, rings: [ring], featureIds: [],
          at: boundsCenter(boundsOf(ring)) });
      }
    }
    onProgress?.({ done: 1, total: 1, phase: "Объединение контуров" });
    return issues;
  }

  // Ключ контура не зависит ни от точки начала обхода, ни от его направления:
  // импортированный второй раз объект приходит с тем же контуром, но начинать
  // может с другой вершины.
  function ringKey(points, tol = DEFAULTS.dupTol) {
    const q = [];
    for (const p of points) {
      const s = `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
      if (s !== q[q.length - 1]) q.push(s);
    }
    if (q.length > 1 && q[0] === q[q.length - 1]) q.pop();
    if (!q.length) return "";
    const rotate = arr => {
      let best = 0;
      for (let i = 1; i < arr.length; i++) if (arr[i] < arr[best]) best = i;
      return arr.slice(best).concat(arr.slice(0, best));
    };
    const forward = rotate(q).join(";");
    const backward = rotate([...q].reverse()).join(";");
    return forward < backward ? forward : backward;
  }

  function findDuplicates(items, { tol = DEFAULTS.dupTol } = {}) {
    const groups = new Map();
    for (const item of items) {
      const key = ringKey(item.feature.ring, tol);
      if (!key) continue;
      let group = groups.get(key); if (!group) groups.set(key, group = []);
      group.push(item);
    }
    const issues = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      issues.push({ kind: "duplicate", area: Math.abs(ringArea(group[0].feature.ring)),
        rings: [group[0].feature.ring], featureIds: group.map(item => item.feature.id),
        at: boundsCenter(group[0].bounds), count: group.length });
    }
    return issues;
  }

  function segmentCross(p1, p2, p3, p4) {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return null;          // параллельны или совпали
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
    // концы не считаем: соседние рёбра контура всегда делят вершину
    if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
    return [p1[0] + t * d1x, p1[1] + t * d1y];
  }

  // Контуры городских выгрузок бывают в тысячи вершин, поэтому рёбра
  // раскладываются по сетке — полный перебор пар здесь так же нежизнеспособен.
  function selfIntersections(points, cap = 12) {
    const pts = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > EPS || Math.abs(last[1] - p[1]) > EPS) pts.push(p);
    }
    if (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < EPS
        && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < EPS) pts.pop();
    const n = pts.length;
    if (n < 4) return [];
    const segs = [];
    for (let i = 0; i < n; i++) segs.push([pts[i], pts[(i + 1) % n], i]);
    const bounds = boundsOf(pts);
    const diag = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) || 1;
    const cellSize = Math.max(diag / Math.max(8, Math.sqrt(n)), 1e-6);
    const cells = new Map();
    for (const seg of segs) {
      const cx0 = Math.floor(Math.min(seg[0][0], seg[1][0]) / cellSize);
      const cx1 = Math.floor(Math.max(seg[0][0], seg[1][0]) / cellSize);
      const cy0 = Math.floor(Math.min(seg[0][1], seg[1][1]) / cellSize);
      const cy1 = Math.floor(Math.max(seg[0][1], seg[1][1]) / cellSize);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = cx + "_" + cy;
          let bucket = cells.get(k); if (!bucket) cells.set(k, bucket = []);
          bucket.push(seg);
        }
    }
    const out = [];
    const seen = new Set();
    for (const bucket of cells.values()) {
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i], b = bucket[j];
          const di = Math.abs(a[2] - b[2]);
          if (di <= 1 || di >= n - 1) continue;        // соседние рёбра пропускаем
          const key = Math.min(a[2], b[2]) * n + Math.max(a[2], b[2]);
          if (seen.has(key)) continue;
          seen.add(key);
          const point = segmentCross(a[0], a[1], b[0], b[1]);
          if (point) out.push(point);
          if (out.length >= cap) return out;
        }
    }
    return out;
  }

  function findSelfIntersections(items, { cap = 12 } = {}) {
    const issues = [];
    for (const item of items) {
      const rings = [item.feature.ring, ...(item.feature.holes || [])];
      const points = [];
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4) continue;
        points.push(...selfIntersections(ring, cap));
        if (points.length >= cap) break;
      }
      if (points.length) issues.push({ kind: "self", area: Math.abs(ringArea(item.feature.ring)),
        rings: [], points, featureIds: [item.feature.id], at: points[0] });
    }
    return issues;
  }

  const ORDER = { overlap: 0, gap: 1, self: 2, duplicate: 3 };

  async function runChecks({ features = [], checks = {}, options = {}, signal, onProgress } = {}) {
    const items = prepare(features);
    const opts = { ...DEFAULTS, ...options };
    let issues = [];
    const wanted = ["overlap", "gap", "duplicate", "self"].filter(kind => checks[kind]);
    let step = 0;
    const report = phase => ({ done, total }) =>
      onProgress?.({ done: step + (total ? done / total : 0), total: wanted.length, phase });
    for (const kind of wanted) {
      if (signal?.aborted) throw abortError();
      if (kind === "overlap")
        issues = issues.concat(await findOverlaps(items,
          { minArea: opts.overlapMinArea, signal, onProgress: report(KINDS.overlap.label) }));
      if (kind === "gap")
        issues = issues.concat(await findGaps(items,
          { maxArea: opts.gapMaxArea, signal, onProgress: report(KINDS.gap.label) }));
      if (kind === "duplicate") {
        report(KINDS.duplicate.label)({ done: 0, total: 1 });
        issues = issues.concat(findDuplicates(items, { tol: opts.dupTol }));
      }
      if (kind === "self") {
        report(KINDS.self.label)({ done: 0, total: 1 });
        issues = issues.concat(findSelfIntersections(items));
      }
      step += 1;
      await yieldFrame();
    }
    issues.sort((a, b) => (ORDER[a.kind] - ORDER[b.kind])
      || (a.kind === "gap" ? a.area - b.area : b.area - a.area));
    const total = issues.length;
    const truncated = total > opts.maxIssues;
    return { issues: truncated ? issues.slice(0, opts.maxIssues) : issues, total, truncated,
      checked: items.length };
  }

  const api = { KINDS, DEFAULTS, prepare, candidatePairs, ringKey, selfIntersections,
    findOverlaps, findGaps, findDuplicates, findSelfIntersections, runChecks };
  root.GRADO_TOPO = api;

  if (typeof document === "undefined") return;

  // ---------- подсветка находок на холсте ----------
  // Находки живут в модуле, а не в state: это отчёт о проверке, он не должен
  // попадать ни в проект, ни в автосохранение, ни в отмену.
  let found = { issues: [], active: -1, show: true, layerId: null };

  function topoDrawOverlay(context) {
    if (!found.show || !found.issues.length || typeof w2s !== "function") return;
    context.save();
    const danger = cvColor("danger", "#c8442e");
    const warn = cvColor("warning", "#b7791f");
    found.issues.forEach((issue, index) => {
      const active = index === found.active;
      const color = issue.kind === "gap" ? warn : danger;
      context.lineWidth = active ? 2.4 : 1.4;
      context.strokeStyle = color;
      context.fillStyle = color + (active ? "55" : "2e");
      context.setLineDash(issue.kind === "gap" ? [6, 3] : []);
      for (const ring of issue.rings || []) {
        if (!ring || ring.length < 3) continue;
        context.beginPath();
        ring.forEach((point, i) => {
          const [sx, sy] = w2s(point[0], point[1]);
          if (i) context.lineTo(sx, sy); else context.moveTo(sx, sy);
        });
        context.closePath();
        context.fill();
        context.stroke();
      }
      for (const point of issue.points || []) {
        const [sx, sy] = w2s(point[0], point[1]);
        context.beginPath();
        context.arc(sx, sy, active ? 7 : 5, 0, 2 * Math.PI);
        context.stroke();
      }
      // у дубликата и самопересечения без контура — метка на месте находки
      if (!(issue.rings || []).length && !(issue.points || []).length && issue.at) {
        const [sx, sy] = w2s(issue.at[0], issue.at[1]);
        context.beginPath();
        context.arc(sx, sy, active ? 7 : 5, 0, 2 * Math.PI);
        context.stroke();
      }
    });
    context.restore();
  }
  root.topoDrawOverlay = topoDrawOverlay;

  function clearFound() {
    found = { issues: [], active: -1, show: true, layerId: null };
    draw();
  }
  root.topoClearFound = clearFound;

  // ---------- окно проверки ----------
  const $ = id => document.getElementById(id);
  const fmtArea = value => value >= 10000
    ? `${(value / 10000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: value < 10 ? 2 : 0 })} м²`;

  const polygonLayers = () => LAYERS_V2.map(layer => ({
    layer,
    features: state.features.filter(feature => layerOf(feature) === layer && Array.isArray(feature.ring)),
  })).filter(item => item.features.length > 1);

  const SETTINGS_KEY = "grado-topo-check";
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (saved && typeof saved === "object") return saved;
    } catch (error) {}
    return { overlap: true, gap: true, duplicate: true, self: true,
      overlapMinArea: DEFAULTS.overlapMinArea, gapMaxArea: DEFAULTS.gapMaxArea };
  }
  function saveSettings(value) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch (error) {}
  }

  function issueTitle(issue) {
    const names = issue.featureIds
      .map(id => state.features.find(feature => feature.id === id))
      .filter(Boolean)
      .map(feature => featureTitle(feature));
    if (issue.kind === "overlap") return `${fmtArea(issue.area)} · ${names.join(" и ") || "два объекта"}`;
    if (issue.kind === "gap") return `${fmtArea(issue.area)} · незакрытая территория`;
    if (issue.kind === "duplicate")
      return `${ruCount(issue.count, "совпадающий контур", "совпадающих контура", "совпадающих контуров")} · ${names[0] || "объект"}`;
    return `${ruCount(issue.points.length, "точка", "точки", "точек")} пересечения · ${names[0] || "объект"}`;
  }

  function featureTitle(feature) {
    const props = feature.props || {};
    const name = props.name || props.title || props.NAME || props.zone || props.index || "";
    return String(name).trim() ? String(name).trim().slice(0, 40) : `объект №${feature.id}`;
  }

  function focusIssue(index) {
    const issue = found.issues[index];
    if (!issue) return;
    found.active = index;
    const ring = (issue.rings || [])[0];
    if (ring && ring.length > 2) fitPoints(ring, 0.35);
    else if (issue.at) fitBox(issue.at[0] - 30, issue.at[1] - 30, issue.at[0] + 30, issue.at[1] + 30, 0.6);
    const ids = issue.featureIds.filter(id => state.features.some(feature => feature.id === id));
    if (ids.length) setSelection(ids); else clearSelection();
    draw();
  }
  root.topoFocusIssue = focusIssue;

  function openTopologyCheck() {
    closePopups();
    const items = polygonLayers();
    const settings = loadSettings();
    const activeLayer = LAYERS_V2.find(layer => layer.id === state.activeLayerId);
    const coverage = items.find(item => item.layer.topology === "coverage");
    const preferred = items.find(item => item.layer === activeLayer)?.layer.id
      || coverage?.layer.id || items[0]?.layer.id || "";

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal topo-modal" role="dialog" aria-modal="true" aria-labelledby="topo-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Качество данных</span><span id="topo-title">Проверка топологии</span></div>
        <button class="modal-x" aria-label="Закрыть проверку топологии"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body topo-body">
        <p class="topo-intro">Проверка ничего не меняет в проекте: она показывает, где полигоны слоя не стыкуются. Щель между зонами не попадает ни в один ТЭП, перекрытие считается дважды.</p>
        <label class="topo-layer">Слой<select id="topo-layer">${items.map(({ layer, features }) =>
          `<option value="${escHtml(layer.id)}"${layer.id === preferred ? " selected" : ""}>${escHtml(layer.title)} · ${features.length}</option>`).join("")}</select></label>
        <div class="topo-checks" role="group" aria-label="Что проверять">
          ${Object.entries(KINDS).map(([kind, meta]) => `<label class="chk topo-check"><input type="checkbox" data-topo-check="${kind}"${settings[kind] === false ? "" : " checked"}>
            <span><b>${meta.label}</b><small>${meta.help}</small></span></label>`).join("")}
        </div>
        <div class="topo-tolerances">
          <label>Перекрытие от, м²<input type="number" id="topo-overlap-min" min="0" step="0.1" value="${Number(settings.overlapMinArea) || DEFAULTS.overlapMinArea}"></label>
          <label>Щель до, м²<input type="number" id="topo-gap-max" min="1" step="10" value="${Number(settings.gapMaxArea) || DEFAULTS.gapMaxArea}"></label>
        </div>
        <div class="topo-summary" id="topo-summary" role="status" aria-live="polite"></div>
        <div class="vector-progress" id="topo-progress" hidden><div><span id="topo-progress-label">Подготовка…</span><b id="topo-progress-value">0%</b></div><progress id="topo-progress-bar" max="100" value="0"></progress></div>
        <div class="topo-results" id="topo-results" hidden></div>
      </div>
      <div class="modal-actions"><button type="button" id="topo-clear">Убрать подсветку</button><span class="spacer"></span>
        <button type="button" id="topo-cancel">Закрыть</button><button type="button" id="topo-run" class="primary">Проверить</button></div>
    </div>`;
    document.body.appendChild(overlay);

    let controller = null;
    const layerSelect = overlay.querySelector("#topo-layer");
    const runButton = overlay.querySelector("#topo-run");
    const cancelButton = overlay.querySelector("#topo-cancel");
    const summary = overlay.querySelector("#topo-summary");
    const results = overlay.querySelector("#topo-results");
    const checkOf = kind => overlay.querySelector(`[data-topo-check="${kind}"]`);
    const currentChecks = () => Object.fromEntries(Object.keys(KINDS).map(kind => [kind, checkOf(kind).checked]));
    const layerItem = () => items.find(item => item.layer.id === layerSelect.value);

    const update = () => {
      const item = layerItem();
      const checks = currentChecks();
      const any = Object.values(checks).some(Boolean);
      runButton.disabled = !item || !any;
      summary.classList.remove("error");
      summary.innerHTML = !items.length
        ? `<b>Нет слоёв с двумя и более полигонами.</b><span>Проверять стыковку не на чем.</span>`
        : !any ? `<b>Выберите хотя бы одну проверку.</b><span></span>`
        : `<b>${escHtml(item.layer.title)}</b><span>${item.features.length} полигонов${item.layer.topology === "coverage" ? " · слой покрытия" : ""}</span>`;
    };
    const setBusy = busy => {
      overlay.querySelectorAll("select,input").forEach(element => element.disabled = busy);
      runButton.disabled = busy;
      cancelButton.textContent = busy ? "Остановить" : "Закрыть";
      overlay.querySelector(".modal-x").disabled = busy;
      overlay.querySelector("#topo-progress").hidden = !busy;
    };
    const close = () => {
      if (controller) { controller.abort(); return; }
      overlay.remove();
    };

    const renderResults = report => {
      results.hidden = !report.issues.length;
      if (!report.issues.length) return;
      const groups = new Map();
      report.issues.forEach((issue, index) => {
        let group = groups.get(issue.kind); if (!group) groups.set(issue.kind, group = []);
        group.push({ issue, index });
      });
      results.innerHTML = [...groups].map(([kind, rows]) =>
        `<div class="topo-group"><div class="topo-group-head">${KINDS[kind].label} · ${rows.length}</div>
          ${rows.map(({ issue, index }) =>
            `<button type="button" class="topo-row" data-topo-issue="${index}">
              <span class="topo-dot topo-dot-${kind}" aria-hidden="true"></span>
              <span class="topo-row-text">${escHtml(issueTitle(issue))}</span>
            </button>`).join("")}</div>`).join("");
      results.querySelectorAll("[data-topo-issue]").forEach(button => button.addEventListener("click", () => {
        const index = Number(button.dataset.topoIssue);
        results.querySelectorAll(".topo-row").forEach(row => row.classList.toggle("active", row === button));
        focusIssue(index);
      }));
    };

    layerSelect.addEventListener("change", update);
    overlay.querySelectorAll("[data-topo-check]").forEach(box => box.addEventListener("change", update));
    cancelButton.addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelector("#topo-clear").addEventListener("click", () => {
      clearFound();
      results.hidden = true;
      results.innerHTML = "";
      update();
    });

    runButton.addEventListener("click", async () => {
      const item = layerItem();
      if (!item) return;
      const checks = currentChecks();
      const overlapMinArea = Math.max(0, Number(overlay.querySelector("#topo-overlap-min").value) || 0);
      const gapMaxArea = Math.max(1, Number(overlay.querySelector("#topo-gap-max").value) || DEFAULTS.gapMaxArea);
      saveSettings({ ...checks, overlapMinArea, gapMaxArea });
      controller = new AbortController();
      setBusy(true);
      summary.classList.remove("error");
      summary.innerHTML = `<b>Проверяем «${escHtml(item.layer.title)}»…</b><span>${item.features.length} полигонов</span>`;
      try {
        const report = await runChecks({ features: item.features, checks,
          options: { overlapMinArea, gapMaxArea }, signal: controller.signal,
          onProgress: ({ done, total, phase }) => {
            const value = total ? Math.round(done / total * 100) : 0;
            overlay.querySelector("#topo-progress-label").textContent = phase;
            overlay.querySelector("#topo-progress-value").textContent = `${value}%`;
            overlay.querySelector("#topo-progress-bar").value = value;
          } });
        if (controller.signal.aborted) throw abortError();
        controller = null;
        setBusy(false);
        found = { issues: report.issues, active: -1, show: true, layerId: item.layer.id };
        draw();
        renderResults(report);
        summary.classList.toggle("error", report.total > 0);
        summary.innerHTML = report.total
          ? `<b>Найдено ${report.total}${report.truncated ? `, показаны первые ${report.issues.length}` : ""}.</b><span>Строка списка подводит к месту на чертеже.</span>`
          : `<b>Ошибок не найдено.</b><span>Слой «${escHtml(item.layer.title)}» стыкуется без щелей и перекрытий.</span>`;
      } catch (error) {
        const cancelled = error?.name === "AbortError";
        controller = null;
        setBusy(false);
        update();
        summary.classList.toggle("error", !cancelled);
        summary.innerHTML = cancelled
          ? `<b>Проверка остановлена.</b><span>Проект не изменён.</span>`
          : `<b>Не удалось проверить слой.</b><span>${escHtml(String(error.message || error).slice(0, 180))}</span>`;
      }
    });

    update();
    setTimeout(() => layerSelect.focus(), 0);
  }

  root.openTopologyCheck = openTopologyCheck;
  const trigger = $("btn-topo-check");
  if (trigger) trigger.addEventListener("click", openTopologyCheck);
})(typeof window !== "undefined" ? window : globalThis);
