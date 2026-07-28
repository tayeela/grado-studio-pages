"use strict";

// Отмена жеста браузером/ОС — pointercancel, не pointerup — оставляла правку
// в памяти без afterChange().
//
// iOS Safari шлёт pointercancel захватившему элементу на edge-swipe-back
// поверх открытого чертежа, Android — на notification pull-down, оба — на
// конкурирующий тач. setPointerCapture (взятый на pointerdown) не спасает:
// capture теряется вместе с самим жестом, а pointerup после этого уже не
// приходит. Правка вершин двигает геометрию прямо в pointermove — к моменту
// отмены state.features уже отражает новые координаты, а afterChange()
// (пересчёт индексов, ТЭП, автосохранение) без pointerup не срабатывал.
// Ровно тот класс дефекта, что чинили для blur (см. blur-mid-gesture) —
// только источник прерывания другой, и обработчика не было вовсе.

const assert = require("node:assert/strict");
const { читатьЧистый } = require("./_source");

const src = читатьЧистый("app-input.js");
const начало = src.indexOf('cv.addEventListener("pointercancel"');
assert.ok(начало > 0, "обработчик pointercancel обязан существовать — иначе прерванный тач теряет правку молча");
const тело = src.slice(начало, src.indexOf("});", начало) + 3);

assert.match(тело, /afterChange\(\)/,
  "сдвинутую геометрию обязан закрепить afterChange — как и у pointerup/blur");
assert.match(тело, /const moved = state\.edit\.moved;/,
  "закреплять надо только реально сдвинутое");
assert.match(тело, /if \(state\.labelDrag\) \{/,
  "перетаскивание подписи — та же уязвимость к обрыву жеста, что и правка вершин");
assert.match(тело, /if \(!d\.moved\) \{/,
  "подпись без единого движения обязана откатиться, а не закрепиться пустышкой");
assert.match(тело, /state\.pan = null;/);
assert.match(тело, /state\.drag = null;/);

// слушатель — на cv (захватившем элементе), а не на window: pointercancel
// приходит туда, куда был взят setPointerCapture, а не в window
assert.equal(src.slice(Math.max(0, начало - 5), начало + 40).trim().startsWith("cv.addEventListener"), true,
  "pointercancel обязан слушаться на cv — на window он не дойдёт");

console.log("pointercancel-mid-gesture: OK");
