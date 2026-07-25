// Рабочая панель (док).
//
// Окна, в которых человек работает ГЛЯДЯ НА ЧЕРТЁЖ, были модальными. Замер:
// «Оформление слоя» закрывало 84% холста, «Варианты» 46%, «Таблица атрибутов»
// 31%, и во всех трёх клик по холсту не проходил — его ловил оверлей. То есть
// сверить правку с чертежом было нельзя ровно там, где это и нужно.
//
// Ключевое решение: окна НЕ переписываются. Оверлей вместе со всем содержимым
// переезжает в боковой док, а `position` меняется классом. Кнопки, обработчики
// и `overlay.remove()` внутри окна продолжают работать как работали — поэтому
// перевод одного окна стоит одной строки, а не переписывания разметки.
//
// Док — flex-элемент рядом с холстом, а не поверх него: холст ужимается и
// остаётся полностью видимым и кликабельным.
(function () {
  const dock = document.getElementById("dock");
  if (!dock) return;
  const body = dock.querySelector(".dock-body");
  const titleEl = dock.querySelector(".dock-title");
  let current = null;                       // оверлей, который сейчас в доке
  let observer = null;

  // Пересчёт холста НЕ инициируем: за ним уже следит ResizeObserver на самом
  // canvas (app-geodesy.js) — док меняет его CSS-ширину, наблюдатель это видит.
  // Своё событие resize было лишним звеном и, что хуже, зависело от кадров:
  // в фоновой вкладке requestAnimationFrame не идёт вовсе (замер: 0 кадров за
  // 400 мс при document.hidden), и сигнал бы не ушёл. Наблюдатель надёжнее.

  function closeDock() {
    if (observer) { observer.disconnect(); observer = null; }
    current = null;
    dock.hidden = true;
    document.body.classList.remove("dock-open");
  }

  // Окно закрывают его собственные кнопки — они делают overlay.remove().
  // Ловим это наблюдателем, а не переписыванием их обработчиков.
  function watchRemoval(overlay) {
    observer = new MutationObserver(() => {
      if (!overlay.isConnected || overlay.parentElement !== body) closeDock();
    });
    observer.observe(body, { childList: true });
  }

  window.dockOverlay = function dockOverlay(overlay, opts = {}) {
    if (!overlay) return false;
    if (current && current !== overlay) current.remove();   // один док — одно окно
    overlay.classList.add("docked");
    body.replaceChildren(overlay);
    titleEl.textContent = opts.title || "";
    dock.style.setProperty("--dock-width", (opts.width || 440) + "px");
    dock.hidden = false;
    document.body.classList.add("dock-open");
    current = overlay;
    watchRemoval(overlay);
    return true;
  };

  window.dockIsOpen = () => !dock.hidden;

  dock.querySelector(".dock-close")?.addEventListener("click", () => {
    // Закрываем как закрыл бы человек: ищем родную кнопку отмены окна, чтобы
    // сработал её откат. Своего «крестика» у дока быть не должно — иначе
    // правки оформления остались бы применёнными вопреки «Отмене».
    const своя = current && (current.querySelector("#ls-cancel, .modal-x, [data-dock-cancel]"));
    if (своя) своя.click(); else current?.remove();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || dock.hidden || !current) return;
    if (document.querySelector(".modal-overlay:not(.docked)")) return;  // поверх дока есть модалка
    event.stopPropagation();
    dock.querySelector(".dock-close")?.click();
  }, true);
})();
