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
  function legendRows() {
    const rows = [];
    // в Node слоёв нет — раскладка обязана собираться и без них
    if (typeof LAYERS_V2 === "undefined" || typeof state === "undefined") return rows;
    for (const layer of LAYERS_V2) {
      if (!layer.visible) continue;
      const features = state.features.filter(f => layerOf(f) === layer);
      if (!features.length) continue;
      const ranges = typeof rangeRulesOf === "function" ? rangeRulesOf(layer) : [];
      if (ranges.length) {
        const base = layerStyle(layer) || {};
        for (const rule of ranges)
          rows.push({ title: rule.title || `${rule.min} – ${rule.max}`,
            style: { ...base, ...rule.patch }, geometry: layer.geometry_type });
        continue;
      }
      const cats = typeof layerCatStats === "function" ? layerCatStats(layer) : [];
      const visible = cats.filter(cat => !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id));
      if (visible.length > 1) {
        for (const cat of visible)
          rows.push({ title: cat.title, style: cat.sample ? styleOf(cat.sample) : layerStyle(layer),
            geometry: layer.geometry_type });
        continue;
      }
      rows.push({ title: layer.title, style: styleOf(features[0]) || layerStyle(layer),
        geometry: layer.geometry_type });
    }
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
      context.font = `${16 * PT}px sans-serif`;
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
      context.font = `${10 * PT}px sans-serif`;
      context.fillStyle = "#1c1c1a";
      context.fillText("Условные обозначения", left, y);
      y += 17 * PT;                            // образец высотой 4 мм не должен лезть на заголовок
      context.font = `${7.5 * PT}px sans-serif`;
      const sampleW = mmToPx(11), sampleH = mmToPx(4), gap = mmToPx(3);
      for (const row of legendRows()) {
        if (y > view.height - pad - mmToPx(20)) break;
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
        context.font = `${10 * PT}px sans-serif`;
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
          context.fillText(row.value, left + inner - 1.5 * PT, y);
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
        title: "", notes: "", number: "" } };
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
  async function buildSheetPdf() {
    const PDF = root.GRADO_PDF;
    if (!PDF) throw new Error("модуль PDF не загружен");
    const fontBytes = await sheetFontBytes();
    const doc = PDF.createDocument();
    doc.addFont("SheetFont", fontBytes);
    const view = sheetView(sheet);
    const page = doc.addPage(view.widthMm, view.heightMm);
    const context = PDF.createContext(doc, page, { scale: 96 / 72, fontName: "SheetFont" });
    renderSceneTo(context, view.width, view.height, { k: view.k, tx: view.tx, ty: view.ty });
    drawSheetColumn(context, sheet, view);
    return doc.build();
  }

  // Пока свой шрифт не заведён, лист идёт на Onest из репозитория: он лежит
  // рядом и лицензия позволяет встраивание. Century Gothic человек положит
  // отдельно — тогда подставится он.
  let fontCache = null;
  async function sheetFontBytes() {
    if (fontCache) return fontCache;
    const response = await fetch("./fonts/Onest-Variable.ttf");
    if (!response.ok) throw new Error("не найден шрифт листа");
    fontCache = new Uint8Array(await response.arrayBuffer());
    return fontCache;
  }

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
          </div>
          <label class="sheet-field">Примечания<textarea id="sheet-notes" rows="2" placeholder="* коэффициент перехода…">${escHtml(sheet.column.notes || "")}</textarea></label>
        </div>
        <div class="sheet-summary" id="sheet-summary" role="status" aria-live="polite"></div>
      </div>
      <div class="modal-actions"><button type="button" id="sheet-center">По центру вида</button><span class="spacer"></span>
        <button type="button" id="sheet-cancel">Закрыть</button><button type="button" id="sheet-run" class="primary">Выпустить лист</button></div>
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
        title: $("sheet-title-text").value,
        notes: $("sheet-notes").value,
        number: $("sheet-number").value.trim(),
      };
      $("sheet-column-fields").hidden = !sheet.column.on;
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
    ["sheet-format", "sheet-orient", "sheet-scale", "sheet-column", "sheet-legend", "sheet-tep"]
      .forEach(id => $(id).addEventListener("change", update));
    ["sheet-column-width", "sheet-number", "sheet-title-text", "sheet-notes"]
      .forEach(id => $(id).addEventListener("input", update));
    const close = () => { overlay.remove(); };
    $("sheet-cancel").addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    $("sheet-center").addEventListener("click", () => {
      const [wx, wy] = s2w(viewportWidth() / 2, viewportHeight() / 2);
      sheet.cx = wx; sheet.cy = wy;
      save(); draw();
    });
    $("sheet-run").addEventListener("click", async () => {
      const button = $("sheet-run");
      button.disabled = true;
      summary.innerHTML = `<b>Собираем лист…</b><span>вектор, тем же кодом, что рисует экран</span>`;
      try {
        const bytes = await buildSheetPdf();
        const name = (document.getElementById("project-name")?.value || "лист").trim();
        saveFile(`${name} · ${sheet.format} 1-${sheet.scale}.pdf`, bytes);
        summary.innerHTML = `<b>Готово: ${(bytes.length / 1024 / 1024).toFixed(1)} МБ</b><span>масштаб 1:${sheet.scale.toLocaleString("ru-RU")}, ${sheet.format}</span>`;
      } catch (error) {
        summary.classList.add("error");
        summary.innerHTML = `<b>Не удалось собрать лист.</b><span>${escHtml(String(error.message || error)).slice(0, 160)}</span>`;
      }
      button.disabled = false;
    });
    update();
  }

  root.openSheetDialog = openSheetDialog;
  root.buildSheetPdf = buildSheetPdf;
  const trigger = document.getElementById("btn-sheet-pdf");
  if (trigger) trigger.addEventListener("click", openSheetDialog);
})(typeof window !== "undefined" ? window : globalThis);
