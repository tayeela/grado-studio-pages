// ГРАДО Студия · часть 12 из 14 (грузится после app-dialogs.js).
// правка фигур: добавление, разрезание, объединение,
// трансформации выделения, хит-тест
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- добавление и правка фигур ----------
// layerId (не kind!) — иначе при двух слоях одного вида (built-in + созданный
// в панели) объект всегда падал бы в первый слой этого kind, игнорируя
// реально активный слой (тот же класс бага, что был в MODEL-01 на бэкенде).
function addFeature(layerId, geom) {
  const L = LAYER_BY_ID[layerId];
  // Аннотационные слои закрыты для рисования — кроме тех, у которых ЕСТЬ свой
  // инструмент: размер и выноска именно так и создаются. Признак берём у слоя,
  // а не списком видов: заведут третью аннотацию — она заработает сама.
  const рисуемаяАннотация = L && L.annotation && !!L.tool;
  if (!L || L.locked || L.import_only || (L.annotation && !рисуемаяАннотация)) {
    toast(L?.locked ? `Слой «${L.title}» заблокирован — объект не создан`
      : "Выберите доступный проектный слой", "warn");
    return null;
  }
  snapshot();
  const f = { id: state.nextId++, layer_id: layerId,
             props: L ? L.defaults() : {}, ...geom };
  // значения по умолчанию произвольных полей слоя — на новый объект
  for (const cf of (L && L.fields) || [])
    if (cf.default != null && f.props[cf.name] == null) f.props[cf.name] = cf.default;
  upgradeFeature(f);
  state.features.push(f);
  selectOne(f.id);
  afterChange();
  return f;
}
// убрать подряд совпадающие точки (в пределах допуска) — защита от вырожденной
// геометрии: кольцо нулевой площади, линия из одинаковых точек, дубль конца/начала
function dedupePts(pts, closed) {
  const eps = 1e-6, out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push([p[0], p[1]]);
  }
  if (closed && out.length > 1 &&
      Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps)
    out.pop();
  return out;
}
function finishDrawing() {
  const d = state.drawing;
  if (state.tool === "split") {
    const pts = d && Array.isArray(d.pts) ? dedupePts(d.pts, false) : null;
    state.drawing = null; state.typed = "";
    if (pts && pts.length >= 2) splitByLine(pts);
    else { toast("Нужны хотя бы две точки линии разреза", "warn"); draw(); }
    return;
  }
  if (state.tool === "reshape") {
    const pts = d && Array.isArray(d.pts) ? dedupePts(d.pts, false) : null;
    state.drawing = null; state.typed = "";
    if (pts && pts.length >= 2) reshapeByLine(pts);
    else { toast("Нужны хотя бы две точки новой формы", "warn"); draw(); }
    return;
  }
  const L = activeLayer();
  if (d && !isDrawableLayer(L)) toast(L?.locked
    ? `Слой «${L.title}» заблокирован — рисование отменено`
    : "Активный слой недоступен — создайте или выберите проектный слой", "warn");
  if (!d || !isDrawableLayer(L)) { state.drawing = null; return; }
  const geom = TOOL_GEOM[state.tool];
  const pts = Array.isArray(d.pts) ? d.pts : null;
  if (geom === "polygon" && pts) {
    const r = dedupePts(pts, true);
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e-6) addFeature(L.id, { ring: r });
    else { toast("Слишком мало различных точек для полигона", "warn"); state.drawing = null; draw(); return; }
  } else if (geom === "polyline" && state.tool !== "dim" && pts) {
    const ln = dedupePts(pts, false);
    if (ln.length >= 2) addFeature(L.id, { line: ln });
    else { toast("Линия из совпадающих точек — не создана", "warn"); state.drawing = null; draw(); return; }
  } else if (state.tool === "arc" && pts && pts.length >= 3) {
    const a = arcFrom3Pts(pts[0], pts[1], pts[2]);
    if (a) addFeature(L.id, { arc: a });
  } else if (state.tool === "circle" && d.center) {
    const r = d.r || (state.mouse ? Math.hypot(state.mouse[0] - d.center[0], state.mouse[1] - d.center[1]) : 0);
    if (r > 0.5) addFeature(L.id, { circle: { cx: d.center[0], cy: d.center[1], r } });
  }
  state.drawing = null; state.typed = "";
  draw();
}

