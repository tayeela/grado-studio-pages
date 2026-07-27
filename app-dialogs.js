// ГРАДО Студия · часть 11 из 14 (грузится после app-layer-ui.js).
// встроенные диалоги вместо браузерных, журнал источников
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- встроенные диалоги (взамен браузерных alert/confirm/prompt) ----------
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Цвета знаков приходят из ОТКРЫТОГО ФАЙЛА проекта (.grado-web.json) и из
// оформления, полученного по сети, а дальше подставляются в атрибут style="…".
// Экранирования тут мало: внутри style можно и без кавычек дотянуться до url()
// и до чужих свойств. Поэтому пускаем только заведомо цветовой синтаксис —
// hex, rgb/rgba, hsl/hsla, ключевое слово. Всё остальное отбрасываем.
const CSS_COLOR_RE =
  /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/a-z]+\)|[a-z]{3,20})$/i;
function safeCssColor(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const color = value.trim();
  if (!color || color.length > 64) return fallback;
  return CSS_COLOR_RE.test(color) ? color : fallback;
}
// Корень проблемы был здесь: при восстановлении проверялся только КЛЮЧ стиля
// (isSafeDictionaryKey), а значения клались как есть. Файл с fill вида
// `"><img src=x onerror=…>` доезжал до style="…" в диалоге «Типы слоёв».
// Проекты ходят между коллегами файлами, поэтому это вектор атакующий→жертва,
// а не self-XSS. Цветовые поля пропускаем только валидными.
const STYLE_COLOR_FIELDS = ["fill", "stroke", "border_color", "borderColor", "line_color"];
function sanitizeProjectStyle(style) {
  const clean = {};
  for (const [key, value] of Object.entries(style)) {
    if (!isSafeDictionaryKey(key)) continue;
    if (STYLE_COLOR_FIELDS.includes(key)) {
      const color = safeCssColor(value);
      if (color) clean[key] = color;
      continue;
    }
    if (key === "hatch" && isRecord(value)) {
      const hatch = {};
      for (const [hk, hv] of Object.entries(value)) {
        if (!isSafeDictionaryKey(hk)) continue;
        if (hk === "color") { const c = safeCssColor(hv); if (c) hatch[hk] = c; continue; }
        hatch[hk] = hv;
      }
      clean[key] = hatch;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}
function ruCount(value, one, few, many) {
  const number = Math.abs(Number(value)) || 0;
  const mod100 = number % 100;
  const mod10 = number % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? many
    : mod10 === 1 ? one
    : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${value} ${word}`;
}
// подтверждение: Promise<bool>. danger — красная кнопка для необратимого.
function uiConfirm(msg, { title = "", ok = "OK", cancel = "Отмена", danger = false } = {}) {
  return new Promise(resolve => {
    // do not close other modals — allow nested (e.g. create project style from inside layer style dialog)
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal" role="dialog" aria-modal="true" aria-labelledby="ask-confirm-msg">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg" id="ask-confirm-msg">${escHtml(msg)}</div>
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">${escHtml(cancel)}</button>
        <button class="ask-ok ${danger ? "danger" : "primary"}">${escHtml(ok)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", ev => ev.stopPropagation());
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelector(".ask-ok").addEventListener("click", () => done(true));
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(false));
    overlay.addEventListener("click", ev => { if (ev.target === overlay) done(false); });
    overlay.addEventListener("keydown", ev => { if (ev.key === "Escape") done(false); });
    overlay.querySelector(danger ? ".ask-cancel" : ".ask-ok").focus();
  });
}
// Явный выбор одного из нескольких действий: Promise<value|null>.
// В отличие от uiConfirm, «Отмена» и Escape всегда означают отсутствие
// выбора, а не неявный переход ко второму действию.
function uiChoice(msg, choices, { title = "", cancel = "Отмена" } = {}) {
  return new Promise(resolve => {
    const safeChoices = Array.isArray(choices)
      ? choices.filter(choice => choice && choice.value != null && choice.label) : [];
    if (!safeChoices.length) { resolve(null); return; }
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal" role="dialog" aria-modal="true" aria-labelledby="ask-confirm-msg">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg" id="ask-confirm-msg">${escHtml(msg)}</div>
      <div class="modal-actions"><button class="ask-cancel">${escHtml(cancel)}</button>
        <span class="spacer"></span>${safeChoices.map((choice, index) =>
          `<button class="ask-choice${choice.primary ? " primary" : ""}" data-choice="${index}">${escHtml(choice.label)}</button>`
        ).join("")}
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };
    overlay.querySelectorAll(".ask-choice").forEach(button => {
      button.addEventListener("click", () => done(
        safeChoices[Number(button.dataset.choice)]?.value ?? null));
    });
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(null));
    overlay.addEventListener("click", event => { if (event.target === overlay) done(null); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(null); });
    (overlay.querySelector(".ask-choice.primary") ||
      overlay.querySelector(".ask-choice") || overlay.querySelector(".ask-cancel")).focus();
  });
}
// ввод строки: Promise<string|null> (null — отмена).
function uiPrompt(msg, def = "", { ok = "OK", placeholder = "" } = {}) {
  return new Promise(resolve => {
    // do not close other modals — allow nested (e.g. create project style from inside layer style dialog)
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal" role="dialog" aria-modal="true" aria-labelledby="ask-prompt-msg">
      <div class="ask-msg" id="ask-prompt-msg">${escHtml(msg)}</div>
      <input type="text" class="ask-input" placeholder="${escHtml(placeholder)}">
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">Отмена</button>
        <button class="ask-ok primary">${escHtml(ok)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", ev => ev.stopPropagation());
    const inp = overlay.querySelector(".ask-input");
    inp.value = def; inp.focus(); inp.select();
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelector(".ask-ok").addEventListener("click", () => done(inp.value));
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(null));
    inp.addEventListener("keydown", ev => {
      if (ev.key === "Enter") done(inp.value);
      if (ev.key === "Escape") done(null);
    });
    overlay.addEventListener("click", ev => { if (ev.target === overlay) done(null); });
  });
}
// Показывает значение для передачи коллеге без нативного prompt: поле сразу
// выделено, копирование работает и через Clipboard API, и в старых браузерах.
function uiCopyText(msg, value, { title = "", copy = "Скопировать" } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal ask-modal" role="dialog" aria-modal="true" aria-labelledby="ask-choice-msg">
      ${title ? `<div class="ask-title">${escHtml(title)}</div>` : ""}
      <div class="ask-msg" id="ask-choice-msg">${escHtml(msg)}</div>
      <input type="text" class="ask-input" readonly aria-label="Значение для копирования">
      <div class="modal-actions"><span class="spacer"></span>
        <button class="ask-cancel">Закрыть</button>
        <button class="ask-copy primary">${escHtml(copy)}</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    const input = overlay.querySelector(".ask-input");
    input.value = String(value == null ? "" : value);
    const done = copied => { overlay.remove(); resolve(copied); };
    const select = () => { input.focus(); input.select(); };
    overlay.querySelector(".ask-copy").addEventListener("click", async () => {
      select();
      let copied = false;
      try { await navigator.clipboard.writeText(input.value); copied = true; }
      catch (error) {
        try { copied = document.execCommand("copy"); } catch (fallbackError) { copied = false; }
      }
      if (copied) { toast("Скопировано", "ok"); done(true); }
      else toast("Не удалось скопировать — выделите текст вручную", "error");
    });
    overlay.querySelector(".ask-cancel").addEventListener("click", () => done(false));
    overlay.addEventListener("click", event => { if (event.target === overlay) done(false); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") done(false); });
    select();
  });
}
window.uiConfirm = uiConfirm;
window.uiPrompt = uiPrompt;
window.uiCopyText = uiCopyText;

async function openAutosaveRecovery() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Проект</span><span id="recovery-title">Восстановление автосохранения</span></div>
      <button class="modal-x" aria-label="Закрыть окно восстановления"><svg class="ic"><use href="#ic-close"/></svg></button>
    </div>
    <div class="modal-body recovery-body"><div class="recovery-empty">Загрузка копий…</div></div>
    <div class="modal-actions"><span class="muted">Перед восстановлением текущее состояние будет сохранено.</span><span class="spacer"></span><button class="recovery-close">Закрыть</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").onclick = close;
  overlay.querySelector(".recovery-close").onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  overlay.onkeydown = event => { if (event.key === "Escape") close(); };
  // Безопасное действие внизу окна заметнее и удобнее с клавиатуры, чем
  // маленький крестик в заголовке. Общий a11y-слой затем удерживает Tab внутри.
  overlay.querySelector(".recovery-close").focus();
  const body = overlay.querySelector(".recovery-body");
  try {
    const response = await fetch("/api/autosave/backups");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const backups = Array.isArray(data.backups) ? data.backups : [];
    if (!backups.length) {
      const emptyCopy = window.GRADO_STATIC
        ? "Контрольная копия появится перед созданием или открытием другого проекта."
        : "Предыдущих копий пока нет. Они появятся после нескольких изменений проекта.";
      body.innerHTML = `<div class="recovery-empty">${emptyCopy}</div>`;
      return;
    }
    body.innerHTML = backups.map(item => {
      const date = item.saved_at ? new Date(item.saved_at).toLocaleString("ru-RU", {
        dateStyle: "medium", timeStyle: "short",
      }) : "Старая копия";
      return `<div class="recovery-item">
        <div class="recovery-main"><strong>${escHtml(item.name)}</strong><span>${escHtml(date)} · ${ruCount(item.feature_count, "объект", "объекта", "объектов")}</span></div>
        <button data-recover="${item.id}">Восстановить</button>
      </div>`;
    }).join("");
    body.querySelectorAll("[data-recover]").forEach(button => {
      button.onclick = async () => {
        const item = backups.find(x => String(x.id) === button.dataset.recover);
        if (!item || !(await uiConfirm(
          `Восстановить копию «${item.name}»? Текущее состояние останется в резервных копиях.`,
          { ok: "Восстановить" }))) return;
        button.disabled = true;
        try {
          const backupResponse = await fetch(`/api/autosave/backups/${item.id}`);
          if (!backupResponse.ok) throw new Error(`HTTP ${backupResponse.status}`);
          const saved = await backupResponse.json();
          clearTimeout(autosaveTimer);
          await saveStateNow(collectState(), { checkpoint: true });
          const savedState = saved && saved.state && typeof saved.state === "object"
            ? saved.state : saved;
          resetProjectState(savedState && savedState.name || "Восстановленный проект");
          if (!applyRestoredState(saved)) throw new Error("invalid autosave state");
          const skipped = lastRestoreSkipped;
          syncProjectControls();
          close();
          afterChange(); fitView();
          toast(skipped
            ? `Восстановлена копия «${item.name}»; ${ruCount(skipped, "повреждённый объект пропущен", "повреждённых объекта пропущено", "повреждённых объектов пропущено")}`
            : `Восстановлена копия «${item.name}»`, skipped ? "warn" : "ok");
        } catch (error) {
          button.disabled = false;
          toast("Не удалось восстановить копию — выберите другую из списка "
            + "или откройте проект файлом", "error");
        }
      };
    });
  } catch (error) {
    body.innerHTML = `<div class="recovery-empty error">Не удалось получить резервные копии.</div>`;
  }
}



// ---------- журнал источников (снимки НСПД/ФГИС ТП, шаг 6) ----------
// человекочитаемые имена источников (в данных — короткие коды коннекторов)
const SOURCE_LABELS = { fgistp: "ФГИС ТП", nspd: "НСПД", gisogd: "ГИС ОГД" };
// объектов → «N объектов» с правильным русским склонением
function plObjects(n) {
  const t = n % 10, h = n % 100;
  const w = (t === 1 && h !== 11) ? "объект"
          : (t >= 2 && t <= 4 && (h < 12 || h > 14)) ? "объекта" : "объектов";
  return `${n} ${w}`;
}
function renderSources() {
  const el = document.getElementById("sources-body");
  if (!el) return;
  if (!state.sources.length) {
    el.className = "muted"; el.textContent = "Пока не импортировано"; return;
  }
  el.className = "";
  el.innerHTML = state.sources.map(s => {
    // технический хеш снимка (670c6316) пользователю не нужен — прячем
    // в подсказку для диагностики, показываем дату и число объектов
    const sha = s.sha8 || (s.sha256 || "").slice(0, 8);
    const date = (s.fetched_at || "").slice(0, 10);
    const name = SOURCE_LABELS[s.source] || (s.source || "").toUpperCase();
    return `<div class="src-row" title="снимок ${escHtml(s.id)} · версия ${escHtml(sha)}">
      <span class="src-name">${escHtml(name)}</span>
      <span class="src-meta">${date} · ${plObjects(s.count)}</span></div>`;
  }).join("");
}

// снимок из ответа импорта → журнал; diff → тост «источник изменился»
function recordSource(snapshot, diff, options = {}) {
  if (!snapshot) return;
  if (!state.sources.some(s => s.id === snapshot.id)) {
    state.sources.unshift(snapshot);
    if (state.sources.length > 50) state.sources.pop();
  }
  if (!options.defer) { renderSources(); persist(); }
  if (diff && (diff.added.length || diff.removed.length || diff.changed.length))
    toast(`Источник изменился: +${diff.added.length} −${diff.removed.length} ~${diff.changed.length}`);
}

// журнал снимков сервера — источник истины (сливаем с локальным)
async function fetchSources() {
  try {
    const r = await fetch("/api/sources");
    if (!r.ok) return;
    const list = await r.json();
    const byId = new Map(state.sources.map(s => [s.id, s]));
    for (const s of list) byId.set(s.id, s);
    state.sources = [...byId.values()]
      .sort((a, b) => (b.fetched_at || "").localeCompare(a.fetched_at || ""));
    renderSources();
  } catch (e) { /* сервер без /api/sources — журнал только локальный */ }
}

// Delete уносил объекты заблокированных слоёв молча: рамкой захватили подложку
// ЕГРН вместе со своими зонами — и она исчезла без единого слова, хотя рисовать
// в тот же слой addFeature не давал и говорил об этом вслух. Замок для того и
// ставят. Но замок здесь — предупреждение, а не запрет: бывает, что удалить
// нужно именно защищённое, и гонять человека в панель слоёв ради снятия и
// возврата замка — лишний обряд. Поэтому спрашиваем прямо на месте.
let удалениеСпрашивает = false;
async function deleteSelected() {
  // Модальное окно перекрывает только мышь, клавиатура доходит до документа:
  // без этого флага повторный Delete открывал второе окно поверх первого,
  // и решение по первому применялось к уже устаревшей выборке.
  if (удалениеСпрашивает) return;
  const ids = new Set(selectionIds());
  if (!ids.size) return;
  const защищены = state.features.filter(f => ids.has(f.id) && layerOf(f)?.locked);
  let кУдалению = ids;
  if (защищены.length) {
    const слои = [...new Set(защищены.map(f => layerOf(f)?.title).filter(Boolean))];
    const сколько = ruCount(защищены.length, "объект", "объекта", "объектов");
    const где = слои.length
      ? `${слои.length === 1 ? "заблокированного слоя" : "заблокированных слоёв"} ` +
        слои.map(t => `«${t}»`).join(", ")
      : "заблокированных слоёв";
    const свободных = ids.size - защищены.length;
    удалениеСпрашивает = true;
    try {
      if (!свободных) {
        // Незащищённого в выборке нет — выбор ровно один и необратимый,
        // поэтому danger-окно: фокус на «Отмене», Enter ничего не сносит.
        const всёравно = await uiConfirm(
          `Вся выборка (${сколько}) — из ${где}.`,
          { title: "Удаление", ok: "Удалить всё равно", danger: true });
        if (!всёравно) return;
      } else {
        const выбор = await uiChoice(
          `В выборке ${сколько} из ${где}.`,
          [{ value: "свободные", label: `Удалить остальные (${свободных})`, primary: true },
           { value: "всё", label: `Удалить всё (${ids.size})` }],
          { title: "Удаление" });
        if (выбор == null) return;
        if (выбор === "свободные") {
          const защищеныId = new Set(защищены.map(f => f.id));
          кУдалению = new Set([...ids].filter(id => !защищеныId.has(id)));
        }
      }
    } finally { удалениеСпрашивает = false; }
  }
  snapshot();
  state.features = state.features.filter(f => !кУдалению.has(f.id));
  clearSelection(); afterChange();
}

