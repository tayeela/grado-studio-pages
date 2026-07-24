// ГРАДО Студия · часть 4 из 14 (грузится после app-geodesy.js).
// геометрия объектов и эквидистанта
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- геометрия ----------
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
// Площадь полигона С УЧЁТОМ дыр: выколотая часть не принадлежит объекту, иначе
// ТЭП считал бы её как зону (выколотые полигоны ОГД). Знак обхода колец в
// данных портала не гарантирован, поэтому вычитаем модуль площади каждой дыры.
function featureArea(f) {
  if (!f || !f.ring) return 0;
  let a = ringArea(f.ring);
  for (const h of f.holes || []) {
    if (h && h.length >= 3) a -= ringArea(h);
  }
  return Math.max(0, a);
}
function lineLen(line) {
  let s = 0;
  for (let i = 0; i + 1 < line.length; i++)
    s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return s;
}
// единые форматтеры отображения — одна точность везде (длины/координаты 1 знак,
// площади в гектарах 2 знака). Возвращают строку без хвостовой единицы там,
// где единица дописывается на месте (fmtCoord), и с единицей — где удобно.
function fmtLen(m) { return (+m).toFixed(1) + " м"; }
function fmtCoord(m) { return (+m).toFixed(1); }
function fmtAreaHa(m2) { return (m2 / 10000).toFixed(2) + " га"; }
// Точка внутри полигона С УЧЁТОМ дыр: в выколотой части объекта нет, поэтому
// клик там не должен его выбирать (и «Данные по области» не должны считать её
// своей). Границу дыры ловит отдельно nearRing — за контур схватить можно.
function pointInPolygon(x, y, f) {
  if (!f.ring || !pointInRing(x, y, f.ring)) return false;
  for (const h of f.holes || []) {
    if (h && h.length >= 3 && pointInRing(x, y, h)) return false;
  }
  return true;
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}
function nearChain(x, y, chain, tolW) {
  for (let i = 0; i + 1 < chain.length; i++) {
    const q = nearestOnSeg([x, y], chain[i], chain[i + 1]);
    if (Math.hypot(x - q[0], y - q[1]) < tolW) return i;
  }
  return null;
}
function segIntersect(a0, a1, b0, b1) {
  const d0 = [a1[0] - a0[0], a1[1] - a0[1]], d1 = [b1[0] - b0[0], b1[1] - b0[1]];
  const det = d0[0] * d1[1] - d0[1] * d1[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * d1[1] - (b0[1] - a0[1]) * d1[0]) / det;
  const u = ((b0[0] - a0[0]) * d0[1] - (b0[1] - a0[1]) * d0[0]) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a0[0] + d0[0] * t, a0[1] + d0[1] * t];
}
// параметр t точки p на прямой a-b (0 = a, 1 = b), без ограничения диапазона
function paramOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
}
// пересечение луча a→b, продолженного ЗА b (t>=1), с ограниченным отрезком c-d
// (u в [0,1]) — для продления линии до границы
function rayIntersect(a, b, c, d) {
  const d0 = [b[0] - a[0], b[1] - a[1]], d1 = [d[0] - c[0], d[1] - c[1]];
  const det = d0[0] * d1[1] - d0[1] * d1[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((c[0] - a[0]) * d1[1] - (c[1] - a[1]) * d1[0]) / det;
  const u = ((c[0] - a[0]) * d0[1] - (c[1] - a[1]) * d0[0]) / det;
  if (t < 1 - 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + d0[0] * t, a[1] + d0[1] * t];
}

// пересечение отрезка a-b с окружностью (c,r) — возвращает точки на отрезке
function circleIntersect(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c[0], fy = a[1] - c[1];
  const aa = dx*dx + dy*dy;
  const bb = 2 * (fx*dx + fy*dy);
  const cc = fx*fx + fy*fy - r*r;
  const disc = bb*bb - 4*aa*cc;
  if (disc < 0) return [];
  const sd = Math.sqrt(disc);
  const t1 = (-bb - sd) / (2*aa);
  const t2 = (-bb + sd) / (2*aa);
  const res = [];
  if (t1 >= 0 && t1 <= 1) res.push([a[0] + t1*dx, a[1] + t1*dy]);
  if (t2 >= 0 && t2 <= 1 && Math.abs(t2-t1) > 1e-9) res.push([a[0] + t2*dx, a[1] + t2*dy]);
  return res;
}

// Доп. утилиты для точной работы окружностей как границ (trim/extend)
function circleCircleIntersections(cx1, cy1, r1, cx2, cy2, r2) {
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const d = Math.hypot(dx, dy);
  if (d > r1 + r2 + 1e-9 || d + 1e-9 < Math.abs(r1 - r2) || d < 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hh = r1 * r1 - a * a;
  if (hh < 0) return [];
  const h = Math.sqrt(hh);
  const xm = cx1 + a * dx / d;
  const ym = cy1 + a * dy / d;
  const res = [[xm + h * dy / d, ym - h * dx / d]];
  if (h > 1e-9) res.push([xm - h * dy / d, ym + h * dx / d]);
  return res;
}
// пересечения отрезка [a,b] с окружностью (cx,cy,r) — точки в пределах отрезка
function segCircleIntersections(a, b, cx, cy, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - cx, fy = a[1] - cy;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  disc = Math.sqrt(disc);
  const out = [];
  for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)])
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push([a[0] + t * dx, a[1] + t * dy]);
  return out;
}
function isAngleInSweep(ang, a0, sweep) {
  if (Math.abs(sweep) < 1e-9) return false;
  const PI2 = 2 * Math.PI;
  let d = ((ang - a0) % PI2 + PI2) % PI2;
  if (sweep > 0) {
    return d >= -1e-9 && d <= sweep + 1e-9;
  } else {
    let dd = ((a0 - ang) % PI2 + PI2) % PI2;
    return dd >= -1e-9 && dd <= (-sweep) + 1e-9;
  }
}
function locateOnChain(chain, q) {
  if (!chain || chain.length < 2) return { i: -1, t: 0, d: 1e9 };
  let best = { i: 0, t: 0, d: 1e9 };
  for (let i = 0; i + 1 < chain.length; i++) {
    const proj = nearestOnSeg(q, chain[i], chain[i + 1]);
    const d = Math.hypot(proj[0] - q[0], proj[1] - q[1]);
    if (d < best.d) {
      const t = paramOnSeg(proj, chain[i], chain[i + 1]);
      best = { i, t, d };
    }
  }
  return best;
}