// ---------- разрезать и объединить (правка геометрии, как в QGIS) ----------
// Инструмент «Разрезать»: человек чертит ломаную, все пересечённые объекты
// доступных слоёв делятся по ней. Атрибуты достаются каждой части — часть
// квартала остаётся тем же кварталом, пока человек не скажет иначе.
function editableFeature(f) {
  const L = layerOf(f);
  return !!L && !L.locked && !L.annotation && L.visible !== false && !isHidden(f);
}

function splitByLine(cut) {
  const E = window.GRADO_EDIT;
  if (!E) { toast("Модуль правки геометрии не загружен", "warn"); return; }
  // Область реза — как в QGIS: есть выбор, режем выбранное; нет выбора —
  // только активный слой. Резать весь проект одной линией нельзя: на городской
  // выгрузке под линией окажутся зоны, участки, здания и красные линии разом.
  const active = activeLayer();
  const scope = state.selectedIds.size
    ? state.features.filter(f => state.selectedIds.has(f.id) && editableFeature(f))
    : state.features.filter(f => f.layer_id === (active && active.id) && editableFeature(f));
  if (!scope.length) {
    toast(state.selectedIds.size ? "Выбранные объекты нельзя резать (слой заблокирован или скрыт)"
      : "Нечего резать: выберите объекты или сделайте активным слой с ними", "warn");
    draw();
    return;
  }
  const made = [], removed = new Set();
  let blocked = null;
  for (const f of scope) {
    if (Array.isArray(f.ring)) {
      const result = E.splitPolygon(f, cut);
      if (!result.parts.length) { if (result.reason && result.reason !== "линия не пересекает объект") blocked = result.reason; continue; }
      removed.add(f.id);
      for (const part of result.parts) made.push({ src: f, geom: { ring: part.ring, holes: part.holes.length ? part.holes : undefined } });
    } else if (Array.isArray(f.line)) {
      const result = E.splitLine(f.line, cut);
      if (!result.parts.length) continue;
      removed.add(f.id);
      for (const part of result.parts) made.push({ src: f, geom: { line: part } });
    }
  }
  if (!made.length) {
    toast(blocked ? `Разрез невозможен: ${blocked}` : "Линия разреза никого не пересекла", "warn");
    draw();
    return;
  }
  snapshot();
  state.features = state.features.filter(f => !removed.has(f.id));
  const ids = [];
  for (const { src, geom } of made) {
    const f = { id: state.nextId++, layer_id: src.layer_id, props: cloneVariantValue(src.props || {}), ...geom };
    if (src.style_id) f.style_id = src.style_id;
    if (src.kind) f.kind = src.kind;
    upgradeFeature(f);
    state.features.push(f);
    ids.push(f.id);
  }
  setSelection(ids);
  afterChange();
  toast(`Разрезано: ${ruCount(removed.size, "объект", "объекта", "объектов")} → ${made.length}`);
}

// «Изменить форму» (reshape): участок контура или линии между первым и
// последним пересечением с нарисованной ломаной заменяется на неё. Правится
// РОВНО один объект: если ломаная задевает несколько — просим выделить.
function reshapeByLine(cut) {
  const E = window.GRADO_EDIT;
  if (!E) { toast("Модуль правки геометрии не загружен", "warn"); return; }
  const scope = state.selectedIds.size
    ? state.features.filter(f => state.selectedIds.has(f.id) && editableFeature(f))
    : state.features.filter(f => editableFeature(f) && layerOf(f) === activeLayer());
  const results = [];
  for (const f of scope) {
    if (Array.isArray(f.ring)) {
      const r = E.reshapeRing(f.ring, cut);
      if (r.ring) results.push({ f, ring: r.ring });
    } else if (Array.isArray(f.line)) {
      const r = E.reshapeLine(f.line, cut);
      if (r.line) results.push({ f, line: r.line });
    }
  }
  if (!results.length) {
    toast(state.selectedIds.size
      ? "Линия должна пересечь выбранный объект минимум дважды"
      : "Линия должна дважды пересечь объект активного слоя", "warn");
    draw();
    return;
  }
  if (results.length > 1) {
    toast(`Ломаная задевает ${results.length} объектов — выделите один и повторите`, "warn");
    draw();
    return;
  }
  const { f, ring, line } = results[0];
  // вырез не должен съесть дыру: дыра вне нового контура — это уже не полигон
  if (ring && f.holes && f.holes.length) {
    const E2 = window.GRADO_EDIT;
    const lost = f.holes.some(hole => hole && hole.length > 2 &&
      !E2.pointInRing(hole[0][0], hole[0][1], ring));
    if (lost) { toast("Новая форма отрезает дыру полигона — сначала уберите дыру", "warn"); draw(); return; }
  }
  snapshot();
  if (ring) f.ring = ring; else f.line = line;
  selectOne(f.id);
  afterChange();
  toast(ring ? `Форма изменена: площадь ${fmtAreaHa(featureArea(f))}` : "Форма линии изменена");
}

