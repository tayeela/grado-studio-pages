/* Доступность динамических окон и меню нового интерфейса. */
(function () {
  const previousFocus = new WeakMap();
  let dialogSeq = 0;
  let lastTrigger = null;

  const visible = el => !!el && !el.hidden && el.getClientRects().length > 0;
  const focusables = root => [...root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(visible);

  function labelIconButtons(root = document) {
    root.querySelectorAll('button[title]:not([aria-label])').forEach(button => {
      if (!(button.textContent || '').trim()) button.setAttribute('aria-label', button.title);
    });
  }

  function prepareDialog(overlay) {
    if (overlay.dataset.a11yReady) return;
    const dialog = overlay.querySelector('.modal');
    if (!dialog) return;
    overlay.dataset.a11yReady = 'true';
    const active = document.activeElement;
    previousFocus.set(overlay, overlay.contains(active) && lastTrigger?.isConnected ? lastTrigger : active);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;

    const heading = dialog.querySelector('.modal-head');
    if (heading) {
      if (!heading.id) heading.id = `dialog-title-${++dialogSeq}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    } else if (!dialog.hasAttribute('aria-label')) {
      const message = dialog.querySelector('.ask-msg');
      dialog.setAttribute('aria-label', (message && message.textContent.trim()) || 'Диалоговое окно');
    }

    labelIconButtons(dialog);
    queueMicrotask(() => {
      if (!overlay.isConnected) return;
      if (overlay.contains(document.activeElement) && document.activeElement !== dialog) return;
      const target = dialog.querySelector('[autofocus]')
        || dialog.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
        || dialog.querySelector('button.primary:not([disabled])')
        || dialog.querySelector('button:not(.modal-x):not([disabled])');
      (target || dialog).focus({ preventScroll: true });
      if (target && target.tagName === 'INPUT' && target.type === 'text') target.select?.();
    });
  }

  function prepareContextMenu(menu) {
    if (menu.dataset.a11yReady) return;
    menu.dataset.a11yReady = 'true';
    menu.setAttribute('role', 'menu');
    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    });
    queueMicrotask(() => menu.querySelector('.ctx-item')?.focus());
  }

  function closeDialog(overlay) {
    const close = overlay.querySelector(
      '.modal-x, .ask-cancel, [id$="-cancel"], [id$="-close"], #sc-close'
    );
    if (close) close.click();
    else overlay.click();
  }

  function restoreRemovedFocus(node) {
    if (!(node instanceof Element)) return;
    const overlays = node.matches('.modal-overlay') ? [node] : [...node.querySelectorAll('.modal-overlay')];
    for (const overlay of overlays) {
      const previous = previousFocus.get(overlay);
      if (previous && previous.isConnected) queueMicrotask(() => previous.focus());
    }
  }

  function syncPopupState() {
    document.querySelectorAll('[data-menu]').forEach(button => {
      const popup = document.getElementById(button.dataset.menu);
      button.setAttribute('aria-expanded', String(visible(popup)));
    });
    document.querySelectorAll('[data-pop]').forEach(button => {
      const popup = document.getElementById(button.dataset.pop);
      button.setAttribute('aria-expanded', String(visible(popup)));
    });
    document.querySelectorAll('.menu [role="menuitemradio"]').forEach(item =>
      item.setAttribute('aria-checked', String(item.classList.contains('on'))));
  }

  function moveMenuFocus(menu, direction) {
    const items = [...menu.querySelectorAll('[role^="menuitem"]')].filter(visible);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
    items[next].focus();
  }

  labelIconButtons();
  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('button, [role^="menuitem"], a[href]');
    if (trigger && visible(trigger)) lastTrigger = trigger;
  }, true);
  document.querySelectorAll('.modal-overlay').forEach(prepareDialog);
  document.querySelectorAll('.ctx-menu').forEach(prepareContextMenu);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') continue;
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.modal-overlay')) prepareDialog(node);
        node.querySelectorAll?.('.modal-overlay').forEach(prepareDialog);
        if (node.matches('.ctx-menu')) prepareContextMenu(node);
        node.querySelectorAll?.('.ctx-menu').forEach(prepareContextMenu);
        labelIconButtons(node);
      });
      record.removedNodes.forEach(restoreRemovedFocus);
    }
    syncPopupState();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  syncPopupState();

  document.querySelectorAll('[data-menu], [data-pop]').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => {
      syncPopupState();
      const id = button.dataset.menu || button.dataset.pop;
      const popup = document.getElementById(id);
      if (!visible(popup)) return;
      const target = popup.querySelector('[role^="menuitem"], input, select, button');
      target?.focus();
    }));
  });

  document.addEventListener('keydown', event => {
    const overlays = [...document.querySelectorAll('.modal-overlay')].filter(visible);
    const topOverlay = overlays[overlays.length - 1];
    if (topOverlay) {
      const dialog = topOverlay.querySelector('.modal');
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDialog(topOverlay);
        return;
      }
      if (event.key === 'Tab' && dialog) {
        const items = focusables(dialog);
        if (!items.length) { event.preventDefault(); dialog.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }

    const menu = document.activeElement?.closest?.('.menu, .ctx-menu');
    if (menu && visible(menu)) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveMenuFocus(menu, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveMenuFocus(menu, -1); }
      else if (event.key === 'Home') { event.preventDefault(); menu.querySelector('[role^="menuitem"]')?.focus(); }
      else if (event.key === 'End') {
        event.preventDefault();
        [...menu.querySelectorAll('[role^="menuitem"]')].filter(visible).at(-1)?.focus();
      }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); }
      else if (event.key === 'Escape') {
        event.preventDefault();
        const trigger = document.querySelector(`[aria-controls="${menu.id}"]`);
        if (menu.classList.contains('ctx-menu')) menu.remove(); else menu.hidden = true;
        syncPopupState();
        trigger?.focus();
      }
    }
  }, true);
})();
