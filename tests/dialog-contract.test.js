"use strict";

// Единый контракт окон (трек B спеки о слаженности).
//
// Раньше каждое окно заводило закрытие само — и 18 из 40 его не завели:
// одни не закрывались Escape, другие кликом мимо, третьи ни так ни так.
// Чинить по одному бессмысленно: следующее написанное окно снова забудет.
// Поэтому контракт живёт в ОДНОМ месте и распространяется на все окна,
// включая те, которых ещё нет.
//
// Здесь проверяется, что общий механизм на месте и устроен правильно:
// закрытие идёт через СОБСТВЕННУЮ кнопку окна (иначе не отработает его
// уборка — предпросмотр массива останется на холсте, а живой предпросмотр
// стиля не откатится), Escape перехватывается раньше холста, а клик мимо
// не трогает уже отсоединённое окно.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = require("./app-source");

// ---------- механизм на месте ----------
assert.match(app, /function dismissOverlay\(overlay\)/,
  "общее закрытие окна обязано существовать в одном месте");
assert.match(app, /function topOverlay\(\)/,
  "верхнее окно определяется централизованно (окна могут стоять стопкой)");

// ---------- закрытие через собственную кнопку окна ----------
{
  const fn = app.slice(app.indexOf("function dismissOverlay(overlay)"),
    app.indexOf("function topOverlay()"));
  assert.match(fn, /\.modal-x/,
    "закрываем нажатием крестика окна, а не удалением узла — иначе не " +
    "отработает уборка окна (откат стиля, снятие предпросмотра)");
  assert.match(fn, /отмена\|закрыть/i,
    "у окон без крестика используется его же кнопка отмены");
  assert.match(fn, /overlay\.remove\(\)/,
    "удаление — крайний случай, когда у окна нет ни крестика, ни отмены");
  assert.match(fn, /isConnected/,
    "отсоединённое окно не трогаем: оно уже закрылось своим обработчиком");
}

// ---------- Escape перехватывается раньше холста ----------
{
  const at = app.indexOf('document.addEventListener("keydown", event => {\r\n  if (event.key !== "Escape") return;');
  const alt = app.indexOf('document.addEventListener("keydown", event => {\n  if (event.key !== "Escape") return;');
  const start = at >= 0 ? at : alt;
  assert.ok(start > 0, "глобальный обработчик Escape для окон обязан существовать");
  const block = app.slice(start, start + 900);
  assert.match(block, /\}, true\);/,
    "Escape ловится в фазе перехвата: пока окно открыто, клавиша принадлежит " +
    "ему, а не холсту (иначе холст отменял бы черчение за спиной окна)");
  assert.match(block, /ctx-menu/,
    "Escape закрывает и контекстное меню — контракт общий");
  assert.match(block, /if \(!overlay\) \{/,
    "когда окон нет, Escape уходит холсту без изменений");
}

// ---------- клик мимо ----------
{
  const at = app.indexOf('document.addEventListener("click", event => {');
  assert.ok(at > 0, "глобальный обработчик клика мимо окна обязан существовать");
  const block = app.slice(at, at + 500);
  assert.match(block, /classList\.contains\("modal-overlay"\)/,
    "закрывает только клик по подложке, не по содержимому окна");
}

console.log("dialog-contract: OK");