// «Объединить»: выбранные полигоны одного слоя становятся одним объектом.
// Атрибуты берутся у первого выбранного — как в QGIS, где предлагают выбрать
// объект-источник; здесь источник виден в подтверждении.
function mergeSelectedPolygons() {
  const E = window.GRADO_EDIT;
  if (!E) { toast("Модуль правки геометрии не загружен", "warn"); return; }
  const picked = selectionFeatures().filter(f => Array.isArray(f.ring) && editableFeature(f));
  if (picked.length < 2) { toast("Выберите два и более полигона одного слоя", "warn"); return; }
  const layerIds = new Set(picked.map(f => f.layer_id));
  if (layerIds.size > 1) { toast("Объединять можно объекты одного слоя", "warn"); return; }
  const result = E.mergePolygons(picked);
  if (!result.part) { toast(`Не объединить: ${result.reason}`, "warn"); return; }
  snapshot();
  const keep = picked[0];
  const ids = new Set(picked.map(f => f.id));
  state.features = state.features.filter(f => !ids.has(f.id));
  const f = { id: state.nextId++, layer_id: keep.layer_id, props: cloneVariantValue(keep.props || {}),
    ring: result.part.ring };
  if (result.part.holes.length) f.holes = result.part.holes;
  if (keep.style_id) f.style_id = keep.style_id;
  if (keep.kind) f.kind = keep.kind;
  upgradeFeature(f);
  state.features.push(f);
  setSelection([f.id]);
  afterChange();
  toast(`Объединено ${ruCount(picked.length, "полигон", "полигона", "полигонов")} · атрибуты от «${featureLabelShort(keep)}»`);
}

// короткое имя объекта для сообщения — первое осмысленное значение атрибутов
function featureLabelShort(f) {
  const props = f.props || {};
  for (const key of ["name", "title", "zone_title", "purpose", "index", "cad_num"]) {
    const value = props[key];
    if (value != null && String(value).trim()) return String(value).trim().slice(0, 30);
  }
  return `объект №${f.id}`;
}

