// ============================================================================
//  app-snap.js — движок объектных привязок (osnap) и курсор-точка.
//  Вынесено из монолита app.js (P0-разрез). Классический скрипт, общий
//  global-scope. Грузится ПЕРЕД app.js (draw() зовёт drawSnapMarker на init).
//  Внешние зависимости — runtime-глобали app.js: state, cv, w2s, cvColor,
//  featurePts, layerOf, isHidden, isLocked, LAYERS_V2, gridStep, lastDrawingPt,
//  selectionIds, shiftDown, ctx, и гео-примитивы (segIntersect/isAngleInSweep/
//  segCircleIntersections/circleCircleIntersections — общие, в app.js).
//
//  P1: ПРОСТРАНСТВЕННЫЙ ИНДЕКС. Раньше collectSnapPts/segmentsOf/intersections
//  перебирали ВСЕ объекты на каждое движение мыши (O(N)), а intersections имел
//  тихий срез 400 сегментов (пересечения молча терялись). Теперь — грид-индекс
//  над всеми видимыми объектами (кеш state._snapIndex, инвалидация вместе с
//  state._ix), запросы берут только ячейки у курсора: O(кандидатов рядом),
//  пересечения считаются без среза. Поведение привязок сохранено 1:1.
// ============================================================================

function featureChains(f) {
  if (f.ring) {
    // все кольца: внешнее + ДЫРЫ — иначе к границе выколотой части нельзя
    // привязаться, а Trim/Extend не видят её рёбра как границы
    const chains = [[...f.ring, f.ring[0]]];
    for (const h of (f.holes || [])) if (h && h.length >= 3) chains.push([...h, h[0]]);
    return chains;
  }
  if (f.line) return [f.line];
  if (f.arc) {
    // approx for hit/snap: sample arc
    const a = f.arc; const n=12; const pts=[];
    for(let i=0;i<=n;i++){ const ang=a.a0 + a.sweep*i/n; pts.push([a.cx + a.r*Math.cos(ang), a.cy + a.r*Math.sin(ang)]); }
    return [pts];
  }
  if (f.circle) {
    const c = f.circle; const n=24; const pts=[];
    for(let i=0;i<=n;i++){ const ang = i/n * 2*Math.PI; pts.push([c.cx + c.r*Math.cos(ang), c.cy + c.r*Math.sin(ang)]); }
    return [pts];
  }
  return [];
}

// ---------- привязки (уровень CAD) ----------
const SNAP_PRIORITY = { "вершина": 0, "пересечение": 1, "квадрант": 1, "середина": 2,
                        "перпендикуляр": 2, "касательная": 2, "центр": 3, "ближайшая": 4 };

function _excludeSet(exclude) {
  if (exclude == null) return null;
  return exclude instanceof Set ? exclude : new Set([].concat(exclude));
}