// Полноценный trim/ extend для дуг с сохранением arc-параметров (cx,cy,r,a0,sweep)
function trimArcAt(f, wx, wy, boundaryIds) {
  const arc = f.arc;
  const chain = featurePts(f);
  const tolW = 10 / state.view.k;
  const si = nearChain(wx, wy, chain, tolW);
  if (si == null) return false;
  const sa = chain[si], sb = chain[si+1];
  const tClick = paramOnSeg(nearestOnSeg([wx, wy], sa, sb), sa, sb);
  let bestP = null;
  let bestT = 1e9;
  let bestDistCircle = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle;
      let cands = [];
      // точные пересечения двух окружностей + фильтр по дуге
      try {
        const ints = circleCircleIntersections(arc.cx, arc.cy, arc.r, cs.cx, cs.cy, cs.r);
        for (let pt of ints) {
          const ang = Math.atan2(pt[1] - arc.cy, pt[0] - arc.cx);
          if (isAngleInSweep(ang, arc.a0, arc.sweep)) cands.push(pt);
        }
      } catch (e) {}
      if (cands.length === 0) {
        // fallback: по всем сегментам сэмпла
        for (let j = 0; j + 1 < chain.length; j++) {
          const ps = circleIntersect(chain[j], chain[j + 1], [cs.cx, cs.cy], cs.r);
          cands.push(...ps);
        }
      }
      for (let p of cands) {
        const d = Math.hypot(p[0] - wx, p[1] - wy);
        if (bestP == null || d < bestDistCircle) {
          bestDistCircle = d;
          bestP = p;
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf)) {
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = segIntersect(sa, sb, bchain[j], bchain[j+1]);
        if (!p) continue;
        const t = paramOnSeg(p, sa, sb);
        if (Math.abs(t - tClick) < Math.abs(bestT - tClick)) {
          bestP = p;
          bestT = t;
        }
      }
    }
  }
  if (!bestP) return false;
  snapshot();
  const pAng = Math.atan2(bestP[1] - arc.cy, bestP[0] - arc.cx);
  const a0 = arc.a0;
  const sw = arc.sweep;
  const eAng = a0 + sw;
  // для circle-boundary используем closest к клику + проверка углов для выбора стороны
  // (глобальный поиск позволяет кликать не точно на сэмпл-сегменте)
  if (bestDistCircle != null) {
    const cAng = Math.atan2(wy - arc.cy, wx - arc.cx);
    const cand1 = { a0: a0, sw: pAng - a0 }; // keep start..p
    const cand2 = { a0: pAng, sw: eAng - pAng }; // keep p..end
    const n1 = (cand1.sw > Math.PI ? cand1.sw - 2*Math.PI : (cand1.sw < -Math.PI ? cand1.sw + 2*Math.PI : cand1.sw));
    const n2 = (cand2.sw > Math.PI ? cand2.sw - 2*Math.PI : (cand2.sw < -Math.PI ? cand2.sw + 2*Math.PI : cand2.sw));
    const in1 = isAngleInSweep(cAng, cand1.a0, n1);
    const in2 = isAngleInSweep(cAng, cand2.a0, n2);
    if (in1 && !in2) {
      arc.a0 = pAng; arc.sweep = eAng - pAng;
    } else if (in2 && !in1) {
      arc.a0 = a0; arc.sweep = pAng - a0;
    } else {
      // fallback по углам
      if ((cAng - a0) > (pAng - a0)) arc.sweep = pAng - a0; else { arc.a0 = pAng; arc.sweep = eAng - pAng; }
    }
  } else if (tClick > bestT) {
    arc.sweep = pAng - a0;
  } else {
    arc.a0 = pAng;
    arc.sweep = eAng - pAng;
  }
  arc.sweep = sweepLike(arc.sweep, sw);
  afterChange();
  return true;
}

