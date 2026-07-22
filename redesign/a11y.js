/* Доступность динамических окон и меню нового интерфейса. */
(function () {
  const previousFocus = new WeakMap();
  let dialogSeq = 0;
  let lastTrigger = null;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

  document.querySelectorAll('[data-mod-key]').forEach(el => {
    el.textContent = `${isMac ? '⌘' : 'Ctrl+'}${el.dataset.modKey}`;
  });
  const titleShortcuts = [
    ['btn-undo', 'Отменить', 'Z'], ['btn-redo', 'Вернуть', 'Shift+Z']
  ];
  titleShortcuts.forEach(([id, title, key]) => {
    const el = document.getElementById(id);
    if (el) el.title = `${title} (${isMac ? '⌘' : 'Ctrl+'}${key})`;
  });

  const visible = el => !!el && !el.hidden && el.getClientRects().length > 0;
  const popupTriggerFor = element => {
    const popup = element?.closest?.('.menu, .ctx-menu');
    if (!popup?.id) return null;
    return [...document.querySelectorAll('[aria-controls]')].find(
      control => control.getAttribute('aria-controls') === popup.id) || null;
  };
  const focusReturnTarget = element => {
    const popupTrigger = popupTriggerFor(element);
    if (visible(popupTrigger)) return popupTrigger;
    if (element !== document.body && visible(element)) return element;
    const lastPopupTrigger = popupTriggerFor(lastTrigger);
    if (visible(lastPopupTrigger)) return lastPopupTrigger;
    return visible(lastTrigger) && lastTrigger !== document.body ? lastTrigger : null;
  };
  const focusables = root => [...root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(visible);

  function labelIconButtons(root = document) {
    root.querySelectorAll('button:is([title],[data-tooltip]):not([aria-label])').forEach(button => {
      const label = button.title || button.dataset.tooltip;
      if (!(button.textContent || '').trim() && label) button.setAttribute('aria-label', label);
    });
  }

  // Нативные browser-tooltip различаются между Safari/Chrome, перекрывают
  // интерфейс и не подчиняются дизайн-системе. Переносим title в единый слой,
  // сохраняя доступное имя у иконок и поддержку клавиатурного фокуса.
  const tooltip = document.createElement('div');
  tooltip.id = 'ui-tooltip';
  tooltip.className = 'ui-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let tooltipTarget = null;
  let tooltipTimer = 0;
  let suppressFocusTooltipUntil = 0;

  function prepareTooltips(root = document) {
    const nodes = [];
    if (root instanceof Element && root.hasAttribute('title')) nodes.push(root);
    root.querySelectorAll?.('[title]').forEach(node => nodes.push(node));
    nodes.forEach(node => {
      const text = (node.getAttribute('title') || '').trim();
      if (!text) return;
      const isSelfExplanatoryClose = node.matches('.modal-x, .panel-close, .errbar-close, [data-no-tooltip]');
      if (isSelfExplanatoryClose) {
        if (node.matches('button') && !node.hasAttribute('aria-label')) {
          node.setAttribute('aria-label', text || 'Закрыть');
        }
        node.removeAttribute('title');
        delete node.dataset.tooltip;
        return;
      }
      node.dataset.tooltip = text;
      node.removeAttribute('title');
      if (node.matches('button') && !node.hasAttribute('aria-label') && !(node.textContent || '').trim()) {
        node.setAttribute('aria-label', text);
      }
    });
  }

  function hideTooltip() {
    window.clearTimeout(tooltipTimer);
    tooltipTimer = 0;
    if (tooltipTarget) tooltipTarget.removeAttribute('aria-describedby');
    tooltipTarget = null;
    tooltip.hidden = true;
  }

  function positionTooltip(target) {
    const anchor = target.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const gap = 8;
    const edge = 8;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(edge, Math.min(left, window.innerWidth - box.width - edge));
    let top = anchor.bottom + gap;
    if (top + box.height > window.innerHeight - edge) top = anchor.top - box.height - gap;
    top = Math.max(edge, Math.min(top, window.innerHeight - box.height - edge));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function showTooltip(target, immediate = false) {
    if (!target?.isConnected || !target.dataset.tooltip) return;
    hideTooltip();
    tooltipTarget = target;
    tooltipTimer = window.setTimeout(() => {
      if (!tooltipTarget?.isConnected) return hideTooltip();
      tooltip.textContent = tooltipTarget.dataset.tooltip;
      tooltip.hidden = false;
      tooltipTarget.setAttribute('aria-describedby', tooltip.id);
      positionTooltip(tooltipTarget);
    }, immediate ? 0 : 250);
  }

  function prepareDialog(overlay) {
    if (overlay.dataset.a11yReady) return;
    const dialog = overlay.querySelector('.modal');
    if (!dialog) return;
    hideTooltip();
    overlay.dataset.a11yReady = 'true';
    const active = document.activeElement;
    const source = overlay.contains(active) ? lastTrigger : active;
    previousFocus.set(overlay, focusReturnTarget(source));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;

    const heading = dialog.querySelector('.modal-head');
    if (heading && !dialog.hasAttribute('aria-label') &&
        !dialog.hasAttribute('aria-labelledby')) {
      // Заголовок часто содержит кнопку закрытия. Если сослаться на весь
      // .modal-head, accessible name становится «Название Закрыть». Берём
      // только неинтерактивный текст заголовка.
      const copy = heading.cloneNode(true);
      copy.querySelectorAll('button, input, select, textarea, a').forEach(node => node.remove());
      const label = copy.textContent.trim();
      dialog.setAttribute('aria-label', label || 'Диалоговое окно');
    } else if (!heading && !dialog.hasAttribute('aria-label')) {
      const title = dialog.querySelector('.ask-title');
      if (title) {
        if (!title.id) title.id = `dialog-title-${++dialogSeq}`;
        dialog.setAttribute('aria-labelledby', title.id);
      } else {
        const message = dialog.querySelector('.ask-msg');
        dialog.setAttribute('aria-label', (message && message.textContent.trim()) || 'Диалоговое окно');
      }
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
      const previous = focusReturnTarget(previousFocus.get(overlay));
      if (previous) queueMicrotask(() => previous.focus());
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

  function enabledMenuItems(menu) {
    return [...menu.querySelectorAll('[role^="menuitem"]')]
      .filter(item => visible(item) && item.getAttribute('aria-disabled') !== 'true');
  }

  function moveMenuFocus(menu, direction) {
    const items = enabledMenuItems(menu);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
    items[next].focus();
  }

  labelIconButtons();
  prepareTooltips();
  document.addEventListener('pointerover', event => {
    const target = event.target.closest?.('[data-tooltip]');
    // Первая подсказка — с задержкой; пока подсказка уже видна, соседние
    // показываем мгновенно (emil: не ждать 250 мс на каждой кнопке подряд).
    if (target && target !== tooltipTarget) showTooltip(target, !tooltip.hidden);
  });
  document.addEventListener('pointerout', event => {
    if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('focusin', event => {
    if (performance.now() < suppressFocusTooltipUntil) return;
    const target = event.target.closest?.('[data-tooltip]');
    if (target) showTooltip(target, true);
  });
  document.addEventListener('focusout', event => {
    if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('pointerdown', () => {
    // Клик переносит фокус на кнопку. Без короткой паузы focusin заново
    // показывает подсказку уже поверх открытого меню или диалога.
    suppressFocusTooltipUntil = performance.now() + 360;
    hideTooltip();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // Закрытие popover/modal возвращает фокус на кнопку-триггер. Не показываем
    // поверх уже понятной кнопки вторую подсказку сразу после закрытия окна.
    suppressFocusTooltipUntil = performance.now() + 360;
    hideTooltip();
  }, true);
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('button, [role^="menuitem"], a[href]');
    if (trigger && visible(trigger)) lastTrigger = trigger;
  }, true);
  document.querySelectorAll('.modal-overlay').forEach(prepareDialog);
  document.querySelectorAll('.ctx-menu').forEach(prepareContextMenu);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.attributeName === 'title') {
          labelIconButtons(record.target.parentElement || document);
          prepareTooltips(record.target);
        }
        continue;
      }
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.modal-overlay')) prepareDialog(node);
        node.querySelectorAll?.('.modal-overlay').forEach(prepareDialog);
        if (node.matches('.ctx-menu')) prepareContextMenu(node);
        node.querySelectorAll?.('.ctx-menu').forEach(prepareContextMenu);
        labelIconButtons(node);
        prepareTooltips(node);
      });
      record.removedNodes.forEach(restoreRemovedFocus);
    }
    syncPopupState();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'title'] });
  syncPopupState();

  document.querySelectorAll('[data-menu], [data-pop]').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => {
      syncPopupState();
      const id = button.dataset.menu || button.dataset.pop;
      const popup = document.getElementById(id);
      if (!visible(popup)) return;
      const target = enabledMenuItems(popup)[0]
        || popup.querySelector('input:not([disabled]), select:not([disabled]), button:not([disabled])');
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

    // Поповеры панели («Подложка», «Сетка и привязки», «Источники») закрывались
    // только кликом снаружи: Escape проваливался в глобальный обработчик и
    // снимал выделение на холсте вместо закрытия окна, а фокус оставался внутри
    // уже закрытого поповера. Ведём себя как немодальный диалог: закрываем и
    // возвращаем фокус на кнопку-триггер.
    const pop = document.activeElement?.closest?.('.pop');
    if (event.key === 'Escape' && pop && visible(pop)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pop.hidden = true;
      const trigger = document.querySelector(`[data-pop="${pop.id}"]`);
      syncPopupState();
      trigger?.focus();
      return;
    }

    const menu = document.activeElement?.closest?.('.menu, .ctx-menu');
    if (menu && visible(menu)) {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveMenuFocus(menu, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveMenuFocus(menu, -1); }
      else if (event.key === 'Home') { event.preventDefault(); enabledMenuItems(menu)[0]?.focus(); }
      else if (event.key === 'End') {
        event.preventDefault();
        enabledMenuItems(menu).at(-1)?.focus();
      }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (document.activeElement.getAttribute?.('aria-disabled') !== 'true') document.activeElement.click();
      }
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
