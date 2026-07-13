// ============================================================================
//  app-attr.js — таблица атрибутов слоя + произвольная схема полей + калькулятор
//  полей (openAttributeTable/openAddFieldDialog/openManageFieldsDialog/
//  openFieldCalc, FIELD_TYPES/attrColumns/attrValue/castField/addLayerFieldTo/
//  deleteLayerFieldFrom/EXPR_FUNCS/exprTokens/evalFieldExpr). Вынесено из
//  монолита app.js (P0-разрез). Классический скрипт, общий global-scope,
//  грузится ПЕРЕД app.js (openAttributeTable передаётся в renderLayers).
//  Только определения. Общие escHtml/uiPrompt/uiConfirm/plObjects и рендер —
//  в app.js; attrColumns зовут app-data.js/app-style-ui.js (runtime, кросс-файл).
// ============================================================================

// ---------- таблица атрибутов слоя (логика QGIS) ----------
// ---------- поля слоя: произвольная схема поверх семантической ------------
const FIELD_TYPES = { int: "целое", real: "дробное", text: "текст", date: "дата", bool: "лог." };
// колонки таблицы атрибутов: виртуальные (геометрия) + семантические + свои
function attrColumns(layer) {
  const cols = [];
  if (layer.geometry_type === "polygon")
    cols.push({ name: "$area", label: "площадь, м²", type: "real", virtual: true });
  if (layer.geometry_type === "polyline")
    cols.push({ name: "$length", label: "длина, м", type: "real", virtual: true });
  for (const fl of (ATTR_FIELDS[layer.semantic_class] || []))
    if (fl.key) cols.push({ name: fl.key, label: fl.title, semantic: true,
                            type: fl.type === "number" ? "real" : "text" });
  for (const cf of (layer.fields || []))
    cols.push({ name: cf.name, label: cf.label || cf.name, type: cf.type });
  return cols;
}
function attrValue(f, col) {
  if (col.name === "$area") return f.ring ? +ringArea(f.ring).toFixed(1) : "";
  if (col.name === "$length") return f.line ? +lineLen(f.line).toFixed(1) : "";
  const v = f.props ? f.props[col.name] : undefined;
  return v == null ? "" : v;
}
function fieldDefault(type) { return (type === "int" || type === "real") ? 0 : (type === "bool" ? false : ""); }
function castField(type, v) {
  if (type === "int") return Math.round(parseFloat(v) || 0);
  if (type === "real") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  if (type === "bool") return v === true || v === "true" || v === "1" || v === "да";
  return String(v);
}
function addLayerFieldTo(layer, name, type) {
  layer.fields = layer.fields || [];
  if (attrColumns(layer).some(c => c.name === name)) return false;   // имя занято
  layer.fields.push({ name, type });
  for (const f of featuresOnLayer(layer.id)) {
    f.props = f.props || {};
    if (f.props[name] == null) f.props[name] = fieldDefault(type);
  }
  return true;
}
function deleteLayerFieldFrom(layer, name) {
  layer.fields = (layer.fields || []).filter(c => c.name !== name);
  for (const f of featuresOnLayer(layer.id)) if (f.props) delete f.props[name];
}