// Развёртка после обрезки/продления. Зажимать сырую разность atan2-углов в
// ±180° нельзя: дуга больше полуокружности (arcFrom3Pts строит такие намеренно)
// превращалась в своё дополнение с ДРУГОЙ стороны окружности — оставался не тот
// кусок, по которому кликнули. Приводим к направлению исходного обхода,
// сохраняя величину вплоть до полного круга.
function sweepLike(sweep, ref) {
  if (!Number.isFinite(sweep)) return sweep;
  const TAU = 2 * Math.PI;
  let s = sweep % TAU;
  if (Math.abs(s) < 1e-9) return 0;
  if (ref >= 0 && s < 0) s += TAU;
  if (ref < 0 && s > 0) s -= TAU;
  return s;
}

function extendArcAt(f, wx, wy, boundaryIds) {
  const arc = f.arc;
  const chain = featurePts(f);
  const tolW = 14 / state.view.k;
  const n = chain.length;
  const dStart = Math.hypot(wx - chain[0][0], wy - chain[0][1]);
  const dEnd = Math.hypot(wx - chain[n-1][0], wy - chain[n-1][1]);
  if (dStart >= tolW && dEnd >= tolW) return false;
  const extEnd = dEnd <= dStart;
  const idxA = extEnd ? n-2 : 1;
  const idxB = extEnd ? n-1 : 0;
  const aa = chain[idxA], bb = chain[idxB];
  let bestP = null;
  let minDist = 1e9;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      const dx = bb[0]-aa[0], dy = bb[1]-aa[1];
      const fx = aa[0]-cc[0], fy = aa[1]-cc[1];
      const aa_ = dx*dx + dy*dy;
      const bb_ = 2*(fx*dx + fy*dy);
      const cc_ = fx*fx + fy*fy - rr*rr;
      const disc = bb_*bb_ - 4*aa_*cc_;
      if (disc >= 0) {
        const sd = Math.sqrt(disc);
        const t1 = (-bb_ - sd)/(2*aa_);
        const t2 = (-bb_ + sd)/(2*aa_);
        for (let t of [t1, t2]) {
          if (t >= 1 - 1e-9) {
            const p = [aa[0] + t*dx, aa[1] + t*dy];
            const dist = Math.hypot(p[0] - bb[0], p[1] - bb[1]);
            if (dist < minDist) {
              minDist = dist;
              bestP = p;
            }
          }
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf)) {
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = rayIntersect(aa, bb, bchain[j], bchain[j+1]);
        if (!p) continue;
        const dist = Math.hypot(p[0] - bb[0], p[1] - bb[1]);
        if (dist < minDist) {
          minDist = dist;
          bestP = p;
        }
      }
    }
  }
  if (!bestP) return false;
  snapshot();
  const pAng = Math.atan2(bestP[1] - arc.cy, bestP[0] - arc.cx);
  const sw0 = arc.sweep;
  if (extEnd) {
    arc.sweep = pAng - arc.a0;
  } else {
    const eAng = arc.a0 + arc.sweep;
    arc.a0 = pAng;
    arc.sweep = eAng - pAng;
  }
  arc.sweep = sweepLike(arc.sweep, sw0);
  afterChange();
  return true;
}