// Простой порт Arc.from_3pts для фронтенда (храним параметры + для рендера)
function arcFrom3Pts(p0, pm, p1) {
  const [x0,y0] = p0, [x1,y1] = pm, [x2,y2] = p1;
  const d1 = (x0-x1)*(x0-x2) + (y0-y1)*(y0-y2);
  const d2 = (x1-x0)*(x1-x2) + (y1-y0)*(y1-y2);
  const d3 = (x2-x0)*(x2-x1) + (y2-y0)*(y2-y1);
  const c = 2 * (x0*(y1-y2) + x1*(y2-y0) + x2*(y0-y1));
  if (Math.abs(c) < 1e-6) return null; // коллинеарны
  const cx = ((x0*x0 + y0*y0)*(y1-y2) + (x1*x1 + y1*y1)*(y2-y0) + (x2*x2 + y2*y2)*(y0-y1)) / c;
  const cy = ((x0*x0 + y0*y0)*(x2-x1) + (x1*x1 + y1*y1)*(x0-x2) + (x2*x2 + y2*y2)*(x1-x0)) / c;
  const r = Math.hypot(cx-x0, cy-y0);
  // направление развёртки — ЧЕРЕЗ среднюю точку (как в ядре Arc.from_3pts):
  // если середина в пределах CCW-развёртки к концу — идём против часовой,
  // иначе по часовой (длинная дуга). Раньше JS брал короткую дугу, игнорируя
  // середину — дуга >180° строилась неверно (короткой стороной).
  const a0 = Math.atan2(y0-cy, x0-cx);
  const a1 = Math.atan2(y2-cy, x2-cx);
  const am = Math.atan2(y1-cy, x1-cx);
  const TAU = 2*Math.PI;
  const ccwSweep = ((a1 - a0) % TAU + TAU) % TAU;
  const ccwMid = ((am - a0) % TAU + TAU) % TAU;
  const sweep = ccwMid <= ccwSweep ? ccwSweep : ccwSweep - TAU;
  return { cx, cy, r, a0, sweep };
}
// ---------- трансформации выделения (подобия: дуги/окружности сохраняются) --
// центр (пивот) трансформаций — центр габаритов выделения
function selectionPivot() {
  const pts = [];
  for (const f of selectionFeatures()) {
    if (f.circle) { const c = f.circle; pts.push([c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]); }
    else if (f.arc) { for (const p of featurePts(f)) pts.push(p); pts.push([f.arc.cx, f.arc.cy]); }
    else for (const p of featurePts(f)) pts.push(p);
  }
  if (!pts.length) return null;
  // однопроходный центр bbox (без Math.min(...spread) — краш при выделении
  // многих тысяч объектов, тот же лимит аргументов V8, что в fitPoints)
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  return [(minx + maxx) / 2, (miny + maxy) / 2];
}
// применить преобразование к выделению: pt — маппер точки, arcFn/circleFn —
// правка параметров дуги/окружности (центр, радиус, углы). snapshot один раз.
function transformSelection(pt, arcFn, circleFn) {
  const feats = selectionFeatures();
  if (!feats.length) return false;
  snapshot();
  for (const f of feats) {
    if (f.circle) circleFn(f.circle);
    else if (f.arc) arcFn(f.arc);
    else for (const p of featureMovablePts(f)) { const q = pt(p); p[0] = q[0]; p[1] = q[1]; }  // + дыры
  }
  afterChange();
  return true;
}
function rotateSelectionBy(deg) {
  const P = selectionPivot(); if (!P) return;
  const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const rp = ([x, y]) => { const dx = x - P[0], dy = y - P[1]; return [P[0] + dx * c - dy * s, P[1] + dx * s + dy * c]; };
  transformSelection(rp,
    a => { const nc = rp([a.cx, a.cy]); a.cx = nc[0]; a.cy = nc[1]; a.a0 += th; },
    cc => { const nc = rp([cc.cx, cc.cy]); cc.cx = nc[0]; cc.cy = nc[1]; });
}
function mirrorSelection(axis) {   // 'h' — лево/право (ось вертикальна), 'v' — верх/низ
  const P = selectionPivot(); if (!P) return;
  if (axis === "h") {
    transformSelection(([x, y]) => [2 * P[0] - x, y],
      a => { a.cx = 2 * P[0] - a.cx; a.a0 = Math.PI - a.a0; a.sweep = -a.sweep; },
      cc => { cc.cx = 2 * P[0] - cc.cx; });
  } else {
    transformSelection(([x, y]) => [x, 2 * P[1] - y],
      a => { a.cy = 2 * P[1] - a.cy; a.a0 = -a.a0; a.sweep = -a.sweep; },
      cc => { cc.cy = 2 * P[1] - cc.cy; });
  }
}
function rotateSelected() { rotateSelectionBy(90); }   // R — быстрый поворот 90° (теперь и группа)


