(function () {
  const root = document.body;
  const stackTab = document.getElementById('layers-view-stack');
  const legendTab = document.getElementById('layers-view-legend');
  const stackView = document.getElementById('layers-stack-view');
  const legendView = document.getElementById('layers-legend-view');
  const search = document.getElementById('layer-search-input');
  const createButton = document.getElementById('btn-layer-create-menu');

  const setLayerView = view => {
    const next = view === 'legend' ? 'legend' : 'stack';
    root.dataset.layerView = next;
    stackTab?.setAttribute('aria-selected', String(next === 'stack'));
    legendTab?.setAttribute('aria-selected', String(next === 'legend'));
    if (stackView) stackView.hidden = next !== 'stack';
    if (legendView) legendView.hidden = next !== 'legend';
    if (next === 'legend' && typeof renderLayerLegend === 'function') renderLayerLegend();
    try { localStorage.setItem('grado_layer_view', next); } catch (_) {}
  };

  stackTab?.addEventListener('click', () => setLayerView('stack'));
  legendTab?.addEventListener('click', () => setLayerView('legend'));
  [stackTab, legendTab].forEach((tab, index, tabs) => tab?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    tabs[index ? 0 : 1]?.focus();
    tabs[index ? 0 : 1]?.click();
  }));
  let savedLayerView = 'stack';
  try { savedLayerView = localStorage.getItem('grado_layer_view') || savedLayerView; } catch (_) {}
  setLayerView(savedLayerView);

  const closeCreateMenu = () => {
    document.querySelector('.layer-create-menu')?.remove();
    createButton?.setAttribute('aria-expanded', 'false');
  };
  createButton?.addEventListener('click', event => {
    event.stopPropagation();
    if (document.querySelector('.layer-create-menu')) return closeCreateMenu();
    const menu = document.createElement('div');
    menu.className = 'layer-create-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button type="button" role="menuitem" data-create="layer"><svg class="ic"><use href="#i-layers"/></svg><span><b>Новый слой</b><small>Выбрать геометрию и назначение</small></span></button>
      <button type="button" role="menuitem" data-create="project-style"><svg class="ic"><use href="#ic-label"/></svg><span><b>Пользовательский знак</b><small>Хранится только в этом проекте</small></span></button>
      <button type="button" role="menuitem" data-create="library"><svg class="ic"><use href="#ic-format"/></svg><span><b>Библиотека стандартов</b><small>ЛГР, ЗОУИТ, Генплан и ОКН</small></span></button>`;
    createButton.insertAdjacentElement('afterend', menu);
    createButton.setAttribute('aria-expanded', 'true');
    const actions = {
      layer: () => document.getElementById('btn-new-layer')?.click(),
      'project-style': () => document.getElementById('btn-project-styles')?.click(),
      library: () => document.getElementById('btn-style-lib')?.click(),
    };
    menu.querySelectorAll('[data-create]').forEach(button => button.addEventListener('click', () => {
      const action = actions[button.dataset.create];
      closeCreateMenu();
      action?.();
    }));
    menu.querySelector('button')?.focus();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.layer-create-menu') && event.target !== createButton) closeCreateMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCreateMenu(); });

  // Поиск в представлении слоёв также скрывает пустые семантические группы.
  search?.addEventListener('input', () => requestAnimationFrame(() => {
    document.querySelectorAll('.layer-stack-group').forEach(group => {
      const rows = [...group.querySelectorAll('.layer-row')];
      group.hidden = rows.length > 0 && rows.every(row => row.hidden);
    });
  }));

  const styleBucket = (group, scope) => {
    if (scope === 'project') return 'project';
    const value = String(group || '').toLocaleLowerCase('ru');
    if (/зоуит|охран|санитар|затоп|огранич/.test(value)) return 'zouit';
    if (/генплан|функцион|москва|химки/.test(value)) return 'general';
    if (/красн|лгр|линейн/.test(value)) return 'lgr';
    return 'base';
  };
  const bucketLabel = { all: 'Все', base: 'Базовые', lgr: 'ЛГР', zouit: 'ЗОУИТ', general: 'Генплан', project: 'Пользовательские' };
  const geometryLabel = style => {
    if (style?.line_marker || (!style?.fill && !style?.hatch)) return 'Линия';
    return 'Полигон';
  };

  window.enhanceLayerStyleStudio = (overlay, layer) => {
    if (!overlay || overlay.dataset.studioEnhanced === 'true') return;
    overlay.dataset.studioEnhanced = 'true';
    overlay.classList.add('layer-style-overlay');
    const modal = overlay.querySelector('.style-editor-modal');
    const grid = overlay.querySelector('.style-editor-grid');
    const preset = overlay.querySelector('#fmt-preset');
    if (!modal || !grid || !preset) return;
    modal.classList.add('layer-style-studio');

    const panel = document.createElement('aside');
    panel.className = 'style-library-panel';
    panel.setAttribute('aria-label', 'Каталог знаков');
    panel.innerHTML = `<div class="style-library-head"><span><b>Стандарт и библиотека</b><small>Выберите знак для слоя</small></span>
        <button type="button" class="style-library-expand" title="Открыть редактор эталонных знаков" aria-label="Открыть библиотеку знаков"><svg class="ic"><use href="#ic-format"/></svg></button></div>
      <label class="style-library-search"><svg class="ic"><use href="#i-search"/></svg><input type="search" placeholder="Поиск по названию или ID" autocomplete="off"></label>
      <div class="style-library-tabs" role="tablist" aria-label="Стандарты знаков"></div>
      <div class="style-library-list" role="listbox" aria-label="Знаки"></div>
      <button type="button" class="style-create-custom"><svg class="ic"><use href="#ic-plus"/></svg>Создать пользовательский знак</button>`;
    grid.appendChild(panel);

    const bucketOrder = { base: 0, lgr: 1, zouit: 2, general: 3, project: 4 };
    const allStyles = () => [
      ...Object.entries(STYLES_V2).filter(([, style]) => style.title).map(([id, style]) => ({ id, style, scope: 'system' })),
      ...Object.entries(state.projectStyles || {}).map(([id, style]) => ({ id, style, scope: 'project' })),
    ].sort((a, b) => {
      const bucketDiff = bucketOrder[styleBucket(a.style.group, a.scope)] - bucketOrder[styleBucket(b.style.group, b.scope)];
      return bucketDiff || String(a.style.title || a.id).localeCompare(String(b.style.title || b.id), 'ru');
    });
    let bucket = 'all';
    let query = '';
    let favorites = [];
    try { favorites = JSON.parse(localStorage.getItem('grado_style_favorites') || '[]'); } catch (_) {}
    const favoriteSet = new Set(favorites);
    const tabs = panel.querySelector('.style-library-tabs');
    Object.entries(bucketLabel).forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.dataset.bucket = key;
      button.textContent = label;
      button.addEventListener('click', () => { bucket = key; render(); });
      tabs.appendChild(button);
    });
    const list = panel.querySelector('.style-library-list');
    const render = () => {
      tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.bucket === bucket)));
      const low = query.trim().toLocaleLowerCase('ru');
      const selected = preset.value;
      const filtered = allStyles().filter(item => {
        const itemBucket = styleBucket(item.style.group, item.scope);
        const hitBucket = bucket === 'all' || itemBucket === bucket;
        const haystack = `${item.style.title || ''} ${item.id} ${item.style.group || ''}`.toLocaleLowerCase('ru');
        return hitBucket && (!low || haystack.includes(low));
      });
      list.innerHTML = '';
      if (!filtered.length) {
        list.innerHTML = '<div class="style-library-empty">Знаки не найдены. Измените запрос или выберите другой стандарт.</div>';
        return;
      }
      filtered.forEach(item => {
        const row = document.createElement('div');
        row.className = 'style-library-row' + (item.id === selected ? ' active' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(item.id === selected));
        row.innerHTML = `<button type="button" class="style-library-choice">
            <span class="style-library-sample" aria-hidden="true">${styleSampleSVG(item.style, { w: 66, h: 24 })}</span>
            <span class="style-library-copy"><b>${escHtml(item.style.title || item.id)}</b><small>${escHtml(item.style.group || (item.scope === 'project' ? 'Этот проект' : 'Базовые'))} · ${geometryLabel(item.style)}</small></span>
          </button><button type="button" class="style-favorite${favoriteSet.has(item.id) ? ' on' : ''}" aria-label="${favoriteSet.has(item.id) ? 'Убрать из избранного' : 'Добавить в избранное'}" title="Избранное"><svg class="ic"><use href="#ic-label"/></svg></button>`;
        row.querySelector('.style-library-choice').addEventListener('click', () => {
          preset.value = item.id;
          preset.dispatchEvent(new Event('change', { bubbles: true }));
          requestAnimationFrame(render);
        });
        row.querySelector('.style-favorite').addEventListener('click', () => {
          if (favoriteSet.has(item.id)) favoriteSet.delete(item.id); else favoriteSet.add(item.id);
          try { localStorage.setItem('grado_style_favorites', JSON.stringify([...favoriteSet])); } catch (_) {}
          render();
        });
        list.appendChild(row);
      });
    };
    panel.querySelector('input').addEventListener('input', event => { query = event.target.value; render(); });
    panel.querySelector('.style-library-expand').addEventListener('click', () => document.getElementById('btn-style-lib')?.click());
    panel.querySelector('.style-create-custom').addEventListener('click', async () => {
      const newId = await createProjectStyle();
      if (!newId) return;
      preset.innerHTML = stylePickerOptions(newId);
      preset.value = newId;
      preset.dispatchEvent(new Event('change', { bubbles: true }));
      bucket = 'project';
      render();
    });
    preset.addEventListener('change', () => requestAnimationFrame(render));
    render();
  };
})();
