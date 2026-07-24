// Выпуск чертежа в DXF — обмен с AutoCAD и другими CAD.
//
// В браузерной редакции пункт «Экспорт чертежа (DXF)» был выключен и подписан
// «требует настольную версию», хотя DXF — это текстовый формат, и собрать его
// в браузере ничто не мешает.
//
// Пишем DXF R12 (AC1009) намеренно: он читается всем, включая старые версии и
// сторонние просмотрщики, и не требует таблиц классов и объектов, которых
// в чертеже градплана всё равно нет. Координаты — местные метры проекта, как
// на холсте: CAD ждёт метры, а не градусы.
(function (root) {
  "use strict";

  // Цвет линии в DXF — номер в палитре ACI, а не RGB (R12 других не знает).
  // Берём ближайший из стандартной палитры: точное совпадение не важно, важно,
  // чтобы красная линия осталась красной, а зона — жёлтой.
  const ACI = [
    [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255],
    [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255], [8, 128, 128, 128],
    [9, 192, 192, 192], [12, 165, 0, 0], [22, 165, 165, 0], [30, 255, 127, 0],
    [40, 255, 191, 0], [42, 165, 124, 0], [52, 191, 255, 0], [62, 0, 255, 0],
    [92, 0, 255, 191], [140, 0, 127, 255], [152, 0, 63, 255], [172, 0, 0, 255],
    [212, 191, 0, 255], [242, 255, 0, 191], [250, 51, 51, 51], [253, 153, 153, 153],
  ];

  function toAci(color) {
    const rgb = parseColor(color);
    if (!rgb) return 7;
    let best = 7, bestDistance = Infinity;
    for (const [index, r, g, b] of ACI) {
      const distance = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    return best;
  }

  function parseColor(value) {
    if (!value) return null;
    const text = String(value).trim().toLowerCase();
    const rgba = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgba) {
      const parts = rgba[1].split(",").map(part => parseFloat(part.trim()));
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    }
    const hex = text.replace("#", "");
    if (!/^[0-9a-f]{3,8}$/.test(hex)) return null;
    const full = hex.length === 3 ? hex.split("").map(char => char + char).join("") : hex;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }

  // Имя слоя в DXF: без пробелов и запрещённых знаков, иначе AutoCAD ругается
  // на файл целиком. Русские буквы допустимы.
  const layerName = (title, index) => {
    const clean = String(title || `Слой_${index + 1}`)
      .replace(/[<>/\\":;?*|=`,]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")                  // «Слой "особый": тест» → Слой_особый_тест
      .replace(/^_|_$/g, "")
      .slice(0, 60);
    return clean || `Слой_${index + 1}`;
  };

  const pair = (code, value) => `${code}\n${value}\n`;
  const num = value => (Math.round((Number(value) || 0) * 1000) / 1000).toString();
  let dxfOrigin = [0, 0];
  const numX = value => num(Number(value) + dxfOrigin[0]);
  const numY = value => num(Number(value) + dxfOrigin[1]);

  // ---------- сборка файла ----------
  function buildDxf({ features = [], layers = [], styleOf, layerOf, labelOf, origin = [0, 0] } = {}) {
    // origin проектной СК: в файл идут НАСТОЯЩИЕ координаты системы (МСК/ГК),
    // а не внутренние смещённые — получателю в САПР не нужно ничего двигать
    dxfOrigin = [Number(origin[0]) || 0, Number(origin[1]) || 0];
    const used = new Map();                      // слой → { name, aci }
    layers.forEach((layer, index) => {
      const style = (styleOf && styleOf(null, layer)) || layer.fmt || {};
      used.set(layer, { name: layerName(layer.title, index), aci: toAci(style.stroke) });
    });

    let entities = "";
    let counts = { polyline: 0, point: 0, text: 0, circle: 0, arc: 0, skipped: 0 };

    const write = (type, layer, body) => {
      entities += pair(0, type) + pair(8, layer) + body;
    };

    for (const feature of features) {
      const layer = layerOf ? layerOf(feature) : null;
      const info = used.get(layer) || { name: "0", aci: 7 };
      const style = styleOf ? styleOf(feature) : {};
      const aci = toAci(style && style.stroke) || info.aci;

      if (Array.isArray(feature.ring) && feature.ring.length > 2) {
        writeRing(feature.ring, info.name, aci);
        for (const hole of feature.holes || []) if (hole && hole.length > 2) writeRing(hole, info.name, aci);
        counts.polyline += 1;
      } else if (Array.isArray(feature.line) && feature.line.length > 1) {
        writeChain(feature.line, info.name, aci, false);
        counts.polyline += 1;
      } else if (Array.isArray(feature.point)) {
        write("POINT", info.name, pair(62, aci) + pair(10, numX(feature.point[0])) +
          pair(20, numY(feature.point[1])) + pair(30, "0"));
        counts.point += 1;
      } else if (feature.circle) {
        write("CIRCLE", info.name, pair(62, aci) + pair(10, numX(feature.circle.cx)) +
          pair(20, numY(feature.circle.cy)) + pair(30, "0") + pair(40, num(feature.circle.r)));
        counts.circle += 1;
      } else if (feature.arc) {
        const a = feature.arc;
        const start = a.a0 * 180 / Math.PI;
        const end = (a.a0 + a.sweep) * 180 / Math.PI;
        write("ARC", info.name, pair(62, aci) + pair(10, numX(a.cx)) + pair(20, numY(a.cy)) +
          pair(30, "0") + pair(40, num(a.r)) +
          pair(50, num(a.sweep >= 0 ? start : end)) + pair(51, num(a.sweep >= 0 ? end : start)));
        counts.arc += 1;
      } else { counts.skipped += 1; continue; }

      // Подпись объекта едет отдельной сущностью TEXT: в CAD подпись — это
      // текст на чертеже, а не свойство линии.
      const label = labelOf ? labelOf(feature) : undefined;
      if (label !== undefined && label !== null && String(label).trim()) {
        const anchor = textAnchor(feature);
        if (anchor) {
          write("TEXT", info.name, pair(62, aci) + pair(10, numX(anchor[0])) + pair(20, numY(anchor[1])) +
            pair(30, "0") + pair(40, num(textHeight(style))) + pair(1, String(label).slice(0, 250)) +
            pair(72, "1") + pair(11, numX(anchor[0])) + pair(21, numY(anchor[1])) + pair(31, "0"));
          counts.text += 1;
        }
      }
    }

    function writeRing(ring, layer, aci) { writeChain(ring, layer, aci, true); }
    function writeChain(points, layer, aci, closed) {
      // LWPOLYLINE в R12 нет — пишем POLYLINE с вершинами: её читают все.
      entities += pair(0, "POLYLINE") + pair(8, layer) + pair(62, aci) +
        pair(66, "1") + pair(70, closed ? "1" : "0") +
        pair(10, "0") + pair(20, "0") + pair(30, "0");
      for (const point of points)
        entities += pair(0, "VERTEX") + pair(8, layer) +
          pair(10, numX(point[0])) + pair(20, numY(point[1])) + pair(30, "0");
      entities += pair(0, "SEQEND") + pair(8, layer);
    }

    const layerTable = [...used.values()];
    const header = pair(0, "SECTION") + pair(2, "HEADER") +
      pair(9, "$ACADVER") + pair(1, "AC1009") +
      pair(9, "$INSUNITS") + pair(70, "6") +            // метры
      pair(0, "ENDSEC");
    const tables = pair(0, "SECTION") + pair(2, "TABLES") +
      pair(0, "TABLE") + pair(2, "LAYER") + pair(70, String(layerTable.length + 1)) +
      pair(0, "LAYER") + pair(2, "0") + pair(70, "0") + pair(62, "7") + pair(6, "CONTINUOUS") +
      layerTable.map(item => pair(0, "LAYER") + pair(2, item.name) + pair(70, "0") +
        pair(62, String(item.aci)) + pair(6, "CONTINUOUS")).join("") +
      pair(0, "ENDTAB") + pair(0, "ENDSEC");
    const body = pair(0, "SECTION") + pair(2, "ENTITIES") + entities + pair(0, "ENDSEC");
    return { text: header + tables + body + pair(0, "EOF"), counts,
      layers: layerTable.map(item => item.name) };
  }

  const textHeight = style => {
    const size = (style && style.label_font && style.label_font.size) || 11;
    // кегль на экране в пикселях → метры местности при опорном 1:2000
    return Math.max(0.5, size * 0.5);
  };

  function textAnchor(feature) {
    if (Array.isArray(feature.point)) return feature.point;
    if (feature.circle) return [feature.circle.cx, feature.circle.cy];
    if (feature.arc) return [feature.arc.cx, feature.arc.cy];
    const points = feature.ring || feature.line;
    if (!points || !points.length) return null;
    if (feature.ring && root.GRADO_LABELS)
      return root.GRADO_LABELS.poleOfInaccessibility([feature.ring, ...(feature.holes || [])]);
    let x = 0, y = 0;
    for (const point of points) { x += point[0]; y += point[1]; }
    return [x / points.length, y / points.length];
  }

  root.GRADO_DXF = { buildDxf, toAci, layerName, textAnchor };

  if (typeof document === "undefined") return;

  function exportDxf() {
    const features = typeof catVisibleFeatures === "function" ? catVisibleFeatures() : state.features;
    if (!features.length) { toast("Проект пуст — сначала добавьте объекты", "warn"); return; }
    const layers = LAYERS_V2.filter(layer => layer.visible !== false &&
      features.some(feature => layerOf(feature) === layer));
    const crsInfo = typeof window.projectCrsInfo === "function" ? window.projectCrsInfo() : null;
    const { text, counts, layers: names } = buildDxf({ features, layers,
      styleOf: feature => feature ? styleOf(feature) : {},
      layerOf, labelOf, origin: crsInfo ? crsInfo.origin : [0, 0] });
    const blob = new Blob([text], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(document.getElementById("project-name")?.value || "чертёж").trim()}.dxf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const skipped = counts.skipped ? `, пропущено ${counts.skipped}` : "";
    toast(`DXF: ${ruCount(names.length, "слой", "слоя", "слоёв")}, ` +
      `${ruCount(counts.polyline + counts.point + counts.circle + counts.arc, "объект", "объекта", "объектов")}, ` +
      `${ruCount(counts.text, "подпись", "подписи", "подписей")}${skipped}`);
  }

  root.exportDxf = exportDxf;
})(typeof window !== "undefined" ? window : globalThis);
