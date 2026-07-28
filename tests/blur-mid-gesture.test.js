"use strict";

// Уход в другое окно посреди работы терял правку и начатый контур.
//
// Правка вершин двигает геометрию прямо в pointermove, а закрепляет её
// afterChange на pointerup: он сбрасывает пространственный индекс и индекс
// привязок, пересчитывает ТЭП и ставит метку «изменено» для автосохранения.
// Обработчик blur обнулял state.edit молча, БЕЗ afterChange. Alt-tab с зажатой
// кнопкой (или системный диалог, всплывший поверх) оставлял геометрию уже
// сдвинутой, а индексы — со старыми координатами: привязка цеплялась за
// пустое место, ТЭП показывал прежнюю площадь.
//
// Вторая половина — черчение. state.drawing живёт между кликами по замыслу:
// контур набирают многими кликами. Обнуление на blur означало, что переход в
// другое окно за координатой стирал начатый контур целиком. Отменяет черчение
// Escape, и только он.

const assert = require("node:assert/strict");
const { читатьЧистый } = require("./_source");

const src = читатьЧистый("app-input.js");
const начало = src.indexOf('window.addEventListener("blur"');
assert.ok(начало > 0, "обработчик потери фокуса обязан оставаться находимым");
const тело = src.slice(начало, src.indexOf("});", начало) + 3);

assert.match(тело, /afterChange\(\)/,
  "сдвинутую геометрию обязан закрепить afterChange — иначе индексы привязок и " +
  "пространственный индекс останутся со старыми координатами");
assert.match(тело, /const moved = state\.edit\.moved;/,
  "закреплять надо только реально сдвинутое: afterChange на каждый alt-tab " +
  "перестраивал бы индексы впустую");
assert.ok(!/state\.drawing/.test(тело),
  "начатый контур обязан пережить уход в другое окно: state.drawing — не " +
  "залипшее нажатие, а многокликовый жест, его отменяет Escape");
assert.match(тело, /state\.pan = null;/, "протяжка полотна без pointerup залипла бы");
assert.match(тело, /state\.drag = null;/, "рамка выделения ничего не меняла — её бросаем");

// ---------- на отпускании кнопки правило то же ----------
{
  const up = src.slice(src.indexOf("if (state.edit) {", src.indexOf("if (state.pan) { state.pan = null; return; }")));
  assert.match(up.slice(0, 200), /if \(moved\) afterChange\(\);/,
    "blur обязан повторять поведение pointerup, а не заводить своё");
}

// ---------- Escape по-прежнему бросает черчение ----------
{
  const esc = src.slice(src.indexOf('if (e.key === "Escape") {'));
  assert.match(esc.slice(0, 600), /if \(state\.drawing\) \{ state\.drawing = null; draw\(\); return; \}/,
    "должен остаться путь, которым начатый контур всё же отменяют — Escape");
}

console.log("blur-mid-gesture: OK");
