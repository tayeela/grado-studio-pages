"use strict";

// По внешнему QA-аудиту 1.0.0. Общая тема находок: браузерная редакция местами
// обещала больше, чем делает, а местами прятала то, что умеет.
// 1. Главной кнопкой в шапке стояло «Собрать альбом» — в браузере она правит
//    только СОСТАВ листов, печать в масштабе настольная.
// 2. Пример загружался в проект с именем «Новый проект»: после перезагрузки
//    автосохранение показывало «Новый проект» с семью слоями.
// 3. Настольные команды исчезали из палитры совсем: поиск «экспорт» давал
//    пусто, и это читалось как «функции нет вообще». А «Данные по видимой
//    области», которые в вебе РАБОТАЮТ, были помечены настольными и тоже
//    прятались.
// 4. Подложка выключена намеренно (внешние тайлы), но о ней нигде не говорилось.
// 5. collab.js грузился 30 КБ и не мог включиться: сервера с --hub на Pages нет.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "redesign", "shell.css"), "utf8");

// ---------- 1. кнопка называет то, что делает ----------
const album = adapter.slice(adapter.indexOf('const album = document.getElementById("btn-album")'),
  adapter.indexOf('const buffer = document.getElementById("btn-buffer-open")'));
assert.match(album, /album\.textContent = "Состав альбома";/,
  "в браузере эта кнопка правит состав листов, а не собирает документ");
assert.match(album, /album\.classList\.remove\("primary"\)/,
  "вид главного действия у неё тоже обещал лишнее");
assert.match(album, /Печать в масштабе \(PDF\) — в настольной версии/,
  "куда идти за печатью — обязано быть сказано на самой кнопке");

// ---------- 2. демо-проекта больше нет ----------
// Пример «жилой квартал» жил в коде приложения и уводил от настоящих данных:
// выгрузка по области и файлы дают то же самое на реальной территории.
for (const trace of ["btn-demo", "start-demo", "tep-open-demo"])
  assert.ok(!app.includes(trace) && !html.includes(trace), `рудимент демо: ${trace}`);
assert.ok(!html.includes("start-guide"), "экран-гид, загораживавший холст, удалён");
assert.match(html, /id="cv-empty"/, "пустой холст объясняет себя строкой, а не окном");
assert.match(shell, /\.cv-empty\{[^}]*pointer-events:none/,
  "подсказка не должна перехватывать мышь — сквозь неё чертят");

// ---------- 3. палитра команд честна в обе стороны ----------
assert.match(cmdk, /\(!i\.available \|\| i\.available\(\) \|\| \(isWeb && i\.desktop\)\)/,
  "настольные команды обязаны оставаться видимыми");
assert.match(cmdk, /off \? '<span class="hint">настольная версия<\/span>'/,
  "и обязаны быть подписаны");
assert.match(cmdk, /if \(isWeb && c\.desktop\) \{[\s\S]{0,200}только в настольной версии/,
  "выключенная команда не должна делать вид, что сработала");
assert.match(cmdk, /\{ t: "Данные по видимой области…", run: \(\) => call\("openDataFetch"\) \},/,
  "выгрузка по области в браузере работает — прятать её из палитры нельзя");
assert.match(shell, /\.cmdk-row\.cmdk-off\{opacity:\.5;cursor:default\}/,
  "выключенная строка обязана читаться как выключенная");

// ---------- 4. про подложку сказано ----------
assert.match(html, /id="start-basemap"/, "на пустом старте обязан быть способ включить карту");
assert.match(app, /on\("start-basemap", "click"[\s\S]{0,320}basemap-show/,
  "подсказка обязана реально включать подложку");
assert.match(app, /Подложку не включаем сами \(это запросы к внешнему серверу тайлов\)/,
  "решение не включать её по умолчанию обязано быть объяснено в коде");

// ---------- 5. мёртвый модуль не качается ----------
assert.doesNotMatch(html, /<script[^>]*src="\.\/collab\.js/,
  "collab.js на Pages включиться не может — качать его незачем");
assert.ok(fs.existsSync(path.join(root, "collab.js")),
  "сам файл остаётся в репозитории ради паритета с настольной сборкой");
assert.match(app, /window\.Collab && window\.Collab\.active/,
  "обращение к модулю обязано оставаться защищённым");

// ---------- то, что аудит записал в дефекты, а дефектом не было ----------
// aria-pressed «null» у режима — это <body data-workspace-mode>, а не кнопка
assert.match(html, /<button type="button" data-workspace-mode="draw"[^>]*aria-pressed="true"/,
  "у кнопок режимов состояние есть с самого начала");
// CSP на Pages задаётся мета-тегом: заголовки там выставить нельзя
assert.match(html, /http-equiv="Content-Security-Policy"/, "политика безопасности задана мета-тегом");
for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"])
  assert.ok(html.includes(directive), `в политике обязана быть директива ${directive}`);

console.log("web-honesty: OK");
