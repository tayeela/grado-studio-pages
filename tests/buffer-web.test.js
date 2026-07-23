"use strict";

// Буфер в браузере — снята последняя заглушка «требует настольную версию».
// Что здесь важно:
// 1. Площади обязаны сходиться с геометрией, а не «на глаз»: круг — πr²,
//    капсула — 2rL+πr², квадрат наружу — a²+4ar+πr², внутрь — (a−2r)².
// 2. Полоса вдоль контура собирается из прямоугольников по рёбрам и ОДНОГО
//    круга на вершину: капсулы дают совпадающие дуги в общих вершинах, и
//    движок объединения падает на вырожденных сегментах. Круг размечен со
//    сдвигом фазы на полшага — чтобы его вершины не совпадали с углами
//    прямоугольников.
// 3. «Внутри» для точки и линии не существует — честный отказ с причиной.
// 4. Контракт — тот же, что у настольного сервера: {features,dist,sides} →
//    {features}, поэтому настольный диалог работает без единой правки.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
globalThis.polygonClipping = require(path.join(root, "vendor", "polygon-clipping.umd.min.js"));
require(path.join(root, "app-vector.js"));
require(path.join(root, "app-buffer.js"));
const B = globalThis.GRADO_BUFFER;
const V = globalThis.GRADO_VECTOR;
assert.ok(B && typeof B.bufferFeatures === "function", "модуль обязан подниматься без документа");

const area = geometry => V.geometryArea(geometry);
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `площадь ${Math.round(actual)}, ожидали ${Math.round(expected)} ± ${tolerance}`);

// ---------- площади сходятся с геометрией ----------
{
  // круг: хорда при 48 сегментах даёт −0,3% площади — в допуск входит
  near(area(B.bufferGeometry({ point: [0, 0] }, 100, "both").geometry), Math.PI * 10000, 150);
  // капсула вокруг отрезка 200 м радиусом 50
  near(area(B.bufferGeometry({ line: [[0, 0], [200, 0]] }, 50, "both").geometry),
    2 * 50 * 200 + Math.PI * 2500, 40);

  const square = { ring: [[0, 0], [100, 0], [100, 100], [0, 100]] };
  near(area(B.bufferGeometry(square, 30, "both").geometry),
    10000 + 4 * 30 * 100 + Math.PI * 900, 20);
  near(area(B.bufferGeometry(square, 30, "outer").geometry),
    4 * 30 * 100 + Math.PI * 900, 20);
  // отступ внутрь углов не скругляет: ровно (100−60)²
  assert.ok(Math.abs(area(B.bufferGeometry(square, 30, "inner").geometry) - 1600) < 1,
    "отступ внутрь обязан быть точным");

  // бублик, отступ 10 внутрь: внешний контур сжимается, дыра растёт со
  // скруглёнными углами — 32400 − (3600 − (4−π)·100) = 28886
  const donut = { ring: [[0, 0], [200, 0], [200, 200], [0, 200]],
    holes: [[[80, 80], [120, 80], [120, 120], [80, 120]]] };
  near(area(B.bufferGeometry(donut, 10, "inner").geometry),
    32400 - (3600 - (4 - Math.PI) * 100), 5);
}

// ---------- честные отказы ----------
{
  assert.equal(B.bufferGeometry({ point: [0, 0] }, 100, "inner").geometry, null,
    "у точки нет «внутри»");
  assert.match(B.bufferGeometry({ point: [0, 0] }, 100, "inner").reason, /нет «внутри»/);
  assert.equal(B.bufferGeometry({ line: [[0, 0], [10, 0]] }, 5, "inner").geometry, null);
  const deep = B.bufferGeometry({ ring: [[0, 0], [100, 0], [100, 100], [0, 100]] }, 60, "inner");
  assert.equal(deep.geometry, null, "отступ больше полуширины съедает объект целиком");
  assert.match(deep.reason, /ничего не осталось/);
  assert.equal(B.bufferGeometry({ props: {} }, 100, "both").reason, "объект без геометрии");
  assert.equal(B.bufferGeometry({ point: [0, 0] }, 0, "both").reason, "нулевое расстояние");
}

// ---------- контракт настольного сервера ----------
{
  const result = B.bufferFeatures({ features: [
    { point: [0, 0], props: { name: "Школа" }, layer_id: "social" },
    { line: [[0, 0], [100, 0]] },
    { point: [500, 500] },
  ], dist: 300, sides: "both" });
  assert.equal(result.features.length, 3);
  assert.equal(result.features[0].props.name, "Школа", "атрибуты исходного объекта едут в буфер");
  assert.equal(result.features[0].props.buffer_m, 300, "и радиус записывается в атрибуты");
  assert.ok(Array.isArray(result.features[0].ring), "буфер — полигон");

  // сторона «внутри» для точек: пусто, но с причиной, а не молчаливый ноль
  const inner = B.bufferFeatures({ features: [{ point: [0, 0] }], dist: 100, sides: "inner" });
  assert.equal(inner.features.length, 0);
  assert.ok(inner.notes.length, "причина пропуска обязана возвращаться");
}

// ---------- полоса не падает на замкнутом контуре ----------
{
  // звезда: острые углы, вершины на осях — самый неудобный случай для движка
  const star = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const radius = i % 2 ? 40 : 100;
    star.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  const starArea = area([[[...star, star[0]]]]);
  const both = B.bufferGeometry({ ring: star }, 15, "both");
  assert.ok(area(both.geometry) > starArea, "буфер звезды обязан быть больше самой звезды");
  const ring = B.bufferGeometry({ ring: star }, 15, "outer");
  assert.ok(area(ring.geometry) > 0, "кольцо вокруг звезды обязано строиться");
}

// ---------- проводка ----------
{
  const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
  assert.match(adapter, /if \(path === "\/api\/buffer"\)/,
    "маршрут обязан отвечать в браузере — настольный диалог работает без правок");
  assert.doesNotMatch(adapter, /"btn-buffer-open"/,
    "кнопка буфера больше не блокируется и не помечается недоступной");
  assert.doesNotMatch(adapter, /Буферизация доступна в настольной версии/);
  assert.match(cmdk, /"Буфер вокруг выбранных объектов…", run: \(\) => click\("btn-buffer-open"\), available/,
    "и в палитре команд буфер больше не настольный");
  assert.ok(html.indexOf("polygon-clipping.umd.min.js") < html.indexOf("app-buffer.js"),
    "буфер опирается на движок объединения — порядок загрузки обязан это учитывать");
}

console.log("buffer-web: OK");
