"use strict";

// Правка геометрии: «Разрезать объекты» и «Объединить» из QGIS.
// Что здесь важно:
// 1. Разрез не должен ни терять, ни добавлять площадь: сумма частей обязана
//    совпадать с исходной. Иначе ТЭП после правки поедет.
// 2. Части обязаны стыковаться без щели и без перекрытия — проверка топологии
//    на результате реза должна молчать.
// 3. Ломаная с несколькими входами-выходами режет объект на все части, а не
//    только по первому пересечению.
// 4. Дыры достаются той части, в которой лежат; рез самой дыры — честный отказ,
//    а не кривой результат.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
globalThis.polygonClipping = require(path.join(root, "vendor", "polygon-clipping.umd.min.js"));
require(path.join(root, "app-edit.js"));
require(path.join(root, "app-vector.js"));
require(path.join(root, "app-topo.js"));
const E = globalThis.GRADO_EDIT;
const T = globalThis.GRADO_TOPO;
assert.ok(E && typeof E.splitPolygon === "function", "модуль обязан подниматься без документа");

const area = ring => Math.abs(E.ringArea(ring));
const square = [[0, 0], [200, 0], [200, 200], [0, 200]];
const sum = parts => parts.reduce((total, part) =>
  total + area(part.ring) - (part.holes || []).reduce((h, hole) => h + area(hole), 0), 0);

// ---------- разрез полигона ----------
{
  const straight = E.splitPolygon({ ring: square }, [[100, -20], [100, 220]]);
  assert.equal(straight.parts.length, 2, "прямой рез делит надвое");
  assert.ok(Math.abs(sum(straight.parts) - 40000) < 1e-6,
    `площадь после реза ${sum(straight.parts)}, была 40000`);

  // ломаная: рез идёт зигзагом, площадь всё равно обязана сойтись
  const broken = E.splitPolygon({ ring: square }, [[-20, 140], [80, 150], [150, 60], [220, 160]]);
  assert.equal(broken.parts.length, 2, "ломаный рез тоже делит надвое");
  assert.ok(Math.abs(sum(broken.parts) - 40000) < 1e-6,
    `ломаный рез потерял площадь: ${sum(broken.parts)}`);

  // несколько входов-выходов: рез «змейкой» даёт больше двух частей
  const snake = E.splitPolygon({ ring: square }, [[-20, 50], [220, 50], [220, 120], [-20, 120]]);
  assert.ok(snake.parts.length >= 3, `змейка дала ${snake.parts.length} частей, ожидали минимум три`);
  assert.ok(Math.abs(sum(snake.parts) - 40000) < 1e-6, "и площадь сошлась");

  // рез, не доходящий до края, объект не делит
  const inside = E.splitPolygon({ ring: square }, [[100, 40], [100, 160]]);
  assert.equal(inside.parts.length, 0, "рез внутри контура не делит объект");
  assert.match(inside.reason, /не пересекает/);

  // рез мимо
  const away = E.splitPolygon({ ring: square }, [[400, 0], [400, 200]]);
  assert.equal(away.parts.length, 0, "рез мимо объекта ничего не делает");
}

// ---------- части стыкуются: проверка топологии на результате молчит ----------
{
  (async () => {
    const result = E.splitPolygon({ ring: [[0, 0], [300, 0], [300, 300], [0, 300]] },
      [[-20, 140], [120, 150], [220, 90], [320, 160]]);
    const features = result.parts.map((part, index) => ({ id: index + 1, props: {}, ring: part.ring }));
    const report = await T.runChecks({ features,
      checks: { overlap: true, gap: true, duplicate: true, self: true },
      options: { gapMaxArea: 100000 } });
    assert.equal(report.total, 0,
      `после реза найдено ${report.total} нарушений топологии: ${report.issues.map(i => i.kind)}`);
  })().catch(error => { console.error(error); process.exit(1); });
}

