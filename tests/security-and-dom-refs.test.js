"use strict";

// 1. Цвета знаков приходят из ОТКРЫТОГО файла проекта и подставляются в
//    атрибут style="…". Экранирования там мало — нужен белый список синтаксиса.
// 2. Отдельный урок: удаление узла из разметки обязано сопровождаться удалением
//    ВСЕХ ссылок на него. Обработчик на удалённом #st-core падал при загрузке
//    app-import.js и обрывал файл — вместе с привязками кнопок НСПД и ФГИС ТП.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// --- валидатор цвета ---
const start = app.indexOf("const CSS_COLOR_RE");
const end = app.indexOf("function sanitizeProjectStyle(");
assert.ok(start >= 0 && end > start, "валидатор цвета должен оставаться извлекаемым");
const context = vm.createContext({});
vm.runInContext(app.slice(start, end), context);
const { safeCssColor } = context;

for (const bad of [
  '"><img src=x onerror=alert(1)>',
  "url(http://evil/x)",
  "red;behavior:url(x)",
  "expression(alert(1))",
  "#fff'/**/;background:url(x)",
  "var(--x)",
  "a".repeat(65),
]) assert.equal(safeCssColor(bad), null, `опасное значение должно отбрасываться: ${bad.slice(0, 40)}`);

for (const good of ["#fff", "#ff0000", "#ff0000cc", "rgb(1,2,3)", "rgba(1,2,3,.5)",
  "hsl(120, 50%, 50%)", "transparent", "currentColor"])
  assert.equal(safeCssColor(good), good, `валидный цвет должен проходить: ${good}`);

assert.equal(safeCssColor(null), null, "нестроковое значение не должно ломать валидатор");
assert.equal(safeCssColor(undefined, "#000"), "#000", "фолбэк обязан работать");

// --- санитизация при восстановлении: корень проблемы ---
const restore = app.slice(app.indexOf("const projectStyles = Object.create(null)"),
  app.indexOf("const projectStyles = Object.create(null)") + 400);
assert.match(restore, /sanitizeProjectStyle\(style\)/,
  "значения стилей из файла обязаны санитизироваться, а не только их ключи");

// --- сток: swatchOf не пускает сырое значение в style ---
const swatch = app.slice(app.indexOf("const swatchOf = sid =>"),
  app.indexOf("const swatchOf = sid =>") + 500);
assert.match(swatch, /safeCssColor\(st\.fill\)/, "заливка обязана проходить валидатор");
assert.match(swatch, /safeCssColor\(st\.hatch\.color\)/, "цвет штриховки — тоже");

// --- политика безопасности ---
assert.match(html, /http-equiv="Content-Security-Policy"/, "мета-CSP должна остаться");
const csp = /content="([^"]*)"/.exec(html.slice(html.indexOf("Content-Security-Policy")))[1];
assert.match(csp, /object-src 'none'/, "плагины должны быть запрещены");
assert.match(csp, /base-uri 'self'/, "подмена базового адреса должна быть закрыта");
assert.match(csp, /connect-src[^;]*nspd\.gov\.ru/, "домены, куда приложение ходит, обязаны быть разрешены");
assert.doesNotMatch(csp, /connect-src[^;]*\*/, "connect-src со звёздочкой сводит защиту от эксфильтрации на нет");

// --- ни одной ссылки на удалённые узлы ---
assert.doesNotMatch(html, /id="st-core"/, "узел удалён из разметки");
for (const file of ["app.js", "app-import.js", "app-data.js", "app-attr.js", "app-style-ui.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const live = source.split("\n").filter(line =>
    line.includes("st-core") && !line.trim().startsWith("//"));
  assert.equal(live.length, 0,
    `${file} обращается к удалённому #st-core — при загрузке это роняет файл ` +
    `и обрывает всё, что объявлено ниже:\n  ${live[0]}`);
}

// мёртвый style.css не должен вернуться в поставку
assert.ok(!fs.existsSync(path.join(root, "style.css")),
  "неподключённый style.css отдавался с сайта 48 КБ мёртвого груза");

console.log("security-and-dom-refs: OK");