// ---------- калькулятор полей: безопасный вычислитель выражений ------------
// Поддержка: числа, 'строки', поля по имени (→ props), $area/$length/$perimeter,
// + - * / %, унарный -, скобки, функции. «+» — сумма чисел или конкатенация строк.
const EXPR_FUNCS = {
  round: (x, n) => { const p = Math.pow(10, n || 0); return Math.round(x * p) / p; },
  floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  upper: s => String(s).toUpperCase(), lower: s => String(s).toLowerCase(),
  length: s => String(s).length, concat: (...a) => a.join(""),
  if: (c, a, b) => (c ? a : b),
};
function exprTokens(s) {
  const t = [], isId = c => /[A-Za-z_$Ѐ-ӿ0-9.]/.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, str = "";
      while (j < s.length && s[j] !== c) str += s[j++];
      t.push({ t: "str", v: str }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      t.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_$Ѐ-ӿ]/.test(c)) {
      let j = i; while (j < s.length && isId(s[j])) j++;
      t.push({ t: "id", v: s.slice(i, j) }); i = j; continue;
    }
    if ("+-*/%(),".includes(c)) { t.push({ t: "op", v: c }); i++; continue; }
    throw new Error("непонятный символ «" + c + "»");
  }
  return t;
}
function evalFieldExpr(expr, f) {
  const toks = exprTokens(expr);
  let pos = 0;
  const peek = () => toks[pos], next = () => toks[pos++];
  const V = {};
  if (f.ring) { V.$area = ringArea(f.ring); V.$perimeter = lineLen([...f.ring, f.ring[0]]); }
  if (f.line) V.$length = lineLen(f.line);
  const resolve = name => {
    if (name[0] === "$") return V[name] ?? 0;
    const p = f.props ? f.props[name] : undefined;
    if (p == null) return 0;
    const n = parseFloat(p);
    return (typeof p === "string" && isNaN(n)) ? p : (isNaN(n) ? p : n);
  };
  const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
  function primary() {
    const tk = next();
    if (!tk) throw new Error("неожиданный конец");
    if (tk.t === "num" || tk.t === "str") return tk.v;
    if (tk.t === "op" && tk.v === "(") { const e = expr0(0); if (!(peek() && peek().v === ")")) throw new Error("нет «)»"); next(); return e; }
    if (tk.t === "op" && (tk.v === "-" || tk.v === "+")) { const x = primary(); return tk.v === "-" ? -x : x; }
    if (tk.t === "id") {
      if (peek() && peek().v === "(") {
        next(); const args = [];
        if (!(peek() && peek().v === ")")) { args.push(expr0(0)); while (peek() && peek().v === ",") { next(); args.push(expr0(0)); } }
        if (!(peek() && peek().v === ")")) throw new Error("нет «)» в функции"); next();
        const fn = EXPR_FUNCS[tk.v.toLowerCase()];
        if (!fn) throw new Error("нет функции «" + tk.v + "»");
        return fn(...args);
      }
      return resolve(tk.v);
    }
    throw new Error("ожидалось значение");
  }
  function expr0(minPrec) {
    let left = primary();
    while (peek() && peek().t === "op" && PREC[peek().v] >= minPrec) {
      const op = next().v, right = expr0(PREC[op] + 1);
      if (op === "+") left = (typeof left === "string" || typeof right === "string") ? String(left) + String(right) : left + right;
      else if (op === "-") left = left - right;
      else if (op === "*") left = left * right;
      else if (op === "/") left = right === 0 ? 0 : left / right;
      else left = left % right;
    }
    return left;
  }
  const res = expr0(0);
  if (pos < toks.length) throw new Error("лишние символы в конце");
  return res;
}

