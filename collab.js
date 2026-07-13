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
    "krail", "kba", "layersVisible", "layerLocked", "layerRules", "layerOrder",
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

  // слияние всего shared-состояния: features — по объектам; прочие shared-ключи
  // (слои/стили/настройки) — «последний победил» (мой), кроме отсутствующих
  function mergeShared(base, mine, theirs) {
    const { features, conflicts } = mergeFeatures(
      (base || {}).features, mine.features, (theirs || {}).features);
    const merged = { ...theirs, ...mine, features };
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
    const r = await fetch(url, opt);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data };
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
        break;                              // прочие ошибки — не зацикливаемся
      }
      setSyncBadge(Collab.dirty ? "dirty" : "ok");
    } finally {
      Collab.syncing = false;
    }
  }

  // ---- поллинг чужих правок ----------------------------------------------
  async function poll() {
    if (!Collab.active || !Collab.pid || Collab.syncing || Collab.dirty) return;
    const res = await api("GET", `/api/projects/${Collab.pid}/state?since=${Collab.rev}`);
    if (!res.ok) { if (res.status === 401) onSessionLost(); return; }
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
                  dirty: ["● есть изменения", "dirty"], off: ["", ""] };
    const [text, cls] = map[kind] || map.off;
    el.textContent = text; el.className = "collab-badge " + cls;
  }
  function updatePresence() {
    const el = document.getElementById("collab-online");
    if (!el) return;
    const others = Collab.online.filter(u => u !== Collab.user);
    el.textContent = others.length ? "👥 " + others.join(", ") : "";
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
      <label>Пароль<input id="au-pass" type="password" autocomplete="${isReg ? "new-password" : "current-password"}" placeholder="минимум 6 символов"></label>
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
    const projects = (res.data && res.data.projects) || [];
    const rows = projects.length ? projects.map(p => `
      <div class="collab-proj" data-pid="${p.id}">
        <div class="collab-proj-main">
          <div class="collab-proj-name">${esc(p.name)}</div>
          <div class="collab-proj-meta">${p.objects} об. · ред. ${p.owner === Collab.user ? "вы" : esc(p.owner)}${p.members.length ? " +" + p.members.length : ""}</div>
        </div>
        <div class="collab-proj-actions">
          ${p.owner === Collab.user ? `<button class="collab-share" data-pid="${p.id}" title="Дать доступ коллеге">Поделиться</button>
          <button class="collab-del" data-pid="${p.id}" title="Удалить проект">✕</button>` : `<span class="muted">общий</span>`}
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
      <div class="collab-list">${rows}</div>
    </div>`);
    const $ = id => projOverlay.querySelector("#" + id);
    $("pj-create").addEventListener("click", async () => {
      const name = $("pj-name").value.trim();
      const r = await api("POST", "/api/projects", { name });
      if (r.ok) openProject(r.data.id);
    });
    $("pj-name").addEventListener("keydown", e => { if (e.key === "Enter") $("pj-create").click(); });
    $("pj-logout").addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      location.reload();
    });
    if ($("pj-invite")) $("pj-invite").addEventListener("click", async () => {
      const r = await api("POST", "/api/invites");
      if (r.ok) window.prompt("Передайте этот инвайт-код коллеге (одноразовый):", r.data.invite);
      else if (window.toast) window.toast(r.data && r.data.error || "ошибка", "error");
    });
    projOverlay.querySelectorAll(".collab-proj-main").forEach(el =>
      el.addEventListener("click", () => openProject(el.parentElement.dataset.pid)));
    projOverlay.querySelectorAll(".collab-share").forEach(btn =>
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const login = window.prompt("Логин коллеги, которому дать доступ:");
        if (!login) return;
        const r = await api("POST", `/api/projects/${btn.dataset.pid}/share`, { login: login.trim() });
        if (window.toast) window.toast(r.ok ? "Доступ выдан: " + login : (r.data && r.data.error || "ошибка"), r.ok ? "ok" : "error");
      }));
    projOverlay.querySelectorAll(".collab-del").forEach(btn =>
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        if (!window.confirm("Удалить проект безвозвратно?")) return;
        await api("POST", `/api/projects/${btn.dataset.pid}/delete`);
        showProjects();
      }));
  }

  async function openProject(pid) {
    const res = await api("GET", `/api/projects/${pid}/state`);
    if (!res.ok) { if (window.toast) window.toast("не удалось открыть проект", "error"); return; }
    if (projOverlay) { projOverlay.remove(); projOverlay = null; }
    Collab.pid = pid; Collab.rev = res.data.rev;
    Collab.base = res.data.state || {};
    Collab.online = res.data.online || [];
    // применяем серверное shared-состояние (пустое для нового проекта — ок)
    applyShared({ ...(res.data.state || {}) }, false);
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
      back.addEventListener("click", () => {
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
