// Размещение подписей объектов — как движок подписей QGIS.
//
// Было. Подпись полигона ставилась в среднее арифметическое вершин и рисовалась
// сразу, в порядке отрисовки; занятость мест считалась ОТДЕЛЬНО ДЛЯ КАЖДОГО
// СЛОЯ. Отсюда три беды:
//   1. У вытянутых и вогнутых контуров (пойма, зона вдоль набережной, квартал
//      подковой) среднее лежит ВНЕ полигона — подпись уезжала на соседа. Ровно
//      та же ошибка, что была у стороны засечек.
//   2. Подписи разных слоёв накладывались друг на друга: сеток было столько же,
//      сколько слоёв.
//   3. Кто раньше нарисован, тот и занял место: подпись мелкого фонового
//      объекта вытесняла подпись крупного из верхнего слоя.
//
// Стало. Точка подписи полигона — полюс недоступности (самая «глубокая» точка
// контура, как placement «horizontal» в QGIS). Кандидаты собираются за кадр,
// раскладываются по одной общей сетке занятости в порядке важности, и только
// потом рисуются.
//
// Экранные координаты здесь уже посчитаны вызывающей стороной: модуль ничего не
// знает ни о холсте, ни о проекции, поэтому проверяется в Node.
(function (root) {
  "use strict";

  // ---------- полюс недоступности ----------
  // Алгоритм polylabel: делим габарит на клетки, у каждой считаем расстояние от
  // центра до контура (внутри — со знаком плюс) и дробим самую перспективную,
  // пока выигрыш не станет меньше точности. Возвращает точку, максимально
  // удалённую от границ — она всегда ВНУТРИ, даже у подковы и поймы.
  function pointToSegment(px, py, ax, ay, bx, by) {
    let dx = bx - ax, dy = by - ay;
    if (dx !== 0 || dy !== 0) {
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      if (t > 1) { ax = bx; ay = by; }
      else if (t > 0) { ax += dx * t; ay += dy * t; }
    }
    dx = px - ax; dy = py - ay;
    return dx * dx + dy * dy;
  }

  // расстояние до контура со знаком: внутри плюс, снаружи минус
  function signedDistance(x, y, rings) {
    let inside = false;
    let best = Infinity;
    for (const ring of rings) {
      if (!ring || ring.length < 3) continue;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) &&
            x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        best = Math.min(best, pointToSegment(x, y, a[0], a[1], b[0], b[1]));
      }
    }
    if (best === Infinity) return -Infinity;
    return (inside ? 1 : -1) * Math.sqrt(best);
  }

  function cellOf(x, y, half, rings) {
    const d = signedDistance(x, y, rings);
    // потолок для клетки: её центр плюс полудиагональ — дальше внутрь не уйти
    return { x, y, half, d, max: d + half * Math.SQRT2 };
  }

  function poleOfInaccessibility(rings, precision) {
    const outer = rings && rings[0];
    if (!Array.isArray(outer) || outer.length < 3) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const width = maxX - minX, height = maxY - minY;
    const size = Math.min(width, height);
    if (!(size > 0)) return [(minX + maxX) / 2, (minY + maxY) / 2];
    const tolerance = precision || Math.max(size / 100, 1e-6);

    let cellSize = size;
    const queue = [];
    for (let x = minX; x < maxX; x += cellSize)
      for (let y = minY; y < maxY; y += cellSize)
        queue.push(cellOf(x + cellSize / 2, y + cellSize / 2, cellSize / 2, rings));
    // отправная точка — центр габарита; центроид сюда сознательно не берём:
    // у вогнутых контуров он лежит снаружи
    let best = cellOf((minX + maxX) / 2, (minY + maxY) / 2, 0, rings);
    let guard = 0;
    while (queue.length && guard++ < 20000) {
      // самая перспективная клетка: у кого потолок выше
      let at = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[at].max) at = i;
      const cell = queue.splice(at, 1)[0];
      if (cell.d > best.d) best = cell;
      if (cell.max - best.d <= tolerance) continue;
      const half = cell.half / 2;
      queue.push(cellOf(cell.x - half, cell.y - half, half, rings),
                 cellOf(cell.x + half, cell.y - half, half, rings),
                 cellOf(cell.x - half, cell.y + half, half, rings),
                 cellOf(cell.x + half, cell.y + half, half, rings));
    }
    return [best.x, best.y];
  }

  // ---------- сетка занятости ----------
  // Занятость — грид, а не список: линейный перебор всех поставленных подписей
  // на городском слое съедал 93% кадра (замер в истории: 386 мс против 27 мс).
  const CELL = 64;
  function createGrid(cell = CELL) {
    const cells = new Map();
    const each = (b, fn) => {
      for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++)
        for (let cy = Math.floor(b[1] / cell); cy <= Math.floor(b[3] / cell); cy++)
          if (fn(cx + "_" + cy)) return true;
      return false;
    };
    return {
      hits: b => each(b, key => {
        const bucket = cells.get(key);
        return bucket ? bucket.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) : false;
      }),
      add: b => { each(b, key => { let bucket = cells.get(key); if (!bucket) cells.set(key, bucket = []); bucket.push(b); }); },
    };
  }

  // ---------- раскладка ----------
  // Кандидат: { key, x, y, width, height, priority, candidates, fit, pad }
  //   x,y      — точка привязки в экранных пикселях (центр текста для полигона,
  //              сам знак для точки);
  //   candidates — смещения [dx, dy] по убыванию желательности (QGIS: «вокруг
  //              точки»); для полигона хватает нулевого смещения;
  //   fit      — экранный габарит объекта: подпись, которая в него не влезает,
  //              не ставится вовсе (иначе она читается как подпись соседа);
  //   priority — больше значит важнее: место занимает тот, кто важнее, а не
  //              тот, кого раньше нарисовали.
  function layout(jobs, options = {}) {
    const grid = options.grid || createGrid(options.cell || CELL);
    const pad = options.pad == null ? 2 : options.pad;
    const placed = [];
    const ordered = jobs.map((job, index) => ({ job, index }))
      .sort((a, b) => (b.job.priority || 0) - (a.job.priority || 0) || a.index - b.index);
    for (const { job } of ordered) {
      // повёрнутая подпись занимает свой описанный прямоугольник
      const cos = Math.abs(Math.cos(job.angle || 0)), sin = Math.abs(Math.sin(job.angle || 0));
      const halfW = (job.width * cos + job.height * sin) / 2;
      const halfH = (job.width * sin + job.height * cos) / 2;
      const offsets = job.candidates && job.candidates.length ? job.candidates : [[0, 0]];
      let box = null, at = null;
      for (const [dx, dy] of offsets) {
        const cx = job.x + dx, cy = job.y + dy;
        const candidate = [cx - halfW - pad, cy - halfH - pad, cx + halfW + pad, cy + halfH + pad];
        // подпись не должна вылезать за сам объект: «5 этажей» шириной
        // с квартал поверх соседнего здания читается как чужая
        if (job.fit && (job.width > (job.fit[2] - job.fit[0]) || job.height > (job.fit[3] - job.fit[1]))) break;
        // закреплённую рукой подпись не прячем: человек поставил её сам
        if (!job.pinned && grid.hits(candidate)) continue;
        box = candidate; at = [cx, cy];
        break;
      }
      if (!box) continue;
      grid.add(box);
      placed.push({ ...job, x: at[0], y: at[1], box });
    }
    return placed;
  }

  // Кандидаты вокруг точки — порядок как в QGIS: сперва справа-сверху, дальше
  // по кругу. Знак не перекрываем: смещение считается от его радиуса.
  function aroundPoint(radius, gap = 3) {
    const r = Math.max(radius, 1) + gap;
    return [[r, -r], [r, r], [-r, -r], [-r, r], [0, -r * 1.4], [0, r * 1.4]];
  }

  root.GRADO_LABELS = { poleOfInaccessibility, signedDistance, createGrid, layout, aroundPoint, CELL };
})(typeof window !== "undefined" ? window : globalThis);
