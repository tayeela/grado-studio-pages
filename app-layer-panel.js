// ГРАДО Студия · часть 9 из 14 (грузится после app-tep.js).
// порядок панели слоёв, справка по горячим клавишам,
// единый контракт окон, совмещение слоя по двум точкам
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// Порядок панели — как в QGIS: верхняя строка рисуется ПОВЕРХ. В draw()
// массив идёт снизу вверх (индекс 0 = низ), поэтому список = обратный массив.
// Множество слоёв, в которых ЕСТЬ объекты — одним проходом по features.
// Раньше эту проверку делал featuresOnLayer(L.id) внутри фильтра, то есть
// полный проход по всем объектам НА КАЖДЫЙ слой: O(слои × объекты). При 400
// слоях-приёмниках и 20 000 объектов это ~8 млн итераций с аллокацией массива
// на каждый слой — и так дважды за перерисовку (панель + легенда).
function layersWithFeatures() {
  const ids = new Set();
  for (const feature of state.features) {
    const layer = layerOf(feature);
    if (layer) ids.add(layer.id);
  }
  return ids;
}
function layerRowsTopFirst(withFeatures = layersWithFeatures()) {
  // Приёмники импорта и размеры показываем только если в них уже есть объекты
  // (меньше захламления). Но теперь их можно явно удалить или переоформить —
  // система стала гибче (см. resetLayerFormatting и deleteLayer).
  return [...LAYERS_V2].reverse()
    .filter(L => !((L.import_only || L.annotation) && !withFeatures.has(L.id)));
}

// Перетаскивание строки src к строке target меняет порядок отрисовки.
// before=true — встать над target (рисоваться поверх него).
function reorderLayer(srcId, targetId, before) {
  if (srcId === targetId) return;
  const disp = [...LAYERS_V2].reverse();      // порядок показа (сверху вниз)
  const from = disp.findIndex(L => L.id === srcId);
  if (from < 0) return;
  const moved = disp.splice(from, 1)[0];
  let to = disp.findIndex(L => L.id === targetId);
  if (to < 0) return;
  if (!before) to += 1;
  snapshot();
  disp.splice(to, 0, moved);
  LAYERS_V2.splice(0, LAYERS_V2.length, ...disp.reverse());  // обратно в порядок отрисовки
  renderLayers(); draw(); persist();
}

const LAYER_GROUPS = {
  project: { title: "Проектирование", icon: "i-poly" },
  constraints: { title: "Ограничения", icon: "i-layers" },
  sources: { title: "Подложки и данные", icon: "i-map" },
};

function layerGroupKey(layer) {
  const title = String(layer.title || "").toLocaleLowerCase("ru");
  if (layer.import_only || layer.source_kind || layer.id.startsWith("source.")) return "sources";
  if (["restrict", "redline", "boundary"].includes(layer.kind)
      || /огранич|зоуит|охран|красн|границ|санитар|затоп/.test(title)) return "constraints";
  return "project";
}

function layerGeometryMeta(layer) {
  const type = layer.geometry_type || "polygon";
  if (type === "point") return { icon: "i-dot", label: "Точки" };
  if (type === "polyline" || type === "line") return { icon: "i-line", label: "Линии" };
  return { icon: "i-poly", label: "Полигоны" };
}

