"use strict";

// Пять находок мультиагентного аудита вёрстки — мелкие каждая по отдельности,
// но того самого класса, что уже ловил tools/ui-audit.js: несогласованность
// между «как задумано» и «что реально применяется».

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const studio2 = fs.readFileSync(path.join(root, "redesign", "studio2.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "redesign", "shell.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// ---------- счётчик источника в шаге «Проверка» читаем на тёмном фоне ----------
// Живой замер tools/ui-audit.js на .modal-overlay: 4.31:1 при норме 4.5:1,
// цвет rgb(49,91,234) (--accent) на rgb(226,228,233) (--accent-weak). Тот же
// текст-на-тинте уже чинили для .data-source-count.selected (commit 342799a);
// это правило осталось несделанным соседом того же исправления.
assert.match(studio2, /\.data-review-list header span\{[^}]*color:var\(--accent-on-tint\)/,
  "счётчик выбранных слоёв в обзоре обязан брать text-on-tint, а не --accent " +
  "напрямую — 4.31:1 ниже нормы WCAG AA 4.5:1");

// ---------- мёртвое правило ширины окна «Данные» удалено, а не забыто ----------
// .modal-overlay .modal.data-modal (специфичность 0,0,3,0) всегда выигрывает у
// .modal.data-modal (0,0,2,0), а app-data.js всегда оборачивает .data-modal в
// .modal-overlay — 524px никогда не применялось, только вводило в заблуждение
// того, кто ищет реальную ширину окна по тексту файла.
assert.ok(!/\.modal\.data-modal\{width:min\(524px/.test(studio2),
  "недостижимое правило ширины 524px обязано быть удалено, а не просто " +
  "перекрыто более специфичным — иначе рефакторинг соседнего правила однажды " +
  "тихо вернёт его к жизни");

// ---------- orphaned CSS в shell.css — не просто мёртвый код, а порча парсинга ----------
// Строка без селектора внутри @media: парсер CSS считает её ошибкой прямо в
// момент разбора qualified rule и отбрасывает; после правки следующее правило
// внутри того же @media обязано остаться синтаксически цельным.
assert.ok(!/^\s*width:auto;transform:translateY\(-54%\)\}\s*$/m.test(shell),
  "осиротевший фрагмент (хвост удалённого .start-guide) обязан быть удалён");
assert.match(shell, /body\.panel-hidden #panel\{display:flex;transform:translateX\(102%\);visibility:hidden;pointer-events:none\}\s*\n\s*\.phbtn\.panel-close\{display:grid\}/,
  "после удаления сироты соседние правила обязаны остаться цельными — вплотную, без обрывка между ними");

// ---------- инлайн-размер иконок в шапке панели больше не лжёт ----------
// redesign/studio2.css:189 .panel-head .phbtn .ic{width:20px!important;...} —
// !important всегда выигрывает у инлайн-стиля независимо от порядка/специфики,
// поэтому инлайн 17×17 никогда не применялся; иконки реально рисуются 20×20.
assert.ok(!/<svg class="ic" style="width:17px;height:17px">/.test(html),
  "мёртвый инлайн-размер (переопределён !important в CSS) обязан быть удалён " +
  "из разметки — иначе тот, кто читает index.html, узнаёт неверный размер");
assert.match(studio2, /\.panel-head \.phbtn \.ic\{width:20px!important;height:20px!important\}/,
  "реальный размер по-прежнему приходит из CSS — правило само осталось на месте");

// ---------- предупреждение/ошибка преполёта следят за тёмной темой ----------
// Раньше border-color был rgba(220,38,38,.34) / rgba(217,119,6,.34) — точная
// RGB-расшифровка СВЕТЛЫХ --danger/--warning; на тёмной теме токены другие
// (#f4544f/#f0a13a), а рамка эти байты никогда бы не увидела.
assert.ok(!/rgba\(220,\s*38,\s*38,/.test(studio2) && !/rgba\(217,\s*119,\s*6,/.test(studio2),
  "рамки преполёта не должны нести зашитые байты СВЕТЛОЙ темы");
assert.match(studio2, /\.preflight-item\.error\{border-color:color-mix\(in srgb,var\(--danger\) 45%,transparent\)/,
  "ошибка преполёта обязана брать --danger живым токеном, как соседние " +
  "*-summary.error в этом же файле");
assert.match(studio2, /\.preflight-item\.warning\{border-color:color-mix\(in srgb,var\(--warning\) 45%,transparent\)\}/,
  "предупреждение преполёта — туда же");

console.log("ui-audit-followups: OK");