// обрезка: si — сегмент клика на f.line, boundaryIds — выбранные линии-границы.
// Отсекается та часть сегмента, где был клик, вплоть до ближайшего пересечения.
function trimLineAt(f, wx, wy, boundaryIds) {
  let chain = f.line;
  if (!chain || chain.length < 2) return false;
  const tolW = 10 / state.view.k;
  const si = nearChain(wx, wy, chain, tolW);
  if (si == null) return false;
  const a = chain[si], b = chain[si + 1];
  const tClick = paramOnSeg(nearestOnSeg([wx, wy], a, b), a, b);
  let best = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      // глобальный поиск по всей линии (не только клик-сегмент) — клик в "лишний кусок" находит ближайшее пересечение с окружностью
      for (let j = 0; j + 1 < chain.length; j++) {
        const ps = circleIntersect(chain[j], chain[j + 1], cc, rr);
        for (let p of ps) {
          const dd = Math.hypot(p[0] - wx, p[1] - wy);
          if (!best || dd < best.dd) best = { p, dd, fromCircle: true };
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf))
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = segIntersect(a, b, bchain[j], bchain[j + 1]);
        if (!p) continue;
        const t = paramOnSeg(p, a, b);
        // Кандидаты от окружностей и от отрезков сравниваются ОДНОЙ метрикой —
        // расстоянием от точки клика до пересечения. Раньше у окружности был dd,
        // у отрезка — |t − tClick|, и сравнение шло между несравнимым: тернарник
        // «best.dd != null ? … : true» пропускал окружность безусловно, а
        // Math.abs(best.t − tClick) при best от окружности давал NaN, из-за чего
        // отрезок не выигрывал никогда. Резало по типу границы, а не по близости.
        const dd = Math.hypot(p[0] - wx, p[1] - wy);
        if (!best || dd < best.dd) best = { t, p, dd };
      }
  }
  if (!best) return false;
  snapshot();
  if (best.fromCircle) {
    // обобщённое решение стороны по позиции клика и p на всей цепочке
    const locC = locateOnChain(chain, [wx, wy]);
    const locP = locateOnChain(chain, best.p);
    const clickAfter = (locC.i > locP.i) || (locC.i === locP.i && locC.t > locP.t + 1e-9);
    const k = locP.i >= 0 ? locP.i : si;
    f.line = clickAfter
      ? [...chain.slice(0, k + 1), best.p]
      : [best.p, ...chain.slice(k + 1)];
  } else {
    const newChain = tClick > best.t
      ? [...chain.slice(0, si + 1), best.p]
      : [best.p, ...chain.slice(si + 1)];
    f.line = newChain;
  }
  afterChange();
  return true;
}
// продление: клик у открытого конца f.line — тянем его до пересечения с
// ближайшей выбранной границей (не заходя ЗА границу, u в [0,1] на ней)
function extendLineAt(f, wx, wy, boundaryIds) {
  let chain = f.line;
  if (!chain || chain.length < 2 || !chain[0] || !chain[chain.length-1]) return false;
  const tolW = 14 / state.view.k, n = chain.length;
  const dStart = Math.hypot(wx - chain[0][0], wy - chain[0][1]);
  const dEnd = Math.hypot(wx - chain[n - 1][0], wy - chain[n - 1][1]);
  if (dStart >= tolW && dEnd >= tolW) return false;
  const end = dEnd <= dStart;
  const a = end ? chain[n - 2] : chain[1];
  const b = end ? chain[n - 1] : chain[0];
  let best = null;
  for (const bid of boundaryIds) {
    const bf = state.features.find(x => x.id === bid);
    if (!bf) continue;
    if (bf.circle) {
      const cs = bf.circle; const cc = [cs.cx, cs.cy]; const rr = cs.r;
      const dx = b[0]-a[0], dy = b[1]-a[1];
      const fx = a[0]-cc[0], fy = a[1]-cc[1];
      const aa = dx*dx + dy*dy;
      const bb = 2*(fx*dx + fy*dy);
      const cc_ = fx*fx + fy*fy - rr*rr;
      const disc = bb*bb - 4*aa*cc_;
      if (disc < 0) { /* no */ } else {
        const sd = Math.sqrt(disc);
        const t1 = (-bb - sd)/(2*aa);
        const t2 = (-bb + sd)/(2*aa);
        for (let t of [t1,t2]) {
          if (t >= 1 - 1e-9) {
            const p = [a[0] + t*dx, a[1] + t*dy];
            const dist = Math.hypot(p[0] - b[0], p[1] - b[1]);
            if (!best || dist < best.dist) best = { p, dist };
          }
        }
      }
      continue;
    }
    for (const bchain of featureChains(bf))
      for (let j = 0; j + 1 < bchain.length; j++) {
        const p = rayIntersect(a, b, bchain[j], bchain[j + 1]);
        if (!p) continue;
        const dist = Math.hypot(p[0] - b[0], p[1] - b[1]);
        if (!best || dist < best.dist) best = { p, dist };
      }
  }
  if (!best) return false;
  snapshot();
  if (end) chain[n - 1] = best.p; else chain[0] = best.p;
  afterChange();
  return true;
}
// клик в режиме trim/extend: пока границы не подтверждены (Enter) — клик по
// линии переключает её как границу; после подтверждения — клик режет/тянет цель
function handleTrimExtendClick(wx, wy) {
  const ctx2 = state.trimCtx;
  if (!ctx2) return;
  const f = hitTest(wx, wy);
  if (!ctx2.ready) {
    if (!f || (!f.line && !f.ring && !f.arc && !f.circle)) return;
    if (ctx2.boundary.has(f.id)) ctx2.boundary.delete(f.id); else ctx2.boundary.add(f.id);
    draw();
    toast(`Границы: ${ctx2.boundary.size}. Enter — дальше, ${state.tool === "trim" ? "клик по лишнему куску" : "клик у открытого конца"}`);
    return;
  }
  if (!f || (!f.line && !f.arc)) { toast("Цель должна быть полилинией или дугой (не границей)", "warn"); return; }
  if (ctx2.boundary.has(f.id)) { toast("Это выбрано как граница", "warn"); return; }
  const ok = f.arc
    ? (state.tool === "trim" ? trimArcAt(f, wx, wy, ctx2.boundary) : extendArcAt(f, wx, wy, ctx2.boundary))
    : (state.tool === "trim" ? trimLineAt(f, wx, wy, ctx2.boundary) : extendLineAt(f, wx, wy, ctx2.boundary));
  if (ok) {
    setSelection([f.id]);
    draw();
    renderProps();
  } else {
    // клик дальше допуска от концов — совсем другая беда, чем отсутствие
    // пересечения: без различия пользователь ищет несуществующую проблему
    // в границах, хотя надо просто кликнуть ближе к концу линии
    const chain = f.line;
    const tolW = 14 / state.view.k;
    const farFromEnd = state.tool === "extend" && chain &&
      Math.hypot(wx - chain[0][0], wy - chain[0][1]) >= tolW &&
      Math.hypot(wx - chain[chain.length - 1][0], wy - chain[chain.length - 1][1]) >= tolW;
    toast(farFromEnd
      ? "Кликните ближе к открытому концу линии — продлевается ближайший к клику конец"
      : "Нет пересечения с границей рядом с этой точкой", "warn");
  }
}
// склейка выбранных линий в одну — цепочкой по совпадающим (с допуском)
// концам; конец «подтягивается» к точке уже собранной цепочки (снап впритык)
function joinSelected() {
  const feats = selectionFeatures().filter(f => (f.line && f.line.length >= 2) || f.arc);
  if (feats.length < 2) { toast("Выберите минимум 2 линии/дуги для склейки", "warn"); return; }
  // дугу аппроксимируем точками БЕЗ мутации оригинала — иначе при неудачной
  // склейке (ранний выход ниже) у дуги остался бы паразитный f.line + флаг
  const tol = 10 / state.view.k;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const ptsOf = f => (f.line && f.line.length) ? f.line.map(p => [...p]) : featurePts(f).map(p => [...p]);
  const items = feats.map(f => ({ id: f.id, pts: ptsOf(f) }));
  let chainPts = items[0].pts;
  const mergedIds = new Set([items[0].id]);
  const remaining = items.slice(1);
  let progress = true;
  while (progress && remaining.length) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i].pts;
      const cs = chainPts[0], ce = chainPts[chainPts.length - 1];
      const ps = p[0], pe = p[p.length - 1];
      let next = null;
      if (dist(ce, ps) < tol) next = chainPts.concat(p.slice(1));
      else if (dist(ce, pe) < tol) next = chainPts.concat([...p].reverse().slice(1));
      else if (dist(cs, pe) < tol) next = p.slice(0, -1).concat(chainPts);
      else if (dist(cs, ps) < tol) next = [...p].reverse().slice(0, -1).concat(chainPts);
      if (next) { chainPts = next; mergedIds.add(remaining[i].id); remaining.splice(i, 1); progress = true; break; }
    }
  }
  if (mergedIds.size < 2) { toast("Концы линий/дуг не совпадают в пределах допуска", "warn"); return; }
  snapshot();
  const keep = feats.find(f => f.id === items[0].id);
  keep.line = chainPts;
  delete keep.arc;
  keep.geometry_type = "polyline";   // дуга склеилась в полилинию
  // improve join per plan: carry over radius (fillet) from originals so new join corner gets filleted in draw (generalized now)
  const maxR = Math.max(0, ...feats.map(f => (f.props && f.props.radius) || 0));
  if (maxR > 0) {
    if (!keep.props) keep.props = {};
    keep.props.radius = maxR;
  }
  state.features = state.features.filter(f => !mergedIds.has(f.id) || f.id === keep.id);
  setSelection([keep.id]);
  afterChange();
  toast(mergedIds.size < feats.length
    ? `Склеено ${mergedIds.size} из ${feats.length} линий — остальные не касаются концами`
    : "Линии склеены");
}