// кнопки преобразований для панели свойств (одиночной и групповой)
function transformControlsHtml() {
  return `<div class="prop-sub">Преобразовать</div>
    <div class="xf-row">
      <button id="xf-rot" title="Инструмент «Поворот»: опорная точка, затем мышь или ввод угла на холсте">↻ Повернуть</button>
      <button id="xf-scale" title="Инструмент «Масштаб»: опорная точка, затем мышь или ввод коэффициента на холсте">⤢ Масштаб</button>
    </div>
    <div class="xf-row">
      <button id="xf-mirror" title="Инструмент «Зеркало»: две точки оси симметрии на холсте">⇋ Отразить осью</button>
    </div>
    <div class="xf-row">
      <button id="xf-mh" title="Быстро отразить лево ↔ право (вокруг центра)">↔ Л/П</button>
      <button id="xf-mv" title="Быстро отразить верх ↕ низ (вокруг центра)">↕ В/Н</button>
    </div>`;
}
function bindTransformControls() {
  const g = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  g("xf-rot", () => setTool("rotate")); g("xf-scale", () => setTool("scale"));
  g("xf-mirror", () => setTool("mirror"));
  g("xf-mh", () => mirrorSelection("h")); g("xf-mv", () => mirrorSelection("v"));
}
function duplicateSelected() {
  const f = selectedFeature();
  if (!f) return;
  const g = gridStep();
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = state.nextId++;
  if (copy.circle) {
    copy.circle.cx += g; copy.circle.cy -= g;
  } else if (copy.arc) {
    copy.arc.cx += g; copy.arc.cy -= g;
  } else {
    for (const p of featureMovablePts(copy)) { p[0] += g; p[1] -= g; }  // + дыры
  }
  snapshot();
  state.features.push(copy);
  state.selected = copy.id;
  afterChange();
}
function nudgeSelected(dx, dy) {   // стрелки — сдвиг ВСЕГО выделения (группа тоже)
  transformSelection(
    ([x, y]) => [x + dx, y + dy],
    a => { a.cx += dx; a.cy += dy; },
    cc => { cc.cx += dx; cc.cy += dy; });
}
function placeTypedPoint() {
  if (state.drawing && state.drawing.center != null) {
    // typed radius for circle
    const r = parseFloat(state.typed.replace(",", "."));
    if (isFinite(r) && r > 0) {
      const c = state.drawing.center;
      const L = activeLayer();
      if (L) addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
      state.drawing = null;
    }
    state.typed = "";
    draw();
    return;
  }
  // 3-point радиус для дуг при рисовании: при 2 точках (start, mid) typed = r, mouse как end
  if (state.drawing && state.drawing.pts && state.drawing.pts.length === 2 && state.tool === "arc") {
    const r = parseFloat(state.typed.replace(",", "."));
    if (isFinite(r) && r > 0) {
      const p0 = state.drawing.pts[0];
      const p2 = state.mouse;
      if (p2) {
        const d = Math.hypot(p2[0]-p0[0], p2[1]-p0[1]);
        if (d > 0 && d < 2 * r) {
          const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
          const vx = (p2[0] - p0[0]) / d, vy = (p2[1] - p0[1]) / d;
          const h = Math.sqrt(r * r - (d / 2) * (d / 2));
          const px = -vy, py = vx;
          const c1 = [mx + h * px, my + h * py];
          const c2 = [mx - h * px, my - h * py];
          const mid = state.drawing.pts[1];
          const d1 = Math.hypot(mid[0] - c1[0], mid[1] - c1[1]);
          const d2 = Math.hypot(mid[0] - c2[0], mid[1] - c2[1]);
          const c = d1 < d2 ? c1 : c2;
          const aa0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
          const aa2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
          let sw = aa2 - aa0;
          if (sw > Math.PI) sw -= 2 * Math.PI;
          if (sw < -Math.PI) sw += 2 * Math.PI;
          // snapshot() здесь не нужен: addFeature() уже фиксирует историю. Из-за
          // лишнего снимка в стеке оказывались два одинаковых состояния «до», и
          // первый Ctrl+Z визуально ничего не делал — дуга исчезала со второго.
          const L = activeLayer();
          if (L) addFeature(L.id, { arc: { cx: c[0], cy: c[1], r, a0: aa0, sweep: sw } });
          state.drawing = null;
          state.typed = "";
          draw();
          return;
        }
      }
    }
  }
  // Ввод вершины числами разбирает parseInputLine (app-input-line.js) — там же
  // он и проверен числами в tests/coord-input. Прежние формы сохранены:
  //   «50»       — длина вдоль направления на курсор;
  //   «100 200»  — абсолютные координаты холста (x восток, y север);
  //   «50<30»    — полярно от предыдущей точки, 0° на восток, против часовой.
  // Добавлены две:
  //   «@25,10»   — приращение от предыдущей точки;
  //   «X=… Y=…»  — ГЕОДЕЗИЧЕСКИЙ порядок, где X это север. Раньше человек,
  //                вставлявший пару из каталога координат МСК как «X Y»,
  //                молча получал контур, повёрнутый на 90°: первое число
  //                ложилось на восток. Теперь буквы решают, что куда.
  const разобрано = typeof parseInputLine === "function"
    ? parseInputLine(state.typed, { last: lastDrawingPt(), cursor: state.mouse })
    : null;
  const pt = разобрано ? [разобрано.x, разобрано.y] : null;
  if (pt && Array.isArray(state.drawing.pts)) state.drawing.pts.push(pt);
  state.typed = "";
  draw();
}

// ---------- хит-тест ----------
// есть ли у полигона видимая заливка (иначе он выбирается только по обводке).
// границы (kind=boundary) — всегда по обводке, у них нет «тела».
function isFilled(f) {
  if (!f.ring) return false;
  const L = layerOf(f);
  if (L && L.kind === "boundary") return false;
  const st = styleOf(f) || {};
  if (!st.fill || st.fill === "transparent" || st.fill === "none") return false;
  if (st.fillOpacity != null && st.fillOpacity <= 0) return false;
  return true;
}
