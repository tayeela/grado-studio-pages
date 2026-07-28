"use strict";

// Отмена чертежа меняла систему координат проекта и стирала легенду листа.
//
// historySmallState НАМЕРЕННО не кладёт в снимок настройки проекта: человек не
// ждёт, что Ctrl+Z после передвинутой вершины переключит подложку, состав
// альбома или СК. Но восстанавливает снимок та же функция, что открывает файл
// проекта, а там отсутствующее поле означает «старый проект» и подменяется
// умолчанием:
//   projectCrsId -> "utm37-legacy" + applyProjectCrs(reproject: false)
//   sheetLegend  -> null
//   alignOgd     -> true
// То есть каждая отмена уводила проект в историческую UTM 37N БЕЗ пересчёта
// координат: числа прежние, СК другая — вся последующая выгрузка уезжает не
// туда. Легенда листа при этом пропадала совсем.
//
// Держим оба конца: снимок этих полей не хранит (иначе отмена чертежа начнёт
// таскать за собой настройки), а restoreHistoryEntry возвращает их поверх.

const assert = require("node:assert/strict");
const { читатьЧистый } = require("./_source");

const src = читатьЧистый("app-history.js");

// ---------- снимок по-прежнему не таскает настройки проекта ----------
{
  const тело = src.slice(src.indexOf("function historySmallState"), src.indexOf("function historySnapshot"));
  for (const поле of ["projectCrsId", "sheetLegend", "albumConfig", "variants", "basemapSource"])
    assert.match(тело, new RegExp(`delete saved\\.${поле};`),
      `${поле} не принадлежит геометрической истории: отмена вершины не должна его менять`);
}

// ---------- восстановление возвращает их поверх умолчаний ----------
{
  const тело = src.slice(src.indexOf("function restoreHistoryEntry"), src.indexOf("function syncNextId"));
  for (const поле of ["projectCrsId", "sheetLegend", "alignOgd"]) {
    assert.match(тело, new RegExp(`${поле}: state\\.${поле}`),
      `${поле} обязано быть снято ДО applyRestoredState`);
    assert.match(тело, new RegExp(`state\\.${поле} = personal\\.${поле};`),
      `${поле} обязано вернуться ПОСЛЕ applyRestoredState, иначе встанет умолчание`);
  }
  assert.match(тело, /applyProjectCrs\(personal\.projectCrsId, \{ reproject: false, silent: true \}\)/,
    "мало вернуть номер СК в state: applyRestoredState уже переключил сам " +
    "преобразователь координат, его тоже надо вернуть");
  const снято = тело.indexOf("projectCrsId: state.projectCrsId");
  const восстановлено = тело.indexOf("state.projectCrsId = personal.projectCrsId");
  const применено = тело.indexOf("applyRestoredState(restored)");
  assert.ok(снято < применено && применено < восстановлено,
    "порядок обязан быть: снять — восстановить состояние — вернуть настройки");
}

// ---------- умолчание в загрузчике остаётся умолчанием загрузчика ----------
{
  const shell = читатьЧистый("app-shell.js");
  assert.match(shell, /state\.projectCrsId = typeof d\.projectCrsId === "string" \? d\.projectCrsId : "utm37-legacy";/,
    "для ОТКРЫТИЯ старого файла подстановка исторической СК верна — её и " +
    "оставляем; чинить надо было вызывающего, а не общий загрузчик");
}

console.log("undo-keeps-project-settings: OK");
