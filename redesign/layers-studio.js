(function () {
  const root = document.body;
  const stackTab = document.getElementById('layers-view-stack');
  const legendTab = document.getElementById('layers-view-legend');
  const stackView = document.getElementById('layers-stack-view');
  const legendView = document.getElementById('layers-legend-view');
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
    // раскрывается сразу под кнопкой при любой раскладке панели
    menu.style.top = `${createButton.offsetTop + createButton.offsetHeight + 6}px`;
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

  // (помощники каталога знаков — styleBucket, bucketLabel, geometryLabel,
  //  styleCountLabel — удалены вместе с недостижимым каталогом.)

  window.enhanceLayerStyleStudio = overlay => {
    if (!overlay || overlay.dataset.studioEnhanced === 'true') return;
    overlay.dataset.studioEnhanced = 'true';
    overlay.classList.add('layer-style-overlay');
    const modal = overlay.querySelector('.style-editor-modal');
    const grid = overlay.querySelector('.style-editor-grid');
    const preset = overlay.querySelector('#fmt-preset');
    if (!modal || !grid || !preset) return;
    modal.classList.add('layer-style-studio');

    const head = modal.querySelector('.modal-head');
    const mode = modal.querySelector('#ls-mode');
    const controls = grid.querySelector('.style-controls');
    const categories = modal.querySelector('#fmt-cats')?.closest('.style-categories-section');
    if (head && mode) head.insertBefore(mode, head.querySelector('.modal-x'));
    // Базовый знак остаётся там, где стоит в разметке — под предпросмотром.
    // Раньше его переносили сюда, первой строкой прокручиваемой колонки: знак
    // и его вид оказывались в разных концах окна, справа не влезало вдвое, а
    // слева пустовало 336px из 618.
    if (controls && categories) controls.prepend(categories);

    // Каталог знаков живёт в панели проекта, а здесь достаточно компактного
    // выбора базового знака. Полторы сотни строк каталога стояли ниже
    // безусловного `return` — недостижимые с самого появления: они не
    // выполнялись ни разу, но исправно попадали в загрузку и в поиск по коду.
  };
})();
