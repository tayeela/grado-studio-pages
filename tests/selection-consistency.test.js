"use strict";

// Выделение хранится в ДВУХ полях: selectedIds — множество (источник истины
// для групповых правок) и selected — «первичный» объект для панели свойств и
// правки вершин. Кто трогает одно поле мимо helper'ов, оставляет второе
// врать.
//
// Что ловили:
//  • дубликат (Ctrl+D) ставил selected на копию, а в selectedIds оставался
//    ОРИГИНАЛ. Сразу после дубликата стрелки двигали оригинал, а Del удалял
//    его же: человек правит один объект, а меняется другой;
//  • скрытие слоя снимало только selected. Объекты скрытого слоя оставались
//    в selectedIds, и разрезание/сдвиг/удаление продолжали доставать их
//    вслепую — на экране их нет;
//  • очистка холста и импорт оставляли в selectedIds идентификаторы уже
//    несуществующих объектов.

const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const читать = f => fs.readFileSync(path.join(root, f), "utf8");

// ---------- deselectWhere вычищает и множество, и первичный ----------
{
  const src = читать("app-geodesy.js");
  const start = src.indexOf("function selectionIds(");
  const end = src.indexOf("function vertexAt(", start);
  assert.ok(start >= 0 && end > start, "helper'ы выделения обязаны оставаться извлекаемыми");
  const context = vm.createContext({ state: null, Set, Array });
  vm.runInContext(src.slice(start, end), context);
  const { deselectWhere, selectOne, clearSelection } = context;

  const слой = { id: "L1" }, другой = { id: "L2" };
  context.layerOf = f => f.layer;
  const мир = () => ({
    features: [{ id: 1, layer: слой }, { id: 2, layer: слой }, { id: 3, layer: другой }],
    selected: 1, selectedIds: new Set([1, 2, 3]),
  });

  context.state = мир();
  deselectWhere(f => f.layer === слой);
  assert.deepEqual([...context.state.selectedIds], [3],
    "объекты скрытого слоя обязаны уйти из selectedIds, а не только из selected");
  assert.equal(context.state.selected, 3,
    "остался один объект — он и становится первичным, панель свойств не должна пустеть зря");

  context.state = мир();
  deselectWhere(f => f.layer === другой);
  assert.equal(context.state.selected, 1,
    "первичный объект уцелел — снимать его незачем");
  assert.deepEqual([...context.state.selectedIds], [1, 2]);

  context.state = мир();
  deselectWhere(() => true);
  assert.equal(context.state.selected, null, "выделять больше нечего");
  assert.equal(context.state.selectedIds.size, 0);

  context.state = { features: [{ id: 1, layer: слой }, { id: 2, layer: слой }], selected: 1, selectedIds: new Set([1, 2]) };
  deselectWhere(f => f.id === 3);
  assert.equal(context.state.selected, 1, "ничего не убрали — первичный не трогаем");

  context.state = мир();
  selectOne(7);
  assert.deepEqual([...context.state.selectedIds], [7], "selectOne чинит оба поля разом");
  clearSelection();
  assert.equal(context.state.selectedIds.size, 0);
}

// ---------- никто не правит state.selected в обход helper'ов ----------
{
  // Разрешены только сами helper'ы и восстановление сохранённого значения
  // (откат импорта, чистка после удаления слоя) — там selectedIds чинится
  // рядом, в тех же строках.
  const РАЗРЕШЕНО = {
    "app-geodesy.js": 5,   // сами helper'ы: selectOne, clearSelection, setSelection, deselectWhere, toggleSelection
    "app-history.js": 1,   // прополка после undo: selectedIds чистится строкой выше
    "app-layer-diff.js": 1,// рядом стоит state.selectedIds = new Set([f.id])
    "app-sources.js": 1,   // откат импорта: selectedIds восстанавливается следующей строкой
    "app-vector.js": 1,    // то же для отката вектора
    "app.js": 3,           // сохранение/восстановление на время выгрузки и прополка при удалении слоя
  };
  const файлы = fs.readdirSync(root).filter(n => n.endsWith(".js"));
  for (const имя of файлы) {
    const строки = читать(имя).split("\n").filter(s => /state\.selected\s*=[^=]/.test(s));
    const можно = РАЗРЕШЕНО[имя] || 0;
    assert.ok(строки.length <= можно,
      `${имя}: state.selected присваивают ${строки.length} раз при разрешённых ${можно}. ` +
      "Мимо selectOne/clearSelection/setSelection второе поле выделения остаётся врать:\n  " +
      строки.map(s => s.trim()).join("\n  "));
  }
}

// ---------- дубликат выделяет КОПИЮ ----------
{
  const src = читать("app-geom-edit.js");
  const тело = src.slice(src.indexOf("function duplicateSelected"), src.indexOf("function nudgeSelected"));
  assert.match(тело, /selectOne\(copy\.id\)/,
    "после дубликата выделена обязана быть копия целиком, иначе стрелки и Del " +
    "уедут по оригиналу, который остался в selectedIds");
  assert.ok(!/state\.selected\s*=/.test(тело), "прямое присваивание тут и было ошибкой");
}

// ---------- скрытие слоя снимает выделение множеством ----------
{
  const src = читать("app-layer-panel.js");
  assert.equal((src.match(/deselectWhere\(/g) || []).length, 2,
    "оба выключателя видимости — и группы, и одиночного слоя — обязаны чистить selectedIds");
}

console.log("selection-consistency: OK");
