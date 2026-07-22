"use strict";

// Отбор объектов — «Выбрать по выражению» и «Выбрать по расположению» из QGIS.
// Что здесь важно:
// 1. Предикаты обязаны совпадать с тем, что человек имеет в виду: участок,
//    стыкующийся с границей разработки, — «внутри», а не снаружи; объект,
//    высунувшийся за границу, — «пересекает», но не «внутри».
// 2. Отбор идёт по сетке габаритов: слой на слой городского размера — это
//    произведение двух десятков тысяч объектов.
// 3. Вычислитель выражений получил сравнения, И/ИЛИ/НЕ и LIKE. Значения в
//    выгрузках портала приходят разным регистром, а «пусто» — то пустой
//    строкой, то заглушкой NOT_FOUND.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
require(path.join(root, "app-select.js"));
const S = globalThis.GRADO_SELECT;
assert.ok(S && typeof S.selectByLocation === "function", "модуль обязан подниматься без документа");

let nextId = 1;
const box = (x0, y0, x1, y1, props) => ({ id: nextId++, props: props || {},
  ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const names = list => list.map(f => f.props.name);

// ---------- предикаты ----------
{
  const border = box(0, 0, 300, 300, { name: "граница" });
  const inside = box(20, 20, 60, 60, { name: "внутри" });
  const crossing = box(280, 20, 340, 60, { name: "высунулся" });
  const touching = box(300, 100, 340, 140, { name: "встык" });
  const away = box(500, 500, 540, 540, { name: "далеко" });
  const near = box(330, 150, 360, 180, { name: "рядом" });         // 30 м от границы
  const point = { id: nextId++, props: { name: "точка внутри" }, point: [150, 150] };
  const pointOut = { id: nextId++, props: { name: "точка снаружи" }, point: [400, 400] };
  const line = { id: nextId++, props: { name: "линия насквозь" }, line: [[-50, 150], [350, 150]] };
  const features = [inside, crossing, touching, away, near, point, pointOut, line];
  const pick = (predicate, distance) => names(S.selectByLocation({ features,
    references: [border], predicate, distance }));

  assert.deepEqual(pick("intersects"), ["внутри", "высунулся", "встык", "точка внутри", "линия насквозь"],
    "«пересекает» включает касание встык — как в QGIS");
  assert.deepEqual(pick("within"), ["внутри", "точка внутри"],
    "«внутри» не должно захватывать высунувшийся объект");
  assert.deepEqual(pick("disjoint"), ["далеко", "рядом", "точка снаружи"],
    "«не касается» — всё, что не задело границу");
  assert.deepEqual(pick("distance", 35), ["внутри", "высунулся", "встык", "рядом", "точка внутри", "линия насквозь"],
    "радиус 35 м обязан добирать объект в 30 м от границы");
  assert.ok(!pick("distance", 20).includes("рядом"), "и не добирать его при радиусе 20 м");

  // «содержит» — это «внутри» наоборот
  assert.deepEqual(names(S.selectByLocation({ features: [border], references: [inside], predicate: "contains" })),
    ["граница"]);

  // участок, лежащий ровно по границе, считается внутри: иначе он выпадал бы
  // из выборки, хотя человек его туда относит
  const flush = box(0, 0, 100, 100, { name: "по границе" });
  assert.deepEqual(names(S.selectByLocation({ features: [flush], references: [border], predicate: "within" })),
    ["по границе"]);

  // выколотый полигон: объект в дыре — не внутри
  const donut = { id: nextId++, props: { name: "бублик" },
    ring: [[0, 0], [400, 0], [400, 400], [0, 400]],
    holes: [[[100, 100], [300, 100], [300, 300], [100, 300]]] };
  const inHole = box(150, 150, 200, 200, { name: "в дыре" });
  const inRing = box(20, 20, 60, 60, { name: "в теле" });
  assert.deepEqual(names(S.selectByLocation({ features: [inHole, inRing], references: [donut], predicate: "within" })),
    ["в теле"], "дыра — это не внутренность");
}

// ---------- сетка отбора не теряет объектов ----------
{
  const features = [], references = [];
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 30, y = Math.floor(i / 20) * 30;
    features.push(box(x, y, x + 20, y + 20, { name: "об" + i }));
  }
  for (let i = 0; i < 20; i++) {
    const x = (i % 5) * 120, y = Math.floor(i / 5) * 120;
    references.push(box(x, y, x + 100, y + 100, { name: "обр" + i }));
  }
  const fast = S.selectByLocation({ features, references, predicate: "intersects" }).map(f => f.id);
  const refGeoms = references.map(S.geometryOf);
  const slow = features.filter(f => {
    const g = S.geometryOf(f);
    return refGeoms.some(other => S.intersects(g, other));
  }).map(f => f.id);
  assert.deepEqual(fast, slow, "сетка обязана давать ровно то же, что полный перебор");
  assert.ok(slow.length > 100 && slow.length < 400, `отобрано ${slow.length} — проверка вырождена`);
}

// ---------- режимы соединения выборок ----------
{
  const found = [{ id: 2 }, { id: 3 }];
  const current = new Set([1, 2]);
  assert.deepEqual([...S.combine("replace", current, found)], [2, 3]);
  assert.deepEqual([...S.combine("add", current, found)], [1, 2, 3]);
  assert.deepEqual([...S.combine("subtract", current, found)], [1]);
  assert.deepEqual([...S.combine("intersect", current, found)], [2]);
}

// ---------- вычислитель выражений ----------
{
  const src = fs.readFileSync(path.join(root, "app-attr.js"), "utf8");
  const start = src.indexOf("const EXPR_FUNCS");
  const end = src.indexOf("function openAttributeTable");
  assert.ok(start > 0 && end > start, "вычислитель обязан оставаться извлекаемым");
  const context = vm.createContext({
    ringArea: ring => { let sum = 0; for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]; sum += a[0] * b[1] - b[0] * a[1]; }
      return Math.abs(sum / 2); },
    lineLen: pts => { let sum = 0; for (let i = 1; i < pts.length; i++)
      sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return sum; },
  });
  vm.runInContext(src.slice(start, end), context);
  const evaluate = vm.runInContext("evalFieldExpr", context);
  const feature = { props: { zone: "Ж-1", floors: "5", name: "Школа №12", doc: "NOT_FOUND" },
    ring: [[0, 0], [100, 0], [100, 100], [0, 100]] };
  const check = (expression, expected) =>
    assert.equal(String(evaluate(expression, feature)), String(expected), expression);

  check("zone = 'Ж-1'", true);
  check("zone = 'ж-1'", true);                 // регистр в выгрузках плавает
  check("zone != 'О-2'", true);
  check("floors >= 5", true);
  check("floors > 5", false);
  check("floors > 3 и zone = 'Ж-1'", true);
  check("floors > 9 или zone = 'Ж-1'", true);
  check("floors > 3 and zone = 'Ж-1'", true);  // латиница тоже
  check("не (floors > 9)", true);
  check("name like 'Школа%'", true);
  check("name like 'Сад%'", false);
  check("doc = ''", true);                     // NOT_FOUND — это «пусто»
  check("doc != ''", false);
  check("$area > 5000", true);
  check("round($area/10000, 2)", 1);
  check("contains(name, 'школа')", true);
  check("starts_with(name, 'Школа')", true);
  check("if(floors > 3, 'высокое', 'низкое')", "высокое");
  assert.throws(() => evaluate("floors >", feature), /неожиданный конец|ожидалось/);

  // отбор по выражению: строка «0» и пустое значение — это «нет»
  const feats = [
    { id: 1, props: { floors: 5, name: "А" } },
    { id: 2, props: { floors: 12, name: "Б" } },
    { id: 3, props: { floors: 0, name: "В" } },
  ];
  const picked = S.selectByExpression({ features: feats, expression: "floors >= 9", evaluate });
  assert.deepEqual(picked.map(f => f.id), [2]);
  assert.deepEqual(S.selectByExpression({ features: feats, expression: "floors", evaluate }).map(f => f.id),
    [1, 2], "объект с нулевым значением в выборку не попадает");
}

// ---------- проводка в приложении ----------
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  const select = fs.readFileSync(path.join(root, "app-select.js"), "utf8");
  assert.match(html, /id="btn-select-by"/, "отбор обязан открываться с панели инструментов");
  assert.ok(html.indexOf('src="./app.js') < html.indexOf('src="./app-select.js'),
    "модуль отбора работает поверх состояния приложения — грузится после него");
  assert.match(cmdk, /Выбрать по выражению…/, "и вызываться из палитры команд");
  assert.match(cmdk, /Выбрать по расположению…/);
  assert.match(select, /setSelection\(\[\.\.\.ids\]\)/, "результат обязан становиться выборкой на чертеже");
  assert.doesNotMatch(select, /state\.features\s*=/, "отбор ничего не меняет в проекте");
  // окно могут закрыть раньше, чем отработает отложенный фокус
  assert.match(select, /if \(first && first\.isConnected\) first\.focus\(\);/,
    "фокус на закрытом окне не должен превращаться в «Ошибку интерфейса»");
}

console.log("select-by: OK");
