"use strict";

// Хранилище автосейва одно на origin, и раньше каждая вкладка перезаписывала
// его целиком без сверки: вторая вкладка, открытая час назад, одной правкой
// затирала свежую работу первой — молча и невосстановимо. Теперь запись идёт
// «поверх известной версии» (семантика If-Match): разошлись — 409, чужое цело.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "pages-adapter.js"), "utf8");

// проверка версии стоит ДО записи, иначе она бессмысленна
const guard = source.indexOf('X-Grado-Base');
const write = source.indexOf('storedProjectSet(AUTOSAVE_KEY, envelope)');
assert.ok(guard > 0, "адаптер обязан читать заголовок версии X-Grado-Base");
assert.ok(write > guard, "сверка версии должна выполняться до перезаписи автосейва");
assert.match(source.slice(guard, write), /409/,
  "расхождение версий обязано отвечать 409, а не молча перезаписывать");
assert.match(source.slice(guard, write), /if \(base\)/,
  "без базы (первая запись вкладки) проверка не выполняется");

// клиент: базу шлём, из ответа обновляем, на 409 останавливаем автосейв
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert.match(app, /headers\["X-Grado-Base"\] = autosaveBase/,
  "клиент обязан присылать версию, поверх которой пишет");
assert.match(app, /if \(result && result\.saved_at\) autosaveBase = result\.saved_at/,
  "успешная запись двигает базу вперёд");
assert.match(app, /if \(d && d\.saved_at\) autosaveBase = d\.saved_at/,
  "восстановление при старте задаёт исходную базу");
assert.match(app, /response\.status === 409[\s\S]{0,200}noteAutosaveConflict\(\)/,
  "409 обязан переводить вкладку в режим конфликта");
assert.match(app, /if \(autosaveConflict\) throw/,
  "после конфликта вкладка больше не пишет в общее хранилище");

// потеря данных без предупреждения — недопустима
assert.match(app, /beforeunload/,
  "при неудачном автосейве или конфликте уход со страницы должен предупреждать");
assert.match(app, /if \(!autosaveFailed && !autosaveConflict\) return;/,
  "предупреждение показывается только когда работа реально под угрозой");

console.log("autosave-tab-conflict: OK");
