// Строка ввода при построении: длина, угол, приращение, точка по координатам.
//
// Чем это было раньше: клавиатурный ввод принимал ТОЛЬКО цифры и работал в
// преобразованиях и радиусе окружности. Начертить контур по каталогу координат
// из ГПЗУ или межевого плана было нельзя — только мышью по привязкам, то есть
// приблизительно. Именно поэтому работу уносили в AutoCAD.
//
// Соглашения выбраны как в CAD и названы в подсказке, чтобы не гадать:
//   - ТОЧКА — десятичный разделитель, ЗАПЯТАЯ — разделитель координат.
//     «25,10» это пара, а не «двадцать пять с половиной»;
//   - угол в градусах, 0° — на восток, положительный — против часовой
//     (соглашение AutoCAD). Дирекционный угол (от севера по часовой) — другая
//     величина, она нужна в ведомости координат и считается отдельно;
//   - «X= Y=» — ГЕОДЕЗИЧЕСКИЙ порядок: X это север, Y это восток. На холсте
//     наоборот, x — восток. Перепутанные оси дают контур, повёрнутый на 90°,
//     поэтому эта форма разбирается отдельно и помечена в подсказке.
(function (root) {
  "use strict";

  const num = s => {
    const v = parseFloat(String(s).trim());
    return Number.isFinite(v) ? v : null;
  };

  // Разбор набранного. Возвращает { x, y, kind } в координатах холста
  // (метры проекта, x — восток, y — север) либо null, если строка не полна.
  //
  // last   — последняя поставленная точка [x, y] или null;
  // cursor — текущая точка курсора [x, y] или null.
  function parseInputLine(text, opts) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return null;
    const last = (opts && opts.last) || null;
    const cursor = (opts && opts.cursor) || null;

    // 1) геодезическая пара: X= север, Y= восток (в любом порядке записи)
    const gx = /(^|[\s;,])x\s*=\s*(-?[\d.]+)/i.exec(t);
    const gy = /(^|[\s;,])y\s*=\s*(-?[\d.]+)/i.exec(t);
    if (gx && gy) {
      const север = num(gx[2]), восток = num(gy[2]);
      if (север == null || восток == null) return null;
      return { x: восток, y: север, kind: "геодезическая" };
    }
    if (gx || gy) return null;                 // набрана половина — ждём вторую

    // 2) полярный ввод: длина<угол
    if (t.includes("<")) {
      const [l, a] = t.split("<");
      const длина = num(l), угол = num(a);
      if (длина == null || угол == null || !last) return null;
      const рад = угол * Math.PI / 180;
      return { x: last[0] + длина * Math.cos(рад), y: last[1] + длина * Math.sin(рад),
               kind: "полярная" };
    }

    // 3) пара координат: «@dx,dy» — приращение, «x,y» — абсолютная.
    // Разделителем принимаем и пробел с точкой с запятой: так набирали до
    // появления этого разбора («100 200»), и ломать привычку нельзя.
    if (/[,;\s]/.test(t)) {
      const отн = t.startsWith("@");
      const [a, b] = (отн ? t.slice(1) : t).trim().split(/[,;\s]+/);
      const u = num(a), v = num(b);
      if (u == null || v == null) return null;
      if (!отн) return { x: u, y: v, kind: "абсолютная" };
      if (!last) return null;
      return { x: last[0] + u, y: last[1] + v, kind: "приращение" };
    }

    // 4) одно число — длина по направлению курсора от последней точки
    const длина = num(t);
    if (длина == null || !last || !cursor) return null;
    const dx = cursor[0] - last[0], dy = cursor[1] - last[1];
    const d = Math.hypot(dx, dy);
    if (!(d > 1e-9)) return null;              // курсор в той же точке — направления нет
    return { x: last[0] + dx / d * длина, y: last[1] + dy / d * длина, kind: "длина" };
  }

  // Что показать человеку, пока он набирает: как приложение поняло строку.
  function describeInputLine(text, opts) {
    const p = parseInputLine(text, opts);
    if (!p) {
      if (/x\s*=/i.test(text) || /y\s*=/i.test(text)) return "X= север, Y= восток";
      if (String(text).includes("<")) return "длина<угол, 0° на восток";
      if (String(text).startsWith("@")) return "@ приращение от последней точки";
      if (String(text).includes(",")) return "x,y — абсолютная точка";
      return "длина по направлению · < угол · @ приращение · X= Y=";
    }
    return p.kind + ": " + p.x.toFixed(2) + " / " + p.y.toFixed(2);
  }

  // Хвост подписи на холсте: два пробела и объяснение, как понята строка.
  // Живёт здесь, а не в отрисовке: там каждая строка на счету у храповика,
  // а объяснение — часть договора о вводе, а не часть рисования.
  function typedInputSuffix(text, last, cursor) {
    const как = describeInputLine(text, { last, cursor });
    return как ? "   " + как : "";
  }

  // ---------- каталог координат ----------
  //
  // Каталог приходит вставкой из ГПЗУ, межевого плана, Word или Excel и никогда
  // не выглядит одинаково: где-то «1  7383.45  12456.78», где-то
  // «т1;7383,45;12456,78», где-то с шапкой «№ X Y» и подписью внизу.
  //
  // Десятичный разделитель здесь — ЗАПЯТАЯ, и это осознанно наоборот к строке
  // ввода. Там набирают руками, и «25,10» — пара координат. Здесь числа
  // приходят из документа, где «7383,45» это сорок пять сотых, а столбцы
  // разделены табуляцией, точкой с запятой или пробелами. Два правила живут в
  // разных функциях, и оба названы в интерфейсе — иначе не угадать.
  //
  // Из строки берутся ДВА ПОСЛЕДНИХ числа: номер точки почти всегда стоит
  // первым и иначе попал бы в координаты. Строки без двух чисел (шапка,
  // подпись, пустые) пропускаются и возвращаются человеку — пусть видит, что
  // именно не разобрано, а не «загрузилось 7 из 9».
  function parseCoordTable(text, opts) {
    const порядок = (opts && opts.order) || "geodetic";      // X север первым
    const точки = [], пропущено = [];
    for (const строка of String(text == null ? "" : text).split(/\r?\n/)) {
      if (!строка.trim()) continue;
      // Запятая НЕ разделитель столбцов: иначе «7401,22» разваливается на
      // 7401 и 22, и в контур уходит точка, которой в документе нет. Столбцы
      // делит табуляция, точка с запятой, палка или пробелы.
      const числа = [];
      for (const кусок of строка.split(/[\t;|\s]+/)) {
        const t = кусок.trim().replace(",", ".");
        if (/^-?\d+(\.\d+)?$/.test(t)) числа.push(parseFloat(t));
      }
      if (числа.length < 2) { пропущено.push(строка.trim().slice(0, 40)); continue; }
      const a = числа[числа.length - 2], b = числа[числа.length - 1];
      точки.push(порядок === "geodetic" ? [b, a] : [a, b]);
    }
    return { точки, пропущено };
  }

  // Сведения о разобранном контуре: сколько точек, замкнут ли, площадь и
  // периметр. Замыкание — по совпадению первой и последней точки: в каталогах
  // его пишут по-разному, и решать за человека нельзя, можно только показать.
  function coordTableSummary(точки) {
    const n = точки.length;
    if (n < 2) return { точек: n, замкнут: false, зазор: 0, площадь: 0, периметр: 0 };
    const первый = точки[0], последний = точки[n - 1];
    const зазор = Math.hypot(последний[0] - первый[0], последний[1] - первый[1]);
    const замкнут = зазор < 0.005;                 // 5 мм — это уже одна точка
    const кольцо = замкнут ? точки.slice(0, n - 1) : точки;
    let периметр = 0;
    for (let i = 1; i < n; i++)
      периметр += Math.hypot(точки[i][0] - точки[i - 1][0], точки[i][1] - точки[i - 1][1]);
    let удвоенная = 0;
    for (let i = 0; i < кольцо.length; i++) {
      const p = кольцо[i], q = кольцо[(i + 1) % кольцо.length];
      удвоенная += p[0] * q[1] - q[0] * p[1];
    }
    return { точек: n, замкнут, зазор: +зазор.toFixed(3),
             площадь: Math.abs(удвоенная) / 2, периметр };
  }

  // Окно «Точки по координатам»: вставил каталог из документа — получил контур.
  //
  // Порядок столбцов спрашиваем ЯВНО и показываем итог до вставки: перепутанные
  // оси дают контур, повёрнутый на 90°, и заметить это по числам нельзя — только
  // по площади и по тому, куда лёг объект.
  function openCoordTable() {
    if (typeof document === "undefined") return;
    if (typeof closePopups === "function") closePopups();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal fmt-modal coord-table-modal" role="dialog" aria-modal="true" aria-labelledby="ct-title">
      <div class="modal-head modal-head-rich"><span class="modal-head-copy"><span class="modal-kicker">Точный ввод</span><span id="ct-title">Точки по координатам</span></span>
        <button class="modal-x" aria-label="Закрыть ввод по координатам"><svg class="ic"><use href="#ic-close"/></svg></button></div>
      <div class="modal-body compact">
        <label>Каталог координат<textarea id="ct-text" rows="9" spellcheck="false"
          placeholder="1&#9;7383,45&#9;12456,78&#10;2&#9;7401,22&#9;12489,10&#10;&#10;Вставьте таблицу из ГПЗУ, межевого плана или Excel.&#10;Шапка и подписи будут пропущены."></textarea></label>
        <div class="fmt-row">
          <label>Порядок столбцов<select id="ct-order">
            <option value="geodetic">X — север, Y — восток (МСК, как в документах)</option>
            <option value="math">X — восток, Y — север (математический)</option>
          </select></label>
          <label>Что создать<select id="ct-kind">
            <option value="ring">Замкнутый контур</option>
            <option value="line">Линию</option>
          </select></label>
        </div>
        <div class="fc-help" id="ct-summary" role="status" aria-live="polite">Вставьте каталог — здесь появится итог.</div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button id="ct-cancel">Отмена</button>
        <button id="ct-ok" class="primary" disabled>Создать объект</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => event.stopPropagation());
    const $ = id => overlay.querySelector("#" + id);
    const close = () => overlay.remove();
    overlay.querySelector(".modal-x").addEventListener("click", close);
    $("ct-cancel").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });

    let точки = [];
    const пересчитать = () => {
      const r = parseCoordTable($("ct-text").value, { order: $("ct-order").value });
      точки = r.точки;
      const с = coordTableSummary(точки);
      const га = с.площадь ? ` (${(с.площадь / 10000).toFixed(4)} га)` : "";
      const строки = [];
      строки.push(`Точек: ${с.точек}`);
      if (с.точек >= 3) строки.push(`Площадь: ${с.площадь.toFixed(2)} м²${га}`);
      if (с.точек >= 2) строки.push(`Периметр: ${с.периметр.toFixed(2)} м`);
      строки.push(с.замкнут ? "Контур замкнут"
        : с.точек >= 3 ? `Не замкнут: зазор ${с.зазор} м — замкнём сами` : "");
      if (r.пропущено.length)
        строки.push(`Пропущено строк: ${r.пропущено.length} — ${r.пропущено.slice(0, 3).join(" · ")}`);
      $("ct-summary").textContent = строки.filter(Boolean).join(" · ");
      $("ct-ok").disabled = точки.length < 2;
    };
    $("ct-text").addEventListener("input", пересчитать);
    $("ct-order").addEventListener("change", пересчитать);
    $("ct-kind").addEventListener("change", пересчитать);

    $("ct-ok").addEventListener("click", () => {
      const L = typeof activeLayer === "function" ? activeLayer() : null;
      if (!L) { if (typeof toast === "function") toast("Создайте слой, чтобы вставить контур", "warn"); return; }
      const кольцо = $("ct-kind").value === "ring";
      const с = coordTableSummary(точки);
      // замыкающую точку в кольцо не кладём: контур замыкается сам
      const pts = (кольцо && с.замкнут) ? точки.slice(0, -1) : точки.slice();
      if (кольцо && pts.length < 3) {
        if (typeof toast === "function") toast("Для контура нужно не меньше трёх точек", "warn");
        return;
      }
      if (typeof addFeature === "function") addFeature(L.id, кольцо ? { ring: pts } : { line: pts });
      close();
      if (typeof toast === "function")
        toast(`Вставлено по каталогу: ${pts.length} точек` +
          (кольцо ? `, площадь ${с.площадь.toFixed(2)} м²` : `, длина ${с.периметр.toFixed(2)} м`));
    });
    setTimeout(() => $("ct-text").focus(), 0);
  }

  root.openCoordTable = openCoordTable;
  root.typedInputSuffix = typedInputSuffix;
  root.parseInputLine = parseInputLine;
  root.describeInputLine = describeInputLine;
  root.parseCoordTable = parseCoordTable;
  root.coordTableSummary = coordTableSummary;
  if (typeof module !== "undefined" && module.exports)
    module.exports = { parseInputLine, describeInputLine, parseCoordTable, coordTableSummary };
})(typeof window !== "undefined" ? window : globalThis);
