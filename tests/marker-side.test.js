"use strict";

// Засечки знака (ООЗТ, ПК, техзоны) должны смотреть ВНУТРЬ контура. Сторона
// считалась по нормали ПЕРВОГО ребра относительно среднего арифметического
// вершин. У вытянутых и вогнутых контуров — пойма реки, ООЗТ вдоль набережной,
// техзона вдоль улицы — эта точка лежит ВНЕ полигона, и весь контур получал
// засечки наружу. Знак площади при обходе верен для любого простого контура.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

const start = app.indexOf("function inwardSign(ring) {");
// рабочая копия бывает с CRLF — конец функции ищем по её последней строке
const end = app.indexOf("\n}", app.indexOf("return area2 > 0", start)) + 2;
assert.ok(start > 0, "функция стороны засечек должна оставаться извлекаемой");

// экранные координаты: y вниз (как canvas), масштаб 1
const context = vm.createContext({ w2s: (x, y) => [x, -y] });
vm.runInContext(app.slice(start, end), context);
const inwardSign = vm.runInContext("inwardSign", context);

// В экранных координатах нормаль (-ty, tx) при inward=+1 — та же, что рисует
// drawLineMarkers. Проверяем, что она указывает внутрь: берём середину ребра,
// отступаем по нормали и смотрим, попали ли внутрь контура.
const insideScreen = (point, ring) => {
  const pts = ring.map(([x, y]) => [x, -y]);   // тот же w2s
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > point[1]) !== (yj > point[1]) &&
        point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const normalPointsInside = ring => {
  const sign = inwardSign(ring);
  // проверяем КАЖДОЕ ребро: одна верная грань ещё ничего не доказывает
  const pts = ring.map(([x, y]) => [x, -y]);
  let ok = 0, total = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 1e-9) continue;
    const tx = (x2 - x1) / d, ty = (y2 - y1) / d;
    const nx = -ty * sign, ny = tx * sign;
    const mid = [(x1 + x2) / 2 + nx * 0.01, (y1 + y2) / 2 + ny * 0.01];
    total += 1;
    // обратно в мировые координаты для общей проверки принадлежности
    if (insideScreen([mid[0], mid[1]], ring)) ok += 1;
  }
  return { ok, total };
};

const check = (name, ring) => {
  const { ok, total } = normalPointsInside(ring);
  assert.equal(ok, total, `${name}: засечки смотрят внутрь только на ${ok} из ${total} рёбер`);
};

// квадрат в обе стороны обхода
check("квадрат по часовой", [[0, 0], [10, 0], [10, 10], [0, 10]]);
check("квадрат против часовой", [[0, 0], [0, 10], [10, 10], [10, 0]]);

// вытянутый коридор — центр тяжести близко к краю
check("коридор", [[0, 0], [400, 0], [400, 6], [0, 6]]);

// подкова: среднее арифметическое вершин лежит ВНЕ фигуры — на этом ломалась
// прежняя проверка
const horseshoe = [[0, 0], [100, 0], [100, 30], [70, 30], [70, 10], [30, 10], [30, 30], [0, 30]];
check("подкова", horseshoe);
check("подкова наоборот", [...horseshoe].reverse());

// извилистая пойма: много вогнутостей подряд
const river = [];
for (let i = 0; i <= 20; i++) river.push([i * 10, Math.sin(i / 2) * 25]);
for (let i = 20; i >= 0; i--) river.push([i * 10, Math.sin(i / 2) * 25 + 14]);
check("пойма реки", river);

// сторона не должна зависеть от того, с какой вершины начат обход
const rotated = [...horseshoe.slice(3), ...horseshoe.slice(0, 3)];
assert.equal(inwardSign(horseshoe), inwardSign(rotated),
  "сторона обязана зависеть от обхода, а не от того, с какой вершины он начат");

// у знака ООЗТ засечки объявлены внутрь — проверяем, что данные не разошлись
const styles = JSON.parse(fs.readFileSync(path.join(root, "styles.json"), "utf8"));
assert.equal(styles["lgr.oozt"].line_marker.dir, "in",
  "знак ООЗТ рисуется засечками внутрь — это его опознавательный признак");

console.log("marker-side: OK");