// fillet polyline at corners with radius r, sampling arcs. For "полные сопряжения"
function filletLine(pts, r) {
  if (!pts || pts.length < 3 || !(r > 0)) return pts;
  const res = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i-1], p1 = pts[i], p2 = pts[i+1];
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]];
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    if (l1 < 1e-6 || l2 < 1e-6) { res.push(p1); continue; }
    const u1 = [v1[0]/l1, v1[1]/l1];
    const u2 = [v2[0]/l2, v2[1]/l2];
    let dot = u1[0]*u2[0] + u1[1]*u2[1];
    dot = Math.max(-1, Math.min(1, dot));
    let ang = Math.acos(dot);
    if (ang < 1e-4 || ang > Math.PI - 1e-4) { res.push(p1); continue; }
    const d = r / Math.tan(ang / 2);
    if (d > l1 || d > l2) { res.push(p1); continue; }
    const q1 = [p1[0] - u1[0]*d, p1[1] - u1[1]*d];
    const q2 = [p1[0] + u2[0]*d, p1[1] + u2[1]*d];   // вперёд по исходящему ребру (был баг знака)
    res.push(q1);
    // center using perps
    const perp1 = [-u1[1], u1[0]];
    const perp2 = [-u2[1], u2[0]];
    const dx = q2[0] - q1[0], dy = q2[1] - q1[1];
    const det = perp1[0]*perp2[1] - perp1[1]*perp2[0];
    if (Math.abs(det) < 1e-9) { res.push(q2); continue; }
    const t = (dx * perp2[1] - dy * perp2[0]) / det;
    const cx = q1[0] + t * perp1[0];
    const cy = q1[1] + t * perp1[1];
    let a0 = Math.atan2(q1[1] - cy, q1[0] - cx);
    let a1 = Math.atan2(q2[1] - cy, q2[0] - cx);
    let sw = a1 - a0;
    const cross = v1[0]*v2[1] - v1[1]*v2[0];
    if (cross < 0) {
      if (sw > 0) sw -= 2 * Math.PI;
    } else {
      if (sw < 0) sw += 2 * Math.PI;
    }
    const n = 6;
    for (let k = 1; k < n; k++) {
      const aa = a0 + sw * (k / n);
      res.push([cx + r * Math.cos(aa), cy + r * Math.sin(aa)]);
    }
    res.push(q2);
  }
  res.push(pts[pts.length - 1]);
  return res;
}

