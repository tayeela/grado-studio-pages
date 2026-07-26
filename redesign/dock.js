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
// У дока ОДНА ширина: её настраивает человек, перетаскивая границу, как у
// панели слоёв и инспектора. Ширину «под окно» я пробовал дважды, и оба раза
// она проигрывала механизму границы — тот выставляет своё значение при
// запуске и возвращает его. Лишняя сущность убрана вместо третьей попытки.
// Док — flex-элемент рядом с холстом, а не поверх него: холст ужимается и
// остаётся полностью видимым и кликабельным.
(function () {
  const dock = document.getElementById("dock");
  if (!dock) return;
  const body = dock.querySelector(".dock-body");
  const titleEl = dock.querySelector(".dock-title");
  const resizer = document.getElementById("dock-resizer");

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
    // Тело чистим ВСЕГДА. Закрытие окна идёт разными путями (своя кнопка,
    // closePopups, крестик дока, Escape), и один из них уже оставлял док
    // скрытым, но с живым окном внутри: снаружи закрыто, в разметке висит.
    // Закрытый док обязан быть пуст — это одно состояние, а не два.
    body.replaceChildren();
    dock.hidden = true;
    if (resizer) resizer.hidden = true;
    document.body.classList.remove("dock-open");
  }

  // Окно закрывают его собственные кнопки — они делают overlay.remove().
  // Ловим это наблюдателем, а не переписыванием их обработчиков.
  // Смотрим на ТЕКУЩЕЕ окно дока, а не на то, ради которого наблюдатель заведён.
  // Разница решает: MutationObserver отрабатывает микрозадачей, уже ПОСЛЕ того,
  // как на месте старого окна встало новое. Замыкание на старом видело «меня
  // сняли» и звало closeDock, а тот чистит тело — вместе с новым окном.
  function watchRemoval() {
    observer = new MutationObserver(() => {
      if (current && current.isConnected && current.parentElement === body) return;
      closeDock();
    });
    observer.observe(body, { childList: true });
  }

  window.dockOverlay = function dockOverlay(overlay, opts = {}) {
    if (!overlay) return false;
    // Смена окна в доке: сначала снимаем наблюдение, потом убираем прежнее.
    // Иначе смена читается как закрытие. Именно на этом окно «Данные по
    // области» гасило само себя: кнопка «Приблизить автоматически» делает
    // close() + openDataFetch(), и новое окно исчезало через микрозадачу.
    if (observer) { observer.disconnect(); observer = null; }
    if (current && current !== overlay) current.remove();   // один док — одно окно
    overlay.classList.add("docked");
    body.replaceChildren(overlay);
    titleEl.textContent = opts.title || "";
    dock.hidden = false;
    if (resizer) resizer.hidden = false;
    document.body.classList.add("dock-open");
    current = overlay;
    watchRemoval();
    watchCloseButtons(overlay);
    return true;
  };

  window.dockIsOpen = () => !dock.hidden;

  // Окно закрывают его собственные кнопки — «Применить», «Отмена», крестик, —
  // и почти все делают это через closePopups, который докированное окно НЕ
  // трогает (иначе подокно вроде «Статистики поля» уносило бы родителя).
  // Перечислять такие кнопки по одной бессмысленно: список я уже собирал, и
  // «Применить стиль» в него не попало. Смотрим не на кнопку, а на ФАКТ —
  // вырос ли счётчик вызовов closePopups после клика внутри окна.
  //
  // Слушаем на САМОМ оверлее и в фазе ПЕРЕХВАТА: почти каждое окно гасит
  // всплытие своим `ev.stopPropagation()`, и до тела дока клик не доходил
  // вовсе — замер показал ровно это.
  function watchCloseButtons(overlay) {
    overlay.addEventListener("click", () => {
      const было = window.__closePopupsCalls || 0;
      // Микрозадача, чтобы сперва отработал обработчик самого окна: он
      // откатывает стиль, убирает предпросмотр и как раз зовёт closePopups.
      queueMicrotask(() => {
        if ((window.__closePopupsCalls || 0) === было) return;   // окно не закрывалось
        if (overlay.isConnected && overlay.parentElement === body) overlay.remove();
      });
    }, true);
  }

  dock.querySelector(".dock-close")?.addEventListener("click", () => {
    // Закрываем как закрыл бы человек: ищем родную кнопку отмены окна, чтобы
    // сработал её откат. Своего «крестика» у дока быть не должно — иначе
    // правки оформления остались бы применёнными вопреки «Отмене».
    const окно = current;
    const своя = окно && окно.querySelector("#ls-cancel, .modal-x, [data-dock-cancel]");
    if (!своя) { окно?.remove(); return; }
    своя.click();
    // Часть окон закрывается через closePopups, а тот докированные не трогает
    // (иначе подокно вроде «Статистики поля» уносило бы родителя). Значит после
    // родной кнопки окно может остаться — тогда убираем сами.
    if (окно.isConnected && окно.parentElement === body) окно.remove();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || dock.hidden || !current) return;
    if (document.querySelector(".modal-overlay:not(.docked)")) return;  // поверх дока есть модалка
    event.stopPropagation();
    dock.querySelector(".dock-close")?.click();
  }, true);
})();
