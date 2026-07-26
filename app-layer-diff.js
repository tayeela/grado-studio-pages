// ============================================================================
//  app-layer-diff.js — сверка двух слоёв: насколько один сидит на другом.
//
//  Задача из практики: выгрузку из одного источника кладут на подоснову из
//  другого и хотят знать, совпадают ли границы. Глазом это не проверить —
//  сдвиг в 5 метров на экране в масштабе квартала не виден, а в ведомости
//  координат и в DXF он уже стоит денег.
//
//  Так и нашлось расхождение ГИС ОГД и ЕГРН: +4.49 / −4.57 м напрямую с
//  портала и −0.07 / −0.28 м после датум-поправки. Считал я это скриптом в
//  консоли; тут то же самое, только человеку доступно.
//
//  Классический скрипт, общая глобальная область (как остальные app-*.js).
// ============================================================================
(function (root) {
  "use strict";

  const центр = ring => {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
  };
  const площадь = ring => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };
  const медиана = числа => {
    if (!числа.length) return 0;
    const s = [...числа].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Пару образуют объекты, которые ОДИН И ТОТ ЖЕ участок в двух слоях:
  // центры рядом и площади почти равны. Без второго условия сосед по улице
  // сойдёт за пару и испортит статистику.
  const РАДИУС = 25;          // м: дальше искать бессмысленно, это уже другой объект
  const ДОПУСК_ПЛОЩАДИ = 0.15;

  function compareLayers(featuresA, featuresB, opts = {}) {
    const радиус = opts.radius || РАДИУС;
    const допуск = opts.areaTolerance ?? ДОПУСК_ПЛОЩАДИ;
    const годные = fs => (fs || [])
      .filter(f => f && Array.isArray(f.ring) && f.ring.length > 2)
      .map(f => ({ f, c: центр(f.ring), s: площадь(f.ring) }));

    const A = годные(featuresA), B = годные(featuresB);
    const пары = [], безПары = [];
    for (const a of A) {
      let лучший = null, dmin = Infinity;
      for (const b of B) {
        const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]);
        if (d < dmin) { dmin = d; лучший = b; }
      }
      const площадиБлизки = лучший &&
        Math.abs(лучший.s - a.s) / Math.max(a.s, 1) < допуск;
      if (лучший && dmin <= радиус && площадиБлизки)
        пары.push({ a: a.f, b: лучший.f, dx: a.c[0] - лучший.c[0], dy: a.c[1] - лучший.c[1],
          d: dmin, площади: [a.s, лучший.s] });
      else безПары.push(a.f);
    }

    const dx = пары.map(p => p.dx), dy = пары.map(p => p.dy), dd = пары.map(p => p.d);
    const сред = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    return {
      всегоA: A.length, всегоB: B.length,
      пар: пары.length, безПары: безПары.length,
      // Систематический сдвиг — это средние dx/dy: если слой просто сдвинут,
      // они и покажут насколько. Медиана расстояния говорит о типичном
      // объекте, а среднее легко перекашивает пара выбросов.
      сдвиг: { dx: сред(dx), dy: сред(dy) },
      медианаРасстояния: медиана(dd),
      худшие: пары.slice().sort((p, q) => q.d - p.d).slice(0, 10),
      пары,
    };
  }

  root.compareLayers = compareLayers;

  // ---- самопроверка: запускается только при прямом вызове в Node ----
  if (typeof module !== "undefined" && require.main === module) {
    const квадрат = (x, y, сторона = 10) =>
      ({ ring: [[x, y], [x + сторона, y], [x + сторона, y + сторона], [x, y + сторона]] });
    // слой B = слой A, сдвинутый на (+3, −4)
    const A = [квадрат(0, 0), квадрат(100, 0), квадрат(0, 100)];
    const B = A.map(f => ({ ring: f.ring.map(([x, y]) => [x - 3, y + 4]) }));
    const r = compareLayers(A, B);
    console.assert(r.пар === 3, "все три объекта обязаны найти пару");
    console.assert(Math.abs(r.сдвиг.dx - 3) < 1e-6, "сдвиг по X = +3");
    console.assert(Math.abs(r.сдвиг.dy + 4) < 1e-6, "сдвиг по Y = −4");
    console.assert(Math.abs(r.медианаРасстояния - 5) < 1e-6, "расстояние = 5 (3-4-5)");
    // объект без пары: далеко и другой площади
    const r2 = compareLayers([...A, квадрат(5000, 5000, 40)], B);
    console.assert(r2.безПары === 1, "далёкий объект обязан остаться без пары");
    console.log("app-layer-diff: самопроверка пройдена");
  }
})(typeof window !== "undefined" ? window : globalThis);