function openAttributeTable(layer) {
  closePopups();
  let editMode = false, filter = "all";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal attr-modal">
    <div class="modal-head">Таблица атрибутов · ${escHtml(layer.title)}
      <span class="muted" id="at-count"></span>
      <button class="modal-x" aria-label="Закрыть таблицу атрибутов"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="attr-toolbar">
      <button id="at-edit" title="Режим правки: редактировать ячейки, добавлять/удалять поля">✎ Правка</button>
      <button id="at-addf" class="at-editonly" hidden>+ поле</button>
      <button id="at-fields" class="at-editonly" hidden title="Переименование, тип, порядок, значение по умолчанию">⚙ Поля слоя</button>
      <button id="at-calc">∑ Калькулятор полей</button>
      <span class="spacer"></span>
      <label class="at-filter">Показать
        <select id="at-flt"><option value="all">все</option><option value="selected">выделенные</option></select></label>
    </div>
    <div class="modal-body compact"><div class="attr-scroll" id="at-scroll"></div></div>
    <div class="modal-actions"><span class="muted">клик — выделить (Shift/Ctrl — несколько) · двойной клик — приблизить</span></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const $ = id => overlay.querySelector("#" + id);
  const filtered = () => {
    const all = featuresOnLayer(layer.id);
    return filter === "selected" ? all.filter(f => state.selectedIds.has(f.id)) : all;
  };
  function renderTable() {
    const cols = attrColumns(layer), feats = filtered();
    $("at-count").textContent = `(${feats.length})`;
    $("at-addf").hidden = !editMode;
    $("at-fields").hidden = !editMode;
    $("at-edit").classList.toggle("active", editMode);
    if (!feats.length) {
      $("at-scroll").innerHTML = `<div class="muted" style="padding:14px">Нет объектов${filter === "selected" ? " в выделении" : ""}</div>`;
      return;
    }
    const head = `<tr><th class="at-num">#</th>${cols.map(c => {
      const del = editMode && !c.virtual && !c.semantic
        ? `<span class="at-delcol" data-col="${escHtml(c.name)}" title="Удалить поле">✕</span>` : "";
      return `<th title="тип: ${FIELD_TYPES[c.type] || c.type}${c.virtual ? " · вычисляется" : ""}">${escHtml(c.label)}${del}</th>`;
    }).join("")}</tr>`;
    const body = feats.map((f, i) => {
      const cells = cols.map(c => {
        const val = attrValue(f, c);
        if (editMode && !c.virtual) {
          if (c.type === "bool")
            return `<td><input type="checkbox" data-fid="${f.id}" data-col="${escHtml(c.name)}" ${(val === true || val === "true") ? "checked" : ""}></td>`;
          const it = c.type === "int" || c.type === "real" ? "number" : c.type === "date" ? "date" : "text";
          return `<td><input class="at-cell" type="${it}" data-fid="${f.id}" data-col="${escHtml(c.name)}" value="${escHtml(String(val))}"></td>`;
        }
        return `<td>${escHtml(String(val))}</td>`;
      }).join("");
      return `<tr data-fid="${f.id}"${state.selectedIds.has(f.id) ? ' class="sel"' : ""}><td class="at-num">${i + 1}</td>${cells}</tr>`;
    }).join("");
    $("at-scroll").innerHTML = `<table class="attr-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    // правка ячеек
    $("at-scroll").querySelectorAll("input[data-col]").forEach(inp =>
      inp.addEventListener("change", () => {
        const f = state.features.find(x => x.id === +inp.dataset.fid); if (!f) return;
        const col = cols.find(c => c.name === inp.dataset.col);
        snapshot(); f.props = f.props || {};
        f.props[inp.dataset.col] = inp.type === "checkbox" ? inp.checked : castField(col.type, inp.value);
        draw(); refreshTep(); persist();
      }));
    // удаление своего поля (крестик в шапке)
    $("at-scroll").querySelectorAll(".at-delcol").forEach(x =>
      x.addEventListener("click", ev => {
        ev.stopPropagation();
        snapshot(); deleteLayerFieldFrom(layer, x.dataset.col); persist(); renderTable();
        toast(`Поле «${x.dataset.col}» удалено`, "warn");
      }));
    // выбор строки ↔ выделение на холсте
    $("at-scroll").querySelectorAll("tbody tr").forEach(tr => {
      tr.addEventListener("click", ev => {
        if (ev.target.closest("input")) return;
        const f = state.features.find(x => x.id === +tr.dataset.fid); if (!f) return;
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey) toggleSelection(f.id); else selectOne(f.id);
        draw(); renderProps(); renderTable();
      });
      tr.addEventListener("dblclick", () => {
        const f = state.features.find(x => x.id === +tr.dataset.fid); if (!f) return;
        if (!layer.visible) { layer.visible = true; renderLayers(); }
        zoomToFeature(f);
      });
    });
  }
  $("at-edit").addEventListener("click", () => { editMode = !editMode; renderTable(); });
  $("at-flt").addEventListener("change", () => { filter = $("at-flt").value; renderTable(); });
  $("at-addf").addEventListener("click", () => openAddFieldDialog(layer, () => { persist(); renderTable(); }));
  $("at-fields").addEventListener("click", () => openManageFieldsDialog(layer, () => { draw(); refreshTep(); renderTable(); }));
  $("at-calc").addEventListener("click", () => openFieldCalc(layer, filtered, () => { renderTable(); }));
  overlay.querySelector(".modal-x").addEventListener("click", closePopups);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) closePopups(); });
  renderTable();
}

// диалог создания поля — БЕЗ closePopups (таблица под ним остаётся)
function openAddFieldDialog(layer, onDone) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal fmt-modal ask-modal">
    <div class="modal-head">Новое поле · ${escHtml(layer.title)}
      <button class="modal-x" aria-label="Закрыть создание поля"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body">
      <label>Имя поля<input type="text" id="af-name" placeholder="напр. население"></label>
      <label>Тип<select id="af-type">${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button id="af-cancel">Отмена</button><button id="af-ok" class="primary">Создать</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => e.stopPropagation());
  const q = id => ov.querySelector("#" + id);
  q("af-name").focus();
  const close = () => ov.remove();
  const create = () => {
    const name = q("af-name").value.trim().replace(/[^\wА-Яа-яЁё .\-]/g, "");
    if (!name) { toast("Введите имя поля", "warn"); return; }
    snapshot();
    if (!addLayerFieldTo(layer, name, q("af-type").value)) { toast("Такое поле уже есть", "warn"); return; }
    close(); onDone();
  };
  q("af-name").addEventListener("keydown", e => { if (e.key === "Enter") create(); });
  q("af-ok").addEventListener("click", create);
  q("af-cancel").addEventListener("click", close);
  ov.querySelector(".modal-x").addEventListener("click", close);
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
}

// управление полями слоя: переименование / тип / порядок / значение по
// умолчанию / удаление. БЕЗ closePopups (таблица под ним остаётся).
function openManageFieldsDialog(layer, onDone) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  // рабочая копия; _orig — имя поля до правки (для переноса значений в props)
  let work = (layer.fields || []).map(f => ({
    name: f.name, type: f.type,
    def: f.default != null ? String(f.default) : "", _orig: f.name }));
  const q = id => ov.querySelector("#" + id);
  const typeOpts = t => Object.entries(FIELD_TYPES).map(([k, v]) =>
    `<option value="${k}"${k === t ? " selected" : ""}>${v}</option>`).join("");
  const rowsHtml = () => work.length ? work.map((f, i) => `<tr>
      <td><input class="mf-name" data-i="${i}" value="${escHtml(f.name)}"></td>
      <td><select class="mf-type" data-i="${i}">${typeOpts(f.type)}</select></td>
      <td><input class="mf-def" data-i="${i}" value="${escHtml(f.def)}" placeholder="—"></td>
      <td class="mf-ord">
        <button class="mf-up" data-i="${i}" title="Выше"${i === 0 ? " disabled" : ""}>▲</button>
        <button class="mf-dn" data-i="${i}" title="Ниже"${i === work.length - 1 ? " disabled" : ""}>▼</button>
        <button class="mf-del at-delcol" data-i="${i}" title="Удалить поле">✕</button>
      </td></tr>`).join("")
    : `<tr><td colspan="4" class="muted" style="padding:10px">Своих полей пока нет — добавьте кнопкой «+ поле» в таблице</td></tr>`;
  const syncInputs = () => {
    ov.querySelectorAll(".mf-name").forEach(el => { work[+el.dataset.i].name = el.value; });
    ov.querySelectorAll(".mf-type").forEach(el => { work[+el.dataset.i].type = el.value; });
    ov.querySelectorAll(".mf-def").forEach(el => { work[+el.dataset.i].def = el.value; });
  };
  const render = () => {
    q("mf-body").innerHTML = rowsHtml();
    ov.querySelectorAll(".mf-name").forEach(el => el.onchange = () => { work[+el.dataset.i].name = el.value; });
    ov.querySelectorAll(".mf-type").forEach(el => el.onchange = () => { work[+el.dataset.i].type = el.value; });
    ov.querySelectorAll(".mf-def").forEach(el => el.onchange = () => { work[+el.dataset.i].def = el.value; });
    ov.querySelectorAll(".mf-up").forEach(el => el.onclick = () => { syncInputs(); const i = +el.dataset.i; [work[i - 1], work[i]] = [work[i], work[i - 1]]; render(); });
    ov.querySelectorAll(".mf-dn").forEach(el => el.onclick = () => { syncInputs(); const i = +el.dataset.i; [work[i + 1], work[i]] = [work[i], work[i + 1]]; render(); });
    ov.querySelectorAll(".mf-del").forEach(el => el.onclick = () => { syncInputs(); work.splice(+el.dataset.i, 1); render(); });
  };
  ov.innerHTML = `<div class="modal fmt-modal fmt-modal-lg">
    <div class="modal-head">Поля слоя · ${escHtml(layer.title)}
      <button class="modal-x" aria-label="Закрыть поля слоя"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
      <div class="fc-help">Имя, тип, порядок и значение по умолчанию своих полей. Значение по умолчанию заполняет пустые ячейки и новые объекты.</div>
      <div class="mf-table-wrap"><table class="attr-table mf-table"><thead><tr><th>Имя</th><th>Тип</th><th>По умолчанию</th><th></th></tr></thead><tbody id="mf-body"></tbody></table></div>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button id="mf-cancel">Отмена</button><button id="mf-ok" class="primary">Применить</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => e.stopPropagation());
  render();
  const close = () => ov.remove();
  q("mf-ok").addEventListener("click", () => {
    syncInputs();
    const names = work.map(f => (f.name || "").trim());
    if (names.some(n => !n)) { toast("Имя поля не может быть пустым", "warn"); return; }
    if (new Set(names).size !== names.length) { toast("Имена полей должны быть уникальны", "warn"); return; }
    const reserved = attrColumns(layer).filter(c => c.virtual || c.semantic).map(c => c.name);
    if (names.some(n => reserved.includes(n))) { toast("Имя совпадает со встроенной колонкой", "warn"); return; }
    snapshot();
    // перестраиваем props каждого объекта: несобственные ключи (семантика)
    // сохраняем, свои поля переносим по _orig в новое имя/тип, пустые — дефолт.
    // так корректно отрабатывают переименование, смена типа и удаление разом
    const managedOld = new Set((layer.fields || []).map(x => x.name));
    for (const ft of featuresOnLayer(layer.id)) {
      const old = ft.props || {};
      const np = {};
      for (const [k, v] of Object.entries(old)) if (!managedOld.has(k)) np[k] = v;
      for (const f of work) {
        const nm = f.name.trim();
        let v = f._orig != null ? old[f._orig] : undefined;
        if (v == null || v === "") v = f.def !== "" ? f.def : undefined;
        if (v != null && v !== "") np[nm] = castField(f.type, v);
      }
      ft.props = np;
    }
    layer.fields = work.map(f => {
      const o = { name: f.name.trim(), type: f.type };
      if (f.def !== "") o.default = castField(f.type, f.def);
      return o;
    });
    close(); persist(); if (onDone) onDone();
    toast("Поля слоя обновлены");
  });
  q("mf-cancel").addEventListener("click", close);
  ov.querySelector(".modal-x").addEventListener("click", close);
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
}

