// ГРАДО Студия · часть 13 из 14 (грузится после app-geom-edit.js).
// пространственный индекс, события мыши, клавиатура
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- пространственный индекс объектов (для выбора/наведения) ----------
// Грид по габаритам объектов. Кеш в state._ix — слот уже существовал и всюду
// инвалидировался (afterChange/live-edit), но индекс никогда не строился.
//
// Зачем: hitTest звался ПЕРЕБОРОМ «слои × объекты» — при 16 слоях и 20 000
// объектов это ~320 000 проверок, причём на КАЖДОЕ движение мыши (курсор в
// режиме «Выбор» выбирается через hitTest). Замерено: 21.7 мс на одно наведение
// — отсюда «тупит». В draw() эту же ошибку уже чинили бакетами по слоям.
//
// rank хранит приоритет объекта ОДНИМ числом, чтобы порядок выбора не изменился:
// сначала верхний слой (позже в LAYERS_V2), внутри слоя — объект, добавленный
// позже. Кандидаты сортируются по rank убыв. и проходят те же две фазы.
function featureIndex() {
  if (state._ix) return state._ix;
  const items = [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const layerRank = new Map(LAYERS_V2.map((l, i) => [l, i]));
  for (let i = 0; i < state.features.length; i++) {
    const f = state.features[i];
    const L = layerOf(f);
    if (!L) continue;                       // как раньше: объект вне реестра слоёв не ловится
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bump = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    if (f.point) bump(f.point[0], f.point[1]);
    const pts = f.ring || f.line;
    if (pts) for (const p of pts) bump(p[0], p[1]);
    const c = f.circle || f.arc;
    if (c) { bump(c.cx - c.r, c.cy - c.r); bump(c.cx + c.r, c.cy + c.r); }
    if (x0 === Infinity) continue;
    items.push({ f, L, x0, y0, x1, y1, rank: (layerRank.get(L) || 0) * 1e7 + i });
    if (x0 < minx) minx = x0; if (x1 > maxx) maxx = x1;
    if (y0 < miny) miny = y0; if (y1 > maxy) maxy = y1;
  }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 100;
  const cellSize = Math.max(diag / 160, 1e-6);
  const cellOf = v => Math.floor(v / cellSize);
  const cells = new Map();
  for (const it of items) {
    for (let cx = cellOf(it.x0); cx <= cellOf(it.x1); cx++)
      for (let cy = cellOf(it.y0); cy <= cellOf(it.y1); cy++) {
        const k = cx + "_" + cy;
        let a = cells.get(k); if (!a) cells.set(k, a = []);
        a.push(it);
      }
  }
  return (state._ix = { cells, cellOf });
}

// кандидаты рядом с точкой: объекты, чей габарит задет [wx±tol, wy±tol]
function hitCandidates(wx, wy, tolW) {
  const { cells, cellOf } = featureIndex();
  const seen = new Set(), out = [];
  for (let cx = cellOf(wx - tolW); cx <= cellOf(wx + tolW); cx++)
    for (let cy = cellOf(wy - tolW); cy <= cellOf(wy + tolW); cy++) {
      const a = cells.get(cx + "_" + cy);
      if (!a) continue;
      for (const it of a) {
        if (seen.has(it)) continue;         // объект лежит в нескольких ячейках
        seen.add(it);
        if (it.x1 < wx - tolW || it.x0 > wx + tolW ||
            it.y1 < wy - tolW || it.y0 > wy + tolW) continue;
        if (!layerDrawable(it.L) || it.L.locked || catOff(it.L, it.f)) continue;
        out.push(it);
      }
    }
  return out.sort((a, b) => b.rank - a.rank);
}

// Попадание объекта в точку БЕЗ учёта заливки: в списке «что под курсором»
// нужны и залитые тела, и голые контуры. Отдельно от hitTest, потому что тот
// решает другую задачу — кого выбрать одним кликом (там заливка важна).
// Инструмент «Определить»: список ВСЕХ объектов под курсором, сверху вниз.
// Наведение на строку подсвечивает объект на чертеже, клик — выбирает его и
// открывает свойства. Без этого на плотной выгрузке до нижнего объекта не
// добраться: клик всегда отдаёт верхний.
function identifySummary(f) {
  if (f.ring) return `площадь ${fmtAreaHa(featureArea(f))}`;
  if (f.line) return `длина ${fmtLen(lineLen(f.line))}`;
  if (f.circle) return `окружность R ${fmtLen(f.circle.r)}, площадь ${fmtAreaHa(featureArea(f))}`;
  if (f.arc) return `дуга R ${fmtLen(f.arc.r)}`;
  return "точка";
}

function openIdentify(wx, wy, screenX, screenY) {
  closePopups();
  const stack = hitTestAll(wx, wy);
  if (!stack.length) { toast("Под курсором нет объектов"); return; }
  const menu = document.createElement("div");
  menu.className = "ctx-menu identify-menu";
  const head = document.createElement("div");
  head.className = "identify-head";
  head.textContent = `Под курсором: ${ruCount(stack.length, "объект", "объекта", "объектов")}`;
  menu.appendChild(head);
  for (const f of stack) {
    const L = layerOf(f);
    const item = document.createElement("div");
    item.className = "ctx-item identify-item";
    const title = document.createElement("b");
    title.textContent = featureLabelShort(f);
    const meta = document.createElement("span");
    meta.textContent = `${L ? L.title : "без слоя"} · ${identifySummary(f)}`;
    item.append(title, meta);
    // наведение подсвечивает, но выборку не меняет: иначе список прыгал бы
    item.addEventListener("pointerenter", () => { state.hoverIdentifyId = f.id; draw(); });
    item.addEventListener("pointerleave", () => { state.hoverIdentifyId = null; draw(); });
    item.addEventListener("click", event => {
      event.stopPropagation();
      state.hoverIdentifyId = null;
      closePopups();
      if (L) state.activeLayerId = L.id;
      selectOne(f.id);
      renderLayers(); renderProps(); draw();
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const rect = cv.getBoundingClientRect();
  const width = menu.offsetWidth, height = menu.offsetHeight;
  menu.style.left = Math.min(rect.left + screenX + 8, window.innerWidth - width - 6) + "px";
  menu.style.top = Math.min(rect.top + screenY + 8, window.innerHeight - height - 6) + "px";
  setTimeout(() => document.addEventListener("click", () => {
    state.hoverIdentifyId = null;
    closePopups();
    draw();
  }, { once: true }), 0);
}

function featureHitsPoint(f, wx, wy, tolW, pointTolW) {
  const pointTol = pointTolW == null ? tolW : pointTolW;
  if (f.point) return Math.hypot(f.point[0] - wx, f.point[1] - wy) < pointTol;
  if (f.line) return nearChain(wx, wy, f.line, tolW) !== null;
  if (f.arc) return Math.abs(Math.hypot(f.arc.cx - wx, f.arc.cy - wy) - f.arc.r) < tolW;
  // у круга ловится и ТЕЛО, и обводка — как у кольца (pointInPolygon + nearRing)
  if (f.circle) return Math.hypot(f.circle.cx - wx, f.circle.cy - wy) <= f.circle.r + tolW;
  if (f.ring) return pointInPolygon(wx, wy, f) || nearRing(wx, wy, f.ring, tolW)
    || (f.holes || []).some(h => nearRing(wx, wy, h, tolW));
  return false;
}

// Все объекты под точкой, сверху вниз. На плотной выгрузке (зона + участок +
// ОКС + красная линия в одной точке) одним кликом до нужного не добраться:
// hitTest отдаёт только верхний.
function hitTestAll(wx, wy) {
  const tolW = 7 / state.view.k;
  const pointTolW = tolW + 4 / state.view.k;
  return hitCandidates(wx, wy, tolW)
    .filter(({ f }) => featureHitsPoint(f, wx, wy, tolW, pointTolW))
    .map(({ f }) => f);
}

function hitTest(wx, wy) {
  const tolW = 7 / state.view.k;
  const cand = hitCandidates(wx, wy, tolW);
  // Проход 1 — по ОБВОДКЕ (штрихам): точки, линии, дуги, окружности и
  // полигоны БЕЗ заливки. Клик точно по контуру выбирает именно его объект,
  // даже если сверху лежит другой полигон — у незалитого нет «тела», ловим
  // за обводку (и она видна, т.к. заливкой сверху не перекрыта).
  for (const { f } of cand) {
    if (f.point && Math.hypot(f.point[0] - wx, f.point[1] - wy) < tolW + 4 / state.view.k) return f;
    if (f.line && nearChain(wx, wy, f.line, tolW) !== null) return f;
    if (f.ring && !isFilled(f) && (nearRing(wx, wy, f.ring, tolW)
        || (f.holes || []).some(h => nearRing(wx, wy, h, tolW)))) return f;
    if (f.arc) {
      const aa = f.arc; const dd = Math.hypot(aa.cx - wx, aa.cy - wy);
      if (Math.abs(dd - aa.r) < tolW) return f;
    }
    if (f.circle && !isFilled(f)) {
      const cc = f.circle; const dd = Math.hypot(cc.cx - wx, cc.cy - wy);
      if (Math.abs(dd - cc.r) < tolW) return f;
    }
  }
  // Проход 2 — по ПЛОЩАДИ/контуру: полигон, содержащий точку ИЛИ задетый за
  // обводку (верхний побеждает). Залитый полигон ловится телом; допуск по
  // контуру даёт клик по самой границе (pointInRing ровно на грани неустойчив),
  // но порядок «сверху вниз» защищает от выбора скрытого под заливкой контура.
  for (const { f } of cand) {
    // тело считается БЕЗ выколотых частей (pointInPolygon), но за контур —
    // и внешний, и контур дыры — схватить можно
    if (f.ring && (pointInPolygon(wx, wy, f) || nearRing(wx, wy, f.ring, tolW)
                   || (f.holes || []).some(h => nearRing(wx, wy, h, tolW)))) return f;
    // Круг — такая же площадная фигура, и у него тоже есть ТЕЛО. Пока его тут
    // не было, круглую зону можно было схватить только точно за обводку: клик
    // в середину не выбирал ничего, хотя на экране там сплошная заливка.
    if (f.circle) {
      const cc = f.circle;
      if (Math.hypot(cc.cx - wx, cc.cy - wy) <= cc.r + tolW) return f;
    }
  }
  return null;
}
// Замкнутый контур рядом с точкой. Раньше звалось как
// nearChain(wx, wy, [...ring, ring[0]], tolW) — копия всего кольца на КАЖДЫЙ
// объект и КАЖДЫЙ из двух проходов; на городском слое это десятки тысяч лишних
// массивов за одно движение мыши. Здесь замыкание берётся по модулю, без копии.
function nearRing(wx, wy, ring, tolW) {
  const n = ring.length, t2 = tolW * tolW;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const q = nearestOnSeg([wx, wy], a, b);
    const dx = wx - q[0], dy = wy - q[1];
    if (dx * dx + dy * dy < t2) return true;
  }
  return false;
}
// объекты, попавшие в рамку выделения [a,b] (любая вершина внутри), видимые слои
function marqueeHit(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const ids = [];
  for (const f of state.features) {
    if (isHidden(f) || isLocked(f) || catOff(layerOf(f), f)) continue;
    // featureMovablePts: рамка ловит объект и за вершину ДЫРЫ (не только внешнего кольца)
    if (featureMovablePts(f).some(p => p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1))
      ids.push(f.id);
  }
  return ids;
}

// ---------- события мыши ----------
cv.addEventListener("contextmenu", e => e.preventDefault());
// Холст на Pointer Events с захватом указателя: при перетаскивании (вершина,
// тело, рамка выделения, панорама) события продолжают приходить даже когда
// курсор ушёл за пределы холста — на тулбар/панель/шапку. На mousemove@cv
// трекинг рвался у кромки и объект замирал (apple §2/§3: 1:1 + capture).
// touch-action:none — чтобы касание-перетаскивание не конфликтовало со скроллом.
cv.style.touchAction = "none";
// Локальные координаты указателя в холсте из clientX/clientY (а не offsetX):
// у ЗАХВАЧЕННОГО указателя, ушедшего за пределы холста, offsetX в Chrome
// ненадёжен (relative к элементу под курсором), из-за чего перетаскивание
// «застревало» у кромки. clientX−rect надёжен всегда — так же считает ресайзер.
function evXY(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener("pointerdown", e => {
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  const [ex, ey] = evXY(e);
  const [wxr, wyr] = s2w(ex, ey);
  if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) {
    state.pan = { sx: ex, sy: ey, tx: state.view.tx, ty: state.view.ty };
    return;
  }
  if (e.button !== 0) return;
  const s = cursorPoint(wxr, wyr);
  if (state.tool === "identify") { openIdentify(wxr, wyr, ex, ey); return; }
  if (state.tool === "layeralign" && state.layerAlign) {
    const ctx3 = state.layerAlign;
    if (!ctx3.a) {
      ctx3.a = s.p;                                  // опорная точка (со снапом)
      toast("Теперь кликните, куда должна встать эта точка");
      draw();
      return;
    }
    const [dx, dy] = [s.p[0] - ctx3.a[0], s.p[1] - ctx3.a[1]];
    snapshot();
    const moved = shiftLayerFeatures(ctx3.layerId, dx, dy);
    state.layerAlign = null;
    setTool("select");
    afterChange();
    toast(`Слой «${ctx3.title}» сдвинут на ${fmtLen(Math.hypot(dx, dy))} (${ruCount(moved, "объект", "объекта", "объектов")})`);
    return;
  }
  if (state.tool === "sheet" && typeof sheetPointerDown === "function"
      && sheetPointerDown(wxr, wyr)) return;
  if (state.tool === "select") {
    // Перетаскивание подписи: клик в рамку подписи УЖЕ выбранного объекта.
    // Сначала выбор объекта, потом сдвиг его подписи — иначе клик по подписи
    // спорил бы с обычным выбором.
    const grabbed = _labelBoxes.find(item => state.selectedIds.has(item.featureId) &&
      ex >= item.box[0] && ex <= item.box[2] && ey >= item.box[1] && ey <= item.box[3]);
    if (grabbed) {
      const f = state.features.find(x => x.id === grabbed.featureId);
      if (f) {
        snapshot();
        state.labelDrag = { f, startX: wxr, startY: wyr,
          orig: Array.isArray(f.label_offset) ? [...f.label_offset] : [0, 0] };
        return;
      }
    }
    const cur = selectedFeature();
    if (cur) {
      const vi = vertexAt(cur, wxr, wyr);
      if (vi != null) {
        if (e.altKey) {   // Alt+клик — удалить вершину (в т.ч. дыры)
          const ref = vertexRef(cur, vi);
          if (cur.point || !ref) return;
          const isHole = cur.holes && cur.holes.includes(ref.arr);
          const min = cur.line ? 2 : 3;   // кольцо (внешнее/дыра) — минимум 3
          if (ref.arr.length > min) {
            snapshot(); ref.arr.splice(ref.i, 1); afterChange();
          } else if (isHole) {            // дыра выродилась — убираем её целиком
            snapshot();
            cur.holes = cur.holes.filter(h => h !== ref.arr);
            if (!cur.holes.length) delete cur.holes;
            afterChange();
          }
          return;
        }
        state.edit = { f: cur, vi, moved: false,
                       companions: sharedCompanions(cur, vi) };
        return;
      }
      // перетаскивание ОБЩЕЙ ГРАНИЦЫ ребром: у выбранной coverage-зоны клик по
      // ребру (не по вершине) тянет оба его конца + совпадающие вершины соседей
      // — общая граница остаётся общей, правится одной операцией
      if (isCoverageFeature(cur) && (cur.ring || cur.line)) {
        const raw = cur.ring || cur.line;
        const chain = cur.ring ? [...cur.ring, cur.ring[0]] : cur.line;
        const si = nearChain(wxr, wyr, chain, 7 / state.view.k);
        if (si != null) {
          const i0 = si % raw.length, i1 = (si + 1) % raw.length;
          state.edit = { edgeDrag: true, f: cur, i0, i1,
                         orig0: [...raw[i0]], orig1: [...raw[i1]],
                         comps0: sharedCompanions(cur, i0), comps1: sharedCompanions(cur, i1),
                         grab: [wxr, wyr], moved: false };
          return;
        }
      }
    }
    const f = hitTest(wxr, wyr);
    if (f) {
      if (e.shiftKey) {                        // Shift+клик — добавить/убрать из выделения
        toggleSelection(f.id); draw(); renderProps(); return;
      }
      if (!state.selectedIds.has(f.id)) selectOne(f.id);   // клик по невыделенному — выбрать один
      // клик по уже выделенному (в т.ч. в группе) — тянем всю группу.
      // Опорная точка привязки — ближайшая вершина к месту захвата: при
      // переносе именно она цепляется за вершину/середину/сетку (как в CAD)
      const movingIds = selectionIds();
      const feats = movingIds.map(id => state.features.find(x => x.id === id)).filter(Boolean);
      const primary = selectedFeature() || feats[0] || f;
      let refOrig = primary.point ? [...primary.point] : null;
      if (!refOrig) {
        let bd = Infinity;
        for (const p of featurePts(primary)) {
          const d = Math.hypot(p[0] - wxr, p[1] - wyr);
          if (d < bd) { bd = d; refOrig = [p[0], p[1]]; }
        }
      }
      const orig = feats.map(ff => featureMoveOrigin(ff));
      // Общие вершины покрытийных слоёв ищем ОДИН раз на жест. Раньше
      // sharedCompanions() звался для каждой вершины на каждое движение мыши и
      // сканировал все объекты проекта — O(вершин × объектов × вершин) на кадр,
      // из-за чего перетаскивание функциональной зоны фризило. Топология
      // совпадений за жест не меняется: компаньоны едут тем же офсетом.
      const bodyComps = [];
      for (const feat of feats) {
        if (!isCoverageFeature(feat)) continue;
        const pts = featurePts(feat);
        for (let vi = 0; vi < pts.length; vi++) {
          const comps = sharedCompanions(feat, vi);
          if (comps.length) bodyComps.push({ feat, vi, comps });
        }
      }
      state.edit = { vi: "body", ids: movingIds, feats, orig, refOrig, bodyComps,
                     grab: [wxr, wyr], moved: false };
      draw(); renderProps();
    } else {                                   // пустое место — рамка выделения
      if (!e.shiftKey) clearSelection();
      state.drag = { a: [wxr, wyr], b: [wxr, wyr], marquee: true, add: e.shiftKey, moved: false };
      draw(); renderProps();
    }
  } else if (state.tool === "marea") {
    // измерение площади: клики собирают контур, счёт живёт на холсте
    if (!state.measureArea || state.measureArea.done) state.measureArea = { pts: [], done: false };
    state.measureArea.pts.push(s.p);
    draw();
  } else if (state.tool === "measure") {
    if (!state.measure || state.measure.b) state.measure = { a: s.p, b: null };
    else state.measure.b = s.p;
    draw();
  } else if (state.tool === "trim" || state.tool === "extend") {
    handleTrimExtendClick(wxr, wyr);
  } else if (state.tool === "fillet") {
    handleFilletClick(wxr, wyr);
  } else if (state.tool === "offset") {
    handleOffsetClick(wxr, wyr);
  } else if (state.tool === "rotate" || state.tool === "scale" || state.tool === "mirror") {
    xfClickBase(s.p);
  } else if (state.tool === "point") {
    const L = activeLayer();
    if (!isDrawableLayer(L)) {
      toast(L?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (L.geometry_type === "point") addFeature(L.id, { point: s.p });
  } else if (state.tool === "rect" && !state.drawing) {
    if (!isDrawableLayer(activeLayer())) {
      toast(activeLayer()?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    // протягивание — прямоугольник; одиночный клик — контур по точкам
    state.drag = { a: s.p, b: s.p, rect: true, moved: false };
  } else if (state.tool === "circle") {
    const L = activeLayer();
    if (!isDrawableLayer(L)) {
      toast(L?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (!toolFitsLayer("circle", L)) {
      toast("Этот слой не поддерживает окружности (выберите/создайте слой с геометрией окружность)", "warn");
      return;
    }
    // Второй клик по уже поставленному центру задаёт радиус и завершает
    // окружность; иначе он просто переставлял бы центр.
    if (state.drawing && state.drawing.center) {
      const c = state.drawing.center;
      const r = Math.hypot(s.p[0] - c[0], s.p[1] - c[1]);
      if (r > 0.5) {
        state.drawing = null; state.typed = "";
        addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
        return;
      }
    }
    state.drawing = { center: s.p, r: 0 };
    state.typed = "";
    draw();
  } else if (state.tool === "dim" || TOOL_GEOM[state.tool]) {
    // рисование геометрии требует активный слой; размеры пишутся в свой
    // аннотационный слой и активного слоя не требуют
    if (state.tool !== "dim" && state.tool !== "split" && state.tool !== "reshape"
        && !isDrawableLayer(activeLayer())) {
      toast(activeLayer()?.locked ? "Активный слой заблокирован" : "Создайте слой, чтобы рисовать", "warn");
      return;
    }
    if (!state.drawing) { state.drawing = { pts: [] }; state.typed = ""; }
    // Выноска: две точки — остриё у объекта и конец полки. Текст спрашиваем
    // сразу: выноска без надписи бессмысленна, а дорисовывать её потом человек
    // забудет и увезёт на лист пустую стрелку.
    if (state.tool === "leader") {
      if (Array.isArray(state.drawing.pts)) state.drawing.pts.push(s.p);
      if (Array.isArray(state.drawing.pts) && state.drawing.pts.length === 2) {
        const pts = state.drawing.pts;
        state.drawing = null;
        const слой = LAYER_BY_KIND["leader"];
        if (!слой) { toast("Слой выносок недоступен", "warn"); return; }
        uiPrompt("Надпись выноски", "", { ok: "Поставить", placeholder: "например: проектируемый проезд" })
          .then(текст => {
            if (текст == null) { draw(); return; }          // отменил — выноски нет
            addFeature(слой.id, { line: pts, props: { text: String(текст).trim() } });
          });
      } else draw();
      return;
    }
    if (state.tool === "dim") {
      if (Array.isArray(state.drawing.pts)) state.drawing.pts.push(s.p);
      if (Array.isArray(state.drawing.pts) && state.drawing.pts.length === 2) {
        const pts = state.drawing.pts;
        state.drawing = null;
        const dim = LAYER_BY_KIND["dim"];
        if (!dim) { toast("Слой размеров недоступен", "warn"); return; }
        addFeature(dim.id, { line: pts });
        // Конец размера запоминаем: цепочку по фасаду или по красной линии
        // ставят подряд от общей выносной, и заново целиться в ту же точку —
        // лишняя работа и лишняя погрешность. Enter продолжает отсюда.
        state.dimLast = pts[1];
        const hintEl = document.getElementById("st-hint");
        if (hintEl) hintEl.textContent = "«Размер»: два клика · Enter — цепочка от последней точки";
      } else draw();
      return;
    }
    const ptsArr = state.drawing.pts;
    const first = Array.isArray(ptsArr) ? ptsArr[0] : null;
    if (first && TOOL_GEOM[state.tool] === "polygon" && Array.isArray(ptsArr) && ptsArr.length > 2 &&
        Math.hypot(first[0] - s.p[0], first[1] - s.p[1]) < 12 / state.view.k) {
      finishDrawing();
    } else {
      if (Array.isArray(ptsArr)) {
        ptsArr.push(s.p);
        state.typed = "";
        draw();
        if (state.tool === "arc" && ptsArr.length >= 3) {
          finishDrawing();
        }
      }
    }
  }
});
cv.addEventListener("pointermove", e => {
  const [ex, ey] = evXY(e);
  const [wx, wy] = s2w(ex, ey);
  document.getElementById("st-coords").textContent = `x: ${fmtCoord(wx)}  y: ${fmtCoord(wy)} м`;
  if (typeof sheetPointerMove === "function" && sheetPointerMove(wx, wy)) return;
  if (state.labelDrag) {
    const d = state.labelDrag;
    d.f.label_offset = [d.orig[0] + (wx - d.startX), d.orig[1] + (wy - d.startY)];
    draw();
    return;
  }
  if (state.pan) {
    state.view.tx = state.pan.tx + (ex - state.pan.sx);
    state.view.ty = state.pan.ty + (ey - state.pan.sy);
    draw(); return;
  }
  if (state.drag && state.drag.marquee) {
    state.drag.b = [wx, wy];
    if (Math.hypot(wx - state.drag.a[0], wy - state.drag.a[1]) * state.view.k > 3)
      state.drag.moved = true;
    draw(); return;
  }
  if (state.edit) {
    const ed = state.edit;
    // Двигали ли объекты ВНЕ exclude-набора привязок. Индекс привязок строится
    // по всем объектам, а исключения применяются на ЗАПРОСЕ — поэтому пока
    // изменяется только то, что и так исключено, индекс остаётся корректным
    // и перестраивать его на каждое движение мыши не нужно.
    let snapDirty = false;
    if (!ed.moved) { snapshot(); ed.moved = true; }
    if (ed.edgeDrag) {
      applyEdgeDrag(ed, wx, wy);
      state._ix = null; state._snapIndex = null; draw(); return;
    }
    if (ed.vi === "body") {
      // куда «хочет» уйти опорная вершина по курсору, затем привязка её к
      // вершинам/серединам/сетке чужих объектов; всю группу двигаем на тот же офсет
      const want = [ed.refOrig[0] + (wx - ed.grab[0]), ed.refOrig[1] + (wy - ed.grab[1])];
      const snapped = snapPoint(want[0], want[1], new Set(ed.ids));
      state.snapHit = snapped.kind ? snapped : null;
      const ox = snapped.p[0] - ed.refOrig[0], oy = snapped.p[1] - ed.refOrig[1];
      ed.feats.forEach((feat, fi) => {
        // Круг и дуга переносятся за центр — у них нет живых точек, чтобы
        // двигать их поштучно. Общее место: moveFeatureFrom в app-geodesy.
        moveFeatureFrom(feat, ed.orig[fi], ox, oy);
      });
      // общие границы покрытийных слоёв: пары найдены один раз при pointerdown
      for (const { feat, vi, comps } of (ed.bodyComps || [])) {
        const pts = featurePts(feat);
        for (const c of comps) {
          const cpts = featurePts(c.f);
          cpts[c.vi][0] = pts[vi][0];
          cpts[c.vi][1] = pts[vi][1];
          snapDirty = true;   // подвинули ЧУЖОЙ объект — индекс устарел
        }
      }
    } else {
      // исключаем из привязок свою фигуру и всех компаньонов общей вершины
      const ex = new Set([ed.f.id]);
      for (const c of (ed.companions || [])) ex.add(c.f.id);
      const s = snapPoint(wx, wy, ex);
      state.snapHit = s;
      if (ed.f.arc) {
        const a = ed.f.arc;
        // нормализация приращения угла в (−π,π] — движение конца следует за
        // курсором плавно, без скачка развёртки на ±2π при переходе границы
        const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
        if (ed.vi === 0) { // начало: двигаем начало, КОНЕЦ фиксируем (не вращаем всю дугу)
          const newA0 = Math.atan2(s.p[1] - a.cy, s.p[0] - a.cx);
          const end = a.a0 + a.sweep;       // текущий конец — держим на месте
          a.a0 += wrap(newA0 - a.a0);
          a.sweep = end - a.a0;
        } else if (ed.vi === 1) { // конец: плавно, начало фиксируем
          const newAng = Math.atan2(s.p[1] - a.cy, s.p[0] - a.cx);
          a.sweep += wrap(newAng - (a.a0 + a.sweep));
        } else if (ed.vi === 2) { // center
          a.cx = s.p[0]; a.cy = s.p[1];
        } else if (ed.vi === 3) { // radius (логика редактирования)
          const dx = s.p[0] - a.cx, dy = s.p[1] - a.cy;
          a.r = Math.hypot(dx, dy);
          if (a.r < 0.1) a.r = 0.1;
        }
      } else if (ed.f.circle) {
        const c = ed.f.circle;
        if (ed.vi === 0) { // center
          c.cx = s.p[0]; c.cy = s.p[1];
        } else if (ed.vi === 1) { // radius handle
          c.r = Math.hypot(s.p[0] - c.cx, s.p[1] - c.cy);
          if (c.r < 0.1) c.r = 0.1;
        }
      } else {
        // адресуемся по кольцам: вершина дыры тянется как обычная
        const ref = vertexRef(ed.f, ed.vi) || { arr: featurePts(ed.f), i: ed.vi };
        ref.arr[ref.i][0] = s.p[0]; ref.arr[ref.i][1] = s.p[1];
        for (const c of (ed.companions || [])) {
          const cpts = featurePts(c.f);
          cpts[c.vi][0] = s.p[0]; cpts[c.vi][1] = s.p[1];
        }
      }
    }
    state._ix = null;
    // Раньше индекс привязок обнулялся здесь безусловно, и следующее же
    // движение мыши строило его заново по ВСЕМ объектам проекта — O(все
    // сегменты) на кадр, из-за чего перетаскивание на выгрузках ОГД лагало.
    // При правке вершины всё изменяемое уже в exclude-наборе, поэтому сброс
    // нужен только когда общие вершины покрытийных слоёв подвинули чужие
    // объекты. По окончании жеста afterChange() всё равно сбрасывает индексы.
    if (snapDirty) state._snapIndex = null;
    draw(); return;
  }
  const s = cursorPoint(wx, wy);
  state.snapHit = s;
  state.mouse = s.p;
  updateSnapStatus(s);
  if (state.xf && state.xf.phase === "act") {
    xfUpdatePreview(); draw(); return;
  }
  if (state.drag && state.drag.rect) {
    state.drag.b = s.p;
    if (Math.hypot(s.p[0] - state.drag.a[0], s.p[1] - state.drag.a[1]) * state.view.k > 4)
      state.drag.moved = true;
    draw(); return;
  }
  if (state.drawing && state.drawing.center != null && state.tool === "circle") {
    draw(); return;
  }
  if (state.tool === "select") {
    const cur = selectedFeature();
    const onCovEdge = cur && isCoverageFeature(cur) && (cur.ring || cur.line) &&
      nearChain(wx, wy, cur.ring ? [...cur.ring, cur.ring[0]] : cur.line, 7 / state.view.k) != null;
    cv.style.cursor = (cur && vertexAt(cur, wx, wy) != null) ? "move"
      : onCovEdge ? "move"
      : hitTest(wx, wy) ? "pointer" : "default";
    if (state.guides.length) draw();
  }
  if (state.drawing || state.tool !== "select") draw();
});
// Слушаем на window, а не на #cv: если отпустить кнопку за пределами
// холста (над панелью/тулбаром), локальный слушатель #cv это событие
// не увидит — pan/edit/drag «залипнут», и вид будет произвольно
// скакать при следующем движении мыши, создавая впечатление, что
// холст не реагирует на клики.
window.addEventListener("pointerup", e => {
  if (typeof sheetPointerUp === "function" && sheetPointerUp()) return;
  if (state.labelDrag) {
    const d = state.labelDrag;
    state.labelDrag = null;
    // почти нулевой сдвиг — это клик, а не перенос: смещение снимается
    if (d.f.label_offset && Math.hypot(d.f.label_offset[0] - d.orig[0], d.f.label_offset[1] - d.orig[1]) < 0.5) {
      if (d.orig[0] === 0 && d.orig[1] === 0) delete d.f.label_offset;
      else d.f.label_offset = d.orig;
      state.undo.pop(); syncHistoryControls(); draw();
      return;
    }
    afterChange();
    toast("Подпись закреплена на новом месте. Двойной клик по ней вернёт авторазмещение");
    return;
  }
  if (state.pan) { state.pan = null; return; }
  if (state.edit) {
    const moved = state.edit.moved;
    state.edit = null;
    if (moved) afterChange();
    return;
  }
  if (state.drag && state.drag.marquee) {
    const { a, b, add, moved } = state.drag;
    state.drag = null;
    if (moved) {
      const hits = marqueeHit(a, b);
      setSelection(add ? [...new Set([...selectionIds(), ...hits])] : hits);
    }
    draw(); renderProps(); return;
  }
  if (state.drag && state.drag.rect) {
    const { a, b, moved } = state.drag;
    state.drag = null;
    const L = activeLayer();
    if (moved && Math.abs(a[0] - b[0]) > 1 && Math.abs(a[1] - b[1]) > 1) {
      if (L && L.geometry_type === "polygon")
        addFeature(L.id, { ring: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] });
    } else if (!moved) {
      // клик без протягивания — произвольный контур по точкам
      state.drawing = { pts: [a] };
      state.typed = "";
      draw();
    } else draw();
  } else if (state.drawing && state.drawing.center != null && state.tool === "circle") {
    const c = state.drawing.center;
    const mp = state.mouse || [c[0], c[1]];
    const r = Math.hypot(mp[0] - c[0], mp[1] - c[1]);
    const L = activeLayer();
    if (L && r > 0.5) {
      state.drawing = null;
      addFeature(L.id, { circle: { cx: c[0], cy: c[1], r } });
    } else {
      // Клик без протягивания: центр ОСТАЁТСЯ, радиус задаётся вторым кликом,
      // вводом числа или Enter. Раньше pointerup того же клика сбрасывал
      // drawing, и оба этих способа (стандартный приём САПР) были недостижимы —
      // окружность можно было построить только нажать-протянуть-отпустить.
      draw();
    }
  }
});
// Потеря фокуса окна (alt-tab, системный диалог) посреди жеста: незавершённое
// НАЖАТИЕ мыши бросаем, потому что pointerup до нас уже не дойдёт и жест
// залипнет. Но бросать надо ровно нажатие, а не работу человека.
//
// Правка вершин двигает геометрию прямо в pointermove; commit делает
// afterChange на pointerup. Раньше blur обнулял state.edit молча, и уже
// сдвинутая геометрия оставалась без afterChange: пространственный индекс и
// индекс привязок держали старые координаты, ТЭП и автосохранение не знали о
// правке. Теперь blur завершает жест так же, как отпускание кнопки.
//
// Черчение (state.drawing) — не залипшее нажатие, а многокликовый жест,
// который живёт между кликами по замыслу. Обнулять его на alt-tab значило
// терять начатый контур целиком, стоило человеку отвлечься на другое окно.
// Отменяет черчение Escape.
window.addEventListener("blur", () => {
  state.pan = null;
  state.drag = null;
  if (state.edit) {
    const moved = state.edit.moved;
    state.edit = null;
    if (moved) afterChange(); else draw();
  } else draw();
});
cv.addEventListener("dblclick", e => {
  {
    const [ex0, ey0] = evXY(e);
    const grabbed = _labelBoxes.find(item => ex0 >= item.box[0] && ex0 <= item.box[2] &&
      ey0 >= item.box[1] && ey0 <= item.box[3]);
    const f = grabbed && state.features.find(x => x.id === grabbed.featureId);
    if (f && Array.isArray(f.label_offset)) {
      snapshot();
      delete f.label_offset;
      afterChange();
      toast("Подпись вернулась к авторазмещению");
      return;
    }
  }
  e.preventDefault();
  if (state.drawing) { finishDrawing(); return; }
  // двойной клик по ребру выбранной фигуры — вставка вершины
  if (state.tool === "select") {
    const f = selectedFeature();
    if (!f || f.point || f.arc || f.circle) return;
    const [wx, wy] = s2w(e.offsetX, e.offsetY);
    // ищем ближайшее ребро по ВСЕМ кольцам (внешний контур + дыры), вставляем
    // вершину в то кольцо, чьё ребро задето — двойной клик по краю дыры работает
    const tol = 7 / state.view.k;
    for (const ring of featureRings(f)) {
      const closed = f.ring ? [...ring, ring[0]] : ring;
      const i = nearChain(wx, wy, closed, tol);
      if (i !== null) {
        snapshot();
        const q = nearestOnSeg([wx, wy], closed[i], closed[i + 1]);
        ring.splice(i + 1, 0, q);
        afterChange();
        return;
      }
    }
  }
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  state.view.k = clampK(state.view.k * factor);
  state.view.tx = e.offsetX - wx * state.view.k;
  state.view.ty = e.offsetY + wy * state.view.k;
  draw();
}, { passive: false });

// ---------- клавиатура (по кодам клавиш — не зависит от раскладки) ----------
const TOOL_CODES = { KeyV: "select", KeyM: "measure", KeyD: "dim", KeyT: "trim", KeyE: "extend" };
// старые предметные клавиши — теперь «создать-или-выбрать слой этого вида»
// (L2b: пресетов нет, слой заводится по требованию) + естественный инструмент
const PRESET_KIND_CODES = {
  KeyG: "boundary", KeyZ: "zone", KeyO: "restrict", KeyB: "building",
  KeyP: "public", KeyL: "redline", KeyS: "social",
};
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
    e.preventDefault(); document.getElementById("btn-grado").click(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyO") {
    e.preventDefault(); document.getElementById("btn-open").click(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyN") {
    e.preventDefault(); document.getElementById("btn-new-project").click(); return;
  }
  // TEXTAREA и contenteditable раньше сюда проваливались: в редакторе формул
  // пробел не набирался (preventDefault ниже), а Backspace ПАРАЛЛЕЛЬНО удалял
  // выделенные объекты холста — правка текста молча уносила геометрию.
  // BUTTON: пробел обязан активировать кнопку (WCAG 2.1.1), а Delete при
  // фокусе на кнопке в модалке — не стирать объекты за её спиной.
  const t = e.target;
  if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"
      || t.isContentEditable) return;
  if (t.tagName === "BUTTON" &&
      (e.code === "Space" || e.key === "Enter" || e.key === "Delete" || e.key === "Backspace")) return;
  // Режимы направления. Shift держит орто, пока зажат; F8 и F10 включают
  // режим, который держать не надо: улицу под 45° одной рукой не нарисуешь.
  if (e.key === "F8") {
    e.preventDefault();
    state.ortho = !state.ortho;
    if (state.ortho) state.polarStep = 0;          // два режима сразу — путаница
    toast(state.ortho ? "Орто включено (F8)" : "Орто выключено (F8)");
    draw(); return;
  }
  if (e.key === "F10") {
    e.preventDefault();
    const дальше = { 0: 15, 15: 30, 30: 45, 45: 0 };
    state.polarStep = дальше[state.polarStep || 0] || 0;
    if (state.polarStep) state.ortho = false;
    toast(state.polarStep ? `Полярное отслеживание: шаг ${state.polarStep}° (F10)`
                          : "Полярное отслеживание выключено (F10)");
    draw(); return;
  }
  if (e.key === "Shift") { shiftDown = true; if (state.drawing) draw(); return; }
  if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
    e.preventDefault(); e.shiftKey ? redo() : undo(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") {
    e.preventDefault(); duplicateSelected(); return;
  }
  // ввод значения (угол/коэффициент) прямо на холсте (без всплывающего окна); зеркало — без ввода
  if (state.xf && state.xf.phase === "act" && state.xf.kind !== "mirror") {
    if (/^[0-9.,-]$/.test(e.key)) { state.typed += e.key; xfUpdatePreview(); draw(); return; }
    if (e.key === "Backspace") { state.typed = state.typed.slice(0, -1); xfUpdatePreview(); draw(); return; }
  }
  // набор при рисовании: длина (50), абсолют X Y (100 200 или 100;200),
  // полярно (длина<угол°). Разрешены цифры, разделители, знак, угол
  // Начало фигуры С КЛАВИАТУРЫ. Набор координат гейтился уже начатым
  // рисованием, а начиналось оно только в pointerdown холста — то есть первую
  // точку можно было поставить исключительно мышью, хотя подпись холста
  // обещает «Enter завершает фигуру» (WCAG 2.1.1 для основной функции
  // приложения). Цифра при активном инструменте геометрии открывает набор:
  // дальше работает уже существующий формат «100 200» (абсолютные X Y),
  // которому предыдущая точка не нужна. Окружность не сеем — ей сначала нужен
  // центр, а не радиус.
  if (!state.drawing && !state.xf && TOOL_GEOM[state.tool] && state.tool !== "circle"
      && /^[0-9]$/.test(e.key) && isDrawableLayer(activeLayer())) {
    state.drawing = { pts: [] };
    state.typed = e.key;
    toast("Введите координаты «X Y» и нажмите Enter", "info");
    draw();
    return;
  }
  // @ — приращение, x/y/= — геодезическая пара. Буквы перехватываем только
  // во время построения: там набор важнее горячих клавиш инструментов.
  if (state.drawing && /^[0-9.,;<>@=xXyY -]$/.test(e.key)) { state.typed += e.key; draw(); return; }
  if (state.drawing && e.key === "Backspace") {
    state.typed = state.typed.slice(0, -1); draw(); return;
  }
  if (e.key === "Enter") {
    if (state.xf && state.xf.phase === "act") { xfCommit(); return; }
    if (state.trimCtx && !state.trimCtx.ready) {
      if (!state.trimCtx.boundary.size) { toast("Выберите хотя бы одну границу", "warn"); return; }
      state.trimCtx.ready = true;
      toast(state.tool === "trim" ? "Кликните лишний кусок линии" : "Кликните открытый конец линии для продления");
      return;
    }
    if (state.measureArea && !state.measureArea.done && state.measureArea.pts.length > 2) {
      state.measureArea.done = true;           // контур замкнут, счёт остаётся на экране
      draw();
      return;
    }
    // Цепочка размеров: новый размер начинается от конца предыдущего.
    // Только когда ничего не чертится — иначе Enter обязан завершать начатое.
    if (state.tool === "dim" && !state.drawing && state.dimLast) {
      state.drawing = { pts: [state.dimLast.slice()] };
      const hintEl = document.getElementById("st-hint");
      if (hintEl) hintEl.textContent = "«Размер»: цепочка от предыдущего — укажите вторую точку";
      draw();
      return;
    }
    if (state.drawing && state.typed) placeTypedPoint();
    else finishDrawing();
    return;
  }
  if (e.key === "Escape") {
    if (state.xf && state.xf.phase === "act") { xfCancel(); return; }
    if (state.typed) { state.typed = ""; draw(); return; }
    if (state.drawing) { state.drawing = null; draw(); return; }
    if (state.measureArea) { state.measureArea = null; draw(); return; }
  if (state.layerAlign) { state.layerAlign = null; setTool("select"); draw(); return; }
    if (state.measure) { state.measure = null; draw(); return; }
    if (state.trimCtx && (state.trimCtx.boundary.size || state.trimCtx.ready)) {
      state.trimCtx = { boundary: new Set(), ready: false }; draw();
      toast("Выбор границ сброшен");
      return;
    }
    clearSelection(); draw(); renderProps(); return;
  }
  if (e.key === "Delete" || e.key === "Backspace") { deleteSelected(); return; }
  if (e.key.startsWith("Arrow")) {
    const step = e.shiftKey ? 1 : gridStep();
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d && selectionFeatures().length) { e.preventDefault(); nudgeSelected(...d); }
    return;
  }
  if (e.key === "?" || (e.shiftKey && e.code === "Slash")) { openShortcuts(); return; }
  if (e.code === "KeyX") { setOsnap(!state.osnap); return; }
  if (e.code === "KeyY") { setTopoEdit(!state.topoEdit); return; }
  if (e.code === "KeyC" && !e.metaKey && !e.ctrlKey) { setGridSnap(!state.gridSnap); return; }
  if (e.code === "KeyF") { fitView(); return; }
  if (e.code === "KeyR") { rotateSelected(); return; }
  if (e.code === "KeyJ") { joinSelected(); return; }
  const tool = TOOL_CODES[e.code];
  if (tool) { setTool(tool); return; }
  const kind = PRESET_KIND_CODES[e.code];
  if (kind) quickLayerByKind(kind);
});
document.addEventListener("keyup", e => {
  if (e.key === "Shift") { shiftDown = false; if (state.drawing) draw(); }
  if (e.code === "Space") spaceDown = false;
});