// ---------- дыры ----------
{
  const donut = { ring: [[0, 0], [200, 0], [200, 100], [0, 100]],
    holes: [[[20, 20], [60, 20], [60, 60], [20, 60]]] };
  const split = E.splitPolygon(donut, [[100, -10], [100, 110]]);
  assert.equal(split.parts.length, 2);
  const withHole = split.parts.filter(part => part.holes.length);
  assert.equal(withHole.length, 1, "дыра обязана достаться ровно одной части");
  assert.ok(withHole[0].ring.some(p => p[0] < 100), "и именно той, в которой лежит");
  assert.ok(Math.abs(sum(split.parts) - (20000 - 1600)) < 1e-6, "площадь считается за вычетом дыры");

  const throughHole = E.splitPolygon(donut, [[40, -10], [40, 110]]);
  assert.equal(throughHole.parts.length, 0, "рез сквозь дыру не выполняется");
  assert.match(throughHole.reason, /дыр/, "и объясняет почему");
}

// ---------- разрез линии ----------
{
  const line = E.splitLine([[0, 0], [100, 0], [100, 100]], [[50, -10], [50, 10]]);
  assert.equal(line.parts.length, 2, "линия делится в точке пересечения");
  assert.deepEqual(line.parts[0], [[0, 0], [50, 0]]);
  assert.deepEqual(line.parts[1], [[50, 0], [100, 0], [100, 100]]);

  const twice = E.splitLine([[0, 0], [100, 0]], [[30, -5], [30, 5]]);
  assert.equal(twice.parts.length, 2);

  const miss = E.splitLine([[0, 0], [100, 0]], [[0, 50], [100, 50]]);
  assert.equal(miss.parts.length, 0, "непересекающая линия ничего не делит");

  // рез ровно в конце линии — не разрез
  const atEnd = E.splitLine([[0, 0], [100, 0]], [[100, -5], [100, 5]]);
  assert.equal(atEnd.parts.length, 0);
  assert.match(atEnd.reason, /конец/);
}

// ---------- объединение ----------
{
  const box = (x0, y0, x1, y1) => ({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const merged = E.mergePolygons([box(0, 0, 50, 100), box(50, 0, 100, 100)]);
  assert.ok(merged.part, `смежные полигоны обязаны объединяться: ${merged.reason}`);
  assert.ok(Math.abs(area(merged.part.ring) - 10000) < 1e-6, "площадь суммируется");
  assert.equal(merged.part.ring.length, 4, "внутренняя граница обязана исчезнуть");

  const apart = E.mergePolygons([box(0, 0, 50, 50), box(200, 0, 250, 50)]);
  assert.equal(apart.part, null, "разъединённые куски в один объект не собираем");
  assert.match(apart.reason, /не соприкас/, "и говорим почему");

  const single = E.mergePolygons([box(0, 0, 10, 10)]);
  assert.equal(single.part, null, "одного полигона мало");

  // объединение с перекрытием — общая площадь без двойного счёта
  const overlapping = E.mergePolygons([box(0, 0, 60, 100), box(40, 0, 100, 100)]);
  assert.ok(Math.abs(area(overlapping.part.ring) - 10000) < 1e-6,
    "перекрытие не должно считаться дважды");
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");

  assert.match(html, /data-tool="split"/, "инструмент обязан быть на панели");
  assert.match(html, /id="btn-merge"/, "и кнопка объединения тоже");
  assert.ok(html.indexOf('src="./app.js') < html.indexOf('src="./app-edit.js'),
    "модуль правки работает поверх состояния приложения");
  assert.match(cmdk, /Разрезать объекты/);
  assert.match(cmdk, /Объединить полигоны/);

  // «Разрезать» собирает точки как полилиния, но объекта не создаёт
  assert.match(app, /const TOOL_GEOM = \{ \.\.\.GEOM_OF_TOOL, dim: "polyline", split: "polyline", reshape: "polyline" \};/,
    "инструмент обязан собирать ломаную");
  assert.doesNotMatch(app, /GEOM_OF_TOOL = \{[^}]*split/,
    "но не заводить слой под геометрию: он ничего не создаёт");
  const finishAt = app.indexOf("function finishDrawing()");
  const finish = app.slice(finishAt, finishAt + 900);
  assert.match(finish, /splitByLine\(pts\)/, "Enter обязан резать, а не создавать объект");
  // область реза
  assert.match(app, /f\.layer_id === \(active && active\.id\) && editableFeature\(f\)/,
    "без выбора режем активный слой, а не весь проект — иначе линия порежет и зоны, и участки, и здания");
  assert.match(app, /props: cloneVariantValue\(src\.props \|\| \{\}\)/,
    "атрибуты обязаны доставаться каждой части");
  assert.match(app, /snapshot\(\);/, "правка обязана отменяться");
}

console.log("split-and-merge: OK");