// ---------------------------------------------------------------------------
// Окно «Сверка слоёв». Живёт в доке: сверяют, глядя на чертёж, — увидел
// расхождение в списке, нашёл его на холсте.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";
  if (typeof document === "undefined") return;

  // LAYERS_V2 и state объявлены через const в app-sources.js: они живут в общей
  // области обычных скриптов, но на window (то есть на root) НЕ попадают.
  // Обращаться к ним надо напрямую — иначе получаем undefined и тихо пустой
  // список слоёв. Ровно эта ловушка уже стоила окна «Данные».
  const слоиСПолигонами = () => (typeof LAYERS_V2 === "undefined" ? [] : LAYERS_V2)
    .map(layer => ({ layer, features: (typeof state === "undefined" ? [] : state.features || [])
      .filter(f => f.layer_id === layer.id && Array.isArray(f.ring) && f.ring.length > 2) }))
    .filter(item => item.features.length);

  function openLayerDiff() {
    if (typeof closePopups === "function") closePopups();
    const items = слоиСПолигонами();
    const esc = typeof escHtml === "function" ? escHtml : (s => String(s));
    if (items.length < 2) {
      if (typeof toast === "function")
        toast("Сверять нечего: нужны два слоя с полигонами", "warn");
      return;
    }
    const опции = (выбран) => items.map(({ layer, features }) =>
      `<option value="${esc(layer.id)}"${layer.id === выбран ? " selected" : ""}>${
        esc(layer.title)} · ${features.length}</option>`).join("");

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal topo-modal" role="dialog" aria-modal="true" aria-labelledby="ld-title">
      <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Качество данных</span><span id="ld-title">Сверка слоёв</span></div>
        <button class="modal-x" aria-label="Закрыть сверку слоёв"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body topo-body">
        <p class="topo-intro">Показывает, насколько один слой сидит на другом. Сдвиг в несколько метров на экране не виден, а в ведомость координат и DXF попадёт.</p>
        <label class="topo-layer">Что сверяем<select id="ld-a">${опции(items[0].layer.id)}</select></label>
        <label class="topo-layer">С чем<select id="ld-b">${опции(items[1].layer.id)}</select></label>
        <div class="topo-summary" id="ld-summary" role="status" aria-live="polite"></div>
        <div class="topo-results" id="ld-results" hidden></div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button type="button" id="ld-cancel">Закрыть</button>
        <button type="button" id="ld-run" class="primary">Сверить</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", ev => ev.stopPropagation());
    const $ = id => overlay.querySelector("#" + id);

    const м = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} м`;
    $("ld-run").addEventListener("click", () => {
      const a = items.find(i => i.layer.id === $("ld-a").value);
      const b = items.find(i => i.layer.id === $("ld-b").value);
      if (!a || !b || a === b) {
        $("ld-summary").textContent = "Выберите два разных слоя";
        return;
      }
      const r = compareLayers(a.features, b.features);
      if (!r.пар) {
        $("ld-summary").innerHTML = `<b>Общих объектов не нашлось.</b> ` +
          `Слои описывают разные вещи — сверять нечего.`;
        $("ld-results").hidden = true;
        return;
      }
      const сдвиг = Math.hypot(r.сдвиг.dx, r.сдвиг.dy);
      const вердикт = сдвиг < 0.5
        ? `<b>Слои совмещены.</b> Систематического сдвига нет (${м(r.сдвиг.dx)} / ${м(r.сдвиг.dy)}).`
        : `<b>Слой смещён на ${сдвиг.toFixed(2)} м.</b> По осям: ${м(r.сдвиг.dx)} / ${м(r.сдвиг.dy)}.`;
      $("ld-summary").innerHTML = `${вердикт}<br>Сопоставлено ${r.пар} из ${r.всегоA}, ` +
        `типичное расхождение ${r.медианаРасстояния.toFixed(2)} м` +
        (r.безПары ? `, без пары ${r.безПары}` : "");
      $("ld-results").hidden = false;
      $("ld-results").innerHTML = r.худшие.map(p =>
        `<button type="button" class="topo-issue" data-id="${esc(String(p.a.id))}">
          <span>${p.d.toFixed(2)} м</span>
          <small>${esc(String(p.a.props?.cad_num || p.a.props?.name || "объект"))}</small>
        </button>`).join("");
      $("ld-results").querySelectorAll("[data-id]").forEach(el => el.addEventListener("click", () => {
        const f = (state.features || []).find(x => String(x.id) === el.dataset.id);
        if (!f) return;
        state.selected = f.id;
        state.selectedIds = new Set([f.id]);
        if (typeof zoomToFeature === "function") zoomToFeature(f);
        else if (typeof draw === "function") draw();
      }));
    });
    const закрыть = () => overlay.remove();
    $("ld-cancel").addEventListener("click", закрыть);
    overlay.querySelector(".modal-x").addEventListener("click", закрыть);
    root.dockOverlay?.(overlay, { title: "Сверка слоёв" });
  }

  root.openLayerDiff = openLayerDiff;
  document.getElementById("btn-layer-diff")?.addEventListener("click", openLayerDiff);
})(typeof window !== "undefined" ? window : globalThis);
