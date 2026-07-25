(function () {
  const root = document.body;
  const modeButtons = [...document.querySelectorAll('[data-workspace-mode]')];
  const layerPanel = document.getElementById('layers-panel');
  const layerToggle = document.getElementById('btn-layers-visibility');
  const layerSearch = document.getElementById('layer-search-input');
  const layersBody = document.getElementById('layers-body');
  const layerFilterButtons = [...document.querySelectorAll('[data-layer-filter]')];
  const layerSearchEmpty = document.getElementById('layer-search-empty');
  const layerSearchReset = document.getElementById('layer-search-reset');
  const layersCard = document.getElementById('card-layers');
  const compactLayers = matchMedia('(max-width: 980px)');

  const setMode = mode => {
    const next = ['draw', 'edit', 'geo', 'measure'].includes(mode) ? mode : 'draw';
    root.dataset.workspaceMode = next;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === next)));
    try { localStorage.setItem('grado_workspace_mode', next); } catch (_) {}
  };

  // Раскладка «инструмент → режим» берётся из разметки, а не переписывается
  // здесь списком: два списка расходятся, один — нет.
  const modeOfTool = new Map(
    [...document.querySelectorAll('#toolbar [data-tool][data-workspace-tool]')]
      .map(button => [button.dataset.tool, button.dataset.workspaceTool]));
  // `state` объявлен через const в app-sources.js: он живёт в общей области
  // обычных скриптов, но на window НЕ попадает — только typeof-проверка.
  const currentTool = () => (typeof state !== 'undefined' && state.tool) || null;

  // Переключили режим, а включённый инструмент принадлежит покинутому —
  // его кнопка исчезла, но клик по чертежу всё ещё чертит. Возвращаем «Выбор».
  modeButtons.forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.workspaceMode;
    setMode(next);
    const tool = currentTool();
    const owner = modeOfTool.get(tool);
    if (owner && owner !== next && typeof window.setTool === 'function') window.setTool('select');
  }));

  // Обратная сторона: инструмент включили горячей клавишей или кнопкой из
  // панели свойств — режим переходит туда, где эта кнопка видна.
  document.addEventListener('grado:tool', event => {
    const owner = modeOfTool.get(event.detail && event.detail.tool);
    if (owner && owner !== root.dataset.workspaceMode) setMode(owner);
  });

  let savedMode = 'draw';
  try { savedMode = localStorage.getItem('grado_workspace_mode') || savedMode; } catch (_) {}
  setMode(savedMode);

  const setLayersHidden = hidden => {
    root.classList.toggle('layers-panel-hidden', hidden);
    layerToggle?.setAttribute('aria-expanded', String(!hidden));
    if (layerToggle) layerToggle.setAttribute('aria-label', hidden ? 'Показать панель слоёв' : 'Скрыть панель слоёв');
    try { localStorage.setItem('grado_layers_panel_hidden', hidden ? '1' : '0'); } catch (_) {}
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };

  let savedLayers = null;
  try { savedLayers = localStorage.getItem('grado_layers_panel_hidden'); } catch (_) {}
  setLayersHidden(savedLayers === null ? compactLayers.matches : savedLayers === '1');
  layerToggle?.addEventListener('click', () => setLayersHidden(!root.classList.contains('layers-panel-hidden')));

  let layerFilter = 'all';
  try {
    const saved = localStorage.getItem('grado_layer_filter');
    if (['all', 'visible', 'hidden', 'modified'].includes(saved)) layerFilter = saved;
  } catch (_) {}

  const filterLayers = () => {
    if (!layersBody) return;
    const query = (layerSearch?.value || '').trim().toLocaleLowerCase('ru');
    const rows = [...layersBody.querySelectorAll('.layer-row')];
    const counts = {
      all: rows.length,
      visible: rows.filter(row => row.dataset.visible === 'true').length,
      hidden: rows.filter(row => row.dataset.visible === 'false').length,
      modified: rows.filter(row => row.dataset.modified === 'true').length,
    };
    rows.forEach(row => {
      const hitQuery = !query || row.textContent.toLocaleLowerCase('ru').includes(query);
      const hitFilter = layerFilter === 'all'
        || (layerFilter === 'visible' && row.dataset.visible === 'true')
        || (layerFilter === 'hidden' && row.dataset.visible === 'false')
        || (layerFilter === 'modified' && row.dataset.modified === 'true');
      row.hidden = !(hitQuery && hitFilter);
    });
    let shown = 0;
    layersBody.querySelectorAll('.layer-stack-group').forEach(group => {
      const groupRows = [...group.querySelectorAll('.layer-row')];
      const visibleRows = groupRows.filter(row => !row.hidden).length;
      shown += visibleRows;
      group.hidden = visibleRows === 0;
      const count = group.querySelector('.layer-group-count');
      if (count) count.textContent = query || layerFilter !== 'all'
        ? `${visibleRows}/${groupRows.length}` : String(groupRows.length);
    });
    if (layerSearchEmpty) {
      layerSearchEmpty.hidden = shown > 0;
      // девственно пустой проект — не «слои не найдены по фильтру», а
      // приглашение начать: прежний текст выглядел сломанным поиском
      const pristine = rows.length === 0 && !query && layerFilter === 'all';
      layerSearchEmpty.classList.toggle('pristine', pristine);
      const strongEl = layerSearchEmpty.querySelector('strong');
      const hintEl = layerSearchEmpty.querySelector('span');
      const resetEl = document.getElementById('layer-search-reset');
      if (strongEl) strongEl.textContent = pristine ? 'Слоёв пока нет' : 'Слои не найдены';
      if (hintEl) hintEl.textContent = pristine
        ? 'Создайте слой или перетащите файлы: SHP, MapInfo TAB, MIF, GeoJSON.'
        : 'Измените запрос или фильтр.';
      if (resetEl) resetEl.textContent = pristine ? 'Создать слой' : 'Сбросить фильтры';
    }
    if (layersCard) layersCard.hidden = shown === 0;
    layerFilterButtons.forEach(button => {
      const active = button.dataset.layerFilter === layerFilter;
      button.setAttribute('aria-pressed', String(active));
      const count = button.querySelector('[data-layer-filter-count]');
      if (count) count.textContent = String(counts[button.dataset.layerFilter] || 0);
    });
  };
  window.refreshLayerFilters = filterLayers;
  layerSearch?.addEventListener('input', filterLayers);
  layerSearch?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (layerSearch.value) {
      event.stopPropagation();
      layerSearch.value = '';
      filterLayers();
    } else {
      layerSearch.blur();
    }
  });
  layerFilterButtons.forEach(button => button.addEventListener('click', () => {
    layerFilter = button.dataset.layerFilter || 'all';
    try { localStorage.setItem('grado_layer_filter', layerFilter); } catch (_) {}
    filterLayers();
  }));
  layerSearchReset?.addEventListener('click', event => {
    if (layerSearchEmpty?.classList.contains('pristine')) {
      // не дать этому же клику всплыть до document и закрыть только что
      // открытое меню создания
      event.stopPropagation();
      document.getElementById('btn-layer-create-menu')?.click();
      return;
    }
    if (layerSearch) layerSearch.value = '';
    layerFilter = 'all';
    try { localStorage.setItem('grado_layer_filter', layerFilter); } catch (_) {}
    filterLayers();
    layerSearch?.focus();
  });
  if (layersBody) new MutationObserver(filterLayers).observe(layersBody, { childList: true });
  filterLayers();

  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    event.preventDefault();
    if (root.classList.contains('layers-panel-hidden')) setLayersHidden(false);
    requestAnimationFrame(() => layerSearch?.focus());
  });

  compactLayers.addEventListener?.('change', event => {
    if (event.matches) setLayersHidden(true);
  });

  layerPanel?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && compactLayers.matches) setLayersHidden(true);
  });

  // Подписи режимов схлопываются ПО МЕСТУ, а не по ширине окна.
  //
  // Порог был задан медиазапросом на 1400px, и он не знал ни про длину имени
  // проекта, ни про другой язык интерфейса: при длинном имени последняя вкладка
  // молча обрезалась (у полосы стоял overflow:hidden) — человек видел
  // «Измере…», наезжающее на поиск. Теперь меряем: если шапка не помещается,
  // подписи гаснут, кроме активной; освободилось место — возвращаются.
  const header = document.querySelector('header');
  const modes = document.querySelector('.workspace-modes');
  if (header && modes) {
    let ждём = false;
    const подогнать = () => {
      ждём = false;
      // сначала пробуем в полном виде — иначе однажды схлопнувшись, шапка
      // осталась бы такой навсегда: в узком виде она всегда помещается
      header.classList.remove('modes-compact');
      if (header.scrollWidth > header.clientWidth + 1) header.classList.add('modes-compact');
    };
    const запросить = () => { if (ждём) return; ждём = true; requestAnimationFrame(подогнать); };
    // Наблюдать ОДНУ шапку недостаточно: её ширина равна окну и не меняется,
    // когда переполняется содержимое. Поэтому смотрим за тем, что растёт, —
    // полосой режимов и именем проекта.
    if (typeof ResizeObserver === 'function') {
      const наблюдатель = new ResizeObserver(запросить);
      [header, modes, document.getElementById('project-name')].forEach(el => el && наблюдатель.observe(el));
    }
    window.addEventListener('resize', запросить);
    // На ввод имени пересчитываем сразу: событий немного, копить нечего, а
    // через кадр это не проверить в фоновой вкладке — там кадров нет.
    document.getElementById('project-name')?.addEventListener('input', подогнать);
    // Шрифты приходят позже разметки и делают надписи шире: без этого шапка
    // мерилась по запасному шрифту и переполнялась уже после проверки.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(подогнать).catch(() => {});
    // Первую подгонку делаем СРАЗУ, а не по кадру: в фоновой вкладке кадры не
    // идут вовсе, и шапка осталась бы неподогнанной до первого показа.
    подогнать();
    setTimeout(подогнать, 0);          // после того, как разметка встала целиком
  }
})();
