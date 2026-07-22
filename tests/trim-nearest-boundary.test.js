"use strict";

// Обрезка выбирала границу по ТИПУ, а не по близости. У кандидата от окружности
// была метрика dd (расстояние от клика), у кандидата от отрезка — |t − tClick|.
// Сравнивались они между собой: тернарник «best.dd != null ? … : true» пропускал
// окружность безусловно, а Math.abs(best.t − tClick) при best от окружности
// давал NaN, из-за чего отрезок не выигрывал никогда.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const fn = app.slice(app.indexOf("function trimLineAt("), app.indexOf("function extendLineAt("));
assert.ok(fn.length > 0, "trimLineAt должна оставаться распознаваемой");

// обе ветки считают ОДНУ метрику
const ddAssignments = [...fn.matchAll(/const dd = Math\.hypot\(p\[0\] - wx, p\[1\] - wy\)/g)];
assert.equal(ddAssignments.length, 2,
  "расстояние от клика обязано считаться и для окружности, и для отрезка");

// выбор идёт по этой метрике, одинаково в обеих ветках
const picks = [...fn.matchAll(/if \(!best \|\| dd < best\.dd\)/g)];
assert.equal(picks.length, 2, "кандидаты обязаны сравниваться единым «dd < best.dd»");

// старые несравнимые сравнения не вернулись
assert.doesNotMatch(fn, /best\.dd != null \? dd < best\.dd : true/,
  "безусловный пропуск кандидата от окружности вернулся");
assert.doesNotMatch(fn, /Math\.abs\(t - tClick\) < Math\.abs\(best\.t - tClick\)/,
  "сравнение с best.t даёт NaN, когда best пришёл от окружности");

// реконструкция по-прежнему различает случаи, но уже по явному признаку
assert.match(fn, /if \(best\.fromCircle\)/,
  "ветка восстановления цепочки обязана выбираться по fromCircle, а не по наличию dd");
assert.doesNotMatch(fn, /best\.fromCircle \|\| best\.dd != null/,
  "теперь dd есть у ОБОИХ кандидатов — это условие увело бы отрезок в чужую ветку");

// у кандидата от отрезка сохраняется t: он нужен для его собственной реконструкции
assert.match(fn, /best = \{ t, p, dd \}/, "кандидат от отрезка обязан нести и t, и dd");

console.log("trim-nearest-boundary: OK");
