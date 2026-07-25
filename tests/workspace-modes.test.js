"use strict";

// Режимы работы: каждый инструмент обязан быть достижим.
//
// Шесть инструментов — дуга, окружность, сопряжение, поворот, масштаб,
// зеркало — не показывались НИ В ОДНОМ режиме. Их прятал медиазапрос
// `@media (max-height:900px){ #toolbar:not(.expanded) .advanced-tool{display:none} }`,
// а единственную кнопку, которая ставила класс `expanded`, глушило правило
// `#toolbar .more-tools{display:none!important}` из другого файла. Каждая
// половинка выглядела осмысленной; вместе они выключали треть набора, и
// заметить это по коду одного файла было нельзя.
//
// Отсюда две проверки: инструмент приписан к режиму (иначе он не всплывёт
// никогда) и никакое правило не прячет его по условию, которое человек не
// может снять.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = ["redesign/shell.css", "redesign/atelier.css", "redesign/studio2.css"]
  .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");

// ---------- каждый инструмент приписан к режиму ----------
{
  const рельс = html.slice(html.indexOf('id="toolbar"'), html.indexOf("</aside>", html.indexOf('id="toolbar"')));
  const кнопки = [...рельс.matchAll(/<button[^>]*data-tool="([\w-]+)"[^>]*>/g)]
    .map(m => ({ имя: m[1], тег: m[0] }));
  assert.ok(кнопки.length >= 20, `инструментов в рельсе ${кнопки.length} — разбор сломался`);

  const РЕЖИМЫ = new Set(["draw", "edit", "geo", "measure"]);
  const бездомные = кнопки.filter(к =>
    !/class="[^"]*\btool-always\b/.test(к.тег) &&
    !РЕЖИМЫ.has((к.тег.match(/data-workspace-tool="([\w-]+)"/) || [])[1]));
  assert.deepEqual(бездомные.map(к => к.имя), [],
    "инструмент не приписан ни к одному режиму — переключение режимов его никогда не покажет.\n" +
    "  Добавьте data-workspace-tool=\"draw|edit|geo|measure\" или class=\"tool-always\".");
}

// ---------- ничто не прячет инструменты по несбрасываемому условию ----------
{
  // Класс, которым инструменты прячут, обязан сниматься живой кнопкой в
  // разметке. Иначе получается ровно прежняя ловушка: правило есть, снять
  // его нечем.
  const пряталки = [...css.matchAll(/#toolbar[^{}]*\.(advanced-tool|tool)\b[^{}]*\{[^}]*display\s*:\s*none[^}]*\}/g)]
    .map(m => m[0]);
  for (const п of пряталки) {
    const выключатель = (п.match(/#toolbar(?:\.|:not\(\.)([\w-]+)/) || [])[1];
    assert.ok(выключатель && new RegExp(`classList[^\\n]*["']${выключатель}["']`).test(html + css),
      "правило прячет инструменты, а снять его нечем:\n  " + п.replace(/\s+/g, " ") +
      "\n  Ровно так пропали дуга, окружность, сопряжение, поворот, масштаб и зеркало.");
  }
}

// ---------- на низком окне рельс разворачивается во вторую колонку ----------
{
  // Прокрутка в панели инструментов — не ответ: уехавшую за край половину
  // набора человек не видит и не ищет.
  assert.match(css, /@media \(max-height:820px\)\{[^}]*#toolbar\{[^}]*flex-wrap:wrap/,
    "на низком окне рельс обязан раскладываться в две колонки, а не прокручиваться");
}

// ---------- режим и инструмент держатся друг за друга ----------
{
  // Инструмент включается не только кнопкой рельса: горячей клавишей, кнопкой
  // «Повернуть» в панели свойств, восстановлением сеанса. Если режим при этом
  // не переходит туда, где кнопка видна, получается включённый инструмент без
  // нажатой кнопки — человек чертит вслепую. И наоборот: ушли из режима, а
  // инструмент оттуда остался включённым.
  const shell = fs.readFileSync(path.join(root, "app-shell.js"), "utf8");
  const ws = fs.readFileSync(path.join(root, "redesign/workspace.js"), "utf8");

  assert.match(shell, /dispatchEvent\(new CustomEvent\("grado:tool"/,
    "setTool обязан объявлять о смене инструмента: иначе режим о ней не узнает");
  assert.match(ws, /addEventListener\('grado:tool'/,
    "workspace.js обязан слушать смену инструмента и переходить в его режим");
  assert.match(ws, /setTool\('select'\)/,
    "при уходе из режима инструмент этого режима обязан сбрасываться в «Выбор»");

  // Раскладку берём из разметки, а не вторым списком в коде: два списка расходятся.
  assert.doesNotMatch(ws, /\{\s*polyline\s*:|['"]polyline['"]\s*:/,
    "раскладка «инструмент → режим» задаётся атрибутами data-workspace-tool, " +
    "а не отдельным списком в workspace.js — списки расходятся, разметка нет");
}

console.log("workspace-modes: OK");
