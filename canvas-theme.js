/* =============================================================================
   ГРАДО Студия — палитра холста, синхронизированная с темой  (ТЗ §7.7, §8)

   Единый источник цветов Canvas 2D — вместо 30+ захардкоженных hex в теле
   функций отрисовки app.js. Значения читаются из тех же CSS-переменных
   (tokens.css), поэтому чертёж перекрашивается вместе с интерфейсом и не
   расходится с CSS-панелями.

   Без сборки/CDN: подключается обычным <script src="canvas-theme.js">
   ПОСЛЕ tokens.css и ДО app.js. Определяет глобали:
     CANVAS_THEME        — объект с актуальными цветами (читать при отрисовке)
     refreshCanvasTheme  — перечитать из CSS (звать после смены темы)
     setTheme(name)      — переключить тему целиком (data-theme + persist + redraw)
   ============================================================================= */
(function (global) {
  'use strict';

  /* Ключ CANVAS_THEME  ->  имя CSS-переменной (без префикса значения). */
  var MAP = {
    bg:            '--canvas-bg',
    grid:          '--canvas-grid',
    boundary:      '--canvas-boundary',
    selection:     '--canvas-selection',
    vertex:        '--canvas-vertex',
    shared:        '--canvas-shared',    // общая вершина (зелёная ручка)
    redline:       '--canvas-redline',   // красные линии / пикетаж
    label:         '--canvas-label',     // подписи объектов
    zoneA:         '--zone-a',           // Ж-зоны — заливка
    zoneALine:     '--zone-a-line',
    zoneB:         '--zone-b',           // О-зоны
    zoneBLine:     '--zone-b-line',
    zoneGreen:     '--zone-green',       // Р-зоны / озеленение
    zoneGreenLine: '--zone-green-line'
  };

  var CANVAS_THEME = {};

  /* Перечитать все цвета из активной темы. Звать один раз на старте и после
     каждого переключения темы, ПЕРЕД повторной отрисовкой холста. */
  function refreshCanvasTheme() {
    var cs = getComputedStyle(document.documentElement);
    for (var key in MAP) {
      if (Object.prototype.hasOwnProperty.call(MAP, key)) {
        CANVAS_THEME[key] = cs.getPropertyValue(MAP[key]).trim();
      }
    }
    return CANVAS_THEME;
  }

  /* Текущая / стартовая тема: явный выбор пользователя > системная. */
  function initialTheme() {
    var saved = null;
    try { saved = localStorage.getItem('grado-theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') return saved;
    return (global.matchMedia &&
            global.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  /* Переключить тему: обновляет data-theme на <html>, сохраняет выбор,
     перечитывает палитру холста и просит приложение перерисоваться.
     app.js может выставить window.onThemeChange = fn для своего redraw,
     либо слушать событие 'gradothemechange'. */
  function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem('grado-theme', name); } catch (e) {}
    refreshCanvasTheme();
    if (typeof global.onThemeChange === 'function') global.onThemeChange(name);
    global.dispatchEvent(new CustomEvent('gradothemechange', { detail: { theme: name } }));
    return name;
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    return setTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* Применить стартовую тему как можно раньше (до первой отрисовки). */
  document.documentElement.setAttribute('data-theme', initialTheme());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshCanvasTheme, { once: true });
  } else {
    refreshCanvasTheme();
  }

  global.CANVAS_THEME       = CANVAS_THEME;
  global.refreshCanvasTheme = refreshCanvasTheme;
  global.setTheme           = setTheme;
  global.toggleTheme        = toggleTheme;
})(window);

/* -----------------------------------------------------------------------------
   ПРИМЕР интеграции в app.js (было → стало):

     // было:
     ctx.strokeStyle = '#2f6fde';           // выделение
     ctx.fillStyle   = '#12a150';           // общая вершина
     ctx.strokeStyle = '#9a978f';           // сетка

     // стало:
     ctx.strokeStyle = CANVAS_THEME.selection;
     ctx.fillStyle   = CANVAS_THEME.shared;
     ctx.strokeStyle = CANVAS_THEME.grid;

   Перерисовка при смене темы:
     window.onThemeChange = function () { redrawCanvas(); };
     // или: window.addEventListener('gradothemechange', redrawCanvas);

   Кнопка переключателя в header:
     themeBtn.addEventListener('click', toggleTheme);
----------------------------------------------------------------------------- */
