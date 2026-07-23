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
  function sheetView(sheet) {
    const k = (1000 / sheet.scale) * PX_PER_MM;
    const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
    const width = widthMm * PX_PER_MM, height = heightMm * PX_PER_MM;
    return { k, tx: width / 2 - sheet.cx * k, ty: height / 2 + sheet.cy * k, width, height,
      widthMm, heightMm };
  }

  // охват листа на местности (метры) — по нему рисуется рамка на холсте
  function sheetExtent(sheet) {
    const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
    const halfW = widthMm / 1000 * sheet.scale / 2;
    const halfH = heightMm / 1000 * sheet.scale / 2;
    return [sheet.cx - halfW, sheet.cy - halfH, sheet.cx + halfW, sheet.cy + halfH];
  }

  root.GRADO_SHEET_CORE = { FORMATS, SCALES, sheetSize, sheetView, sheetExtent, MM_PER_PX, PX_PER_MM };

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
      scale: saved?.scale || 2000, cx: wx, cy: wy };
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
      const [widthMm, heightMm] = sheetSize(sheet.format, sheet.portrait);
      const groundW = widthMm / 1000 * sheet.scale, groundH = heightMm / 1000 * sheet.scale;
      summary.classList.remove("error");
      summary.innerHTML = `<b>${widthMm}×${heightMm} мм</b><span>накрывает ${Math.round(groundW)}×${Math.round(groundH)} м на местности</span>`;
      save();
      draw();
    };
    ["sheet-format", "sheet-orient", "sheet-scale"].forEach(id => $(id).addEventListener("change", update));
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
