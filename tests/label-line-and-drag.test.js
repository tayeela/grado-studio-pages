"use strict";

// Подписи вдоль линий и ручной сдвиг — дважды отложенный хвост движка
// подписей. Что здесь важно:
// 1. Подпись линии идёт вдоль самого длинного ребра и не бывает вверх ногами.
//    Если строка длиннее ребра — горизонтально в середину, без растянутой лжи.
// 2. Повёрнутая подпись занимает в раскладке свой описанный прямоугольник,
//    а не рамку неповёрнутого текста.
// 3. Смещённая рукой подпись закреплена: показывается всегда, соседей не
//    спрашивает — человек поставил её сам. Хранится в объекте (label_offset,
//    метры мира) и переживает сохранение проекта.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-labels.js"));
const L = globalThis.GRADO_LABELS;

// ---------- раскладка: поворот и закрепление ----------
{
  // повёрнутая на 90° подпись 100×12 занимает столбик, а не полосу
  const vertical = L.layout([{ text: "в", x: 100, y: 100, width: 100, height: 12,
    angle: Math.PI / 2, priority: 5 }]);
  const box = vertical[0].box;
  assert.ok(box[3] - box[1] > box[2] - box[0],
    "повёрнутая подпись обязана занимать вертикальный прямоугольник");
  assert.ok(box[3] - box[1] >= 100, "высота рамки — от длины строки");

  // два задания на одном месте: закреплённое ставится, даже когда место занято
  const grid = L.createGrid();
  L.layout([{ text: "фон", x: 100, y: 100, width: 60, height: 12, priority: 900 }], { grid });
  const blocked = L.layout([{ text: "обычная", x: 100, y: 100, width: 60, height: 12, priority: 5 }], { grid });
  assert.equal(blocked.length, 0, "обычная подпись на занятом месте прячется");
  const pinned = L.layout([{ text: "закреп", x: 100, y: 100, width: 60, height: 12,
    priority: 5, pinned: true }], { grid });
  assert.equal(pinned.length, 1, "закреплённая рукой — ставится всегда");
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

  // подпись линии — вдоль самого длинного ребра, не вверх ногами
  assert.match(app, /Подпись линии идёт ВДОЛЬ неё — по самому длинному ребру/,
    "линии обязаны подписываться вдоль");
  assert.match(app, /if \(angle > Math\.PI \/ 2 \|\| angle < -Math\.PI \/ 2\) angle \+= Math\.PI;/,
    "подпись не бывает вверх ногами");
  assert.match(app, /const along = width \+ 8 <= bl;/,
    "строка длиннее ребра ложится горизонтально, а не растягивает ложь");

  // ручное смещение
  assert.match(app, /function applyLabelOffset\(job, f\)/);
  assert.match(app, /job\.x \+= off\[0\] \* state\.view\.k;/,
    "смещение хранится в метрах мира и не плывёт при зуме");
  assert.match(app, /job\.pinned = true;[\s\S]{0,40}job\.priority = 1e9;/,
    "смещённая рукой подпись закреплена и важнее всех");

  // перетаскивание: только у выбранного объекта, живёт в кадровых рамках
  assert.match(app, /const grabbed = _labelBoxes\.find\(item => state\.selectedIds\.has\(item\.featureId\)/,
    "тянется подпись только ВЫБРАННОГО объекта — иначе клик спорит с выбором");
  assert.match(app, /state\.labelDrag = \{ f, startX: wxr, startY: wyr,/,
    "перенос идёт в мировых координатах");
  assert.match(app, /почти нулевой сдвиг — это клик, а не перенос/,
    "случайный клик не оставляет мусорного смещения");
  assert.match(app, /Подпись вернулась к авторазмещению/,
    "двойной клик по подписи снимает закрепление");
  // на лист рамки подписей не собираются — там перетаскивания нет
  assert.match(app, /if \(!_renderTarget\) _labelBoxes = placed/,
    "рамки подписей запоминаются только на экране");

  // поворот при отрисовке
  assert.match(app, /if \(job\.angle\) \{ ctx\.save\(\); ctx\.translate\(job\.x, job\.y\); ctx\.rotate\(job\.angle\); \}/,
    "повёрнутая подпись рисуется поворотом холста — на листе PDF тем же кодом");
}

console.log("label-line-and-drag: OK");
