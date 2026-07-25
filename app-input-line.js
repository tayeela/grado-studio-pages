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

  root.typedInputSuffix = typedInputSuffix;
  root.parseInputLine = parseInputLine;
  root.describeInputLine = describeInputLine;
  if (typeof module !== "undefined" && module.exports)
    module.exports = { parseInputLine, describeInputLine };
})(typeof window !== "undefined" ? window : globalThis);
