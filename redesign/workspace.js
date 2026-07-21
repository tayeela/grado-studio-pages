(function () {
  const root = document.body;
  const modeButtons = [...document.querySelectorAll('[data-workspace-mode]')];
  const layerPanel = document.getElementById('layers-panel');
  const layerToggle = document.getElementById('btn-layers-visibility');
  const layerSearch = document.getElementById('layer-search-input');
  const layersBody = document.getElementById('layers-body');
  const compactLayers = matchMedia('(max-width: 980px)');

  const setMode = mode => {
    const next = ['draw', 'edit', 'geo', 'measure'].includes(mode) ? mode : 'draw';
    root.dataset.workspaceMode = next;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === next)));
    try { localStorage.setItem('grado_workspace_mode', next); } catch (_) {}
  };

  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.workspaceMode)));
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

  const filterLayers = () => {
    if (!layersBody) return;
    const query = (layerSearch?.value || '').trim().toLocaleLowerCase('ru');
    layersBody.querySelectorAll('.layer-row').forEach(row => {
      row.hidden = !!query && !row.textContent.toLocaleLowerCase('ru').includes(query);
    });
  };
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
  if (layersBody) new MutationObserver(filterLayers).observe(layersBody, { childList: true });

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
})();