function applyFillet(f) {
  if (!f || !f.line || !(f.props.radius > 0)) return;
  snapshot();
  f.line = filletLine(f.line, f.props.radius);
  f.props.radius = 0;
  afterChange();
  renderProps();
}

// дуга скругления ОДНОГО угла p0-p1-p2 радиусом r: массив точек, заменяющих
// вершину p1 (без неё самой). null — угол прямой/вырожденный. Радиус ужимается,
// если не помещается в короткое ребро. Число сегментов адаптивно к длине дуги.
function cornerArcPoints(p0, p1, p2, r) {
  const v1 = [p1[0] - p0[0], p1[1] - p0[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
  const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
  if (l1 < 1e-6 || l2 < 1e-6) return null;
  const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
  const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const ang = Math.acos(dot);
  if (ang < 1e-3 || ang > Math.PI - 1e-3) return null;   // прямая — скруглять нечего
  let d = r / Math.tan(ang / 2);
  d = Math.min(d, l1 * 0.999, l2 * 0.999);               // не длиннее рёбер
  const rEff = d * Math.tan(ang / 2);                    // реальный радиус (если ужали)
  // касательные точки: q1 назад по входящему ребру (к p0), q2 вперёд по
  // исходящему (к p2). Оба на расстоянии d от угла p1.
  const q1 = [p1[0] - u1[0] * d, p1[1] - u1[1] * d], q2 = [p1[0] + u2[0] * d, p1[1] + u2[1] * d];
  const perp1 = [-u1[1], u1[0]], perp2 = [-u2[1], u2[0]];
  const det = perp1[0] * perp2[1] - perp1[1] * perp2[0];
  if (Math.abs(det) < 1e-9) return null;
  const dx = q2[0] - q1[0], dy = q2[1] - q1[1];
  const t = (dx * perp2[1] - dy * perp2[0]) / det;
  const cx = q1[0] + t * perp1[0], cy = q1[1] + t * perp1[1];
  const a0 = Math.atan2(q1[1] - cy, q1[0] - cx), a1 = Math.atan2(q2[1] - cy, q2[0] - cx);
  let sw = a1 - a0;
  const cross = v1[0] * v2[1] - v1[1] * v2[0];
  if (cross < 0) { if (sw > 0) sw -= 2 * Math.PI; } else { if (sw < 0) sw += 2 * Math.PI; }
  const n = Math.max(4, Math.min(48, Math.ceil(Math.abs(sw) * rEff / 2)));
  const out = [q1];
  for (let k = 1; k < n; k++) {
    const aa = a0 + sw * (k / n);
    out.push([cx + rEff * Math.cos(aa), cy + rEff * Math.sin(aa)]);
  }
  out.push(q2);
  return out;
}
// сопрячь угол, ближайший к (wx,wy), у линии/кольца f радиусом r
function filletCornerAt(f, wx, wy, r) {
  const closed = !!f.ring;
  const chain = f.ring || f.line;
  if (!chain || chain.length < 3) return false;
  const tolW = 14 / state.view.k;
  // eligible corners: для линии — внутренние (1..n-2); для кольца — все (wrap)
  let best = null;
  const n = chain.length;
  const lo = closed ? 0 : 1, hi = closed ? n : n - 1;
  for (let i = lo; i < hi; i++) {
    const d = Math.hypot(chain[i][0] - wx, chain[i][1] - wy);
    if (d < tolW && (!best || d < best.d)) best = { i, d };
  }
  if (!best) return false;
  const i = best.i;
  const p0 = chain[(i - 1 + n) % n], p1 = chain[i], p2 = chain[(i + 1) % n];
  const arc = cornerArcPoints(p0, p1, p2, r);
  if (!arc) { toast("Этот угол не скруглить (прямой или радиус слишком мал)", "warn"); return false; }
  snapshot();
  chain.splice(i, 1, ...arc);   // заменить вершину дугой
  afterChange();
  return true;
}
function handleFilletClick(wx, wy) {
  const f = hitTest(wx, wy);
  if (!f || !(f.line || f.ring)) { toast("Кликните по углу линии или контура", "warn"); return; }
  const r = state.filletRadius > 0 ? state.filletRadius : 10;
  if (!filletCornerAt(f, wx, wy, r))
    toast("Наведите точнее на угол (вершину) линии/контура", "warn");
}
async function promptFilletRadius() {
  const cur = state.filletRadius > 0 ? state.filletRadius : 10;
  const v = await uiPrompt("Радиус сопряжения, м:", String(cur), { ok: "OK", placeholder: "10" });
  if (v == null) return;
  const r = Math.max(0.1, parseFloat(String(v).replace(",", ".")) || cur);
  state.filletRadius = r;
  toast(`Сопряжение R=${r} м — кликайте по углам линий`);
}


// ---------- эквидистанта: параллельная копия на заданном расстоянии ----------
async function promptOffsetDistance() {
  const cur = state.offsetDist > 0 ? state.offsetDist : 10;
  const v = await uiPrompt("Расстояние смещения, м:", String(cur), { ok: "OK", placeholder: "10" });
  if (v == null) return;
  state.offsetDist = Math.max(0.01, parseFloat(String(v).replace(",", ".")) || cur);
  toast(`Эквидистанта ${state.offsetDist} м — кликайте по линии, сторона по месту клика`);
}

// Сторона определяется кликом, как в AutoCAD: ближайшее ребро цепочки, знак
// векторного произведения решает, слева точка или справа.
function offsetSideOfClick(chain, closed, wx, wy) {
  let best = Infinity, sign = 1;
  const count = closed ? chain.length : chain.length - 1;
  for (let i = 0; i < count; i++) {
    const a = chain[i], b = chain[(i + 1) % chain.length];
    const q = nearestOnSeg([wx, wy], a, b);
    const d = Math.hypot(wx - q[0], wy - q[1]);
    if (d < best) {
      best = d;
      const cross = (b[0] - a[0]) * (wy - a[1]) - (b[1] - a[1]) * (wx - a[0]);
      sign = cross >= 0 ? 1 : -1;
    }
  }
  return sign;
}

function handleOffsetClick(wx, wy) {
  const E = window.GRADO_EDIT;
  if (!E) { toast("Модуль правки геометрии не загружен", "warn"); return; }
  const f = hitTest(wx, wy);
  if (!f) { toast("Кликните по линии, контуру, дуге или окружности"); return; }
  const L = layerOf(f);
  if (!L || L.locked) { toast("Слой заблокирован", "warn"); return; }
  const dist = state.offsetDist > 0 ? state.offsetDist : 10;
  let geom = null;

  if (f.circle) {
    // концентрическая окружность: клик внутри — меньше, снаружи — больше
    const clickR = Math.hypot(wx - f.circle.cx, wy - f.circle.cy);
    const r = f.circle.r + (clickR >= f.circle.r ? dist : -dist);
    if (r <= 0.01) { toast("Смещение больше радиуса — окружности не останется", "warn"); return; }
    geom = { circle: { cx: f.circle.cx, cy: f.circle.cy, r } };
  } else if (f.arc) {
    const clickR = Math.hypot(wx - f.arc.cx, wy - f.arc.cy);
    const r = f.arc.r + (clickR >= f.arc.r ? dist : -dist);
    if (r <= 0.01) { toast("Смещение больше радиуса — дуги не останется", "warn"); return; }
    geom = { arc: { ...f.arc, r } };
  } else if (Array.isArray(f.line) && f.line.length > 1) {
    const chain = E.offsetChain(f.line, offsetSideOfClick(f.line, false, wx, wy) * dist, false);
    if (chain) geom = { line: chain };
  } else if (Array.isArray(f.ring) && f.ring.length > 2) {
    if (f.holes && f.holes.length) {
      // дыры при смещении контура поехали бы враньём — честно отправляем к буферу
      toast("У полигона есть дыры — используйте «Буфер» со стороной «внутри»/«снаружи»", "warn");
      return;
    }
    const ring = E.offsetChain(f.ring, offsetSideOfClick(f.ring, true, wx, wy) * dist, true);
    if (ring && ring.length > 2 && Math.abs(ringArea(ring)) > 1e-6) geom = { ring };
  } else {
    toast("У точки эквидистанты нет — используйте «Буфер»", "warn");
    return;
  }

  if (!geom) { toast("Смещение съело объект — уменьшите расстояние", "warn"); return; }
  snapshot();
  const nf = { id: state.nextId++, layer_id: f.layer_id,
    props: cloneVariantValue(f.props || {}), ...geom };
  if (f.style_id) nf.style_id = f.style_id;
  if (f.kind) nf.kind = f.kind;
  upgradeFeature(nf);
  state.features.push(nf);
  selectOne(nf.id);
  afterChange();
  toast(`Эквидистанта ${dist} м готова — кликайте дальше или Esc`);
}

function lastDrawingPt() {
  if (!state.drawing) return null;
  const pts = state.drawing.pts;
  if (Array.isArray(pts) && pts.length > 0) {
    return pts[pts.length - 1];
  }
  if (state.drawing.center) {
    return state.drawing.center;
  }
  return null;
}