// ---------- пространственный индекс (P1) ----------
// строится над ВСЕМИ видимыми объектами (exclude применяется при запросе, а не
// при постройке — потому не надо перестраивать при смене exclude/во время drag,
// где своя фигура и так исключена). Кеш state._snapIndex; инвалидация вместе с
// state._ix (afterChange и live-edit). Точки/сегменты/кривые разложены по
// ячейкам грид-сетки; вершины дополнительно — по X/Y-бандам (для направляющих).
function snapIndex() {
  if (state._snapIndex) return state._snapIndex;
  const pts = [], segs = [], curves = [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const bump = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
  for (const f of state.features) {
    // catOff — из app.js (общий global-scope, зовётся в рантайме): скрытая
    // категорией геометрия не должна давать привязок, как и скрытый слой.
    // typeof-гейт — для node-тестов, гоняющих app-snap.js изолированно.
    if (isHidden(f) ||
        (typeof catOff === "function" && catOff(layerOf(f), f))) continue;
    const id = f.id;
    if (f.point) { pts.push({ p: f.point, kind: "вершина", id }); bump(f.point[0], f.point[1]); }
    if (f.circle) {
      const c = f.circle;
      pts.push({ p: [c.cx, c.cy], kind: "центр", id },
               { p: [c.cx + c.r, c.cy], kind: "квадрант", id }, { p: [c.cx - c.r, c.cy], kind: "квадрант", id },
               { p: [c.cx, c.cy + c.r], kind: "квадрант", id }, { p: [c.cx, c.cy - c.r], kind: "квадрант", id });
      curves.push({ cx: c.cx, cy: c.cy, r: c.r, full: true, id });
      bump(c.cx - c.r, c.cy - c.r); bump(c.cx + c.r, c.cy + c.r);
    }
    if (f.arc) {
      const a = f.arc;
      pts.push({ p: [a.cx, a.cy], kind: "центр", id },
               { p: [a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)], kind: "вершина", id },
               { p: [a.cx + a.r * Math.cos(a.a0 + a.sweep), a.cy + a.r * Math.sin(a.a0 + a.sweep)], kind: "вершина", id },
               { p: [a.cx + a.r * Math.cos(a.a0 + a.sweep / 2), a.cy + a.r * Math.sin(a.a0 + a.sweep / 2)], kind: "середина", id });
      curves.push({ cx: a.cx, cy: a.cy, r: a.r, a0: a.a0, sweep: a.sweep, full: false, id });
      bump(a.cx - a.r, a.cy - a.r); bump(a.cx + a.r, a.cy + a.r);
    }
    for (const chain of featureChains(f)) {
      for (let i = 0; i + 1 < chain.length; i++) {
        const A = chain[i], B = chain[i + 1];
        pts.push({ p: A, kind: "вершина", id },
                 { p: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], kind: "середина", id });
        segs.push({ a: A, b: B, id });
        bump(A[0], A[1]); bump(B[0], B[1]);
      }
    }
    if (f.ring) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of f.ring) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      pts.push({ p: [(x0 + x1) / 2, (y0 + y1) / 2], kind: "центр", id });
    }
  }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 100;
  const cellSize = Math.max(diag / 160, 1e-6);
  const cellOf = v => Math.floor(v / cellSize);
  const cells = new Map();
  const cell = (cx, cy) => { const k = cx + "_" + cy; let e = cells.get(k); if (!e) { e = { pts: [], segs: [], curves: [] }; cells.set(k, e); } return e; };
  const band = (m, k, pt) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(pt); };
  const vx = new Map(), vy = new Map();
  for (const pt of pts) {
    cell(cellOf(pt.p[0]), cellOf(pt.p[1])).pts.push(pt);
    if (pt.kind === "вершина") { band(vx, cellOf(pt.p[0]), pt); band(vy, cellOf(pt.p[1]), pt); }
  }
  for (const s of segs) {
    const cx0 = cellOf(Math.min(s.a[0], s.b[0])), cx1 = cellOf(Math.max(s.a[0], s.b[0]));
    const cy0 = cellOf(Math.min(s.a[1], s.b[1])), cy1 = cellOf(Math.max(s.a[1], s.b[1]));
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) cell(cx, cy).segs.push(s);
  }
  for (const cv of curves) {
    const cx0 = cellOf(cv.cx - cv.r), cx1 = cellOf(cv.cx + cv.r), cy0 = cellOf(cv.cy - cv.r), cy1 = cellOf(cv.cy + cv.r);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) cell(cx, cy).curves.push(cv);
  }
  return (state._snapIndex = { cells, cellOf, vx, vy });
}

// кандидаты (точки/сегменты/кривые) в ячейках грид-сетки, покрывающих
// [wx±tolW, wy±tolW]. Сегменты/кривые дедуплицируются (могут попасть в неск. ячеек).
function snapQuery(wx, wy, tolW) {
  const idx = snapIndex();
  const cx0 = idx.cellOf(wx - tolW), cx1 = idx.cellOf(wx + tolW);
  const cy0 = idx.cellOf(wy - tolW), cy1 = idx.cellOf(wy + tolW);
  const pts = [], segs = [], curves = [];
  const segSeen = new Set(), curveSeen = new Set();
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const e = idx.cells.get(cx + "_" + cy); if (!e) continue;
    for (const p of e.pts) pts.push(p);
    for (const s of e.segs) if (!segSeen.has(s)) { segSeen.add(s); segs.push(s); }
    for (const c of e.curves) if (!curveSeen.has(c)) { curveSeen.add(c); curves.push(c); }
  }
  return { pts, segs, curves };
}

// пересечения ТОЛЬКО среди near-cursor кандидатов (сегмент×сегмент, сегмент×
// кривая, кривая×кривая). Кандидатов рядом мало → полно и быстро, без среза 400.
function nearIntersections(q) {
  const out = [], segs = q.segs, curves = q.curves;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const p = segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (p) out.push(p);
    }
  const onC = (p, c) => c.full || isAngleInSweep(Math.atan2(p[1] - c.cy, p[0] - c.cx), c.a0, c.sweep);
  for (const s of segs)
    for (const c of curves)
      for (const p of segCircleIntersections(s.a, s.b, c.cx, c.cy, c.r))
        if (onC(p, c)) out.push(p);
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      for (const p of circleCircleIntersections(curves[i].cx, curves[i].cy, curves[i].r, curves[j].cx, curves[j].cy, curves[j].r))
        if (onC(p, curves[i]) && onC(p, curves[j])) out.push(p);
  return out;
}

function footOnLine(p, a, b, clamp) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  if (clamp) t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

