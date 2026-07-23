// Писатель PDF и рекордер холста: лист чертежа собирается ВЕКТОРОМ, тем же
// кодом отрисовки, что рисует экран.
//
// Зачем так. Печать в масштабе в браузерной редакции была недоступна вовсе
// («требует настольную версию»), а работа идёт именно в браузере. Сторонняя
// библиотека PDF тянет за собой встроенный шрифт ради кириллицы и лишние
// сотни килобайт; печать средствами браузера отдаёт файл только через диалог.
// Поэтому свой писатель: формат PDF в той части, которая нужна чертежу, — это
// пути, заливки, штрихи, прозрачность, растровая вставка и шрифт.
//
// Рекордер повторяет подмножество Canvas 2D, которым пользуется движок
// (паттернов, градиентов и композитных режимов там нет), поэтому лист рисуется
// ТЕМ ЖЕ кодом, что холст, и не может с ним разойтись.
(function (root) {
  "use strict";

  const PT_PER_MM = 72 / 25.4;

  // ---------- мелочи формата ----------
  const num = value => {
    const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  };
  const bytesOf = text => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  };
  const pdfString = text => "(" + String(text).replace(/([\\()])/g, "\\$1") + ")";

  // цвет: принимаем то же, что канва — #rgb, #rrggbb(aa), rgb()/rgba()
  function parseColor(value) {
    if (value == null) return null;
    const text = String(value).trim().toLowerCase();
    if (text === "none" || text === "transparent") return null;
    const rgba = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgba) {
      const parts = rgba[1].split(",").map(part => parseFloat(part.trim()));
      return { r: (parts[0] || 0) / 255, g: (parts[1] || 0) / 255, b: (parts[2] || 0) / 255,
        a: parts.length > 3 ? Math.max(0, Math.min(1, parts[3])) : 1 };
    }
    const hex = text.replace("#", "");
    if (!/^[0-9a-f]{3,8}$/.test(hex)) return { r: 0, g: 0, b: 0, a: 1 };
    const full = hex.length === 3 || hex.length === 4
      ? hex.split("").map(char => char + char).join("") : hex;
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
      a: full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }

  // ---------- чтение TrueType ----------
  // Нужны четыре вещи: сколько единиц в кегле (head), ширины глифов (hmtx),
  // соответствие символ→глиф (cmap) и число глифов (maxp). Сам файл вкладывается
  // целиком: подрезание таблиц — отдельная работа с составными глифами, а
  // 120–300 КБ на лист роли не играют.
  function readFont(buffer) {
    try { return parseFont(buffer); }
    catch (error) {
      // Свои объяснения пропускаем как есть, чужие — заворачиваем: человек
      // выбирает файл шрифта и должен прочесть про файл, а не про DataView.
      if (/TrueType|таблиц|символов|кириллиц/i.test(error.message || "")) throw error;
      throw new Error("файл шрифта повреждён или обрезан");
    }
  }

  function parseFont(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = view.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== 0x4f54544f)
      throw new Error("это не TrueType-шрифт (OpenType с кривыми CFF не поддерживается)");
    const tableCount = view.getUint16(4);
    const tables = new Map();
    for (let i = 0; i < tableCount; i++) {
      const at = 12 + i * 16;
      const name = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
      tables.set(name, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
    }
    const need = name => {
      const table = tables.get(name);
      if (!table) throw new Error(`в шрифте нет таблицы ${name}`);
      return table;
    };
    const head = need("head").offset;
    const unitsPerEm = view.getUint16(head + 18) || 1000;
    const bbox = [view.getInt16(head + 36), view.getInt16(head + 38),
                  view.getInt16(head + 40), view.getInt16(head + 42)];
    const hhea = need("hhea").offset;
    const ascent = view.getInt16(hhea + 4);
    const descent = view.getInt16(hhea + 6);
    const numberOfHMetrics = view.getUint16(hhea + 34);
    const numGlyphs = view.getUint16(need("maxp").offset + 4);
    const hmtx = need("hmtx").offset;
    const advance = index => view.getUint16(hmtx + Math.min(index, numberOfHMetrics - 1) * 4);

    // cmap: берём таблицу Unicode — формат 4 (BMP) или 12 (полный диапазон)
    const cmap = need("cmap").offset;
    const subtables = view.getUint16(cmap + 2);
    let best = null;
    for (let i = 0; i < subtables; i++) {
      const at = cmap + 4 + i * 8;
      const platform = view.getUint16(at), encoding = view.getUint16(at + 2);
      const offset = cmap + view.getUint32(at + 4);
      const format = view.getUint16(offset);
      const unicode = platform === 3 && (encoding === 1 || encoding === 10) || platform === 0;
      if (!unicode || (format !== 4 && format !== 12)) continue;
      if (!best || format === 12) best = { offset, format };
    }
    if (!best) throw new Error("в шрифте нет юникодной таблицы символов");
    const map = new Map();
    if (best.format === 4) {
      const segCount = view.getUint16(best.offset + 6) / 2;
      const ends = best.offset + 14;
      const starts = ends + segCount * 2 + 2;
      const deltas = starts + segCount * 2;
      const ranges = deltas + segCount * 2;
      for (let seg = 0; seg < segCount; seg++) {
        const end = view.getUint16(ends + seg * 2);
        const start = view.getUint16(starts + seg * 2);
        const delta = view.getInt16(deltas + seg * 2);
        const rangeOffset = view.getUint16(ranges + seg * 2);
        if (start === 0xffff) continue;
        for (let code = start; code <= end && code !== 0x10000; code++) {
          let glyph;
          if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
          else {
            const at = ranges + seg * 2 + rangeOffset + (code - start) * 2;
            if (at + 1 >= bytes.length) continue;
            glyph = view.getUint16(at);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) map.set(code, glyph);
        }
      }
    } else {
      const groups = view.getUint32(best.offset + 12);
      for (let i = 0; i < groups; i++) {
        const at = best.offset + 16 + i * 12;
        const start = view.getUint32(at), end = view.getUint32(at + 4), glyph = view.getUint32(at + 8);
        for (let code = start; code <= end; code++) map.set(code, glyph + (code - start));
      }
    }
    return { bytes, unitsPerEm, bbox, ascent, descent, numGlyphs, advance, map,
      glyphOf: code => map.get(code) || 0 };
  }

  // ---------- документ ----------
  function createDocument() {
    const objects = [];                 // 1-based, элемент 0 не используется
    const alloc = () => { objects.push(null); return objects.length; };
    const put = (id, body) => { objects[id - 1] = body; };
    const pages = [];
    const fonts = new Map();            // имя → { id, font, used:Set(gid) }
    const images = [];

    const doc = {
      addFont(name, buffer) {
        if (fonts.has(name)) return fonts.get(name);
        const entry = { name, id: alloc(), fileId: alloc(), descriptorId: alloc(),
          childId: alloc(), toUnicodeId: alloc(), font: readFont(buffer), used: new Set() };
        fonts.set(name, entry);
        return entry;
      },
      hasFont: name => fonts.has(name),
      fontEntry: name => fonts.get(name),
      // растр вкладывается как JPEG без перекодирования: DCTDecode принимает
      // байты файла как есть, поэтому подложка стоит почти ничего
      addJpeg(bytes, width, height) {
        const id = alloc();
        images.push({ id, bytes, width, height });
        return { id, name: `Im${images.length}` };
      },
      addPage(widthMm, heightMm) {
        const page = { id: alloc(), contentId: alloc(),
          width: widthMm * PT_PER_MM, height: heightMm * PT_PER_MM,
          ops: [], fonts: new Set(), images: new Set(), alphas: new Map() };
        pages.push(page);
        return page;
      },
      build() { return build(); },
    };

    function build() {
      const pagesId = alloc();
      const catalogId = alloc();
      for (const page of pages) {
        const resources = [];
        if (page.fonts.size)
          resources.push("/Font << " + [...page.fonts]
            .map(name => `/${name} ${fonts.get(name).id} 0 R`).join(" ") + " >>");
        if (page.images.size)
          resources.push("/XObject << " + [...page.images]
            .map(entry => `/${entry.name} ${entry.id} 0 R`).join(" ") + " >>");
        if (page.alphas.size)
          resources.push("/ExtGState << " + [...page.alphas]
            .map(([alpha, name]) => `/${name} << /Type /ExtGState /ca ${num(alpha)} /CA ${num(alpha)} >>`)
            .join(" ") + " >>");
        put(page.id, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
          `/Resources << ${resources.join(" ")} >> /Contents ${page.contentId} 0 R >>`);
        const stream = page.ops.join("\n");
        put(page.contentId, { dict: `<< /Length ${bytesOf(stream).length} >>`, stream: bytesOf(stream) });
      }
      put(pagesId, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(p => `${p.id} 0 R`).join(" ")}] >>`);
      put(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      for (const image of images)
        put(image.id, { dict: `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
          stream: image.bytes });
      for (const entry of fonts.values()) writeFont(entry);
      return assemble(objects, catalogId);
    }

    // CID-шрифт Identity-H: строка в потоке — это номера глифов по два байта,
    // а ToUnicode возвращает им человеческие символы, чтобы текст в готовом
    // листе искался и копировался, а не был мёртвыми кривыми.
    function writeFont(entry) {
      const font = entry.font;
      const scale = 1000 / font.unitsPerEm;
      const widths = [];
      const used = [...entry.used].sort((a, b) => a - b);
      for (const glyph of used) widths.push(`${glyph} [${num(font.advance(glyph) * scale)}]`);
      put(entry.id, `<< /Type /Font /Subtype /Type0 /BaseFont /${entry.name} /Encoding /Identity-H ` +
        `/DescendantFonts [${entry.childId} 0 R] /ToUnicode ${entry.toUnicodeId} 0 R >>`);
      put(entry.childId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${entry.name} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${entry.descriptorId} 0 R /DW 1000 /W [${widths.join(" ")}] /CIDToGIDMap /Identity >>`);
      put(entry.descriptorId, `<< /Type /FontDescriptor /FontName /${entry.name} /Flags 4 ` +
        `/FontBBox [${font.bbox.map(v => num(v * scale)).join(" ")}] /ItalicAngle 0 ` +
        `/Ascent ${num(font.ascent * scale)} /Descent ${num(font.descent * scale)} ` +
        `/CapHeight ${num(font.ascent * scale)} /StemV 80 /FontFile2 ${entry.fileId} 0 R >>`);
      put(entry.fileId, { dict: `<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>`,
        stream: font.bytes });
      // Одному глифу отвечает несколько кодов: у дефиса это U+002D и U+00AD
      // (мягкий перенос), у пробела — U+0020 и U+00A0. В обратную таблицу
      // берём НАИМЕНЬШИЙ код, иначе текст из готового листа копируется
      // мягкими переносами и неразрывными пробелами.
      const best = new Map();
      for (const [code, glyph] of font.map) {
        if (!entry.used.has(glyph) || code > 0xffff) continue;
        const known = best.get(glyph);
        if (known === undefined || code < known) best.set(glyph, code);
      }
      const pairs = [];
      for (const [glyph, code] of best)
        pairs.push(`<${glyph.toString(16).padStart(4, "0")}> <${code.toString(16).padStart(4, "0")}>`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n` +
        `/CMapName /Identity-H def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n` +
        chunk(pairs, 100).map(part => `${part.length} beginbfchar\n${part.join("\n")}\nendbfchar\n`).join("") +
        `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      put(entry.toUnicodeId, { dict: `<< /Length ${bytesOf(cmap).length} >>`, stream: bytesOf(cmap) });
    }

    return doc;
  }

  const chunk = (list, size) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  };

  // сборка файла: заголовок, объекты, таблица ссылок, трейлер
  function assemble(objects, catalogId) {
    const parts = [];
    let length = 0;
    const push = data => {
      const bytes = typeof data === "string" ? bytesOf(data) : data;
      parts.push(bytes);
      length += bytes.length;
      return bytes.length;
    };
    push("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
    const offsets = new Array(objects.length + 1).fill(0);
    objects.forEach((body, index) => {
      const id = index + 1;
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      if (body && body.stream) {
        push(body.dict + "\nstream\n");
        push(body.stream);
        push("\nendstream\n");
      } else push((body || "<< >>") + "\n");
      push("endobj\n");
    });
    const xref = length;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      objects.map((_, index) => `${String(offsets[index + 1]).padStart(10, "0")} 00000 n \n`).join(""));
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }

  // ---------- рекордер: подмножество Canvas 2D ----------
  // Ось Y в PDF смотрит ВВЕРХ, на канве — вниз. Переворот делается один раз
  // матрицей страницы, дальше рекордер живёт в тех же координатах, что холст.
  function createContext(doc, page, options = {}) {
    const scale = options.scale || 1;              // экранных единиц в пункт листа
    const ops = page.ops;
    const state = { fill: { r: 0, g: 0, b: 0, a: 1 }, stroke: { r: 0, g: 0, b: 0, a: 1 },
      lineWidth: 1, dash: [], dashOffset: 0, alpha: 1, font: "10px sans-serif",
      align: "left", baseline: "alphabetic", lineJoin: "miter", lineCap: "butt" };
    const stack = [];
    let pending = { fill: null, stroke: null, lineWidth: null, dash: null, alpha: null };
    let path = [];
    let current = null, start = null;

    ops.push("q", `${num(1 / scale)} 0 0 ${num(-1 / scale)} 0 ${num(page.height)} cm`);

    // Прозрачность задаётся состоянием, а не рисованием, поэтому её обязательно
    // ВОЗВРАЩАТЬ к единице: иначе линия, нарисованная после полупрозрачной
    // заливки, наследует её альфу и выходит бледной. Имя состояния заводится и
    // для единицы тоже.
    const emitAlpha = value => {
      const rounded = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
      let name = page.alphas.get(rounded);
      if (!name) { name = `GS${page.alphas.size + 1}`; page.alphas.set(rounded, name); }
      return name;
    };
    const applyState = (needFill, needStroke) => {
      const alpha = state.alpha * ((needFill ? state.fill : state.stroke)?.a ?? 1);
      ops.push(`/${emitAlpha(alpha)} gs`);
      if (needFill && state.fill) ops.push(`${num(state.fill.r)} ${num(state.fill.g)} ${num(state.fill.b)} rg`);
      if (needStroke && state.stroke) {
        ops.push(`${num(state.stroke.r)} ${num(state.stroke.g)} ${num(state.stroke.b)} RG`);
        ops.push(`${num(Math.max(state.lineWidth, 0.01))} w`);
        ops.push(`[${state.dash.map(num).join(" ")}] ${num(state.dashOffset)} d`);
        ops.push(`${state.lineJoin === "round" ? 1 : state.lineJoin === "bevel" ? 2 : 0} j`);
        ops.push(`${state.lineCap === "round" ? 1 : state.lineCap === "square" ? 2 : 0} J`);
      }
    };
    const flushPath = () => { for (const op of path) ops.push(op); };

    const ctx = {
      canvas: { width: page.width * scale, height: page.height * scale },
      get fillStyle() { return state.fillRaw; },
      set fillStyle(value) { state.fillRaw = value; state.fill = parseColor(value); },
      get strokeStyle() { return state.strokeRaw; },
      set strokeStyle(value) { state.strokeRaw = value; state.stroke = parseColor(value); },
      get lineWidth() { return state.lineWidth; },
      set lineWidth(value) { state.lineWidth = Number(value) || 0; },
      get globalAlpha() { return state.alpha; },
      set globalAlpha(value) { state.alpha = Number(value); },
      get font() { return state.font; },
      set font(value) { state.font = String(value); },
      get textAlign() { return state.align; },
      set textAlign(value) { state.align = value; },
      get textBaseline() { return state.baseline; },
      set textBaseline(value) { state.baseline = value; },
      get lineJoin() { return state.lineJoin; },
      set lineJoin(value) { state.lineJoin = value; },
      get lineCap() { return state.lineCap; },
      set lineCap(value) { state.lineCap = value; },
      get lineDashOffset() { return state.dashOffset; },
      set lineDashOffset(value) { state.dashOffset = Number(value) || 0; },

      save() { stack.push({ ...state, dash: state.dash.slice() }); ops.push("q"); },
      restore() { const prev = stack.pop(); if (prev) Object.assign(state, prev); ops.push("Q"); },
      setLineDash(list) { state.dash = Array.isArray(list) ? list.filter(v => v > 0) : []; },
      getLineDash() { return state.dash.slice(); },
      translate(x, y) { ops.push(`1 0 0 1 ${num(x)} ${num(y)} cm`); },
      scale(x, y) { ops.push(`${num(x)} 0 0 ${num(y)} 0 0 cm`); },
      rotate(angle) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        ops.push(`${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} 0 0 cm`);
      },
      transform(a, b, c, d, e, f) { ops.push(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm`); },

      beginPath() { path = []; current = null; start = null; },
      moveTo(x, y) { path.push(`${num(x)} ${num(y)} m`); current = [x, y]; start = [x, y]; },
      lineTo(x, y) { if (!current) return ctx.moveTo(x, y); path.push(`${num(x)} ${num(y)} l`); current = [x, y]; },
      closePath() { if (path.length) { path.push("h"); if (start) current = start.slice(); } },
      rect(x, y, w, h) { path.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`); current = [x, y]; start = [x, y]; },
      // дуга ломается на кубические кривые: PDF окружностей не знает
      arc(cx, cy, radius, from, to, ccw) {
        if (radius <= 0) return;
        let sweep = to - from;
        if (!ccw && sweep < 0) sweep += Math.PI * 2 * Math.ceil(-sweep / (Math.PI * 2));
        if (ccw && sweep > 0) sweep -= Math.PI * 2 * Math.ceil(sweep / (Math.PI * 2));
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
        const step = sweep / steps;
        const k = (4 / 3) * Math.tan(step / 4);
        let angle = from;
        let point = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
        if (!current) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]);
        for (let i = 0; i < steps; i++) {
          const next = angle + step;
          const p1 = [point[0] - k * radius * Math.sin(angle), point[1] + k * radius * Math.cos(angle)];
          const end = [cx + radius * Math.cos(next), cy + radius * Math.sin(next)];
          const p2 = [end[0] + k * radius * Math.sin(next), end[1] - k * radius * Math.cos(next)];
          path.push(`${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])} ${num(end[0])} ${num(end[1])} c`);
          angle = next; point = end; current = end;
        }
      },
      fill() { applyState(true, false); flushPath(); ops.push("f"); },
      stroke() { applyState(false, true); flushPath(); ops.push("S"); },
      clip() { flushPath(); ops.push("W", "n"); path = []; },
      fillRect(x, y, w, h) { applyState(true, false); ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`, "f"); },
      strokeRect(x, y, w, h) { applyState(false, true); ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`, "S"); },
      clearRect() { /* лист белый по определению — чистить нечего */ },

      measureText(text) { return { width: textWidth(text, state.font, doc, options) }; },
      fillText(text, x, y) { drawText(text, x, y, true); },
      strokeText(text, x, y) { drawText(text, x, y, false); },

      // подложка: только готовый JPEG, растр канвы сюда не попадает
      drawImage(image, x, y, w, h) {
        const entry = image && image.__pdfImage;
        if (!entry) return;
        if (!page.images.size || ![...page.images].some(item => item.id === entry.id))
          page.images.add(entry);
        ops.push("q", `${num(w)} 0 0 ${num(-h)} ${num(x)} ${num(y + h)} cm`, `/${entry.name} Do`, "Q");
      },
    };

    function drawText(text, x, y, isFill) {
      const value = String(text ?? "");
      if (!value) return;
      const entry = doc.fontEntry(fontNameFor(state.font, doc, options));
      if (!entry) return;
      const size = fontSize(state.font);
      const width = textWidth(value, state.font, doc, options);
      let dx = 0;
      if (state.align === "center") dx = -width / 2;
      else if (state.align === "right" || state.align === "end") dx = -width;
      let dy = 0;
      const font = entry.font;
      if (state.baseline === "middle") dy = size * (font.ascent + font.descent) / (2 * font.unitsPerEm);
      else if (state.baseline === "top") dy = size * font.ascent / font.unitsPerEm;
      else if (state.baseline === "bottom") dy = size * font.descent / font.unitsPerEm;
      const hex = [];
      for (const char of value) {
        const glyph = font.glyphOf(char.codePointAt(0));
        entry.used.add(glyph);
        hex.push(glyph.toString(16).padStart(4, "0"));
      }
      page.fonts.add(entry.name);
      applyState(isFill, !isFill);
      // текст рисуется в системе холста (Y вниз), поэтому строку переворачиваем
      // обратно — иначе буквы выйдут зеркальными
      ops.push("BT", `/${entry.name} ${num(size)} Tf`,
        `1 0 0 -1 ${num(x + dx)} ${num(y + dy)} Tm`,
        isFill ? "0 Tr" : "1 Tr", `<${hex.join("")}> Tj`, "ET");
    }

    return ctx;
  }

  const fontSize = font => {
    const match = /(\d+(?:\.\d+)?)px/.exec(String(font || ""));
    return match ? parseFloat(match[1]) : 10;
  };

  // Начертание выбирается по той же строке шрифта, что и на холсте:
  // «600 12px sans-serif» — полужирный, «italic 11px …» — курсив. Иначе лист
  // пришлось бы размечать вторым, отдельным от экрана способом.
  function faceOf(fontSpec) {
    const text = String(fontSpec || "").toLowerCase();
    // «small-caps» — это тоже отдельный файл шрифта (в эталонном альбоме
    // CenturyGothic-SC700), а не начертание, которое можно подделать
    // масштабированием заглавных.
    if (/(^|\s)small-caps(\s|$)/.test(text)) return "smallCaps";
    const weight = /(^|\s)(bold|[6-9]00)(\s|$)/.test(text);
    const italic = /(^|\s)(italic|oblique)(\s|$)/.test(text);
    return weight && italic ? "boldItalic" : weight ? "bold" : italic ? "italic" : "regular";
  }

  // Чем заменить отсутствующее начертание: капитель ближе всего к полужирному,
  // полужирный курсив — к полужирному, и всё в итоге сводится к обычному.
  const FACE_FALLBACK = { smallCaps: ["bold", "regular"], boldItalic: ["bold", "italic", "regular"],
    bold: ["regular"], italic: ["regular"], regular: [] };

  // Какое имя шрифта в документе отвечает этой строке начертания. Если нужного
  // начертания человек не положил, берём обычное: лучше ровный текст, чем
  // отсутствующая строка.
  function fontNameFor(fontSpec, doc, options) {
    const face = faceOf(fontSpec);
    const names = options.fontFaces || {};
    for (const key of [face, ...(FACE_FALLBACK[face] || [])]) {
      const candidate = names[key];
      if (candidate && doc.hasFont(candidate)) return candidate;
    }
    return names.regular && doc.hasFont(names.regular) ? names.regular : options.fontName;
  }

  function textWidth(text, fontSpec, doc, options) {
    const entry = doc.fontEntry(fontNameFor(fontSpec, doc, options));
    if (!entry) return 0;
    const size = fontSize(fontSpec);
    const font = entry.font;
    let width = 0;
    for (const char of String(text ?? "")) {
      const glyph = font.glyphOf(char.codePointAt(0));
      width += font.advance(glyph) / font.unitsPerEm * size;
    }
    return width;
  }

  root.GRADO_PDF = { PT_PER_MM, createDocument, createContext, readFont, parseColor,
    textWidth, faceOf };
})(typeof window !== "undefined" ? window : globalThis);
