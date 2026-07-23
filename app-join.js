// Соединение таблиц — «Объединения» (Joins) из QGIS: к объектам слоя
// присоединяются столбцы из внешней таблицы по общему ключу.
//
// Зачем. Ведомость квартир, расчёт ТЭП, перечень объектов капстроительства —
// всё это живёт в Excel, а на чертеже нужно рядом с геометрией. Набивать
// вручную по кадастровому номеру — это день работы и ошибки.
//
// Читаем CSV (в том числе выгруженный из Excel: точка с запятой, кавычки,
// cp1251) и XLSX. XLSX — обычный zip: распаковываем штатным
// DecompressionStream браузера, без сторонних библиотек.
(function (root) {
  "use strict";

  // ---------- CSV ----------
  // Разделитель определяем по первой строке: Excel в русской локали пишет
  // точку с запятой, выгрузки порталов — запятую, базы — табуляцию.
  function detectDelimiter(text) {
    const line = String(text).split(/\r?\n/).find(row => row.trim().length) || "";
    const counts = [[";", 0], [",", 0], ["\t", 0]];
    let quoted = false;
    for (const char of line) {
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      for (const pair of counts) if (char === pair[0]) pair[1] += 1;
    }
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] ? counts[0][0] : ";";
  }

  function parseDelimited(text, delimiter) {
    const source = String(text).replace(/^﻿/, "");   // Excel ставит BOM
    const sep = delimiter || detectDelimiter(source);
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"') {
          if (source[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += char;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === sep) { row.push(field); field = ""; continue; }
      if (char === "\r") continue;
      if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const clean = rows.filter(r => r.some(value => String(value).trim().length));
    if (!clean.length) return { columns: [], rows: [], delimiter: sep };
    const header = clean[0].map((name, index) => String(name).trim() || `столбец ${index + 1}`);
    const data = clean.slice(1).map(values => {
      const record = {};
      header.forEach((name, index) => { record[name] = (values[index] ?? "").trim(); });
      return record;
    });
    return { columns: header, rows: data, delimiter: sep };
  }

  // Кодировка: UTF-8 по умолчанию, но Excel по «Сохранить как CSV» отдаёт
  // cp1251. Признак — потерянные символы (U+FFFD) после разбора как UTF-8.
  function decodeText(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    if (!utf8.includes("�")) return utf8;
    try { return new TextDecoder("windows-1251").decode(buffer); } catch (error) { return utf8; }
  }

  // ---------- XLSX ----------
  // Минимальный читатель zip: центральный каталог с конца файла, дальше
  // распаковка нужных записей. Сторонней библиотеки нет намеренно — вес
  // страницы важнее, а браузер умеет распаковывать сам.
  async function unzip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--)
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error("файл не похож на xlsx");
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      entries.set(name, { method, compressed, offset });
      at += 46 + nameLength + extraLength + commentLength;
    }
    const read = async name => {
      const entry = entries.get(name);
      if (!entry) return null;
      const localNameLength = view.getUint16(entry.offset + 26, true);
      const localExtraLength = view.getUint16(entry.offset + 28, true);
      const start = entry.offset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(start, start + entry.compressed);
      if (entry.method === 0) return new TextDecoder().decode(raw);
      if (typeof DecompressionStream !== "function")
        throw new Error("браузер не умеет распаковывать xlsx — сохраните таблицу в CSV");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    };
    return { names: [...entries.keys()], read };
  }

  const A_CODE = "A".charCodeAt(0);
  function columnIndex(reference) {
    const letters = String(reference).replace(/[0-9]/g, "");
    let index = 0;
    for (const char of letters) index = index * 26 + (char.charCodeAt(0) - A_CODE + 1);
    return index - 1;
  }

  async function parseXlsx(buffer) {
    const zip = await unzip(buffer);
    const sheetName = zip.names.find(name => /^xl\/worksheets\/sheet1\.xml$/.test(name))
      || zip.names.find(name => /^xl\/worksheets\/.*\.xml$/.test(name));
    if (!sheetName) throw new Error("в книге нет листов");
    const sharedXml = await zip.read("xl/sharedStrings.xml");
    const shared = [];
    if (sharedXml) {
      const doc = new DOMParser().parseFromString(sharedXml, "application/xml");
      for (const item of doc.getElementsByTagName("si")) {
        // текст ячейки бывает разбит на несколько кусков с разным начертанием
        let text = "";
        for (const t of item.getElementsByTagName("t")) text += t.textContent;
        shared.push(text);
      }
    }
    const sheetXml = await zip.read(sheetName);
    const doc = new DOMParser().parseFromString(sheetXml, "application/xml");
    const grid = [];
    for (const rowNode of doc.getElementsByTagName("row")) {
      const values = [];
      for (const cell of rowNode.getElementsByTagName("c")) {
        const index = columnIndex(cell.getAttribute("r") || "");
        const type = cell.getAttribute("t");
        const valueNode = cell.getElementsByTagName("v")[0];
        let value = "";
        if (type === "s" && valueNode) value = shared[parseInt(valueNode.textContent, 10)] ?? "";
        else if (type === "inlineStr") {
          for (const t of cell.getElementsByTagName("t")) value += t.textContent;
        } else if (valueNode) value = valueNode.textContent;
        values[index >= 0 ? index : values.length] = String(value).trim();
      }
      grid.push(Array.from(values, value => value ?? ""));
    }
    const filled = grid.filter(row => row.some(value => String(value).trim().length));
    if (!filled.length) return { columns: [], rows: [] };
    const header = filled[0].map((name, index) => String(name).trim() || `столбец ${index + 1}`);
    const rows = filled.slice(1).map(values => {
      const record = {};
      header.forEach((name, index) => { record[name] = String(values[index] ?? "").trim(); });
      return record;
    });
    return { columns: header, rows };
  }

  async function parseTable(file) {
    const buffer = await file.arrayBuffer();
    if (/\.xlsx$/i.test(file.name)) return { ...(await parseXlsx(buffer)), kind: "xlsx" };
    if (/\.xls$/i.test(file.name))
      throw new Error("старый формат .xls не читается — сохраните как .xlsx или .csv");
    return { ...parseDelimited(decodeText(buffer)), kind: "csv" };
  }

  // ---------- собственно соединение ----------
  // Ключи сравниваем нормализованно: кадастровый номер в таблице приходит
  // и «77:01:0001015:1234», и с пробелами, и в другом регистре.
  const normalizeKey = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");

  function indexRows(rows, keyColumn) {
    const map = new Map();
    let duplicates = 0;
    for (const row of rows) {
      const key = normalizeKey(row[keyColumn]);
      if (!key) continue;
      if (map.has(key)) { duplicates += 1; continue; }   // побеждает первая строка
      map.set(key, row);
    }
    return { map, duplicates };
  }

  // Возвращает ПЛАН: что и на какой объект записать. Само присвоение делает
  // приложение — там снимок для отмены и перерисовка.
  function planJoin({ features = [], keyField, rows = [], keyColumn, columns = [], prefix = "" } = {}) {
    const { map, duplicates } = indexRows(rows, keyColumn);
    const take = columns.filter(name => name !== keyColumn);
    const updates = [];
    const missed = [];
    for (const feature of features) {
      const key = normalizeKey((feature.props || {})[keyField]);
      const row = key ? map.get(key) : null;
      if (!row) { missed.push(feature); continue; }
      const values = {};
      for (const name of take) values[prefix + name] = row[name] ?? "";
      updates.push({ feature, values });
    }
    return { updates, missed, duplicates, matched: updates.length,
      fields: take.map(name => ({ name: prefix + name, label: name, type: "text" })) };
  }

  root.GRADO_JOIN = { detectDelimiter, parseDelimited, decodeText, parseXlsx, parseTable,
    normalizeKey, indexRows, planJoin, unzip };
  if (typeof document === "undefined") return;

  // ---------- окно соединения ----------
  const $ = id => document.getElementById(id);

  function openJoinTable(layer) {
    closePopups();
    if (!layer) { toast("Выберите слой", "warn"); return; }
    const features = state.features.filter(f => layerOf(f) === layer);
    if (!features.length) { toast("В слое нет объектов", "warn"); return; }
    const layerColumns = typeof attrColumns === "function"
      ? attrColumns(layer).filter(c => !c.virtual) : [];
    let table = null;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal join-modal" role="dialog" aria-modal="true" aria-labelledby="join-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Данные слоя</span><span id="join-title">Присоединить таблицу · ${escHtml(layer.title)}</span></div>
        <button class="modal-x" aria-label="Закрыть соединение таблиц"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body join-body">
        <p class="join-intro">Столбцы внешней таблицы записываются в атрибуты объектов по общему ключу — кадастровому номеру, номеру дома, индексу. Соединение отменяется через Undo.</p>
        <label class="join-row">Файл таблицы<input type="file" id="join-file" accept=".csv,.txt,.tsv,.xlsx"></label>
        <div class="join-summary" id="join-summary" role="status" aria-live="polite">Выберите CSV или XLSX. Excel: «Сохранить как» → CSV или XLSX, оба читаются.</div>
        <div id="join-setup" hidden>
          <div class="fmt-row">
            <label>Ключ в слое<select id="join-key-layer">${layerColumns.map(c =>
              `<option value="${escHtml(c.name)}">${escHtml(c.label || c.name)}</option>`).join("")}</select></label>
            <label>Ключ в таблице<select id="join-key-table"></select></label>
          </div>
          <label>Префикс новых полей<input type="text" id="join-prefix" maxlength="20" placeholder="напр. т_"></label>
          <div class="join-columns" id="join-columns" role="group" aria-label="Какие столбцы присоединить"></div>
        </div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" id="join-cancel">Закрыть</button><button type="button" id="join-run" class="primary" disabled>Присоединить</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const summary = overlay.querySelector("#join-summary");
    const close = () => overlay.remove();
    overlay.querySelector("#join-cancel").addEventListener("click", close);
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });

    const chosenColumns = () => [...overlay.querySelectorAll("[data-join-col]:checked")]
      .map(box => box.dataset.joinCol);

    // предпросмотр совпадений: человек должен видеть, сойдутся ли ключи, ДО того
    // как записать сотню полей в проект
    const preview = () => {
      if (!table) return;
      const plan = planJoin({ features, keyField: $("join-key-layer").value,
        rows: table.rows, keyColumn: $("join-key-table").value,
        columns: chosenColumns(), prefix: $("join-prefix").value.trim() });
      const total = features.length;
      summary.classList.toggle("error", !plan.matched);
      summary.innerHTML = plan.matched
        ? `<b>Совпадёт ${plan.matched} из ${total}.</b><span>Без пары останется ${plan.missed.length}` +
          `${plan.duplicates ? `; в таблице ${ruCount(plan.duplicates, "строка", "строки", "строк")} с повторным ключом — берётся первая` : ""}</span>`
        : `<b>Ни один ключ не совпал.</b><span>Проверьте, те ли столбцы выбраны ключами</span>`;
      overlay.querySelector("#join-run").disabled = !plan.matched || !chosenColumns().length;
    };

    overlay.querySelector("#join-file").addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      summary.classList.remove("error");
      summary.textContent = "Читаем таблицу…";
      try {
        table = await parseTable(file);
      } catch (error) {
        table = null;
        summary.classList.add("error");
        summary.innerHTML = `<b>Не прочитать таблицу.</b><span>${escHtml(String(error.message || error))}</span>`;
        return;
      }
      if (!table.columns.length || !table.rows.length) {
        summary.classList.add("error");
        summary.innerHTML = `<b>Таблица пуста.</b><span>Первая строка обязана быть заголовком</span>`;
        return;
      }
      overlay.querySelector("#join-setup").hidden = false;
      const keySelect = $("join-key-table");
      keySelect.innerHTML = table.columns.map(name =>
        `<option value="${escHtml(name)}">${escHtml(name)}</option>`).join("");
      // ключом по умолчанию берём столбец, похожий на ключ слоя по имени
      const layerKey = ($("join-key-layer").value || "").toLowerCase();
      const guess = table.columns.find(name => name.toLowerCase().includes(layerKey))
        || table.columns.find(name => /кад|номер|id|код/i.test(name));
      if (guess) keySelect.value = guess;
      overlay.querySelector("#join-columns").innerHTML = table.columns.map(name =>
        `<label class="chk"><input type="checkbox" data-join-col="${escHtml(name)}" checked>${escHtml(name)}</label>`).join("");
      overlay.querySelectorAll("[data-join-col]").forEach(box => box.addEventListener("change", preview));
      ["join-key-layer", "join-key-table", "join-prefix"].forEach(id =>
        $(id).addEventListener("input", preview));
      $("join-key-layer").addEventListener("change", preview);
      $("join-key-table").addEventListener("change", preview);
      preview();
    });

    overlay.querySelector("#join-run").addEventListener("click", () => {
      if (!table) return;
      const prefix = $("join-prefix").value.trim();
      const plan = planJoin({ features, keyField: $("join-key-layer").value,
        rows: table.rows, keyColumn: $("join-key-table").value,
        columns: chosenColumns(), prefix });
      if (!plan.matched) return;
      snapshot();
      for (const field of plan.fields)
        if (typeof addLayerFieldTo === "function") addLayerFieldTo(layer, field.name, "text");
      for (const { feature, values } of plan.updates) {
        feature.props = feature.props || {};
        Object.assign(feature.props, values);
      }
      afterChange();
      close();
      toast(`Присоединено: ${plan.matched} из ${features.length} объектов, ` +
        `${ruCount(plan.fields.length, "столбец", "столбца", "столбцов")}`);
    });

    setTimeout(() => {
      const first = overlay.querySelector("#join-file");
      if (first && first.isConnected) first.focus();
    }, 0);
  }

  root.openJoinTable = openJoinTable;
})(typeof window !== "undefined" ? window : globalThis);
