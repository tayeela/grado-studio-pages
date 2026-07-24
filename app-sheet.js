// Лист чертежа: рамка на холсте и выпуск PDF в масштабе.
//
// Печать в масштабе в браузерной редакции была недоступна вовсе, хотя работа
// идёт именно в браузере. Здесь собирается лист: формат, круглый масштаб,
// рамка, которую ставят на чертёж мышью, и выпуск через собственный писатель
// PDF (app-pdf.js) тем же кодом отрисовки, что рисует экран.
//
// Масштаб нельзя «подогнать зумом»: на экране он получается дробным (в
// масштабной линейке он и подписан приблизительным, «~1:N»), а на чертеже
// обязан быть круглым и совпадать с подписью. Поэтому охват задаёт рамка, а не
// текущий вид.
(function (root) {
  "use strict";

  const TILES = root.GRADO_TILES || { SOURCES: {}, pickZoom: () => ({ actual: 0, actualDpi: 0, upscaled: false }) };
  const MM_PER_PX = 25.4 / 96;                 // единицы холста = CSS-пиксели
  const PX_PER_MM = 96 / 25.4;

  const FORMATS = {
    A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210],
  };
  const SCALES = [500, 1000, 2000, 5000, 10000, 25000];

  // размер листа в миллиметрах с учётом ориентации
  function sheetSize(format, portrait) {
    const size = FORMATS[format] || FORMATS.A3;
    return portrait ? [size[1], size[0]] : [size[0], size[1]];
  }

  // Вид для отрисовки листа: k — экранных единиц на метр местности. При 1:2000
  // метр местности — это полмиллиметра листа, дальше миллиметры переводятся
  // в единицы холста, чтобы толщины линий на листе остались теми же, что
  // задуманы в знаках.
  // Колонка занимает правую часть листа, поэтому чертёж живёт не во всём листе,
  // а в оставшейся полосе — и центрировать его надо по ней. Иначе правый край
  // чертежа молча уходит под колонку, а человек этого до выпуска не видит.
  const columnMm = sheet => (sheet.column && sheet.column.on === false)
    ? 0 : Number((sheet.column || {}).widthMm) || 0;

  function sheetView(sheet) {
    const k = (1000 / sheet.scale) * PX_PER_MM;
    const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
    const width = widthMm * PX_PER_MM, height = heightMm * PX_PER_MM;
    const drawWidth = (widthMm - columnMm(sheet)) * PX_PER_MM;
    return { k, tx: drawWidth / 2 - sheet.cx * k, ty: height / 2 + sheet.cy * k,
      width, height, drawWidth, widthMm, heightMm };
  }

  // охват ЧЕРТЁЖНОЙ части листа на местности (метры) — по нему рисуется рамка
  function sheetExtent(sheet) {
    const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
    const halfW = (widthMm - columnMm(sheet)) / 1000 * sheet.scale / 2;
    const halfH = heightMm / 1000 * sheet.scale / 2;
    return [sheet.cx - halfW, sheet.cy - halfH, sheet.cx + halfW, sheet.cy + halfH];
  }

  root.GRADO_SHEET_CORE = { FORMATS, SCALES, sheetSize, sheetView, sheetExtent,
    MM_PER_PX, PX_PER_MM, drawSheetColumn, legendRows, wrapText };
  root.drawSheetColumn = drawSheetColumn;

  // ---------- колонка листа ----------
  // По эталону заказчика: чертёж идёт под обрез, справа белая колонка с
  // заголовком, условными обозначениями, таблицей ТЭП и сносками; номер листа —
  // в рамке в правом нижнем углу. Рамки по ГОСТ и основной надписи на таких
  // листах нет.
  const PT = 96 / 72;                          // пункт шрифта в единицах листа
  const mmToPx = value => value * PX_PER_MM;

  // Перенос строки по ширине: измеряем той же метрикой, которой пишем.
  function wrapText(context, text, maxWidth) {
    const out = [];
    for (const paragraph of String(text || "").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const probe = line ? line + " " + word : word;
        if (line && context.measureText(probe).width > maxWidth) { out.push(line); line = word; }
        else line = probe;
      }
      out.push(line);
    }
    return out;
  }

  // Строки условных обозначений собираются из того же, что показывает панель
  // «Легенда»: слои, их категории и диапазоны градуированной символики.
  function legendRowsForLayer(layer) {
    const rows = [];
    const features = state.features.filter(f => layerOf(f) === layer);
    if (!features.length) return rows;
    const ranges = typeof rangeRulesOf === "function" ? rangeRulesOf(layer) : [];
    if (ranges.length) {
      const base = layerStyle(layer) || {};
      for (const rule of ranges)
        rows.push({ title: rule.title || `${rule.min} – ${rule.max}`,
          style: { ...base, ...rule.patch }, geometry: layer.geometry_type });
      return rows;
    }
    const cats = typeof layerCatStats === "function" ? layerCatStats(layer) : [];
    const visible = cats.filter(cat => !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id));
    if (visible.length > 1) {
      for (const cat of visible)
        rows.push({ title: cat.title, style: cat.sample ? styleOf(cat.sample) : layerStyle(layer),
          geometry: layer.geometry_type });
      return rows;
    }
    rows.push({ title: layer.title, style: styleOf(features[0]) || layerStyle(layer),
      geometry: layer.geometry_type });
    return rows;
  }

  // Группы легенды — по эталонному альбому: «Границы», «Застройка», «Линии
  // градостроительного регулирования» печатаются заголовками в заданном
  // порядке. Раскладка хранится в проекте (state.sheetLegend); слои внутри
  // группы идут в порядке панели слоёв, не попавшие в группы — после групп
  // без заголовка. Пустая группа (слой скрыт или пуст) заголовок не печатает.
  function legendRows() {
    // в Node слоёв нет — раскладка обязана собираться и без них
    if (typeof LAYERS_V2 === "undefined" || typeof state === "undefined") return [];
    const eligible = LAYERS_V2.filter(layer => layer.visible);
    const cfg = state.sheetLegend;
    if (!cfg || !Array.isArray(cfg.groups) || !cfg.groups.length)
      return eligible.flatMap(legendRowsForLayer);
    const rows = [];
    const used = new Set();
    for (const group of cfg.groups) {
      const memberIds = new Set(Array.isArray(group.layers) ? group.layers : []);
      const members = eligible.filter(layer => memberIds.has(layer.id));
      const body = members.flatMap(legendRowsForLayer);
      members.forEach(layer => used.add(layer.id));
      if (!body.length) continue;
      if (group.title) rows.push({ heading: true, title: String(group.title) });
      rows.push(...body);
    }
    for (const layer of eligible)
      if (!used.has(layer.id)) rows.push(...legendRowsForLayer(layer));
    return rows;
  }

  // образец знака: полигон — заливка с обводкой, линия — штрих, точка — кружок
  function drawSample(context, style, geometry, x, y, width, height) {
    context.save();
    const dash = Array.isArray(style.dash) ? style.dash.map(value => value * 0.7) : [];
    context.setLineDash(dash);
    context.lineWidth = Math.max(0.6, (style.width || 1) * 0.9);
    context.strokeStyle = style.stroke || "#5c5a54";
    if (geometry === "point") {
      context.fillStyle = style.fill || style.stroke || "#2f6fde";
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (geometry === "polyline") {
      context.beginPath();
      context.moveTo(x, y + height / 2);
      context.lineTo(x + width, y + height / 2);
      context.stroke();
    } else {
      if (style.fill) { context.fillStyle = style.fill; context.fillRect(x, y, width, height); }
      context.strokeRect(x, y, width, height);
    }
    context.restore();
  }

  // Таблица ТЭП берётся из готового расчёта студии — того же, что показан
  // в панели: считать второй раз ради листа незачем.
  function tepRows() {
    const data = root.lastTepData;
    if (!data || !Array.isArray(data.results)) return [];
    const skip = new Set(["doo_places", "school_places", "policlinic_places"]);
    return data.results.filter(row => !skip.has(row.id))
      .map(row => ({ title: row.title, value: `${row.value} ${row.unit}`.trim() }));
  }

  function drawSheetColumn(context, sheet, view) {
    const column = sheet.column || {};
    if (column.on === false) return;
    const widthPx = mmToPx(column.widthMm || 110);
    const pad = mmToPx(8);
    const x = view.width - widthPx;
    const right = view.width - pad;
    const inner = widthPx - pad * 2;

    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(x, 0, widthPx, view.height);
    context.textBaseline = "alphabetic";
    let y = pad + 14 * PT;

    if (column.title) {
      // Капитель — по требованию: в эталонном альбоме ею набран титул, а не
      // каждый лист. Нет положенного файла — рекордер возьмёт полужирный.
      context.font = column.smallCapsTitle
        ? `small-caps 700 ${16 * PT}px sans-serif`
        : `700 ${16 * PT}px sans-serif`;
      context.fillStyle = "#1c1c1a";
      context.textAlign = "right";
      for (const line of wrapText(context, column.title, inner)) {
        context.fillText(line, right, y);
        y += 19 * PT;
      }
      y += 6 * PT;
    }

    context.textAlign = "left";
    const left = x + pad;

    if (column.legend !== false) {
      context.font = `700 ${10 * PT}px sans-serif`;
      context.fillStyle = "#1c1c1a";
      context.fillText("Условные обозначения", left, y);
      y += 17 * PT;                            // образец высотой 4 мм не должен лезть на заголовок
      context.font = `${7.5 * PT}px sans-serif`;
      const sampleW = mmToPx(11), sampleH = mmToPx(4), gap = mmToPx(3);
      for (const row of legendRows()) {
        if (y > view.height - pad - mmToPx(20)) break;
        if (row.heading) {
          // заголовок группы («Границы», «Застройка»…) — без образца знака
          y += 3 * PT;
          context.font = `700 ${8 * PT}px sans-serif`;
          context.fillStyle = "#1c1c1a";
          context.fillText(row.title, left, y);
          y += 12 * PT;
          context.font = `${7.5 * PT}px sans-serif`;
          continue;
        }
        drawSample(context, row.style || {}, row.geometry, left, y - sampleH + 1.5 * PT, sampleW, sampleH);
        context.fillStyle = "#44423c";
        const lines = wrapText(context, row.title, inner - sampleW - gap);
        let lineY = y;
        for (const line of lines) { context.fillText(line, left + sampleW + gap, lineY); lineY += 9 * PT; }
        y = Math.max(lineY, y + sampleH + 2 * PT);
      }
      y += 6 * PT;
    }

    if (column.tep !== false) {
      const rows = tepRows();
      if (rows.length) {
        context.font = `700 ${10 * PT}px sans-serif`;
        context.fillStyle = "#1c1c1a";
        context.fillText("Технико-экономические показатели", left, y);
        y += 14 * PT;
        const rowH = 11 * PT, numberW = mmToPx(7), valueW = mmToPx(26);
        context.font = `${7 * PT}px sans-serif`;
        rows.forEach((row, index) => {
          if (y > view.height - pad - mmToPx(14)) return;
          if (index % 2 === 0) {
            context.fillStyle = "#f2f0ec";
            context.fillRect(left, y - rowH + 3 * PT, inner, rowH);
          }
          context.fillStyle = "#44423c";
          context.textAlign = "left";
          context.fillText(String(index + 1), left + 1.5 * PT, y);
          const lines = wrapText(context, row.title, inner - numberW - valueW - 4 * PT);
          context.fillText(lines[0] + (lines.length > 1 ? "…" : ""), left + numberW, y);
          context.textAlign = "right";
          context.fillStyle = "#1c1c1a";
          context.font = `700 ${7 * PT}px sans-serif`;
          context.fillText(row.value, left + inner - 1.5 * PT, y);
          context.font = `${7 * PT}px sans-serif`;
          context.textAlign = "left";
          y += rowH;
        });
        y += 6 * PT;
      }
    }

    if (column.notes) {
      context.font = `${6.5 * PT}px sans-serif`;
      context.fillStyle = "#6b675f";
      for (const line of wrapText(context, column.notes, inner)) {
        if (y > view.height - pad - mmToPx(12)) break;
        context.fillText(line, left, y);
        y += 8 * PT;
      }
    }

    if (column.number) {
      const box = mmToPx(9);
      const bx = right - box, by = view.height - pad - box;
      context.strokeStyle = "#44423c";
      context.lineWidth = 0.8;
      context.setLineDash([]);
      context.strokeRect(bx, by, box, box);
      context.font = `${9 * PT}px sans-serif`;
      context.fillStyle = "#1c1c1a";
      context.textAlign = "center";
      context.fillText(String(column.number), bx + box / 2, by + box / 2 + 3 * PT);
      context.textAlign = "left";
    }
    context.restore();
  }
  root.sheetLegendRows = legendRows;

  if (typeof document === "undefined") return;

  // Рамка — состояние вида, а не проекта: в .grado не пишется и историю не
  // засоряет (так же поступили с находками проверки топологии).
  let sheet = null;
  // рамка листа при смене СК проекта: наружу отдаём тек. координаты в WGS84,
  // обратно принимаем пересчитанные в новую СК
  root.reprojectSheet = toWgs => {
    if (!sheet) return null;
    const wgs = toWgs([sheet.cx, sheet.cy]);
    return fromWgs => {
      const [x, y] = fromWgs(wgs);
      sheet.cx = x; sheet.cy = y;
      save();
    };
  };
  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("grado-sheet") || "null");
      if (saved && FORMATS[saved.format]) return saved;
    } catch (error) {}
    return null;
  };
  const save = () => {
    try { localStorage.setItem("grado-sheet", JSON.stringify(sheet)); } catch (error) {}
  };

  function defaultSheet() {
    const [wx, wy] = s2w(viewportWidth() / 2, viewportHeight() / 2);
    const saved = load();
    return { format: saved?.format || "A3", portrait: !!saved?.portrait,
      scale: saved?.scale || 2000, cx: wx, cy: wy,
      column: saved?.column || { on: true, widthMm: 110, legend: true, tep: true,
        title: "", notes: "", number: "" },
      raster: saved?.raster || { on: false, source: "esri", dpi: 300 } };
  }
  const viewportWidth = () => document.getElementById("cv").clientWidth || 800;
  const viewportHeight = () => document.getElementById("cv").clientHeight || 600;

  // ---------- рамка на холсте ----------
  function sheetDrawOverlay(context) {
    if (!sheet || typeof w2s !== "function") return;
    const [x0, y0, x1, y1] = sheetExtent(sheet);
    const a = w2s(x0, y1), b = w2s(x1, y0);
    context.save();
    context.setLineDash([8, 5]);
    context.lineWidth = 1.5;
    context.strokeStyle = cvColor("accent", "#2f6fde");
    context.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    context.setLineDash([]);
    // затемняем всё, что за пределами листа: видно, что попадёт в выпуск
    context.fillStyle = "rgba(20,20,25,0.10)";
    const w = viewportWidth(), h = viewportHeight();
    context.beginPath();
    context.rect(0, 0, w, h);
    context.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    context.fill("evenodd");
    context.fillStyle = cvColor("accent", "#2f6fde");
    context.font = "600 12px sans-serif";
    context.textAlign = "left";
    context.fillText(`${sheet.format} ${sheet.portrait ? "книжный" : "альбомный"} · 1:${sheet.scale.toLocaleString("ru-RU")}`,
      a[0] + 8, a[1] - 8);
    context.restore();
  }
  root.sheetDrawOverlay = sheetDrawOverlay;
  root.sheetFrame = () => sheet;

  // перетаскивание рамки мышью
  let drag = null;
  const insideFrame = (wx, wy) => {
    if (!sheet) return false;
    const [x0, y0, x1, y1] = sheetExtent(sheet);
    return wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1;
  };
  root.sheetPointerDown = (wx, wy) => {
    if (!sheet || state.tool !== "sheet" || !insideFrame(wx, wy)) return false;
    drag = { dx: sheet.cx - wx, dy: sheet.cy - wy };
    return true;
  };
  root.sheetPointerMove = (wx, wy) => {
    if (!drag) return false;
    sheet.cx = wx + drag.dx;
    sheet.cy = wy + drag.dy;
    draw();
    return true;
  };
  root.sheetPointerUp = () => {
    if (!drag) return false;
    drag = null;
    save();
    return true;
  };

  // ---------- выпуск ----------
  async function buildSheetPdf(options = {}) {
    const PDF = root.GRADO_PDF;
    if (!PDF) throw new Error("модуль PDF не загружен");
    const faces = await sheetFont();
    const doc = PDF.createDocument();
    const fontFaces = {};
    for (const item of FACES) {
      if (!faces[item.key]) continue;
      const name = `Sheet_${item.key}`;
      doc.addFont(name, faces[item.key].bytes);
      fontFaces[item.key] = name;
    }
    const list = options.sheets && options.sheets.length ? options.sheets : [sheet];
    const rasters = [];
    for (let i = 0; i < list.length; i++) {
      const current = list[i];
      options.onSheet?.({ index: i, total: list.length, sheet: current });
      const raster = await addSheetPage(doc, PDF, current, {
        ...options,
        onRaster: options.onRaster
          ? progress => options.onRaster({ ...progress, index: i, total: list.length })
          : null,
      }, fontFaces);
      rasters.push(raster);
    }
    return { bytes: doc.build(), raster: rasters[0], rasters, pages: list.length };
  }

  // Один лист альбома — страница документа. Шрифт и растры общие для всего
  // файла, поэтому альбом из десяти листов весит не в десять раз больше.
  async function addSheetPage(doc, PDF, current, options, fontFaces) {
    const view = sheetView(current);
    const page = doc.addPage(view.widthMm, view.heightMm);
    const context = PDF.createContext(doc, page,
      { scale: 96 / 72, fontName: fontFaces.regular, fontFaces });
    // Подложка кладётся ПЕРВОЙ: вектор чертежа обязан лежать поверх снимка.
    const raster = await sheetRaster(doc, context, view, options, current);
    renderSceneTo(context, view.width, view.height, { k: view.k, tx: view.tx, ty: view.ty });
    drawSheetColumn(context, current, view);
    if (raster) drawAttribution(context, view, raster);
    return raster;
  }

  // Растр вкладывается ровно в чертёжную полосу листа: рамка листа и есть его
  // охват, поэтому снимок не нужно ни двигать, ни подрезать на месте.
  async function sheetRaster(doc, context, view, options, current = sheet) {
    const config = current.raster || {};
    if (!config.on || !root.buildSheetRaster) return null;
    if (typeof localToLonLat !== "function") return null;
    const [x0, y0, x1, y1] = sheetExtent(current);
    const sw = localToLonLat(x0, y0), ne = localToLonLat(x1, y1);
    const bbox = [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1]),
                  Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])];
    const built = await root.buildSheetRaster({ source: config.source || "esri", bbox,
      scale: current.scale, dpi: Number(config.dpi) || 300,
      sourceOptions: { instance: cdseInstance() },
      signal: options.signal, onProgress: options.onRaster });
    const image = doc.addJpeg(built.bytes, built.width, built.height);
    context.drawImage({ __pdfImage: image }, 0, 0, view.drawWidth, view.height);
    return built;
  }

  // Источник тайлов обязан быть подписан на листе — это условие использования
  // и у OSM, и у ESRI.
  function drawAttribution(context, view, raster) {
    context.save();
    context.font = `${6 * (96 / 72)}px sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#ffffff";
    const text = raster.attribution;
    const width = context.measureText(text).width;
    const x = 6 * PX_PER_MM, y = view.height - 4 * PX_PER_MM;
    context.globalAlpha = 0.75;
    context.fillRect(x - 2, y - 8, width + 6, 12);
    context.globalAlpha = 1;
    context.fillStyle = "#44423c";
    context.fillText(text, x, y);
    context.restore();
  }

  // ---------- шрифт листа ----------
  // Century Gothic — шрифт Monotype: раздавать его файл с сайта нельзя, а
  // встраивать в СВОЙ выпущенный PDF можно. Поэтому человек кладёт файл один
  // раз со своей машины, тот остаётся в браузере (IndexedDB) и наружу не
  // уходит. Пока файла нет, лист идёт на Onest из репозитория: он лежит рядом
  // и его лицензия встраивание разрешает.
  const FONT_DB = "grado-sheet-font";
  const FALLBACK_FONT = { name: "Onest", url: "./fonts/Onest-Variable.ttf" };
  // Четыре начертания — ровно те, что живут в рабочем альбоме: обычное,
  // полужирное, курсив и полужирный курсив. Каждое кладётся своим файлом:
  // в TrueType это разные файлы, а не варианты одного.
  const FACES = [
    { key: "regular", title: "обычное" },
    { key: "bold", title: "полужирное" },
    { key: "italic", title: "курсив" },
    { key: "boldItalic", title: "полужирный курсив" },
    { key: "smallCaps", title: "капитель (SC700)" },
  ];
  let fontCache = null;

  function fontStore(mode) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FONT_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("fonts");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("fonts", mode);
        resolve({ store: tx.objectStore("fonts"), done: new Promise(ok => { tx.oncomplete = ok; }) });
      };
    });
  }

  async function savedFont(face = "regular") {
    if (typeof indexedDB === "undefined") return null;
    try {
      const { store } = await fontStore("readonly");
      return await new Promise((resolve, reject) => {
        const request = store.get(face === "regular" ? "sheet" : `sheet:${face}`);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) { return null; }
  }

  async function storeFont(name, bytes, face = "regular") {
    const { store, done } = await fontStore("readwrite");
    store.put({ name, bytes, face, at: Date.now() },
      face === "regular" ? "sheet" : `sheet:${face}`);
    await done;
    fontCache = null;
  }

  async function forgetFont(face) {
    const { store, done } = await fontStore("readwrite");
    if (face) store.delete(face === "regular" ? "sheet" : `sheet:${face}`);
    else for (const item of FACES)
      store.delete(item.key === "regular" ? "sheet" : `sheet:${item.key}`);
    await done;
    fontCache = null;
  }

  // Файл шрифта проверяем СРАЗУ при выборе: разбираем таблицы и убеждаемся, что
  // в нём есть кириллица. Иначе человек узнал бы о подмене только по готовому
  // листу с пустыми прямоугольниками вместо букв.
  function checkFont(bytes) {
    const PDF = root.GRADO_PDF;
    if (!PDF) throw new Error("модуль PDF не загружен");
    const font = PDF.readFont(bytes);
    const missing = [];
    for (const char of "АБВЯабвя№")
      if (!font.glyphOf(char.codePointAt(0))) missing.push(char);
    if (missing.length)
      throw new Error(`в шрифте нет кириллицы (${missing.join("")}) — лист им не набрать`);
    return font;
  }

  // Набор начертаний для выпуска: что положил человек, плюс запасное обычное.
  async function sheetFont() {
    if (fontCache) return fontCache;
    const faces = {};
    for (const item of FACES) {
      const saved = await savedFont(item.key);
      if (saved && saved.bytes) faces[item.key] = { name: saved.name, bytes: new Uint8Array(saved.bytes) };
    }
    if (!faces.regular) {
      const response = await fetch(FALLBACK_FONT.url);
      if (!response.ok) throw new Error("не найден шрифт листа");
      faces.regular = { name: FALLBACK_FONT.name, own: false,
        bytes: new Uint8Array(await response.arrayBuffer()) };
    }
    fontCache = faces;
    return fontCache;
  }
  root.sheetFontInfo = async () => {
    const out = {};
    for (const item of FACES) {
      const saved = await savedFont(item.key);
      out[item.key] = saved
        ? { name: saved.name, own: true, size: saved.bytes.byteLength || saved.bytes.length }
        : { name: item.key === "regular" ? FALLBACK_FONT.name : null, own: false };
    }
    return out;
  };
  root.setSheetFont = async (file, face = "regular") => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    checkFont(bytes);
    await storeFont(file.name.replace(/\.(ttf|otf)$/i, ""), bytes, face);
    return true;
  };
  root.clearSheetFont = forgetFont;
  root.SHEET_FACES = FACES;

  function saveFile(name, bytes) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- группы легенды ----------
  // Заголовки как в эталонном альбоме: слой назначается в группу, группы
  // печатаются в своём порядке. Порядок слоёв внутри группы — порядок панели
  // слоёв: он уже управляется перетаскиванием там, второй порядок не нужен.
  function openLegendGroups() {
    closePopups();
    const eligible = LAYERS_V2.filter(layer =>
      layer.visible && state.features.some(f => layerOf(f) === layer));
    if (!eligible.length) { toast("В проекте нет видимых слоёв с объектами", "warn"); return; }
    let groups = state.sheetLegend && Array.isArray(state.sheetLegend.groups)
      ? JSON.parse(JSON.stringify(state.sheetLegend.groups)) : [];

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal legend-groups-modal" role="dialog" aria-modal="true" aria-labelledby="lg-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Выпуск</span><span id="lg-title">Группы легенды листа</span></div>
        <button class="modal-x" aria-label="Закрыть группы легенды"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body select-body">
        <p class="vector-intro">Группы печатаются в колонке листа заголовками в своём порядке;
          слои внутри группы идут в порядке панели слоёв, не назначенные — после групп без заголовка.
          Раскладка хранится в проекте.</p>
        <div class="lg-groups" id="lg-groups"></div>
        <div class="fmt-row">
          <button type="button" id="lg-add">Добавить группу</button>
          <button type="button" id="lg-preset" title="Границы / Застройка / Линии градостроительного регулирования — слои разложатся по своим ролям">Как в альбоме</button>
        </div>
        <div class="lg-layers" id="lg-layers"></div>
      </div>
      <div class="modal-actions"><button type="button" id="lg-clear">Без групп</button><span class="spacer"></span>
        <button type="button" id="lg-cancel">Отмена</button>
        <button type="button" id="lg-apply" class="primary">Применить</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const $g = id => overlay.querySelector("#" + id);

    const membership = layerId => groups.findIndex(group =>
      Array.isArray(group.layers) && group.layers.includes(layerId));
    const unassign = layerId => { for (const group of groups)
      group.layers = (group.layers || []).filter(id => id !== layerId); };

    const render = () => {
      $g("lg-groups").innerHTML = groups.map((group, index) => `<div class="lg-group-row">
        <input type="text" data-lg-name="${index}" value="${escHtml(group.title || "")}" placeholder="Название группы">
        <button type="button" data-lg-up="${index}" title="Выше"${index ? "" : " disabled"}>↑</button>
        <button type="button" data-lg-down="${index}" title="Ниже"${index < groups.length - 1 ? "" : " disabled"}>↓</button>
        <button type="button" data-lg-del="${index}" title="Убрать группу">✕</button>
      </div>`).join("") || `<div class="muted">Групп нет — легенда печатается сплошным списком.</div>`;
      $g("lg-layers").innerHTML = eligible.map(layer => `<div class="lg-layer-row">
        <span>${escHtml(layer.title)}</span>
        <select data-lg-layer="${escHtml(layer.id)}">
          <option value="-1">— без группы —</option>
          ${groups.map((group, index) => `<option value="${index}"${membership(layer.id) === index ? " selected" : ""}>${escHtml(group.title || `Группа ${index + 1}`)}</option>`).join("")}
        </select>
      </div>`).join("");
      overlay.querySelectorAll("[data-lg-name]").forEach(input =>
        input.addEventListener("input", () => { groups[+input.dataset.lgName].title = input.value; }));
      overlay.querySelectorAll("[data-lg-up]").forEach(button =>
        button.addEventListener("click", () => { const i = +button.dataset.lgUp;
          [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]; render(); }));
      overlay.querySelectorAll("[data-lg-down]").forEach(button =>
        button.addEventListener("click", () => { const i = +button.dataset.lgDown;
          [groups[i], groups[i + 1]] = [groups[i + 1], groups[i]]; render(); }));
      overlay.querySelectorAll("[data-lg-del]").forEach(button =>
        button.addEventListener("click", () => { groups.splice(+button.dataset.lgDel, 1); render(); }));
      overlay.querySelectorAll("[data-lg-layer]").forEach(select =>
        select.addEventListener("change", () => {
          const layerId = select.dataset.lgLayer;
          unassign(layerId);
          const index = +select.value;
          if (index >= 0 && groups[index]) (groups[index].layers = groups[index].layers || []).push(layerId);
        }));
    };
    $g("lg-add").addEventListener("click", () => { groups.push({ title: "", layers: [] }); render(); });
    $g("lg-preset").addEventListener("click", () => {
      // роли слоёв раскладываются сами: границы — в «Границы», здания —
      // в «Застройку», красные линии и ограничения — в «Линии
      // градостроительного регулирования»; остальное остаётся без группы
      const byKind = kinds => eligible.filter(layer => kinds.includes(layer.kind)).map(layer => layer.id);
      groups = [
        { title: "Границы", layers: byKind(["boundary"]) },
        { title: "Застройка", layers: byKind(["building"]) },
        { title: "Линии градостроительного регулирования", layers: byKind(["redline", "restrict"]) },
      ];
      render();
    });
    const close = () => overlay.remove();
    $g("lg-cancel").addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    $g("lg-clear").addEventListener("click", () => {
      state.sheetLegend = null;
      persist(); draw(); close();
      toast("Легенда — сплошным списком");
    });
    $g("lg-apply").addEventListener("click", () => {
      const cleaned = groups
        .map(group => ({ title: String(group.title || "").trim(),
          layers: (group.layers || []).filter(Boolean) }))
        .filter(group => group.title || group.layers.length);
      state.sheetLegend = cleaned.length ? { groups: cleaned } : null;
      persist(); draw(); close();
      toast("Группы легенды сохранены в проекте");
    });
    render();
  }
  root.openLegendGroups = openLegendGroups;

  // ---------- окно ----------
  function openSheetDialog() {
    closePopups();
    if (!sheet) sheet = defaultSheet();
    if (typeof setTool === "function") setTool("sheet");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Выпуск</span><span id="sheet-title">Лист PDF</span></div>
        <button class="modal-x" aria-label="Закрыть выпуск листа"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body sheet-body">
        <p class="sheet-intro">Рамка на чертеже показывает, что попадёт на лист. Двигайте её мышью; масштаб задаётся здесь и остаётся круглым.</p>
        <div class="fmt-row">
          <label>Формат<select id="sheet-format">${Object.keys(FORMATS).map(key =>
            `<option value="${key}"${key === sheet.format ? " selected" : ""}>${key}</option>`).join("")}</select></label>
          <label>Ориентация<select id="sheet-orient">
            <option value="landscape"${sheet.portrait ? "" : " selected"}>альбомная</option>
            <option value="portrait"${sheet.portrait ? " selected" : ""}>книжная</option></select></label>
          <label>Масштаб<select id="sheet-scale">${SCALES.map(value =>
            `<option value="${value}"${value === sheet.scale ? " selected" : ""}>1:${value.toLocaleString("ru-RU")}</option>`).join("")}</select></label>
        </div>
        <label class="chk"><input type="checkbox" id="sheet-column"${sheet.column.on === false ? "" : " checked"}>Колонка справа: заголовок, условные обозначения, ТЭП</label>
        <div id="sheet-column-fields">
          <label class="sheet-field">Заголовок листа<textarea id="sheet-title-text" rows="2" placeholder="Схема архитектурно-планировочной организации территории">${escHtml(sheet.column.title || "")}</textarea></label>
          <div class="fmt-row">
            <label>Ширина колонки, мм<input type="number" id="sheet-column-width" min="40" max="200" step="5" value="${Number(sheet.column.widthMm) || 110}"></label>
            <label>Номер листа<input type="text" id="sheet-number" maxlength="4" value="${escHtml(sheet.column.number || "")}"></label>
          </div>
          <div class="fmt-row">
            <label class="chk"><input type="checkbox" id="sheet-legend"${sheet.column.legend === false ? "" : " checked"}>Условные обозначения</label>
            <label class="chk"><input type="checkbox" id="sheet-tep"${sheet.column.tep === false ? "" : " checked"}>Таблица ТЭП</label>
            <button type="button" id="sheet-legend-groups">Группы легенды…</button>
          </div>
          <label class="chk"><input type="checkbox" id="sheet-smallcaps"${sheet.column.smallCapsTitle ? " checked" : ""}>Заголовок капителью (SC700)</label>
          <label class="sheet-field">Примечания<textarea id="sheet-notes" rows="2" placeholder="* коэффициент перехода…">${escHtml(sheet.column.notes || "")}</textarea></label>
        </div>
        <label class="chk"><input type="checkbox" id="sheet-raster"${sheet.raster.on ? " checked" : ""}>Подложка на листе (растр в PDF)</label>
        <div id="sheet-raster-fields"${sheet.raster.on ? "" : " hidden"}>
          <div class="fmt-row">
            <label>Источник<select id="sheet-raster-source">${Object.entries(TILES.SOURCES).map(([key, spec]) =>
              `<option value="${key}"${key === sheet.raster.source ? " selected" : ""}>${escHtml(spec.title)}${spec.unofficial ? " (неофициальный)" : ""}</option>`).join("")}</select></label>
            <label>Плотность, dpi<input type="number" id="sheet-raster-dpi" min="150" max="600" step="50" value="${Number(sheet.raster.dpi) || 300}"></label>
          </div>
          <div class="sheet-raster-note" id="sheet-raster-note"></div>
          <label class="sheet-field" id="sheet-cdse-row" hidden>Идентификатор экземпляра Copernicus (Sentinel Hub)
            <input type="text" id="sheet-cdse-instance" placeholder="из личного кабинета CDSE" value="${escHtml(cdseInstance())}">
            <span class="sheet-raster-note">Хранится в этом браузере и никуда не отправляется, кроме самого Copernicus.</span>
          </label>
        </div>
        <div class="sheet-fonts" id="sheet-fonts">
          <div class="sheet-fonts-head">Шрифт листа — по одному файлу на начертание</div>
        </div>
        <div class="sheet-album" id="sheet-album"></div>
        <div class="sheet-summary" id="sheet-summary" role="status" aria-live="polite"></div>
      </div>
      <div class="modal-actions"><button type="button" id="sheet-center">По центру вида</button>
        <button type="button" id="sheet-album-add">Добавить в альбом</button><span class="spacer"></span>
        <button type="button" id="sheet-cancel">Закрыть</button>
        <button type="button" id="sheet-album-run">Выпустить альбом</button>
        <button type="button" id="sheet-run" class="primary">Выпустить лист</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const $ = id => overlay.querySelector("#" + id);
    const summary = $("sheet-summary");
    const update = () => {
      sheet.format = $("sheet-format").value;
      sheet.portrait = $("sheet-orient").value === "portrait";
      sheet.scale = Number($("sheet-scale").value) || 2000;
      sheet.column = {
        on: $("sheet-column").checked,
        widthMm: Math.max(40, Math.min(200, Number($("sheet-column-width").value) || 110)),
        legend: $("sheet-legend").checked,
        tep: $("sheet-tep").checked,
        smallCapsTitle: $("sheet-smallcaps").checked,
        title: $("sheet-title-text").value,
        notes: $("sheet-notes").value,
        number: $("sheet-number").value.trim(),
      };
      $("sheet-column-fields").hidden = !sheet.column.on;
      sheet.raster = { on: $("sheet-raster").checked,
        source: $("sheet-raster-source").value,
        dpi: Math.max(150, Math.min(600, Number($("sheet-raster-dpi").value) || 300)) };
      $("sheet-raster-fields").hidden = !sheet.raster.on;
      const needsKey = (TILES.SOURCES[sheet.raster.source] || {}).needsKey;
      $("sheet-cdse-row").hidden = !sheet.raster.on || !needsKey;
      if (needsKey) setCdseInstance($("sheet-cdse-instance").value.trim());
      if (sheet.raster.on) {
        const lat = typeof localToLonLat === "function" ? localToLonLat(sheet.cx, sheet.cy)[1] : 55.75;
        const choice = TILES.pickZoom({ source: sheet.raster.source, lat,
          scale: sheet.scale, dpi: sheet.raster.dpi });
        const note = $("sheet-raster-note");
        note.classList.toggle("warn", choice.upscaled);
        note.textContent = choice.upscaled
          ? `Источник даёт ${choice.actual.toFixed(2)} м/точку — это ${Math.round(choice.actualDpi)} dpi. ` +
            `Снимок будет увеличен до ${sheet.raster.dpi} dpi; резче он не станет.`
          : `Источник даёт ${choice.actual.toFixed(2)} м/точку — хватает на ${sheet.raster.dpi} dpi.`;
      }
      const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
      const columnWidth = sheet.column.on ? (Number(sheet.column.widthMm) || 110) : 0;
      const groundW = (widthMm - columnWidth) / 1000 * sheet.scale;
      const groundH = heightMm / 1000 * sheet.scale;
      summary.classList.remove("error");
      const drawMm = widthMm - columnWidth;
      summary.innerHTML = `<b>${widthMm}×${heightMm} мм</b><span>чертёж ${drawMm} мм` +
        `${columnWidth ? `, колонка ${columnWidth} мм` : ""} · накрывает ${Math.round(groundW)}×${Math.round(groundH)} м</span>`;
      save();
      draw();
    };
    ["sheet-format", "sheet-orient", "sheet-scale", "sheet-column", "sheet-legend", "sheet-tep",
      "sheet-raster", "sheet-raster-source", "sheet-smallcaps"]
      .forEach(id => $(id).addEventListener("change", update));
    $("sheet-raster-dpi").addEventListener("input", update);
    $("sheet-cdse-instance").addEventListener("input", update);
    ["sheet-column-width", "sheet-number", "sheet-title-text", "sheet-notes"]
      .forEach(id => $(id).addEventListener("input", update));
    const close = () => { overlay.remove(); };
    $("sheet-cancel").addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    $("sheet-legend-groups").addEventListener("click", openLegendGroups);
    $("sheet-center").addEventListener("click", () => {
      const [wx, wy] = s2w(viewportWidth() / 2, viewportHeight() / 2);
      sheet.cx = wx; sheet.cy = wy;
      save(); draw();
    });
    const showFont = async () => {
      const info = await root.sheetFontInfo();
      const box = $("sheet-fonts");
      box.innerHTML = `<div class="sheet-fonts-head">Шрифт листа — по одному файлу на начертание</div>` +
        FACES.map(item => {
          const state = info[item.key] || {};
          const text = state.own
            ? `${escHtml(state.name)} · ${Math.round(state.size / 1024)} КБ`
            : item.key === "regular"
              ? `${escHtml(state.name || "")} — запасной`
              : "не задано, возьмётся обычное";
          return `<div class="sheet-font-row">
            <span class="sheet-font-face">${item.title}</span>
            <span class="sheet-font-state${state.own ? " own" : ""}">${text}</span>
            <label class="sheet-font-pick">Файл<input type="file" data-face="${item.key}" accept=".ttf,.otf" hidden></label>
            ${state.own ? `<button type="button" data-face-clear="${item.key}" title="Убрать это начертание">×</button>` : ""}
          </div>`;
        }).join("");
      box.querySelectorAll("input[data-face]").forEach(input =>
        input.addEventListener("change", async event => {
          const file = event.target.files && event.target.files[0];
          if (!file) return;
          try {
            await root.setSheetFont(file, event.target.dataset.face);
            summary.classList.remove("error");
            await showFont();
          } catch (error) {
            summary.classList.add("error");
            summary.innerHTML = `<b>Файл шрифта не подошёл.</b><span>${escHtml(String(error.message || error))}</span>`;
          }
          event.target.value = "";
        }));
      box.querySelectorAll("[data-face-clear]").forEach(button =>
        button.addEventListener("click", async () => {
          await root.clearSheetFont(button.dataset.faceClear);
          await showFont();
        }));
    };
    showFont();

    let album = loadAlbum();
    const renderAlbum = () => {
      const box = $("sheet-album");
      if (!album.length) {
        box.innerHTML = `<span class="muted">Альбом пуст. «Добавить в альбом» запомнит текущую рамку — ` +
          `формат, масштаб, охват, заголовок и номер.</span>`;
        $("sheet-album-run").disabled = true;
        return;
      }
      $("sheet-album-run").disabled = false;
      box.innerHTML = album.map((item, index) =>
        `<div class="sheet-album-row">
          <span class="sheet-album-no">${escHtml(item.column && item.column.number || index + 1)}</span>
          <span class="sheet-album-title">${escHtml(albumTitle(item, index))}</span>
          <span class="sheet-album-meta">${escHtml(item.format)} 1:${item.scale.toLocaleString("ru-RU")}</span>
          <button type="button" data-album-open="${index}" title="Показать эту рамку на чертеже">Показать</button>
          <button type="button" data-album-drop="${index}" title="Убрать лист из альбома">×</button>
        </div>`).join("");
      box.querySelectorAll("[data-album-open]").forEach(button =>
        button.addEventListener("click", () => {
          const item = album[Number(button.dataset.albumOpen)];
          sheet = JSON.parse(JSON.stringify(item));
          save();
          overlay.remove();
          openSheetDialog();
        }));
      box.querySelectorAll("[data-album-drop]").forEach(button =>
        button.addEventListener("click", () => {
          album.splice(Number(button.dataset.albumDrop), 1);
          saveAlbum(album);
          renderAlbum();
        }));
    };

    $("sheet-album-add").addEventListener("click", () => {
      update();
      const copy = JSON.parse(JSON.stringify(sheet));
      // Номер по умолчанию — место в альбоме. Ручной номер уважаем, но
      // повторяться он не может: два листа с одним номером — это брак выпуска.
      const taken = new Set(album.map(item => String(item.column && item.column.number || "")));
      if (!copy.column.number || taken.has(String(copy.column.number))) {
        let next = album.length + 1;
        while (taken.has(String(next))) next += 1;
        copy.column.number = String(next);
      }
      album.push(copy);
      saveAlbum(album);
      renderAlbum();
      summary.classList.remove("error");
      summary.innerHTML = `<b>Лист добавлен в альбом.</b><span>всего листов: ${album.length}</span>`;
    });

    $("sheet-album-run").addEventListener("click", async () => {
      if (!album.length) return;
      const button = $("sheet-album-run");
      button.disabled = true;
      try {
        const { bytes, pages } = await buildSheetPdf({
          sheets: album,
          onSheet: ({ index, total }) => {
            summary.innerHTML = `<b>Собираем альбом…</b><span>лист ${index + 1} из ${total}</span>`;
          },
          onRaster: ({ done, total, index }) => {
            summary.innerHTML = `<b>Лист ${index + 1}: подложка…</b><span>${done} из ${total} тайлов</span>`;
          },
        });
        const name = (document.getElementById("project-name")?.value || "альбом").trim();
        saveFile(`${name} · альбом ${pages} л.pdf`, bytes);
        summary.classList.remove("error");
        summary.innerHTML = `<b>Готово: ${(bytes.length / 1024 / 1024).toFixed(1)} МБ</b>` +
          `<span>${ruCount(pages, "лист", "листа", "листов")} одним файлом</span>`;
      } catch (error) {
        summary.classList.add("error");
        summary.innerHTML = `<b>Не удалось собрать альбом.</b><span>${escHtml(String(error.message || error)).slice(0, 160)}</span>`;
      }
      button.disabled = false;
    });
    renderAlbum();

    $("sheet-run").addEventListener("click", async () => {
      const button = $("sheet-run");
      button.disabled = true;
      summary.innerHTML = `<b>Собираем лист…</b><span>вектор, тем же кодом, что рисует экран</span>`;
      try {
        const { bytes, raster } = await buildSheetPdf({
          onRaster: ({ done, total }) => {
            summary.innerHTML = `<b>Собираем подложку…</b><span>${done} из ${total} тайлов</span>`;
          },
        });
        const name = (document.getElementById("project-name")?.value || "лист").trim();
        saveFile(`${name} · ${sheet.format} 1-${sheet.scale}.pdf`, bytes);
        const rasterNote = raster
          ? ` · подложка ${Math.round(raster.actualDpi)} dpi${raster.failed ? `, ${raster.failed} тайлов не пришло` : ""}`
          : "";
        summary.innerHTML = `<b>Готово: ${(bytes.length / 1024 / 1024).toFixed(1)} МБ</b>` +
          `<span>масштаб 1:${sheet.scale.toLocaleString("ru-RU")}, ${sheet.format}${rasterNote}</span>`;
      } catch (error) {
        summary.classList.add("error");
        summary.innerHTML = `<b>Не удалось собрать лист.</b><span>${escHtml(String(error.message || error)).slice(0, 160)}</span>`;
      }
      button.disabled = false;
    });
    update();
  }

  // ---------- альбом ----------
  // Лист альбома — это сохранённая рамка со своим заголовком и номером.
  // Хранится рядом с рамкой (состояние вида): в проект альбом не пишется,
  // потому что это оформление выпуска, а не данные чертежа.
  // Ключ Copernicus — не данные проекта и не общая настройка: он личный,
  // поэтому живёт в этом браузере и в файл проекта не попадает.
  const CDSE_KEY = "grado-cdse-instance";
  const cdseInstance = () => {
    try { return localStorage.getItem(CDSE_KEY) || ""; } catch (error) { return ""; }
  };
  const setCdseInstance = value => {
    try {
      if (value) localStorage.setItem(CDSE_KEY, value); else localStorage.removeItem(CDSE_KEY);
    } catch (error) {}
  };
  root.sheetCdseInstance = cdseInstance;

  const ALBUM_KEY = "grado-sheet-album";
  const loadAlbum = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(ALBUM_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (error) { return []; }
  };
  const saveAlbum = list => {
    try { localStorage.setItem(ALBUM_KEY, JSON.stringify(list)); } catch (error) {}
  };
  root.sheetAlbum = loadAlbum;

  function albumTitle(item, index) {
    const title = (item.column && item.column.title || "").split("\n")[0].trim();
    return title || `Лист ${item.column && item.column.number || index + 1}`;
  }

  root.openSheetDialog = openSheetDialog;
  root.buildSheetPdf = buildSheetPdf;
  const trigger = document.getElementById("btn-sheet-pdf");
  if (trigger) trigger.addEventListener("click", openSheetDialog);
})(typeof window !== "undefined" ? window : globalThis);
