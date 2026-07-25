// Аннотирование выпуска: ведомость координат поворотных точек.
//
// Обратная сторона каталога координат: там таблица из документа превращалась в
// контур, здесь контур превращается в таблицу, которую подшивают к чертежу.
// Без неё лист не примут, а считать вручную по вершинам — верный способ
// ошибиться в одном знаке и не заметить.
//
// Соглашения геодезии, а не холста:
//   - X — СЕВЕР, Y — ВОСТОК (на холсте наоборот, x — восток);
//   - ДИРЕКЦИОННЫЙ УГОЛ отсчитывается от направления на север ПО ЧАСОВОЙ
//     стрелке, 0…360°. Это не тот угол, что в строке ввода «25<90»: там
//     соглашение CAD — от востока против часовой. Две разные величины в одном
//     приложении, поэтому обе названы там, где показываются.
(function (root) {
  "use strict";

  // Дирекционный угол направления из точки в точку, в градусах 0…360.
  // Принимает координаты ХОЛСТА (x — восток, y — север).
  function directionalAngle(from, to) {
    const восток = to[0] - from[0], север = to[1] - from[1];
    if (!Math.hypot(восток, север)) return 0;
    const град = Math.atan2(восток, север) * 180 / Math.PI;
    return (град + 360) % 360;
  }

  // Градусы, минуты, секунды — как пишут в документах.
  function formatDMS(град) {
    let г = Math.floor(град);
    let остаток = (град - г) * 60;
    let м = Math.floor(остаток);
    let с = Math.round((остаток - м) * 60);
    if (с === 60) { с = 0; м += 1; }
    if (м === 60) { м = 0; г += 1; }
    return `${г}°${String(м).padStart(2, "0")}'${String(с).padStart(2, "0")}"`;
  }

  // Ведомость по кольцу или ломаной. Возвращает строки:
  //   номер, X (север), Y (восток), длина стороны до СЛЕДУЮЩЕЙ точки,
  //   дирекционный угол этой стороны.
  // У незамкнутой ломаной последняя точка стороны не имеет — там пусто.
  function coordListing(points, opts) {
    const кольцо = !(opts && opts.line);
    const n = points.length;
    const строки = [];
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const следующий = i + 1 < n ? points[i + 1] : (кольцо ? points[0] : null);
      const длина = следующий ? Math.hypot(следующий[0] - p[0], следующий[1] - p[1]) : null;
      const угол = следующий ? directionalAngle(p, следующий) : null;
      строки.push({
        номер: (opts && opts.prefix ? opts.prefix : "") + (i + 1),
        X: p[1],                       // север
        Y: p[0],                       // восток
        длина, дирекционный: угол,
      });
    }
    return строки;
  }

  // Ведомость текстом с табуляцией: вставляется в Word и Excel как таблица.
  function coordListingText(строки) {
    const шапка = ["№", "X (север), м", "Y (восток), м", "Длина, м", "Дирекц. угол"];
    const тело = строки.map(р => [
      р.номер,
      р.X.toFixed(2),
      р.Y.toFixed(2),
      р.длина == null ? "" : р.длина.toFixed(2),
      р.дирекционный == null ? "" : formatDMS(р.дирекционный),
    ].join("\t"));
    return [шапка.join("\t"), ...тело].join("\n");
  }

  // Окно «Ведомость координат»: по выбранному объекту — таблица, которую
  // подшивают к чертежу. Копируется табуляцией: вставляется в Word и Excel
  // готовой таблицей, а не строкой текста.
  function openCoordListing() {
    if (typeof document === "undefined") return;
    const выбранные = (typeof state !== "undefined" && state.selectedIds)
      ? state.features.filter(f => state.selectedIds.has(f.id)) : [];
    const f = выбранные.find(x => x.ring || x.line);
    if (!f) {
      if (typeof toast === "function")
        toast("Выделите контур или линию — ведомость строится по её вершинам", "warn");
      return;
    }
    const точки = f.ring || f.line;
    const строки = coordListing(точки, { line: !f.ring, prefix: "н" });
    const текст = coordListingText(строки);
    const площадь = f.ring ? Math.abs(точки.reduce((s, p, i, a) => {
      const q = a[(i + 1) % a.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 : 0;
    const периметр = строки.reduce((s, р) => s + (р.длина || 0), 0);

    if (typeof closePopups === "function") closePopups();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = typeof escHtml === "function" ? escHtml : (s => String(s));
    overlay.innerHTML = `<div class="modal fmt-modal-lg coord-listing-modal" role="dialog" aria-modal="true" aria-labelledby="cl-title">
      <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Аннотирование</span><span id="cl-title">Ведомость координат</span></span>
        <button class="modal-x" aria-label="Закрыть ведомость"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body compact">
        <div class="fc-help">Дирекционный угол — от направления на север по часовой стрелке.
          X — север, Y — восток, как в документах.${f.ring
            ? ` Площадь ${площадь.toFixed(2)} м² (${(площадь / 10000).toFixed(4)} га), периметр ${периметр.toFixed(2)} м.`
            : ` Длина ${периметр.toFixed(2)} м.`}</div>
        <div class="mf-table-wrap"><table class="attr-table mf-table">
          <thead><tr><th>№</th><th>X (север), м</th><th>Y (восток), м</th><th>Длина, м</th><th>Дирекц. угол</th></tr></thead>
          <tbody>${строки.map(р => `<tr><td>${esc(р.номер)}</td><td>${р.X.toFixed(2)}</td>
            <td>${р.Y.toFixed(2)}</td><td>${р.длина == null ? "" : р.длина.toFixed(2)}</td>
            <td>${р.дирекционный == null ? "" : esc(formatDMS(р.дирекционный))}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button id="cl-close">Закрыть</button>
        <button id="cl-copy" class="primary">Копировать таблицу</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    const close = () => overlay.remove();
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.querySelector("#cl-close").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.querySelector("#cl-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(текст);
        if (typeof toast === "function")
          toast(`Ведомость скопирована: ${строки.length} точек — вставьте в Word или Excel`);
        close();
      } catch (error) {
        // Буфер могут не дать (нет разрешения, небезопасный источник). Не
        // молчим и не теряем работу: показываем текст, чтобы скопировать руками.
        const поле = document.createElement("textarea");
        поле.value = текст; поле.rows = 10; поле.style.width = "100%";
        overlay.querySelector(".modal-body").prepend(поле);
        поле.select();
        if (typeof toast === "function")
          toast("Браузер не дал буфер обмена — таблица выделена, скопируйте вручную", "warn");
      }
    });
    window.dockOverlay?.(overlay, { title: "Ведомость координат", width: 480 });
  }

  root.openCoordListing = openCoordListing;
  root.directionalAngle = directionalAngle;
  root.formatDMS = formatDMS;
  root.coordListing = coordListing;
  root.coordListingText = coordListingText;
  if (typeof module !== "undefined" && module.exports)
    module.exports = { directionalAngle, formatDMS, coordListing, coordListingText };
})(typeof window !== "undefined" ? window : globalThis);
