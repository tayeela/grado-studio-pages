"use strict";

// Портал отдаёт красную линию НАРЕЗАННОЙ: медиана — 3 точки на объект, один
// проезд превращается в сотни записей. Выбрать линию, узнать её длину, обрезать
// по ней — всё рассыпалось на куски, а атрибутивная таблица шла на десятки
// тысяч строк. Склейка цепочек честна ровно настолько, насколько совпадают
// атрибуты: разные документы не сливаем, через перекрёсток не идём.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

const start = app.indexOf("const JOIN_SOFT_PROPS");
const end = app.indexOf("function normalizeImportFields");
assert.ok(start > 0 && end > start, "склейка должна оставаться извлекаемой");
const context = vm.createContext({});
vm.runInContext(app.slice(start, end), context);
// const в vm не попадает на объект контекста — достаём явно
const join = vm.runInContext("joinImportedRuns", context);

let nextId = 1;
const seg = (line, props, extra = {}) => ({ id: nextId++, layer_id: "source.gisogd.l1",
  kind: "redline", style_id: "lgr.1", joinable: true, srcKey: `k${nextId}`,
  props: { line_code: 1, line_side: 1, linerhanum: "П071", ...props }, line, ...extra });

// ---------- цепочка ----------
const chain = join([
  seg([[0, 0], [10, 0]]),
  seg([[10, 0], [20, 0]]),
  seg([[30, 0], [20, 0]]),        // отрезок направлен НАВСТРЕЧУ — портал так и отдаёт
]);
assert.equal(chain.length, 1, "три отрезка одного проезда — одна линия");
assert.deepEqual(chain[0].line, [[0, 0], [10, 0], [20, 0], [30, 0]],
  "точки идут подряд, встречный отрезок разворачивается");
assert.equal(chain[0].srcKeys.length, 3,
  "ключи всех отрезков остаются на линии — по ним повторная выгрузка узнаёт своё");
assert.ok(!("joinable" in chain[0]), "служебная пометка не должна уезжать в проект");

// цепочка собирается и когда затравка оказалась в середине
const middle = join([seg([[10, 0], [20, 0]]), seg([[0, 0], [10, 0]]), seg([[20, 0], [30, 0]])]);
assert.equal(middle.length, 1, "порядок отрезков в выдаче портала значения не имеет");
assert.deepEqual(middle[0].line, [[0, 0], [10, 0], [20, 0], [30, 0]], "линия собирается в обе стороны");

// ---------- где склеивать нельзя ----------
const cross = join([
  seg([[0, 0], [10, 0]]), seg([[10, 0], [20, 0]]), seg([[10, 0], [10, 10]]),
]);
assert.equal(cross.length, 3, "через перекрёсток цепочка не идёт: продолжение там произвольно");

// Номер документа линию как ОБЪЕКТ чертежа не различает: на площадке в
// Медведково 3231 отрезок КЛ УДС расходился по нему на 246 групп, и красная
// линия одного проезда рассыпалась на сотни кусков. Склеиваем, а номера
// собираем списком — длинная линия и вправду задана несколькими документами.
const docs = join([
  seg([[0, 0], [10, 0]], { linerhanum: "П071" }),
  seg([[10, 0], [20, 0]], { linerhanum: "П200" }),
]);
assert.equal(docs.length, 1, "разные документы не должны рвать одну линию");
assert.equal(docs[0].props.linerhanum, "П071, П200", "номера документов собираются списком");

// заглушки портала в списке — не номера
const dirty = join([
  seg([[0, 0], [10, 0]], { linerhanum: "П206,NOT_FOUND" }),
  seg([[10, 0], [20, 0]], { linerhanum: "None, П206" }),
]);
assert.equal(dirty[0].props.linerhanum, "П206",
  "NOT_FOUND и None — это пусто, а повтор номера не должен дублироваться");

// длинный список обрезается, но врать про количество нельзя
const manyDocs = join(["П1", "П2", "П3", "П4", "П5", "П6"].map((n, i) =>
  seg([[i * 10, 0], [i * 10 + 10, 0]], { linerhanum: n })));
assert.equal(manyDocs.length, 1);
assert.match(manyDocs[0].props.linerhanum, /^П1, П2, П3, П4 и ещё 2$/,
  "показываем четыре номера и честно считаем остальные");

const sides = join([
  seg([[0, 0], [10, 0]], { line_side: 1 }),
  seg([[10, 0], [20, 0]], { line_side: -1 }),
]);
assert.equal(sides.length, 2, "стороны линии не сливаются: это разные режимы");

const foreign = join([
  seg([[0, 0], [10, 0]]),
  seg([[10, 0], [20, 0]], {}, { joinable: false }),
]);
assert.equal(foreign.length, 2, "нарисованный руками объект склейка не трогает");

// ---------- даты правки ----------
const dated = join([
  seg([[0, 0], [10, 0]], { changedate: "2019-10-09", createdate: "2006-11-28" }),
  seg([[10, 0], [20, 0]], { changedate: "2021-07-08", createdate: "2006-11-28" }),
]);
assert.equal(dated.length, 1, "разная дата правки записи линию не разрывает");
assert.equal(dated[0].props.createdate, "2006-11-28", "совпавшая дата остаётся");
assert.ok(!("changedate" in dated[0].props),
  "разошедшуюся дату нельзя выдумывать: у линии её просто нет");

// ---------- геометрия не теряется ----------
const many = [];
for (let i = 0; i < 50; i++) many.push(seg([[i * 5, 0], [i * 5 + 5, 0]]));
const len = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const before = many.reduce((s, f) => s + len(f.line), 0);
const after = join(many.slice());
assert.equal(after.length, 1, "50 отрезков одного проезда — одна линия");
assert.equal(len(after[0].line), before, "суммарная длина обязана совпасть до метра");

// одиночный отрезок остаётся как был — лишнего поля ему не нужно
const single = join([seg([[0, 0], [5, 5]])]);
assert.equal(single.length, 1);
assert.ok(!single[0].srcKeys, "нечего склеивать — нечего и перечислять");

// порядок выдачи источника не меняется
const ordered = join([seg([[0, 0], [1, 0]]), seg([[50, 50], [51, 50]]), seg([[1, 0], [2, 0]])]);
// массив приходит из vm — приводим к своему реалму, иначе deepEqual падает
const orderedIds = Array.from(ordered, f => f.id);
assert.deepEqual(orderedIds, [...orderedIds].sort((a, b) => a - b),
  "объекты остаются в порядке выдачи источника");

// ---------- повторная выгрузка узнаёт склеенное ----------
assert.match(app, /for \(const key of feature\.srcKeys \|\| \[\]\) existingKeys\.add\(key\);/,
  "иначе отрезки склеенной линии посчитаются новыми и лягут поверх");
assert.match(app, /joinedFrom: segments > stagedFeatures\.length \? segments : 0/,
  "склейка меняет число объектов — об этом обязано быть сказано");
const data = fs.readFileSync(path.join(root, "app-data.js"), "utf8");
assert.equal((data.match(/склеено из \$\{joinedFrom\} отрезков/g) || []).length, 2,
  "сообщение нужно на обоих путях импорта — по области и по подборке");
const core = fs.readFileSync(path.join(root, "pages-core.js"), "utf8");
assert.match(core, /if \(Array\.isArray\(f\.line\)\) f\.joinable = true;/,
  "склейка включается источником, а не догадкой фронта");

console.log("join-line-runs: OK");
