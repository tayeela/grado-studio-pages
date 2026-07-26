// Сводка по выборке: сколько объектов, сколько площади и длины, с разбивкой по
// значению поля.
//
// Последнее, чего не хватало для повседневной работы уровня КУГИС: отбор по
// расположению и по выражению в приложении уже есть, оверлей слоёв есть, а
// ответить «сколько гектаров жилой застройки попало в границу» было нечем —
// приходилось выгружать в таблицу и считать снаружи.
//
// Считает по ПЕРЕДАННЫМ объектам, ничего не зная про выделение: так функция
// проверяется числами в Node и одинаково годится и для выборки, и для слоя.
(function (root) {
  "use strict";

  const площадьКольца = ring => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };

  // Площадь с учётом дыр — как в featureArea: выколотая часть объекту не
  // принадлежит, иначе гектары в сводке разойдутся с ТЭП.
  function площадьОбъекта(f) {
    // Круг — площадная фигура наравне с кольцом (та же правка, что в
    // featureArea: круглая зона молча весила ноль в сводке и в ТЭП).
    if (f && f.circle) return Math.PI * f.circle.r * f.circle.r;
    if (!f || !f.ring) return 0;
    let a = площадьКольца(f.ring);
    for (const h of f.holes || []) if (h && h.length >= 3) a -= площадьКольца(h);
    return Math.max(0, a);
  }

  function длинаОбъекта(f) {
    if (f && f.circle) return 2 * Math.PI * f.circle.r;          // периметр круга
    if (f && f.arc) return Math.abs(f.arc.sweep || 0) * f.arc.r;  // дуга по развороту
    const pts = f && (f.line || f.ring);
    if (!pts || pts.length < 2) return 0;
    let s = 0;
    for (let i = 0; i + 1 < pts.length; i++)
      s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (f.ring) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0],
                                pts[0][1] - pts[pts.length - 1][1]);
    return s;
  }

  // Сводка. Если поле не задано — только итог. Если задано — ещё и группы,
  // отсортированные по убыванию площади (а при нулевых площадях — по числу).
  //
  // Пустое значение поля не выбрасывается, а становится группой «— не задано —»:
  // «в сводке 40 га, а в слое 60» — это ошибка, которую ищут полдня.
  function selectionSummary(features, opts) {
    const поле = opts && opts.field;
    const итог = { количество: 0, площадь: 0, длина: 0 };
    const группы = new Map();
    for (const f of features || []) {
      const s = площадьОбъекта(f), d = длинаОбъекта(f);
      итог.количество += 1; итог.площадь += s; итог.длина += d;
      if (!поле) continue;
      const сырое = f.props ? f.props[поле] : undefined;
      const ключ = (сырое == null || сырое === "") ? "— не задано —" : String(сырое);
      const г = группы.get(ключ) || { значение: ключ, количество: 0, площадь: 0, длина: 0 };
      г.количество += 1; г.площадь += s; г.длина += d;
      группы.set(ключ, г);
    }
    const список = [...группы.values()].sort((a, b) =>
      (b.площадь - a.площадь) || (b.количество - a.количество) ||
      a.значение.localeCompare(b.значение, "ru"));
    for (const г of список)
      г.доля = итог.площадь > 0 ? г.площадь / итог.площадь
             : (итог.количество ? г.количество / итог.количество : 0);
    return { итог, группы: список };
  }

  // Текст с табуляцией — вставляется в Word и Excel таблицей.
  function summaryText(сводка, поле) {
    const строки = [];
    строки.push(["Значение" + (поле ? ` (${поле})` : ""), "Кол-во", "Площадь, м²",
                 "Площадь, га", "Длина, м", "Доля"].join("\t"));
    for (const г of сводка.группы)
      строки.push([г.значение, г.количество, г.площадь.toFixed(2),
                   (г.площадь / 10000).toFixed(4), г.длина.toFixed(2),
                   (г.доля * 100).toFixed(1) + "%"].join("\t"));
    строки.push(["Итого", сводка.итог.количество, сводка.итог.площадь.toFixed(2),
                 (сводка.итог.площадь / 10000).toFixed(4),
                 сводка.итог.длина.toFixed(2), "100.0%"].join("\t"));
    return строки.join("\n");
  }

  // Окно «Сводка по выборке»: считает по выделенному, а если ничего не
  // выделено — по активному слою целиком, и говорит об этом прямо в шапке.
  function openSelectionSummary() {
    if (typeof document === "undefined" || typeof state === "undefined") return;
    const выделено = state.selectedIds && state.selectedIds.size
      ? state.features.filter(f => state.selectedIds.has(f.id)) : null;
    const слой = typeof activeLayer === "function" ? activeLayer() : null;
    const объекты = выделено || (слой ? state.features.filter(f => f.layer_id === слой.id) : []);
    const источник = выделено ? `выделено объектов: ${объекты.length}`
      : слой ? `слой «${слой.title}», объектов: ${объекты.length}` : "нет объектов";
    if (!объекты.length) {
      if (typeof toast === "function")
        toast("Нечего считать: выделите объекты или сделайте активным слой с объектами", "warn");
      return;
    }
    // поля берём у объектов, а не из схемы слоя: в выборку могут попасть
    // объекты разных слоёв, и схема одного тут ничего не решает
    const поля = new Set();
    for (const f of объекты) for (const k of Object.keys(f.props || {}))
      if (!String(k).startsWith("_")) поля.add(k);
    const списокПолей = [...поля].sort((a, b) => a.localeCompare(b, "ru"));

    if (typeof closePopups === "function") closePopups();
    const esc = typeof escHtml === "function" ? escHtml : (s => String(s));
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal fmt-modal-lg summary-modal" role="dialog" aria-modal="true" aria-labelledby="sum-title">
      <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Анализ</span><span id="sum-title">Сводка по выборке</span></span>
        <button class="modal-x" aria-label="Закрыть сводку"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body compact">
        <div class="fmt-row"><label>Разбивка по полю<select id="sum-field">
          <option value="">— только итог —</option>
          ${списокПолей.map(п => `<option value="${esc(п)}">${esc(п)}</option>`).join("")}
        </select></label></div>
        <div class="fc-help" id="sum-source">${esc(источник)}</div>
        <div class="mf-table-wrap"><table class="attr-table mf-table" id="sum-table"></table></div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button id="sum-close">Закрыть</button>
        <button id="sum-copy" class="primary">Копировать таблицу</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    const close = () => overlay.remove();
    overlay.querySelector(".modal-x").addEventListener("click", close);
    overlay.querySelector("#sum-close").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });

    let текст = "";
    const перерисовать = () => {
      const поле = overlay.querySelector("#sum-field").value;
      const с = selectionSummary(объекты, { field: поле });
      текст = summaryText(с, поле);
      const ячейка = (v, кл) => `<td${кл ? ` class="${кл}"` : ""}>${esc(v)}</td>`;
      const строкаИтога = `<tr class="sum-total"><td><b>Итого</b></td>${
        [с.итог.количество, с.итог.площадь.toFixed(2), (с.итог.площадь / 10000).toFixed(4),
         с.итог.длина.toFixed(2), "100.0%"].map(v => ячейка(v)).join("")}</tr>`;
      overlay.querySelector("#sum-table").innerHTML =
        `<thead><tr><th>${поле ? esc(поле) : "Все объекты"}</th><th>Кол-во</th>
          <th>Площадь, м²</th><th>Площадь, га</th><th>Длина, м</th><th>Доля</th></tr></thead>
         <tbody>${с.группы.map(г => `<tr>${
            [г.значение, г.количество, г.площадь.toFixed(2), (г.площадь / 10000).toFixed(4),
             г.длина.toFixed(2), (г.доля * 100).toFixed(1) + "%"].map(v => ячейка(v)).join("")
          }</tr>`).join("")}${строкаИтога}</tbody>`;
    };
    overlay.querySelector("#sum-field").addEventListener("change", перерисовать);
    перерисовать();

    overlay.querySelector("#sum-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(текст);
        if (typeof toast === "function") toast("Сводка скопирована — вставьте в Word или Excel");
        close();
      } catch (error) {
        const поле = document.createElement("textarea");
        поле.value = текст; поле.rows = 8; поле.style.width = "100%";
        overlay.querySelector(".modal-body").prepend(поле); поле.select();
        if (typeof toast === "function")
          toast("Браузер не дал буфер обмена — таблица выделена, скопируйте вручную", "warn");
      }
    });
    window.dockOverlay?.(overlay, { title: "Сводка по выборке" });
  }

  root.openSelectionSummary = openSelectionSummary;
  root.selectionSummary = selectionSummary;
  root.summaryText = summaryText;
  if (typeof module !== "undefined" && module.exports)
    module.exports = { selectionSummary, summaryText };
})(typeof window !== "undefined" ? window : globalThis);
