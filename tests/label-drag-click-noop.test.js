"use strict";

// Клик по подписи БЕЗ прежнего смещения коммитил несуществующую правку.
//
// Отмена «почти нулевого сдвига» проверялась правдивостью d.f.label_offset —
// но у объекта, чью подпись двигают ВПЕРВЫЕ, label_offset не существует, пока
// его не запишет pointermove. Клик без единого pointermove (или с движением
// меньше порога — тот же жест, тач-дребезг, дрожь руки) оставлял
// d.f.label_offset === undefined; проверка `d.f.label_offset && ...` читала
// undefined как «не откатываем» и уходила в ветку коммита: afterChange() и
// тост «закреплена» на объекте, который никто не двигал, плюс лишняя запись
// на undo (снятый на pointerdown снимок никогда не откатывался).
//
// Правило чинится явным флагом «двигали ли вообще» — тем же паттерном, что
// уже есть у state.edit.moved и state.drag.moved в этом файле.

const assert = require("node:assert/strict");
const { читатьЧистый } = require("./_source");

const src = читатьЧистый("app-input.js");

// ---------- флаг заводится при начале переноса ----------
assert.match(src, /state\.labelDrag = \{ f, startX: wxr, startY: wyr, moved: false,/,
  "перенос подписи обязан начинаться с moved: false — как edit/drag");

// ---------- pointermove отмечает реальное движение ----------
{
  const start = src.indexOf("if (state.labelDrag) {");
  const тело = src.slice(start, src.indexOf("return;", start) + 7);
  assert.match(тело, /d\.moved = true;/,
    "pointermove обязан отмечать, что подпись действительно двигали");
}

// ---------- pointerup откатывает клик без движения ----------
{
  const start = src.indexOf('window.addEventListener("pointerup"');
  const тело = src.slice(start, src.indexOf("if (state.pan)", start));
  assert.match(тело, /if \(!d\.moved \|\| \(d\.f\.label_offset && Math\.hypot/,
    "клик без единого pointermove обязан откатываться так же, как почти " +
    "нулевой сдвиг — иначе именно он проходил мимо старой проверки");
}

console.log("label-drag-click-noop: OK");
