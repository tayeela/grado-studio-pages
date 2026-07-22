"use strict";

// Четыре внешних скрипта в <head> (crs, pages-core, pages-adapter, canvas-theme
// — 143 КБ) исполнялись ДО таблиц стилей: браузер не мог показать страницу,
// пока не выполнит их все, а стили в это время даже не начинали качаться.
// Порядок исполнения при этом ЖЁСТКИЙ: правила ГИС ОГД должны стоять до ядра,
// адаптер обязан подменить fetch до app.js, а оболочка в конце body раньше шла
// последней — поэтому здесь проверяется не «стоит defer», а порядок.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const head = html.slice(0, html.indexOf("</head>"));

// ---------- стили начинают качаться раньше скриптов ----------
const firstScript = head.search(/<script/);
const lastCss = head.lastIndexOf("<link rel=\"stylesheet\"");
assert.ok(lastCss > 0 && lastCss < firstScript,
  "все таблицы стилей обязаны стоять до первого скрипта — иначе они ждут его выполнения");

// ---------- ни одного блокирующего внешнего скрипта ----------
const external = [...html.matchAll(/<script([^>]*)\ssrc="([^"]+)"/g)];
// collab.js на Pages не подключается: сервера с --hub там нет, включиться он
// не может никогда, а весил 30 КБ в каждой загрузке
assert.ok(external.length >= 17, "скрипты приложения должны остаться на месте");
assert.doesNotMatch(html, /<script[^>]*src="\.\/collab\.js/,
  "мёртвый в браузерной сборке модуль не должен качаться");
for (const [, attrs, src] of external)
  assert.ok(/\bdefer\b/.test(attrs), `скрипт ${src} блокирует разбор разметки`);
assert.ok(!/<script[^>]*\basync\b/.test(html),
  "async ломает порядок: ядро может исполниться раньше правил, а app.js — раньше адаптера");

// ---------- порядок исполнения ----------
const at = needle => {
  const i = html.indexOf(needle);
  assert.ok(i > 0, `не найдено: ${needle}`);
  return i;
};
// вставки исполняются при разборе, то есть раньше любого defer — правила и
// версия сборки успевают лечь в window до ядра
assert.ok(at("__GRADO_GISOGD_RULES__") < at("pages-core.js"), "правила ГИС ОГД — до ядра");
assert.ok(at("__GRADO_GP_ZONE_RULES__") < at("pages-core.js"), "правила зон — до ядра");
assert.ok(at("__GRADO_ASSET_VERSION__") < at("pages-core.js"), "версия сборки — до ядра");
// между отложенными порядок сохраняется по документу
assert.ok(at("crs.js") < at("pages-core.js"), "система координат — до ядра");
assert.ok(at("pages-core.js") < at("pages-adapter.js"), "ядро — до адаптера");
assert.ok(at("pages-adapter.js") < at('src="./app.js'),
  "адаптер обязан подменить fetch до app.js, иначе первый же запрос уйдёт в сеть");
assert.ok(at('src="./app.js') < at('src="./app-vector.js'), "порядок модулей приложения цел");

// ---------- тема без вспышки ----------
// canvas-theme.js теперь отложен, а он ставил data-theme при загрузке: без
// вставки в голове пользователь тёмной темы получал вспышку светлого
const boot = head.slice(head.indexOf("<script"), head.indexOf("__GRADO_GISOGD_RULES__"));
assert.match(boot, /localStorage\.getItem\("grado-theme"\)/, "стартовая тема берётся из сохранённого выбора");
assert.match(boot, /prefers-color-scheme: dark/, "выбора нет — берём системную");
assert.match(boot, /setAttribute\("data-theme",t\)/, "тема обязана стоять до первой отрисовки");
assert.ok(head.indexOf("grado-theme") < head.indexOf("crs.js"),
  "вставка темы обязана исполняться раньше отложенных скриптов");
const themeJs = fs.readFileSync(path.join(root, "canvas-theme.js"), "utf8");
assert.match(themeJs, /localStorage\.getItem\('grado-theme'\)|getItem\("grado-theme"\)/,
  "ключ темы в голове и в canvas-theme.js обязан быть один");

// ---------- оболочка поднимается после движка ----------
// хвостовая вставка раньше шла последней; отложенные скрипты исполняются после
// разбора, поэтому без обёртки она обогнала бы их
const tail = html.slice(html.lastIndexOf("<script>"));
assert.match(tail, /document\.addEventListener\('DOMContentLoaded', function \(\) \{/,
  "иначе оболочка поднимется раньше app.js и не найдёт элементов");
assert.ok(tail.trim().endsWith("});\n</script>\n</body>\n</html>".trim())
  || /\}\);\s*<\/script>/.test(tail), "обёртка обязана закрываться");

console.log("head-load-order: OK");