function tangentPointsToArc(from, arc) {
  const dx = arc.cx - from[0], dy = arc.cy - from[1];
  const dist = Math.hypot(dx, dy);
  if (dist < arc.r + 1e-9) return [];
  const leg = Math.sqrt(dist * dist - arc.r * arc.r);
  const ang = Math.atan2(dy, dx);
  const delta = Math.asin(arc.r / dist);
  const pts = [];
  for (const sign of [1, -1]) {
    const tAng = ang + sign * delta;
    pts.push([arc.cx + arc.r * Math.cos(tAng), arc.cy + arc.r * Math.sin(tAng)]);
  }
  return pts;
}

// exclude — id объектов, исключаемых из привязок (свой при правке);
// from — опорная точка для «перпендикуляр» (последняя точка построения)
function snapPoint(wx, wy, exclude, from) {
  state.guides = [];
  const tolW = 10 / state.view.k;
  const ex = _excludeSet(exclude);
  if (state.osnap) {
    const q = snapQuery(wx, wy, tolW);
    let best = null;
    // 1. точечные привязки по приоритету (вершина/середина/центр/квадрант)
    for (const c of q.pts) {
      if (ex && ex.has(c.id)) continue;
      const d = Math.hypot(c.p[0] - wx, c.p[1] - wy);
      if (d > tolW) continue;
      const key = [SNAP_PRIORITY[c.kind], d];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1]))
        best = { p: [...c.p], kind: c.kind, key };
    }
    // пересечения — near-cursor, без среза (учитываем exclude через кандидатов)
    for (const p of nearIntersections(q)) {
      const d = Math.hypot(p[0] - wx, p[1] - wy);
      if (d <= tolW && (!best || best.key[0] > 1 || (best.key[0] === 1 && d < best.key[1])))
        best = { p: [...p], kind: "пересечение", key: [1, d] };
    }
    // перпендикуляр: основание перпендикуляра из опорной точки на прямую ребра
    if (from) {
      for (const s of q.segs) {
        if (ex && ex.has(s.id)) continue;
        const foot = footOnLine(from, s.a, s.b, false);
        const d = Math.hypot(foot[0] - wx, foot[1] - wy);
        if (d > tolW) continue;
        const key = [SNAP_PRIORITY["перпендикуляр"], d];
        if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1]))
          best = { p: foot, kind: "перпендикуляр", key };
      }
      // касательные к дугам и окружностям от опорной точки
      for (const cv of q.curves) {
        if (ex && ex.has(cv.id)) continue;
        for (const tp of tangentPointsToArc(from, cv)) {
          const d = Math.hypot(tp[0] - wx, tp[1] - wy);
          if (d > tolW) continue;
          const key = [SNAP_PRIORITY["касательная"], d];
          if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1]))
            best = { p: tp, kind: "касательная", key };
        }
      }
    }
    if (best) return { p: best.p, kind: best.kind };
    // 2. направляющие выравнивания по вершинам (X/Y-банды индекса)
    const idx = snapIndex();
    let gx = null, gy = null;
    for (let cx = idx.cellOf(wx - tolW); cx <= idx.cellOf(wx + tolW); cx++) {
      const band = idx.vx.get(cx); if (!band) continue;
      for (const c of band) {
        if (ex && ex.has(c.id)) continue;
        if (Math.abs(c.p[0] - wx) < tolW && (!gx || Math.abs(c.p[0] - wx) < Math.abs(gx.p[0] - wx))) gx = c;
      }
    }
    for (let cy = idx.cellOf(wy - tolW); cy <= idx.cellOf(wy + tolW); cy++) {
      const band = idx.vy.get(cy); if (!band) continue;
      for (const c of band) {
        if (ex && ex.has(c.id)) continue;
        if (Math.abs(c.p[1] - wy) < tolW && (!gy || Math.abs(c.p[1] - wy) < Math.abs(gy.p[1] - wy))) gy = c;
      }
    }
    if (gx || gy) {
      const p = [gx ? gx.p[0] : wx, gy ? gy.p[1] : wy];
      if (gx) state.guides.push([gx.p, p]);
      if (gy) state.guides.push([gy.p, p]);
      return { p, kind: "выравнивание" };
    }
    // 2b. ближайшая точка на ребре — низший приоритет объектной привязки
    let near = null;
    for (const s of q.segs) {
      if (ex && ex.has(s.id)) continue;
      const foot = footOnLine([wx, wy], s.a, s.b, true);
      const d = Math.hypot(foot[0] - wx, foot[1] - wy);
      if (d <= tolW && (!near || d < near.d)) near = { p: foot, d };
    }
    // ближайшая точка на окружности/дуге (проекция курсора на кривую)
    for (const cv of q.curves) {
      if (ex && ex.has(cv.id)) continue;
      if (cv.full) {
        const dx = wx - cv.cx, dy = wy - cv.cy, dl = Math.hypot(dx, dy) || 1e-9;
        const p = [cv.cx + cv.r * dx / dl, cv.cy + cv.r * dy / dl];
        const d = Math.hypot(p[0] - wx, p[1] - wy);
        if (d <= tolW && (!near || d < near.d)) near = { p, d };
      } else {
        let ang = Math.atan2(wy - cv.cy, wx - cv.cx);
        if (!isAngleInSweep(ang, cv.a0, cv.sweep)) {   // вне дуги — прижать к ближнему концу
          const e0 = cv.a0, e1 = cv.a0 + cv.sweep;
          const dst = t => Math.abs(((ang - t + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
          ang = dst(e0) < dst(e1) ? e0 : e1;
        }
        const p = [cv.cx + cv.r * Math.cos(ang), cv.cy + cv.r * Math.sin(ang)];
        const d = Math.hypot(p[0] - wx, p[1] - wy);
        if (d <= tolW && (!near || d < near.d)) near = { p, d };
      }
    }
    if (near) return { p: near.p, kind: "ближайшая" };
  }
  // 3. сетка
  if (state.gridSnap) {
    const g = gridStep();
    return { p: [Math.round(wx / g) * g, Math.round(wy / g) * g], kind: "сетка" };
  }
  return { p: [wx, wy], kind: null };
}

function orthoProject(base, wx, wy) {
  // фиксация направления на 0/45/90° (Shift)
  const dx = wx - base[0], dy = wy - base[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return [wx, wy];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [base[0] + dist * Math.cos(a), base[1] + dist * Math.sin(a)];
}

function cursorPoint(wx, wy) {
  const base = lastDrawingPt();
  if (shiftDown && base) {
    const [ox, oy] = orthoProject(base, wx, wy);
    if (state.gridSnap) {
      // выравниваем длину по шагу сетки вдоль зафиксированного направления
      const g = gridStep();
      const d = Math.round(Math.hypot(ox - base[0], oy - base[1]) / g) * g;
      const a = Math.atan2(oy - base[1], ox - base[0]);
      return { p: [base[0] + d * Math.cos(a), base[1] + d * Math.sin(a)], kind: "орто" };
    }
    return { p: [ox, oy], kind: "орто" };
  }
  // from=base: во время построения доступна привязка «перпендикуляр»
  let exclude = state.edit && state.edit.f ? state.edit.f.id : undefined;
  // инструменты преобразования в фазе «act»: выделение движется вместе с превью,
  // поэтому реф/ось/масштаб привязываем к ФИКСИРОВАННЫМ объектам, исключая само
  // выделение (иначе привязка цепляется за ползущую геометрию). Опорная точка
  // (фаза «base») привязывается ко всему — в т.ч. к вершинам самого объекта.
  if (state.xf && state.xf.phase === "act") exclude = new Set(selectionIds());
  return snapPoint(wx, wy, exclude, base);
}

function drawSnapMarker() {
  const s = state.snapHit;
  // в «Выборе» маркер нужен при переносе/правке (state.edit), иначе скрыт
  if (!s || !s.kind || (state.tool === "select" && !state.edit)) return;
  const [sx, sy] = w2s(...s.p);
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = cvColor("shared", "#12a150");
  if (s.kind === "вершина") ctx.strokeRect(sx - 5, sy - 5, 10, 10);
  else if (s.kind === "середина") {
    ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 6, sy + 5); ctx.lineTo(sx - 6, sy + 5);
    ctx.closePath(); ctx.stroke();
  } else if (s.kind === "пересечение") {
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
    ctx.moveTo(sx - 5, sy + 5); ctx.lineTo(sx + 5, sy - 5); ctx.stroke();
  } else if (s.kind === "центр") {
    ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 7); ctx.stroke();
  } else if (s.kind === "перпендикуляр") {
    ctx.beginPath();                          // ⊥ — прямой угол
    ctx.moveTo(sx - 6, sy - 6); ctx.lineTo(sx - 6, sy + 6); ctx.lineTo(sx + 6, sy + 6);
    ctx.moveTo(sx - 6, sy); ctx.lineTo(sx, sy); ctx.lineTo(sx, sy + 6); ctx.stroke();
  } else if (s.kind === "ближайшая") {
    ctx.beginPath();                          // ◇ — ромб на ребре
    ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 5, sy);
    ctx.lineTo(sx, sy + 5); ctx.lineTo(sx - 5, sy); ctx.closePath(); ctx.stroke();
  } else if (s.kind === "выравнивание" || s.kind === "орто") {
    ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.stroke();
  } else if (s.kind === "сетка") {
    ctx.strokeStyle = cvColor("label", "#9a978f");
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
    ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4); ctx.stroke();
  }
  ctx.restore();
}
