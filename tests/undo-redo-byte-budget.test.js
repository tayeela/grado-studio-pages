"use strict";

// Ctrl+Z/Ctrl+Shift+Z обходили потолок памяти истории по объёму.
//
// pushHistoryEntry (обычная правка) держит state.undo под HISTORY_BYTE_BUDGET
// (64 МБ) двумя порогами разом: числом шагов (undoDepth, зависит от числа
// объектов) и суммой freshBytes (trimHistoryToBudget). Только ПЕРВЫЙ порог
// перекочевал в undo()/redo() — они пушат снимок в противоположный стек и
// режут его тем же undoDepth(), но trimHistoryToBudget не зовут вовсе.
//
// На проекте с малым числом объектов, но одной огромной геометрией (undoDepth
// упирается в потолок 100 шагов — он считает объекты, не байты) простое
// чередование Ctrl+Z/Ctrl+Shift+Z без единой новой правки копит в state.undo
// и state.redo сколько угодно мегабайт — ровно то, что HISTORY_BYTE_BUDGET
// был обязан не допустить.

const assert = require("node:assert/strict");
const { читатьЧистый } = require("./_source");

const src = читатьЧистый("app-history.js");

// ---------- обычная правка: три шага в правильном порядке ----------
{
  const push = src.slice(src.indexOf("function pushHistoryEntry"), src.indexOf("function snapshot"));
  const push_i = push.indexOf("state.undo.push(entry);");
  const depth_i = push.indexOf("while (state.undo.length > max) state.undo.shift();");
  const budget_i = push.indexOf("trimHistoryToBudget(state.undo);");
  assert.ok(push_i >= 0 && depth_i > push_i && budget_i > depth_i,
    "эталон: push → отрез по числу шагов → отрез по байтам, в этом порядке");
}

// ---------- undo(): бюджет применяется к стеку, в который толкаем снимок ----------
{
  const fn = src.slice(src.indexOf("function undo()"), src.indexOf("function redo()"));
  const push_i = fn.indexOf("state.redo.push(current);");
  const depth_i = fn.indexOf("while (state.redo.length > undoDepth()) state.redo.shift();");
  const budget_i = fn.indexOf("trimHistoryToBudget(state.redo);");
  assert.ok(push_i >= 0 && depth_i > push_i, "число шагов обязано резаться и здесь — это уже было");
  assert.ok(budget_i > depth_i,
    "trimHistoryToBudget(state.redo) обязан идти следом: без него отмена на " +
    "крупной геометрии копит мегабайты, которые обычная правка копить не даёт");
  // бюджет обязан примениться ДО restoreHistoryEntry — иначе исключение в
  // восстановлении оставит стек несрезанным ровно на кадре, где он разросся
  assert.ok(budget_i < fn.indexOf("restoreHistoryEntry(entry);"),
    "отрез по байтам обязан случиться до попытки восстановления");
}

// ---------- redo(): симметрично ----------
{
  const fn = src.slice(src.indexOf("function redo()"), src.indexOf("window.captureHistoryState"));
  const push_i = fn.indexOf("state.undo.push(current);");
  const depth_i = fn.indexOf("while (state.undo.length > undoDepth()) state.undo.shift();");
  const budget_i = fn.indexOf("trimHistoryToBudget(state.undo);");
  assert.ok(push_i >= 0 && depth_i > push_i && budget_i > depth_i,
    "redo() обязан резать по байтам симметрично undo()");
  assert.ok(budget_i < fn.indexOf("restoreHistoryEntry(entry);"));
}

// ---------- сам trimHistoryToBudget не трогает единственную запись ----------
{
  const vm = require("node:vm");
  const start = src.indexOf("const HISTORY_BYTE_BUDGET");
  const end = src.indexOf("function pushHistoryEntry");
  const context = vm.createContext({});
  vm.runInContext(src.slice(start, end), context);
  const trim = vm.runInContext("trimHistoryToBudget", context);

  const big = n => ({ freshBytes: n });
  const stack = [big(40 * 1024 * 1024), big(30 * 1024 * 1024), big(50 * 1024 * 1024)];
  trim(stack);
  assert.ok(stack.length >= 1, "хотя бы один снимок обязан остаться — иначе отменять станет нечего");
  const total = stack.reduce((s, e) => s + e.freshBytes, 0);
  assert.ok(stack.length === 1 || total <= 64 * 1024 * 1024,
    "сумма freshBytes оставшихся записей обязана укладываться в бюджет");
}

console.log("undo-redo-byte-budget: OK");