// statsByLayer — готовая статистика из renderLayers (счётчик и категории за
// один проход). Без неё легенда снова сканировала бы все объекты на каждый слой.
function renderLayerLegend(sampleByLayer = {}, statsByLayer = null) {
  const withFeatures = statsByLayer ? new Set(statsByLayer.keys()) : layersWithFeatures();
  const host = document.getElementById("layers-legend-body");
  if (!host) return;
  host.innerHTML = "";
  const visibleLayers = layerRowsTopFirst(withFeatures).filter(layer => layer.visible);
  if (!visibleLayers.length) {
    host.innerHTML = '<div class="legend-empty">Включите видимость слоя — его знак появится здесь.</div>';
    return;
  }
  const groupHosts = new Map();
  const groupForKey = key => {
    if (groupHosts.has(key)) return groupHosts.get(key);
    const section = document.createElement("section");
    section.className = "legend-group";
    section.innerHTML = `<h3>${escHtml(LAYER_GROUPS[key].title)}</h3><div></div>`;
    host.appendChild(section);
    const body = section.lastElementChild;
    groupHosts.set(key, body);
    return body;
  };
  const presentGroups = new Set(visibleLayers.map(layerGroupKey));
  Object.keys(LAYER_GROUPS).filter(key => presentGroups.has(key)).forEach(groupForKey);
  visibleLayers.forEach(layer => {
    const group = groupForKey(layerGroupKey(layer));
    const stat = statsByLayer && statsByLayer.get(layer.id);
    const allCats = stat
      ? [...stat.cats.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"))
      : layerCatStats(layer);
    const cats = allCats.filter(cat => !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id));
    // Градуированная символика: в легенде обязаны стоять диапазоны с их
    // цветами, иначе на чертеже цвет есть, а ключа к нему нет. Категорий у
    // таких правил нет — знак им не назначается, цвет считается по данным.
    const ranges = rangeRulesOf(layer);
    const items = ranges.length ? rangeLegendItems(layer, ranges)
      : cats.length > 1 ? cats : [{
        title: layer.title,
        count: stat ? stat.count : featuresOnLayer(layer.id).length,
        sample: sampleByLayer[layer.id],
      }];
    items.forEach(item => {
      const style = item.style || (item.sample ? styleOf(item.sample) : layerStyle(layer));
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="legend-sample" aria-hidden="true">${styleSampleSVG(style, { w: 54, h: 20 })}</span>
        <span class="legend-name">${escHtml(item.title || layer.title)}</span>
        <span class="legend-count">${item.count || ""}</span>`;
      group.appendChild(row);
    });
  });
}

function renderLayers() {
  const el = document.getElementById("layers-body");
  if (!el) return;
  el.innerHTML = "";
  // Знак-образец для свотча берём у ПЕРВОГО объекта слоя, а не из стиля слоя:
  // у слоёв-источников (ГИС ОГД) объекты несут свой знак (style_id), а стиль
  // слоя — общий контур, и превью рисовалось чёрной линией вместо знака (ООЗТ,
  // функц. зоны и т.п.). styleOf(объект) = ровно то, что нарисовано на холсте.
  const sampleByLayer = {};
  // Счётчик и категории каждого слоя считаем ЗДЕСЬ же, одним проходом. Раньше
  // цикл по слоям звал featuresOnLayer() и layerCatStats() — это два полных
  // прохода по всем объектам НА КАЖДЫЙ слой, O(слои × объекты) на любую правку:
  // 16 слоёв и 20 000 объектов давали ~640 000 итераций на перерисовку панели.
  const statsByLayer = new Map();
  const statFor = id => {
    let s = statsByLayer.get(id);
    if (!s) { s = { count: 0, cats: new Map() }; statsByLayer.set(id, s); }
    return s;
  };
  for (const f of state.features) {
    const lid = f.layer_id;
    if (!lid) continue;
    // предпочитаем объект СО знаком (style_id): в слое-источнике часть объектов
    // может быть без знака, и первый попавшийся дал бы пустой свотч
    const cur = sampleByLayer[lid];
    if (!cur || (!cur.style_id && f.style_id)) sampleByLayer[lid] = f;
    // счётчик — по РЕАЛЬНОМУ слою объекта (layerOf учитывает правило 7:
    // незарегистрированный layer_id уводит объект в слой по виду)
    const L = layerOf(f);
    if (!L) continue;
    const stat = statFor(L.id);
    stat.count++;
    const cat = featCat(f);
    if (!cat) continue;
    let entry = stat.cats.get(cat);
    if (!entry) {
      entry = { id: cat, title: (STYLES_V2[cat] && STYLES_V2[cat].title) || cat, count: 0, sample: f };
      stat.cats.set(cat, entry);
    }
    entry.count++;
  }
  const catsOf = id => [...(statsByLayer.get(id)?.cats.values() || [])]
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const groupHosts = new Map();
  let groupState = {};
  try { groupState = JSON.parse(localStorage.getItem("grado_layer_groups") || "{}"); } catch (_) {}
  const groupHostForKey = key => {
    if (groupHosts.has(key)) return groupHosts.get(key);
    const meta = LAYER_GROUPS[key];
    const section = document.createElement("section");
    section.className = "layer-stack-group";
    section.dataset.group = key;
    const open = groupState[key] !== false;
    const groupLayers = LAYERS_V2.filter(layer => layerGroupKey(layer) === key);
    const allVisible = groupLayers.length > 0 && groupLayers.every(layer => layer.visible);
    section.classList.toggle("collapsed", !open);
    section.innerHTML = `<div class="layer-group-head-row"><button type="button" class="layer-group-head" aria-expanded="${open}">
      <svg class="ic"><use href="#ic-chevron"/></svg><span>${escHtml(meta.title)}</span><span class="layer-group-count"></span></button>
      <button type="button" class="layer-group-visibility${allVisible ? "" : " is-off"}" aria-label="${allVisible ? "Скрыть" : "Показать"} все слои группы «${escHtml(meta.title)}»" title="${allVisible ? "Скрыть" : "Показать"} все слои группы"><svg class="ic"><use href="#ic-eye"/></svg></button></div>
      <div class="layer-group-body"></div>`;
    const head = section.querySelector(".layer-group-head");
    head.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
      groupState[key] = !collapsed;
      try { localStorage.setItem("grado_layer_groups", JSON.stringify(groupState)); } catch (_) {}
    });
    section.querySelector(".layer-group-visibility").addEventListener("click", () => {
      snapshot();
      const nextVisible = !allVisible;
      groupLayers.forEach(layer => { layer.visible = nextVisible; });
      if (!nextVisible) {
        const selected = selectedFeature();
        if (selected && groupLayers.includes(layerOf(selected))) {
          state.selected = null;
          renderProps();
        }
      }
      state._ix = null; state._snapIndex = null;
      persist();
      draw();
      renderLayers();
      toast(`${nextVisible ? "Показаны" : "Скрыты"} все слои группы «${meta.title}»`);
    });
    el.appendChild(section);
    const body = section.querySelector(".layer-group-body");
    groupHosts.set(key, body);
    return body;
  };
  // statsByLayer собран выше тем же проходом — второй раз объекты не сканируем
  const displayedLayers = layerRowsTopFirst(new Set(statsByLayer.keys()));
  const presentGroups = new Set(displayedLayers.map(layerGroupKey));
  Object.keys(LAYER_GROUPS).filter(key => presentGroups.has(key)).forEach(groupHostForKey);
  // Строку слоя строит layerPanelRow. В ctx уходит всё, что она читает из
  // общего прохода по объектам: считать статистику заново на каждую строку
  // — это O(слои × объекты), ровно то, от чего здесь избавлялись.
  const rowCtx = { el, statsByLayer, catsOf, sampleByLayer, groupHostForKey };
  for (const layer of displayedLayers) layerPanelRow(layer, rowCtx);
  // слои, которых больше нет в панели, из кэша убираем — иначе он растёт вечно
  const displayedIds = new Set(displayedLayers.map(l => l.id));
  for (const id of [..._layerRowCache.keys()])
    if (!displayedIds.has(id)) _layerRowCache.delete(id);
  groupHosts.forEach(body => {
    const section = body.closest(".layer-stack-group");
    section.querySelector(".layer-group-count").textContent = body.querySelectorAll(":scope > .layer-row").length;
  });
  renderLayerLegend(sampleByLayer, statsByLayer);
  updateLayerStatus();   // чип «куда я черчу» — синхрон с активным слоем
  updateStartExperience();
}

// Одна строка панели слоёв: свотч знака, счётчик объектов, видимость, замок
// и подпункты по знакам внутри слоя. Кэш строк (_layerRowCache) живёт
// снаружи: при совпадении сигнатуры узлы переиспользуются, а не строятся
// заново. Функция стоит ПОСЛЕ renderLayers сознательно — проверки кэша в
// tests/layers-panel-perf смотрят весь код, начиная с renderLayers.
function layerPanelRow(layer, ctx) {
  const { el, statsByLayer, catsOf, sampleByLayer, groupHostForKey } = ctx;
    const groupHost = groupHostForKey(layerGroupKey(layer));
    const count = statsByLayer.get(layer.id)?.count || 0;
    // QGIS-логика: если в слое объекты с РАЗНЫМИ знаками — показываем подпункты
    // по каждому форматированию (функц. зоны → производственные/многофункц./…).
    const cats = catsOf(layer.id);
    const multiCat = cats.length > 1;
    const catOpen = multiCat && _catOpen.has(layer.id);
    const sample = sampleByLayer[layer.id];
    const st = sample ? styleOf(sample) : layerStyle(layer);
    // Свотч в списке — ПОЛНЫЙ образец знака (штрих + засечки для линий, заливка +
    // штриховка + рамка для зон), а не просто цветной квадрат: правка юзера
    // «превью должны полностью отображать стиль». styleSampleSVG — из app.js.
    const swSvg = styleSampleSVG(st, { w: 54, h: 20 });
    const isActive = layer.id === state.activeLayerId;
    const sig = layerRowSignature(layer, { count, cats, catOpen, isActive, swSvg });
    const cached = _layerRowCache.get(layer.id);
    if (cached && cached.sig === sig) {
      // содержимое не изменилось — переносим готовые узлы, не пересобирая
      for (const node of cached.nodes) groupHost.appendChild(node);
      return;   // строка взята из кэша
    }
    const row = document.createElement("div");
    row.className = "layer-row" + (isActive ? " active" : "") +
                    (layer.locked ? " locked" : "");
    row.draggable = true;
    row.dataset.lid = layer.id;
    row.dataset.visible = String(layer.visible);
    row.dataset.modified = String(!!((layer.rules && layer.rules.length) || (layer.fmt && Object.keys(layer.fmt).length)));
    row.dataset.geometry = layer.geometry_type || "polygon";
    // Индикаторы кастомизации — чтобы сразу видеть, где нестандартное оформление
    let badges = "";
    if (layer.rules && layer.rules.length) {
      badges += `<span class="lrow-badge" title="условное форматирование: ${layer.rules.length} правил">правила</span>`;
    }
    if (layer.fmt && Object.keys(layer.fmt).length > 0) {
      badges += `<span class="lrow-badge" title="есть переопределения оформления слоя">стиль</span>`;
    }
    const layerTitle = escHtml(layer.title);
    const geometry = layerGeometryMeta(layer);
    const sourceLabel = layer.source_kind ? String(layer.source_kind).toUpperCase()
      : (layer.import_only ? "Данные" : "Проект");
    const discHtml = multiCat
      ? `<button type="button" class="layer-disc${catOpen ? " open" : ""}" aria-expanded="${catOpen}" aria-label="Показать знаки слоя «${layerTitle}» (${cats.length})" title="знаки слоя (${cats.length}) — раскрыть/свернуть">▸</button>`
      : `<span class="layer-disc-sp" aria-hidden="true"></span>`;
    row.innerHTML = `${discHtml}<span class="grip" aria-hidden="true" title="перетащить — порядок отрисовки"><svg class="ic"><use href="#ic-grip"/></svg></span>
      <label class="layer-vis-toggle" title="видимость слоя «${layerTitle}»"><input type="checkbox" aria-label="Показывать слой «${layerTitle}»" ${layer.visible ? "checked" : ""}><svg class="ic" aria-hidden="true"><use href="#ic-eye"/></svg></label>
      <button type="button" class="layer-select" aria-pressed="${isActive}"
        aria-label="Выбрать слой «${layerTitle}» для рисования"
        title="${layerTitle} — сделать активным слоем для рисования">
        <span class="sw-svg" aria-hidden="true">${swSvg}</span>
        <span class="layer-copy"><span class="layer-title-line"><span class="nm">${layerTitle}</span><span class="cnt">${count || ""}</span></span>
          <span class="layer-meta"><span class="layer-geometry"><svg class="ic"><use href="#${geometry.icon}"/></svg>${geometry.label}</span><span>${escHtml(sourceLabel)}</span>${badges}</span></span>
      </button>
      <button class="lrow-lock" aria-label="${layer.locked ? "Разблокировать" : "Заблокировать"} слой «${layerTitle}»" title="${layer.locked ? "разблокировать" : "заблокировать"} слой «${layerTitle}»">
        <svg class="ic"><use href="#${layer.locked ? "ic-lock" : "ic-unlock"}"/></svg></button>
      <button class="lrow-style" aria-label="Оформление слоя «${layerTitle}»" title="знак и оформление слоя «${layerTitle}»"><svg class="ic"><use href="#ic-format"/></svg></button>
      <button class="lrow-menu" aria-label="Действия со слоем «${layerTitle}»" title="действия со слоем «${layerTitle}»"><svg class="ic"><use href="#ic-menu-dots"/></svg></button>`;
    row.addEventListener("mouseenter", () => { state.hoverLayerId = layer.id; draw(); });
    row.addEventListener("mouseleave", () => { state.hoverLayerId = null; draw(); });
    row.querySelector(".lrow-lock").addEventListener("click", ev => {
      ev.stopPropagation(); toggleLayerLock(layer);
    });
    row.querySelector(".layer-vis-toggle input").addEventListener("change", ev => {
      snapshot();
      layer.visible = ev.target.checked;
      const sel = selectedFeature();
      if (!layer.visible && sel && layerOf(sel) === layer) {
        state.selected = null;
        renderProps();
      }
      state._ix = null; state._snapIndex = null;
      persist();
      draw();
      renderLayers();
    });
    // Отдельная кнопка делает выбор слоя доступным и мышью, и клавиатурой.
    // Чекбокс по-прежнему отвечает только за видимость.
    const selectButton = row.querySelector(".layer-select");
    const activateLayer = () => {
      setActiveLayer(layer.id);
      // setActiveLayer перерисовывает список. Возвращаем фокус на новую
      // кнопку той же строки, иначе после Enter/клика он проваливается в body.
      const freshRow = [...el.querySelectorAll(".layer-row")]
        .find(item => item.dataset.lid === layer.id);
      const freshButton = freshRow?.querySelector(".layer-select");
      if (freshButton && freshButton !== selectButton)
        freshButton.focus({ preventScroll: true });
    };
    selectButton.addEventListener("click", activateLayer);
    selectButton.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // Явная активация нужна и для браузеров/веб-вью, которые не порождают
      // click после синтетического клавиатурного события.
      event.preventDefault();
      activateLayer();
    });
    const menuBtn = row.querySelector(".lrow-menu");
    row.querySelector(".lrow-style").addEventListener("click", ev => {
      ev.stopPropagation();
      openLayerStyle(layer);
    });
    menuBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      openLayerMenu(layer, r.right, r.bottom);
    });
    row.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      openLayerMenu(layer, ev.clientX, ev.clientY);
    });
    // перетаскивание для смены порядка отрисовки
    row.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("text/plain", layer.id);
      ev.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      el.querySelectorAll(".layer-row").forEach(r =>
        r.classList.remove("drop-before", "drop-after"));
    });
    row.addEventListener("dragover", ev => {
      ev.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      row.classList.toggle("drop-before", before);
      row.classList.toggle("drop-after", !before);
    });
    row.addEventListener("dragleave", () =>
      row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", ev => {
      ev.preventDefault();
      const src = ev.dataTransfer.getData("text/plain");
      const rect = row.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      reorderLayer(src, layer.id, before);
    });
    const discBtn = row.querySelector(".layer-disc");
    if (discBtn) discBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      if (_catOpen.has(layer.id)) _catOpen.delete(layer.id); else _catOpen.add(layer.id);
      saveCatOpen();
      renderLayers();
    });
    groupHost.appendChild(row);
    const rowNodes = [row];
    // подпункты-категории (QGIS-легенда): образец знака + название + счётчик +
    // галка видимости (тот же fmt.cats_off). Скрытая категория — приглушена.
    if (catOpen) for (const cat of cats) {
      const visible = !((layer.fmt && layer.fmt.cats_off) || []).includes(cat.id);
      const cst = styleOf(cat.sample);
      const crow = document.createElement("div");
      crow.className = "layer-cat-row" + (visible ? "" : " cat-off");
      const catTitle = escHtml(cat.title);
      crow.innerHTML = `<input type="checkbox" ${visible ? "checked" : ""} aria-label="Показывать знак «${catTitle}» в слое «${layerTitle}»" title="видимость знака «${catTitle}»">
        <span class="sw-svg" aria-hidden="true">${styleSampleSVG(cst, { w: 34, h: 14 })}</span>
        <span class="nm" title="${catTitle}">${catTitle}</span><span class="cnt">${cat.count}</span>`;
      crow.querySelector("input").addEventListener("change", ev =>
        toggleCategoryVisible(layer, cat.id, ev.target.checked));
      groupHost.appendChild(crow);
      rowNodes.push(crow);
    }
    _layerRowCache.set(layer.id, { sig, nodes: rowNodes });
}

function initCollapsiblePanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;
  const sections = panel.querySelectorAll("section");
  // Восстанавливаем состояние из localStorage (простой ключ)
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem("grado_panel_collapsed") || "{}"); } catch(e){}

  // Разумные дефолты при первом запуске: фокус на черчении и ТЭП
  const defaultsCollapsed = ["Источники", "Параметры расчёта"];
  sections.forEach(sec => {
    const h = sec.querySelector("h3");
    if (!h) return;
    const key = h.textContent.trim();
    if (collapsed[key] === undefined && defaultsCollapsed.includes(key)) {
      collapsed[key] = true;
    }
    if (collapsed[key]) sec.classList.add("collapsed");

    h.addEventListener("click", (e) => {
      // не сворачивать если клик по кнопке внутри h3 (типа + или библиотека)
      if (e.target.closest("button")) return;
      sec.classList.toggle("collapsed");
      collapsed[key] = sec.classList.contains("collapsed");
      try { localStorage.setItem("grado_panel_collapsed", JSON.stringify(collapsed)); } catch(e){}
    });
  });
}

// ---------- справка «Горячие клавиши» (клавиша ?) -------------------------
// сгруппированный список — единственное полное место (строка-подсказка внизу
// физически вмещает лишь часть). Модификатор показываем по текущей ОС.
const modKeyLabel = key => `${/Mac|iPhone|iPad|iPod/.test(navigator.platform || "") ? "⌘" : "Ctrl+"}${key}`;
const SHORTCUTS = [
  ["Инструменты", [
    ["V", "Выбор и правка объектов"], ["A", "Дуга"],
    ["D", "Размерная линия"], ["M", "Измерение расстояния"],
    ["T", "Обрезать по границе"], ["E", "Продлить до границы"], ["J", "Склеить линии"],
  ]],
  ["Быстрый слой (создать/выбрать + чертить)", [
    ["G", "Граница территории"], ["Z", "Функциональная зона"], ["O", "Ограничение (ЗОУИТ)"],
    ["B", "Здание"], ["P", "Общественная зона"], ["L", "Красная линия"], ["S", "Соцобъект"],
  ]],
  ["Черчение", [
    ["A", "Дуга (3 точки)"],
    ["Shift", "Прямой угол (орто)"],
    ["50 ↵", "Длина отрезка вдоль курсора"],
    ["100 200 ↵", "Абсолютные координаты X Y"],
    ["50<30 ↵", "Полярно: длина < угол°"],
    ["Enter", "Завершить фигуру"], ["Esc", "Отменить действие"],
  ]],
  ["Правка объекта", [
    ["R", "Повернуть на 90°"], [modKeyLabel("D"), "Дубликат"], ["стрелки", "Сдвиг (с Shift — на 1 м)"],
    ["Delete", "Удалить"], ["двойной клик по ребру", "Добавить вершину"],
    ["Alt + клик по вершине", "Удалить вершину"],
  ]],
  ["Вид и привязки", [
    ["F", "Вписать всё в экран"], ["колесо мыши", "Масштаб"],
    ["пробел + тянуть", "Сдвинуть холст"], ["X", "Привязка к объектам"], ["C", "Привязка к сетке"],
    ["Y", "Общие границы: двигать соседние зоны вместе"],
  ]],
  ["История", [
    [modKeyLabel("Z"), "Отменить"], [modKeyLabel("Shift+Z"), "Вернуть"], ["?", "Эта справка"],
  ]],
  ["Проект", [
    [modKeyLabel("N"), "Новый проект"], [modKeyLabel("O"), "Открыть .grado"], [modKeyLabel("S"), "Сохранить .grado"],
  ]],
];
function openShortcuts() {
  closePopups();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const groups = SHORTCUTS.map(([title, rows]) => `
    <div class="sc-group"><div class="sc-group-title">${escHtml(title)}</div>
    ${rows.map(([k, d]) => `<div class="sc-row"><kbd>${escHtml(k)}</kbd><span>${escHtml(d)}</span></div>`).join("")}
    </div>`).join("");
  overlay.innerHTML = `<div class="modal fmt-modal-lg sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Справка</span><span id="sc-title">Горячие клавиши</span></div>
      <button class="modal-x" aria-label="Закрыть горячие клавиши"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body sc-body">${groups}</div>
    <div class="modal-actions"><span class="spacer"></span>
      <button class="primary" id="sc-close">Понятно</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", ev => ev.stopPropagation());
  const close = () => overlay.remove();
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.querySelector("#sc-close").addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
}

// ---------- контекстное меню слоя (логика QGIS) ----------
// Докированное окно НЕ всплывашка: оно часть раскладки, как панель слоёв, и
// закрывается только своей кнопкой или крестиком дока. Раньше closePopups
// сметал и его: открыл таблицу атрибутов в доке, нажал в ней «Статистика
// поля» — статистика зовёт closePopups, и таблица исчезала вместе с доком,
// хотя человек всего лишь заглянул в её же подокно.
function closePopups() {
  // Счётчик вызовов виден доку. Кнопки «Применить», «Отмена», крестик окна —
  // все закрывают окно ИМЕННО через closePopups, и перечислять их по одной
  // значит забыть очередную: «Применить стиль» так и осталось незакрытым.
  // Док смотрит, вырос ли счётчик после клика внутри него, и убирает окно.
  window.__closePopupsCalls = (window.__closePopupsCalls || 0) + 1;
  document.querySelectorAll(".ctx-menu, .modal-overlay:not(.docked)").forEach(n => n.remove());
}

// ---------- единый контракт окон: Escape и клик мимо ----------
// Каждое окно раньше заводило закрытие само, и 18 из 40 его не завели: одни
// не закрывались Escape, другие — кликом мимо. Чинить по одному значит
// воспроизвести беду на следующем окне, поэтому контракт живёт здесь и
// действует на всё, включая окна, которые ещё не написаны.
//
// Закрываем НЕ удалением узла, а нажатием собственной кнопки закрытия окна:
// тогда отрабатывает его собственная уборка — снимается предпросмотр, стиль
// откатывается к исходному, рамка листа перестаёт рисоваться. Удаление —
// только если у окна кнопки нет.
function dismissOverlay(overlay) {
  if (!overlay || !overlay.isConnected) return false;
  const byText = [...overlay.querySelectorAll(".modal-actions button")]
    .find(button => /^(отмена|закрыть)/i.test(button.textContent.trim()));
  const button = overlay.querySelector(".modal-x") || byText;
  if (button) button.click(); else overlay.remove();
  return true;
}
// Докированное окно стоит СБОКУ, а не поверх: холст рядом с ним виден и
// кликабелен, и «верхним окном» оно не является. Закрывает его док своим
// способом (dock.js) — он умеет то, чего здесь нет: окно, закрывающееся
// через closePopups, тот не трогает, и док убирает его сам.
function topOverlay() {
  const all = document.querySelectorAll(".modal-overlay:not(.docked)");
  return all.length ? all[all.length - 1] : null;
}
// Escape — в фазе перехвата: окно поверх всего, и пока оно открыто, Escape
// принадлежит ему, а не холсту (иначе он отменял бы черчение за спиной окна)
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const overlay = topOverlay();
  if (!overlay) {
    const menu = document.querySelector(".ctx-menu");
    if (!menu) return;                      // окон нет — Escape уходит холсту
    menu.remove();
  } else if (!dismissOverlay(overlay)) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
// клик мимо окна — в фазе всплытия: если окно закрылось само своим
// обработчиком, наш увидит уже отсоединённый узел и промолчит
document.addEventListener("click", event => {
  const overlay = event.target.classList && event.target.classList.contains("modal-overlay")
    ? event.target : null;
  if (overlay) dismissOverlay(overlay);
});
// ---------- совмещение слоя: сдвиг по двум точкам ----------
// Источники расходятся между собой на метры (ЕГРН ↔ ОСМ ↔ пересчёт портала
// из МСК Москвы — наш замер: медианно ~4.8 м по центру города; конвейер
// сверен с pyproj до миллиметра). Когда выгрузки надо посадить друг на
// друга, слой двигают целиком: клик по опорной точке слоя, клик по месту,
// где она должна оказаться, — все объекты слоя едут на этот вектор.
function shiftLayerFeatures(layerId, dx, dy) {
  let moved = 0;
  for (const f of state.features) {
    const L = layerOf(f);
    if (!L || L.id !== layerId) continue;
    if (f.circle) { f.circle.cx += dx; f.circle.cy += dy; }
    else if (f.arc) { f.arc.cx += dx; f.arc.cy += dy; }
    else for (const p of featureMovablePts(f)) { p[0] += dx; p[1] += dy; }
    moved += 1;
  }
  return moved;
}
function startLayerAlign(layer) {
  state.layerAlign = { layerId: layer.id, title: layer.title, a: null };
  setTool("layeralign");
  toast(`Совмещение «${layer.title}»: кликните опорную точку слоя (привязка работает), затем — куда её посадить. Esc — отмена`);
}

function openLayerMenu(layer, x, y) {
  closePopups();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  const displayed = layerRowsTopFirst();
  const displayIndex = displayed.indexOf(layer);
  const items = [
    ["Сделать активным", () => setActiveLayer(layer.id)],
    ["Таблица атрибутов…", () => openAttributeTable(layer)],
    ["Присоединить таблицу…", () => window.openJoinTable && window.openJoinTable(layer)],
    ["Выгрузить слой (GeoJSON + QML)", () => window.exportLayerFiles && window.exportLayerFiles(layer, "both")],
    ["Выгрузить только стиль (QML)", () => window.exportLayerFiles && window.exportLayerFiles(layer, "qml")],
    ["Оформление слоя…", () => openLayerStyle(layer)],
    ["Приблизить к слою", () => zoomToLayer(layer.id)],
    ["Совместить слой (сдвиг по двум точкам)…", () => startLayerAlign(layer)],
    ...(displayIndex > 0 ? [["Переместить выше", () =>
      reorderLayer(layer.id, displayed[displayIndex - 1].id, true)]] : []),
    ...(displayIndex >= 0 && displayIndex < displayed.length - 1
      ? [["Переместить ниже", () =>
        reorderLayer(layer.id, displayed[displayIndex + 1].id, false)]] : []),
    ["Переименовать…", () => renameLayer(layer)],
    [layer.locked ? "Разблокировать слой" : "Заблокировать слой", () => toggleLayerLock(layer)],
    ["Сбросить оформление слоя", () => resetLayerFormatting(layer)],
    ["Применить стиль слоя ко всем объектам", () => applyLayerStyleToObjects(layer)],
  ];
  for (const [label, fn] of items) {
    const it = document.createElement("div");
    it.className = "ctx-item";
    it.textContent = label;
    it.addEventListener("click", ev => { ev.stopPropagation(); closePopups(); fn(); });
    menu.appendChild(it);
  }
  const del = document.createElement("div");
  del.className = "ctx-item danger";
  del.textContent = "Удалить слой…";
  del.addEventListener("click", ev => { ev.stopPropagation(); closePopups(); deleteLayer(layer); });
  menu.appendChild(del);
  document.body.appendChild(menu);
  // не вылезать за правый/нижний край
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 6) + "px";
  menu.style.top = Math.min(y, window.innerHeight - mh - 6) + "px";
  setTimeout(() => document.addEventListener("click", closePopups, { once: true }), 0);
}

function resetLayerFormatting(layer) {
  closePopups();
  snapshot();
  delete layer.fmt;
  delete layer.rules;
  // также сбрасываем per-object fmt на объектах этого слоя (style_id оставляем — это может быть классификация)
  const objs = featuresOnLayer(layer.id);
  for (const f of objs) {
    delete f.fmt;
  }
  renderLayers(); draw(); persist();
  toast(`Оформление слоя «${layer.title}» сброшено`);
}

function applyLayerStyleToObjects(layer) {
  // Гибкость: быстро привести все объекты слоя к текущему стилю слоя (очищает per-object переопределения)
  closePopups();
  const objs = featuresOnLayer(layer.id);
  if (!objs.length) { toast("В слое нет объектов"); return; }
  snapshot();
  for (const f of objs) {
    delete f.style_id;
    delete f.fmt;
  }
  renderLayers(); draw(); persist();
  toast(`Стиль слоя применён к ${objs.length} объектам`);
}

