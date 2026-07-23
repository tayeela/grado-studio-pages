// Буфер вокруг объектов — последняя операция, которая в браузерной редакции
// была заглушкой «требует настольную версию».
//
// Буфер строится геометрически: вокруг каждого ребра — капсула (прямоугольник
// с полукруглыми торцами), вокруг точки — круг; всё склеивается объединением
// polygon-clipping. Сжатие полигона («внутри») — это разность с буфером его же
// границы: вычитая полосу шириной r вдоль контура, получаем контур, отступивший
// на r внутрь. Дуги окружностей приближаются ломаной: на радиусе 300 м хорда
// при 48 сегментах отклоняется меньше сантиметра — точнее самой оцифровки.
//
// Стороны — как в настольном диалоге:
//   both  — вся зона доступности: объект + r вокруг (детсад 300 м — это ОН);
//   outer — только кольцо снаружи, без исходной площади;
//   inner — контур, отступивший на r внутрь (для линий и точек не имеет
//           смысла — честно пропускаем, а не выдумываем).
(function (root) {
  "use strict";

  const ARC_STEPS = 48;                        // сегментов на полный круг

  const pc = () => root.polygonClipping;
  const vector = () => root.GRADO_VECTOR || {};

  function circleRing(cx, cy, r, steps = ARC_STEPS) {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const a = ((i + 0.5) / steps) * Math.PI * 2;   // полшага фазы: вершины круга не совпадают с углами прямоугольников и осями
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    out.push([...out[0]]);
    return [[out]];                            // MultiPolygon из одного кольца
  }

  // капсула вокруг отрезка: прямоугольник + полукруги на торцах
  function capsule(a, b, r, steps = ARC_STEPS) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return circleRing(a[0], a[1], r, steps);
    const nx = -dy / len, ny = dx / len;       // левая нормаль
    const base = Math.atan2(ny, nx);           // направление нормали
    const half = Math.max(4, Math.round(steps / 2));
    const ring = [
      [a[0] + nx * r, a[1] + ny * r],
      [b[0] + nx * r, b[1] + ny * r],
    ];
    for (let i = 1; i < half; i++) {           // полукруг у конца b
      const ang = base - (i / half) * Math.PI;
      ring.push([b[0] + r * Math.cos(ang), b[1] + r * Math.sin(ang)]);
    }
    ring.push([b[0] - nx * r, b[1] - ny * r], [a[0] - nx * r, a[1] - ny * r]);
    for (let i = 1; i < half; i++) {           // полукруг у конца a
      const ang = base + Math.PI - (i / half) * Math.PI;
      ring.push([a[0] + r * Math.cos(ang), a[1] + r * Math.sin(ang)]);
    }
    ring.push([...ring[0]]);
    return [[ring]];
  }

  // Полоса вдоль цепочки точек. НЕ капсулами: у соседних капсул полукруги в
  // общей вершине совпадают точка в точку, и движок объединения падает на
  // вырожденных сегментах. Раскладка другая: прямоугольник на каждое ребро
  // плюс ОДИН круг на каждую вершину — совпадающих дуг нет, объединение всех
  // частей делается одним проходом.
  function chainBand(points, r) {
    const engine = pc();
    const chain = [];
    for (const p of points) {                  // нулевые рёбра выбрасываем
      const last = chain[chain.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) chain.push(p);
    }
    if (chain.length < 2) return chain.length ? circleRing(chain[0][0], chain[0][1], r) : [];
    const parts = [];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = -dy / len * r, ny = dx / len * r;
      parts.push([[[
        [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny],
        [a[0] + nx, a[1] + ny],
      ]]]);
    }
    for (const p of chain) parts.push(circleRing(p[0], p[1], r));
    return engine.union(parts[0], ...parts.slice(1));
  }

  const closeRing = ring => {
    const out = ring.map(p => [p[0], p[1]]);
    const first = out[0], last = out[out.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([...first]);
    return out;
  };

  function featureGeometry(feature) {
    if (Array.isArray(feature.ring) && feature.ring.length > 2)
      return [[closeRing(feature.ring), ...(feature.holes || []).map(closeRing)]];
    return null;
  }

  // все кольца полигона (контур + дыры) как цепочки — для полосы вдоль границы
  function boundaryChains(feature) {
    const chains = [closeRing(feature.ring)];
    for (const hole of feature.holes || []) if (hole && hole.length > 2) chains.push(closeRing(hole));
    return chains;
  }

  function samplePoints(feature) {
    const sampler = root.featurePts;
    if ((feature.arc || feature.circle) && typeof sampler === "function") {
      const pts = sampler(feature);
      if (pts && pts.length > 1) return feature.circle ? closeRing(pts) : pts;
    }
    return null;
  }

  // буфер ОДНОГО объекта → MultiPolygon (или null с причиной)
  function bufferGeometry(feature, dist, sides = "both") {
    const engine = pc();
    if (!engine) throw new Error("модуль полигональных операций не загружен");
    const r = Math.abs(Number(dist) || 0);
    if (!(r > 0)) return { geometry: null, reason: "нулевое расстояние" };

    if (Array.isArray(feature.point)) {
      if (sides === "inner") return { geometry: null, reason: "у точки нет «внутри»" };
      return { geometry: circleRing(feature.point[0], feature.point[1], r) };
    }

    const polyGeometry = featureGeometry(feature);
    if (polyGeometry) {
      const band = boundaryChains(feature).reduce(
        (acc, chain) => acc ? engine.union(acc, chainBand(chain, r)) : chainBand(chain, r), null);
      if (sides === "inner") {
        const shrunk = engine.difference(polyGeometry, band);
        return shrunk && shrunk.length ? { geometry: shrunk }
          : { geometry: null, reason: "объект уже отступа — внутри ничего не осталось" };
      }
      const dilated = engine.union(polyGeometry, band);
      if (sides === "outer") return { geometry: engine.difference(dilated, polyGeometry) };
      return { geometry: dilated };
    }

    const chain = Array.isArray(feature.line) && feature.line.length > 1
      ? feature.line : samplePoints(feature);
    if (chain && chain.length > 1) {
      if (sides === "inner") return { geometry: null, reason: "у линии нет «внутри»" };
      return { geometry: chainBand(chain, r) };
    }
    return { geometry: null, reason: "объект без геометрии" };
  }

  // контракт настольного сервера: { features, dist, sides } → { features }
  function bufferFeatures(payload = {}) {
    const list = Array.isArray(payload.features) ? payload.features : [];
    const dist = Number(payload.dist) || 0;
    const sides = payload.sides || "both";
    const out = [];
    const notes = [];
    for (const feature of list) {
      let result;
      try { result = bufferGeometry(feature, dist, sides); }
      catch (error) { throw error; }
      if (!result.geometry || !result.geometry.length) {
        if (result.reason) notes.push(result.reason);
        continue;
      }
      const parts = typeof vector().geometryParts === "function"
        ? vector().geometryParts(result.geometry)
        : result.geometry.map(polygon => ({ ring: polygon[0].slice(0, -1), holes: [] }));
      for (const part of parts)
        out.push({ ring: part.ring, holes: part.holes && part.holes.length ? part.holes : undefined,
          props: { ...(feature.props || {}), buffer_m: dist },
          kind: "restrict", layer_id: feature.layer_id });
    }
    return { features: out, notes };
  }

  root.GRADO_BUFFER = { bufferGeometry, bufferFeatures, capsule, circleRing, chainBand, ARC_STEPS };
})(typeof window !== "undefined" ? window : globalThis);
