// ============================================================================
//  app-transform.js — интерактивные инструменты преобразования выделения
//  (Поворот / Масштаб / Зеркало). Вынесено из монолита app.js (P0-разрез).
//  Классический скрипт, общий global-scope с app.js. Грузится ПЕРЕД app.js
//  (draw() зовёт xfDrawOverlay на инициализации). Внешние зависимости —
//  runtime-глобали app.js: state, selectionFeatures, toast, snapshot,
//  afterChange, draw, w2s, cvColor, shiftDown.
// ============================================================================

// ---------- интерактивные инструменты преобразования (Поворот/Масштаб/Зеркало) ----------
// единый CAD-поток: выделить объекты (V) → инструмент → клик опорной точки →
// тяга мышью или ввод числа ПРЯМО НА ХОЛСТЕ (без всплывашки) → клик/Enter применить,
// Esc отмена. Превью считается от снимка orig (не накапливается). Общий контекст state.xf.
const XF_META = {
  rotate: { label: "Поворот", base: "кликните опорную точку", act: "двигайте мышь или введите угол (Shift — шаг 15°)" },
  scale:  { label: "Масштаб", base: "кликните опорную точку", act: "двигайте мышь или введите коэффициент" },
  mirror: { label: "Зеркало", base: "кликните первую точку оси", act: "кликните вторую точку оси (двигайте — предпросмотр)" },
};
function xfHint(t) { const el = document.getElementById("st-hint"); if (el) el.textContent = t; }
function xfReset(kind) {
  state.xf = { kind, phase: "base", pivot: null, orig: null, ref: null, val: (kind === "scale" ? 1 : 0), p2: null };
  state.typed = "";
}
function xfStart(kind) {
  xfReset(kind);
  const m = XF_META[kind];
  if (!selectionFeatures().length) {
    toast(`${m.label}: сначала выделите объекты инструментом «Выбор» (V)`, "warn");
    xfHint(`${m.label}: сначала выделите объекты (V)`);
  } else {
    toast(`${m.label}: ${m.base}`);
    xfHint(`${m.label}: ${m.base}`);
  }
}
// снимок исходной геометрии выделения — превью считается от него без накопления
function xfCaptureOrig() {
  const o = {};
  for (const f of selectionFeatures()) {
    o[f.id] = {
      point: f.point ? [f.point[0], f.point[1]] : null,
      line: f.line ? f.line.map(p => [p[0], p[1]]) : null,
      ring: f.ring ? f.ring.map(p => [p[0], p[1]]) : null,
      // дыры полигона тоже преобразуются/восстанавливаются, иначе при повороте/
      // масштабе/зеркале выколотые части остались бы на месте
      holes: f.holes ? f.holes.map(h => h.map(p => [p[0], p[1]])) : null,
      arc: f.arc ? { cx: f.arc.cx, cy: f.arc.cy, r: f.arc.r, a0: f.arc.a0, sweep: f.arc.sweep } : null,
      circle: f.circle ? { cx: f.circle.cx, cy: f.circle.cy, r: f.circle.r } : null,
    };
  }
  return o;
}
function xfTypedNum() { if (!state.typed) return null; const v = parseFloat(state.typed.replace(",", ".")); return isFinite(v) ? v : null; }
// мапперы точки/дуги/окружности для текущего преобразования (все — подобия/отражение,
// поэтому дуги и окружности сохраняются: центр преобразуется, r масштабируется, углы правятся)
function xfMappers(x) {
  const P = x.pivot;
  if (x.kind === "rotate") {
    const c = Math.cos(x.val), s = Math.sin(x.val);
    const pt = ([px, py]) => { const dx = px - P[0], dy = py - P[1]; return [P[0] + dx * c - dy * s, P[1] + dx * s + dy * c]; };
    return { pt, arc: o => ({ ...pt2arc(pt, o), r: o.r, a0: o.a0 + x.val, sweep: o.sweep }),
             circle: o => ({ ...pt2c(pt, o), r: o.r }) };
  }
  if (x.kind === "scale") {
    const f = x.val, af = Math.abs(f);
    const pt = ([px, py]) => [P[0] + (px - P[0]) * f, P[1] + (py - P[1]) * f];
    // При отрицательном коэффициенте центр дуги отражается через опорную точку
    // (центральная симметрия), и КАЖДАЯ точка дуги обязана уехать на угол +π.
    // Раньше a0 оставался прежним: дуга оказывалась на противоположной стороне
    // своей окружности относительно правильного положения.
    const flip = f < 0 ? Math.PI : 0;
    return { pt, arc: o => ({ ...pt2arc(pt, o), r: o.r * af, a0: o.a0 + flip, sweep: o.sweep }),
             circle: o => ({ ...pt2c(pt, o), r: o.r * af }) };
  }
  // mirror: отражение относительно прямой через P с направлением на p2
  const p2 = x.p2 || state.mouse || [P[0] + 1, P[1]];
  let dx = p2[0] - P[0], dy = p2[1] - P[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  const phi = Math.atan2(dy, dx);
  const pt = ([px, py]) => { const vx = px - P[0], vy = py - P[1], d = vx * dx + vy * dy; return [P[0] + 2 * d * dx - vx, P[1] + 2 * d * dy - vy]; };
  return { pt, arc: o => ({ ...pt2arc(pt, o), r: o.r, a0: 2 * phi - o.a0, sweep: -o.sweep }),
           circle: o => ({ ...pt2c(pt, o), r: o.r }) };
}
function pt2arc(pt, o) { const q = pt([o.cx, o.cy]); return { cx: q[0], cy: q[1] }; }
function pt2c(pt, o) { const q = pt([o.cx, o.cy]); return { cx: q[0], cy: q[1] }; }
function xfApplyFromOrig(x) {
  if (!x.pivot || !x.orig) return;
  const M = xfMappers(x);
  for (const f of selectionFeatures()) {
    const o = x.orig[f.id]; if (!o) continue;
    if (o.point) { const q = M.pt(o.point); f.point[0] = q[0]; f.point[1] = q[1]; }
    if (o.line)  { for (let i = 0; i < o.line.length; i++) { const q = M.pt(o.line[i]); f.line[i][0] = q[0]; f.line[i][1] = q[1]; } }
    if (o.ring)  { for (let i = 0; i < o.ring.length; i++) { const q = M.pt(o.ring[i]); f.ring[i][0] = q[0]; f.ring[i][1] = q[1]; } }
    if (o.holes) { for (let h = 0; h < o.holes.length; h++) { const oh = o.holes[h], fh = f.holes[h];
      for (let i = 0; i < oh.length; i++) { const q = M.pt(oh[i]); fh[i][0] = q[0]; fh[i][1] = q[1]; } } }
if (o.arc)   { const a = M.arc(o.arc); f.arc.cx = a.cx; f.arc.cy = a.cy; f.arc.r = a.r; f.arc.a0 = a.a0; f.arc.sweep = a.sweep; }
    if (o.circle){ const c = M.circle(o.circle); f.circle.cx = c.cx; f.circle.cy = c.cy; f.circle.r = c.r; }
  }
}
// вернуть геометрию к снимку orig (для отмены и «чистого» undo перед коммитом)
function xfRestore(x) {
  if (!x.orig) return;
  for (const f of selectionFeatures()) {
    const o = x.orig[f.id]; if (!o) continue;
    if (o.point) { f.point[0] = o.point[0]; f.point[1] = o.point[1]; }
    if (o.line)  { for (let i = 0; i < o.line.length; i++) { f.line[i][0] = o.line[i][0]; f.line[i][1] = o.line[i][1]; } }
    if (o.ring)  { for (let i = 0; i < o.ring.length; i++) { f.ring[i][0] = o.ring[i][0]; f.ring[i][1] = o.ring[i][1]; } }
    if (o.holes) { for (let h = 0; h < o.holes.length; h++) { const oh = o.holes[h], fh = f.holes[h];
      for (let i = 0; i < oh.length; i++) { fh[i][0] = oh[i][0]; fh[i][1] = oh[i][1]; } } }
    if (o.arc)   { f.arc.cx = o.arc.cx; f.arc.cy = o.arc.cy; f.arc.r = o.arc.r; f.arc.a0 = o.arc.a0; f.arc.sweep = o.arc.sweep; }
    if (o.circle){ f.circle.cx = o.circle.cx; f.circle.cy = o.circle.cy; f.circle.r = o.circle.r; }
  }
}
function xfUpdatePreview() {
  const x = state.xf;
  if (!x || x.phase !== "act") return;
  const m = state.mouse || x.pivot;
  if (x.kind === "rotate") {
    const t = xfTypedNum();
    if (t != null) x.val = t * Math.PI / 180;
    else {
      const cur = Math.atan2(m[1] - x.pivot[1], m[0] - x.pivot[0]);
      if (x.ref == null) x.ref = cur;                     // отсчёт — первое движение
      x.val = cur - x.ref;
      if (shiftDown) x.val = Math.round(x.val / (Math.PI / 12)) * (Math.PI / 12);
    }
  } else if (x.kind === "scale") {
    const t = xfTypedNum();
    if (t != null) x.val = t;
    else {
      const dist = Math.hypot(m[0] - x.pivot[0], m[1] - x.pivot[1]);
      if (x.ref == null) { if (dist > 1e-6) x.ref = dist; x.val = 1; }  // эталон-дистанция — первое движение
      else { x.val = dist / x.ref; if (shiftDown) x.val = Math.round(x.val * 10) / 10; }
    }
  } else {                                                 // mirror
    x.p2 = [m[0], m[1]];
  }
  xfApplyFromOrig(x);
}
function xfClickBase(pt) {
  const x = state.xf;
  if (!x) return;
  if (x.phase === "base") {
    if (!selectionFeatures().length) { toast("Сначала выделите объекты (V)", "warn"); return; }
    x.pivot = [pt[0], pt[1]];
    x.orig = xfCaptureOrig();
    x.ref = null; x.val = (x.kind === "scale" ? 1 : 0); x.p2 = null; state.typed = "";
    x.phase = "act";
    xfHint(`${XF_META[x.kind].label}: ${XF_META[x.kind].act} · Enter — применить · Esc — отмена`);
    draw();
  } else {
    xfCommit();
  }
}
function xfCommit() {
  const x = state.xf;
  if (!x || x.phase !== "act") return;
  if (x.kind === "scale" && !(Math.abs(x.val) > 1e-6)) { toast("Коэффициент не может быть 0", "warn"); return; }
  if (x.kind === "mirror") {
    const p2 = x.p2 || state.mouse;
    if (!p2 || Math.hypot(p2[0] - x.pivot[0], p2[1] - x.pivot[1]) < 1e-6) { toast("Отметьте вторую точку оси", "warn"); return; }
  }
  const noop = (x.kind === "rotate" && Math.abs(x.val) < 1e-9) || (x.kind === "scale" && Math.abs(x.val - 1) < 1e-9);
  xfRestore(x);                       // к исходному — undo возьмёт состояние «до»
  if (!noop) {
    snapshot();
    xfApplyFromOrig(x);
    afterChange();
    toast(x.kind === "rotate" ? `Повёрнуто на ${(x.val * 180 / Math.PI).toFixed(1)}°`
        : x.kind === "scale" ? `Масштаб ×${x.val.toFixed(3)}`
        : "Отражено по оси");
  } else { draw(); }
  const kind = x.kind; xfReset(kind);
  xfHint(`${XF_META[kind].label}: ${XF_META[kind].base}`);   // остаёмся в инструменте
  draw();
}
function xfCancel() {
  const x = state.xf;
  if (x && x.phase === "act") xfRestore(x);
  const kind = x ? x.kind : "rotate"; xfReset(kind);
  xfHint(`${XF_META[kind].label}: ${XF_META[kind].base}`);
  draw();
}
function normDeg(rad) { let d = rad * 180 / Math.PI; d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
// оверлей: опора + вспомогательная геометрия + подпись значения возле курсора
function xfDrawOverlay(ctx) {
  const x = state.xf;
  if (!x || x.phase !== "act" || !x.pivot) return;
  ctx.save();
  const accent = cvColor("selection", "#e8a33d");
  const [px, py] = w2s(x.pivot[0], x.pivot[1]);
  ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
  const m = state.mouse || x.pivot;
  const [mx, my] = w2s(m[0], m[1]);
  let label = "";
  if (x.kind === "rotate") {
    const R = Math.max(30, Math.min(90, Math.hypot(mx - px, my - py)));
    const usingMouse = xfTypedNum() == null && x.ref != null;
    const baseDir = usingMouse ? x.ref : 0;              // экран Y вниз → рисуем -угол
    if (usingMouse) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = cvColor("label", "#8b8a85"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(baseDir) * R, py - Math.sin(baseDir) * R); ctx.stroke();
      ctx.setLineDash([]);
    }
    const actDir = baseDir + x.val;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(actDir) * R, py - Math.sin(actDir) * R); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(px, py, Math.min(R, 36), -baseDir, -actDir, x.val > 0); ctx.stroke();
    label = (x.val >= 0 ? "+" : "") + normDeg(x.val).toFixed(1) + "°";
  } else if (x.kind === "scale") {
    ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([]);
    label = "×" + x.val.toFixed(3);
  } else {                                               // mirror — ось симметрии на весь экран
    const p2 = x.p2 || m; const [ax, ay] = w2s(p2[0], p2[1]);
    let vx = ax - px, vy = ay - py; const L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
    const big = 5000;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.setLineDash([9, 5]);
    ctx.beginPath(); ctx.moveTo(px - vx * big, py - vy * big); ctx.lineTo(px + vx * big, py + vy * big); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(ax, ay, 3, 0, 7); ctx.fill();
    label = "ось " + normDeg(Math.atan2(-(ay - py), ax - px)).toFixed(1) + "°";
  }
  if (label) {
    ctx.font = "600 13px sans-serif"; ctx.textAlign = "left";
    const tw = ctx.measureText(label).width + 14, bx = mx + 14, by = my - 30;
    ctx.fillStyle = cvColor("selection", "#1c1c1a"); ctx.fillRect(bx, by, tw, 20);
    ctx.fillStyle = "#fff"; ctx.fillText(label, bx + 7, by + 14);
  }
  ctx.restore();
}
