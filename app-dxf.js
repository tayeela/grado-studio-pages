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

  // ---------- типы линий ----------
  // Штрих не переносился ВООБЩЕ: таблицы LTYPE в файле не было, и каждому слою
  // безусловно писалось CONTINUOUS. В AutoCAD красная линия застройки приходила
  // сплошной и становилась неотличима от границы участка — то есть чертёж менял
  // смысл, а не только вид. R12 таблицу LTYPE поддерживает, писать её ничто не
  // мешало.
  //
  // Единицы. В стилях штрих задан в пикселях ОПОРНОГО масштаба (96 dpi:
  // 3779.5 px в метре бумаги — та же величина, что в groundFactor
  // из app-labels-place.js). В DXF единица одна — метр местности ($INSUNITS=6),
  // экрана там нет. Поэтому переводим: 11.34 px при 1:2000 → 6 м, 3.78 → 2 м.
  // Знакам ЛГР это родное (ground_units + ref_scale), а обычным стилям без
  // ref_scale берём те же 1:2000 — опорный масштаб чертежа градплана.
  const PX_V_METRE_BUMAGI = 3779.5;
  const OPORNYJ_MASSHTAB = 2000;
  function dashVMetrah(style) {
    const dash = style && Array.isArray(style.dash)
      ? style.dash.map(Number).filter(value => Number.isFinite(value) && value > 0) : null;
    if (!dash || dash.length < 2) return null;
    // Нечётная длина: canvas повторяет такой массив дважды (штрих и пробел
    // меняются местами на втором проходе), LTYPE — нет. Разворачиваем сами,
    // иначе узор в CAD пошёл бы в противофазе рисунку на холсте.
    const items = dash.length % 2 ? dash.concat(dash) : dash;
    const pxNaMetr = PX_V_METRE_BUMAGI / (Number(style.ref_scale) || OPORNYJ_MASSHTAB);
    return items.map(value => value / pxNaMetr);
  }

  const pair = (code, value) => `${code}\n${value}\n`;
  const num = value => (Math.round((Number(value) || 0) * 1000) / 1000).toString();
  let dxfOrigin = [0, 0];
  const numX = value => num(Number(value) + dxfOrigin[0]);
  const numY = value => num(Number(value) + dxfOrigin[1]);

  // ---------- сборка файла ----------
  function buildDxf({ features = [], layers = [], styleOf, layerOf, labelOf, markersOf,
                      origin = [0, 0] } = {}) {
    // origin проектной СК: в файл идут НАСТОЯЩИЕ координаты системы (МСК/ГК),
    // а не внутренние смещённые — получателю в САПР не нужно ничего двигать
    dxfOrigin = [Number(origin[0]) || 0, Number(origin[1]) || 0];
    // Один узор — один тип линии на весь файл: пять слоёв с одинаковым штрихом
    // не должны плодить пять одинаковых записей в таблице.
    const lineTypes = new Map();                 // ключ узора → { name, items, total }
    function lineTypeFor(style) {
      const ground = dashVMetrah(style);
      if (!ground) return null;
      const key = ground.map(value => value.toFixed(3)).join(",");
      if (!lineTypes.has(key)) {
        // В LTYPE штрих положительный, пробел отрицательный — знак и есть
        // различие, отдельного поля под него в формате нет.
        const items = ground.map((value, index) => (index % 2 ? -value : value));
        lineTypes.set(key, { name: `GRADO_D${lineTypes.size + 1}`, items,
          total: ground.reduce((sum, value) => sum + value, 0) });
      }
      return lineTypes.get(key).name;
    }

    const used = new Map();                      // слой → { name, aci, ltype }
    layers.forEach((layer, index) => {
      const style = (styleOf && styleOf(null, layer)) || layer.fmt || {};
      used.set(layer, { name: layerName(layer.title, index), aci: toAci(style.stroke),
        ltype: lineTypeFor(style) || "CONTINUOUS" });
    });

    let entities = "";
    // decor — зоны, у которых на холсте есть штриховка или заливка. В DXF R12
    // нет ни HATCH, ни SOLID-заливки по контуру: зона придёт в AutoCAD пустым
    // контуром. Молчать об этом нельзя — человек увидит другой чертёж, чем
    // выпускал, и не поймёт почему.
    let counts = { polyline: 0, point: 0, text: 0, circle: 0, arc: 0, skipped: 0, decor: 0, marker: 0 };

    const write = (type, layer, body) => {
      entities += pair(0, type) + pair(8, layer) + body;
    };

    for (const feature of features) {
      const layer = layerOf ? layerOf(feature) : null;
      const info = used.get(layer) || { name: "0", aci: 7, ltype: "CONTINUOUS" };
      const style = styleOf ? styleOf(feature) : {};
      const aci = toAci(style && style.stroke) || info.aci;
      // У объекта может быть свой знак, отличный от слоевого — цвет так уже
      // работает. Пишем тип линии на сущность, только когда он ОТЛИЧАЕТСЯ от
      // слоевого: иначе в файле стояло бы лишнее переопределение у каждой
      // строки, а по умолчанию сущность и так берёт BYLAYER.
      const ltype = lineTypeFor(style) || info.ltype;
      const ltypeTag = ltype === info.ltype ? "" : pair(6, ltype);

      if (Array.isArray(feature.ring) && feature.ring.length > 2) {
        const fill = style && style.fill;
        if (style && (style.hatch || (fill && fill !== "transparent" && fill !== "none")))
          counts.decor += 1;
        writeRing(feature.ring, info.name, aci, ltypeTag);
        for (const hole of feature.holes || [])
          if (hole && hole.length > 2) writeRing(hole, info.name, aci, ltypeTag);
        counts.polyline += 1;
      } else if (Array.isArray(feature.line) && feature.line.length > 1) {
        writeChain(feature.line, info.name, aci, false, ltypeTag);
        counts.polyline += 1;
      } else if (Array.isArray(feature.point)) {
        write("POINT", info.name, ltypeTag + pair(62, aci) + pair(10, numX(feature.point[0])) +
          pair(20, numY(feature.point[1])) + pair(30, "0"));
        counts.point += 1;
      } else if (feature.circle) {
        write("CIRCLE", info.name, ltypeTag + pair(62, aci) + pair(10, numX(feature.circle.cx)) +
          pair(20, numY(feature.circle.cy)) + pair(30, "0") + pair(40, num(feature.circle.r)));
        counts.circle += 1;
      } else if (feature.arc) {
        const a = feature.arc;
        const start = a.a0 * 180 / Math.PI;
        const end = (a.a0 + a.sweep) * 180 / Math.PI;
        write("ARC", info.name, ltypeTag + pair(62, aci) + pair(10, numX(a.cx)) + pair(20, numY(a.cy)) +
          pair(30, "0") + pair(40, num(a.r)) +
          pair(50, num(a.sweep >= 0 ? start : end)) + pair(51, num(a.sweep >= 0 ? end : start)));
        counts.arc += 1;
      } else { counts.skipped += 1; continue; }

      // Засечки знака ЛГР (галки, треугольники, «Т») — отдельные ломаные:
      // в DXF R12 составного знака линии нет, а без засечек красная линия ТОП
      // неотличима от ЛО. Штрих у самих засечек всегда сплошной.
      for (const path of (markersOf ? markersOf(feature) : []) || []) {
        if (!path || path.length < 2) continue;
        writeChain(path, info.name, aci, false);
        counts.marker += 1;
      }

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

    function writeRing(ring, layer, aci, ltypeTag) { writeChain(ring, layer, aci, true, ltypeTag); }
    function writeChain(points, layer, aci, closed, ltypeTag = "") {
      // LWPOLYLINE в R12 нет — пишем POLYLINE с вершинами: её читают все.
      // Тип линии — на самой POLYLINE: вершины его не несут, а SEQEND тем более.
      entities += pair(0, "POLYLINE") + pair(8, layer) + ltypeTag + pair(62, aci) +
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
    // Таблица LTYPE идёт ПЕРЕД таблицей слоёв: слой ссылается на тип линии по
    // имени, и AutoCAD требует, чтобы имя было объявлено раньше ссылки.
    // 72=65 — код 'A' («выравнивание A»), единственное значение, которое R12
    // знает. 73 — сколько отрезков в узоре, 40 — их суммарная длина.
    const ltypeList = [...lineTypes.values()];
    const ltypeTable = pair(0, "TABLE") + pair(2, "LTYPE") + pair(70, String(ltypeList.length + 1)) +
      pair(0, "LTYPE") + pair(2, "CONTINUOUS") + pair(70, "0") + pair(3, "Solid line") +
      pair(72, "65") + pair(73, "0") + pair(40, "0.0") +
      ltypeList.map(item => pair(0, "LTYPE") + pair(2, item.name) + pair(70, "0") +
        pair(3, item.items.map(value => (value > 0 ? "_" : ".")).join("")) +
        pair(72, "65") + pair(73, String(item.items.length)) + pair(40, num(item.total)) +
        item.items.map(value => pair(49, num(value))).join("")).join("") +
      pair(0, "ENDTAB");
    const tables = pair(0, "SECTION") + pair(2, "TABLES") + ltypeTable +
      pair(0, "TABLE") + pair(2, "LAYER") + pair(70, String(layerTable.length + 1)) +
      pair(0, "LAYER") + pair(2, "0") + pair(70, "0") + pair(62, "7") + pair(6, "CONTINUOUS") +
      layerTable.map(item => pair(0, "LAYER") + pair(2, item.name) + pair(70, "0") +
        pair(62, String(item.aci)) + pair(6, item.ltype)).join("") +
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

  // Засечки знака ЛГР (галки, треугольники, «Т», кружки) раскладывает
  // drawFeatureMarkers в app-labels-place.js: шаг по длине контура, привязка к
  // центру штриха, сторона по данным, «в обе стороны» со сдвигом фазы, восемь
  // форм знака. Повторять это здесь — значит завести второй экземпляр той же
  // раскладки, который разойдётся с холстом на первой правке. Поэтому вместо
  // холста подставляем ПИСЦА: тот же приём, которым лист PDF рисуется кодом
  // экрана (renderSceneTo в app.js).
  //
  // Вид на время записи — опорный 1:2000: при нём groundFactor === 1, то есть
  // засечка получает эталонный размер, а не «как сейчас на экране».
  const REF_K = PX_V_METRE_BUMAGI / OPORNYJ_MASSHTAB;
  function markerPathsOf(feature) {
    const style = typeof styleOf === "function" ? styleOf(feature) : null;
    if (!style || !style.line_marker || typeof drawFeatureMarkers !== "function") return [];
    const paths = [];
    let subs = [], sub = null;
    const toWorld = (sx, sy) => [sx / REF_K, -sy / REF_K];
    const сдать = () => {
      for (const item of subs) if (item.length > 1) paths.push(item);
      subs = []; sub = null;
    };
    const писец = {
      save() {}, restore() {}, setLineDash() {}, getLineDash() { return []; },
      beginPath() { subs = []; sub = null; },
      moveTo(x, y) { sub = [toWorld(x, y)]; subs.push(sub); },
      lineTo(x, y) { if (!sub) return писец.moveTo(x, y); sub.push(toWorld(x, y)); },
      closePath() { if (sub && sub.length > 2) sub.push(sub[0].slice()); },
      // кружок у знака chevron_dot: в R12 дуга есть, но засечка проще ломаной
      arc(cx, cy, r, from, to) {
        sub = []; subs.push(sub);
        for (let i = 0; i <= 12; i++) {
          const angle = from + (to - from) * (i / 12);
          sub.push(toWorld(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
        }
      },
      stroke() { сдать(); }, fill() { сдать(); },
    };
    const savedCtx = ctx, savedView = state.view, savedReadable = state.lgrReadable;
    ctx = писец;
    state.view = { k: REF_K, tx: 0, ty: 0 };
    // «Читаемый ЛГР» поднимает засечку до разборчивого на экране размера. Это
    // экранная поблажка: в выпуск знак идёт по эталону, иначе замер по чертежу
    // в CAD дал бы 3.7 м вместо 2 м (замерено).
    state.lgrReadable = false;
    try {
      const width = typeof lgrWidth === "function" ? lgrWidth(style) : (style.width || 1);
      const dash = typeof scaledDash === "function" ? scaledDash(style) : style.dash;
      drawFeatureMarkers(feature, style, width, dash);
    } catch (error) {
      console.warn("DXF: засечки знака не сняты", error);
    } finally { ctx = savedCtx; state.view = savedView; state.lgrReadable = savedReadable; }
    return paths;
  }

  function exportDxf() {
    const features = typeof catVisibleFeatures === "function" ? catVisibleFeatures() : state.features;
    if (!features.length) { toast("Проект пуст — сначала добавьте объекты", "warn"); return; }
    const layers = LAYERS_V2.filter(layer => layer.visible !== false &&
      features.some(feature => layerOf(feature) === layer));
    const crsInfo = typeof window.projectCrsInfo === "function" ? window.projectCrsInfo() : null;
    // Знак СЛОЯ (для таблицы слоёв) и знак ОБЪЕКТА берутся разными функциями:
    // styleOf ждёт объект и на null падает. Раньше здесь на слой возвращалась
    // пустая {} — и таблица слоёв уезжала в AutoCAD с цветом 7 у всех слоёв
    // подряд. Пока объекты несут цвет на себе, этого не видно, но стоит в CAD
    // назначить объекту «ПоСлою» — он белеет. Теперь слой отдаёт свой знак.
    const { text, counts, layers: names } = buildDxf({ features, layers,
      styleOf: (feature, layer) => feature ? styleOf(feature)
        : (typeof layerStyle === "function" ? layerStyle(layer) : {}),
      layerOf, labelOf, markersOf: markerPathsOf,
      origin: crsInfo ? crsInfo.origin : [0, 0] });
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
    // Контуры уходят целиком, а вот заливка и штриховка — нет: в DXF R12 такой
    // сущности не существует. Называем ограничение прямо и говорим, что делать
    // в AutoCAD, иначе человек решит, что чертёж выгрузился неверно.
    const decor = counts.decor
      ? ` · заливка и штриховка ${ruCount(counts.decor, "зоны", "зон", "зон")} не переносятся ` +
        "в DXF R12 — задайте их в AutoCAD штриховкой по контуру"
      : "";
    toast(`DXF: ${ruCount(names.length, "слой", "слоя", "слоёв")}, ` +
      `${ruCount(counts.polyline + counts.point + counts.circle + counts.arc, "объект", "объекта", "объектов")}, ` +
      `${ruCount(counts.text, "подпись", "подписи", "подписей")}${skipped}${decor}`,
      counts.decor ? "warn" : undefined);
  }

  root.exportDxf = exportDxf;
})(typeof window !== "undefined" ? window : globalThis);
