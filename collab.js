/* ГРАДО Студия — веб-режим совместной работы (клиентская часть).
 *
 * Подключается ТОЛЬКО когда сервер запущен с --hub (index.html грузит collab.js
 * после app.js; в локальном режиме модуль ничего не делает). Отвечает за:
 *   — вход/регистрацию и список проектов (оверлеи поверх студии);
 *   — синхронизацию state проекта с сервером: отправка своих правок с base_rev,
 *     поллинг чужих, слияние 3-way по id объектов при конфликте (409).
 *
 * Разделение состояния: на сервер уходит только SHARED (features, слои, стили —
 * см. webhub.SHARED_STATE_KEYS), личное (вид, активный слой, undo/redo,
 * подложка) остаётся у каждого своим и живёт в localStorage как раньше.
 */
(function () {
  "use strict";

  const Collab = {
    active: false, user: null, admin: false,
    pid: null, rev: 0, base: null,      // base = снимок последнего согласованного shared-состояния
    online: [], syncing: false, dirty: false, pollTimer: null, applying: false,
  };
  window.Collab = Collab;

  // ---- shared/personal ----------------------------------------------------
  const SHARED_KEYS = ["features", "nextId", "name", "density", "ratio",
    "educationZone", "territoryMode", "krail", "kba", "layersVisible",
    "layerLocked", "layerRules", "layerOrder",
    "layerFmt", "layerFields", "layerTitles", "userLayers", "projectStyles",
    "projectCustomKinds", "sources", "albumConfig"];

  function sharedSnapshot() {
    // используем сборщик состояния студии (тот же, что для autosave/localStorage)
    const full = window.collectState ? window.collectState() : null;
    if (!full) return {};
    const out = {};
    for (const k of SHARED_KEYS) if (k in full) out[k] = full[k];
    return out;
  }

  // ---- 3-way merge по id объектов ----------------------------------------
  // base — общий предок (последний согласованный features), mine — мой,
  // theirs — серверный. Правим по-объектно: если объект менял только один —
  // берём его версию; если оба И по-разному — «последний победил» = мой
  // (я инициатор записи), но с уведомлением. Добавления/удаления объединяем.
  function mergeFeatures(base, mine, theirs) {
    const byId = arr => new Map((arr || []).map(f => [f.id, f]));
    const b = byId(base), m = byId(mine), t = byId(theirs);
    const ids = new Set([...m.keys(), ...t.keys()]);
    const out = [];
    let conflicts = 0;
    const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    for (const id of ids) {
      const mo = m.get(id), to = t.get(id), bo = b.get(id);
      if (mo && to) {                       // есть у обоих
        if (eq(mo, to)) { out.push(mo); continue; }
        const iChanged = !bo || !eq(mo, bo);
        const theyChanged = !bo || !eq(to, bo);
        if (iChanged && theyChanged) { out.push(mo); conflicts++; }  // оба → мой
        else if (iChanged) out.push(mo);
        else out.push(to);
      } else if (mo && !to) {               // нет у них
        if (bo && eq(mo, bo)) { /* они удалили, я не трогал → удаляем */ }
        else out.push(mo);                  // я добавил/изменил → сохраняем
      } else if (!mo && to) {               // нет у меня
        if (bo && eq(to, bo)) { /* я удалил, они не трогали → удаляем */ }
        else out.push(to);                  // они добавили/изменили → сохраняем
      }
    }
    out.sort((a, b2) => (a.id || 0) - (b2.id || 0));
    return { features: out, conflicts };
  }

  const MISSING = Symbol("missing");
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (left === MISSING || right === MISSING) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((value, index) => sameValue(value, right[index]));
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && sameValue(left[key], right[key]));
  }

  // Обычный 3-way для одного значения. Если менял только один участник,
  // берём его версию. Одновременные правки объектов сливаем по вложенным
  // ключам; неразрешимый конфликт оставляет локальную версию инициатора.
  function mergeValue(base, mine, theirs) {
    if (sameValue(mine, theirs)) return { value: mine, conflicts: 0 };
    if (sameValue(mine, base)) return { value: theirs, conflicts: 0 };
    if (sameValue(theirs, base)) return { value: mine, conflicts: 0 };

    if (isPlainObject(mine) && isPlainObject(theirs)
        && (base === MISSING || isPlainObject(base))) {
      const ancestor = base === MISSING ? {} : base;
      const keys = new Set([
        ...Object.keys(ancestor), ...Object.keys(mine), ...Object.keys(theirs),
      ]);
      const value = {};
      let conflicts = 0;
      for (const key of keys) {
        const result = mergeValue(
          hasOwn(ancestor, key) ? ancestor[key] : MISSING,
          hasOwn(mine, key) ? mine[key] : MISSING,
          hasOwn(theirs, key) ? theirs[key] : MISSING,
        );
        conflicts += result.conflicts;
        if (result.value !== MISSING) value[key] = result.value;
      }
      return { value, conflicts };
    }
    return { value: mine, conflicts: 1 };
  }

  // Слияние всего shared-состояния. Геометрия объединяется по id объектов,
  // остальные поля — настоящим 3-way. Это важно не только при 409: во время
  // обычного poll локальное состояние равно base, поэтому удалённая правка
  // плотности, слоя или стиля должна примениться, а не затереться локальным.
  function mergeShared(base, mine, theirs) {
    const ancestor = base || {};
    const local = mine || {};
    const remote = theirs || {};
    const featureResult = mergeFeatures(
      ancestor.features, local.features, remote.features);
    const merged = { features: featureResult.features };
    let conflicts = featureResult.conflicts;
    const keys = new Set([
      ...Object.keys(ancestor), ...Object.keys(local), ...Object.keys(remote),
    ]);
    keys.delete("features");
    for (const key of keys) {
      const result = mergeValue(
        hasOwn(ancestor, key) ? ancestor[key] : MISSING,
        hasOwn(local, key) ? local[key] : MISSING,
        hasOwn(remote, key) ? remote[key] : MISSING,
      );
      conflicts += result.conflicts;
      if (result.value !== MISSING) merged[key] = result.value;
    }
    return { merged, conflicts };
  }
  Collab._mergeShared = mergeShared;   // тестовый хук (см. проверку слияния)

  // ---- сеть ---------------------------------------------------------------
  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    try {
      const r = await fetch(url, opt);
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { ok: r.ok, status: r.status, data };
    } catch (error) {
      return { ok: false, status: 0,
        data: { error: "Нет связи с сервером. Проверьте интернет и повторите." } };
    }
  }

  // ---- отправка своих правок (вызывается вместо autosave в hub-режиме) ----
  let pushTimer = null;
  Collab.schedulePush = function () {
    if (!Collab.active || !Collab.pid || Collab.applying) return;
    Collab.dirty = true;
    setSyncBadge("dirty");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 900);   // дебаунс — не шлём на каждый штрих
  };

  async function pushNow() {
    if (!Collab.active || !Collab.pid || Collab.syncing) {
      if (Collab.syncing) { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 500); }
      return;
    }
    Collab.syncing = true; setSyncBadge("sync");
    try {
      let attempts = 0;
      while (Collab.dirty && attempts < 5) {
        attempts++;
        Collab.dirty = false;
        const mine = sharedSnapshot();
        const res = await api("POST", `/api/projects/${Collab.pid}/state`,
          { base_rev: Collab.rev, state: mine });
        if (res.ok) {
          Collab.rev = res.data.rev;
          Collab.base = mine;
          Collab.online = res.data.online || Collab.online;
          continue;                         // если за это время снова накопилось — повтор
        }
        if (res.status === 409) {           // кто-то опередил — сливаем и повторяем
          const { merged, conflicts } = mergeShared(Collab.base, mine, res.data.state);
          Collab.rev = res.data.rev;
          applyShared(merged, /*fromMerge*/ true);
          Collab.dirty = true;              // отправить слитый результат
          if (conflicts && window.toast)
            window.toast(`Объединено с правками коллег (${conflicts} пересечений — оставлены ваши)`, "warn");
          continue;
        }
        if (res.status === 401) { onSessionLost(); return; }
        Collab.dirty = true;                // сервер не принял — правку не теряем
        setSyncBadge("offline");
        break;                              // повтор ниже, без горячего цикла
      }
      if (!Collab.dirty) setSyncBadge("ok");
    } finally {
      Collab.syncing = false;
      if (Collab.dirty && Collab.active && Collab.pid) {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushNow, 2500);
      }
    }
  }

  // ---- поллинг чужих правок ----------------------------------------------
  async function poll() {
    if (!Collab.active || !Collab.pid || Collab.syncing || Collab.dirty) return;
    const res = await api("GET", `/api/projects/${Collab.pid}/state?since=${Collab.rev}`);
    if (!res.ok) {
      if (res.status === 401) onSessionLost();
      else setSyncBadge("offline");
      return;
    }
    setSyncBadge("ok");
    Collab.online = res.data.online || [];
    updatePresence();
    if (res.data.state && res.data.rev !== Collab.rev) {
      // серверная версия новее и у меня нет несохранённого — применяем
      const theirs = res.data.state;
      const mine = sharedSnapshot();
      const { merged } = mergeShared(Collab.base, mine, theirs);
      Collab.rev = res.data.rev;
      Collab.base = theirs;
      applyShared(merged, true);
    }
  }

  // применяем shared-состояние к студии, сохранив личный вид/выделение/undo
  function applyShared(shared, fromMerge) {
    if (!window.applyRestoredState) return;
    Collab.applying = true;
    try {
      const personal = window.collectPersonal ? window.collectPersonal() : {};
      // applyRestoredState ждёт полный payload — дополняем личным
      window.applyRestoredState({ ...shared, ...personal });
      if (window.afterExternalApply) window.afterExternalApply();
    } finally {
      Collab.applying = false;
    }
  }

  function onSessionLost() {
    Collab.active = false;
    clearInterval(Collab.pollTimer);
    if (window.toast) window.toast("Сессия истекла — войдите заново", "error");
    showAuth();
  }

  // ---- UI: индикатор синка и присутствие ----------------------------------
  function setSyncBadge(kind) {
    const el = document.getElementById("collab-sync");
    if (!el) return;
    const map = { ok: ["● синхронизировано", "ok"], sync: ["⟳ сохранение…", "sync"],
                  dirty: ["● есть изменения", "dirty"],
                  offline: ["● нет связи · повторяем", "offline"], off: ["", ""] };
    const [text, cls] = map[kind] || map.off;
    el.textContent = text; el.className = "collab-badge " + cls;
  }
  function updatePresence() {
    const el = document.getElementById("collab-online");
    if (!el) return;
    const others = Collab.online.filter(u => u !== Collab.user);
    el.textContent = others.length ? "В проекте: " + others.join(", ") : "";
    el.title = others.length ? "Сейчас в проекте: " + others.join(", ") : "";
  }

  // ---- оверлеи: вход и выбор проекта --------------------------------------
  function overlay(html) {
    const o = document.createElement("div");
    o.className = "modal-overlay collab-overlay";
    o.innerHTML = html;
    o.addEventListener("click", e => e.stopPropagation());
    document.body.appendChild(o);
    return o;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function countObjects(value) {
    const n = Math.abs(Number(value)) || 0, m100 = n % 100, m10 = n % 10;
    const word = m100 >= 11 && m100 <= 14 ? "объектов"
      : m10 === 1 ? "объект" : m10 >= 2 && m10 <= 4 ? "объекта" : "объектов";
    return `${value} ${word}`;
  }

  let authOverlay = null;
  function showAuth(mode) {
    if (authOverlay) authOverlay.remove();
    mode = mode || "login";
    const isReg = mode === "register";
    authOverlay = overlay(`<div class="modal collab-auth">
      <div class="collab-brand">ГРАДО <span>Студия</span></div>
      <div class="collab-sub">${isReg ? "Регистрация по инвайт-коду" : "Вход в совместную работу"}</div>
      <div class="collab-err" id="au-err"></div>
      ${isReg ? `<label>Инвайт-код<input id="au-invite" autocomplete="off" placeholder="код от администратора"></label>` : ""}
      <label>Логин<input id="au-login" autocomplete="username" placeholder="латиница, 3-32 символа"></label>
      <label>Пароль<input id="au-pass" type="password" autocomplete="${isReg ? "new-password" : "current-password"}" placeholder="минимум 8 символов"></label>
      <button class="primary collab-go" id="au-go">${isReg ? "Зарегистрироваться" : "Войти"}</button>
      <div class="collab-switch">${isReg
        ? `Уже есть аккаунт? <a id="au-to-login">Войти</a>`
        : `Есть инвайт-код? <a id="au-to-reg">Зарегистрироваться</a>`}</div>
    </div>`);
    const $ = id => authOverlay.querySelector("#" + id);
    const err = m => { $("au-err").textContent = m; $("au-err").style.display = m ? "block" : "none"; };
    err("");
    const to = $("au-to-reg") || $("au-to-login");
    if (to) to.addEventListener("click", () => showAuth(isReg ? "login" : "register"));
    async function go() {
      const login = $("au-login").value.trim(), pass = $("au-pass").value;
      const body = { login, password: pass };
      if (isReg) body.invite = $("au-invite").value.trim();
      $("au-go").disabled = true; err("");
      const res = await api("POST", isReg ? "/api/auth/register" : "/api/auth/login", body);
      $("au-go").disabled = false;
      if (!res.ok) { err(res.data && res.data.error || "не удалось войти"); return; }
      Collab.user = res.data.login; Collab.admin = res.data.admin;
      authOverlay.remove(); authOverlay = null;
      showProjects();
    }
    $("au-go").addEventListener("click", go);
    authOverlay.querySelectorAll("input").forEach(inp =>
      inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); }));
    $("au-login").focus();
  }

  let projOverlay = null;
  async function showProjects() {
    if (projOverlay) projOverlay.remove();
    const res = await api("GET", "/api/projects");
    if (res.status === 401) { showAuth(); return; }
    const projects = res.ok && res.data && Array.isArray(res.data.projects) ? res.data.projects : [];
    const rows = projects.length ? projects.map(p => `
      <div class="collab-proj" data-pid="${p.id}">
        <div class="collab-proj-main">
          <div class="collab-proj-name">${esc(p.name)}</div>
          <div class="collab-proj-meta">${countObjects(p.objects)} · редактор: ${p.owner === Collab.user ? "вы" : esc(p.owner)}${p.members.length ? " +" + p.members.length : ""}</div>
        </div>
        <div class="collab-proj-actions">
          ${p.owner === Collab.user ? `<button class="collab-share" data-pid="${p.id}" title="Дать доступ коллеге">Поделиться</button>
          <button class="collab-del" data-pid="${p.id}" title="Удалить проект" aria-label="Удалить проект"><svg class="ic"><use href="#ic-close"/></svg></button>` : `<span class="muted">общий</span>`}
        </div>
      </div>`).join("") : `<div class="collab-empty">Пока нет проектов. Создайте первый.</div>`;
    projOverlay = overlay(`<div class="modal collab-projects">
      <div class="modal-head">Проекты · ${esc(Collab.user)}
        <span class="spacer"></span>
        ${Collab.admin ? `<button id="pj-invite" class="collab-mini" title="Создать инвайт-код для коллеги">+ инвайт</button>` : ""}
        <button id="pj-logout" class="collab-mini">Выйти</button></div>
      <div class="collab-newproj">
        <input id="pj-name" placeholder="Название нового проекта">
        <button class="primary" id="pj-create">Создать</button></div>
      <div class="collab-list">${res.ok ? rows : `<div class="collab-empty">${esc(res.data && res.data.error || "Не удалось загрузить проекты")}</div>`}</div>
    </div>`);
    const $ = id => projOverlay.querySelector("#" + id);
    $("pj-create").addEventListener("click", async () => {
      const name = $("pj-name").value.trim();
      $("pj-create").disabled = true;
      const r = await api("POST", "/api/projects", { name });
      $("pj-create").disabled = false;
      if (r.ok) openProject(r.data.id);
      else if (window.toast) window.toast(r.data && r.data.error || "Не удалось создать проект", "error");
    });
    $("pj-name").addEventListener("keydown", e => { if (e.key === "Enter") $("pj-create").click(); });
    $("pj-logout").addEventListener("click", async () => {
      const r = await api("POST", "/api/auth/logout");
      if (r.ok) location.reload();
      else if (window.toast) window.toast(r.data && r.data.error || "Не удалось выйти", "error");
    });
    if ($("pj-invite")) $("pj-invite").addEventListener("click", async () => {
      const r = await api("POST", "/api/invites");
      if (r.ok && window.uiCopyText) window.uiCopyText(
        "Передайте этот одноразовый код коллеге.", r.data.invite,
        { title: "Инвайт-код", copy: "Скопировать код" });
      else if (window.toast) window.toast(r.data && r.data.error || "ошибка", "error");
    });
    projOverlay.querySelectorAll(".collab-proj-main").forEach(el =>
      el.addEventListener("click", () => openProject(el.parentElement.dataset.pid)));
    projOverlay.querySelectorAll(".collab-share").forEach(btn =>
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const login = window.uiPrompt
          ? await window.uiPrompt("Логин коллеги, которому дать доступ:", "", { ok: "Дать доступ", placeholder: "login" })
          : null;
        if (!login) return;
        const r = await api("POST", `/api/projects/${btn.dataset.pid}/share`, { login: login.trim() });
        if (window.toast) window.toast(r.ok ? "Доступ выдан: " + login : (r.data && r.data.error || "ошибка"), r.ok ? "ok" : "error");
      }));
    projOverlay.querySelectorAll(".collab-del").forEach(btn =>
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const confirmed = window.uiConfirm
          ? await window.uiConfirm("Удалить проект безвозвратно?", { title: "Удаление проекта", ok: "Удалить", danger: true })
          : false;
        if (!confirmed) return;
        const r = await api("POST", `/api/projects/${btn.dataset.pid}/delete`);
        if (r.ok) showProjects();
        else if (window.toast) window.toast(r.data && r.data.error || "Не удалось удалить проект", "error");
      }));
  }

  async function openProject(pid) {
    const res = await api("GET", `/api/projects/${pid}/state`);
    if (!res.ok) {
      if (window.toast) window.toast(res.data && res.data.error || "Не удалось открыть проект", "error");
      return;
    }
    if (projOverlay) { projOverlay.remove(); projOverlay = null; }
    clearTimeout(pushTimer);
    Collab.dirty = false;
    Collab.pid = pid; Collab.rev = res.data.rev;
    const shared = { features: [], name: res.data.name || "Новый проект",
      ...(res.data.state || {}) };
    Collab.base = shared;
    Collab.online = res.data.online || [];
    // Полный сброс обязателен: иначе пустой проект наследует слои и объекты
    // предыдущего проекта, а отсутствующие shared-ключи не могут их удалить.
    if (window.resetProjectForExternalState)
      window.resetProjectForExternalState(res.data.name || "Новый проект");
    applyShared(shared, false);
    setSyncBadge("ok"); updatePresence();
    showCollabBar(res.data.name || "проект");
    if (Collab.pollTimer) clearInterval(Collab.pollTimer);
    Collab.pollTimer = setInterval(poll, 2500);
  }

  function showCollabBar(name) {
    const bar = document.getElementById("collab-bar");
    if (!bar) return;
    bar.style.display = "flex";
    const nm = document.getElementById("collab-projname");
    if (nm) nm.textContent = name;
    const back = document.getElementById("collab-back");
    if (back && !back._wired) {
      back._wired = true;
      back.addEventListener("click", async () => {
        back.disabled = true;
        clearTimeout(pushTimer);
        if (Collab.dirty) await pushNow();
        back.disabled = false;
        if (Collab.dirty) {
          if (window.toast) window.toast(
            "Изменения ещё не сохранены. Дождитесь восстановления связи.", "warn");
          return;
        }
        // вернуться к списку: остановить синк текущего проекта
        if (Collab.pollTimer) clearInterval(Collab.pollTimer);
        Collab.pid = null; Collab.rev = 0; Collab.base = null;
        bar.style.display = "none";
        showProjects();
      });
    }
  }

  // ---- запуск: определяем режим -------------------------------------------
  async function init() {
    const res = await api("GET", "/api/hub");
    if (!res.ok || !res.data.hub) return;   // локальный режим — collab спит
    Collab.active = true;
    document.body.classList.add("hub-mode");
    // перехват сохранения: в hub-режиме персист идёт на сервер, не в autosave
    window.hubSchedulePush = Collab.schedulePush;
    if (res.data.login) {                   // уже авторизован (кука жива)
      Collab.user = res.data.login; Collab.admin = res.data.admin;
      showProjects();
    } else {
      showAuth("login");
    }
  }

  // ждём готовности app.js (collectState/applyRestoredState объявлены там)
  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
})();
