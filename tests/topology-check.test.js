"use strict";

// Проверка топологии (аналог «Топологического чекера» QGIS). Что здесь важно:
// 1. Щель между зонами — территория, не попавшая ни в один ТЭП; перекрытие —
//    площадь, посчитанная дважды. Обе находки обязаны находиться на честной
//    геометрии, а не только в вырожденных примерах.
// 2. Дубликат приходит из повторного импорта: контур тот же, но обход может
//    начинаться с другой вершины и идти в другую сторону.
// 3. Отбор пар идёт через сетку: полный перебор на городской выгрузке — это
//    сотни миллионов пар, вкладка не доживёт. Сетка обязана давать ТОТ ЖЕ
//    результат, что и полный перебор.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
// UMD-сборка в Node уходит в module.exports, а модули приложения ждут её на
// window — как в браузере
globalThis.polygonClipping = require(path.join(root, "vendor", "polygon-clipping.umd.min.js"));
require(path.join(root, "app-vector.js"));
require(path.join(root, "app-topo.js"));
const T = globalThis.GRADO_TOPO;
assert.ok(T && typeof T.runChecks === "function", "модуль проверки обязан подниматься без документа");

async function main() {
  let nextId = 1;
  const box = (x0, y0, x1, y1, props) => ({ id: nextId++, props: props || {},
    ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

  // ---------- перекрытия ----------
  {
    const a = box(0, 0, 100, 100, { name: "Ж-1" });
    const b = box(90, 0, 200, 100, { name: "О-2" });   // 10 × 100 = 1000 м²
    const c = box(300, 0, 400, 100, { name: "Р-3" });  // в стороне
    const report = await T.runChecks({ features: [a, b, c],
      checks: { overlap: true }, options: {} });
    assert.equal(report.total, 1, "одно перекрытие, а не пара зеркальных находок");
    const issue = report.issues[0];
    assert.equal(issue.kind, "overlap");
    assert.ok(Math.abs(issue.area - 1000) < 1, `площадь перекрытия ${issue.area}, ожидали 1000`);
    assert.deepEqual(Array.from(issue.featureIds).sort((x, y) => x - y), [a.id, b.id]);
    assert.ok(issue.rings.length, "перекрытие обязано отдавать контур — его подсвечивают на холсте");
    // касание по общей границе перекрытием не считается
    const touch = await T.runChecks({ features: [box(0, 0, 10, 10), box(10, 0, 20, 10)],
      checks: { overlap: true }, options: {} });
    assert.equal(touch.total, 0, "общая граница — норма, а не ошибка");
    // порог: расхождение в миллиметры у выгрузок портала не должно шуметь
    const hair = await T.runChecks({ features: [box(0, 0, 100, 100), box(99.999, 0, 200, 100)],
      checks: { overlap: true }, options: { overlapMinArea: 0.5 } });
    assert.equal(hair.total, 0, "перекрытие 0.1 м² ниже порога — это шум оцифровки");
  }

  // ---------- щели ----------
  {
    // две зоны с зазором 2 м между ними, закрытые сверху и снизу третьей рамкой
    const left = box(0, 0, 49, 100);
    const right = box(51, 0, 100, 100);
    const top = box(0, 100, 100, 120);
    const bottom = box(0, -20, 100, 0);
    const report = await T.runChecks({ features: [left, right, top, bottom],
      checks: { gap: true }, options: { gapMaxArea: 1000 } });
    assert.equal(report.total, 1, "щель между зонами обязана находиться");
    assert.ok(Math.abs(report.issues[0].area - 200) < 1,
      `площадь щели ${report.issues[0].area}, ожидали 200`);
    assert.equal(report.issues[0].kind, "gap");
    // крупная внутренняя пустота обычно законна — её отсекает порог
    const big = await T.runChecks({ features: [left, right, top, bottom],
      checks: { gap: true }, options: { gapMaxArea: 100 } });
    assert.equal(big.total, 0, "порог обязан отсекать крупные пустоты");
    // сплошное покрытие без щелей
    const solid = await T.runChecks({ features: [box(0, 0, 50, 100), box(50, 0, 100, 100)],
      checks: { gap: true }, options: {} });
    assert.equal(solid.total, 0, "стыкующиеся зоны щелей не дают");
  }

  // ---------- дубликаты ----------
  {
    const a = box(0, 0, 10, 10, { name: "зона" });
    // тот же контур: другая стартовая вершина И обратный обход
    const b = { id: nextId++, props: { name: "зона" },
      ring: [[10, 10], [0, 10], [0, 0], [10, 0]] };
    const c = box(0, 0, 10, 10.5);
    const report = await T.runChecks({ features: [a, b, c], checks: { duplicate: true } });
    assert.equal(report.total, 1, "дубликат обязан находиться независимо от обхода");
    assert.equal(report.issues[0].count, 2);
    assert.deepEqual(Array.from(report.issues[0].featureIds).sort((x, y) => x - y), [a.id, b.id]);
    assert.equal(T.ringKey(a.ring), T.ringKey(b.ring), "ключ контура не зависит от направления обхода");
    assert.notEqual(T.ringKey(a.ring), T.ringKey(c.ring), "разные контуры — разные ключи");
  }

  // ---------- самопересечения ----------
  {
    const bowtie = { id: nextId++, props: {}, ring: [[0, 0], [10, 10], [10, 0], [0, 10]] };
    const clean = box(0, 0, 10, 10);
    const report = await T.runChecks({ features: [bowtie, clean], checks: { self: true } });
    assert.equal(report.total, 1, "восьмёрка обязана находиться, а нормальный контур — нет");
    assert.equal(report.issues[0].featureIds[0], bowtie.id);
    const [point] = report.issues[0].points;
    assert.ok(Math.abs(point[0] - 5) < 1e-6 && Math.abs(point[1] - 5) < 1e-6,
      `точка пересечения ${point}, ожидали центр`);
    // общая вершина соседних рёбер пересечением не считается
    assert.equal(T.selfIntersections([[0, 0], [10, 0], [10, 10], [0, 10]]).length, 0);
  }

  // ---------- сетка отбора пар не теряет пересечения ----------
  {
    const features = [];
    for (let i = 0; i < 60; i++) {
      const x = (i % 10) * 10, y = Math.floor(i / 10) * 10;
      features.push(box(x, y, x + 10.2, y + 10.2));   // каждый лезет на соседей
    }
    // объект-великан поверх всех: в сетке он идёт отдельным списком
    features.push(box(-5, -5, 105, 65));
    const items = T.prepare(features);
    const grid = T.candidatePairs(items).map(([a, b]) => `${a}_${b}`).sort();
    const full = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const [ax0, ay0, ax1, ay1] = items[i].bounds, [bx0, by0, bx1, by1] = items[j].bounds;
        if (!(ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0)) full.push(`${i}_${j}`);
      }
    assert.deepEqual(grid, full.sort(),
      "сетка обязана давать ровно те же пары, что и полный перебор");
    const report = await T.runChecks({ features, checks: { overlap: true }, options: {} });
    assert.ok(report.total > 60, `перекрытий найдено ${report.total} — сетка теряет пары`);
  }

  // ---------- вырожденный объект в слое не сбивает нумерацию пар ----------
  // У восьмёрки нулевая площадь: полигональной геометрии у неё нет, из отбора
  // пар она выпадает. Если пары считать по отфильтрованному списку, а объекты
  // брать из исходного, индексы разъедутся и перекрытия за вырожденным объектом
  // потеряются молча.
  {
    const bowtie = { id: nextId++, props: { name: "восьмёрка" }, ring: [[0, 0], [10, 10], [10, 0], [0, 10]] };
    const a = box(100, 0, 120, 20, { name: "дубль" });
    const b = box(100, 0, 120, 20, { name: "дубль-копия" });
    const report = await T.runChecks({ features: [bowtie, a, b], checks: { overlap: true } });
    assert.equal(report.total, 1, "перекрытие за вырожденным объектом обязано находиться");
    assert.ok(Math.abs(report.issues[0].area - 400) < 1,
      `площадь перекрытия ${report.issues[0].area}, ожидали 400`);
    assert.deepEqual(Array.from(report.issues[0].featureIds).sort((x, y) => x - y), [a.id, b.id],
      "и ссылаться на те объекты, которые действительно налезли друг на друга");
  }

  // ---------- отчёт ----------
  {
    const many = [];
    for (let i = 0; i < 40; i++) many.push(box(0, i, 100, i + 2));   // всё на всём
    const report = await T.runChecks({ features: many, checks: { overlap: true },
      options: { maxIssues: 10 } });
    assert.equal(report.issues.length, 10, "список обязан обрезаться");
    assert.ok(report.truncated && report.total > 10, "но полное число находок обязано сообщаться");
    assert.equal(report.checked, 40, "и число проверенных объектов тоже");
    // порядок: сначала крупные перекрытия
    assert.ok(report.issues[0].area >= report.issues[9].area, "находки идут от крупных к мелким");
  }

  // ---------- отмена ----------
  {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => T.runChecks({ features: [box(0, 0, 10, 10), box(5, 0, 15, 10)],
      checks: { overlap: true }, signal: controller.signal }), /останов/i);
  }

  // ---------- проводка в приложении ----------
  {
    const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const cmdk = fs.readFileSync(path.join(root, "redesign", "cmdk.js"), "utf8");
    const theme = fs.readFileSync(path.join(root, "canvas-theme.js"), "utf8");
    const topo = fs.readFileSync(path.join(root, "app-topo.js"), "utf8");
    assert.match(app, /if \(typeof topoDrawOverlay === "function"\) topoDrawOverlay\(ctx\);/,
      "подсветка находок обязана рисоваться поверх чертежа и переживать отсутствие модуля");
    assert.match(html, /id="btn-topo-check"/, "проверка обязана открываться с панели инструментов");
    assert.ok(html.indexOf('src="./app-vector.js') < html.indexOf('src="./app-topo.js'),
      "app-topo.js берёт геометрию из app-vector.js — порядок загрузки обязан это учитывать");
    assert.match(cmdk, /Проверка топологии…/, "и из палитры команд");
    assert.match(theme, /danger:\s*'--danger-text'/, "цвет находки обязан жить в палитре холста");
    assert.match(theme, /warning:\s*'--warning-text'/, "иначе в тёмной теме подсветка не перекрасится");
    // находки — отчёт, а не часть проекта: в state им не место
    assert.doesNotMatch(topo, /state\.topo\s*=/, "находки не должны попадать в проект и автосохранение");
  }



}

main().then(() => console.log("topology-check: OK"), error => { console.error(error); process.exit(1); });
