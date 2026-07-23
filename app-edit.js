// Правка геометрии инструментами QGIS: «Разрезать объекты» и «Объединить».
//
// Зачем. Квартал делят улицей, зону — границей подзоны; наоборот, дробные
// куски одной зоны приходится собирать в один объект. Через геообработку это
// делается слоями целиком и создаёт новый слой — а нужно поправить два объекта
// на месте.
//
// Ядро — чистые функции над кольцами и линиями: работают в Node и покрыты
// тестом. Резать умеем ломаной с любым числом пересечений: пара «вход-выход»
// режет объект надвое, дальше то же повторяется на получившихся частях.
(function (root) {
  "use strict";

  const EPS = 1e-9;
  const TOUCH = 1e-7;

  const same = (a, b) => Math.abs(a[0] - b[0]) <= TOUCH && Math.abs(a[1] - b[1]) <= TOUCH;

  function ringArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
  }

  function openRing(ring) {
    const out = ring.slice();
    while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
    return out;
  }

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) &&
          x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + dx * t, a[1] + dy * t];
  }

  // пересечение отрезков с параметрами: нужен не только факт, но и место —
  // по нему режется и кольцо, и сама режущая ломаная
  function crossParams(p1, p2, p3, p4) {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return null;             // параллельны
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
    return { t, u, point: [p1[0] + t * d1x, p1[1] + t * d1y] };
  }

  // все пересечения ломаной с кольцом, в порядке движения ПО ЛОМАНОЙ
  function crossings(ring, cut) {
    const out = [];
    for (let ci = 0; ci + 1 < cut.length; ci++) {
      const found = [];
      for (let ri = 0; ri < ring.length; ri++) {
        const a = ring[ri], b = ring[(ri + 1) % ring.length];
        const hit = crossParams(cut[ci], cut[ci + 1], a, b);
        if (!hit) continue;
        // касание вершины даёт два одинаковых пересечения на соседних рёбрах
        if (found.some(f => same(f.point, hit.point))) continue;
        found.push({ cutIdx: ci, cutT: hit.t, ringIdx: ri, ringT: hit.u, point: hit.point });
      }
      found.sort((a, b) => a.cutT - b.cutT);
      for (const hit of found)
        if (!out.length || !same(out[out.length - 1].point, hit.point)) out.push(hit);
    }
    return out;
  }

  // путь по кольцу вперёд от одного пересечения до другого
  function ringPath(ring, from, to) {
    const path = [from.point];
    let i = (from.ringIdx + 1) % ring.length;
    const stop = (to.ringIdx + 1) % ring.length;
    // пересечения на одном ребре: вперёд идти некуда, кроме самого ребра
    if (from.ringIdx === to.ringIdx && to.ringT >= from.ringT) { path.push(to.point); return path; }
    let guard = 0;
    while (guard++ <= ring.length) {
      path.push(ring[i]);
      if (i === to.ringIdx) break;
      i = (i + 1) % ring.length;
      if (i === stop && guard > ring.length) break;
    }
    path.push(to.point);
    return path;
  }

  const cutPath = (cut, from, to) => {
    // точки самой ломаной между двумя пересечениями
    const out = [];
    for (let i = from.cutIdx + 1; i <= to.cutIdx; i++) out.push(cut[i]);
    return out;
  };

  // Режем кольцо ломаной. Берём первую пару пересечений, у которой участок
  // ломаной идёт ВНУТРИ контура, делим по ней и повторяем на обеих частях —
  // так ломаная с несколькими входами-выходами отрабатывает целиком.
  function splitRing(ring, cut, depth = 0) {
    const base = openRing(ring);
    if (base.length < 3 || cut.length < 2 || depth > 16) return [base];
    const hits = crossings(base, cut);
    for (let i = 0; i + 1 < hits.length; i++) {
      const from = hits[i], to = hits[i + 1];
      if (same(from.point, to.point)) continue;
      const middle = [(from.point[0] + to.point[0]) / 2, (from.point[1] + to.point[1]) / 2];
      const inner = cutPath(cut, from, to);
      const probe = inner.length ? inner[Math.floor(inner.length / 2)] : middle;
      if (!pointInRing(probe[0], probe[1], base)) continue;   // участок идёт снаружи
      const left = [...ringPath(base, from, to), ...inner.slice().reverse()];
      const right = [...ringPath(base, to, from), ...inner];
      if (Math.abs(ringArea(left)) <= EPS || Math.abs(ringArea(right)) <= EPS) continue;
      return [...splitRing(left, cut, depth + 1), ...splitRing(right, cut, depth + 1)];
    }
    return [base];
  }

  // Полигон с дырами: дыры раздаются частям по принадлежности. Если ломаная
  // режет саму дыру — честно отказываемся, а не выдаём кривой результат.
  function splitPolygon(feature, cut) {
    const ring = openRing(feature.ring || []);
    if (ring.length < 3) return { parts: [], reason: "нет контура" };
    const holes = (feature.holes || []).map(openRing).filter(h => h.length > 2);
    for (const hole of holes)
      if (crossings(hole, cut).length) return { parts: [], reason: "линия режет дыру в контуре" };
    const rings = splitRing(ring, cut);
    if (rings.length < 2) return { parts: [], reason: "линия не пересекает объект" };
    const parts = rings.map(part => ({ ring: part, holes: [] }));
    for (const hole of holes) {
      const owner = parts.find(part => pointInRing(hole[0][0], hole[0][1], part.ring));
      (owner || parts[0]).holes.push(hole);
    }
    return { parts, reason: null };
  }

  function splitLine(line, cut) {
    if (!Array.isArray(line) || line.length < 2) return { parts: [], reason: "нет линии" };
    const hits = [];
    for (let li = 0; li + 1 < line.length; li++)
      for (let ci = 0; ci + 1 < cut.length; ci++) {
        const hit = crossParams(line[li], line[li + 1], cut[ci], cut[ci + 1]);
        if (hit) hits.push({ idx: li, t: hit.t, point: hit.point });
      }
    if (!hits.length) return { parts: [], reason: "линия не пересекает объект" };
    hits.sort((a, b) => a.idx - b.idx || a.t - b.t);
    const parts = [];
    let current = [line[0]];
    let at = 0;
    for (const hit of hits) {
      for (let i = at + 1; i <= hit.idx; i++) current.push(line[i]);
      current.push(hit.point);
      if (current.length > 1) parts.push(current);
      current = [hit.point];
      at = hit.idx;
    }
    for (let i = at + 1; i < line.length; i++) current.push(line[i]);
    if (current.length > 1) parts.push(current);
    const kept = parts.filter(part => {
      let len = 0;
      for (let i = 1; i < part.length; i++) len += Math.hypot(part[i][0] - part[i - 1][0], part[i][1] - part[i - 1][1]);
      return len > TOUCH;
    });
    return kept.length > 1 ? { parts: kept, reason: null }
      : { parts: [], reason: "разрез пришёлся на конец линии" };
  }

  // Объединение полигонов — через ту же библиотеку, что и геообработка.
  // Разъединённые куски в один объект не собираем: модель чертежа не знает
  // многочастных объектов, а молча оставить дыру в данных нельзя.
  function mergePolygons(features) {
    const pc = root.polygonClipping;
    if (!pc || typeof pc.union !== "function") return { part: null, reason: "модуль полигональных операций не загружен" };
    const geometries = features.map(f => {
      const ring = openRing(f.ring || []);
      if (ring.length < 3) return null;
      return [[[...ring, ring[0]], ...(f.holes || []).map(h => { const o = openRing(h); return [...o, o[0]]; })]];
    }).filter(Boolean);
    if (geometries.length < 2) return { part: null, reason: "нужно минимум два полигона" };
    let result = geometries[0];
    for (let i = 1; i < geometries.length; i++) result = pc.union(result, geometries[i]);
    const polygons = (result || []).filter(polygon => polygon && polygon.length);
    if (polygons.length !== 1)
      return { part: null, reason: "объекты не соприкасаются — объединять нечего" };
    const [outer, ...holes] = polygons[0];
    return { part: { ring: openRing(outer), holes: holes.map(openRing) }, reason: null };
  }

  // ---------- изменить форму (reshape, как в QGIS) ----------
  // Ломаная пересекает контур дважды (или больше): участок контура между
  // первым и последним пересечением заменяется на путь ломаной. Куда ломаная
  // выгнулась, туда контур и пойдёт: наружу — прирезка, внутрь — вырез.
  function reshapeRing(ring, cut) {
    const base = openRing(ring);
    if (base.length < 3 || !Array.isArray(cut) || cut.length < 2)
      return { ring: null, reason: "нужен контур и ломаная" };
    const hits = crossings(base, cut);
    if (hits.length < 2)
      return { ring: null, reason: "линия должна пересечь контур минимум дважды" };
    const first = hits[0], last = hits[hits.length - 1];
    if (same(first.point, last.point))
      return { ring: null, reason: "пересечения совпали — менять нечего" };

    const path = [first.point, ...cutPath(cut, first, last), last.point];
    // Пересечения делят контур на две дуги. Заменяется та, что БЛИЖЕ к
    // нарисованному пути: человек чертит новую форму вместо старого куска, и
    // старый кусок — рядом с новым. Правило «внутрь — меньший, наружу —
    // больший» здесь врёт: вырез у правого края оставлял правый обрезок
    // вместо основного тела.
    const forward = ringPath(base, last, first);       // дуга: последнее → первое по ходу
    const backward = ringPath(base, first, last);      // дуга: первое → последнее по ходу
    const probe = path[Math.floor(path.length / 2)];
    const distToChain = chain => {
      let best = Infinity;
      for (let i = 0; i + 1 < chain.length; i++) {
        const q = nearestOnSegment(probe, chain[i], chain[i + 1]);
        best = Math.min(best, Math.hypot(probe[0] - q[0], probe[1] - q[1]));
      }
      return best;
    };
    // заменяем ближнюю дугу — в кандидате остаётся дальняя
    const chosen = distToChain(backward) <= distToChain(forward)
      ? [...path, ...forward.slice(1, -1)]
      : [...path, ...[...backward].reverse().slice(1, -1)];
    if (Math.abs(ringArea(chosen)) <= EPS)
      return { ring: null, reason: "после правки не осталось площади" };

    // подряд совпавшие точки на стыках
    const clean = [];
    for (const p of chosen) {
      const prev = clean[clean.length - 1];
      if (!prev || !same(prev, p)) clean.push(p);
    }
    while (clean.length > 1 && same(clean[0], clean[clean.length - 1])) clean.pop();
    return clean.length > 2 ? { ring: clean, reason: null }
      : { ring: null, reason: "после правки контур выродился" };
  }

  // Линия: кусок между первым и последним пересечением заменяется путём
  // ломаной; направление пути подгоняется под направление линии.
  function reshapeLine(line, cut) {
    if (!Array.isArray(line) || line.length < 2 || !Array.isArray(cut) || cut.length < 2)
      return { line: null, reason: "нужна линия и ломаная" };
    const hits = [];
    for (let ci = 0; ci + 1 < cut.length; ci++)
      for (let li = 0; li + 1 < line.length; li++) {
        const hit = crossParams(cut[ci], cut[ci + 1], line[li], line[li + 1]);
        if (hit) hits.push({ cutIdx: ci, cutT: hit.t, lineIdx: li, lineT: hit.u, point: hit.point });
      }
    hits.sort((a, b) => a.cutIdx - b.cutIdx || a.cutT - b.cutT);
    if (hits.length < 2)
      return { line: null, reason: "линия должна пересечь объект минимум дважды" };
    const first = hits[0], last = hits[hits.length - 1];
    const path = [first.point, ...cutPath(cut, first, last), last.point];
    // где эти пересечения на самой линии
    const pos = hit => hit.lineIdx + hit.lineT;
    let early = first, late = last, insert = path;
    if (pos(first) > pos(last)) { early = last; late = first; insert = [...path].reverse(); }
    const out = [];
    for (let i = 0; i <= early.lineIdx; i++) out.push(line[i]);
    out.push(...insert);
    for (let i = late.lineIdx + 1; i < line.length; i++) out.push(line[i]);
    const clean = [];
    for (const p of out) {
      const prev = clean[clean.length - 1];
      if (!prev || !same(prev, p)) clean.push(p);
    }
    return clean.length > 1 ? { line: clean, reason: null }
      : { line: null, reason: "после правки линия выродилась" };
  }

  // ---------- эквидистанта (offset) ----------
  // Параллельная копия ломаной на расстоянии dist: положительное — слева по
  // ходу обхода, отрицательное — справа. Углы соединяются пересечением
  // смещённых прямых (как в AutoCAD); на острых углах, где пересечение улетает
  // дальше четырёх расстояний, ставится фаска — иначе шип длиной в километры.
  // Самопересечения при смещении вогнутой ломаной больше локального радиуса
  // не вычищаются: это поведение CAD, а чистку даёт починка геометрии.
  const MITER_LIMIT = 4;

  function offsetChain(points, dist, closed = false) {
    const chain = [];
    for (const p of points) {
      const last = chain[chain.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) chain.push(p);
    }
    if (closed && chain.length > 2 && same(chain[0], chain[chain.length - 1])) chain.pop();
    if (chain.length < 2) return null;

    // смещённые отрезки
    const segs = [];
    const count = closed ? chain.length : chain.length - 1;
    for (let i = 0; i < count; i++) {
      const a = chain[i], b = chain[(i + 1) % chain.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = -dy / len * dist, ny = dx / len * dist;
      segs.push({ a: [a[0] + nx, a[1] + ny], b: [b[0] + nx, b[1] + ny],
        dx: dx / len, dy: dy / len });
    }
    if (!segs.length) return null;

    // стык двух смещённых отрезков: пересечение прямых или фаска
    const joint = (s1, s2) => {
      const denom = s1.dx * s2.dy - s1.dy * s2.dx;
      if (Math.abs(denom) < 1e-9) return [s1.b];              // почти параллельны
      const t = ((s2.a[0] - s1.a[0]) * s2.dy - (s2.a[1] - s1.a[1]) * s2.dx) / denom;
      const x = s1.a[0] + s1.dx * t, y = s1.a[1] + s1.dy * t;
      const reach = Math.hypot(x - s1.b[0], y - s1.b[1]);
      if (reach > MITER_LIMIT * Math.abs(dist)) return [s1.b, s2.a];   // фаска
      return [[x, y]];
    };

    const out = [];
    if (!closed) {
      out.push(segs[0].a);
      for (let i = 0; i + 1 < segs.length; i++) out.push(...joint(segs[i], segs[i + 1]));
      out.push(segs[segs.length - 1].b);
    } else {
      for (let i = 0; i < segs.length; i++)
        out.push(...joint(segs[i], segs[(i + 1) % segs.length]));
    }
    // подряд совпавшие точки после фасок
    const clean = [];
    for (const p of out) {
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) clean.push(p);
    }
    return clean.length > 1 ? clean : null;
  }

  root.GRADO_EDIT = { splitRing, splitPolygon, splitLine, mergePolygons, ringArea, pointInRing, crossings,
    offsetChain, MITER_LIMIT, reshapeRing, reshapeLine };
})(typeof window !== "undefined" ? window : globalThis);