// калькулятор полей — БЕЗ closePopups; getFeats() возвращает текущий набор (учёт фильтра)
function openFieldCalc(layer, getFeats, onDone) {
  const cols = attrColumns(layer), existing = cols.filter(c => !c.virtual);
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal fmt-modal fmt-modal-lg fc-modal">
    <div class="modal-head">Калькулятор полей · ${escHtml(layer.title)}
      <button class="modal-x" aria-label="Закрыть калькулятор полей"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body compact">
    <div class="fmt-sub">Куда записать</div>
    <label class="chk"><input type="radio" name="fc-mode" id="fc-new" checked> новое поле</label>
    <label>Имя<input type="text" id="fc-name" value="расчёт"></label>
    <label>Тип<select id="fc-type">${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}"${k === "real" ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="chk"><input type="radio" name="fc-mode" id="fc-exist"> в существующее</label>
    <label><select id="fc-field">${existing.map(c => `<option value="${escHtml(c.name)}">${escHtml(c.label)}</option>`).join("")}</select></label>
    <div class="fmt-sub">Выражение</div>
    <textarea id="fc-expr" class="fc-expr" rows="2" placeholder="$area / 10000" spellcheck="false"></textarea>
    <div class="fc-help">${["$area", "$length", "$perimeter"].map(v => `<button type="button" class="fc-ins" data-t="${v}">${v}</button>`).join("")}${existing.map(c => `<button type="button" class="fc-ins" data-t="${escHtml(c.name)}">${escHtml(c.name)}</button>`).join("")}</div>
    <div class="fc-help muted">round(x[,n]) · abs · min · max · sqrt · upper · lower · concat · if(усл,а,б)</div>
    <label class="chk"><input type="checkbox" id="fc-selonly"> только для выделенных</label>
    <div id="fc-preview" class="fc-preview muted"></div>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button id="fc-cancel">Отмена</button><button id="fc-ok" class="primary">Вычислить</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => e.stopPropagation());
  const q = id => ov.querySelector("#" + id);
  const close = () => ov.remove();
  const preview = () => {
    const feats = getFeats(), el = q("fc-preview");
    if (!feats.length) { el.textContent = "нет объектов"; return; }
    try { el.textContent = "первый объект → " + evalFieldExpr(q("fc-expr").value || "0", feats[0]); el.classList.remove("err"); }
    catch (e) { el.textContent = "ошибка: " + e.message; el.classList.add("err"); }
  };
  q("fc-expr").addEventListener("input", preview);
  ov.querySelectorAll(".fc-ins").forEach(b => b.addEventListener("click", () => {
    const ta = q("fc-expr");
    ta.setRangeText(b.dataset.t, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); preview();
  }));
  q("fc-ok").addEventListener("click", () => {
    const expr = q("fc-expr").value.trim();
    if (!expr) { toast("Введите выражение", "warn"); return; }
    let out, type;
    if (q("fc-new").checked) {
      out = q("fc-name").value.trim().replace(/[^\wА-Яа-яЁё .\-]/g, ""); type = q("fc-type").value;
      if (!out) { toast("Введите имя нового поля", "warn"); return; }
      const clash = attrColumns(layer).find(c => c.name === out);
      if (clash && (clash.virtual || clash.semantic)) { toast("Имя занято вычисляемым/семантическим полем", "warn"); return; }
      snapshot(); if (!clash) addLayerFieldTo(layer, out, type);
    } else {
      out = q("fc-field").value; const col = cols.find(c => c.name === out); type = col ? col.type : "real"; snapshot();
    }
    const feats = getFeats().filter(f => !q("fc-selonly").checked || state.selectedIds.has(f.id));
    let ok = 0, bad = 0;
    for (const f of feats) {
      try { f.props = f.props || {}; f.props[out] = castField(type, evalFieldExpr(expr, f)); ok++; }
      catch (e) { bad++; }
    }
    draw(); refreshTep(); persist(); close(); onDone();
    const objectWord = n => {
      const value = Math.abs(Number(n)) || 0, mod100 = value % 100, mod10 = value % 10;
      return mod100 >= 11 && mod100 <= 14 ? "объектов"
        : mod10 === 1 ? "объект" : mod10 >= 2 && mod10 <= 4 ? "объекта" : "объектов";
    };
    toast(`Вычислено: ${ok} ${objectWord(ok)} → «${out}»${bad ? `, пропущено ${bad}` : ""}`);
  });
  q("fc-cancel").addEventListener("click", close);
  ov.querySelector(".modal-x").addEventListener("click", close);
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
  preview();
}
